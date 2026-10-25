# Apple push delivery and interrupted wallet jobs

Apply `apple_wallet_delivery.sql` in Supabase **before deploying** this worker.
It adds private `apple_push_deliveries` storage, plus leases on the existing
`wallet_sync_jobs` table. Both command RPCs are service-role-only. Installing the
migration does not send a notification, enable cards, or change customer points.
The running worker will recover eligible interrupted jobs after deployment.

No new APNs credential is needed. Keep the existing Supabase server credential
and Apple certificate configuration. Set `MONITOR_TOKEN` on Render to enable
the admin health report; absence produces a `monitoring_unavailable` startup
warning and the report continues to reject access. Never put that token in a URL.

Wake-ups are persisted before provider work, keyed by business, pass type and
device token. Calls enqueue in groups of 100 and send in batches of 20, separated
by 250 ms. Claim/acknowledgement also use batch RPCs, rather than one DB write per
phone. The queue worker attempts at most 20 deferred APNs targets per tick.
No pass generation, cache invalidation, or token-to-serial audience expansion
happens inside the delivery worker. Cached Add to Wallet downloads retain their
existing path.

Transient APNs/provider errors retry with bounded backoff, up to 8 attempts.
BadDeviceToken, DeviceTokenNotForTopic and Unregistered/410 are terminal target
rejections. Memory deferral waits without spending a provider retry. Interrupted
work becomes eligible when its 15-minute lease expires. Old `processing` wallet
jobs without leases are recovered using their recorded start/update time.
Generic wallet jobs retain their existing 5-attempt default. A stale worker cannot
acknowledge another worker's newer lease. A newer card update received during an
APNs send remains pending after the older attempt completes.

Partial Apple acceptance is reported as `push_partial`; it no longer becomes
success merely because one device accepted a wake-up. A durable handoff can be
`push_queued`; the upstream wallet job can finish dispatching while the APNs
outbox owns the missed targets. Missing durable ownership sets `retry_required`
so the upstream job remains retryable. Successful targets are not resent just
because another device failed. Permanent rejection is `push_rejected`.

Delivery is **at least once**: if APNs accepts but the acknowledgement is lost,
the lease can expire and retry the wake-up. Retries do not mark passes dirty
again. APNs 200 and Google API success prove provider acceptance, not lock-screen
display or receipt by every phone.

If the migration is missing or the database is unavailable, immediate sends
remain best effort and missed targets enter the existing bounded 1-hour in-memory
fallback. This fallback cannot survive a process restart. An explicit
`apple_push_queue_unavailable` warning exposes that limitation. Pending generic
wallet jobs remain untouched if their lease RPC is unavailable; there is no
unsafe SELECT-then-claim fallback. The durable guarantee requires the migration
and available database storage.

`GET /api/v1/admin/health-report` now returns `provider_attempts` and
`apple_push_totals` in addition to its existing send/error/request lists. APNs
totals use delivery summaries only, avoiding double-counting the corresponding
announcement/wallet-sync event. Queue numbers in historical summaries describe
that attempt, not a current live queue size. Global container peaks remain
sampled measurements; this delivery change does not establish OOM safety.

| Event | Fields beyond `event`, `ts`, `level` |
|---|---|
| `apple_push_summary` | `business_id`, `business_slug`, `reason`, `targets`, `attempted`, `apns_accepted`, `retryable_failed`, `permanent_failed`, `deferred`, `queued`, `retry_unavailable`, `acknowledgement_uncertain`, `retry_exhausted`, `delivery_status=unconfirmed`, grouped `outcomes` (`outcome`, `status`, `reason`, `count`) |
| `google_push_summary` | `target_kind=class\|object`, `attempted`, `google_accepted`, `failed`, `skipped`, HTTP `status`, allowlisted canonical `error_code`, `error_type`, `skipped_reason`, `delivery_status=unconfirmed`, `count_basis=provider_requests` |
| `wallet_refresh_summary` | `business_slug`, `program_id`, `targets`, `google_ok`, `google_failed`, `google_not_saved`, `apple_registered`, `apns_accepted`, `apple_attempted`, `apple_queued`, `delivery_status=unconfirmed` |
| `wallet_refresh_failed` | `business_slug`, `error_type` |
| `apple_push_queue_unavailable` | `error_type`, `durable=false`, `action`; throttled to once/minute/process |
| `apple_push_lease_expired` | `failed` (final-attempt leases exhausted) |
| `wallet_queue_unavailable` | `error_type`, `action`; durable rows retained |
| `wallet_queue_recovered` | `recovered`, `expired_failed` |
| `wallet_queue_retry` | `job_id`, `attempts`, `error_type` |
| `wallet_queue_lease_lost` | `job_id` |
| `wallet_queue_finish_failed` | `job_id`, `error_type` |
| `wallet_queue_enqueue_failed` | `business_slug`, `error_type` |
| `wallet_queue_worker_failed` | `error_type` |
| `monitoring_unavailable` | `reason=monitor_token_missing` |

`push`/`wallet_sync` additionally include `apple_queued`, `apple_deferred` and
`delivery_status=unconfirmed`. Deferred work is not labelled a provider failure.
`apple_push_summary`, `google_push_summary` and `wallet_refresh_summary` persist via the existing bounded
event writer. Google counts describe API requests: class acceptance cannot reveal
how many phones displayed a notification. Car-lending summary failures are
`google_not_accepted` with unknown `google_failed=null` when its legacy boolean
result cannot distinguish an absent saved pass/configuration from rejection;
the Google provider summary reports actual HTTP failures separately.
Device tokens, certificates, URLs and raw provider exception
messages are never included in these summaries. Outbox tokens are confidential
database fields; no customer/owner endpoint exposes this table.

Validation uses synthetic providers and an isolated PostgreSQL engine:

```
python -m unittest backend.tests.test_apple_delivery backend.tests.test_wallet_queue_delivery backend.tests.test_wallet_push_outcomes
node backend/tests/test_apple_delivery_sql.mjs
```

Before production acceptance, run an authorized controlled burst and verify
provider counts, retry recovery, business scope, cache hits, worker/container
peaks, and idle recovery. The code tests do not prove physical phone receipt.
