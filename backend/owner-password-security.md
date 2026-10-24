# Owner password and session migration

Apply `owner_password_security.sql` in Supabase **before** deploying this release.
It widens `password_hash` to text for the salted envelope, adds
`businesses.auth_version` and a service-role-only atomic password-reset
function. Keep the existing `STAFF_SESSION_SECRET`; no secret rotation or global
password reset is required.

New self-service owner signups and password resets use salted PBKDF2-HMAC-SHA256
with 600,000 iterations and a random 128-bit salt. Hashing runs outside the async
event loop, with at most two derivations at once; overload responds with 503 and
`Retry-After: 1`. This KDF has small, fixed working memory and adds no dependency.

Existing plaintext and SHA-256 owner passwords still authenticate. A successful
login upgrades the uniquely matched account using a compare-and-swap update, so
it cannot overwrite a concurrent password reset. The existing deterministic
`hash_password` function remains unchanged for unrelated legacy credentials.

Owner JWTs carry the account's current `auth_version`. Existing signed tokens
without that claim mean version zero and remain valid until an actual reset.
Reset consumes the single-use reset token, writes the new hash and increments
the version in one database update. Owner guards compare against a fresh row;
old tokens then stop working immediately. Database validation errors fail closed.
An async middleware prefetches the version row in a worker thread and retains it
in a request-scoped context, so repeated guards do not add blocking I/O to the
event loop. There is no time-based cache across requests; the next request always
sees a completed password reset.

`/me` accepts signed owner/manager/cashier sessions and validates current account
state. Predictable `owner-token-...` and `staff-token-...` strings are rejected;
users with one of these old strings need to sign in again. This does not force a
password change. Cashier web login now issues a signed token, while its normal
scanner shift/PIN flow remains available.

For another owner API, call `validate_owner_auth_version(claims)` after verifying
signature, expiry, role and URL business scope. The optional `business` argument
is only for a row that was freshly read from the database, never cached metadata.
Billing-only roles are denied by default; a billing guard must explicitly opt in
to its own allowed roles and must not treat a billing token as an owner token.

An `as_owner` request-body flag now requires a verified owner session before any
customer read, replay lookup or mutation. Signed staff and legacy PIN operations
still use their existing paths with that flag false. Manager dashboard/scanner
actions send the manager role rather than asserting owner access.

Already authenticated POS device workflows reuse the canonical earning and
redemption handlers with an internal owner credential scoped to the verified
business. It expires in 60 seconds, uses the freshly read reset version and is
never returned or logged. StoreHub owner test transactions forward their already
verified owner session. There is no public endpoint for minting the internal
credential.
