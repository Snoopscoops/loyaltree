"""StoreHub void reconciliation tests: fake DB/provider only, no live I/O.

Run with the production backend folder in PYTHONPATH. The worker is imported
directly so FastAPI startup, environment secrets, and HTTP clients never run.
"""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from unittest.mock import patch

try:
    from backend import storehub_voids as subject
except ImportError:
    import storehub_voids as subject


NOW = datetime(2026, 10, 14, 18, 0, tzinfo=timezone.utc)


class Query:
    def __init__(self, db, table):
        self.db, self.name = db, table
        self.predicates = []
        self.patch = None
        self.maximum = None
        self.sort = None

    def select(self, *_):
        return self

    def eq(self, column, value):
        self.predicates.append(lambda row: row.get(column) == value)
        return self

    def in_(self, column, values):
        self.predicates.append(lambda row: row.get(column) in values)
        return self

    def gte(self, column, value):
        self.predicates.append(lambda row: row.get(column) is not None and row[column] >= value)
        return self

    def contains(self, column, values):
        self.predicates.append(lambda row: isinstance(row.get(column), dict)
                               and all(row[column].get(key) == value for key, value in values.items()))
        return self

    def order(self, column, desc=False):
        self.sort = (column, desc)
        return self

    def limit(self, maximum):
        self.maximum = maximum
        return self

    def update(self, values):
        self.patch = values
        return self

    def execute(self):
        rows = [row for row in self.db.rows.get(self.name, [])
                if all(predicate(row) for predicate in self.predicates)]
        if self.sort:
            column, reverse = self.sort
            rows.sort(key=lambda row: row.get(column) or '', reverse=reverse)
        if self.maximum is not None:
            rows = rows[:self.maximum]
        if self.patch is not None:
            if self.db.fail_updates:
                raise RuntimeError('DB update unavailable')
            for row in rows:
                row.update(deepcopy(self.patch))
        return SimpleNamespace(data=deepcopy(rows))


class FakeDB:
    def __init__(self, rows):
        self.rows = deepcopy(rows)
        self.fail_updates = False

    def table(self, name):
        return Query(self, name)


def sale(number=1, **overrides):
    return {
        'id': f'tx-{number}', 'integration_id': 'integration-1',
        'business_id': 'business-1', 'branch_id': 'branch-1',
        'customer_id': 'customer-1', 'status': 'loyalty_applied',
        'external_transaction_id': f'provider-{number}',
        'external_receipt_number': f'receipt-{number}',
        'points_awarded': 1, 'processing_metadata': {},
        'updated_at': NOW.isoformat(), **overrides,
    }


def cancellation(number=1, **overrides):
    return {
        'refId': f'provider-{number}', 'invoiceNumber': f'receipt-{number}',
        'storeId': 'outlet-1', 'isCancelled': True, **overrides,
    }


