# NEXORA Expense

**NEXORA Expense** is a private, multi-currency expense management application
by **NEXORA LABS**.

> Software for a Better Tomorrow.

Track business expenses, organize receipts, review reports, and export records
from a workspace protected by Supabase Auth and PostgreSQL row-level security.

## Product status

- The approved plans are Starter at **$5/month**, Pro at **$12/month**
  (recommended), and Business at **$25/month**. Billing is monthly in USD;
  annual prices have not been approved.
- A 30-day free trial is available without a card.
- USD subscription checkout is **disabled** until the payment provider's USD
  settlement support is verified and billing storage can safely record the
  selected plan, currency, and amount.
- Business plan cards currently describe approved features. Team access,
  differentiated storage, priority support, and plan-specific entitlements
  are not represented as implemented functionality.
- Expense records keep their own currency (ZAR, USD, or EUR). Subscription
  currency changes do not convert or rewrite expense data.
- The production Supabase reconciliation migration 005 has already been
  applied. **Do not replay it.** No hosting deployment is implied by that
  database status.

## Architecture

| Area | Technology | Deployment |
| --- | --- | --- |
| Web client | React, TypeScript, Vite, Tailwind CSS | Vercel static deployment (`dist/`) |
| API | Node.js, Express, TypeScript | Render Docker web service (`render.yaml`) |
| Identity and data | Supabase Auth, PostgreSQL, RLS | Existing Supabase project |
| Receipt files | Private Supabase Storage bucket | Existing Supabase project |
| Payments | PayFast integration retained in sandbox configuration | Checkout remains disabled pending USD verification |

Vercel hosts the frontend only. This project uses a long-running Express API
with payment notification and cancellation routes; it is not deployed as a
Vercel serverless function. Deploy the API separately, then set the frontend's
`VITE_API_URL` to its HTTPS origin.

## Repository map

```text
src/
  components/       Shared UI and application/marketing layouts
  contexts/         Authentication and workspace state
  lib/               Supabase, receipts, finance, pricing, API helpers
  pages/             Landing, authentication, dashboard, expenses, reports
server/              Express API and payment verification
supabase/
  migrations/        Ordered schema migrations
  reconciliation/    Reviewed production inventory, applied repair, checks
  templates/         Supabase Auth email templates
  tests/             SQL security and migration fixtures
tests/
  browser/            Playwright application/API regression tests
scripts/              Build, database test, and release-check utilities
deployment/           Safe frontend/backend environment templates
docs/                 Operations, database, and release documentation
```

## Requirements

- Node.js 22.12 or newer
- npm
- PostgreSQL tooling (`initdb`, `pg_ctl`, and `psql`) for `npm run test:db`
- Chromium for browser tests (install with `npx playwright install chromium` if
  it is not already available)

## Local development

```sh
npm ci
cp .env.example .env
```

Set the public Supabase URL and anon/publishable key in `.env`. Server-only
settings may be added there for local use. Never put a service-role key,
payment secret, or password in a `VITE_*` variable, source file, or commit.

Run the API and frontend in separate terminals:

```sh
npm run server
npm run dev
```

Open <http://localhost:3000>. Vite proxies `/api` to the local API on port
3001. Without Supabase credentials, only the local read-only demo is available;
it never creates a real account or payment.

## Configuration

Use [`deployment/.env.frontend.example`](deployment/.env.frontend.example) for
browser-visible build configuration and
[`deployment/.env.backend.example`](deployment/.env.backend.example) for
server-only configuration.

### Frontend build variables

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Existing Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Public anon/publishable key only |
| `VITE_APP_ORIGIN` | Exact approved frontend HTTPS origin |
| `VITE_API_URL` | Deployed API HTTPS origin |

Vite embeds `VITE_*` values in the browser bundle. Treat them as public.

