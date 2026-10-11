# First production release readiness — 9 October 2026

Status: **NOT READY FOR PRODUCTION**. Local release preparation is complete; real-project provisioning and acceptance remain blocked. Nothing was pushed, deployed, or written to the remote database.

## Preserved and prepared

The approved monthly USD catalog is Starter ($5 / 500 cents), Pro ($12 / 1,200 cents) and Business ($25 / 2,500 cents); Pro is recommended and annual pricing is unset. The frontend and backend plan catalog share these exact minor-unit amounts. Checkout is deliberately disabled: the existing PayFast path and billing schema are fixed to the legacy R69 ZAR amount and do not persist a selected tier or USD currency. Do not send USD amounts to PayFast or enable checkout until a USD-capable provider is verified and an additive billing migration records plan, currency and amount without changing historical payments, expenses or trial deadlines. Existing expense currency values and trial records are not changed by this pricing update.

Branding uses NEXORA LABS as the company, NEXORA Expense as the product and “Software for a Better Tomorrow.” as the slogan. Auth email templates, marketing/auth/app footers and page metadata use the company name while retaining the purple NEXORA artwork.

ZAR, USD and EUR expenses now store a currency per record. Existing records migrate to ZAR. New expenses default to the business currency. Decimal input and totals use exact minor units; the database rejects excessive precision and unsupported currencies. Reports and dashboard summaries select one currency; exports retain original currency. No invented exchange rates or combined mixed-currency totals are used.

Added migration 003 explicitly grants required privileges, limits billing privileges, fixes function search paths and prevents business/profile UUID changes. It was validated together with 001 and 002 in a disposable PostgreSQL cluster with simulated Supabase Auth/Storage schemas. This validates application SQL locally, **not** the deployed project's policies or the full Supabase Storage service.

The frontend uses real Supabase Auth, database and signed private receipt APIs. Public credentials are in an ignored, permission-restricted local environment file. No server secret was supplied. DEMO MODE remains restricted to unconfigured loopback development and unavailable in production. With the real project configured, create an account at http://localhost:3000/signup, confirm its email, then use http://localhost:3000/login. The missing remote schema currently prevents successful workspace onboarding; there is no pre-created account or supplied password.

## Evidence

| Check                                           | Result                      | Limitation                                                                                                                 |
| ----------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Frontend and backend builds                     | PASS                        | Vite warns about one chunk above 500 kB                                                                                    |
| TypeScript                                      | PASS                        | npm run lint                                                                                                               |
| Unit tests                                      | PASS: 13                    | Currency, decimal arithmetic, CSV safety, payment validation, demo restriction                                             |
| Browser suite                                   | PASS: 17                    | Auth, CRUD, receipts, reports, mobile, expired trial, production demo rejection and CORS; Supabase responses mocked        |
| Migrations 001–003 and RLS tests                | PASS                        | Disposable local PostgreSQL; tenant and receipt isolation, trial expiry, payment replay/cancellation, currency constraints |
| Dependency audit during install                 | PASS: 0 vulnerabilities     | Package audit is not a penetration test                                                                                    |
| Live Supabase Auth settings                     | PASS: HTTP 200              | Email enabled; email confirmation required                                                                                 |
| Live expenses/businesses/categories             | BLOCKED: HTTP 404, PGRST205 | Tables absent or unavailable through PostgREST                                                                             |
| Real signup/verification/recovery/login         | BLOCKED                     | No designated acceptance accounts, SMTP verification or completed schema provisioning                                      |
| Real CRUD/private receipts/reports/export/trial | BLOCKED                     | Remote schema and storage policies not verified                                                                            |
| Real Payfast checkout/ITN/renewal/cancellation  | BLOCKED                     | Merchant credentials and reachable sandbox callback not supplied                                                           |
| Release configuration gate                      | EXPECTED BLOCK              | Missing production origins, backend secret, merchant/proxy settings and real-test attestations                             |
| Docker image build/startup                      | PASS                        | Node 22 image built; container health HTTP 200 in sandbox; no image pushed                                                 |
| Cloudflare/Render deployment                    | NOT RUN                     | Explicit approval required                                                                                                 |

The public Supabase URL was derived from the supplied anon JWT's project reference. No keys are reproduced in this report. `node scripts/audit-supabase.mjs` reproduces the read-only availability probe.

## Hosting and configuration