class Scenario:
    """Callbacks mimic atomic RPC and durable queue contracts, not their SQL."""
    def __init__(self):
        self.device = {
            'id': 'device-1', 'business_id': 'business-1',
            'integration_id': 'integration-1', 'branch_id': 'branch-1',
            'mapping_id': 'mapping-1', 'provider': 'storehub', 'status': 'active',
            'overlay_enabled': True, 'last_seen_at': NOW.isoformat(),
        }
        self.integration = {
            'id': 'integration-1', 'business_id': 'business-1',
            'mode': 'live', 'status': 'live', 'config': {'real_api_tested': True},
        }
        self.mappings = {'mapping-1': {
            'id': 'mapping-1', 'integration_id': 'integration-1',
            'branch_id': 'branch-1', 'external_branch_id': 'outlet-1', 'is_active': True,
        }}
        self.business = {'id': 'business-1', 'access_allowed': True}
        self.db = FakeDB({
            'pos_devices': [self.device], 'pos_transactions': [sale()],
            'customers': [{'id': 'customer-1', 'business_id': 'business-1', 'points_balance': 100}],
        })
        self.provider_rows = [cancellation()]
        self.fetch_calls = []
        self.rpc_calls = []
        self.queue_calls = []
        self.logs = []
        self.claimed_scopes = set()
        self.queue_available = True
        self.reverse_override = None

    def rpc(self, name, args):
        self.rpc_calls.append((name, deepcopy(args)))
        if name == 'pos_claim_storehub_void_sync':
            scope = args['p_scope']
            if scope in self.claimed_scopes:
                return False
            self.claimed_scopes.add(scope)
            return True
        if self.reverse_override:
            return self.reverse_override(args)
        self.assert_rpc(name)
        transaction = next(row for row in self.db.rows['pos_transactions']
                           if row['id'] == args['p_transaction_id'])
        changed = transaction['status'] == 'loyalty_applied'
        if changed:
            customer = next(row for row in self.db.rows['customers']
                            if row['id'] == transaction['customer_id'])
            customer['points_balance'] -= transaction['points_awarded']
            transaction['status'] = 'voided'
            transaction['processing_metadata']['void_wallet_sync_pending'] = True
        return {'changed': changed, 'transaction': deepcopy(transaction)}

    @staticmethod
    def assert_rpc(name):
        if name != 'pos_reverse_storehub_void':
            raise AssertionError(f'Unexpected RPC {name}')

    def fetch(self, integration, outlet):
        self.fetch_calls.append((integration['id'], outlet))
        return deepcopy(self.provider_rows)

    def enqueue(self, customer, business, reason):
        self.queue_calls.append((deepcopy(customer), deepcopy(business), reason))
        return {'status': 'queued', 'job_id': f'job-{len(self.queue_calls)}'} if self.queue_available else None

    def worker(self, **kwargs):
        return subject.StoreHubVoidSync(
            db=self.db, rpc=self.rpc, fetch_rows=self.fetch,
            get_integration=lambda business_id, provider: deepcopy(self.integration),
            get_mapping=lambda device: deepcopy(self.mappings.get(device['mapping_id'])),
            get_business=lambda business_id: deepcopy(self.business),
            access_allowed=lambda business: business['access_allowed'],
            enqueue_wallet=self.enqueue,
            log=lambda event, **data: self.logs.append((event, data)),
            now=lambda: NOW, **kwargs,
        )


