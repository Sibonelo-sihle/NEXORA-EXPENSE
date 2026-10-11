import { Link } from "react-router-dom";
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      aria-label="NEXORA Expense home"
      className="inline-flex items-center gap-2 shrink-0"
    >
      <img
        src="/favicon.png"
        alt=""
        className="w-10 h-11 object-contain rounded"
      />
      <span>
        <img
          src="/nexora-wordmark.png"
          alt="NEXORA"
          className="w-[112px] h-auto"
        />
        {!compact && (
          <span className="block text-[9px] tracking-[.25em] font-medium text-violet-600 mt-1">
            EXPENSE
          </span>
        )}
      </span>
    </Link>
  );
}
