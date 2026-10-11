import "dotenv/config";
const base = process.env.VITE_SUPABASE_URL,
  key = process.env.VITE_SUPABASE_ANON_KEY;
if (!base || !key) throw new Error("Public Supabase configuration required");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const auth = await fetch(`${base}/auth/v1/settings`, { headers });
const settings = auth.ok ? await auth.json() : {};
console.log(
  JSON.stringify({
    check: "Auth settings",
    status: auth.status,
    emailEnabled: settings.external?.email,
    emailConfirmationRequired: settings.mailer_autoconfirm === false,
  }),
);
for (const table of ["expenses", "businesses", "categories"]) {
  const response = await fetch(`${base}/rest/v1/${table}?select=id&limit=0`, {
    headers,
  });
  const body = await response.json();
  console.log(
    JSON.stringify({
      check: table,
      status: response.status,
      errorCode: body.code ?? null,
    }),
  );
}
console.log(
  "Read-only probe only. Successful anonymous requests alone do not prove tenant isolation or private storage.",
);
