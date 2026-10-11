import "dotenv/config";
import { createHash } from "node:crypto";
import express from "express";
import { corsPolicy } from "./cors";
import { lookup } from "node:dns/promises";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  apiSignature,
  parseNotification,
  notificationParameterString,
  verifyPayment,
  verifyNotification,
  validProviderIp,
} from "./payfast";
import { analyzeReceiptDocument, documentIntelligenceConfigured } from "./document-intelligence";
import {
  isDuplicateMerchant,
  parseReceiptResult,
  suggestReceiptCategory,
  validateReceiptContent,
} from "./receipt-processing";
import { subscriptionPlans } from "../src/lib/pricing";
const app = express();
app.disable("x-powered-by");
if (process.env.TRUSTED_PROXY_CIDRS)
  app.set(
    "trust proxy",
    process.env.TRUSTED_PROXY_CIDRS.split(",").map((s) => s.trim()),
  );
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (process.env.NODE_ENV === "production")
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; form-action 'self' https://sandbox.payfast.co.za https://www.payfast.co.za; frame-ancestors 'none'; base-uri 'self'",
    );
  if (req.secure)
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  next();
});
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  process.env.APP_ORIGIN ||
  (process.env.NODE_ENV === "production"
    ? ""
    : "http://localhost:3000,http://127.0.0.1:3000")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use("/api", corsPolicy(allowedOrigins));
const required = (key: string) => {
  const value = process.env[key];
  if (!value || value.startsWith("your_"))
    throw new Error(`${key} is not configured`);
  return value;
};
const service = () =>
  createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
