import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useBusiness } from "../contexts/BusinessContext";
import { db, check } from "../lib/supabase";
import { apiURL } from "../lib/api";
import { exportCSV, currencies } from "../lib/finance";
import { formatUsdCents, subscriptionPlans } from "../lib/pricing";
async function billing(action: string) {
  const { data } = await db().auth.getSession();
  const response = await fetch(apiURL(`/api/billing/${action}`), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session?.access_token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Billing unavailable");
  return result;
}
export default function Settings() {
  const { user, isDemo } = useAuth();
  const { business, access, categories, expenses, refresh } = useBusiness();
  const [defaultCurrency, setDefaultCurrency] = useState(
    business.currency || "ZAR",
  );
  const [name, setName] = useState(user?.user_metadata.full_name ?? ""),
    [businessName, setBusinessName] = useState(business.name),
    [categoryName, setCategoryName] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmCancel, setConfirmCancel] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  useEffect(() => {
    if (isDemo) return;
    db()
      .from("payment_events")
      .select(
        "provider_payment_id,received_at,billing_orders!inner(amount,mode)",
      )
      .order("received_at", { ascending: false })
      .limit(12)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setPayments(data ?? []);
      });
  }, [access?.paid_until]);
  const [paymentInfo, setPaymentInfo] = useState<{
    usdCheckoutEnabled: boolean;
  } | null>(null);
  useEffect(() => {
    if (isDemo) return;
    fetch(apiURL("/api/health"))
      .then((r) => r.json())
      .then((data) =>
        setPaymentInfo({
          usdCheckoutEnabled: data.usdCheckoutEnabled === true,
        }),
      )
      .catch(() =>
        setPaymentInfo({
          usdCheckoutEnabled: false,
        }),
      );
  }, []);
  useEffect(() => {
    if (isDemo) return;
    db()
      .from("profiles")
      .select("full_name")
      .eq("id", user!.id)
      .single()
      .then(({ data }) => {
        if (data?.full_name) setName(data.full_name);
      });
  }, [user?.id]);
  async function action(fn: () => Promise<void>) {
    if (isDemo) {
      setError(
        "DEMO MODE is read-only. Configure Supabase to save changes or manage a subscription.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage("Changes saved.");
      await refresh();
    } catch (e) {
      setError((e as any).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Your workspace preferences</p>
        <h1>Settings & billing</h1>
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
      <div className="grid lg:grid-cols-2 gap-6">
        <form
          className="panel space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              check(
                await db().from("profiles").upsert({
                  id: user!.id,
                  full_name: name,
                  updated_at: new Date().toISOString(),
                }),
              );
            });
          }}
        >
          <h2>Profile details</h2>
          <label>
            Full name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Email
            <input type="email" disabled value={user?.email ?? ""} />
          </label>
          <button className="primary" disabled={busy || isDemo}>
            Save profile
          </button>
        </form>
        <form
          className="panel space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              check(
                await db()
                  .from("businesses")
                  .update({ name: businessName, currency: defaultCurrency })
                  .eq("id", business.id),
              );
            });
          }}
        >
          <h2>Business information</h2>
          <label>
            Business name
            <input
              required
              maxLength={120}
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </label>
          <label>
            Currency
            <select
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
              disabled={isDemo}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Default for new expenses; existing records retain their currency.
              Subscription prices are in USD and do not change this setting.
            </span>
          </label>
          <button className="primary" disabled={busy || isDemo}>
            Save business
          </button>
        </form>
      </div>
      <section className="space-y-6">
        <div>
          <h2>Monthly plans</h2>
          <p className="mt-2 text-sm text-slate-500">
            30-day free trial, then choose a monthly plan billed in USD. Annual
            billing is not available.
          </p>
        </div>
        <div className="grid lg:grid-cols-3 gap-5 items-stretch">
          {subscriptionPlans.map((plan) => (
            <article
              className={`panel relative flex flex-col !p-6 ${plan.recommended ? "border-2 border-violet-500 shadow-lg shadow-violet-100" : ""}`}
              key={plan.id}
              aria-label={`${plan.name} plan`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-1 text-xs font-semibold text-white">
                  Recommended
                </span>
              )}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-slate-500">
                {plan.audience}
              </p>
              <p className="mt-4 text-3xl font-bold">
                {formatUsdCents(plan.amountCents)}
                <span className="text-sm font-normal text-slate-500">
                  {" "}
                  / month
                </span>
              </p>
              <ul className="my-5 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li className="text-sm text-slate-600" key={feature}>
                    <span className="mr-2 text-violet-600" aria-hidden="true">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                className={
                  plan.recommended ? "primary w-full" : "secondary w-full"
                }
                type="button"
                disabled={!paymentInfo?.usdCheckoutEnabled || busy}
                title="USD subscription checkout is unavailable until a USD-capable provider and billing records are verified."
              >
                {paymentInfo?.usdCheckoutEnabled
                  ? `Choose ${plan.name}`
                  : "USD checkout unavailable"}
              </button>
            </article>
          ))}
        </div>
        <p className="notice">
          USD subscriptions are not enabled yet. No plan selection or payment
          will be submitted until a USD-capable payment provider and matching
          billing records are verified. PayFast checkout is disabled for these
          USD plans. Paid-plan entitlements, including report tiers, team
          access, priority support and storage differences, are not available
          until implemented.
        </p>
      </section>
      <section className="panel">
        <div className="page-heading">
          <div>
            <h2>NEXORA Expense subscription</h2>
          </div>
          <span className="badge-pending">
            {access?.trial_days
              ? `${access.trial_days} trial days remaining`
              : access?.can_write
                ? "Paid access active"
                : "Read-only access"}
          </span>
        </div>
        <p className="notice mt-4">
          Subscription checkout is unavailable while USD settlement and plan
          billing records are being verified. Your trial access and existing
          billing history remain available.
        </p>
        <p className="text-slate-500 text-sm mt-5">
          First 30 days free, with no card required. Monthly USD subscriptions
          will be available after payment and billing integration verification.
          Cancellation of an existing subscription stops future renewals; paid
          access remains available until the end of its paid period.
        </p>
        <p className="text-sm mt-4">
          Trial ends:{" "}
          {access?.trial_ends_at
            ? new Date(access.trial_ends_at).toLocaleDateString("en-ZA")
            : "—"}{" "}
          · Paid through:{" "}
          {access?.paid_until
            ? new Date(access.paid_until).toLocaleDateString("en-ZA")
            : "—"}
        </p>
        {access?.cancel_at_period_end && (
          <p className="notice mt-4">Renewal has been cancelled.</p>
        )}
        <p className="text-sm text-slate-500 mt-3">
          After expiry you can sign in, view billing, download receipts and
          export data. Your records are never automatically deleted.
        </p>
        <div className="flex flex-wrap gap-3 mt-5">
          <button
            className="secondary"
            disabled={busy || isDemo || !access?.has_subscription}
            onClick={() => setConfirmCancel(true)}
          >
            Cancel renewal
          </button>
          <button
            className="secondary"
            onClick={() => exportCSV(expenses, categories)}
          >
            Export all expenses
          </button>
        </div>
        <div className="mt-6 pt-5 border-t border-slate-100">
          <h3 className="text-sm font-semibold">Recent payments</h3>
          {payments.length ? (
            payments.map((p) => (
              <div
                key={p.provider_payment_id}
                className="flex flex-wrap justify-between gap-3 text-sm py-3 border-b border-slate-100"
              >
                <span>
                  {new Date(p.received_at).toLocaleDateString("en-ZA")} ·{" "}
                  {p.billing_orders.mode === "sandbox"
                    ? "Test payment"
                    : "Payment received"}
                </span>
                <span>
                  Legacy ZAR {Number(p.billing_orders.amount).toFixed(2)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500 mt-3">No payments recorded.</p>
          )}
        </div>
        {confirmCancel && (
          <div
            className="notice mt-4"
            role="alertdialog"
            aria-label="Cancel subscription"
          >
            <p>
              Stop all future renewals? Your paid access will remain until the
              date shown above.
            </p>
            <div className="flex gap-3 mt-3">
              <button
                className="secondary"
                disabled={busy || isDemo}
                onClick={() =>
                  action(async () => {
                    await billing("cancel");
                    setConfirmCancel(false);
                  })
                }
              >
                Confirm cancellation
              </button>
              <button
                className="secondary"
                onClick={() => setConfirmCancel(false)}
              >
                Keep subscription
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Expense categories</h2>
        <form
          className="flex flex-wrap gap-3 mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            action(async () => {
              check(
                await db().from("categories").insert({
                  business_id: business.id,
                  name: categoryName.trim(),
                  color: "#7c3aed",
                }),
              );
              setCategoryName("");
            });
          }}
        >
          <input
            className="!w-auto flex-1"
            aria-label="New category name"
            required
            maxLength={80}
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            placeholder="New category"
          />
          <button
            className="primary"
            disabled={busy || isDemo || !access?.can_write}
          >
            Add category
          </button>
        </form>
        <div className="mt-4 space-y-2">
          {categories.map((c) => (
            <div
              className="flex justify-between gap-3 border-b border-slate-100 py-3"
              key={c.id}
            >
              <span>{c.name}</span>
              <div className="flex gap-4">
                <button
                  className="text-sm text-violet-700"
                  disabled={busy || isDemo || !access?.can_write}
                  onClick={() => {
                    const value = prompt("Category name", c.name);
                    if (value?.trim())
                      action(async () => {
                        check(
                          await db()
                            .from("categories")
                            .update({ name: value.trim().slice(0, 80) })
                            .eq("id", c.id),
                        );
                      });
                  }}
                >
                  Rename
                </button>
                <button
                  className="text-sm text-red-700"
                  disabled={
                    busy ||
                    !access?.can_write ||
                    expenses.some((e) => e.category_id === c.id)
                  }
                  onClick={() =>
                    action(async () => {
                      check(
                        await db().from("categories").delete().eq("id", c.id),
                      );
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-4">
          Categories used by expenses must be reassigned before deletion.
        </p>
      </section>
    </div>
  );
}
