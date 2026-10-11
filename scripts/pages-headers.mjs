import { writeFile } from "node:fs/promises";
import "dotenv/config";
const origins = new Set(["'self'"]);
for (const key of ["VITE_API_URL", "VITE_SUPABASE_URL"]) {
  const value = process.env[key];
  if (!value) continue;
  const url = new URL(value);
  if (url.protocol !== "https:")
    throw new Error(`${key} must be HTTPS for a Pages release`);
  origins.add(url.origin);
  if (key === "VITE_SUPABASE_URL") origins.add("wss://" + url.host);
}
const csp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src ${[...origins].join(" ")}; form-action 'self' https://sandbox.payfast.co.za https://www.payfast.co.za; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`;
await writeFile(
  "dist/_headers",
  `/*\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: ${csp}\n  Cache-Control: no-cache\n/assets/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n`,
);
console.log("Pages security headers generated for exact configured origins.");
