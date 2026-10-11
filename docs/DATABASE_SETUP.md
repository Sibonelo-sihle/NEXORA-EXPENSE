# NEXORA database setup and workspace repair

The repository already contained migrations 001–003. Migration 002 defines `public.bootstrap_business(business_name text default 'My business')`. The confirmed empty remote `public` schema and missing function mean these migrations were **not applied**, rather than never created. Authentication uses Supabase's separate `auth` schema, so login can succeed while workspace creation fails.

No remote database changes were made by this repair. Existing pricing, trial rules, sandbox payments, branding and expense functionality remain. Migration 004 adds missing owner memberships and receipt metadata and tightens receipt attachment validation. No table or stored record is dropped. Default categories are workspace configuration, not fake expenses.

## Apply using Supabase SQL Editor

1. Open the **NEXORA** Supabase project matching `VITE_SUPABASE_URL`. Confirm its project reference; don't run these files in another project. Keep the existing Auth users.
2. Since this project's public schema is confirmed empty, open `supabase/setup.sql`, copy its **entire contents** into a new SQL Editor query, and click Run using the administrative SQL Editor role. This generated file applies migrations **001 → 002 → 003 → 004 inside one transaction**, sets the extension search path, and aborts if public tables already exist. A failure rolls back the whole setup. It does not create Auth users or insert demo expenses.
3. Do not run `supabase/tests/bootstrap.sql` or test SQL in the real project. Those files simulate Auth/Storage and are exclusively for disposable local tests.
4. Run `supabase/verify_setup.sql`. Expect `bootstrap_business(text)`; argument name `business_name`; `prosecdef=true`; all 11 application tables with `rls_enabled=true`; anonymous function execution false; authenticated execution true; receipt bucket `public=false`, 5MB limit and JPG/PNG/PDF MIME types. Inspect Storage policies for any pre-existing broad policies: permissive PostgreSQL policies combine with OR, so unexpected policies must be reviewed before accepting isolation.
5. In Authentication → URL Configuration, use `http://127.0.0.1:3000` as the local Site URL and allow `http://127.0.0.1:3000/dashboard` and `http://127.0.0.1:3000/reset-password`. If localhost is also used, add its equivalent URLs. Keep email confirmation enabled. Production URLs remain unconfigured until domains are chosen; configure verified custom SMTP for production.
6. Open `http://127.0.0.1:3000/login`. An existing **confirmed** account can log in directly. Otherwise sign up at `/signup`, confirm the email, then log in. Refresh the dashboard or sign out/in after setup. `bootstrap_business` creates the profile, workspace, owner membership, trial and default categories atomically. It returns the same workspace on later logins and cannot restart the trial.
7. Verify two real confirmed accounts separately: each sees only its own workspace, categories, expenses, receipts and billing. Add/edit/delete expenses in each currency, reload to verify persistence, upload a real test receipt, attach/download it, export CSV and check reports. Repeat login to confirm the business UUID and trial deadline are unchanged. These remote acceptance checks remain pending until you apply the setup and use real test accounts.

