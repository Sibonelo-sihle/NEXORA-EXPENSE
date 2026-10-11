import test from "node:test";
import assert from "node:assert/strict";
import {
  isDuplicateMerchant,
  parseReceiptResult,
  suggestReceiptCategory,
  validateReceiptContent,
} from "../server/receipt-processing";

const confidentFields = {
  MerchantName: { valueString: "Northwind Cafe", confidence: 0.99 },
  TransactionDate: { valueDate: "2026-10-01", confidence: 0.99 },
  Total: {
    valueCurrency: { amount: 128.5, currencyCode: "ZAR" },
    confidence: 0.98,
  },
  TotalTax: {
    valueCurrency: { amount: 16.76, currencyCode: "ZAR" },
    confidence: 0.96,
  },
  ReceiptNumber: { valueString: "RC-123", confidence: 0.91 },
  PaymentMethod: { valueString: "Card", confidence: 0.9 },
  Items: {
    valueArray: [
      {
        valueObject: {
          Description: { valueString: "Coffee and food", confidence: 0.93 },
        },
      },
    ],
  },
};

test("extracts high-confidence receipt values without changing currency or amount", () => {
  const result = parseReceiptResult({
    analyzeResult: {
      documents: [{ fields: confidentFields }],
      pages: [{}],
      content: "Northwind Cafe coffee total",
    },
  });
  assert.equal(result.merchant, "Northwind Cafe");
  assert.equal(result.date, "2026-10-01");
  assert.equal(result.amount, 128.5);
  assert.equal(result.currency, "ZAR");
  assert.equal(result.tax, 16.76);
  assert.equal(result.document_number, "RC-123");
  assert.equal(result.payment_method, "Card");
  assert.equal(result.description, "Coffee and food");
  assert.deepEqual(result.review_reasons, []);
});

test("accepts scanned and multi-page results when the provider returns one reliable document", () => {
  const result = parseReceiptResult({
    analyzeResult: {
      documents: [{ fields: confidentFields }],
      pages: [{}, {}, {}],
      content: "OCR text extracted from scanned pages",
    },
  });
  assert.equal(result.review_reasons.length, 0);
});

test("requires review rather than inventing missing amount, date or currency", () => {
  const result = parseReceiptResult({
    analyzeResult: {
      documents: [
        {
          fields: {
            MerchantName: { valueString: "Northwind", confidence: 0.99 },
          },
        },
      ],
      content: "Northwind receipt",
    },
  });
  assert.equal(result.amount, null);
  assert.equal(result.date, null);
  assert.equal(result.currency, null);
  assert.ok(result.review_reasons.includes("amount_uncertain"));
  assert.ok(result.review_reasons.includes("date_uncertain"));
  assert.ok(result.review_reasons.includes("currency_uncertain"));
});

test("requires review for multiple documents or low-confidence totals", () => {
  const result = parseReceiptResult({
    analyzeResult: {
      documents: [
        { fields: confidentFields },
        { fields: confidentFields },
      ],
      content: "two document results",
    },
  });
  assert.ok(result.review_reasons.includes("multiple_documents"));
});

test("requires review when structured total fields disagree", () => {
  const result = parseReceiptResult({
    analyzeResult: {
      documents: [
        {
          fields: {
            ...confidentFields,
            InvoiceTotal: {
              valueCurrency: { amount: 140, currencyCode: "ZAR" },
              confidence: 0.91,
            },
          },
        },
      ],
      content: "receipt with conflicting totals",
    },
  });
  assert.ok(result.review_reasons.includes("multiple_totals"));
});

test("detects bank statements and never marks them for automatic expense creation", () => {
  const result = parseReceiptResult({
    analyzeResult: {
      documents: [{ fields: confidentFields }],
      content: "Bank statement Opening balance Debit Credit Closing balance",
    },
  });
  assert.equal(result.is_bank_statement, true);
  assert.ok(result.review_reasons.includes("bank_statement"));
});

test("matches likely duplicate merchants without matching unrelated names", () => {
  assert.equal(
    isDuplicateMerchant("Café Northwind", [{ merchant: "Cafe Northwind" }]),
    true,
  );
  assert.equal(
    isDuplicateMerchant("Northwind Cafe", [{ merchant: "Northwind Fuel" }]),
    false,
  );
});

test("suggests only an unambiguous category already present in the workspace", () => {
  const categories = [
    { id: "meals", name: "Meals" },
    { id: "travel", name: "Travel" },
  ];
  assert.equal(
    suggestReceiptCategory(
      { merchant: "Northwind Cafe", description: "Coffee and food" },
      categories,
    ),
    "meals",
  );
  assert.equal(
    suggestReceiptCategory(
      { merchant: "Unknown Supplier", description: null },
      categories,
    ),
    null,
  );
});

test("rejects unsupported, mismatched and oversized receipt bytes", () => {
  assert.throws(
    () => validateReceiptContent("text/csv", Buffer.from("statement")),
    /unsupported_receipt_file/,
  );
  assert.throws(
    () =>
      validateReceiptContent(
        "application/pdf",
        Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      ),
    /unsupported_receipt_file/,
  );
  assert.throws(
    () =>
      validateReceiptContent(
        "application/pdf",
        new Uint8Array(5 * 1024 * 1024 + 1),
      ),
    /receipt_too_large/,
  );
  assert.equal(
    validateReceiptContent(
      "image/png",
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ),
    "image/png",
  );
});
