# Shared Loyalty Tree Benefits

This adds a separate, verified LT membership, shared LT Points, and merchant coupons. Existing merchant points, stamps, rewards, billing, and Wallet serials retain their existing meaning. A card scan alone never earns LT Points.

## Current launch state: Coming Soon

**LT Points remains Coming Soon.** The independent backend environment variable `LT_BENEFITS_PUBLIC_LAUNCH` defaults to `false`. Leave it unset or false for this release. Even when an operator has enabled the existing feature/database switches to prepare offers, customers cannot request OTPs, link/open LT accounts, claim/redeem coupons, provision LT profiles or earn LT Points. Public config reports Coming Soon without querying the database. Frontend flags cannot bypass the API guard. Existing business cards, stamps, merchant points and rewards continue normally; registration email stays optional and the QR opens the usual card form. Refund corrections for previously awarded LT purchases remain available.

The email-only shared identity, shared-QR choices and required LT email described below are **future launch behavior**, ready for review but not activated by these code changes or migrations. Launch requires an explicit backend `LT_BENEFITS_PUBLIC_LAUNCH=true` **and** the existing `LT_BENEFITS_ENABLED=true` **and** enabled database settings. No migration or admin setting flips the independent launch flag.

## Setup and rollout

1. Run `backend/lt_benefits.sql`, then `backend/lt_benefits_upgrade.sql`, in Supabase SQL Editor. Fresh installs include visible-change Wallet queueing; on databases migrated before that optimization, also run `backend/lt_benefits_visible_updates.sql` (rerunnable). Also apply `backend/lt_benefits_coupon_limits.sql` for existing installs (see [coupon management notes](README-lt-benefits-coupons.md)). **Apply `backend/lt_benefits_email_identity.sql` last**, after the upgrade and any visible-update addon. Fresh installs also need the email identity addon. These migrations are rerunnable and require the existing `customers` and `businesses` tables. Do not reapply the old base or visible-update function definitions afterward without reapplying the email identity addon. Tables and RPCs are restricted to the backend `service_role`; do not use the browser's anon key for them. The upgrade migration leaves existing cards opted out and defaults future customer rows to the LT card version.
2. Configure `LT_BENEFITS_AUTH_SECRET` to a stable, random secret of at least 24 characters. A configured `STAFF_SESSION_SECRET` is accepted as a fallback. Never put either secret in frontend environment variables. Existing email provider settings and the existing `send_email` function deliver verification codes.
3. Keep `LT_BENEFITS_PUBLIC_LAUNCH=false` for the Coming Soon release. Leave `LT_BENEFITS_ENABLED=false` while reviewing the migration and merchant offers. The migration initializes database `ltb_settings.enabled=false` as a second switch. Those two setup switches alone do not launch the public feature. Enable all three switches only after explicit launch approval; an admin can change the database switch through the protected settings endpoint. Disabling pauses customer operations and earning without deleting balances or previously issued coupons. Refund corrections remain allowed while either switch is off; the integration must keep processing refunds for previously awarded purchases.
4. Run the normal wallet background worker with `service.process_wallet_jobs(sync_member, limit=5)` outside the async event loop. The callback only queues existing per-card wallet sync jobs and must raise or return `False` when enqueueing fails. A durable member/version lease retries failed or interrupted batches. No bulk pass generation runs in the benefits request.
5. Run `service.maintenance(limit=10)` periodically outside the event loop. It refreshes expired coupon counts and Wallet revisions for at most ten members, then deletes at most 500 expired challenges and 500 expired sessions per call. Repeated calls do not notify the same coupon expiry twice.
6. The LT worker calls the admin upgrade service's `tick(limit=2)` every twenty seconds outside the event loop. It queues at most two cards per tick, with a durable cursor, pending batch, lease and retry backoff. It never renders a batch of passes in the admin request.

When disabled, `/api/v1/benefits/config` returns a safe unavailable state and optional Wallet projection lookup returns `None`. A missing migration fails closed with HTTP 503. Public and private benefits API responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Future launch: shared QR, email verification, and automatic accounts

The existing business QR (`/join/{business}`) offers **Get my loyalty card** and **My LT Points & Benefits**. Benefits also opens from the existing signed Apple/Google Wallet link or `/benefits`. There is no password or separate account-registration form. Email OTP is sent only if that email currently has an eligible LT-enabled business customer registration. Unknown emails receive the same generic response, with no code, challenge row or account created; use **Get my loyalty card** first. Eligibility is checked again before consuming the code. A previously verified profile with no remaining eligible card cannot obtain a fresh email OTP session, though an existing valid session retains access to its owned balance and history. All private account data, catalog access and claims still require the separate opaque Benefits session; a QR or card link alone cannot access a shared balance.

