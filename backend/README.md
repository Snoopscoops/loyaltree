# Backend monitoring

Apply `system_events.sql` in Supabase **before deploying** these files. It creates
private, service-role-only monitoring storage and adds the durable Apple pass
revision column. Keep the existing Supabase server credential. Set one new Render
secret: `MONITOR_TOKEN`, a long random token used only for monitoring. An unset
or incorrect token returns 401. Install `requirements.txt` (HTTP/2 support is
required for APNs), then redeploy the backend.

Use `GET /api/v1/admin/health-report?hours=24` with an
`Authorization: Bearer <MONITOR_TOKEN>` header. Hours accepts 1–168. One call
returns status totals, 5xx details, announcement and sync sends, and the top five
businesses/endpoints. Database results are paginated internally. Summary totals
cover completed hourly windows and this process's current window; the earliest
included window can begin before the requested cutoff. Counts during a crash,
sleep, dropped queue writes or other process's unfinished window cannot be
reconstructed. Run one uvicorn worker on Render's free plan for consistent live
counters. Graceful shutdown also emits a final summary. Free-tier sleep pauses
in-process tasks; the keepalive is best effort, not an uptime guarantee.

All application events are single JSON lines with `event`, UTC ISO8601 `ts`, and
`level`. Request paths are route templates; unmatched paths use `<unmatched>`.
Server-generated request IDs are returned as `X-Request-ID`. Logging excludes
headers, request bodies, customer records, device tokens and stack-frame locals.
Emails, phone numbers, URLs and known credentials in free text are redacted;
announcement title/message are logged with those redactions. Uvicorn access logs are disabled to avoid logging raw URLs/query strings. Former free-form
prints are suppressed because they contain personal data and tokens. Setting
Python's `loyaltytree` logger to DEBUG emits source-only legacy diagnostics.

| Event | Fields beyond the common envelope |
|---|---|
| `error` | `status`, `method`, `endpoint`, `business_slug`, `error_type`, `error`, `request_id` |
| `error_traceback` | `request_id`, `error_type`, `traceback` (every frame and chained exception; source literals/locals omitted) |
| `push` | `kind` (`create`/`resend`), `announcement_id`, `business_slug`, `business_name`, `program_id`, `sent_by` (`owner`/`staff`/`admin`), `title`, `message`, `notification_header` (actual Wallet header), `targets`, `google_ok`, `google_failed`, `apple_ok`, `apple_failed`, `sent` |
| `wallet_sync` | `business_slug`, `business_name`, `customer_id`, `reason`, `targets`, `google_ok`, `google_failed`, `apple_ok`, `apple_failed`, `google_status`, `apple_status`, `sent` |
| `hourly_summary` | `window_start`, `requests`, `status_2xx`, `status_4xx`, `status_5xx`, `pushes`, `apple_pushes`, `google_pushes`, `top_endpoints`, `top_businesses`, `endpoint_counts`, `business_counts`, `errors` (endpoint/error_type/count) |
| `upstream_read_failed` | `endpoint`, `business_slug`, `error_type`, `error`; warning, dashboard response has `partial: true` |
| `dashboard_metrics_unavailable` | `business_slug`, `metric` (`visits`/`rewards`/`programs`), `endpoint`, `error_type`; warning, optional dashboard metrics remain unavailable |
| `keepalive_failed` | `error_type`, `error`; warning after a 60-second health ping timeout or non-success HTTP response |
| `apple_push_failed` | `status`, `reason` for APNs rejection; or `error_type`, `error`, optional `stage` for connection/revision failure; warning |
| `event_persist_failed` | `error_type`; warning; never recursively persisted |
| `health_report_failed` | `error_type`; warning; authenticated report returns 503 |
| `legacy_diagnostic` | `source` (function), `line`; DEBUG only; no legacy argument values |
| `wallet_memory` | `operation`, `stage` (`before`/`after`), `business_slug`, `request_id`, `pid`, current/peak RSS where available; after also includes `outcome`, `duration_ms` (including render-slot waiting), `work_ms`, `wait_ms`, bounded cache sizes |
| `runtime_memory` | `pid`, `threads`, `worker_env`, current/peak RSS, container memory/limit where available, CPU seconds/percentage, optional Python heap/trace overhead, bounded cache sizes; emitted every 30 seconds |
| `wallet_publish_success` | `business_slug`, `program_id`, `class_count`; emitted after provider success and metadata save |

