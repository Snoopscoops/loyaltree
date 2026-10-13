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