Cloudflare Pages serves the React `dist` folder. Build command: `npm run build:frontend`. React route rewrites, generated exact-origin CSP and security headers are included. [Cloudflare React guide](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/) and [header configuration](https://developers.cloudflare.com/pages/configuration/headers/).

The existing backend is a long-running Express server using Node crypto, DNS and HTTP. Use a **Render Docker web service**, not Cloudflare Pages Functions without a rewrite. `Dockerfile` runs as an unprivileged user; `render.yaml` disables automatic deployments and uses health path `/api/health`. Creation of the Render service itself deploys it, so do not create/sync the Blueprint before approval. [Render web services](https://render.com/docs/web-services), [Blueprint reference](https://render.com/docs/blueprint-spec).

Copy `deployment/.env.frontend.example` and `deployment/.env.backend.example` to ignored files. Set the approved frontend/API HTTPS origins, public Supabase URL/key, exact CORS frontend origin, server-only Supabase service key, sandbox merchant configuration and callback URL. Verify actual ingress proxy behavior and CIDRs; never trust every forwarded address. Frontend secrets must never use VITE_ names. Configure production secrets in the host's secret environment, not committed files. International subscription pricing stays unconfigured.

## Exact next steps before approval

1. Supply approved frontend/API domains and place database/admin/backend credentials in ignored local files or the host secret manager; do not paste secrets in chat.
2. Inventory the actual Supabase schema and take a backup. Resolve existing migration history before applying anything; do not blindly replay 001/002 on an existing installation.
3. On a confirmed new/empty project, execute the following **only after database-change approval** with SUPABASE_DB_URL already loaded securely:

```sh
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/001_initial_schema.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/002_secure_saas.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/003_currency_and_release_security.sql
```

On a project already at 002, apply only 003 after checking existing amounts/default currencies satisfy its constraints. Validate every policy against the actual project, confirm `receipts` is private, confirm two separate businesses cannot read or mutate each other's records/files, and verify service privileges remain server-only.

4. Configure custom SMTP and verify delivery. Supabase's default sender is restricted and unsuitable for production. Generate branded verification/recovery templates and exact redirect settings after setting VITE_APP_ORIGIN:

```sh
node scripts/supabase-auth-config.mjs
```

Review `deployment/generated/supabase-auth.json`; apply through the Supabase Auth dashboard or Management API only after approval. Set Site URL to the approved frontend origin; allow its `/dashboard` and `/reset-password` URLs. The generated configuration enables email verification. [SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Management API](https://supabase.com/docs/reference/api/v1-update-auth-service-config).

5. Run two designated real test accounts through signup, confirmation, login/reload/logout, recovery, all three currencies, CRUD, receipt upload/download, reports and CSV. Test tenant isolation using authenticated clients, anonymous access rejection, expired trials retaining exports, and sandbox subscription success/failure/replay/cancellation. A browser mock passing is not a substitute for this step.
6. Complete sandbox payment tests with real merchant test credentials and an approved reachable test callback. Preserve sandbox-only flags. Verify hosted checkout and provider-authenticated ITNs; redirects cannot activate subscriptions.
7. Run local checks again and record the actual remote acceptance results. Set `REAL_ACCEPTANCE_PASSED=true`, `SMTP_VERIFIED=true`, `MIGRATIONS_VERIFIED=true` only after those checks pass; do not use them to bypass blockers.

```sh
npm ci
npm run lint
npm test
npm run test:db
npm run build
npm run test:browser
npm run release:check
docker build -t nexora-expense-api:release .
```

## Deployment commands — ONLY AFTER final release approval

Load frontend environment values before building; Cloudflare serves only `dist`, never the project root or `.env` files. A production domain must be approved before replacing placeholders.

```sh
npm run build:frontend
npx wrangler pages project create nexora-expense --production-branch main
npx wrangler pages deploy dist --project-name nexora-expense --branch main
```

For the backend, create a Render Docker web service from `render.yaml` using an approved repository containing this reviewed release (this workspace currently has no Git repository). Configure its secrets first; Render builds and runs the Dockerfile. A push/repository setup or Blueprint creation requires approval. The executable container commands are:

```sh
docker build -t nexora-expense-api:release .
docker run --rm --env-file deployment/.env.backend -e PORT=10000 -p 10000:10000 nexora-expense-api:release
```

The second command is local validation, not a cloud deployment. No Render service ID or repository URL exists yet, so a truthful service-specific deployment command cannot be supplied until the approved service is created. After deployment, verify HTTPS, redirect allowlists, exact CORS, CSP connections, private receipt downloads and sandbox ITN ingress before opening registration. Use service health and auth/billing monitoring without logging credentials or receipt contents.

## Database repair follow-up

Migration 004 now adds owner memberships and Storage-derived receipt metadata. For the confirmed empty NEXORA public schema, use the atomic `supabase/setup.sql` bundle (001–004), following [DATABASE_SETUP.md](DATABASE_SETUP.md). It passed independent local PostgreSQL validation, concurrent-login tests and an existing-schema refusal check. The real project still needs application through SQL Editor and remote acceptance; earlier three-migration commands are superseded by this four-migration setup.
