# LT Benefits coupon editor fixes

For an existing installation, run `backend/lt_benefits_coupon_limits.sql` before
deploying the updated coupon editor. It is rerunnable and preserves identities,
balances, existing coupons and Wallet queue changes. Fresh installations include
the same behavior in `backend/lt_benefits.sql`. No new environment variables.

Coupon photos now upload from the browser directly to Cloudinary with an
owner-authorized, business-scoped signature. JPG, PNG and WebP files up to 5 MB
are accepted. The editor saves the returned public HTTPS URL, never base64 image
data. Uploads have a 45-second deadline, can be canceled, and block Save while
running. Failed uploads keep the previous photo. A manually entered HTTPS image
URL is still supported. Image bytes bypass Render; the owner bearer is sent
only to the Loyalty Tree API. Cloudinary receives the short-lived upload
signature and public API key. The existing Cloudinary configuration remains
required.

Minimum bill values now save in exact centavos on create and edit. Existing
claimed coupons keep the minimum bill, photo, discount and terms captured when
they were claimed; offer edits apply to future claims.

`weekly_limit` is an optional whole number from 1 to 1,000,000. Blank/null means
unlimited. It limits the **total successful claims for one offer across all
members**, Monday 12:00 AM through the next Monday 12:00 AM in `Asia/Manila`.
Used and expired coupons still count against the week in which they were
claimed. Lifetime inventory and per-member limits also apply. Editing or
pausing an offer does not reset its weekly count; increasing/removing the cap
can permit more claims immediately. Stock does not replenish automatically.

The claim transaction locks the member and offer before checking the weekly
count and atomically issuing/debiting a coupon. An indexed range query counts
claims; no in-memory counter, cron reset or extra provider request is needed.
Successful retries with the same idempotency key return their original coupon
before checking limits and never consume another slot or debit points again.
Denied requests do not reserve stock or consume their key, so they can retry
after a weekly reset. Reusing a successful key for a different offer conflicts.

`frontend/tests/benefits-management.test.mjs` covers uploaded URL save/create/edit,
file/URL validation, provider errors, weekly form roundtrips and exact minimums.
`backend/tests/test_lt_benefits_coupons.py` checks strict API validation, scoped
upload signing and the actual SQL in a disposable local PGlite runtime. SQL
checks cover addon/fresh parity, reruns, unknown-version rollback, competing
claim requests, replay, timezone boundaries, edits and immutable snapshots.
PGlite serializes sessions; live multi-session PostgreSQL contention and real
Cloudinary uploads still require staging validation.
