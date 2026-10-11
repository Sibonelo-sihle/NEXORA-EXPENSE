import { useState, useEffect } from "react";
import { useBusiness, type Expense } from "../contexts/BusinessContext";
import { db, check } from "../lib/supabase";
import { listReceipts, uploadReceipt, receiptName } from "../lib/receipts";
import {
  money,
  exportCSV,
  totalsText,
  currencies,
  currencyOf,
  expenseAmount,
} from "../lib/finance";
const initial = {
  merchant: "",
  amount: "",
  currency: "ZAR",
  date: new Date().toLocaleDateString("en-CA"),
  category_id: "",
  description: "",
  status: "Pending",
  receipt_url: "",
};
export default function Expenses() {
  const { business, expenses, categories, access, refresh } = useBusiness();
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [form, setForm] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<any[]>([]);
  useEffect(() => {
    if (editing)
      listReceipts(business.id)
        .then(setReceipts)
        .catch((e) => setError(e.message));
  }, [editing, business.id]);
  async function attach(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const receipt_url = await uploadReceipt(business.id, file);
      setForm((f) => ({ ...f, receipt_url }));
      setReceipts(await listReceipts(business.id));
    } catch (e) {
      setError((e as any).message);
    } finally {
      setBusy(false);
    }
  }
  const [currencyFilter, setCurrencyFilter] = useState("");
  const filtered = expenses.filter(
    (e) =>
      e.merchant.toLowerCase().includes(search.toLowerCase()) &&
      (!category || e.category_id === category) &&
      (!currencyFilter || currencyOf(e) === currencyFilter),
  );
  function edit(e: Expense) {
    setEditing(e.id);
    setForm({
      ...e,
      currency: currencyOf(e),
      amount: String(e.amount),
      category_id: e.category_id ?? "",
      receipt_url: e.receipt_url ?? "",
    });
    setError("");
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        merchant: form.merchant,
        description: form.description,
        status: form.status,
        date: form.date,
        amount: expenseAmount(form.amount),
        currency: form.currency,
        category_id: form.category_id || null,
        receipt_url: form.receipt_url || null,
        business_id: business.id,
      };
      check(
        editing === "new"
          ? await db().from("expenses").insert(payload)
          : await db()
              .from("expenses")
              .update(payload)
              .eq("id", editing)
              .eq("business_id", business.id),
      );
      setEditing(null);
      await refresh();
    } catch (e) {
      setError((e as any).message);
    } finally {
      setBusy(false);
    }
  }
  async function destroy() {
    setBusy(true);
    try {
      check(
        await db()
          .from("expenses")
          .delete()
          .eq("id", remove)
          .eq("business_id", business.id),
      );
      setRemove(null);
      await refresh();
    } catch (e) {
      setError((e as any).message);
    } finally {
      setBusy(false);
    }
  }
  const field =
    (key: keyof typeof initial) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setForm({ ...form, [key]: e.target.value });
  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Your business ledger</p>
          <h1>Expenses</h1>
          <p className="text-slate-500 mt-2">
            Every transaction. One clear picture.
          </p>
        </div>
        <button
          className="primary"
          disabled={!access?.can_write}
          onClick={() => {
            setEditing("new");
            setForm({ ...initial, currency: business.currency || "ZAR" });
            setError("");
          }}
        >
          + Add expense
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {editing && (
        <section className="panel">
          <h2>{editing === "new" ? "New expense" : "Edit expense"}</h2>
          <form onSubmit={save} className="grid sm:grid-cols-2 gap-4 mt-5">
            <label>
              Merchant
              <input
                required
                maxLength={200}
                value={form.merchant}
                onChange={field("merchant")}
              />
            </label>
            <label>
              Amount ({form.currency})
              <input
                type="number"
                min="0.01"
                max="99999999.99"
                step="0.01"
                required
                value={form.amount}
                onChange={field("amount")}
              />
            </label>
            <label>
              Expense currency
              <select value={form.currency} onChange={field("currency")}>
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                required
                value={form.date}
                onChange={field("date")}
              />
            </label>
            <label>
              Category
              <select value={form.category_id} onChange={field("category_id")}>
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={form.status} onChange={field("status")}>
                <option>Pending</option>
                <option>Approved</option>
              </select>
            </label>
            <label>
              Attached receipt
              <select value={form.receipt_url} onChange={field("receipt_url")}>
                <option value="">No receipt</option>
                {form.receipt_url &&
                  !receipts.some(
                    (r) => r.path === form.receipt_url,
                  ) && (
                    <option value={form.receipt_url}>
                      Previously attached receipt
                    </option>
                  )}
                {receipts.map((r) => (
                  <option
                    key={r.id ?? r.name}
                    value={r.path}
                  >
                    {receiptName(r.name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              Or upload a receipt
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                disabled={busy || !access?.can_write}
                onChange={(e) => {
                  attach(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <label className="sm:col-span-2">
              Description
              <textarea
                maxLength={2000}
                value={form.description ?? ""}
                onChange={field("description")}
              />
            </label>
            <div className="flex gap-3">
              <button className="primary" disabled={busy || !access?.can_write}>
                Save expense
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
      {remove && (
        <div
          className="panel"
          role="alertdialog"
          aria-label="Delete expense confirmation"
        >
          <p>
            Delete this expense? The receipt will remain in your receipt
            library.
          </p>
          <div className="flex gap-3 mt-4">
            <button className="primary" disabled={busy} onClick={destroy}>
              Delete expense
            </button>
            <button className="secondary" onClick={() => setRemove(null)}>
              Keep expense
            </button>
          </div>
        </div>
      )}
      <section className="panel !p-0 overflow-hidden">
        <div className="p-5 flex flex-wrap gap-3">
          <input
            className="!w-auto flex-1 min-w-40"
            aria-label="Search merchants"
            placeholder="Search merchants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="!w-auto"
            aria-label="Filter category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            className="!w-auto"
            aria-label="Filter currency"
            value={currencyFilter}
            onChange={(e) => setCurrencyFilter(e.target.value)}
          >
            <option value="">All currencies</option>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button
            className="secondary"
            onClick={() => exportCSV(filtered, categories)}
          >
            Export CSV
          </button>
        </div>
        <div className="hidden sm:block overflow-x-auto">
          <table>
            <thead>
              <tr>
                {[
                  "Date",
                  "Merchant",
                  "Category",
                  "Status",
                  "Amount",
                  "Actions",
                ].map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{e.date}</td>
                  <td className="font-semibold">{e.merchant}</td>
                  <td>
                    {categories.find((c) => c.id === e.category_id)?.name ??
                      "Uncategorised"}
                  </td>
                  <td>
                    <span
                      className={
                        e.status === "Approved"
                          ? "badge-approved"
                          : "badge-pending"
                      }
                    >
                      {e.status}
                    </span>
                  </td>
                  <td className="tabular-nums whitespace-nowrap">
                    {money(Number(e.amount), currencyOf(e))}
                  </td>
                  <td>
                    <div className="flex gap-3">
                      <button
                        disabled={!access?.can_write}
                        className="text-violet-700"
                        onClick={() => edit(e)}
                      >
                        Edit
                      </button>
                      <button
                        disabled={!access?.can_write}
                        className="text-red-700"
                        onClick={() => setRemove(e.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sm:hidden px-5">
          {filtered.map((e) => (
            <article className="py-5 border-t border-slate-100" key={e.id}>
              <div className="flex justify-between gap-4">
                <div>
                  <p className="font-semibold">{e.merchant}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {e.date} ·{" "}
                    {categories.find((c) => c.id === e.category_id)?.name ??
                      "Uncategorised"}
                  </p>
                </div>
                <p className="font-semibold tabular-nums whitespace-nowrap">
                  {money(Number(e.amount), currencyOf(e))}
                </p>
              </div>
              <div className="flex justify-between items-center mt-4">
                <span
                  className={
                    e.status === "Approved" ? "badge-approved" : "badge-pending"
                  }
                >
                  {e.status}
                </span>
                <div className="flex gap-4 text-sm">
                  <button
                    disabled={!access?.can_write}
                    className="text-violet-700"
                    onClick={() => edit(e)}
                  >
                    Edit
                  </button>
                  <button
                    disabled={!access?.can_write}
                    className="text-red-700"
                    onClick={() => setRemove(e.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty">
            No expenses yet. Start with your first transaction.
          </div>
        )}
        <div className="p-5 border-t text-sm text-slate-500">
          {filtered.length} expenses · {totalsText(filtered)}
        </div>
      </section>
    </div>
  );
}
