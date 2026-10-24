# Atomic subscription payments

Apply `subscription_fulfillment.sql` in Supabase **before deploying this code**.
It is rerunnable, changes no business expiry, refuses duplicate provider intent
IDs atomically, and grants the fulfillment RPC only to `service_role`.
No new payment credentials are required. Use the existing subscription PayMongo
webhook secret; the separate Order Ahead test secret cannot authorize renewals.

New checkout attempts store the processor amount/currency, live/test mode,
billing cycle, setup-kit snapshot and optional onboarding `billing_session_id`.
Checkout checks the migration before creating a provider intent and never
exposes its QR/client key if the attempt cannot be persisted. A missing migration
fails closed with 503 instead of silently continuing.

The webhook calls one transactional `subscription_fulfill` RPC. It locks the
payment and business/referrer rows, checks the stored attempt and provider
context, then extends access and marks the payment fulfilled together. Monthly
access remains 30 days; prepaid terms remain 3/6/12 calendar months. Early
renewals and unexpired promotional access are preserved. PENDING is activated;
SUSPENDED/REJECTED is never silently reactivated. Setup-kit settlement and the
first-payment referral month are included in the same transaction. Partner
commission and admin email retain their existing best-effort postcommit behavior.

Database failures and missing known subscription attempts return 503 so the
provider can retry. Replays never credit another term. Late failed/expired
events cannot overwrite a paid payment. Unrelated merchant events are ignored;
invalid subscription amounts/currency/provider context are rejected without
changing entitlement.

## Historical payments and release sequencing

Old `paid` rows have no trustworthy atomic-fulfillment marker. The migration
marks them `legacy_review`; receiving their webhook again acknowledges them
without adding access. Old pending attempts without a stored context are also
flagged for review instead of guessing their billing/setup-kit details.

Before activation, reconcile any in-flight attempts or previous paid-but-locked
accounts against provider receipts and their existing paid-through dates. Do
not clear the review flag or synthesize a context and blindly replay a payment.
Any correction must account for access already granted. Review candidates using:

```sql
select public_id, paymongo_payment_intent_id, business_id, status,
       paid_at, fulfilled_at, fulfillment_status
from public.subscription_payments
where fulfillment_status = 'legacy_review'
   or (fulfillment_context is null and status = 'pending');
```

Deploy frontend billing authorization compatibility with the corresponding API
guards. Expired owners must still be able to renew; first-time PENDING signup
uses a scoped onboarding billing capability, not a predictable business slug.
Keep the additive migration if rolling application code back. A rollback to the
old webhook loses transactional fulfillment guarantees and needs operational
review; do not run both fulfillment implementations concurrently.

## Verification

`test_subscription_fulfillment.py` executes the actual migration twice in an
isolated PGlite PostgreSQL engine when the existing local runtime is available.
It covers transaction rollback after merchant/setup-kit writes, retry, replay,
calendar/trial preservation, referral-once behavior, invalid contexts, legacy
review, late events, duplicate preflight and RPC permissions. Python tests also
exercise the real webhook boundary and retryable database errors.

PGlite serializes its connection: this does **not** prove contention across
separate PostgreSQL sessions. Before production enablement, validate concurrent
same-intent and different-intent renewals against staging PostgreSQL and exercise
the provider's test webhook flow. No real payments or production DB changes are
part of these tests.

Events: `subscription_fulfilled` (info: `business_slug`, `billing_cycle`,
`referral_rewarded`), `subscription_fulfillment_review` (warning: `reason`), and
`subscription_payment_email_failed` (warning: `error_type`). The normal global
error monitoring records retryable request failures. These events contain no
customer contacts, card details, credentials or raw provider payloads.
