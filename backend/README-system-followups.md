# System assessment items 5–9

This release adds durable Apple push retries and wallet-job leases, prepares
verified email-only shared LT Points behind a **Coming soon** gate, fixes coupon
uploads/weekly limits, and bounds frontend requests with precise provider
monitoring. Existing merchant stamps, points,
payments, card serials and per-business rollout controls retain their meaning.

## Before deploying

The existing LT Benefits base, upgrade and visible-update migrations and the
existing `wallet_sync_jobs` table must already be installed. Take the usual
database backup and run **`system_followups_5_9.sql`** in Supabase SQL Editor.
This single, rerunnable file applies the three changes in one transaction:

1. `apple_wallet_delivery.sql`
2. `lt_benefits_coupon_limits.sql`
3. `lt_benefits_email_identity.sql` **last**, after any older LT addon scripts.

Use the combined file or the individual source migrations, not both. The bundle
includes source hashes and can be checked/regenerated with
`python backend/scripts/generate_system_followups_sql.py --check` (omit
`--check` to regenerate after reviewing source changes). Its integration test
also proves that a failure in the last section rolls back the earlier sections.

Migrations install functions/tables; they do not send notifications, charge a
payment or bulk-merge customer profiles. Shared balances consolidate only after
successful email OTP verification. Do not rerun an older LT addon after the
identity migration without rerunning the identity migration last.

Deploy backend and frontend together after SQL succeeds. Keep all existing
secrets stable, especially `STAFF_SESSION_SECRET` / `LT_BENEFITS_AUTH_SECRET`.
Leave existing feature switches and business card opt-in choices unchanged.
This release does not activate LT Benefits globally or upgrade old wallets.

**Leave `LT_BENEFITS_PUBLIC_LAUNCH` unset or `false`.** It defaults to false.
Customers see Coming soon; OTP, linking, account access, earning, claiming,
automatic LT provisioning and LT wallet rollout hooks are closed. Existing
merchant signup retains optional email and its normal form until launch.
Signed owner/admin offer preparation remains available under its existing
feature/authorization switches. Refund corrections for historical awards remain
available. A future reviewed launch needs this explicit switch **and** the
existing app/database feature switches; do not enable it for this release.

## Monitoring configuration

`MONITOR_TOKEN` was absent in the inspected Render environment. Set it to a
separate strong random secret in **Render → Environment** before using the
report. For example, generate a value locally with `openssl rand -hex 32` and
enter its output there. Do not commit it or put it in a `VITE_` variable.
`GET /api/v1/admin/health-report?hours=24` requires `Authorization: Bearer <value>`.
Missing/wrong tokens remain unauthorized; a missing token logs one startup
warning and never blocks normal business requests.

No other environment variable is required to run this release. The optional
future launch switch above must remain off. Existing Cloudinary settings
sign browser uploads; image bytes go directly to Cloudinary, bypassing Render.
Provider acceptance counts do not prove that a phone displayed a notification.

## Behavior and validation

- Failed/transient APNs targets remain in a durable bounded outbox; accepted
  targets are not resent just to retry another phone. Interrupted wallet jobs
  regain a lease. Memory pressure defers work. Apple Add/pass-build caching and
  concurrency limits keep their existing fast paths.
- The future launch requires a valid email on new registrations. Passwordless
  email OTP will open Benefits from a shared business QR or Wallet link.
  Matching eligible cards then share one LT balance; phone differences no longer
  split that balance. These customer flows are Coming soon for this release.
  Gender choices are Male, Female and “I’d rather not say.” Existing historical
  profiles are not deleted by this release.
- Uploaded coupon photos save a public HTTPS URL. Minimum spend persists in
  centavos; an optional weekly offer cap is enforced under the offer row lock.
- Billing, menu and Benefits requests have deadlines. Hidden tabs pause access
  and payment polling. An uncertain payment retains its original intent;
  local expiry never automatically submits another payment.
- Unknown frontend routes show a branded 404 screen. Provider outcome summaries
  carry exact accepted, failed, deferred and queued counts with no credentials
  or customer contacts.

Run backend unittest discovery, frontend `npm test`, `npm run build`, and the
isolated PGlite SQL suites. PGlite checks transactional rollback and SQL
semantics; it serializes sessions and does not replace multi-session PostgreSQL
contention testing. Before public rollout, use staging cards to verify email
delivery, shared balances on Apple/Google, a real Cloudinary upload and cashier
coupon use. The large Render Apple burst remains a separate controlled check.

If rollout has problems, pause Benefits with its existing feature switches,
preserve payment attempts and queue rows, and deploy a reviewed compatible
backend/frontend pair. Do not delete transfers, ledgers, coupons or outbox rows
to undo a rollout; verified merges are financial history.

Details: `README-apple-wallet-delivery.md`, `README-lt-benefits-coupons.md`,
`README-lt-benefits.md` and `../frontend/README-request-reliability.md`.
