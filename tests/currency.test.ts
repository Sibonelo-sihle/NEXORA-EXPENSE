import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  expenseAmount,
  total,
  currencyOf,
  totalsText,
} from "../src/lib/finance";
test("currency amounts preserve exact minor units and reject excess precision", () => {
  assert.equal(cents("99999999.99"), 9999999999n);
  assert.equal(expenseAmount("12.3"), "12.30");
  for (const value of ["1.001", "-1", "0", "1e3", "100000000.00"])
    assert.throws(() => expenseAmount(value));
});
test("reports cannot combine unlike currencies", () => {
  const rows = [
    { amount: "0.10", currency: "USD" },
    { amount: "0.20", currency: "USD" },
    { amount: "9.99", currency: "EUR" },
    { amount: 69 },
  ];
  assert.equal(total(rows, "USD"), 0.3);
  assert.equal(total(rows, "EUR"), 9.99);
  assert.equal(total(rows, "ZAR"), 69);
  assert.throws(() => total(rows));
  assert.equal(currencyOf({}), "ZAR");
  assert.throws(() => currencyOf({ currency: "GBP" }));
  assert.match(totalsText(rows), /USD/);
  assert.match(totalsText(rows), /EUR/);
});