### Backend runtime variables

Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`,
`AZURE_DOCUMENT_INTELLIGENCE_KEY`, `APP_ORIGIN`, `CORS_ORIGINS`, and the exact
trusted `TRUSTED_PROXY_CIDRS` only in the API host's secret/environment settings.
`SUPABASE_ANON_KEY` must match the frontend public key; it is used only with a
verified user's bearer token for their `billing_access()` check. Keep
`PAYFAST_MODE=sandbox`, `PAYFAST_LIVE_ENABLED=false`, and
`RELEASE_SANDBOX_ONLY=true`. Add sandbox merchant credentials and
`PAYFAST_NOTIFY_URL` only to the backend environment when authorized testing
is ready. Never commit real values.

### Smart receipt processing

The API uses Azure AI Document Intelligence's `prebuilt-receipt` model for
private JPG, PNG, scanned images, and PDF inputs. Create an Azure Document
Intelligence resource, then set its HTTPS endpoint and key as the two
`AZURE_DOCUMENT_INTELLIGENCE_*` Render secrets. The key must never be placed in
a `VITE_*` variable. The backend rejects uncertain/missing required fields,
bank statements, repeat file hashes, and likely duplicate expenses rather
than guessing or creating a misleading expense. Confident receipts create a
`Pending` expense linked to the private receipt for review. The existing
5 MB file cap, four processing attempts per receipt, and ten-request-per-minute
workspace limit constrain upload and OCR spend. Subscription plans do not
currently define OCR quotas, so no per-plan allowance is assumed.

Apply `supabase/migrations/006_smart_receipt_processing.sql` once after the
existing billing/receipt schema (production has already applied reconciliation
005; do not rerun 005). This migration adds tenant-readable processing status
and service-only idempotent processing functions. It does not modify existing
expenses, receipt files, RLS policies, billing state, or trial dates. Existing
receipts can be submitted individually with **Read receipt**; they are not
processed until requested.

## Database and security

For a new, empty Supabase project, review and apply the ordered migrations
`001`–`004`, then `006`, using the instructions in
[`docs/DATABASE_SETUP.md`](docs/DATABASE_SETUP.md) and
[`docs/LAUNCH.md`](docs/LAUNCH.md). Existing production data requires a backup,
inventory, and migration-history review first. The production-specific
reconciliation at `supabase/reconciliation/005_reconcile_missing_billing.sql`
is already applied to the linked production project; it is conditional repair
SQL and must not be replayed.

Important security properties:

- Tenant authorization is enforced by PostgreSQL RLS, not only frontend
  filtering.
- Receipt Storage remains private and uses business-scoped access checks.
- Billing mutations are server-only; browser redirects do not activate
  subscriptions.
- Existing trial dates, historical expense currencies, and data must not be
  reset or rewritten to enable new pricing.
- USD checkout must remain blocked until provider currency settlement,
  payment notifications, and plan/currency/amount persistence are verified.

## Tests and production build

```sh
npm run lint
npm test
npm run test:db
npm run build
npm run test:browser
npm run release:check
```

Browser tests mock Supabase requests and are not production-account acceptance
tests. Database tests use isolated local PostgreSQL fixtures and never connect
to the production database. The release check is expected to fail until
approved hosting origins, server secrets, SMTP, payment configuration, and
real acceptance attestations are supplied.

## Deploy the frontend to Vercel

1. Push this repository to GitHub, then import it in Vercel.
2. Select **Vite** as the framework (or use the checked-in `vercel.json`).
3. Set the build command to `npm run build:frontend` and output directory to
   `dist`.
4. Configure the four frontend build variables above in the Vercel project's
   Production environment. Set preview values separately if previews are
   enabled. Rebuild whenever a frontend variable changes.
   Enter each variable as a separate name/value pair. The
   `VITE_SUPABASE_ANON_KEY` value must contain only the public key—not `.env`
   assignment labels, quotes, or extra lines. The app rejects whitespace in
   Supabase URLs and keys before authentication so malformed headers cannot
   reach the browser's `fetch`.
5. Update the Content Security Policy in `vercel.json` if the approved API is
   not hosted on `*.onrender.com`, or if a custom Supabase domain is used.
6. Deploy the backend separately on Render from the checked-in
   [`render.yaml`](render.yaml). Add required server secrets in Render; do not
   sync placeholders as production values.
7. Set Supabase Auth's Site URL and redirect allowlist to the approved
   frontend origin and its `/dashboard` and `/reset-password` routes. Set the
   API's exact CORS origin to that same frontend origin.
8. Run `npm run release:check`, then complete real-account and sandbox
   acceptance before promoting the site to public users.

The API is not ready for a public launch merely because Vercel successfully
builds the static frontend. Do not advertise live USD checkout until a
USD-capable provider and the matching additive billing migration are verified.

## License and third-party notices

See [`public/third-party-notices.txt`](public/third-party-notices.txt) for
third-party notices. Add a project license only after the owner selects and
approves one.