After public launch, new business customer registration requires a valid email, with an explanation that the same email connects eligible LT Points cards. Phone is still collected for the business's existing membership behavior, but it is not an LT identity key. New signup gender options are Male, Female and I’d rather not say; historical records remain readable.

For new or admin-upgraded cards, background setup creates an isolated **pending** LT profile for that card and sends no email. A stranger entering somebody else’s email cannot view that person’s existing shared points through the new card. Eligible confirmed purchases can accrue on the pending profile. If setup is temporarily unavailable, merchant registration still succeeds and signed Benefits entry retries it. Existing cards without `lt_benefits_card_enabled=true` stay opted out until the Super Admin upgrade.

Successful email OTP atomically consolidates eligible LT profiles and cards with the same normalized email, even when their phone numbers differ. No profiles are merged or contacts trusted merely by running the migration. A verified, unexpired LT session can link another matching-email card without another code; new signup can pass that separate session as an optional bearer. Without that session, email verification is needed before sharing. Cards with another email do not link.

Example: Business A’s card has 5 LT Points and Business B adds 2. After verification/linking, both native card projections and the Benefits account show 7 LT Points. Each business’s own stamps/points stay unchanged. Wallet delivery uses the existing durable background outbox, so device refresh is asynchronous; OTP does not build passes or wait for Apple/Google delivery.

Legacy profiles retain their immutable ledger rows, purchase/refund sources, coupon snapshots and original idempotency keys. Explicit transfer entries balance merged aliases; purchases, active cards and coupons point to the canonical member. Partial spending carry combines within each immutable rule version, including any newly earned whole point. Old claims count toward the shared per-member cap. Conflicting historic idempotency keys are retained and return a conflict instead of silently dropping a coupon. Replays return the original coupon with the current shared balance. Revoked-card clears, including leased work, retain their source ownership. The merge touches native projections once, and indexed normalized-email lookups avoid scanning every business.

A real email change revokes that card, clears its Wallet projection and invalidates sessions sourced from that card. Phone edits and email case/whitespace edits preserve email identity. A generic email session continues to access the original email account; the changed card needs proof of its new email. At most 100 eligible cards can consolidate; inconsistent historical earning rates or larger accounts fail atomically for support review, without altering balances.

Email codes expire after ten minutes, allow five attempts and have a sixty second resend cooldown, five sends per email and twenty per client hash per hour. Only code HMACs and bearer SHA-256 hashes are stored. Sessions last sixty days or until logout/revocation. Email delivery, migration and feature activation must be verified separately in staging; this code change does not enable any LT Benefits launch switch.

Never log codes, bearer tokens, signed card URLs, email addresses, phone numbers, or raw RPC payloads. The optional log callback receives only `lt_benefits_unavailable` (`action`, `error_type`) and `lt_benefits_wallet_retry` (`member_id`, `error_type`).

## API

All money is integer **centavos**; points are integers. Dates include timezone offsets. Pagination uses `limit` (1–100) and `offset` (0–10000), with `has_more`.

