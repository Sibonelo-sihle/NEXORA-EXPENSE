import { Outlet, NavLink, Link } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { BusinessProvider, useBusiness } from "../../contexts/BusinessContext";
import { Brand } from "../Brand";
import {
  LayoutDashboard,
  Receipt,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
const items = [
  ["Dashboard", "/dashboard", LayoutDashboard],
  ["Expenses", "/expenses", Receipt],
  ["Receipts", "/receipts", FileText],
  ["Reports", "/reports", FileText],
  ["Settings & billing", "/settings", Settings],
] as const;
function Shell() {
  const { signOut, user, isDemo } = useAuth();
  const { business, access, error, loading, refresh } = useBusiness();
  const [open, setOpen] = useState(false),
    [logoutError, setLogoutError] = useState("");
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="md:hidden bg-white border-b p-4 flex items-center justify-between">
        <Brand />
        <button
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </header>
      <aside
        className={`${open ? "flex" : "hidden"} md:flex fixed top-[73px] md:top-0 bottom-0 left-0 w-64 bg-white border-r border-slate-200 z-40 flex-col p-5`}
      >
        <div className="hidden md:block py-4 mb-8">
          <Brand />
        </div>
        <p className="text-xs uppercase tracking-widest text-slate-400 px-3 mb-3">
          Workspace
        </p>
        <nav className="space-y-2 flex-1">
          {items.map(([name, path, Icon]) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium ${isActive ? "bg-violet-50 text-violet-700" : "text-slate-500 hover:bg-slate-50"}`
              }
            >
              <Icon size={19} />
              {name}
            </NavLink>
          ))}
        </nav>
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500 mb-4">
          Software for a Better Tomorrow.
          <p className="mt-2 text-violet-700 font-semibold">
            Powered by NEXORA LABS
          </p>
        </div>
        <button
          className="flex items-center gap-3 text-sm p-3"
          onClick={() => signOut().catch((e) => setLogoutError(e.message))}
        >
          <LogOut size={18} />
          Sign out
        </button>
        {logoutError && (
          <p role="alert" className="error">
            {logoutError}
          </p>
        )}
      </aside>
      <main className="md:ml-64 min-w-0">
        <header className="hidden md:flex justify-between items-center px-10 py-5 border-b border-slate-200 bg-white">
          <span className="font-semibold">
            {business?.name ?? "Your workspace"}
          </span>
          <span className="text-sm text-slate-500">{user?.email}</span>
        </header>
        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-10">
          {isDemo && (
            <div className="notice mb-6" role="status">
              <strong>DEMO MODE</strong> — Local, read-only preview with sample
              data. No real account, trial or payment is created.
            </div>
          )}
          {access && (
            <div className="mb-6 rounded-xl border border-violet-100 bg-violet-50 p-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>
                {access.trial_days > 0
                  ? `${access.trial_days} days remaining in your free trial`
                  : access.can_write
                    ? "Your subscription is active"
                    : "Your workspace is read-only. Your data is retained and available to export."}
              </span>
              <Link className="font-semibold text-violet-700" to="/settings">
                Billing · USD plans →
              </Link>
            </div>
          )}
          {error ? (
            <div className="error" role="alert">
              {error}
              <button className="secondary ml-3" onClick={refresh}>
                Retry
              </button>
            </div>
          ) : loading ? (
            <p role="status">Loading your workspace…</p>
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  );
}
export const AppLayout = () => (
  <BusinessProvider>
    <Shell />
  </BusinessProvider>
);
