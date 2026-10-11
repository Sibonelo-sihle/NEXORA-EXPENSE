import { createContext, useContext, useState, useEffect } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { db, supabase } from "../lib/supabase";
import { allowLocalDemo, demoStorageKey, demoUser } from "../lib/demo";
export const demoAvailable = allowLocalDemo(
  import.meta.env.DEV,
  !!supabase,
  window.location.hostname,
);
const AuthContext = createContext<
  | {
      session: Session | null;
      user: Session["user"] | null;
      loading: boolean;
      signOut: () => Promise<void>;
      isDemo: boolean;
      startDemo: () => void;
    }
  | undefined
>(undefined);
export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isDemo, setIsDemo] = useState(
    () => demoAvailable && sessionStorage.getItem(demoStorageKey) === "active",
  );
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    localStorage.removeItem("nexora_session");
    if (!demoAvailable) sessionStorage.removeItem(demoStorageKey);
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    let authEvents = 0;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      authEvents++;
      if (active) {
        setSession(s);
        setLoading(false);
      }
    });
    const eventsAtRestore = authEvents;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active && authEvents === eventsAtRestore) {
          setSession(error ? null : data.session);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  const startDemo = () => {
    if (!demoAvailable) throw new Error("Demo mode is unavailable");
    sessionStorage.setItem(demoStorageKey, "active");
    setIsDemo(true);
  };
  const signOut = async () => {
    if (isDemo) {
      sessionStorage.removeItem(demoStorageKey);
      setIsDemo(false);
      return;
    }
    const { error } = await db().auth.signOut();
    if (error) throw error;
    setSession(null);
  };
  return (
    <AuthContext.Provider
      value={{
        session,
        user: isDemo ? (demoUser as User) : (session?.user ?? null),
        loading,
        signOut,
        isDemo,
        startDemo,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
export const useAuth = () => {
  const c = useContext(AuthContext);
  if (!c) throw new Error("Auth provider required");
  return c;
};
