# Reviewed missing-billing reconciliation

The confirmed production state is six application tables with RLS, UUID-returning bootstrap_business, and no billing tables or billing_access function. This supports the conditional reconciliation path. Full production column definitions, constraint definitions and policy names have not been supplied; the SQL performs guarded contract checks before committing any change. It is ready for review and guarded execution, not a claim that the live database has been repaired.

## Complete SQL Editor files

- Optional before-state counts/deadlines: `supabase/reconciliation/005_before_counts.sql`.
- **Complete migration SQL:** `supabase/reconciliation/005_reconcile_missing_billing.sql`. Copy the entire file, including BEGIN and COMMIT, into one SQL Editor query in the intended NEXORA project. Do not concatenate it with setup.sql or replay 001–004.
- After successful commit: `supabase/reconciliation/005_verify_missing_billing.sql`.

The migration is deliberately outside the regular migration directory. It is a repair for an existing six-table installation, not a normal fifth migration. It aborts if any billing table already exists, and should not be rerun after success. A guard or SQL error rolls back the entire transaction; a 10-second lock timeout prevents indefinite waiting on active writes. Stop and inspect the error rather than removing guards, resetting tables or disabling RLS. Retain a normal backup before administrative database changes.

## Compatibility-schema review

The conditional repair now handles the reported live compatibility gaps before composing migrations 002–004: it populates a missing `businesses.owner_id` only from exactly one existing `role='owner'` membership, preserves a non-null `businesses.trial_ends_at` and refuses a NULL explicit deadline, adds `categories.color`, and restores `expenses.date`, `status`, and `receipt_url`. Where the existing date is `expenses.expense_date`, it copies that value exactly to `date` and retains the original column; it makes that legacy column nullable only so future application writes to `date` do not fail. It does not invent expense dates, alter existing date values, or remove receipt metadata/Storage objects. Missing `status` values are initialized to `Pending`; newly introduced receipt URLs are NULL.

Preflight validates the existing owner-membership cardinality and consistency, source and target date types, receipt metadata foreign keys to both Storage and businesses, required core relations, RLS, and recognized policy names. Any ambiguity or unsupported schema aborts the transaction. Full live schema/policy inventory still needs review before running this against production.

## Requirement review

| Requirement | Reviewed implementation |
|---|---|
| All billing tables | Creates subscriptions, billing_environment, billing_orders, payment_events and billing_notifications |
| Exact billing RPC | No arguments; RETURNS TABLE with eight fields listed below; PostgREST returns an array of rows; current frontend requires one row for the business UUID |
| Existing users/data | No changes to auth.users; no application records deleted; existing profile/business/category/expense/membership/receipt values preserved; missing owner memberships and Storage metadata may be inserted |
| Existing trial deadlines | If businesses.trial_ends_at already exists as non-null timestamptz, preserves that exact value. Otherwise derives created_at + interval '30 days'. Missing original dates or ambiguous/null explicit deadlines cause an error; no new 30-day trial on repair |
| New trial | Authenticated, email-confirmed bootstrap creates one business/subscription atomically; repeat/concurrent logins reuse them |
| Server restrictions | Expense/category writes and receipt uploads/deletes use can_write_business. Expired users retain reads/exports; no browser billing mutation policy or privilege |
| Sandbox | billing_environment starts sandbox; R69 checkout amount unchanged; provider-mode checks prevent cross-environment entitlements; existing backend sandbox flags/pricing untouched |
| RLS/grants | All eleven tables have RLS. Subscription tokens/environment/notification data are not browser-readable; billing writes and provider RPCs are service-only. Removes inherited client/PUBLIC table privileges, including TRUNCATE |
| Non-destructive execution | No DROP TABLE, DROP SCHEMA, TRUNCATE or record cleanup. Known policies/triggers and one category FK are replaced to enforce the existing contracts; no records are removed. Invalid existing data/unknown policies fail instead of being silently corrected |
| Receipt privacy | Retains the existing private `nexora-receipts` bucket; enforces 5MB JPG/PNG/PDF limits, tenant-scoped access and subscription-gated writes; refuses unknown Storage policies for manual review |

The eight RPC fields are:

```sql
RETURNS TABLE (
  business_id uuid,
  trial_days integer,
  trial_ends_at timestamptz,
  status text,
  paid_until timestamptz,
  cancel_at_period_end boolean,
  can_write boolean,
  has_subscription boolean
)
```

`paid_until` can be NULL. Trial days and access are calculated from database time; the browser cannot choose deadlines or activate subscriptions. Bootstrap still takes the named argument `business_name text` and returns a UUID scalar.

## Corrections made during this review

- Preserve a pre-existing explicit trial deadline rather than always deriving one from creation time.
- Reject NULL business currency rather than rewriting a stored value.
- Add fresh enforced amount/status/currency/tenant constraints so an unrelated existing constraint with a familiar name cannot substitute for validation.
- Revoke broad inherited/default grants, especially TRUNCATE, on all application tables and rebuild only the intended browser grants.
- Explicitly revoke anonymous execution of onboarding/billing access helpers.
- Use built-in gen_random_uuid for new billing IDs, avoiding reliance on uuid-ossp in a partial installation.
- Refuse unknown Storage policies instead of silently leaving a potential permissive-policy bypass.

The generator `node scripts/build-reconciliation.mjs` reproduces the complete migration from the existing source migrations and these explicit repair adjustments. Source migrations 001–004, frontend pricing and PayFast code were not changed during this review.

## Verification interpretation

Run the complete verification file after success. Expect:

- Five billing tables exist, all RLS enabled; all eleven application tables have RLS.
- billing_access has eight exact output names/types; authenticated execution true and anonymous false.
- One subscription per existing business and all original deadlines match (verify before sandbox payment events, which can legitimately shorten trials).
- Sandbox environment, all client billing write/TRUNCATE checks false, provider-token SELECT false and provider-mutating RPCs service-only.
- Private receipt bucket.
- Core counts unchanged, except owner membership/receipt metadata counts can increase through missing-row backfills.

The final verification block uses a read-only transaction to simulate an authenticated existing confirmed owner and calls only billing_access. It does not call bootstrap or create records. It validates policy/RPC behavior, not actual email delivery or browser login. An ordinary administrative SQL Editor call to billing_access outside that block normally returns no rows because auth.uid() is NULL.

After SQL checks, use the real frontend at http://127.0.0.1:3000/login. Log in with a confirmed account, retry dashboard loading and verify its billing state, then test two-account isolation, expenses, receipt access and exports. Do not declare the live database fixed until these checks pass. PayFast stays sandbox; real provider checkout/ITN lifecycle still requires merchant test credentials and a reachable callback.

## Local test results

The disposable PostgreSQL harness validates both ordinary migrations and the conditional six-table repair. Cases include existing expenses and receipt metadata, all existing core row values preserved, original expired trial calculation, explicit original deadline preservation, broad default grants removed, exact eight-field billing RPC, trial/cancellation/replay restrictions, tenant isolation, idempotent/concurrent onboarding and refusal to replay against billing state. The SQL Editor verification queries are exercised against the repaired local database. An additional invalid-amount case verifies complete rollback of billing DDL and preservation of the original invalid and valid expense records.

No production credentials were invented, no remote SQL was executed, and nothing was pushed or deployed. Live verification remains pending your execution and results.