- Public `GET /api/v1/benefits/config` → `enabled`, `available`, `coming_soon`, `public_launch`, `pesos_per_point`, `currency`, optional `requires_sql`. Prelaunch returns Coming Soon with no database call.
- LT bearer `GET /api/v1/benefits/offers` → `offers`, `has_more`, `limit`, `offset`. Only active, in-window offers with stock are listed.
- Signed card `POST /api/v1/benefits/entry` → `{customer_public_id,card_token}` returns only masked contact, business name and whether a matching verified email session linked this card. The proof stays in the body, not backend query/access logs.
- `POST /api/v1/benefits/auth/request-code` → body `{consent:true,customer_public_id,card_token}`; generic `{challenge_id, expires_in:600, retry_after:60, message}`; never a code or contact address.
- `POST /api/v1/benefits/auth/email/request-code` → `{email,consent:true}`; the same generic challenge response, for passwordless site/shared-QR entry. No account-existence disclosure.
- `POST /api/v1/benefits/auth/verify` → `{challenge_id,code}`; returns `{access_token,token_type:"bearer",expires_in:5184000,member:{id,email_masked},linked}`.
- LT bearer `GET /api/v1/benefits/me` → member, signed `balance_points`, nonnegative `available_points`, cards, coupon snapshots, activity, has_more.
- LT bearer `POST /api/v1/benefits/link` → `{customer_public_id,card_token,consent:true}` links a signed card only when its current normalized email matches the verified account.
- LT bearer `POST /api/v1/benefits/offers/{id}/claim`, with `Idempotency-Key` → coupon snapshot and updated balances. A key replay returns the original result; changed intent with the same key returns 409.
- LT bearer `POST /api/v1/benefits/logout` revokes the current session.
- Signed owner `GET/POST /api/v1/business/{slug}/lt-benefits/offers`; `PATCH /.../offers/{id}`; `GET /.../report`.
- Super admin `GET /api/v1/admin/businesses/{slug}/lt-benefits/card-upgrade` returns availability, total/eligible/enabled card counts and the latest rollout (`id`, `status`, `total`, `scanned`, `queued`, `failed`, `skipped`, `remaining`, optional `error_type`). `POST` with `{confirm:true}` starts or resumes the business's bounded update. Owner sessions and staff PINs cannot authorize it. The former owner upgrade routes are not registered. Completed means queued for Wallet processing, not confirmed delivery to a phone.
- Signed, business-scoped staff or owner `GET /api/v1/business/{slug}/lt-benefits/customer/{customer_public_id}` recognizes any linked business card but returns **only the current merchant's** coupons. It exposes no cross-merchant transactions or contacts.
- Signed staff/owner `POST /.../lt-benefits/coupons/{id}/use`, with `Idempotency-Key` and `{customer_public_id,bill_amount_centavos,receipt_reference?}`. The bill must meet the snapshot minimum spend and discount value. Exactly one successful redemption is possible; LT Points are not charged twice.
- Existing admin auth `GET/PUT /api/v1/admin/lt-benefits/settings` → `enabled`, `pesos_per_point`, `rule_version`, `max_points_per_transaction`, `updated_at`.

Offer fields: title, description, terms, HTTPS image_url, category (`food_drink`, `shopping`, `wellness`, `experiences`, `other`), discount_centavos, points_cost, total_quantity, per_member_limit, weekly_limit (optional), min_spend_centavos, starts_at, ends_at, coupon_valid_days, and status (`draft`, `active`, `paused`). Lists include claimed/used/expired counts and remaining quantity. Draft is the create default. Claim snapshots preserve title, value, image, terms, points cost, and minimum spend even after an owner edits the offer. The claim window is `starts_at`/`ends_at`; issued coupons expire at the earlier of `ends_at` or claim time plus `coupon_valid_days`.

## Earning, carry, refunds, and idempotency

Only trusted backend purchase hooks call:

```python
service.earn(customer_public_id, business_id, source_type, source_id,
             amount_centavos, currency="PHP")
service.reverse(business_id, source_type, source_id, refund_id, amount_centavos)
```

The amount is confirmed **after discounts**, not a scan count or an arbitrary public request value. The caller authenticates cashier/owner inputs and supplies one stable purchase/receipt source across local loyalty engines. `(business_id,source_type,source_id)` is unique. Retries do not earn twice; conflicting amounts or card IDs return a conflict. Unlinked cards and non-PHP purchases do not earn. A missing migration must be caught by the integration so optional LT awards cannot fail the existing merchant transaction; durable source retries are recommended.

The default is one LT Point per ₱500. Eligible spend carries across linked businesses for the same member. Integer centavos and an immutable rule version avoid floating-point drift. Changing the rate starts a new earning bucket; an old bucket's remainder stays associated with its old rule and is not revalued. Partial and full refunds reverse the corresponding spend using that original rule. The same refund ID is idempotent; total refunds cannot exceed a purchase. A refund arriving before a delayed award is retained as a durable source tombstone and applied before any later earning; it cannot be lost because the original award has not arrived yet. If already-spent points are refunded, the LT balance may become negative; available points stay zero until later earning clears that debt.

`max_points_per_transaction`, when configured, rejects an above-cap award as `needs_review` without consuming its source or changing balances; it does not silently discard or carry excess spend. The default is no cap. There is no public endpoint for minting LT Points.

Ledger rows are append-only. Claim locks the member and offer, checks balance, inventory and claim limit, inserts a coupon, debits points, records the immutable snapshot, and writes the Wallet outbox atomically. Redeem locks the member and coupon, validates business and expiry, and records one use atomically. Local merchant balances are untouched throughout.

