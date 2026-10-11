import { test, expect } from "@playwright/test";
test("unconfigured billing fails closed and never grants access on redirect", async ({
  request,
}) => {
  const root = "http://127.0.0.1:3103";
  const health = await request.get(root + "/api/health");
  expect(await health.json()).toMatchObject({
    configured: false,
    mode: "sandbox",
    billingCurrency: "USD",
    usdCheckoutEnabled: false,
  });
  const plans = await request.get(root + "/api/billing/plans");
  expect(await plans.json()).toMatchObject({
    currency: "USD",
    interval: "month",
    trialDays: 30,
    plans: [
      { id: "starter", amountCents: 500 },
      { id: "pro", amountCents: 1200, recommended: true },
      { id: "business", amountCents: 2500 },
    ],
  });
  const checkout = await request.post(root + "/api/billing/checkout");
  expect(checkout.status()).toBe(503);
  expect(await checkout.json()).toMatchObject({
    error:
      "USD checkout is disabled until a USD-capable payment provider and matching billing records are verified.",
  });
  const cancel = await request.post(root + "/api/billing/cancel");
  expect(cancel.status()).toBe(503);
  const notify = await request.post(root + "/api/payfast/notify", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: "payment_status=COMPLETE&amount_gross=69.00",
  });
  expect(notify.status()).toBe(400);
  const redirect = await request.get(
    root + "/api/billing/returned?payment_status=COMPLETE",
  );
  expect(redirect.status()).toBe(404);
});
test("built production server serves SPA routes, brand assets and security headers", async ({
  request,
  page,
}) => {
  const root = "http://127.0.0.1:3104";
  const response = await request.get(root + "/login");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect((await request.get(root + "/favicon.png")).ok()).toBeTruthy();
  await page.goto(root);
  await expect(
    page.getByRole("heading", { name: "Big ambitions. Clearer expenses." }),
  ).toBeVisible();
});

test("API CORS accepts only the configured frontend origin", async ({
  request,
}) => {
  const allowed = await request.fetch("http://localhost:3103/api/health", {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3000",
      "Access-Control-Request-Method": "POST",
    },
  });
  expect(allowed.status()).toBe(204);
  expect(allowed.headers()["access-control-allow-origin"]).toBe(
    "http://localhost:3000",
  );
  const denied = await request.get("http://localhost:3103/api/health", {
    headers: { Origin: "https://untrusted.example" },
  });
  expect(denied.status()).toBe(403);
});
