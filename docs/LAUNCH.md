# Launch instructions

1. Create a separate Supabase staging project and a separate production project. Store credentials in environment configuration, not chat or committed files. Copy `.env.example` to `.env` for local development.

2. Back up any existing project before migration. For a new project apply 001 and then 002. For an existing 001 installation, check these queries first; all must return no rows. Correct any problems deliberately before applying 002, which runs transactionally and does not delete expense data.

```sql
select owner_id,count(*) from businesses group by owner_id having count(*)>1;
select id from expenses where amount<=0 or status not in ('Pending','Approved');
select e.id from expenses e join categories c on c.id=e.category_id where c.business_id<>e.business_id;
```

The product currently supports one owner/account per business. Multi-user invitation and approval workflows were only advertised in the old template and had no working implementation; they are not included in this build. Duplicate owner businesses need a deliberate migration decision rather than automatic merging or deletion.

3. Enable Supabase email/password Auth with email confirmation. Set Site URL to the HTTPS site origin. Add exact permitted redirect URLs ending in `/dashboard` and `/reset-password` (and local equivalents for development). Set the password minimum to at least eight characters. Configure a verified SMTP sender for NEXORA; install confirmation, recovery, email-change and magic-link templates from `supabase/templates`. Email image URLs resolve from the configured Site URL. Verify email delivery, image loading and expired/reused recovery links with real accounts.

4. Create/configure the Payfast sandbox merchant account. Confirm recurring billing is enabled on that account and set the security passphrase. Payfast documents monthly subscriptions, recurring API cancellation and sandbox testing: https://payfast.io/features/subscriptions/ and https://developers.payfast.co.za/docs and https://developers.payfast.co.za/api.

5. Set `PAYFAST_MODE=sandbox`, `PAYFAST_LIVE_ENABLED=false`, the sandbox merchant ID/key/passphrase, `APP_ORIGIN`, and the public HTTPS `PAYFAST_NOTIFY_URL` ending in `/api/payfast/notify`. Set server `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Keep the database `billing_environment` row in sandbox mode. Payfast requires public HTTPS URLs; localhost cannot receive ITNs. Preparing these settings does not authorize deployment.

6. Run all commands in README's verification section. After approval to stage the application, test real signup, confirmation, login, recovery and receipt uploads using two different accounts. Attempt direct cross-business reads/writes with each account's public session token. Verify PDF/JPG/PNG and size enforcement by actual Supabase Storage. Expire a test trial through the SQL editor and verify reads/exports still work while inserts/updates/deletes are rejected.

7. On the approved HTTPS staging site, exercise Payfast checkout, initial successful ITN, exact/duplicate/reordered ITNs, a recurring success, a failed renewal and cancellation. Verify signature/amount/merchant/source-IP failures cannot grant access. Verify a frontend return URL never activates billing. The reverse proxy must overwrite forwarding headers and only its exact CIDRs should be trusted. Confirm monthly billing dates, gross amount R69, cancellation retries and provider tokens against the merchant dashboard. Test cancellation after an overdue renewal too.

8. Validate renewal notifications and the merchant's handling of failed/locked subscriptions. The app logs signed failed/pending/cancelled events and expires access from PostgreSQL time; it does not automatically charge cards itself. A complete payment extends paid access by one calendar month. Duplicate provider payment IDs do not extend access, and multiple successes received within 20 days do not grant extra periods. If a merchant issues an extra legitimate charge inside that window, reconcile/refund it explicitly; do not silently charge customers twice. No automatic refund flow is included.

9. For production, use a clean production Supabase project with migration 001+002 and production Auth/SMTP settings. In the SQL editor set the billing environment:

```sql
update public.billing_environment set mode='live' where id=true;
```

Set production Payfast credentials, `PAYFAST_MODE=live`, `PAYFAST_LIVE_ENABLED=true`, production HTTPS URLs, and production public Supabase build values. Sandbox paid entitlements are excluded when the database is in live mode. Keep staging records in staging. Do not repoint a production account at sandbox credentials; switching modes in an already-used database requires deliberate merchant/token reconciliation.

10. Build the client and server; configure production HTTPS and exact trusted proxy CIDRs. Enable backups, logging, webhook failure alerts and gateway rate limits for multiple server instances. Review the merchant dashboard regularly for failed/locked subscriptions and compare received ITNs with payment history. Request approval before any push or deployment. Once approved and configured, validate one controlled live purchase, renewal schedule and cancellation before public launch.

Cancellation ends future automatic renewals while already-paid access remains until paid_until. Subscribing during a trial charges R69 immediately and ends the free trial once verified payment succeeds. After expiry, accounts retain login, reports, billing history, CSV export and private receipt download access. No scheduled deletion or trial-reset path exists.
