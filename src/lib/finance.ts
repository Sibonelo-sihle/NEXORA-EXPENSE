import type { Expense, Category } from "../contexts/BusinessContext";
export const currencies = ["ZAR", "USD", "EUR"] as const;
export type Currency = (typeof currencies)[number];
export function currencyOf(row: { currency?: string }): Currency {
  const value = row.currency ?? "ZAR";
  if (!currencies.includes(value as Currency))
    throw new Error("Unsupported expense currency");
  return value as Currency;
}
export function cents(value: string | number): bigint {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new Error("Amounts must have no more than two decimal places");
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function expenseAmount(value: string) {
  const minor = cents(value);
  if (minor <= 0n || minor > 9999999999n)
    throw new Error("Amount must be between 0.01 and 99999999.99");
  return `${minor / 100n}.${String(minor % 100n).padStart(2, "0")}`;
}
export const money = (amount: number, currency: Currency = "ZAR") =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    currencyDisplay: currency === "ZAR" ? "symbol" : "code",
  }).format(amount);
export function total(
  rows: { amount: number | string; currency?: string }[],
  currency?: Currency,
) {
  const selected = currency
    ? rows.filter((e) => currencyOf(e) === currency)
    : rows;
  if (new Set(selected.map(currencyOf)).size > 1)
    throw new Error(
      "Different currencies cannot be added without an explicit conversion",
    );
  const result = selected.reduce((sum, e) => sum + cents(e.amount), 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Total exceeds the safe reporting range");
  return Number(result) / 100;
}
export function totalsText(
  rows: { amount: number | string; currency?: string }[],
) {
  const present = currencies.filter((c) =>
    rows.some((e) => currencyOf(e) === c),
  );
  return (present.length ? present : ["ZAR" as const])
    .map((c) => money(total(rows, c), c))
    .join(" · ");
}
export function csv(rows: Expense[], categories: Category[]) {
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return (
    "\uFEFF" +
    [
      [
        "Date",
        "Merchant",
        "Category",
        "Description",
        "Amount",
        "Currency",
        "Status",
        "Receipt path",
      ],
      ...rows.map((e) => [
        e.date,
        e.merchant,
        categories.find((c) => c.id === e.category_id)?.name ?? "Uncategorised",
        e.description,
        expenseAmount(String(e.amount)),
        currencyOf(e),
        e.status,
        e.receipt_url,
      ]),
    ]
      .map((row) => row.map(cell).join(","))
      .join("\r\n")
  );
}
export function exportCSV(rows: Expense[], categories: Category[]) {
  const url = URL.createObjectURL(
    new Blob([csv(rows, categories)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "nexora-expenses.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
