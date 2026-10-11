export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_CONFIDENCE_THRESHOLD = 0.85;

export type ReceiptCurrency = "ZAR" | "USD" | "EUR";

export type ReceiptExtraction = {
  merchant: string | null;
  date: string | null;
  amount: number | null;
  currency: ReceiptCurrency | null;
  tax: number | null;
  document_number: string | null;
  description: string | null;
  payment_method: string | null;
  confidence: {
    merchant: number | null;
    date: number | null;
    amount: number | null;
    currency: number | null;
  };
  review_reasons: string[];
  is_bank_statement: boolean;
};

type DocumentField = {
  valueString?: unknown;
  valueDate?: unknown;
  valueNumber?: unknown;
  valueCurrency?: {
    amount?: unknown;
    currencyCode?: unknown;
  };
  valueArray?: Array<{ valueObject?: Record<string, DocumentField> }>;
  confidence?: unknown;
};

type DocumentResult = {
  analyzeResult?: {
    content?: unknown;
    documents?: Array<{ fields?: Record<string, DocumentField> }>;
    pages?: unknown[];
  };
};

function field(
  fields: Record<string, DocumentField>,
  ...names: string[]
): DocumentField | undefined {
  for (const name of names) {
    if (fields[name]) return fields[name];
  }
  return undefined;
}

function fieldText(value?: DocumentField): string | null {
  const result = value?.valueString;
  return typeof result === "string" && result.trim()
    ? result.trim().slice(0, 500)
    : null;
}

function fieldConfidence(value?: DocumentField): number | null {
  const confidence = value?.confidence;
  return typeof confidence === "number" &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
    ? confidence
    : null;
}

function currencyCode(value: unknown): ReceiptCurrency | null {
  return value === "ZAR" || value === "USD" || value === "EUR"
    ? value
    : null;
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

function fieldAmount(value?: DocumentField): number | null {
  const amount = value?.valueCurrency?.amount ?? value?.valueNumber;
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 99_999_999.99 ||
    Math.abs(Math.round(amount * 100) - amount * 100) > 1e-7
  )
    return null;
  return amount;
}

function isBankStatement(text: string): boolean {
  const hasStatementLabel =
    /\b(?:bank|account)\s+statement\b|\bstatement\s+period\b/i.test(text);
  const hasBalancesOrMovements =
    /\b(?:opening|closing|available)\s+balance\b|\b(?:debit|credit)\b/i.test(
      text,
    );
  return hasStatementLabel && hasBalancesOrMovements;
}

export function parseReceiptResult(
  result: DocumentResult,
): ReceiptExtraction {
  const analysis = result.analyzeResult;
  const documents = analysis?.documents ?? [];
  const fields = documents[0]?.fields ?? {};
  const merchantField = field(fields, "MerchantName", "VendorName");
  const dateField = field(fields, "TransactionDate", "InvoiceDate");
  const totalField = field(fields, "Total", "InvoiceTotal", "AmountDue");
  const taxField = field(fields, "TotalTax", "Tax");
  const totalCurrency = currencyCode(totalField?.valueCurrency?.currencyCode);
  const currencyConfidence = fieldConfidence(totalField);
  const merchant = fieldText(merchantField);
  const date = normalizeDate(dateField?.valueDate);
  const amount = fieldAmount(totalField);
  const totalCandidates = ["Total", "InvoiceTotal", "AmountDue"]
    .map((name) => fieldAmount(fields[name]))
    .filter((candidate): candidate is number => candidate !== null);
  const currency = totalCurrency;
  const tax = fieldAmount(taxField);
  const invoiceNumber = fieldText(field(fields, "ReceiptNumber", "InvoiceId"));
  const paymentMethod = fieldText(field(fields, "PaymentMethod"));
  const itemDescriptions = (field(fields, "Items")?.valueArray ?? [])
    .map((item) => fieldText(item.valueObject?.Description))
    .filter((description): description is string => !!description);
  const content =
    typeof analysis?.content === "string" ? analysis.content.slice(0, 200_000) : "";
  const isStatement = isBankStatement(content);
  const confidence = {
    merchant: fieldConfidence(merchantField),
    date: fieldConfidence(dateField),
    amount: fieldConfidence(totalField),
    currency: currencyConfidence,
  };
  const reviewReasons: string[] = [];

  if (documents.length !== 1) reviewReasons.push("multiple_documents");
  if (new Set(totalCandidates).size > 1)
    reviewReasons.push("multiple_totals");
  if (!merchant || (confidence.merchant ?? 0) < RECEIPT_CONFIDENCE_THRESHOLD)
    reviewReasons.push("merchant_uncertain");
  if (!date || (confidence.date ?? 0) < RECEIPT_CONFIDENCE_THRESHOLD)
    reviewReasons.push("date_uncertain");
  if (!amount || (confidence.amount ?? 0) < RECEIPT_CONFIDENCE_THRESHOLD)
    reviewReasons.push("amount_uncertain");
  if (!currency || (confidence.currency ?? 0) < RECEIPT_CONFIDENCE_THRESHOLD)
    reviewReasons.push("currency_uncertain");
  if (isStatement) reviewReasons.push("bank_statement");

  return {
    merchant,
    date,
    amount,
    currency,
    tax,
    document_number: invoiceNumber,
    description: itemDescriptions.length
      ? itemDescriptions.join(", ").slice(0, 2000)
      : null,
    payment_method: paymentMethod,
    confidence,
    review_reasons: [...new Set(reviewReasons)],
    is_bank_statement: isStatement,
  };
}

export function validateReceiptContent(
  contentType: string,
  content: Uint8Array,
): "application/pdf" | "image/jpeg" | "image/png" {
  if (content.byteLength > RECEIPT_MAX_BYTES)
    throw new Error("receipt_too_large");

  const bytes = [...content.slice(0, 8)];
  if (
    contentType === "application/pdf" &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  )
    return contentType;
  if (
    contentType === "image/jpeg" &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return contentType;
  if (
    contentType === "image/png" &&
    bytes.join(",") === "137,80,78,71,13,10,26,10"
  )
    return contentType;
  throw new Error("unsupported_receipt_file");
}

export function isDuplicateMerchant(
  merchant: string,
  candidates: Array<{ merchant: string }>,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("en")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const expected = normalize(merchant);
  return candidates.some((candidate) => normalize(candidate.merchant) === expected);
}

export function suggestReceiptCategory(
  extraction: Pick<ReceiptExtraction, "merchant" | "description">,
  categories: Array<{ id: string; name: string }>,
): string | null {
  const text = `${extraction.merchant ?? ""} ${extraction.description ?? ""}`
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en");
  const aliases: Record<string, string[]> = {
    meals: ["food", "restaurant", "cafe", "coffee", "grocery", "dining"],
    travel: ["hotel", "airfare", "taxi", "rideshare", "fuel", "parking"],
    software: ["software", "subscription", "cloud", "hosting", "saas"],
    supplies: ["office", "stationery", "supplies", "equipment"],
    utilities: ["electricity", "water", "internet", "utility", "utilities"],
  };
  const matches = categories
    .map((category) => {
      const name = category.name.toLocaleLowerCase("en");
      const nameTokens = name.match(/[a-z0-9]+/g) ?? [];
      const aliasTokens = aliases[name] ?? [];
      const terms = [...new Set([...nameTokens, ...aliasTokens])];
      return {
        id: category.id,
        score: terms.filter((term) => {
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`\\b${escaped}\\b`, "i").test(text);
        }).length,
      };
    })
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!matches.length || matches[0].score === matches[1]?.score) return null;
  return matches[0].id;
}
