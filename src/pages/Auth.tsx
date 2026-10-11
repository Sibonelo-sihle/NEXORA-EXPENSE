import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db, check, supabase, authConfigurationError } from "../lib/supabase";
import { useAuth, demoAvailable } from "../contexts/AuthContext";
import { Brand } from "../components/Brand";
import { formatUsdCents, subscriptionPlans } from "../lib/pricing";
export default function Auth({
  mode,
}: {
  mode: "login" | "signup" | "forgot" | "reset";
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const navigate = useNavigate();
  const { session, loading, startDemo } = useAuth();
  const [emailValue, setEmailValue] = useState("");
  const selectedPlan = subscriptionPlans.find(
    (plan) => plan.id === new URLSearchParams(location.search).get("plan"),
  );
  useEffect(() => {
    const query = new URLSearchParams(location.search),
      hash = new URLSearchParams(location.hash.slice(1));
    const callbackError =
      query.get("error_description") || hash.get("error_description");
    setError(callbackError || "");
    setMessage("");
  }, [mode]);
  async function resend() {
    setBusy(true);
    setError("");
    try {
      check(
        await db().auth.resend({
          type: "signup",
          email: emailValue.trim(),
          options: {
            emailRedirectTo:
              (import.meta.env.VITE_APP_ORIGIN || location.origin).replace(
                /\/$/,
                "",
              ) + "/dashboard",
          },
        }),
      );
      setMessage(
        "Verification email requested. Check your inbox and spam folder.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to resend verification email",
      );
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    login: "Welcome back",
    signup: "Your business, beautifully organised",
    forgot: "Reset your password",
    reset: "Choose a new password",
  };
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim(),
      password = String(f.get("password") ?? "");
    try {
      if (mode === "login") {
        check(await db().auth.signInWithPassword({ email, password }));
        navigate("/dashboard");
      }
      if (mode === "signup") {
        const { data } = check(
          await db().auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: String(f.get("name")),
                business_name: String(f.get("business")),
              },
              emailRedirectTo:
                (import.meta.env.VITE_APP_ORIGIN || location.origin).replace(
                  /\/$/,
                  "",
                ) + "/dashboard",
            },
          }),
        );
        if (data.session) navigate("/dashboard");
        else
          setMessage("Check your email to verify your account, then sign in.");
      }
      if (mode === "forgot") {
        check(
          await db().auth.resetPasswordForEmail(email, {
            redirectTo:
              (import.meta.env.VITE_APP_ORIGIN || location.origin).replace(
                /\/$/,
                "",
              ) + "/reset-password",
          }),
        );
        setMessage("If an account exists, a recovery link has been sent.");
      }
      if (mode === "reset") {
        if (!session)
          throw new Error("Open the recovery link from your email first.");
        check(await db().auth.updateUser({ password }));
        setMessage("Password updated. You can continue to your dashboard.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to complete request",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      <aside className="hidden lg:flex auth-art flex-col justify-between p-16 text-white">
        <div className="flex items-center gap-4">
          <img
            src="/nexora-symbol-dark.png"
            alt="Official NEXORA symbol"
            className="w-16 rounded-xl"
          />
          <img src="/nexora-wordmark-dark.png" alt="NEXORA" className="w-60" />
        </div>
        <div>
          <p className="text-violet-300 text-sm tracking-widest uppercase mb-4">
            Clarity for every rand
          </p>
          <h1 className="text-5xl font-semibold leading-tight">
            Less admin.
            <br />
            More ambition.
          </h1>
          <p className="mt-6 text-slate-300">Software for a Better Tomorrow.</p>
        </div>
        <p className="text-sm text-slate-400">Powered by NEXORA LABS</p>
      </aside>
      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <Brand />
          <h1 className="text-3xl font-bold mt-10 mb-3">{titles[mode]}</h1>
          <p className="text-slate-500 mb-8">
            {mode === "signup"
              ? "30 days free. No card required. Monthly plans are priced in USD."
              : "Secure access to NEXORA Expense."}
          </p>
          {mode === "signup" && selectedPlan && (
            <p className="notice mb-6">
              Plan selected: {selectedPlan.name} at{" "}
              {formatUsdCents(selectedPlan.amountCents)} per month after your
              trial. USD subscription checkout is not enabled yet; no paid plan
              will be created.
            </p>
          )}
          {!supabase && (
            <p role="status" className="notice mb-4">
              {authConfigurationError}
            </p>
          )}
          {demoAvailable && (mode === "login" || mode === "signup") && (
            <section
              className="notice mb-6"
              aria-label="Local development demo"
            >
              <strong>DEMO MODE</strong>
              <p className="mt-2 mb-4">
                Explore a read-only workspace with sample data. No account or
                password required. Payments are disabled.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  startDemo();
                  navigate("/dashboard");
                }}
              >
                Enter DEMO MODE
              </button>
            </section>
          )}
          <form onSubmit={submit} className="space-y-5">
            {mode === "signup" && (
              <>
                <label>
                  Full name
                  <input
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Business name
                  <input
                    name="business"
                    required
                    maxLength={120}
                    autoComplete="organization"
                  />
                </label>
              </>
            )}
            {mode !== "reset" && (
              <label>
                Email address
                <input
                  name="email"
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                  type="email"
                  required
                  autoComplete="email"
                />
              </label>
            )}
            {mode !== "forgot" && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={mode === "login" ? 1 : 8}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
              </label>
            )}
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
            <button
              className="primary w-full"
              disabled={busy || loading || !supabase}
            >
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Start my free trial"
                  : mode === "forgot"
                    ? "Send recovery link"
                    : mode === "reset"
                      ? "Update password"
                      : "Sign in"}
            </button>
          </form>
          {supabase &&
            emailValue &&
            ((mode === "signup" && message) ||
              (mode === "login" && /not confirmed/i.test(error))) && (
              <button
                type="button"
                className="secondary mt-4"
                disabled={busy}
                onClick={resend}
              >
                Resend verification email
              </button>
            )}
          <div className="mt-6 flex flex-wrap justify-between gap-3 text-sm text-violet-700">
            <Link to={mode === "signup" ? "/login" : "/signup"}>
              {mode === "signup"
                ? "Already registered? Sign in"
                : "Create an account"}
            </Link>
            <Link to="/forgot-password">Forgot password?</Link>
            {message && session && <Link to="/dashboard">Continue</Link>}
          </div>
          <p className="mt-8 text-xs text-slate-500">
            Powered by NEXORA LABS · Software for a Better Tomorrow.
          </p>
        </div>
      </main>
    </div>
  );
}