class IdleSchedulerTests(unittest.TestCase):
    def test_idle_device_with_live_integration_reconciles_without_checkout(self):
        scenario = Scenario()
        self.assertEqual(scenario.worker().sync_once(), 1)
        self.assertEqual(scenario.fetch_calls, [('integration-1', 'outlet-1')])
        self.assertEqual(scenario.db.rows['customers'][0]['points_balance'], 99)
        self.assertEqual(scenario.queue_calls[0][0]['points_balance'], 99)
        self.assertFalse(subject.wallet_pending(scenario.db.rows['pos_transactions'][0]))

    def test_connected_status_in_live_mode_is_allowed_after_health_refresh(self):
        scenario = Scenario()
        scenario.integration['status'] = 'connected'
        self.assertEqual(scenario.worker().sync_once(), 1)
        self.assertEqual(len(scenario.fetch_calls), 1)

    def test_ineligible_integrations_never_fetch_or_mutate(self):
        variants = (
            {'mode': 'test'}, {'mode': 'paused'}, {'status': 'paused'},
            {'status': 'disconnected'}, {'config': {'real_api_tested': False}},
            {'config': 'invalid'}, {'id': 'old-integration'},
        )
        for override in variants:
            with self.subTest(override=override):
                scenario = Scenario()
                scenario.integration.update(override)
                self.assertEqual(scenario.worker().sync_once(), 0)
                self.assertEqual(scenario.fetch_calls, [])
                self.assertEqual(scenario.rpc_calls, [])

    def test_held_business_does_not_reconcile(self):
        scenario = Scenario()
        scenario.business['access_allowed'] = False
        self.assertEqual(scenario.worker().sync_once(), 0)
        self.assertEqual(scenario.fetch_calls, [])
        self.assertEqual(scenario.queue_calls, [])

    def test_inactive_or_stale_devices_do_not_fetch(self):
        variants = (
            {'status': 'revoked'}, {'overlay_enabled': False}, {'provider': 'other'},
            {'last_seen_at': (NOW - timedelta(minutes=16)).isoformat()},
            {'last_seen_at': None},
        )
        for override in variants:
            with self.subTest(override=override):
                scenario = Scenario()
                scenario.db.rows['pos_devices'][0].update(override)
                self.assertEqual(scenario.worker().sync_once(), 0)
                self.assertEqual(scenario.fetch_calls, [])

    def test_idle_five_minute_apk_heartbeat_is_inside_liveness_window(self):
        scenario = Scenario()
        scenario.db.rows['pos_devices'][0]['last_seen_at'] = (NOW - timedelta(minutes=6)).isoformat()
        self.assertEqual(scenario.worker().sync_once(), 1)

    def test_invalid_or_inactive_mapping_does_not_fetch(self):
        variants = ({'is_active': False}, {'branch_id': 'foreign-branch'},
                    {'integration_id': 'foreign-integration'}, {'external_branch_id': ''})
        for override in variants:
            with self.subTest(override=override):
                scenario = Scenario()
                scenario.mappings['mapping-1'].update(override)
                self.assertEqual(scenario.worker().sync_once(), 0)
                self.assertEqual(scenario.fetch_calls, [])

    def test_multiple_terminals_in_same_outlet_fetch_provider_once(self):
        scenario = Scenario()
        scenario.db.rows['pos_devices'].append({**scenario.device, 'id': 'device-2'})
        self.assertEqual(scenario.worker().sync_once(), 1)
        self.assertEqual(len(scenario.fetch_calls), 1)
        claims = [args for name, args in scenario.rpc_calls if name == 'pos_claim_storehub_void_sync']
        self.assertEqual(claims, [{'p_scope': 'integration-1:outlet-1', 'p_interval_seconds': 60}])

    def test_distinct_outlets_each_have_separate_lease(self):
        scenario = Scenario()
        scenario.mappings['mapping-2'] = {
            **scenario.mappings['mapping-1'], 'id': 'mapping-2',
            'branch_id': 'branch-2', 'external_branch_id': 'outlet-2',
        }
        scenario.db.rows['pos_devices'].append({
            **scenario.device, 'id': 'device-2', 'branch_id': 'branch-2', 'mapping_id': 'mapping-2',
        })
        scenario.worker().sync_once()
        self.assertCountEqual(scenario.fetch_calls, [('integration-1', 'outlet-1'), ('integration-1', 'outlet-2')])

    def test_shared_lease_prevents_second_worker_provider_fetch(self):
        scenario = Scenario()
        first, second = scenario.worker(), scenario.worker()
        self.assertEqual(first.sync_once(), 1)
        self.assertEqual(second.sync_once(), 0)
        self.assertEqual(len(scenario.fetch_calls), 1)
        claims = [args for name, args in scenario.rpc_calls if name == 'pos_claim_storehub_void_sync']
        self.assertEqual(len(claims), 2)

    def test_failed_provider_read_isolated_to_scope_and_logged(self):
        scenario = Scenario()
        worker = scenario.worker()
        worker.fetch_rows = lambda *_: (_ for _ in ()).throw(RuntimeError('provider timeout'))
        self.assertEqual(worker.sync_once(), 0)
        self.assertEqual(scenario.db.rows['customers'][0]['points_balance'], 100)
        self.assertEqual(scenario.logs[0][0], 'storehub_void_sync_failed')


