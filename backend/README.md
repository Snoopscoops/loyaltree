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
terms continue to apply. PH remains PHP350/PHP550/PHP750, with its 3-month minimum.

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
# points_prizes update
