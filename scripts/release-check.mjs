import "dotenv/config";
const failures = [];
const required = (k) => {
  const value = process.env[k];
  if (!value || value.includes("your_"))
    failures.push(`${k} is missing or a placeholder`);
  return value;
};
for (const key of [
  "VITE_SUPABASE_URL",
  "VITE_APP_ORIGIN",
  "VITE_API_URL",
  "APP_ORIGIN",
  "PAYFAST_NOTIFY_URL",
]) {
  const value = required(key);
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.hostname === "localhost"
    )
      failures.push(`${key} must use a production HTTPS URL`);
  } catch {
    failures.push(`${key} is not a valid URL`);
  }
}
const publicKey = required("VITE_SUPABASE_ANON_KEY");
if (publicKey?.startsWith("sb_secret_"))
  failures.push("Browser key is a server secret");
try {
  if (
    JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString())
      .role === "service_role"
  )
    failures.push("Browser key is service_role");
} catch {}
required("SUPABASE_SERVICE_ROLE_KEY");
required("TRUSTED_PROXY_CIDRS");
if (
  process.env.PAYFAST_MODE !== "sandbox" ||
  process.env.PAYFAST_LIVE_ENABLED !== "false" ||
  process.env.RELEASE_SANDBOX_ONLY !== "true"
)
  failures.push("First release must remain sandbox-only");
if (process.env.VITE_APP_ORIGIN !== process.env.APP_ORIGIN)
  failures.push("Frontend and backend redirect origins disagree");
if (process.env.VITE_SUPABASE_URL !== process.env.SUPABASE_URL)
  failures.push("Frontend/backend Supabase projects disagree");
if (process.env.CORS_ORIGINS !== process.env.VITE_APP_ORIGIN)
  failures.push("CORS must match the exact approved frontend origin");
for (const key of [
  "PAYFAST_MERCHANT_ID",
  "PAYFAST_MERCHANT_KEY",
  "PAYFAST_PASSPHRASE",
])
  required(key);
for (const key of [
  "REAL_ACCEPTANCE_PASSED",
  "SMTP_VERIFIED",
  "MIGRATIONS_VERIFIED",
])
  if (process.env[key] !== "true")
    failures.push(`${key} has not been attested after real testing`);
for (const key of Object.keys(process.env))
  if (
    key.startsWith("VITE_") &&
    /SECRET|SERVICE_ROLE|PASSPHRASE|PASSWORD|PRIVATE/.test(key)
  )
    failures.push("A server secret uses a browser-visible prefix");
if (failures.length) {
  console.error(
    "RELEASE BLOCKED:\n" +
      [...new Set(failures)].map((f) => " - " + f).join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    "Release configuration checks passed. This does not grant deployment approval.",
  );
