import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useBusiness } from "../contexts/BusinessContext";
import {
  total,
  money,
  currencies,
  currencyOf,
  type Currency,
} from "../lib/finance";
export default function Dashboard() {
  const { expenses, categories, business } = useBusiness();
  const [currency, setCurrency] = useState<Currency>(
    (business.currency as Currency) || "ZAR",
  );
  const selected = expenses.filter((e) => currencyOf(e) === currency);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const current = selected.filter((e) => e.date.startsWith(month));
  const chart = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      name: d.toLocaleDateString("en-ZA", { month: "short" }),
      total: total(selected.filter((e) => e.date.startsWith(key))),
    };
  });
  return (
    <div className="space-y-7">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Business at a glance</p>
          <h1>Your spending, in focus.</h1>
          <p className="text-slate-500 mt-2">Welcome to {business.name}.</p>
        </div>
        <Link className="secondary" to="/expenses">
          View expenses →
        </Link>
      </div>
      <label className="max-w-xs">
        Reporting currency
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value as Currency)}
        >
          {currencies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-slate-500">
        Totals are grouped by original currency. No exchange-rate conversion is
        applied.
      </p>
      <div className="grid sm:grid-cols-3 gap-5">
        {[
          [
            "All-time expenses",
            money(total(selected), currency),
            `${selected.length} recorded transactions in ${currency}`,
          ],
          [
            "This month",
            money(total(current), currency),
            `${current.length} transactions this month`,
          ],
          [
            "Pending review",
            String(selected.filter((e) => e.status === "Pending").length),
            "Keep your ledger up to date",
          ],
        ].map(([title, value, sub]) => (
          <section className="panel" key={title}>
            <p className="text-sm text-slate-500">{title}</p>
            <p className="text-3xl font-semibold tabular-nums mt-4">{value}</p>
            <p className="text-xs text-slate-400 mt-3">{sub}</p>
          </section>
        ))}
      </div>
      <div className="grid lg:grid-cols-5 gap-6">
        <section className="panel lg:col-span-3 min-w-0">
          <h2>Spending overview</h2>
          <p className="text-sm text-slate-500 mt-1">
            Your last six months in {currency}
          </p>
          <div className="h-72 mt-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid vertical={false} stroke="#eef2f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis width={65} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => money(Number(v), currency)} />
                <Bar dataKey="total" fill="#7c3aed" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel lg:col-span-2">
          <h2>Recent activity</h2>
          {expenses.slice(0, 5).map((e) => (
            <div
              key={e.id}
              className="flex justify-between gap-3 py-5 border-b border-slate-100"
            >
              <div>
                <p className="font-medium">{e.merchant}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {categories.find((c) => c.id === e.category_id)?.name ??
                    "Uncategorised"}{" "}
                  · {e.date}
                </p>
              </div>
              <span className="text-sm tabular-nums">
                {money(Number(e.amount), currencyOf(e))}
              </span>
            </div>
          ))}
          {!expenses.length && (
            <p className="empty">Your first expense will appear here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
