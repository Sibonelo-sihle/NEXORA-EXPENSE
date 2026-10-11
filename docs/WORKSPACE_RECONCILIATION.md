# Dashboard failure audit — 9 October 2026

## Confirmed findings

Local frontend URL, server URL and public JWT project reference all match `akcbseiauhsudinqwwrg.supabase.co`. This is the same configured project where live probes now find the six workspace tables. The supplied SQL Editor confirmation establishes that bootstrap_business(text) exists and returns uuid.

Frontend initialization uses:

1. POST `/rest/v1/rpc/bootstrap_business` with `{ "business_name": "…" }`; expects a JSON-encoded UUID string, not `{id:…}`.
2. Concurrent business SELECT by that UUID, POST `/rest/v1/rpc/billing_access` with no arguments, and workspace-filtered category SELECT.
3. Paginated, workspace-filtered expense SELECT only after the preceding requests succeed.

**Confirmed missing API dependency:** read-only GET of `/rest/v1/rpc/billing_access` returns HTTP 404, `PGRST202`, "Could not find the function public.billing_access without parameters in the schema cache". All five billing tables (`subscriptions`, `billing_environment`, `billing_orders`, `payment_events`, `billing_notifications`) return HTTP 404, `PGRST205`. The six workspace table probes return HTTP 200 with limit=0; no records were retrieved.

The installed API therefore does not match migrations 001–004. Six tables plus bootstrap are insufficient: migration 002 also defines the billing RPC, five billing tables, access helpers, billing privileges and trial-enforcing policies. The mismatch blocks initialization even if onboarding returns a correct UUID.

These probes establish API availability, **not definitive physical table/function absence**. SQL Editor inventory must distinguish unapplied objects, PostgREST schema-cache state and permissions/configuration. The supplied bootstrap return type is correct; its installed body and authenticated permissions are still pending inspection. It could fail before billing_access if it references missing subscriptions or uses a different schema.

## Authentication, browser and server checks

AuthProvider restores getSession, subscribes to onAuthStateChange, persists SDK sessions and prevents an older restoration result overwriting a newer event. ProtectedRoute waits for restoration before allowing the workspace. Existing browser tests cover sign-in/reload/sign-out. A fresh Chromium session against the real `http://127.0.0.1:3000/dashboard` redirected to `/login` with no page errors. It contains no copy of the user's existing browser session.

A browser regression reproduces successful UUID onboarding followed by the missing billing RPC. It verifies that the dashboard displays `billing_access failed (PGRST202)` and that expense requests do not begin. This is a controlled mocked reproduction, not access to your signed-in browser traffic.

Both local services are listening (frontend 3000, API 3001). The existing backend process produced no new log output during inspection. Dashboard Supabase calls go directly from the browser to Supabase, not through Express; backend billing logs cannot establish which authenticated dashboard request failed. No authenticated live request was made: no acceptance credentials/browser session or live SQL inspection access is available here.

Frontend now names failing database operations, validates the UUID response and requires a single billing entitlement matching that business ID. Missing/malformed entitlement fails closed; it does not fabricate a trial or grant paid access. Trial and PayFast implementation/prices are unchanged.

## Next required fix

1. Run the complete **read-only** `supabase/diagnose_workspace.sql` in the live SQL Editor. Share its results and the dashboard alert. It inventories columns, function signatures/bodies, execution grants, all RLS policies, table grants, indexes and the receipt bucket. It neither executes bootstrap nor reads expense records.
2. If billing objects physically exist, inspect their grants and function signature and refresh PostgREST with `NOTIFY pgrst, 'reload schema';`. Do not run a missing-billing repair against an existing subscription installation.
3. If all five billing tables are physically absent, compare the six table contracts and policies with the inventory. The prepared **conditional** migration is `supabase/reconciliation/005_reconcile_missing_billing.sql`. It is intentionally outside the automatic migration chain. Do not replay 001–004 or setup.sql on this populated schema.
4. After inventory review, paste the complete conditional repair into SQL Editor only for its supported six-table/missing-billing state. It runs atomically and refuses existing billing state, missing core columns, duplicate owners, missing original workspace dates, incompatible receipt/membership keys or unknown public policies. Other SQL type/constraint incompatibilities roll back instead of deleting records. If a guard fails, stop and use the inventory to tailor the repair; do not remove guards or disable RLS.
5. The repair restores migration 002 billing and access rules, migration 003 currency/privilege safeguards and migration 004 onboarding/receipt metadata behavior. Existing workspace trials derive from **original businesses.created_at + 30 days**; no fresh trial is granted on repair. Existing expenses are retained. Missing billing history cannot be reconstructed without actual provider evidence; the repair refuses existing billing tables rather than overwriting them.
6. Re-run `supabase/verify_setup.sql`, then sign out/in or retry the dashboard. Verify two confirmed accounts and actual CRUD/private receipts/export/trial behavior. If the first operation now fails, the alert will name bootstrap_business and its error code, allowing targeted permission/body repair.

The conditional migration is prepared and locally tested but **not approved for blind application to unknown live column/policy definitions**. The SQL inventory is still required. `node scripts/build-reconciliation.mjs` regenerates it from the source migrations plus its explicit guards. No remote repair was applied, no service key was exposed, and nothing was pushed or deployed.

## Test evidence

- 16 unit tests: monetary/payment behavior plus scalar UUID, named operation errors and billing response validation.
- Local PostgreSQL: normal 001–004 migrations, SQL Editor setup, idempotent/concurrent onboarding, tenant/receipt isolation and trial/payment rules.
- Conditional six-table reconciliation: preserved an existing expense; retained a 40-day-old workspace's expired trial; normal workspace/isolation tests passed after repair; rerun refused existing billing state.
- TypeScript and frontend/backend production builds passed. Vite retains its non-blocking large-chunk warning.
- **18 browser tests passed**, including the missing-billing-RPC regression. Authenticated live browser/SQL verification remains pending.

Automatic approval review rejected an initial probe including a live bootstrap POST because it could create a workspace. It was replaced with read-only GET probes; that rejected action was not retried or bypassed. No permission for remote writes is requested while the inventory is outstanding.
