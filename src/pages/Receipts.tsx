import { useEffect, useState } from "react";
import { useBusiness } from "../contexts/BusinessContext";
import {
  listReceipts,
  uploadReceipt,
  receiptName,
  RECEIPT_BUCKET,
} from "../lib/receipts";
import { Link } from "react-router-dom";
import { db, check } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
export default function Receipts() {
  const { isDemo } = useAuth();
  const { business, access, expenses } = useBusiness();
  const [files, setFiles] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    try {
      setFiles(await listReceipts(business.id));
    } catch (e) {
      setError((e as any).message);
    }
  }
  useEffect(() => {
    if (!isDemo) load();
  }, [business.id, isDemo]);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await uploadReceipt(business.id, file);
      setMessage(
        "Receipt uploaded. Select it when adding or editing an expense.",
      );
      await load();
    } catch (e) {
      setError((e as any).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(path: string) {
    try {
      const { data } = check(
        await db().storage.from(RECEIPT_BUCKET).download(path),
      );
      if (!data) throw new Error("Receipt is unavailable");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").at(-1)!;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as any).message);
    }
  }
  async function remove(path: string) {
    try {
      if (expenses.some((e) => e.receipt_url === path))
        throw new Error(
          "Detach this receipt from its expense before deleting it.",
        );
      check(await db().storage.from(RECEIPT_BUCKET).remove([path]));
      await load();
    } catch (e) {
      setError((e as any).message);
    }
  }
  const legacy = expenses
    .map((e) => e.receipt_url)
    .filter((p): p is string => !!p && !p.startsWith(business.id + "/"));
  return (
    <div className="space-y-6">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Private document library</p>
          <h1>Receipts</h1>
        </div>
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
      <section className="panel">
        <h2>Upload a receipt</h2>
        <p className="text-sm text-slate-500 my-3">
          PDF, JPG or PNG · up to 5MB · private to your business
        </p>
        <input
          aria-label="Upload receipt"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          disabled={busy || !access?.can_write}
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </section>
      <section className="panel">
        <h2>Your receipts</h2>
        {!files.length && !legacy.length && (
          <p className="empty">No receipts uploaded yet.</p>
        )}
        {files.map((file) => {
          const path = file.path;
          return (
            <div key={file.id} className="py-4 border-b border-slate-100">
              <p className="text-sm break-all font-medium">
                {receiptName(file.name)}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {Math.ceil((file.metadata?.size ?? 0) / 1024)} KB
              </p>
              <div className="flex flex-wrap gap-4 mt-3 text-sm">
                <button
                  className="text-violet-700"
                  onClick={() => download(path)}
                >
                  Download
                </button>
                <Link className="text-violet-700" to="/expenses">
                  Attach to expense
                </Link>
                <button
                  className="text-red-700"
                  disabled={!access?.can_write || busy}
                  onClick={() => remove(path)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {[...new Set(legacy)].map((path) => (
          <div className="py-4" key={path}>
            <span className="text-sm">Previously attached receipt</span>
            <button className="secondary ml-3" onClick={() => download(path)}>
              Download
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}