const check = (r: any) => {
  if (r.error) throw new Error("Database operation failed");
  return r.data;
};
function config() {
  const mode = process.env.PAYFAST_MODE || "sandbox";
  if (!["sandbox", "live"].includes(mode))
    throw new Error("Invalid payment mode");
  if (
    mode === "live" &&
    (process.env.PAYFAST_LIVE_ENABLED !== "true" ||
      process.env.RELEASE_SANDBOX_ONLY === "true")
  )
    throw new Error("Live billing has not been enabled");
  const origin = required("APP_ORIGIN").replace(/\/$/, "");
  const notify = required("PAYFAST_NOTIFY_URL");
  if (!origin.startsWith("https://") || !notify.startsWith("https://"))
    throw new Error("Billing requires public HTTPS URLs");
  return {
    mode,
    merchant: required("PAYFAST_MERCHANT_ID"),
    key: required("PAYFAST_MERCHANT_KEY"),
    passphrase: required("PAYFAST_PASSPHRASE"),
    origin,
    notify,
    host:
      mode === "sandbox"
        ? "https://sandbox.payfast.co.za"
        : "https://www.payfast.co.za",
  };
}
// In-memory request limiter; use gateway rate limiting across instances in production.
const attempts = new Map<string, { n: number; until: number }>();
const receiptAttempts = new Map<string, { n: number; until: number }>();
app.use("/api", (req, res, next) => {
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  if (attempts.size > 10000)
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const item = attempts.get(key);
  if (!item || item.until < now) {
    attempts.set(key, { n: 1, until: now + 60000 });
    next();
    return;
  }
  if (++item.n > 100) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }
  next();
});
app.post(
  "/api/receipts/process",
  express.json({ limit: "4kb" }),
  async (req, res) => {
    let admin: ReturnType<typeof service> | undefined;
    let businessId: string | undefined;
    let receiptId: string | undefined;
    try {
      admin = service();
      const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
      if (!token) {
        res.status(401).json({ error: "Sign in to process this receipt." });
        return;
      }
      const { data: authData, error: authError } =
        await admin.auth.getUser(token);
      const user = authData.user;
      if (authError || !user) {
        res.status(401).json({ error: "Session expired. Sign in again." });
        return;
      }
      if (!user.email_confirmed_at) {
        res.status(403).json({ error: "Verify your email before processing receipts." });
        return;
      }

      const pathValue = req.body?.path;
      if (
        typeof pathValue !== "string" ||
        pathValue.length > 512 ||
        pathValue.includes("\\") ||
        pathValue.includes("..")
      ) {
        res.status(400).json({ error: "Invalid receipt path." });
        return;
      }
      businessId = pathValue.split("/", 1)[0];
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          businessId,
        )
      ) {
        res.status(400).json({ error: "Invalid receipt path." });
        return;
      }

      const ownedBusiness = check(
        await admin
          .from("businesses")
          .select("id")
          .eq("id", businessId)
          .eq("owner_id", user.id)
          .maybeSingle(),
      );
      if (!ownedBusiness) {
        res.status(404).json({ error: "Receipt not found." });
        return;
      }

      const anonKey = required("SUPABASE_ANON_KEY");
      if (/\s/.test(anonKey)) {
        res.status(503).json({ error: "Receipt processing is not configured." });
        return;
      }
      const userClient = createClient(required("SUPABASE_URL"), anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const access = check(await userClient.rpc("billing_access"));
      const entitlement = (access ?? []).find(
        (row: { business_id: string }) => row.business_id === businessId,
      );
      if (!entitlement) {
        res.status(403).json({ error: "Workspace billing access is unavailable." });
        return;
      }
      if (!entitlement.can_write) {
        res.status(403).json({
          error: "An active trial or subscription is required to process receipts.",
        });
        return;
      }

      const rateKey = `${businessId}:${user.id}`;
      const now = Date.now();
      const recent = receiptAttempts.get(rateKey);
      if (recent && recent.until > now && recent.n >= 10) {
        res.status(429).json({
          error: "Receipt processing is limited to 10 requests per workspace each minute.",
        });
        return;
      }
      if (!recent || recent.until <= now) {
        receiptAttempts.set(rateKey, { n: 1, until: now + 60000 });
      } else {
        recent.n += 1;
      }
      if (receiptAttempts.size > 10000)
        for (const [key, value] of receiptAttempts)
          if (value.until <= now) receiptAttempts.delete(key);

      const visibleReceipt = check(
        await userClient
          .from("receipts")
          .select("id,business_id,storage_path")
          .eq("business_id", businessId)
          .eq("storage_path", pathValue)
          .maybeSingle(),
      );
      if (!visibleReceipt) {
        res.status(404).json({ error: "Receipt not found." });
        return;
      }
      receiptId = visibleReceipt.id;
      const current = check(
        await admin
          .from("receipt_processing")
          .select("status,attempt_count,extracted_data,expense_id")
          .eq("receipt_id", receiptId)
          .eq("business_id", businessId)
          .maybeSingle(),
      );
      if (current?.status === "completed") {
        res.json(current);
        return;
      }
      if (!documentIntelligenceConfigured()) {
        res.status(503).json({
          error: "Receipt reading is not configured. Add the Azure Document Intelligence settings and retry.",
        });
        return;
      }

      const { data: file, error: downloadError } = await admin.storage
        .from("nexora-receipts")
        .download(pathValue);
      if (downloadError || !file) {
        res.status(404).json({ error: "The private receipt file is unavailable." });
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extension = pathValue.split(".").at(-1)?.toLowerCase();
      const expectedMime =
        extension === "pdf"
          ? "application/pdf"
          : extension === "jpg" || extension === "jpeg"
            ? "image/jpeg"
            : extension === "png"
              ? "image/png"
              : "";
      if (!expectedMime || (file.type && file.type !== expectedMime)) {
        res.status(415).json({ error: "Upload a valid PDF, JPG or PNG receipt." });
        return;
      }
      try {
        validateReceiptContent(expectedMime, bytes);
      } catch {
        res.status(415).json({ error: "Upload a valid PDF, JPG or PNG receipt no larger than 5MB." });
        return;
      }

      const fingerprint = createHash("sha256").update(bytes).digest("hex");
      const acquired = check(
        await admin.rpc("begin_receipt_processing", {
          p_business_id: businessId,
          p_receipt_id: receiptId,
          p_source_sha256: fingerprint,
        }),
      );
      if (!acquired.acquired) {
        const statusCode =
          acquired.status === "rate_limited"
            ? 429
            : acquired.status === "retry_limit"
              ? 409
              : acquired.status === "processing"
                ? 202
                : 200;
        res.status(statusCode).json(acquired);
        return;
      }

      const priorReceipt = check(
        await admin
          .from("receipt_processing")
          .select("receipt_id")
          .eq("business_id", businessId)
          .eq("source_sha256", fingerprint)
          .neq("receipt_id", receiptId)
          .limit(1)
          .maybeSingle(),
      );
      if (priorReceipt) {
        const duplicate = check(
          await admin.rpc("finish_receipt_processing", {
            p_business_id: businessId,
            p_receipt_id: receiptId,
            p_status: "needs_review",
            p_extracted_data: { review_reasons: ["duplicate_receipt"] },
            p_duplicate_of_receipt_id: priorReceipt.receipt_id,
          }),
        );
        res.json(duplicate);
        return;
      }

      try {
        const raw = await analyzeReceiptDocument(bytes);
        const extraction = parseReceiptResult(raw);
        const categories = check(
          await admin
            .from("categories")
            .select("id,name")
            .eq("business_id", businessId),
        );
        const categoryId = suggestReceiptCategory(extraction, categories ?? []);
        const reasons = [...extraction.review_reasons];

        if (
          extraction.merchant &&
          extraction.date &&
          extraction.amount !== null &&
          extraction.currency
        ) {
          const possibleDuplicates = check(
            await admin
              .from("expenses")
              .select("merchant")
              .eq("business_id", businessId)
              .eq("date", extraction.date)
              .eq("amount", extraction.amount)
              .eq("currency", extraction.currency)
              .limit(20),
          );
          if (isDuplicateMerchant(extraction.merchant, possibleDuplicates ?? []))
            reasons.push("possible_duplicate_expense");
        }

        const status = reasons.length ? "needs_review" : "completed";
        const extractedData = {
          merchant: extraction.merchant,
          date: extraction.date,
          amount: extraction.amount,
          currency: extraction.currency,
          tax: extraction.tax,
          document_number: extraction.document_number,
          description: extraction.description,
          payment_method: extraction.payment_method,
          confidence: extraction.confidence,
          review_reasons: [...new Set(reasons)],
          is_bank_statement: extraction.is_bank_statement,
          suggested_category_id: categoryId,
          page_count: Array.isArray(raw?.analyzeResult?.pages)
            ? raw.analyzeResult.pages.length
            : null,
        };
        const result = check(
          await admin.rpc("finish_receipt_processing", {
            p_business_id: businessId,
            p_receipt_id: receiptId,
            p_status: status,
            p_extracted_data: extractedData,
            p_create_expense: status === "completed",
            p_merchant: extraction.merchant,
            p_date: extraction.date,
            p_amount: extraction.amount,
            p_currency: extraction.currency,
            p_description: extraction.description,
            p_category_id: categoryId,
          }),
        );
        res.json({ ...result, extracted_data: extractedData });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const errorCode = [
          "provider_unavailable",
          "provider_failed",
          "provider_timeout",
          "invalid_document",
        ].includes(message)
          ? message
          : "processing_unavailable";
        const failed = check(
          await admin.rpc("finish_receipt_processing", {
            p_business_id: businessId,
            p_receipt_id: receiptId,
            p_status: "failed",
            p_extracted_data: {},
            p_error_code: errorCode,
          }),
        );
        const statusCode =
          errorCode === "provider_timeout"
            ? 504
            : errorCode === "invalid_document"
              ? 422
              : errorCode === "provider_failed"
                ? 502
                : 503;
        res.status(statusCode).json(failed);
      }
    } catch {
      res.status(503).json({
        error: "Receipt processing is temporarily unavailable. Your private upload was not removed.",
      });
    }
  },
);
app.get("/api/health", (_req, res) => {
  let configured = false;
  try {
    config();
    service();
    configured = true;
  } catch {}
  res.json({
    product: "NEXORA Expense",
    mode: process.env.PAYFAST_MODE || "sandbox",
    configured,
    billingCurrency: "USD",
    usdCheckoutEnabled: false,
    receiptProcessingConfigured: documentIntelligenceConfigured(),
  });
});
app.get("/api/billing/plans", (_req, res) => {
  res.json({
    currency: "USD",
    interval: "month",
    trialDays: 30,
    plans: subscriptionPlans,
  });
});
app.post(
  "/api/payfast/notify",
  express.text({ type: "application/x-www-form-urlencoded", limit: "32kb" }),
  async (req, res) => {
    try {
      const c = config();
      if (
        !(await validProviderIp(req.ip ?? "", (host) =>
          lookup(host, { all: true }),
        ))
      )
        throw new Error("Invalid notification source");
      if (typeof req.body !== "string") throw new Error("Invalid notification");
      const fields = parseNotification(req.body);
      const admin = service();
      const order = check(
        await admin
          .from("billing_orders")
          .select("*")
          .eq("id", fields.m_payment_id)
          .single(),
      );
      if (order.mode !== c.mode) throw new Error("Payment mode mismatch");
      verifyNotification(
        fields,
        c.merchant,
        Number(order.amount),
        c.passphrase,
      );
      if (fields.payment_status === "COMPLETE")
        verifyPayment(fields, c.merchant, Number(order.amount), c.passphrase);
      // Ask Payfast itself to validate the signed notification; frontend redirects never grant access.
      const validation = await fetch(c.host + "/eng/query/validate", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: notificationParameterString(fields),
        signal: AbortSignal.timeout(10000),
      });
      if (!validation.ok || (await validation.text()).trim() !== "VALID")
        throw new Error("Provider verification failed");
      if (fields.payment_status === "COMPLETE")
        check(
          await admin.rpc("record_payment", {
            payment_id: fields.pf_payment_id,
            order_ref: order.id,
            token: fields.token,
            expected_mode: c.mode,
          }),
        );
      else
        check(
          await admin.rpc("record_billing_notification", {
            event_id: createHash("sha256").update(req.body).digest("hex"),
            order_ref: order.id,
            notification_status: fields.payment_status,
            token: fields.token ?? "",
            expected_mode: c.mode,
          }),
        );
      res.status(200).send("OK");
    } catch (error) {
      console.error(
        "Payfast notification rejected:",
        error instanceof Error ? error.message : "Verification failed",
      );
      res.status(400).send("Notification rejected");
    }
  },
);
app.use("/api/billing", (req, res, next) => {
  if (!["/checkout", "/cancel"].includes(req.path)) {
    res.status(404).json({ error: "Unknown billing endpoint" });
    return;
  }
  next();
});
app.post("/api/billing/checkout", (_req, res) => {
  res.status(503).json({
    error:
      "USD checkout is disabled until a USD-capable payment provider and matching billing records are verified.",
  });
});
app.use(
  "/api/billing",
  express.json({ limit: "8kb" }),
  async (req, res, next) => {
    try {
      const admin = service();
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) {
        res.status(401).json({ error: "Sign in required" });
        return;
      }
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) {
        res.status(401).json({ error: "Session expired. Sign in again." });
        return;
      }
      const business = check(
        await admin
          .from("businesses")
          .select("id")
          .eq("owner_id", data.user.id)
          .single(),
      );
      res.locals.business = business;
      res.locals.user = data.user;
      res.locals.admin = admin;
      next();
    } catch {
      res.status(503).json({
        error: "Billing is not configured or is temporarily unavailable.",
      });
    }
  },
);
app.post("/api/billing/cancel", async (_req, res) => {
  try {
    const c = config();
    const admin = res.locals.admin,
      bid = res.locals.business.id;
    const subscription = check(
      await admin
        .from("subscriptions")
        .select("*")
        .eq("business_id", bid)
        .single(),
    );
    if (!subscription.provider_token)
      throw new Error("No recurring subscription to cancel");
    const headers = {
      "merchant-id": c.merchant,
      version: "v1",
      timestamp: new Date().toISOString(),
    };
    const signed = {
      ...headers,
      signature: apiSignature(headers, c.passphrase),
    };
    const providerURL = `https://api.payfast.co.za/subscriptions/${encodeURIComponent(subscription.provider_token)}`;
    const suffix = c.mode === "sandbox" ? "?testing=true" : "";
    const current = await fetch(providerURL + "/fetch" + suffix, {
      headers: signed,
      signal: AbortSignal.timeout(10000),
    });
    const currentState = await current.json();
    if (!current.ok || currentState.status !== "success")
      throw new Error("Unable to verify provider subscription. Please retry.");
    if (currentState.data?.response?.status_text !== "CANCELLED") {
      const response = await fetch(providerURL + "/cancel" + suffix, {
        method: "PUT",
        headers: signed,
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (
        !response.ok ||
        result.status !== "success" ||
        result.data?.response !== true
      )
        throw new Error("Provider did not confirm cancellation. Please retry.");
    }
    check(
      await admin.rpc("cancel_billing", {
        bid,
        expected_token: subscription.provider_token,
      }),
    );
    res.json({ cancelled: true });
  } catch (e) {
    res.status(503).json({
      error: e instanceof Error ? e.message : "Cancellation unavailable",
    });
  }
});
app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Unknown endpoint" }),
);
if (
  process.env.NODE_ENV === "production" &&
  process.env.SERVE_FRONTEND !== "false"
) {
  const dist = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../dist",
  );
  app.use(express.static(dist));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}
const port = Number(process.env.PORT || 3001);
app.listen(
  port,
  process.env.BIND_HOST ||
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  () => console.log(`NEXORA Expense server listening on ${port}`),
);
