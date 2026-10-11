import { useEffect, useState } from "react";
import { useBusiness } from "../contexts/BusinessContext";
import {
  listReceipts,
  uploadReceipt,
  receiptName,
  RECEIPT_BUCKET,
} from "../lib/receipts";
import { Link } from "react-router-dom";
import { db, check } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { apiURL } from "../lib/api";
import { useCallback } from "react";
import {
  currencies,
  currencyOf,
  expenseAmount,
} from "../lib/finance";
import type { Category, Expense } from "../contexts/BusinessContext";

type StatementRow = {
  date: string;
  merchant: string;
  amount: string;
  currency: string;
  description: string;
  category_id: string;
};

function emptyStatementRow(): StatementRow {
  return {
    date: "",
    merchant: "",
    amount: "",
    currency: "",
    description: "",
    category_id: "",
  };
}

function StatementTransactionImport({
  businessId,
  path,
  categories,
  expenses,
  canWrite,
  refresh,
  onSaved,
}: {
  businessId: string;
  path: string;
  categories: Category[];
  expenses: Expense[];
  canWrite: boolean;
  refresh: () => Promise<void>;
  onSaved: (message: string) => void;
}) {
  const [rows, setRows] = useState<StatementRow[]>([emptyStatementRow()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const normalize = (value: string) =>
      value
        .normalize("NFKD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("en")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    let validRows: StatementRow[];
    try {
      validRows = rows.map((row) => ({
        ...row,
        merchant: row.merchant.trim(),
        amount: expenseAmount(row.amount),
      }));
    } catch {
      setError("Enter a valid amount for every transaction.");
      return;
    }
    if (
      validRows.some(
        (row) =>
          !row.date ||
          !row.merchant ||
          Number(row.amount) <= 0 ||
          !currencies.includes(row.currency as (typeof currencies)[number]),
      )
    ) {
      setError("Enter a date, merchant, positive amount and currency for every transaction.");
      return;
    }
    const duplicate = validRows.some((row, index) => {
      const matches = (candidate: {
        date: string;
        merchant: string;
        amount: number | string;
        currency?: string;
      }) =>
        candidate.date === row.date &&
        currencyOf(candidate) === row.currency &&
        Number(candidate.amount) === Number(row.amount) &&
        normalize(candidate.merchant) === normalize(row.merchant);
      return (
        expenses.some(matches) ||
        validRows.slice(0, index).some(matches)
      );
    });
    if (duplicate) {
      setError(
        "A matching transaction already exists in this workspace or this import. Review duplicates before saving.",
      );
      return;
    }
    setBusy(true);
    try {
      check(
        await db()
          .from("expenses")
          .insert(
            validRows.map((row) => ({
              business_id: businessId,
              date: row.date,
              merchant: row.merchant,
              amount: row.amount,
              currency: row.currency,
              description: row.description.trim() || null,
              category_id: row.category_id || null,
              receipt_url: path,
              status: "Pending",
            })),
          ),
      );
      await refresh();
      setRows([emptyStatementRow()]);
      onSaved("Reviewed statement transactions were added as pending expenses.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to import statement transactions.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" onSubmit={save}>
      <h3 className="font-semibold text-amber-950">Review statement transactions</h3>
      <p className="my-2 text-sm text-amber-900">
        Enter each verified business expense outflow separately. Deposits and
        transfers are not expenses and must not be included. All rows are saved
        as Pending and linked to this private statement.
      </p>
      {rows.map((row, index) => (
        <fieldset
          key={index}
          className="my-3 grid gap-3 border-t border-amber-200 pt-3 sm:grid-cols-2"
        >
          <legend className="text-sm font-medium">Transaction {index + 1}</legend>
          <label>
            Transaction date
            <input
              type="date"
              required
              value={row.date}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, i) =>
                    i === index ? { ...item, date: event.target.value } : item,
                  ),
                )
              }
            />
          </label>
          <label>
            Merchant / payee
            <input
              required
              maxLength={200}
              value={row.merchant}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, i) =>
                    i === index
                      ? { ...item, merchant: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <label>
            Amount
            <input
              type="number"
              min="0.01"
              max="99999999.99"
              step="0.01"
              required
              value={row.amount}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, i) =>
                    i === index
                      ? { ...item, amount: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          <label>
            Currency
            <select
              required
              value={row.currency}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, i) =>
                    i === index
                      ? { ...item, currency: event.target.value }
                      : item,
                  ),
                )
              }
            >
              <option value="">Select currency</option>
              {currencies.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </label>
          <label>
            Category
            <select
              value={row.category_id}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, i) =>
                    i === index
                      ? { ...item, category_id: event.target.value }
                      : item,
                  ),
                )
              }
            >
              <option value="">Uncategorised</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description
            <input
              maxLength={2000}
              value={row.description}
              onChange={(event) =>
                setRows((current) =>
                  current.map((item, i) =>
                    i === index
                      ? { ...item, description: event.target.value }
                      : item,
                  ),
                )
              }
            />
          </label>
          {rows.length > 1 && (
            <button
              type="button"
              className="text-left text-sm text-red-700"
              onClick={() =>
                setRows((current) => current.filter((_, i) => i !== index))
              }
            >
              Remove transaction
            </button>
          )}
        </fieldset>
      ))}
      {error && (
        <p className="error my-3" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setRows((current) => [...current, emptyStatementRow()])}
        >
          Add transaction row
        </button>
        <button className="primary" disabled={busy || !canWrite}>
          {busy ? "Saving…" : "Import reviewed transactions"}
        </button>
      </div>
    </form>
  );
}

