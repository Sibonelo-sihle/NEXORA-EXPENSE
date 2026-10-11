import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
const origin = process.env.VITE_APP_ORIGIN;
if (
  !origin ||
  !/^https:\/\//.test(origin) ||
  new URL(origin).origin !== origin
) {
  console.error(
    "Set VITE_APP_ORIGIN to the approved HTTPS frontend origin. No remote configuration was changed.",
  );
  process.exit(1);
}
const template = (title) =>
  `<div style="font-family:Arial,sans-serif"><img src="${origin}/nexora-wordmark-dark.png" alt="NEXORA" width="240"><h2>${title}</h2><p><a href="{{ .ConfirmationURL }}">${title}</a></p><p>NEXORA Expense — Software for a Better Tomorrow.</p><p>Powered by NEXORA</p></div>`;
mkdirSync("deployment/generated", { recursive: true });
writeFileSync(
  "deployment/generated/supabase-auth.json",
  JSON.stringify(
    {
      site_url: origin,
      uri_allow_list: `${origin}/dashboard,${origin}/reset-password`,
      external_email_enabled: true,
      mailer_autoconfirm: false,
      password_min_length: 8,
      mailer_templates_confirmation_content: template("Confirm your email"),
      mailer_templates_recovery_content: template("Reset your password"),
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "Prepared deployment/generated/supabase-auth.json. Review it before applying; SMTP credentials must be configured separately.",
);
