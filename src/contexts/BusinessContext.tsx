import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { db } from "../lib/supabase";
import {
  workspaceResult,
  workspaceId,
  workspaceAccess,
} from "../lib/workspace";
import { useAuth } from "./AuthContext";
export type Expense = {
  id: string;
  business_id: string;
  merchant: string;
  description: string;
  amount: number;
  currency?: import("../lib/finance").Currency;
  date: string;
  category_id: string | null;
  receipt_url: string | null;
  status: string;
};
export type BusinessMembership = {
  business_id: string;
  user_id: string;
  role: "owner";
  created_at: string;
};
export type ReceiptMetadata = {
  id: string;
  business_id: string;
  storage_path: string;
  created_at: string;
};
export type Category = { id: string; name: string; color: string };
export type Access = {
  business_id: string;
  trial_days: number;
  trial_ends_at: string;
  status: string;
  paid_until: string | null;
  cancel_at_period_end: boolean;
  can_write: boolean;
  has_subscription: boolean;
};
export type Business = {
  id: string;
  owner_id: string;
  name: string;
  currency: string;
};
type BusinessState = {
  business: Business | null;
  access: Access | null;
  expenses: Expense[];
  categories: Category[];
  error: string;
  loading: boolean;
  refresh: () => Promise<void>;
};
const Context = createContext<BusinessState | null>(null);
export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const { user, isDemo } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null),
    [access, setAccess] = useState<Access | null>(null),
    [expenses, setExpenses] = useState<Expense[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!user) return;
    if (isDemo) {
      const today = new Date();
      const date = today.toLocaleDateString("en-CA");
      setBusiness({
        id: "local-demo-business",
        owner_id: user.id,
        name: "NEXORA Demo Workspace",
        currency: "ZAR",
      });
      setCategories([
        { id: "demo-software", name: "Software", color: "#7c3aed" },
        { id: "demo-travel", name: "Travel", color: "#0284c7" },
      ]);
      setExpenses([
        {
          id: "demo-expense-1",
          business_id: "local-demo-business",
          merchant: "Example software subscription",
          description: "Sample data for the local preview",
          amount: 349,
          date,
          category_id: "demo-software",
          receipt_url: null,
          status: "Approved",
        },
        {
          id: "demo-expense-2",
          business_id: "local-demo-business",
          merchant: "Example business travel",
          description: "Sample data for the local preview",
          amount: 120,
          date,
          category_id: "demo-travel",
          receipt_url: null,
          status: "Pending",
        },
      ]);
      setAccess({
        business_id: "local-demo-business",
        trial_days: 30,
        trial_ends_at: new Date(today.getTime() + 30 * 86400000).toISOString(),
        status: "trial",
        paid_until: null,
        cancel_at_period_end: false,
        can_write: false,
        has_subscription: false,
      });
      setLoading(false);
      return;
    }
    setError("");
    try {
      const { data: rawBid } = workspaceResult(
        await db().rpc("bootstrap_business", {
          business_name: user.user_metadata.business_name || "My business",
        }),
        "bootstrap_business",
      );
      const bid = workspaceId(rawBid);
      const results = await Promise.all([
        db().from("businesses").select("*").eq("id", bid).single(),
        db().rpc("billing_access"),
        db()
          .from("categories")
          .select("*")
          .eq("business_id", bid)
          .order("name"),
      ]);
      results.forEach((r, i) =>
        workspaceResult(
          r,
          ["Read workspace", "billing_access", "Read categories"][i],
        ),
      );
      const entitlement = workspaceAccess(results[1].data, bid);
      setBusiness(results[0].data);
      setAccess(entitlement);
      setCategories(results[2].data ?? []);
      // Paginate so exports never silently stop at Supabase's default row limit.
      let all: Expense[] = [];
      for (let start = 0; ; start += 1000) {
        const { data } = workspaceResult(
          await db()
            .from("expenses")
            .select("*")
            .eq("business_id", bid)
            .order("date", { ascending: false })
            .order("id")
            .range(start, start + 999),
          "Read expenses",
        );
        all.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      setExpenses(all);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : String((e as any)?.message || e),
      );
    } finally {
      setLoading(false);
    }
  }, [user?.id, isDemo]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <Context.Provider
      value={{
        business,
        access,
        expenses,
        categories,
        error,
        loading,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useBusiness() {
  const value = useContext(Context);
  if (!value) throw new Error("Business provider required");
  return value as BusinessState & { business: Business };
}