type ReceiptProcessing = {
  receipt_id: string;
  status: "processing" | "needs_review" | "completed" | "failed";
  extracted_data: Record<string, unknown>;
  error_code: string | null;
  expense_id: string | null;
  duplicate_of_receipt_id: string | null;
  attempt_count: number;
};

export default function Receipts() {
  const { isDemo } = useAuth();
  const { business, access, expenses, categories, refresh } = useBusiness();
  const [files, setFiles] = useState<any[]>([]),
    [processing, setProcessing] = useState<Record<string, ReceiptProcessing>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [migrationNeeded, setMigrationNeeded] = useState(false),
    [processingId, setProcessingId] = useState("");
  const load = useCallback(async () => {
    try {
      setFiles(await listReceipts(business.id));
      if (isDemo) return;
      const { data, error: queryError } = await db()
        .from("receipt_processing")
        .select(
          "receipt_id,status,extracted_data,error_code,expense_id,duplicate_of_receipt_id,attempt_count",
        )
        .eq("business_id", business.id);
      if (queryError) {
        if (
          queryError.code === "42P01" ||
          queryError.code === "PGRST205" ||
          queryError.message.includes("receipt_processing")
        ) {
          setMigrationNeeded(true);
          setProcessing({});
          return;
        }
        throw queryError;
      }
      const { data: receiptRows, error: receiptsError } = await db()
        .from("receipts")
        .select("id,storage_object_id")
        .eq("business_id", business.id);
      if (receiptsError) throw receiptsError;
      const storageObjectIds = new Map(
        (receiptRows ?? []).map((receipt) => [
          receipt.id,
          receipt.storage_object_id ?? receipt.id,
        ]),
      );
      setMigrationNeeded(false);
      setProcessing(
        Object.fromEntries(
          (data ?? []).map((item) => [
            storageObjectIds.get(item.receipt_id) ?? item.receipt_id,
            item as ReceiptProcessing,
          ]),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load receipts.");
    }
  }, [business.id, isDemo]);
  useEffect(() => {
    if (!isDemo) void load();
  }, [isDemo, load]);
  async function processReceipt(path: string, receiptId?: string) {
    if (!access?.can_write) {
      setError("An active trial or subscription is required to process receipts.");
      return;
    }
    setProcessingId(receiptId ?? path);
    setError("");
    setMessage("");
    try {
      if (!import.meta.env.VITE_API_URL && !import.meta.env.DEV)
        throw new Error(
          "Receipt API is not configured. Set VITE_API_URL to the deployed backend and rebuild the frontend.",
        );
      const {
        data: { session },
        error: sessionError,
      } = await db().auth.getSession();
      if (sessionError) throw sessionError;
      if (!session?.access_token) throw new Error("Sign in again to process this receipt.");
      const response = await fetch(apiURL("/api/receipts/process"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path }),
      });
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw new Error(
          "The receipt API did not return JSON. Check VITE_API_URL and the deployed backend.",
        );
      const result = (await response.json().catch(() => null)) as
        | { status?: string; error?: string; expense_id?: string }
        | null;
      if (!response.ok && response.status !== 202)
        throw new Error(result?.error || "Receipt processing failed.");
      await Promise.all([load(), refresh()]);
      if (result?.status === "completed")
        setMessage("Receipt read. A draft expense is ready for your review.");
      else if (result?.status === "needs_review")
        setMessage("Receipt read. Review the extracted details before creating an expense.");
      else if (response.status === 202)
        setMessage("Receipt processing is already underway.");
      else setMessage("Receipt processing is underway.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Receipt processing is temporarily unavailable.",
      );
    } finally {
      setProcessingId("");
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const path = await uploadReceipt(business.id, file);
      await load();
      const uploaded = files.find((item) => item.path === path);
      await processReceipt(path, uploaded?.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to upload receipt.");
    } finally {
      setBusy(false);
    }
  }
  async function download(path: string) {
    try {
      const { data } = check(
        await db().storage.from(RECEIPT_BUCKET).download(path),
      );
      if (!data) throw new Error("Receipt is unavailable");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").at(-1)!;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to download receipt.");
    }
  }
  async function remove(path: string) {
    try {
      if (expenses.some((e) => e.receipt_url === path))
        throw new Error(
          "Detach this receipt from its expense before deleting it.",
        );
      check(await db().storage.from(RECEIPT_BUCKET).remove([path]));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to delete receipt.");
    }
  }
  const legacy = expenses
    .map((e) => e.receipt_url)
    .filter((p): p is string => !!p && !p.startsWith(business.id + "/"));
  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Private document library</p>
          <h1>Receipts</h1>
          <p className="mt-2 text-slate-600">
            Upload a receipt. NEXORA will take care of the rest.
          </p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {migrationNeeded && (
        <p className="notice" role="status">
          Receipt processing is not enabled yet. Apply the additive database
          migration 006 to turn on extraction; existing private receipts remain
          available.
        </p>
      )}
      <section className="panel">
        <h2>Smart receipt upload</h2>
        <p className="text-sm text-slate-500 my-3">
          PDF, JPG or PNG · up to 5MB · private to your business. Scanned
          images and multi-page PDFs are supported.
        </p>
        <input
          aria-label="Upload receipt"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          disabled={busy || !access?.can_write}
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </section>
      <section className="panel">
        <h2>Your receipts</h2>
        {!files.length && !legacy.length && (
          <p className="empty">No receipts uploaded yet.</p>
        )}
        {files.map((file) => {
          const path = file.path;
          const state = processing[file.id] ?? processing[file.name];
          const extracted = state?.extracted_data ?? {};
          const extractedValue = (key: string) => extracted[key] ?? "Not found";
          const amount =
            typeof extracted.amount === "number" &&
            typeof extracted.currency === "string"
              ? `${extracted.currency} ${extracted.amount.toFixed(2)}`
              : extractedValue("amount");
          return (
            <div key={file.id} className="py-4 border-b border-slate-100">
              <p className="text-sm break-all font-medium">
                {receiptName(file.name)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {Math.ceil((file.metadata?.size ?? 0) / 1024)} KB
              </p>
              <p className="mt-2 text-sm font-medium">
                {state?.status === "processing"
                  ? "Processing"
                  : state?.status === "needs_review"
                    ? "Needs Review"
                    : state?.status === "completed"
                      ? "Completed"
                      : state?.status === "failed"
                        ? "Failed"
                        : "Not processed"}
              </p>
              {state && (
                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1 text-sm text-slate-600">
                  <div>Merchant: {extractedValue("merchant") as string}</div>
                  <div>Date: {extractedValue("date") as string}</div>
                  <div>Total: {amount as string}</div>
                  <div>VAT / tax: {extractedValue("tax") as string}</div>
                  <div>
                    Receipt / invoice no.:{" "}
                    {extractedValue("document_number") as string}
                  </div>
                  <div>
                    Payment method:{" "}
                    {extractedValue("payment_method") as string}
                  </div>
                  {typeof extracted.description === "string" && (
                    <div className="sm:col-span-2">
                      Items: {extracted.description}
                    </div>
                  )}
                  {Array.isArray(extracted.review_reasons) &&
                    extracted.review_reasons.length > 0 && (
                      <div className="sm:col-span-2 text-amber-800">
                        Review required:{" "}
                        {(extracted.review_reasons as string[]).join(", ")}
                      </div>
                    )}
                  {extracted.is_bank_statement === true && (
                    <div className="sm:col-span-2 text-amber-800">
                      Bank statement detected. It was not created as one
                      expense. Review individual transactions before importing
                      them; deposits and transfers are not auto-classified.
                    </div>
                  )}
                </dl>
              )}
              {extracted.is_bank_statement === true && (
                <StatementTransactionImport
                  businessId={business.id}
                  path={path}
                  categories={categories}
                  expenses={expenses}
                  canWrite={!!access?.can_write}
                  refresh={refresh}
                  onSaved={setMessage}
                />
              )}
              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                <button
                  className="text-violet-700"
                  onClick={() => download(path)}
                >
                  Download
                </button>
                <Link className="text-violet-700" to="/expenses">
                  Attach to expense
                </Link>
                {state?.status === "completed" && state.expense_id && (
                  <Link
                    className="text-violet-700"
                    to={`/expenses?receipt=${encodeURIComponent(state.receipt_id)}`}
                  >
                    Review draft expense
                  </Link>
                )}
                {state?.status === "needs_review" && (
                  <Link
                    className="text-violet-700"
                    to={`/expenses?receipt=${encodeURIComponent(state.receipt_id)}`}
                  >
                    Review extracted details
                  </Link>
                )}
                {access?.can_write &&
                  !migrationNeeded &&
                  (!state ||
                    (state.status === "failed" && state.attempt_count < 4) ||
                    state.status === "processing") && (
                    <button
                      className="text-violet-700"
                      disabled={!!processingId}
                      onClick={() => void processReceipt(path, file.id)}
                    >
                      {processingId === file.id
                        ? "Processing…"
                        : state?.status === "failed"
                          ? "Retry processing"
                          : state?.status === "processing"
                            ? "Check status"
                            : "Read receipt"}
                    </button>
                  )}
                {state?.status === "failed" && state.attempt_count >= 4 && (
                  <span className="text-slate-500">
                    Retry limit reached. Contact support for help.
                  </span>
                )}
                <button
                  className="text-red-700"
                  disabled={!access?.can_write || busy}
                  onClick={() => remove(path)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {[...new Set(legacy)].map((path) => (
          <div className="py-4" key={path}>
            <span className="text-sm">Previously attached receipt</span>
            <button className="secondary ml-3" onClick={() => download(path)}>
              Download
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