## Wallet performance

The migration adds nullable `customers.lt_member_id`, `lt_points_balance`, `lt_points_version`, `lt_points_updated_at`, and `lt_coupon_count`. Link/earn/refund/claim/use update a native projection in the same transaction only when the rendered nonnegative balance, linked identity or that merchant’s active coupon count changes. Apple Add reads them in its **existing customer query** and makes no extra LT RPC call. Existing `customers.updated_at`, merchant reward counts, serials and stamp-art rendering keep their existing behavior. Signup Apple Add goes directly to its pass endpoint, independently of Google preparation. The separate wallet page also shows its direct Apple Add link while its preview and Google Save URL are loading.

The optional `wallet_projection(customer_public_id)` is one RPC with at most eight merchant coupons, cached for ten seconds with a strict 128-entry bound. Mutations and wallet jobs invalidate it. It is for optional site/projection use, not the Apple Add hot path. Outbox generations increase independently of member revisions, so acknowledgement preserves an earning or contact-change update that arrived while a batch was processing. Jobs include revoked cards to refresh their cleared projection.

### Visible changes and Wallet notifications

Every confirmed purchase, carry update, refund and ledger row is still saved. Member activity timestamps also advance. A purchase below the next LT Point threshold, a refund that changes only carry, or debt moving between negative balances and zero does **not** revise native Wallet fields or queue LT pushes while the displayed balance remains zero. Re-verifying an already-linked card also avoids a redundant update. The signed balance and debt remain available on the Benefits site; native pass projections use the rendered nonnegative balance.

First link and relink still update the affected card. A visible balance change updates all active cards that display it; coupon usage and expiry update only cards for the merchant whose displayed coupon count changed. Contact revocation still clears and updates that card. Merchant stamps, merchant points, announcements and their existing Wallet updates are independent and retain their current behavior.

The LT worker measures current resident memory and pauses above 350 MiB. It resumes when memory falls; the lifetime peak cannot keep it paused. Apple Add runs through its existing path.

The durable member outbox stores per-card change tokens in `dirty_cards` and captures them in `claimed_cards` for each lease. A successful enqueue acknowledgement removes only the tokens captured by that lease. Newer changes to the same card, a new link, or a contact revocation remain pending; failed/expired leases retain their targets for retry. Queueing remains distinct from confirmed device delivery. The addon migration retains existing queued and in-flight work, including revoked-card clears, without replaying purchases or modifying financial history.

## Validation

`backend/tests/test_lt_benefits_identity.py` runs the actual additive migration twice in isolated PGlite and tests no pre-OTP merge, wrong OTP, 5+2 shared balances, carry/refunds across legacy profiles, coupons/per-member caps, historical claim replay and key collisions, email versus phone edits, email-away/back isolation, unknown-email non-enrollment, opt-out and local reward preservation, pending-card isolation, revoked-card outbox leases, rollback/retry, addon ordering, and service-only grants. These are real PostgreSQL-engine transactions; PGlite serializes calls, so multi-session contention still requires staging PostgreSQL.

`backend/tests/test_lt_benefits.py` checks endpoint gating, separate sessions, verified-link ownership, strict owner/staff/admin scope, non-secret response/logging behavior, request idempotency propagation, native projection SQL, bounded caches and wallet retry handling. Optional isolated PGlite integration checks exercise the actual migration, competing claim/redeem request bursts, purchase carry, partial/full refund replay, refund-before-earn, contact revocation, coupon expiry, rule changes, caps, and service-only grants; they never contact production. PGlite serializes connections, so these checks do not replace a full PostgreSQL multi-session lock contention test. See the test module's `LT_BENEFITS_PGLITE` and `LT_BENEFITS_NODE` variables for a local PGlite runtime.

`backend/tests/test_lt_benefits_visible_updates.py` executes the actual base and visible-update migrations in isolated PGlite, checking zero/carry earning and refunds, negative balances, repeat OTP/linking, first link, merchant-specific coupon usage/expiry, revoked-card clears, newer changes during leases, lease failure/expiry, and preservation of legacy in-flight jobs. Fresh and addon function definitions are checked for parity.

The upgrade tests execute the actual addon migration twice, verify old/new defaults, platform admin authorization and selected-business scope, and exercise crash recovery, deletion/reassignment, renamed slugs and partial batches. Native layout tests run the real pass/class builders without provider calls. Wallet sync regressions verify that automatic design edits publish both class versions, and a successful balance fallback after a failed LT class move remains retryable. Frontend checks cover progress, availability and visible-tab polling. Real-device appearance, email delivery and add latency still require staging validation.