If you prefer individual migrations, execute the complete files in this exact order on an empty schema:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_secure_saas.sql`
3. `supabase/migrations/003_currency_and_release_security.sql`
4. `supabase/migrations/004_workspace_and_receipt_metadata.sql`

The atomic `setup.sql` is recommended for SQL Editor. Do not run both methods, and do not rerun setup after success. If tables appear before setup, stop, inspect the installed migration state and apply only missing migrations after a backup. There is no DROP/reset workaround. An existing `nexora-receipts` bucket must be inspected before running the empty-schema setup bundle; never delete a bucket or its objects to make setup proceed.

`node scripts/build-database-setup.mjs` regenerates setup.sql from the migrations. No Supabase CLI configuration existed in the repository; SQL Editor setup does not require inventing a CLI project link or changing Auth configuration through a CLI.

## Schema and frontend contracts

| Contract | Database implementation |
|---|---|
| `rpc('bootstrap_business', {business_name})` | `public.bootstrap_business(business_name text)` returns business UUID; authenticated, verified users only |
| `rpc('billing_access')` | Server-derived trial/subscription state for the owner; no client dates or activation |
| `from('profiles')` | User ID references Auth; users access their own profile |
| `from('businesses').eq('id', bid)` | One workspace per owner; immutable owner and UUID |
| Memberships | `business_memberships`: one owner membership; clients cannot enrol themselves or others |
| `from('categories').eq('business_id', bid)` | Existing table name preserved; scoped CRUD and composite expense/category tenant FK |
| `from('expenses').eq('business_id', bid)` | Owner reads; active trial/paid access required for writes; immutable tenant; exact two-decimal amounts and ZAR/USD/EUR |
| `storage.from('nexora-receipts')` | Existing private bucket; business UUID path prefix; billing-gated uploads/deletes and tenant-scoped reads |
| Receipt metadata | `public.receipts`: tenant-scoped expense FK plus Storage-object link, business UUID, path and file details; a Storage trigger maintains records; clients read own metadata only |
| Payfast service RPCs | Service role only; prices and sandbox behavior preserved |

Storage remains the receipt file source of truth. The frontend continues using Storage list/upload/download/remove APIs. Metadata is populated within Storage's database transaction; clients cannot create fake metadata. Receipt deletion cascades metadata removal, and attached receipts cannot be deleted until detached. Existing legacy owner-prefixed objects remain readable; migration 004 backfills metadata for recognized business/owner paths without moving or deleting files. Unrecognized existing paths are preserved for administrator review.

BusinessProvider already scopes workspace/category/expense reads to the returned business ID and paginates expense reads. RLS enforces isolation independently of frontend filters. A missing/invalid business ID now fails before querying records. TypeScript includes membership and receipt metadata contracts. Shared team access is not enabled: the current app's owner-only billing and workspace contracts remain intact.

## Environment requirements

Frontend `.env` (ignored):

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
VITE_APP_ORIGIN=http://127.0.0.1:3000
VITE_API_URL=
```

The first two values already point to the real project locally. Set VITE_APP_ORIGIN to the browser origin used for email redirects; restart Vite after changing environment variables. Blank VITE_API_URL uses the local Vite `/api` proxy. Public anon/publishable keys belong in the browser; service-role/secret keys never do.

Expense CRUD, receipt access and onboarding use the user's Supabase session and **do not require a service-role key in the frontend or local browser**. The separate payment server requires `SUPABASE_URL`, a server-only `SUPABASE_SERVICE_ROLE_KEY`, approved APP_ORIGIN/CORS_ORIGINS/callback settings and sandbox merchant credentials. Keep PAYFAST_MODE=sandbox, PAYFAST_LIVE_ENABLED=false and RELEASE_SANDBOX_ONLY=true. Server secrets stay in ignored files or the hosting secret manager.

## Tests and blockers

- All four migrations passed in a disposable real PostgreSQL cluster using minimal Auth/Storage interfaces.
- The exact SQL Editor bundle passed independently on an empty database.
- Tests cover verified/unverified/anonymous onboarding, exact named RPC argument, repeated and concurrent logins, unchanged trial/name/category seed, membership isolation/no self-enrolment, all application tables having RLS, stored expense updates across role/session reset, USD/EUR amounts, receipt metadata creation/removal, missing-file rejection and cross-account read/update/delete rejection.
- Existing tests retain coverage for tenant isolation, trial expiry without data loss, private receipt policies and Payfast replay/cancellation/expiry. Authentication browser tests use mocked Supabase responses, not a claim of real email delivery.
- Final results: **13 unit tests passed, 17 browser tests passed, TypeScript passed and both production builds passed**. Browser Supabase requests are mocked. Vite retains a non-blocking large-chunk warning.
- Run `npm run test:db`, `npm test`, `npm run lint`, `npm run build`, then `npm run test:browser` to reproduce checks.

Remaining blockers: setup has not yet been applied through your SQL Editor; real-project Auth/Storage/CRUD and two-account acceptance need verification afterward. Production SMTP, production domains, payment server secrets and merchant sandbox tests remain separate launch blockers. Nothing was pushed or deployed.