`error`, `push`, `wallet_sync`, and `hourly_summary` are asynchronously persisted
through a bounded 1,000-event queue. Requests never await event inserts. Queue
overflow drops persistence while preserving stdout; shutdown allows five seconds
to drain. Persistence uses the same client, but does not retry inserts. Set a
retention policy for `system_events` suitable for your database budget; none is
automatically deleted by this migration.

Push counts measure provider acceptance, not handset display. Google broadcast
counts are per unique Wallet class, while targeted counts are per object; APNs
counts are per unique registered device token. `sent` is true when either provider
accepts at least one send. `pushes` counts send/sync events; provider summary
counts sum accepted sends. A member without a saved pass is not a failed push.

The shared `httpx.AsyncClient` is created at startup and closed on shutdown.
Existing synchronous Supabase/PostgREST and HTTP call sites use a shared no-socket sync
transport bridge to its dedicated I/O loop. The normal pool has 20 connections,
10 keepalive connections; APNs has an origin-specific HTTP/2 mTLS pool (5/3) in
the same client. Timeouts default to 30 seconds, connect/pool 10 seconds. Reads
(GET/HEAD/OPTIONS) retry once after 200 ms for ReadError, ConnectError, or timeout;
mutations and RPC POSTs are never automatically retried. Fraud-alerts, stats and
retention-analytics degrade on read transport failure, preserving authentication
failures and genuine database errors.

Before every APNs send, registered serials get a durable `pass_updated_at` marker.
Update-list responses compare microseconds, cached pass fingerprints include the
revision, and signed pass content includes it in `userInfo`. Serial identities
remain stable. A failed revision write prevents APNs from asking for unchanged
content. The actual Apple/Google delivery should be smoke-tested on saved passes
after deployment; local tests use mocked providers and do not send notifications.

Run the existing and monitoring regression tests from the repository root:

```sh
python -m unittest discover -s backend/tests -v
```

## Standard international subscription pricing

Standard plans outside the Philippines are priced in USD: Starter $15, Growth
$39, Pro $69 per month for one branch. Annual rates are $150/$390/$690 (12 months
for the price of 10). Existing branch packages and monthly/3-month/6-month/annual
terms continue to apply. PH monthly rates remain PHP350/PHP550/PHP750. Monthly billing is available. Standard PH prepaid branch packages reduce the monthly package rate by PHP25 for 3 months, PHP50 for 6 months, or PHP100 for 12 months, paid upfront. The discount applies once per monthly branch package, not per branch. Custom quotes retain their existing prices. No migration or new environment variable is needed.

Named markets and all other identified countries use the same USD subscription
rates. Other countries use the `INT` pricing region. An unknown location still
shows the existing PH reference fallback; signup confirms the price. No additional
SQL migration or environment variable is required for this pricing change.

Subscription currency is separate from merchant sales/POS currency. Legacy local
sales, loyalty spend thresholds and Order Ahead currencies are preserved. Existing
custom-price agreements retain their negotiated amounts/currency; historical
payment amounts, exchange-rate snapshots, accepted agreement snapshots and prepaid
access are not rewritten. Standard renewal quotes use the new rates. New signup
agreement previews use USD for international plans. Existing PayMongo settlement
and FX disclosures remain in place; a USD subscription quote does not imply native
USD settlement support.


## Business trial coupons and overdue access

Apply `trial_coupons.sql` in the Supabase SQL Editor **first**. Then deploy the
backend, followed by the frontend. It adds private coupon/redemption tables, the business
trial-end column, and a service-role-only transaction that locks the coupon
while checking its usage limit. A second service-only transaction recovers lost
activation responses or cancels an unactivated signup atomically. No additional
environment variables are needed.
The migration seeds `HALLOWEEN7`: seven days free, redeemable October 15 through
November 15, 2026 inclusive in Asia/Manila, for Philippines businesses. Re-running
the migration preserves admin edits to the seeded coupon.

