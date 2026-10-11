# Authentication audit and local login

9 October 2026.

## Current running services

Frontend: http://localhost:3000/login (HTTP 200 verified).
Backend: http://localhost:3001/api/health (responding; sandbox mode, configured=false).

No `.env` or `.env.local` was present. The process environment checks showed VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY missing. No credential values were printed. `.env.example` contains placeholders only.

The real authentication path uses Supabase's actual SDK and Auth endpoints. It is currently not connected to a real Supabase project. Network mocks appear in browser tests only; they are not used for real account authentication. Live project Auth settings, SMTP delivery, email verification and real account login cannot be confirmed without project credentials.

## How to log in now

1. Open http://localhost:3000/login on this computer.
2. Click **Enter DEMO MODE**.
3. No account, email, password or signup is required.
4. Use the sidebar/mobile menu to explore. Click **Sign out** to leave.

DEMO MODE is a clearly labelled, read-only sample workspace. Its tab session survives reloads. It creates no Supabase session or JWT, has no service calls, grants no real trial/subscription access and cannot create/edit expenses, upload receipts or initiate/cancel payments. Sample data can be exported. The production build cannot enter demo mode, including through a forged sessionStorage marker. It is also unavailable on remote hostnames and whenever real Auth configuration is present. Use localhost or 127.0.0.1, not a network IP, for this local preview.

## Real account login once configured

Use README's setup and docs/LAUNCH.md. Put public frontend and server-only credentials in `.env` or the appropriate environment, enable Supabase email confirmation, configure the Auth Site URL and permitted `/dashboard` and `/reset-password` redirect URLs, and configure SMTP/email templates. Apply the existing migrations to the approved project. Restart both local services after environment changes.

A new user must open http://localhost:3000/signup, create an account, verify the confirmation email, then sign in at http://localhost:3000/login. An existing confirmed account can sign in directly. Password recovery is at http://localhost:3000/forgot-password. Adding real Auth configuration automatically hides the demo option. Demo does not substitute for verifying real email delivery or tenant isolation in a connected project.

## Fixes and verification

- Explicit missing/invalid Supabase configuration messages rather than an import-time crash from a malformed URL.
- Browser public-key configuration rejects service-role/secret keys.
- Auth callback error descriptions are displayed, including expired recovery/confirmation links.
- Verification emails can be resent after signup or an unconfirmed-email login error.
- No misleading dashboard continuation link before an email-confirmation session exists.
- Login supports existing shorter passwords; new passwords still require at least eight characters.
- Session restoration cannot overwrite a newer auth event. Restoring sessions disables auth submission until readiness.
- Dedicated development demo access, separated from real Auth and guarded by build mode, hostname and configuration.
- Settings and receipts skip service operations in demo mode; mutation and billing actions are unavailable there.

`npm run lint`, `npm test` (11 passing), `npm run build`, and `npm run test:browser` (16 passing) completed. The suite covers signup confirmation messaging/resend, login errors, logout, real-SDK session persistence, password recovery/update, expired links, demo reload/logout, no demo service calls, production rejection and existing expense/report/billing behavior. Supabase network responses are mocked in those UI tests; no claim of live email/project verification is made. Demo login/reload/logout was also verified on the already-running localhost:3000 frontend.

The landing/pricing file, Payfast integration module and both database migrations retained the same SHA-1 checksums before and after this audit. Existing pricing, 30-day trial, Payfast sandbox billing, subscription logic and official brand assets were preserved. No push or deployment occurred.
