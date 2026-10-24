# Access, billing, passwords and Apple memory guard

This release includes coordinated backend/frontend changes and two additive
database migrations. Apply and verify the SQL before deploying the code.

## Migration and release order

1. Review in-flight subscription checkouts and reconcile historical payment
   receipts against subscription expiry before cutover. Follow
   [README-subscription-fulfillment.md](README-subscription-fulfillment.md).
   A historical `paid` row alone does not establish whether access was extended.
2. Run [owner_password_security.sql](owner_password_security.sql). It widens the
   password column, adds `auth_version`, and installs a service-role-only reset
   function. Existing signed owner sessions start at version zero.
3. Run [subscription_fulfillment.sql](subscription_fulfillment.sql). It rejects
   duplicate provider intents instead of arbitrarily deleting financial rows,
   adds fulfillment context/session fields, and installs the service-role-only
   atomic fulfillment function. Refresh the PostgREST schema cache if necessary.
4. Deploy backend and frontend from this release together. Keep the existing
   `STAFF_SESSION_SECRET`; it must be configured before registration/login.
   No new secret environment variable is required.
5. Verify owner login, public QR signup, staff login/scanning, initial business
   payment, renewal and a returning 3DS payment in a test environment. Run two
   simultaneous PostgreSQL sessions against a test payment to verify duplicate
   callbacks and concurrent renewals. Isolated SQL-engine tests cover rollback
   and replay, but do not replace this separate-session contention check.
6. Run a measured wallet burst, starting small and progressing to 130 cards
   (approximately 68 Apple). Observe recovery for 5–10 minutes and repeat.

Do not automatically replay contextless historical payments or expired old
checkout attempts. They require receipt/expiry reconciliation. A manual-review
payment remains visible in the UI without prompting another payment.

Rolling back only the backend would restore the old non-atomic payment handler
and old authorization behavior. Coordinate a rollback with payment processing;
do not remove new database columns or downgrade salted password hashes.

## Access boundaries

- Anonymous `GET /api/v1/business/{slug}` returns an explicit public branding
  allowlist. A valid owner can read owner settings, with credential/reset
  material removed recursively. Authenticated responses are private/no-store
  and this URL varies by Authorization.
- Customer exports/history, owner analytics, owner card publishing, setup-kit
  details and the car-lending owner data APIs require a signed, business-scoped
  owner session. Existing manager APIs retain their branch restrictions.
- `GET /api/v1/business/{slug}/subscription/access` returns only entitlement
  information to an owner or currently active staff member. It does not return
  prices, payment records or owner contacts.
- Full billing/pricing and checkout accept an owner session or a short-lived
  signup billing capability. Payment history is owner-only.
- `GET /api/v1/business/{slug}/subscription/payments/{intent}` accepts an owner,
  the capability that created that attempt, or a credential-verified capability
  explicitly scoped to resume that attempt. Identifiers alone grant no access.
- Signup billing tokens are kept in sessionStorage, never URLs. A storage-less
  bank return may carry public business/intent identifiers only; recovering
  private payment state requires the owner's email and password through
  `POST /api/v1/auth/billing-session`.
- Billing capabilities cannot be used as owner/staff sessions or to stamp,
  redeem, publish, export customer information or read unrelated payments.
- A request asserting `as_owner=true` must have a verified owner JWT. Trusted
  authenticated POS flows use short-lived internal authorization when invoking
  the existing ledger handlers; those tokens are not returned or logged.

Unsigned legacy owner/staff login tokens are rejected. An old open dashboard
using one of those tokens needs a fresh sign-in. Public customer signup and
existing Apple/Google pass identities and signing keys are preserved.

## Password and session compatibility

See [owner-password-security.md](owner-password-security.md). Owner passwords
use salted PBKDF2-HMAC-SHA256 with 600,000 iterations and at most two concurrent
derivations outside the event loop. This avoids an additional large RAM
allocation on the 512 MiB worker. Verified legacy owner passwords migrate on
login using a conditional update, preserving a concurrent password reset.
The shared deterministic hash used by other credentials is unchanged.

Password reset atomically changes the hash, consumes the reset token and
increments the session version. Owner and billing guards check a fresh version
per request. Request-local caching shares that one off-thread read between
guards without retaining a stale version across requests.

The existing [login_email_uniqueness.sql](login_email_uniqueness.sql) migration
should also be verified in production after reviewing duplicates. Conflicting
accounts require manual review; this release does not merge business/customer
or financial records automatically.

## Memory protection and measurement

Existing worker RSS hysteresis (pause above 350 MiB, resume below 300 MiB),
single-flight, two concurrent builds, bounded queue/cache and cache-before-build
download behavior remain in place. The gate now also checks total container
headroom before a cold render or lower-priority background work.

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `APPLE_MEMORY_PAUSE_HEADROOM_MB` | `100` | Pause when known container free headroom is at or below this MiB value. |
| `APPLE_MEMORY_RESUME_HEADROOM_MB` | `120` | Resume the container gate after headroom recovers to this MiB value. |

The resume threshold must exceed the pause threshold; invalid settings fall
back to defaults. Worker/container pause states are independent. Unknown metric
samples do not clear an existing pause. The container thresholds are initial
protective defaults requiring measured burst validation, not a guaranteed
350 MiB ceiling or proof that previous idle growth is resolved.

Cached passes retain their fast path while cold renders may return 503 with
Retry-After during pressure. Existing `MALLOC_ARENA_MAX=2`, trimming and one-worker
Gunicorn request recycling remain containment measures.

`wallet_memory` diagnostics now include container headroom, anonymous/file/kernel
memory and parent RSS. The detailed breakdown is cached for 30 seconds; the
admission decision reads fresh usage/limit values. Burst summaries include
`peak_container_memory_mb`, `min_container_headroom_mb` and `container_limit_mb`
alongside worker peaks, build/cache and push counts.

Measure worker/container peaks, queue wait, 503s, provider acceptances, Add to
Wallet latency and recovery. Sampled peaks can miss shorter spikes. Local
simulated/SQL tests do not establish live Render burst acceptance or device
delivery.