Super Admin → Trial Coupons creates/edits codes, enables/disables redemption,
sets 1–90 trial days, dates, maximum uses, country, optional business email, and
public/popup visibility. Private codes are not advertised. The redemption list
shows business names/emails, exact start/end times, and paid conversion using
`last_paid_at`. Editing or disabling a coupon does not change existing trials.
Public popup eligibility is checked by the server; dismissed offers stay hidden
for that browser session. Promo links prefill the optional final-signup coupon
field; the business must apply it and sign the updated agreement.

Signup revalidates the code and records the trial terms in the signed agreement.
The signed agreement is stored before redemption; the database also requires it
before activating the new business and starting the exact trial clock; unique business, normalized email, and normalized phone constraints stop
repeated redemption. Trials cannot stack. Signup without a coupon continues to
payment. Physical QR / PR Kits are not included in the free trial. Later referral/admin
access extensions are preserved, including before the first subscription payment.
A transport error after activation recovers the durable redemption; cancellation
cannot delete an active account or remove its signed agreement.

Unpaid trials lose business access at the exact trial end (no extra free grace).
Paid accounts lose access strictly more than 14 days after subscription expiry.
Business APIs and activated Companion POS devices enforce the hold for existing
sessions and staff PIN login, while subscription/payment endpoints, public Wallet
assets, help and owner billing remain available. Transient billing refresh errors
preserve active dashboard forms. Admin tokens
can still manage held businesses. Payment confirmation restores access through
the existing PayMongo webhook; no scheduled job is required for the hold. The
hold uses the current subscription expiry, including manually managed accounts.

Local verification: frontend `npm run build`, backend `python -m unittest discover
-s backend/tests -v`. Before production rollout, smoke-test the migration on a
staging database: two concurrent signups for a one-use coupon, duplicate business
email/phone claims, agreement-storage rollback, trial expiry, and a confirmed
payment restoring access. Local tests do not execute Supabase SQL or charge cards.


## Business getting-started email

Successful self-service signup queues one short owner setup email after the
registration response. Active trials include their actual trial duration/end
in Philippine time and a sign-in link. Unpaid accounts are instructed to finish
Pay & Activate in the signup tab before signing in. Both versions explain the
Setup Guide, cashier/team setup, choosing a card and sharing its join QR, and a
test customer visit. No password, session token, or signed agreement is emailed.

Uses the existing Resend configuration (`RESEND_API_KEY`,
`TRANSACTIONAL_EMAIL_FROM`, `TRANSACTIONAL_REPLY_TO`) and the existing frontend
URL fallback. No SQL migration or new secret is required. Deploy the backend
including `business_welcome_email.py`. Sending is best effort: a mail/template
failure is logged and never rolls back signup. Background tasks are not a durable
mail queue; process interruption or provider failure can prevent delivery.
Local tests mock the provider and never send real emails. Confirm one received
email after deployment using a new test business and the configured sender.


## Google Wallet publishing recovery

Card publishing uses the same deterministic LoyaltyClass ID for every update,
create fallback and recovery. If a Google write times out or returns a server
error, the publisher checks that exact ID and performs one bounded retry with
the current design. A create conflict is reconciled with an update; an existing
class alone is not treated as proof that the latest design was applied.

Google token/publish requests and metadata writes run in worker threads. This
keeps the ASGI loop available for requests such as Google fetching card image
URLs hosted by the backend. Metadata is saved and member refresh begins only
after all required classes have succeeded. Shared HTTP still never retries
arbitrary writes.

Unresolved provider timeouts return 504 with a readable message; transport
failures return 503. Retry-After is exposed through CORS, and the editor stops
immediate automatic retries when the backend asks it to wait. Deploy backend
(including `wallet_class_publish.py`) and frontend together. No SQL changes or
new environment variables are needed. Local fake-transport tests cover lost
create responses, same-ID conflicts, stale-design recovery and failure mapping;
live Google latency still requires a post-deploy publishing check.
## Admin customer demographics

Admin → Customer Demographics calls `GET /api/v1/admin/customer-demographics`
with the existing admin authentication. It summarizes saved customers of all
non-demo businesses, including inactive accounts. Owner profiles and website
visitors are not demographic sources; employee-only cards are excluded.