## Existing purchase integration

Signed cashier/owner purchase actions snapshot exact centavos, currency and a stable audit reference. Legacy unsigned local reward actions continue working but cannot create LT Points. This is confirmed merchant entry, not independent proof of a paid receipt; participating merchants still need operational review for inflated/fictitious sales. Zero-value stamp visits do not mint points.

Live POS Companion sales snapshot the provider final net amount separately from the merchant's own gross/net earning setting. The snapshot is shared across local engines and awarded only after `loyalty_applied`. Simulators and test mode never earn network points. Successful manual and POS purchases with a temporary LT outage are retried in bounded batches of ten every fifteen seconds. Cap rejections are recorded for review rather than silently credited. StoreHub voids reverse the exact saved source, including while LT earning is paused; a failed correction keeps the existing durable void marker pending. Future integrations must call the same refund hook for their own authoritative refunds.

## Existing Wallet rollout

The LT mark is composed from small cached Wallet artwork. Front fields retain merchant rewards; Apple adds LT Points within its field budgets. On iOS 27, a `membershipBenefits` featured action opens Benefits; an existing Order Ahead action can occupy the second slot. The Benefits back-field link is always present as the fallback for older iOS. Native labels and rendering are controlled by Wallet. See Apple's [Wallet featured actions](https://developer.apple.com/videos/play/wwdc2026/209/).

Google adds LT text modules, a primary Benefits link and the spare secondary points slot where available. Enabled cards use a separate LT class for each existing program/tier, so changing their shared layout cannot alter cards that have not opted in. The LT class is prepared before object migration or a new Save URL; normal publishing and design refreshes update both versions. Hybrid cards keep their merchant status. Account linking and point changes queue existing Wallet sync jobs; they do not render passes or contact Apple/Google during coupon requests. Apple updates mark the pass changed before APNs so a device can fetch the new version.

Super Admin opens **Admin → Businesses → select a business**, chooses **Update all cards to LT Benefits**, reviews the selected business and scope, then confirms. Progress and retry controls are in the same panel. Business owners retain coupon management and cannot start card upgrades. Ordinary card publishing does not opt old cards in. The job snapshots eligible cards, persists progress across restarts and supports retry after failure. Deleted or reassigned pending cards become skipped, rather than blocking the batch or counting as queued. Future customer rows default to the new version after the migration; no bulk historical contact merge occurs.

For an authorized operator rollout, `python -m backend.lt_benefits_rollout --max-cards 25` is a read-only preview. Add `--apply --batch-size 5` only after migration and activation. It first enables each card with a business-scoped update, then queues its normal Wallet job. It reports resumable `--after-id`/`--through-id` checkpoints and never builds passes in the command. The super admin button is the normal per-business rollout control. Provider/device caching controls when artwork changes.

Before public activation, verify one real Apple card and one real Google card, email delivery, shared-point propagation and a cashier coupon against a staging database. No production migration, provider push, real email or deployment was performed during this build.

## Operational events

Existing JSON logging is reused. New events contain IDs and exception types only:

- `lt_benefits_unavailable`: `action`, `error_type`.
- `lt_benefits_wallet_retry`: `member_id`, `error_type`.
- `lt_points_award_failed`: `business_id`, `audit_id`, `error_type`.
- `lt_points_review_required`: `business_id`, `audit_id`.
- `lt_points_pos_snapshot_retry`: `transaction_id`, `error_type`.
- `lt_points_pos_award_failed`: `business_id`, `transaction_id`, `error_type`.
- `lt_points_pos_review_required`: `business_id`, `transaction_id`, optional `error_type`.
- `lt_points_pos_refund`: `business_id`, `transaction_id`, `sources`.
- `lt_benefits_worker_retry`, `lt_wallet_branding_unavailable`: `error_type`.
- `lt_benefits_memory_pause`: `rss_mb` (current resident memory).
- `lt_benefits_rollout_progress`, `lt_benefits_rollout`: mode, bounded counts, checkpoint IDs and optional `error_type`.
- `lt_card_upgrade_unavailable`: `action`, `error_type`.
- `lt_card_upgrade_started`: `business_slug`, `rollout_id`.
- `lt_card_upgrade_retry`: `business_slug`, `rollout_id`, `error_type`.
