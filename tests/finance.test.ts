import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { total, csv } from "../src/lib/finance";
import {
  signature,
  validSignature,
  verifyPayment,
  parseNotification,
  apiSignature,
  nextBillingDate,
  validProviderIp,
  notificationSignature,
  notificationParameterString,
  encode,
} from "../server/payfast";
import {
  formatUsdCents,
  isSubscriptionPlanId,
  subscriptionPlans,
} from "../src/lib/pricing";
test("totals add integer cents, including decimal precision cases", () => {
  assert.equal(total([{ amount: 0.1 }, { amount: 0.2 }]), 0.3);
  assert.equal(
    total([{ amount: 1499 }, { amount: 450 }, { amount: 850 }]),
    2799,
  );
  assert.equal(total([]), 0);
});
test("CSV escapes quotes, delimiters, newlines and formula injection", () => {
  const row = {
    date: "2026-10-09",
    merchant: "=SUM(1,2)",
    description: 'a "quote"\nline',
    amount: 69,
    status: "Approved",
    receipt_url: null,
    category_id: null,
    id: "1",
    business_id: "b",
  };
  const result = csv([row], []);
  assert.ok(result.includes('"\'=SUM(1,2)"'));
  assert.ok(result.includes('"a ""quote""\nline"'));
  assert.ok(result.includes('"69.00"'));
});
test("approved monthly plan catalog uses exact USD minor-unit amounts", () => {
  assert.deepEqual(
    subscriptionPlans.map(({ id, name, amountCents, recommended }) => ({
      id,
      name,
      amountCents,
      recommended,
    })),
    [
      { id: "starter", name: "Starter", amountCents: 500, recommended: false },
      { id: "pro", name: "Pro", amountCents: 1200, recommended: true },
      {
        id: "business",
        name: "Business",
        amountCents: 2500,
        recommended: false,
      },
    ],
  );
  assert.equal(formatUsdCents(500), "$5.00");
  assert.equal(formatUsdCents(1200), "$12.00");
  assert.equal(formatUsdCents(2500), "$25.00");
  assert.equal(isSubscriptionPlanId("business"), true);
  assert.equal(isSubscriptionPlanId("enterprise"), false);
});
test("Payfast signatures detect tampering and wrong passphrase", () => {
  const fields = {
    merchant_id: "100",
    amount: "69.00",
    item_name: "NEXORA Expense & receipts",
  };
  const signed = { ...fields, signature: signature(fields, "secret") };
  assert.ok(validSignature(signed, "secret"));
  assert.ok(!validSignature({ ...signed, amount: "0.01" }, "secret"));
  assert.ok(!validSignature(signed, "wrong"));
});
test("API signature is alphabetical while checkout signature preserves order", () => {
  assert.equal(
    apiSignature({ b: "2", a: "1" }, "secret"),
    apiSignature({ a: "1", b: "2" }, "secret"),
  );
  assert.notEqual(
    signature({ b: "2", a: "1" }, "secret"),
    signature({ a: "1", b: "2" }, "secret"),
  );
});
test("notification rejects duplicate fields", () => {
  assert.throws(() => parseNotification("amount=69&amount=1"));
});
test("payment checks reject wrong merchant, amount, status, token and signature", () => {
  const base = {
    merchant_id: "100",
    amount_gross: "69.00",
    pf_payment_id: "123",
    m_payment_id: "order",
    payment_status: "COMPLETE",
    token: "12345678-1234-1234-1234-123456789abc",
  };
  const signed = (fields: Record<string, string>) => ({
    ...fields,
    signature: signature(fields, "secret"),
  });
  assert.doesNotThrow(() => verifyPayment(signed(base), "100", 69, "secret"));
  for (const change of [
    { merchant_id: "200" },
    { amount_gross: "1.00" },
    { amount_gross: "69junk" },
    { payment_status: "FAILED" },
    { token: "" },
  ])
    assert.throws(() =>
      verifyPayment(signed({ ...base, ...change }), "100", 69, "secret"),
    );
  assert.throws(() =>
    verifyPayment({ ...signed(base), signature: "bad" }, "100", 69, "secret"),
  );
});

test("monthly billing clamps month end correctly", () => {
  assert.equal(nextBillingDate(new Date("2026-01-31T10:00:00Z")), "2026-02-28");
  assert.equal(nextBillingDate(new Date("2028-01-31T10:00:00Z")), "2028-02-29");
});

test("webhook source IP must resolve to an official Payfast host", async () => {
  const resolve = async () => [{ address: "203.0.113.10" }];
  assert.ok(await validProviderIp("::ffff:203.0.113.10", resolve));
  assert.ok(!(await validProviderIp("127.0.0.1", resolve)));
  assert.ok(
    !(await validProviderIp("203.0.113.10", async () => {
      throw new Error("DNS failed");
    })),
  );
});

test("ITN signatures preserve blank fields and whitespace, with PHP URL encoding", () => {
  const fields = {
    merchant_id: "100",
    item_description: "",
    item_name: " ~ NEXORA! ",
  };
  const expected =
    "merchant_id=100&item_description=&item_name=+%7E+NEXORA%21+";
  assert.equal(notificationParameterString(fields), expected);
  assert.equal(
    notificationSignature(fields, "secret"),
    createHash("md5")
      .update(expected + "&passphrase=secret")
      .digest("hex"),
  );
  assert.ok(
    validSignature(
      { ...fields, signature: notificationSignature(fields, "secret") },
      "secret",
    ),
  );
  assert.equal(encode("!*~"), "%21%2A%7E");
});

test("local demo never runs in production, on remote hosts or with real Auth configured", async () => {
  const { allowLocalDemo } = await import("../src/lib/demo");
  assert.ok(allowLocalDemo(true, false, "localhost"));
  assert.ok(allowLocalDemo(true, false, "127.0.0.1"));
  assert.ok(!allowLocalDemo(false, false, "localhost"));
  assert.ok(!allowLocalDemo(true, true, "localhost"));
  assert.ok(!allowLocalDemo(true, false, "example.com"));
});
