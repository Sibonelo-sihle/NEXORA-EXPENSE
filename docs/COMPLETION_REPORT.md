# NEXORA Expense — completion report

9 October 2026. Implementation and local verification are complete. Live-service acceptance and launch remain blocked by external configuration. Nothing was committed, pushed or deployed, and no remote database or merchant account was changed.

## Implemented

- Supplied official NEXORA artwork, extracted symbol/wordmarks, favicon, shared branding across marketing, auth, dashboard/sidebar/mobile navigation/footer, and branded Supabase email templates. The requested slogan is displayed correctly. Third-party license notices are retained in the shipped public artifact.
- Premium navy/violet marketing page with the single R69/month plan and a free 30-day trial. Responsive app navigation, mobile expense cards, chart dashboards, clear empty/error/loading states and accessible form labels.
- Real Supabase password authentication, signup, email confirmation redirect, persistent session restoration, recovery and password updates. The old fake localStorage login is removed. Workspace creation requires a confirmed email in PostgreSQL.
- Atomic one-business-per-owner onboarding, profile/business settings, default categories and a server-clock trial. No card required and no automatic charge at signup.
- Real PostgreSQL-backed expense creation/editing/deletion, search/category filtering, cent-based totals, profile/business persistence, category creation/renaming/deletion, live dashboard/report aggregation and date-filtered CSV export. Expense reads paginate beyond Supabase's default row limit. CSV output escapes quotes/newlines and protects against spreadsheet formula injection.
- Private receipt uploads, listing, downloads, deletion, direct expense-form upload and receipt selection. PDF/JPG/PNG and 5MB limits are configured in Supabase Storage. Paths use a business UUID and random file identifier. Cross-business receipt references are rejected. Attached receipts cannot be deleted until detached. Legacy owner-prefixed attachments remain readable to their original owner.
- Additive transactional migration 002: RLS protects every tenant's data, immutable ownership protects trials, composite category relationships prevent cross-tenant assignment, and billing writes are restricted to server/service-role functions. Expired trials deny expense/category/receipt mutations while retaining reads and exports. No automatic data deletion exists.
- Payfast hosted monthly checkout in sandbox mode by default, fixed server-selected R69 price, authenticated owner checks and server-created order identifiers. Successful frontend redirects never activate subscriptions.
- Webhook verification of received-order signatures (including blank fields and exact PHP URL encoding), merchant, amount, valid Payfast source IP and Payfast's server confirmation. Verified payment events and entitlements commit atomically. Duplicate payment IDs do not extend access. Failed/pending/cancelled notifications are recorded without activating access.
- Cancellation verifies the provider response before updating local state, preserves paid-through access, supports retry after an already-completed provider cancellation, and remains available for overdue subscriptions. Billing shows renewal terms, trial/paid-through dates, recent payments and export access. Sandbox entitlement is excluded in live billing mode.
- Compiled frontend and Node server, production SPA deep links, HTTP security headers, conservative proxy handling, request limiting, dependency lock and reproducible test commands. Unused GenAI dependency and Gemini capability metadata were removed. No AI features were added.

## Evidence

| Check                         | Result                     | Scope                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                | PASS                       | TypeScript application, server and tests                                                                                                                                                                                                                                                                                                                                    |
| `npm test`                    | 10 PASS                    | Cent totals, CSV safety, fixed recurring checkout, signature tampering, API ordering, duplicate fields, merchant/amount/status/token checks, month-end dates, source-IP checks and ITN blank-field encoding                                                                                                                                                                 |
| `npm run test:db`             | PASS                       | Real disposable PostgreSQL: both migrations, unverified onboarding rejection, idempotent onboarding, tenant/receipt/category isolation, ownership immutability, positive amounts, billing write denial, expiry boundaries, retained reads/downloads, payment replay, failed-renewal paid access, payment-history isolation, sandbox/live separation and cancellation expiry |
| `npm run test:browser`        | 11 PASS                    | Chromium: authentication errors/session restoration/logout, signup confirmation messaging, recovery/password update, CRUD/search/export, receipt type validation/upload/download/picker, reports filtering, responsive marketing/auth at 360/390/768/1440px, mobile expired workspace, fail-closed API and compiled production server/security headers                      |
| `npm run build`               | PASS                       | Vite frontend and esbuild Node server; charts split into separate chunks                                                                                                                                                                                                                                                                                                    |
| Dependency installation audit | 0 vulnerabilities reported | Installed package set at verification time                                                                                                                                                                                                                                                                                                                                  |

Browser Auth/data tests intercept Supabase HTTP responses; they verify integration behavior, not actual email delivery or Supabase's hosted implementation. The SQL harness uses minimal local Auth/Storage interfaces and real PostgreSQL RLS. Actual hosted Storage MIME/size enforcement still needs acceptance testing on Supabase. Signature/source validation and database subscription lifecycle are tested locally; real Payfast checkout, ITN delivery and cancellation have not run without merchant credentials.

Visual artifacts use simulated test records, never customer financial data:

- [Desktop landing page](desktop-landing.png)
- [Desktop dashboard](desktop-dashboard.png)
- [Mobile signup](mobile-signup.png)
- [Mobile expired expense workspace](mobile-expenses.png)

## Remaining launch blockers

1. Supabase project URL/public key and server-only service-role key; apply migrations to approved staging/production projects after backup and preflight.
2. Auth confirmation/redirect settings and verified SMTP sender; install the provided email templates and verify real email delivery and recovery links.
3. Payfast merchant onboarding, recurring billing enabled, sandbox/live credentials and matching passphrase. The provider documents recurring subscriptions, but this merchant's account capability and complete sandbox lifecycle must be confirmed.
4. Approved public HTTPS staging host and authentic reverse-proxy configuration so Payfast can deliver and validate notifications. No push or deployment is authorized by this report.
5. Real-service acceptance with two tenants, real receipts and the complete sandbox checkout/renewal/failure/cancellation lifecycle before enabling live billing.

## Material limitations

The application supports one owner/account per business. Team invitations, multiple users and multi-step approvals were advertised but not implemented in the original template; they are not added here. Pending/Approved remains a simple expense status.

Subscriptions charge R69 immediately when the user chooses hosted checkout; the free trial ends on verified payment. Paid periods use calendar months. To avoid accidental duplicate period grants, distinct successful payments received within 20 days are retained as events without adding another period; exceptional extra charges need merchant reconciliation/refund. Automated refunds and background reconciliation with the merchant dashboard are not implemented. Failed/locked merchant subscriptions need operational review; the app expires access securely without deleting data.

Exports include expense records with categories/receipt references; receipt files remain individually downloadable. No ZIP backup of all receipts is included. Very large ledgers are loaded in paginated batches into browser memory for reporting/export. The request limiter is per server instance; use gateway limits for multiple instances.

The supplied source image contains a slogan typo; displayed logo crops exclude that text and the required slogan is rendered separately. Original artwork remains available in public/nexora-brand.png.

Follow [the exact launch instructions](LAUNCH.md) and [local setup/test commands](../README.md). Live-service acceptance and deployment approval are the next steps; the implementation is not represented as already live.
