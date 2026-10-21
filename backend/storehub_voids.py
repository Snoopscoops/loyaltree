"""Cancellation reconciliation independent of an active Companion checkout.

All balance changes belong to the atomic Supabase RPC. Python only identifies
the matching receipt and delivers its durable Wallet refresh request.
"""
import asyncio
from datetime import datetime, timedelta, timezone


def cancelled_receipts(rows, outlet_id):
    """Keep every distinct cancellation, including rows beyond checkout limits."""
    seen = set()
    for raw in rows or []:
        if not isinstance(raw, dict) or raw.get('isCancelled') is not True:
            continue
        raw_outlet = str(raw.get('storeId') or raw.get('store_id') or '').strip()
        if raw_outlet and raw_outlet != str(outlet_id):
            continue
        external_id = str(raw.get('refId') or raw.get('id') or '').strip()
        receipt = str(raw.get('invoiceNumber') or '').strip()
        key = (external_id, receipt)
        if not any(key) or key in seen:
            continue
        seen.add(key)
        yield key


def wallet_pending(transaction):
    metadata = transaction.get('processing_metadata') or {}
    return isinstance(metadata, dict) and metadata.get('void_wallet_sync_pending') is True


class StoreHubVoidSync:
    def __init__(self, *, db, rpc, fetch_rows, get_integration, get_mapping,
                 get_business, access_allowed, enqueue_wallet, log,
                 interval_seconds=60, active_device_minutes=15, now=None, on_void=None):
        self.db = db
        self.rpc = rpc
        self.fetch_rows = fetch_rows
        self.get_integration = get_integration
        self.get_mapping = get_mapping
        self.get_business = get_business
        self.access_allowed = access_allowed
        self.enqueue_wallet = enqueue_wallet
        self.on_void = on_void
        self.log = log
        self.interval = max(60, int(interval_seconds))
        self.active_device_minutes = max(10, int(active_device_minutes))
        self.now = now or (lambda: datetime.now(timezone.utc))

    def queue_wallet(self, transaction):
        if not wallet_pending(transaction):
            return False
        try:
            # Run optional cross-program corrections before clearing the durable
            # void marker. Failure leaves it pending for the next sweep.
            if self.on_void and self.on_void(transaction) is False:
                raise RuntimeError('Void reconciliation is not complete')
            customers = (self.db.table('customers').select('*')
                         .eq('id', transaction.get('customer_id'))
                         .eq('business_id', transaction.get('business_id'))
                         .limit(1).execute().data or [])
            customer = customers[0] if customers else None
            business = self.get_business(transaction.get('business_id'))
            if not customer or not business:
                raise RuntimeError('Void Wallet customer/business unavailable')
            queued = self.enqueue_wallet(customer, business, 'pos_storehub_void')
            if not isinstance(queued, dict) or queued.get('status') != 'queued' or not queued.get('job_id'):
                raise RuntimeError('Void Wallet refresh could not be persisted')
            # Clear the marker only after the existing durable queue accepted
            # the update. If this write fails, the next scan safely retries it.
            metadata = dict(transaction.get('processing_metadata') or {})
            metadata['void_wallet_sync_pending'] = False
            (self.db.table('pos_transactions').update({'processing_metadata': metadata})
             .eq('id', transaction.get('id')).eq('status', 'voided').execute())
            return True
        except Exception as exc:
            self.log('void_wallet_queue_failed', transaction_id=str(transaction.get('id')), error=str(exc))
            return False

    def reverse_cancelled_rows(self, device, integration, rows):
        mapping = self.get_mapping(device)
        if not mapping or mapping.get('is_active') is False:
            return 0
        outlet = str(mapping.get('external_branch_id') or '').strip()
        if (not outlet or str(mapping.get('branch_id')) != str(device.get('branch_id'))
                or str(mapping.get('integration_id')) != str(integration.get('id'))
                or str(device.get('integration_id')) != str(integration.get('id'))):
            return 0
        reversed_count = 0
        for external_id, receipt in cancelled_receipts(rows, outlet):
            try:
                def find(column, value):
                    return (self.db.table('pos_transactions').select('*')
                            .eq('integration_id', integration.get('id'))
                            .eq('business_id', device.get('business_id'))
                            .eq('branch_id', device.get('branch_id'))
                            .in_('status', ['loyalty_applied', 'voided'])
                            .eq(column, value).limit(1).execute().data or [])
                matches = find('external_transaction_id', external_id) if external_id else []
                if not matches and receipt:
                    matches = find('external_receipt_number', receipt)
                if not matches:
                    continue
                transaction = matches[0]
                if transaction.get('status') == 'voided' and not wallet_pending(transaction):
                    continue
                result = self.rpc('pos_reverse_storehub_void', {
                    'p_transaction_id': str(transaction['id']),
                    'p_integration_id': str(integration['id']),
                })
                fresh = result.get('transaction') if isinstance(result, dict) else None
                if not isinstance(fresh, dict):
                    raise RuntimeError('Invalid atomic void RPC response')
                if result.get('changed') is True:
                    reversed_count += 1
                    self.log('void_points_reversed', transaction_id=str(transaction['id']),
                             device_id=str(device.get('id')))
                self.queue_wallet(fresh)
            except Exception as exc:
                # No Python balance fallback: RPC errors leave the entire sale
                # available for the next retry without a second deduction.
                self.log('void_points_reverse_failed', external_transaction_id=external_id or receipt, error=str(exc))
        return reversed_count

    def drain_wallet_pending(self, integration):
        rows = (self.db.table('pos_transactions').select('*')
                .eq('integration_id', integration['id']).eq('status', 'voided')
                .contains('processing_metadata', {'void_wallet_sync_pending': True})
                .order('updated_at').limit(100).execute().data or [])
        for transaction in rows:
            self.queue_wallet(transaction)

    def sync_once(self):
        cutoff = (self.now() - timedelta(minutes=self.active_device_minutes)).isoformat()
        devices = (self.db.table('pos_devices').select('*')
                   .eq('provider', 'storehub').eq('status', 'active')
                   .eq('overlay_enabled', True).gte('last_seen_at', cutoff)
                   .order('last_seen_at', desc=True).limit(1000).execute().data or [])
        seen = set()
        integrations = {}
        reversed_count = 0
        for device in devices:
            try:
                business_id = device.get('business_id')
                if business_id not in integrations:
                    integrations[business_id] = self.get_integration(business_id, 'storehub')
                integration = integrations[business_id]
                config = (integration or {}).get('config') or {}
                if (not integration or integration.get('mode') != 'live'
                        or integration.get('status') not in ('live', 'connected')
                        or not isinstance(config, dict) or not config.get('real_api_tested')
                        or str(device.get('integration_id')) != str(integration.get('id'))):
                    continue
                business = self.get_business(business_id)
                if not business or not self.access_allowed(business):
                    continue
                mapping = self.get_mapping(device)
                if (not mapping or mapping.get('is_active') is False
                        or str(mapping.get('integration_id')) != str(integration['id'])
                        or str(mapping.get('branch_id')) != str(device.get('branch_id'))):
                    continue
                outlet = str(mapping.get('external_branch_id') or '').strip()
                if not outlet:
                    continue
                scope = f"{integration['id']}:{outlet}"
                if scope in seen:
                    continue
                seen.add(scope)
                claimed = self.rpc('pos_claim_storehub_void_sync', {
                    'p_scope': scope, 'p_interval_seconds': self.interval,
                })
                if claimed is not True:
                    continue
                self.drain_wallet_pending(integration)
                rows = self.fetch_rows(integration, outlet)
                reversed_count += self.reverse_cancelled_rows(device, integration, rows)
            except Exception as exc:
                self.log('storehub_void_sync_failed', device_id=str(device.get('id')), error=str(exc))
        return reversed_count


async def periodic_void_sync(sync_once, interval_seconds=60, log=None):
    """No overlap; wait a minute after each scan so its DB lease is due again."""
    interval = max(60, int(interval_seconds))
    while True:
        try:
            await asyncio.to_thread(sync_once)
        except Exception as exc:
            if log:
                log('storehub_void_worker_failed', error=str(exc))
        # Starting exactly 60s apart can miss a lease by milliseconds when DB
        # latency changes, accidentally skipping a full tick. Spacing from the
        # end of the scan keeps every next claim eligible without faster calls.
        await asyncio.sleep(interval)
