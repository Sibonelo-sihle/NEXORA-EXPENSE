import { Outlet, Link } from "react-router-dom";
import { Brand } from "../Brand";
export const MarketingLayout = () => (
  <div className="min-h-screen">
    <header className="flex items-center justify-between gap-3 px-4 sm:px-8 py-4 border-b border-slate-100 bg-white sticky top-0 z-50">
      <Brand />
      <nav className="hidden md:flex gap-7 text-sm text-slate-500">
        <a href="#features">Features</a>
        <a href="#how-it-works">How it works</a>
        <a href="#pricing">Pricing</a>
      </nav>
      <div className="flex items-center gap-4 text-sm">
        <Link to="/login">Log in</Link>
        <Link className="primary !px-4 !py-2" to="/signup">
          Start free
        </Link>
      </div>
    </header>
    <main>
      <Outlet />
    </main>
    <footer className="border-t border-slate-100 px-6 py-10">
      <div className="max-w-7xl mx-auto flex flex-wrap gap-6 justify-between items-center">
        <div>
          <Brand />
          <p className="text-sm text-slate-500 mt-3">
            Software for a Better Tomorrow.
          </p>
        </div>
        <div className="text-sm text-slate-500 text-right">
          <p>Powered by NEXORA LABS</p>
          <p className="mt-2">© {new Date().getFullYear()} NEXORA LABS</p>
          <a
            href="/third-party-notices.txt"
            className="inline-block mt-2 text-xs"
          >
            Third-party notices
          </a>
        </div>
      </div>
    </footer>
  </div>
);
