import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const authConfigurationError = (() => {
  if (!url || !key || key.startsWith("your_") || url.includes("your_project"))
    return "Supabase credentials are missing. Real account login is unavailable.";
  try {
    if (new URL(url).protocol !== "https:")
      return "Supabase must use a valid HTTPS project URL.";
  } catch {
    return "The Supabase project URL is invalid.";
  }
  if (key.startsWith("sb_secret_"))
    return "A server secret cannot be used as the public Supabase key.";
  try {
    const role = JSON.parse(
      atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")),
    ).role;
    if (role === "service_role")
      return "A service role key cannot be used in the browser.";
  } catch {}
  return null;
})();
const hasCredentials = !!url && !!key && !key.startsWith("your_");
export const supabase =
  hasCredentials && !authConfigurationError
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
export function db() {
  if (!supabase)
    throw new Error(
      "NEXORA Expense is not configured yet. Add the Supabase URL and public key to start.",
    );
  return supabase;
}
export function check<T extends { error: any }>(result: T): T {
  if (result.error) throw result.error;
  return result;
}