Shared customer identities count once within each business, across programs.
Legacy memberships without an identity count separately. The report includes
age ranges, gender, occupation, missing-data coverage and average customers per
business (including businesses with zero customers). It does not estimate an
exact mean age from age ranges or infer customer location from business addresses.
Distributions require at least 10 valid responses. Groups below 5 responses and
an additional group are hidden to prevent small counts being recovered by subtraction.

Reads use narrow, paginated selects and cache only aggregate results in memory
for five minutes. During an upstream failure, a previous successful report can
be returned for up to one hour with `stale: true`; otherwise the endpoint returns
a sanitized 503. Responses use `Cache-Control: private, no-store`. No new SQL
migration or environment variable is required. Deploy the backend and frontend
together. The local preview at `/dev/admin-demographics.html` uses fictional
fixtures and blocks network requests; it is not a production route.

## Wallet memory and Render OOM recovery

The Wallet artwork loader previously retained up to 24 original RGBA images.
One 4000×3000 photo requires about 46 MiB per retained raster, even if its JPEG
download is only a few hundred KB. Several businesses' photos could therefore
exhaust a 512 MiB process while traffic was idle. Apple image downloads had no
hard cache budget, and pass-cache cleanup removed expired items only after
500 entries, allowing a burst of fresh signed passes to exceed the limit.

Wallet artwork is now decoded at at most 1200×1200, with JPEG draft downsampling
before RGBA conversion. Downloads above 5 MiB, or images still above 12 million
pixels after JPEG draft downsampling, use the existing generated-art fallback.
Artwork downloads stop while streaming when the byte
limit is reached. Image/buffer helpers explicitly close intermediates. Heavy
rendering runs in worker threads under a shared render lock; provider pushes
and the ASGI event loop remain independent of that rendering lock.

Caches now have hard byte, item and TTL limits, including keys never read again:
Wallet artwork 4 MiB, Apple downloads 8 MiB, signed loyalty passes 8 MiB, legacy
Order Ahead passes 4 MiB, gift branding 2 MiB. Only compressed bytes are retained,
never decoded PIL images. This is a 26 MiB cache-payload budget per process,
not a cap on the application's total memory. Existing balance/dirty-marker
fingerprint checks still invalidate signed passes. These small bounded local
caches are a containment fix; no Render Key Value service is provisioned.

Normal Apple Add to Wallet and signup prewarm now share the Store Card cache,
including Order Ahead businesses. Concurrent cold requests recheck the current
fingerprint inside the existing rendering lock and reuse the first successful
build; valid cache hits bypass that lock. Failed builds remain retryable, and
stamp/design/announcement/revision changes still invalidate the cached bytes.
The download response includes `X-LoyaltyTree-Apple-Cache: HIT|MISS`.
Authenticated installed-pass updates retain their existing rebuild/conditional
GET behavior. This reduces duplicate work; transient native image allocations
and retained allocator memory can still raise RSS during/after a genuine build.

`runtime_memory` samples Linux RSS, cgroup memory and cache bytes every 30 seconds.
`wallet_memory` records before/after pass builds and pushes with business slug
and request ID, without customer profiles, images, signed bytes or device tokens.
Python tracing is optional and time limited as described below. Native Pillow
allocations require RSS/cgroup measurements; tracemalloc alone will not show
them. These diagnostics go to stdout, adding no event-table
writes. Inspect all PIDs and the actual Render start command when checking workers;
`worker_env` only reports `WEB_CONCURRENCY`, not the actual process count.

Set the Render start command to `sh start.sh` from the backend root (or
`sh backend/start.sh` from the repository root). This exports `MALLOC_ARENA_MAX=2`
before Python starts and runs one Gunicorn-managed Uvicorn worker, recycled
after 500 requests plus 0–50 jitter. Do not use preload or increase workers on
the 512 MiB plan. Native buffers are closed and glibc `malloc_trim(0)` runs
after Apple builds and APNs batches; other platforms safely skip trimming.
No SQL or new required environment variable is needed for this release. The
deployment does not change the paid instance plan, DNS/SSL, or Render settings.
After deployment, compare the same business's pass/push `before`/`after` events
and several idle `runtime_memory` samples before declaring the OOM resolved.

