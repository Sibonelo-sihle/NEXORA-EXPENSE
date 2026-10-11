// No Supabase session, JWT or payment entitlement is issued by demo mode.
export const demoStorageKey = "nexora_local_demo_v1";
export function allowLocalDemo(
  development: boolean,
  configured: boolean,
  hostname: string,
) {
  return (
    development &&
    !configured &&
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname)
  );
}
export const demoUser = {
  id: "local-demo-user",
  email: "demo@nexora.local",
  aud: "local-demo",
  app_metadata: {},
  user_metadata: {
    full_name: "Demo User",
    business_name: "NEXORA Demo Workspace",
  },
  created_at: "2026-10-09T00:00:00Z",
};
