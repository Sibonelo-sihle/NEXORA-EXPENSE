import { useState } from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { useBusiness } from "../contexts/BusinessContext";
import {
  money,
  total,
  exportCSV,
  currencies,
  currencyOf,
  type Currency,
} from "../lib/finance";
export default function Reports() {
  const { expenses, categories, business } = useBusiness();
  const [currency, setCurrency] = useState<Currency>(
    (business.currency as Currency) || "ZAR",
  );
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const rows = expenses.filter(
    (e) =>
      currencyOf(e) === currency &&
      (!from || e.date >= from) &&
      (!to || e.date <= to),
  );
  const groups = [
    ...categories,
    { id: null, name: "Uncategorised", color: "#94a3b8" },
  ]
    .map((c) => ({
      ...c,
      value: total(rows.filter((e) => e.category_id === c.id)),
    }))
    .filter((c) => c.value > 0);
  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Understand your spending</p>
          <h1>Reports</h1>
        </div>
        <button
          className="secondary"
          onClick={() => exportCSV(rows, categories)}
        >
          Export CSV
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Report totals use the selected original currency; no automatic
        conversion is applied.
      </p>
      <div className="panel flex flex-wrap gap-4">
        <label>
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
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            min={from}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <div className="ml-auto self-center">
          <p className="text-xs text-slate-500">
            Selected period · {rows.length} expenses
          </p>
          <p className="text-2xl font-semibold mt-2">
            {money(total(rows), currency)}
          </p>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <section className="panel">
          <h2>Spending by category</h2>
          {groups.length ? (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={groups}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={75}
                    outerRadius={110}
                  >
                    {groups.map((c) => (
                      <Cell key={c.name} fill={c.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v), currency)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="empty">No expenses in this period.</p>
          )}
        </section>
        <section className="panel">
          <h2>Category breakdown</h2>
          {groups.map((c) => (
            <div
              key={c.name}
              className="flex justify-between py-5 border-b border-slate-100"
            >
              <span className="flex gap-3 items-center">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ background: c.color }}
                />
                {c.name}
              </span>
              <span className="tabular-nums">{money(c.value, currency)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