Owner/manager dashboards now poll every 60 seconds, pause in hidden tabs and
wait for the prior refresh. Edits still refresh immediately. The active order
queue retains its 8-second refresh while visible. CORS preflights cache for
600 seconds. Balances/redemptions are not given a new data cache. The dashboard
still uses its existing endpoints; combining them and adopting external caches
are separate changes.

Google class writes now have explicit 45-second timeouts and a 300 ms recovery
backoff. The existing two-round, same-ID recovery remains bounded; other writes
are not automatically retried. Successful publication is logged explicitly.

## Admin system usage and allocation profiling

Open **Admin → System Usage** to inspect the current backend process. The page
refreshes every 30 seconds while visible and pauses when hidden. Its single
report request reads local counters and OS measurements; it does not fetch
business/customer records or query Supabase. Existing admin authentication is
required for both diagnostic endpoints:

- `GET /api/v1/admin/system-usage`: process RSS and lifetime peak, container
  usage/limit, CPU, threads, startup checkpoints, recent memory samples,
  request/status counts, route and business workload, Wallet jobs and caches.
- `POST /api/v1/admin/system-usage/profile?seconds=30`: starts a Python
  allocation capture and returns 202. The duration may be 10–60 seconds.
  Results appear in subsequent GET reports. An overlapping capture or
  insufficient known container headroom returns 409.

Successful responses use `Cache-Control: private, no-store`. These endpoints use
the normal admin session, not the separate health-report `MONITOR_TOKEN`.
No SQL migration or new required environment variable is needed.

All counters cover one PID since backend import began and reset on restart.
They do not combine workers or persist across Render sleep/restarts. History
retains at most 180 memory samples (about 90 minutes when sampled continuously),
16 startup checkpoints, 128 endpoint groups, 100 business groups, 32 Wallet
operation groups and 40 recent Wallet jobs. Overflow request groups are combined
in an `<other>` bucket included in the group limit. Only aggregate map sizes and
cache sizes are exposed, never their keys. Requests retain route templates and
validated business slugs, without bodies, headers, customer records or tokens.

Memory labels use binary MiB/KiB, even though API field names end in `_mb`.
Current RSS is read at report time; peak RSS is the process lifetime high-water
mark. Unavailable readings remain `null` rather than zero. Container memory
includes allocations beyond the current process's RSS. CPU is averaged between
periodic samples, with one CPU core equal to 100%; multicore work may exceed
100%. The first startup checkpoint is main-module entry, after Python has
compiled that module, rather than a pristine interpreter baseline.

Endpoint response duration ends at the final response-body chunk. ASGI lifetime
also includes background work. Wallet work duration excludes rendering-slot
wait time, which is reported separately. RSS changes observed during requests
or Wallet jobs include concurrent activity; they are not memory allocations
attributable to an individual business and must not be added together. Business
rows show request volume, status and time only. Use repeated idle readings and
comparable Wallet jobs to assess improvements.

Default collection uses bounded counters and OS readings, with Python allocation
tracing off. The manual capture enables one-frame tracing temporarily, then
collects up to 20 file/line allocation groups in a worker thread and stops
tracing if the capture enabled it. A snapshot shows Python allocations still
retained since tracing began, rather than an allocation difference or native
image buffers. File paths are reduced to project/package/standard-library
locations; source text and local variables are not collected.

Manual capture requires at least the greater of 160 MiB or 30% of a known
container limit to remain free. Headroom is checked again before snapshotting.
The periodic sampler stops tracing when observed container usage reaches 80%
of its limit. These checks reduce profiling overhead near a memory limit; the
30-second sampler is not an instantaneous memory guard.

For an optional startup profile, set `MEMORY_TRACE=1` before starting the
backend. Tracing begins at main-module entry and automatically snapshots/stops
after 120 seconds from that entry, subject to the same pressure checks.
`PYTHONTRACEMALLOC=1` starts tracing in the interpreter before module compilation;
the profiler detects that startup mode and also limits it to the startup window.
Leave both unset for normal operation. On shutdown any active snapshot worker
is drained before tracing is stopped. No profiler is required to serve requests.

# points_prizes update
