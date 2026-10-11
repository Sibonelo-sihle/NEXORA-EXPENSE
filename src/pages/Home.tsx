import { Link } from "react-router-dom";
import {
  Receipt,
  ShieldCheck,
  ChartColumn,
  ArrowRight,
  Check,
} from "lucide-react";
import { formatUsdCents, subscriptionPlans } from "../lib/pricing";
export default function Home() {
  return (
    <div>
      <section className="relative overflow-hidden bg-[#080a1c] text-white">
        <div className="absolute inset-0 hero-glow" />
        <div className="relative max-w-7xl mx-auto px-6 py-20 lg:py-28 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="inline-flex rounded-full border border-violet-400/30 bg-violet-500/10 text-violet-200 text-xs tracking-widest px-4 py-2 mb-7">
              BUILT FOR SOUTH AFRICAN BUSINESSES
            </p>
            <h1 className="!text-white !text-5xl sm:!text-6xl !leading-[1.08]">
              Big ambitions.
              <br />
              <span className="text-violet-400">Clearer expenses.</span>
            </h1>
            <p className="text-slate-300 text-lg leading-relaxed mt-6 max-w-lg">
              Bring your expenses, receipts and reports into one beautifully
              simple workspace. Make room for what comes next.
            </p>
            <div className="flex flex-wrap gap-4 mt-9">
              <Link
                className="primary inline-flex gap-3 items-center"
                to="/signup"
              >
                Start your 30-day free trial <ArrowRight size={18} />
              </Link>
              <a
                href="#features"
                className="px-5 py-3 rounded-xl border border-white/20"
              >
                Explore features
              </a>
            </div>
            <p className="text-slate-400 text-sm mt-5">
              Free for 30 days · Monthly plans in USD · No card required
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#101227] p-6 sm:p-8 shadow-2xl">
            <div className="flex items-center gap-3">
              <img
                src="/nexora-symbol-dark.png"
                alt="Official NEXORA symbol"
                className="w-12 rounded-lg"
              />
              <img
                src="/nexora-wordmark-dark.png"
                alt="NEXORA"
                className="w-40"
              />
              <span className="ml-auto text-[10px] text-slate-400">
                Illustrative preview
              </span>
            </div>
            <div className="border-t border-white/10 mt-6 pt-6">
              <p className="text-sm text-slate-400">Monthly spending</p>
              <p className="text-4xl font-semibold mt-3 tabular-nums">
                R 2,290<span className="text-xl text-slate-400">.00</span>
              </p>
            </div>
            <div
              className="flex items-end gap-4 h-36 border-b border-white/10 py-4 mt-4"
              aria-label="Example spending chart"
            >
              {[35, 60, 45, 80, 55, 70].map((height, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-md bg-gradient-to-t from-violet-700 to-violet-400"
                  style={{ height: height + "%" }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-3">
              <span>May</span>
              <span>October</span>
            </div>
            <div className="mt-6 rounded-xl bg-white/5 p-4 flex justify-between items-center">
              <div className="flex gap-3 items-center">
                <Receipt className="text-violet-400" size={20} />
                <div>
                  <p className="text-sm font-medium">Office supplies</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Receipt attached
                  </p>
                </div>
              </div>
              <p className="text-sm tabular-nums">R 690.00</p>
            </div>
            <p className="text-violet-200 text-xs mt-6 tracking-wide">
              Software for a Better Tomorrow.
            </p>
          </div>
        </div>
      </section>
      <section id="features" className="max-w-7xl mx-auto px-6 py-20">
        <p className="eyebrow">A better way to work</p>
        <h2 className="!text-3xl mt-3">Everything your expenses need.</h2>
        <div className="grid md:grid-cols-3 gap-6 mt-10">
          {[
            [
              Receipt,
              "Receipts, without the paperwork",
              "Keep proofs of payment in a private business library and attach them to your expenses.",
            ],
            [
              ChartColumn,
              "Numbers that make sense",
              "Understand spending by category and period. Export a clean CSV for your accountant.",
            ],
            [
              ShieldCheck,
              "Your business. Your records.",
              "Secure authentication and business-level access controls keep your workspace private.",
            ],
          ].map(([Icon, title, desc]) => (
            <div className="panel" key={String(title)}>
              <span className="inline-flex p-3 rounded-xl bg-violet-50 text-violet-600 mb-6">
                {typeof Icon !== "string" && <Icon size={25} />}
              </span>
              <h3 className="font-semibold text-xl">{String(title)}</h3>
              <p className="text-slate-500 leading-relaxed mt-3">
                {String(desc)}
              </p>
            </div>
          ))}
        </div>
      </section>
      <section
        id="how-it-works"
        className="bg-slate-50 border-y border-slate-100"
      >
        <div className="max-w-7xl mx-auto px-6 py-16 grid md:grid-cols-3 gap-8">
          {[
            [
              "01",
              "Create your workspace",
              "Verify your email and start your free trial.",
            ],
            [
              "02",
              "Capture your expenses",
              "Add transactions, categories and receipts.",
            ],
            [
              "03",
              "See the bigger picture",
              "Review your dashboard and export your records.",
            ],
          ].map(([n, t, d]) => (
            <div key={n}>
              <p className="text-violet-600 font-mono mb-3">{n}</p>
              <h3 className="font-semibold">{t}</h3>
              <p className="text-slate-500 text-sm mt-2">{d}</p>
            </div>
          ))}
        </div>
      </section>
      <section
        id="pricing"
        className="max-w-7xl mx-auto px-6 py-20 text-center"
      >
        <p className="eyebrow">Plans for every stage</p>
        <h2 className="!text-3xl mt-3">
          Choose the right plan for your business.
        </h2>
        <p className="mt-4 text-slate-500">
          Start with a free 30-day trial. No card required.
        </p>
        <div className="grid lg:grid-cols-3 gap-6 mt-10 text-left items-stretch">
          {subscriptionPlans.map((plan) => (
            <article
              className={`panel relative flex flex-col !p-7 ${plan.recommended ? "border-2 border-violet-500 shadow-xl shadow-violet-100" : ""}`}
              key={plan.id}
              aria-label={`${plan.name} plan`}
            >
              {plan.recommended && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-4 py-1 text-xs font-semibold text-white">
                  Recommended
                </span>
              )}
              <p className="text-xl font-semibold text-slate-900">
                {plan.name}
              </p>
              <p className="mt-2 min-h-6 text-sm text-slate-500">
                {plan.audience}
              </p>
              <p className="mt-6 text-4xl font-bold text-slate-950">
                {formatUsdCents(plan.amountCents)}
                <span className="text-base font-normal text-slate-500">
                  {" "}
                  / month
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Billed monthly in USD
              </p>
              <ul className="my-7 flex-1 space-y-4">
                {plan.features.map((feature) => (
                  <li
                    className="flex gap-3 text-sm text-slate-600"
                    key={feature}
                  >
                    <Check size={18} className="shrink-0 text-violet-600" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                className={
                  plan.recommended
                    ? "primary block text-center"
                    : "secondary block text-center"
                }
                to={`/signup?plan=${plan.id}`}
              >
                Start 30-day free trial
              </Link>
            </article>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Annual billing is not available. USD subscription checkout is being
          prepared and is not yet enabled. Paid-plan entitlements, including
          report tiers, team access, priority support and storage differences,
          are not available yet.
        </p>
      </section>
    </div>
  );
}