class ReceiptAndWalletTests(unittest.TestCase):
    def test_all_sixty_cancellations_are_reversed_beyond_old_forty_cap(self):
        scenario = Scenario()
        scenario.db.rows['pos_transactions'] = [sale(number) for number in range(1, 61)]
        rows = [cancellation(number) for number in range(1, 61)]
        worker = scenario.worker()
        self.assertEqual(worker.reverse_cancelled_rows(scenario.device, scenario.integration, rows), 60)
        self.assertEqual(scenario.db.rows['customers'][0]['points_balance'], 40)
        self.assertEqual(len(scenario.queue_calls), 60)
        self.assertTrue(all(row['status'] == 'voided' for row in scenario.db.rows['pos_transactions']))

    def test_duplicate_provider_rows_reverse_and_enqueue_once(self):
        scenario = Scenario()
        rows = [cancellation(), cancellation()]
        self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, rows), 1)
        self.assertEqual(len(scenario.rpc_calls), 1)
        self.assertEqual(len(scenario.queue_calls), 1)

    def test_foreign_outlet_or_branch_never_changes_balance(self):
        for alter_row in (True, False):
            with self.subTest(alter_provider_row=alter_row):
                scenario = Scenario()
                rows = [cancellation(storeId='outlet-foreign')] if alter_row else [cancellation()]
                if not alter_row:
                    scenario.db.rows['pos_transactions'][0]['branch_id'] = 'branch-foreign'
                self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, rows), 0)
                self.assertEqual(scenario.rpc_calls, [])
                self.assertEqual(scenario.db.rows['customers'][0]['points_balance'], 100)

    def test_string_false_and_other_truthy_values_are_not_cancellations(self):
        for value in ('false', 'true', 1, False, None):
            with self.subTest(is_cancelled=value):
                scenario = Scenario()
                rows = [cancellation(isCancelled=value)]
                self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, rows), 0)
                self.assertEqual(scenario.rpc_calls, [])

    def test_receipt_fallback_finds_sale_if_provider_ref_has_changed(self):
        scenario = Scenario()
        rows = [cancellation(refId='unmatched-ref')]
        self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, rows), 1)
        self.assertEqual(scenario.db.rows['pos_transactions'][0]['status'], 'voided')

    def test_already_voided_without_pending_marker_skips_rpc_and_wallet(self):
        scenario = Scenario()
        scenario.db.rows['pos_transactions'][0]['status'] = 'voided'
        self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, [cancellation()]), 0)
        self.assertEqual(scenario.rpc_calls, [])
        self.assertEqual(scenario.queue_calls, [])

    def test_racing_atomic_rpc_changed_false_does_not_enqueue_without_marker(self):
        scenario = Scenario()
        scenario.reverse_override = lambda _: {'changed': False, 'transaction': sale(status='voided')}
        self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, [cancellation()]), 0)
        self.assertEqual(len(scenario.rpc_calls), 1)
        self.assertEqual(scenario.queue_calls, [])

    def test_changed_false_with_pending_marker_retries_wallet(self):
        scenario = Scenario()
        transaction = scenario.db.rows['pos_transactions'][0]
        transaction.update(status='voided', processing_metadata={'void_wallet_sync_pending': True})
        scenario.db.rows['customers'][0]['points_balance'] = 73
        self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, [cancellation()]), 0)
        self.assertEqual(len(scenario.rpc_calls), 1)
        self.assertEqual(scenario.queue_calls[0][0]['points_balance'], 73)
        self.assertFalse(subject.wallet_pending(transaction))

    def test_queue_failure_preserves_marker_and_retry_uses_final_customer_balance(self):
        scenario = Scenario()
        worker = scenario.worker()
        scenario.db.rows['pos_transactions'] = [sale(1, points_awarded=10), sale(2, points_awarded=20)]
        scenario.queue_available = False
        self.assertEqual(worker.reverse_cancelled_rows(scenario.device, scenario.integration,
                                                     [cancellation(1), cancellation(2)]), 2)
        self.assertEqual(scenario.db.rows['customers'][0]['points_balance'], 70)
        self.assertTrue(all(subject.wallet_pending(row) for row in scenario.db.rows['pos_transactions']))
        scenario.queue_calls.clear()
        scenario.queue_available = True
        worker.drain_wallet_pending(scenario.integration)
        self.assertEqual(len(scenario.queue_calls), 2)
        self.assertTrue(all(call[0]['points_balance'] == 70 for call in scenario.queue_calls))
        self.assertTrue(all(not subject.wallet_pending(row) for row in scenario.db.rows['pos_transactions']))
        reversals = [args for name, args in scenario.rpc_calls if name == 'pos_reverse_storehub_void']
        self.assertEqual(len(reversals), 2, 'Wallet retry must not repeat balance RPC')

    def test_queue_ack_missing_job_id_keeps_pending_marker(self):
        scenario = Scenario()
        worker = scenario.worker()
        worker.enqueue_wallet = lambda *_: {'status': 'queued'}
        self.assertEqual(worker.reverse_cancelled_rows(scenario.device, scenario.integration, [cancellation()]), 1)
        self.assertTrue(subject.wallet_pending(scenario.db.rows['pos_transactions'][0]))

    def test_failed_marker_clear_can_retry_without_reversing_balance_again(self):
        scenario = Scenario()
        worker = scenario.worker()
        scenario.db.fail_updates = True
        self.assertEqual(worker.reverse_cancelled_rows(scenario.device, scenario.integration, [cancellation()]), 1)
        self.assertTrue(subject.wallet_pending(scenario.db.rows['pos_transactions'][0]))
        scenario.db.fail_updates = False
        worker.drain_wallet_pending(scenario.integration)
        self.assertEqual(scenario.db.rows['customers'][0]['points_balance'], 99)
        self.assertFalse(subject.wallet_pending(scenario.db.rows['pos_transactions'][0]))

    def test_invalid_rpc_response_never_falls_back_to_python_balance_write(self):
        scenario = Scenario()
        scenario.reverse_override = lambda _: {'changed': True}
        self.assertEqual(scenario.worker().reverse_cancelled_rows(scenario.device, scenario.integration, [cancellation()]), 0)
        self.assertEqual(scenario.db.rows['customers'][0]['points_balance'], 100)
        self.assertEqual(scenario.queue_calls, [])
        self.assertEqual(scenario.logs[0][0], 'void_points_reverse_failed')


class PeriodicWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_sixty_second_wait_starts_after_each_completed_scan_and_never_overlaps(self):
        sleeping = []
        running = 0
        maximum_running = 0
        calls = 0

        def scan():
            nonlocal running, maximum_running, calls
            running += 1
            maximum_running = max(maximum_running, running)
            calls += 1
            running -= 1

        async def sleep(delay):
            self.assertEqual(running, 0, 'Each scan must finish before rescheduling')
            sleeping.append(delay)
            if len(sleeping) == 3:
                raise asyncio.CancelledError

        with patch.object(subject.asyncio, 'sleep', side_effect=sleep):
            with self.assertRaises(asyncio.CancelledError):
                await subject.periodic_void_sync(scan, interval_seconds=60)
        self.assertEqual(sleeping, [60, 60, 60])
        self.assertEqual(calls, 3)
        self.assertEqual(maximum_running, 1)

    async def test_varying_claim_latency_does_not_skip_a_tick_for_early_sixty_second_lease(self):
        # A claim that took 1s on the first tick and 0.1s on the next can arrive
        # early if starts are exactly 60s apart. A full wait after scan completion
        # keeps all claims eligible despite decreasing request latency.
        clock = 0.0
        last_claim = None
        accepted_claims = []
        attempted_claims = []
        latencies = [1.0, 0.1, 3.0, 0.01]
        calls = 0

        def scan():
            nonlocal clock, last_claim, calls
            clock += latencies[calls]
            attempted_claims.append(clock)
            if last_claim is None or clock - last_claim >= 60:
                last_claim = clock
                accepted_claims.append(clock)
            clock += 0.25  # Provider work after the claim.
            calls += 1

        async def sleep(delay):
            nonlocal clock
            self.assertEqual(delay, 60)
            clock += delay
            if calls == len(latencies):
                raise asyncio.CancelledError

        with patch.object(subject.asyncio, 'sleep', side_effect=sleep):
            with self.assertRaises(asyncio.CancelledError):
                await subject.periodic_void_sync(scan)
        self.assertEqual(len(accepted_claims), 4)
        self.assertEqual(accepted_claims, attempted_claims)
        self.assertTrue(all(later - earlier >= 60
                            for earlier, later in zip(accepted_claims, accepted_claims[1:])))

    async def test_sub_minute_configuration_clamped_to_sixty_seconds(self):
        delays = []

        async def stop_after_sleep(delay):
            delays.append(delay)
            raise asyncio.CancelledError

        with patch.object(subject.asyncio, 'sleep', side_effect=stop_after_sleep):
            with self.assertRaises(asyncio.CancelledError):
                await subject.periodic_void_sync(lambda: None, interval_seconds=1)
        self.assertEqual(delays, [60])

    async def test_scan_failure_logged_and_later_tick_still_runs(self):
        calls = 0
        delays = []
        logs = []

        def scan():
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError('one failed scan')

        async def stop_after_second_sleep(delay):
            delays.append(delay)
            if len(delays) == 2:
                raise asyncio.CancelledError

        with patch.object(subject.asyncio, 'sleep', side_effect=stop_after_second_sleep):
            with self.assertRaises(asyncio.CancelledError):
                await subject.periodic_void_sync(scan, log=lambda event, **data: logs.append((event, data)))
        self.assertEqual(calls, 2)
        self.assertEqual(delays, [60, 60])
        self.assertEqual(logs, [('storehub_void_worker_failed', {'error': 'one failed scan'})])

    async def test_task_cancelled_during_scan_exits_without_next_tick(self):
        started = asyncio.Event()
        calls = 0

        async def blocked_thread(function):
            nonlocal calls
            calls += 1
            started.set()
            await asyncio.Event().wait()

        with patch.object(subject.asyncio, 'to_thread', side_effect=blocked_thread):
            task = asyncio.create_task(subject.periodic_void_sync(lambda: None))
            await asyncio.wait_for(started.wait(), timeout=1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        self.assertEqual(calls, 1)


if __name__ == '__main__':
    unittest.main()
