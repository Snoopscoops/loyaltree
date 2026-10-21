"""AST tests for StoreHub fetch and worker wiring, without app startup/live I/O."""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import AsyncMock, Mock


LOCAL_SOURCE = (Path(__file__).with_name('main.py') if Path(__file__).with_name('main.py').is_file() else Path(__file__).resolve().parents[1] / 'main.py')
SOURCE = (LOCAL_SOURCE if LOCAL_SOURCE.is_file()
          else Path('/Users/user24/Desktop/loyaltree/backend/main.py'))
NODES = {node.name: node for node in ast.parse(SOURCE.read_text()).body
         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
NOW = datetime(2026, 10, 14, 18, 0, tzinfo=timezone.utc)


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz else NOW.replace(tzinfo=None)


class FakeHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code, self.detail = status_code, detail


def load(names, environment):
    definitions = [deepcopy(NODES[name]) for name in names]
    for node in definitions:
        node.decorator_list = []
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(SOURCE), 'exec'), environment)
    return environment


def receipt(identifier, *, cancelled=False, age=timedelta(minutes=1)):
    return {
        'refId': identifier, 'invoiceNumber': f'invoice-{identifier}',
        'storeId': 'outlet-1', 'transactionTime': (NOW - age).isoformat(),
        'isCancelled': cancelled, 'total': 125,
    }


class FetchHarness:
    def __init__(self, responder, page_size=5000):
        self.requests = []
        self.observed = []
        self.logs = []
        self.debug_events = []
        self.warning_events = []
        self.hint_saved = Mock()
        self.integration = {
            'id': 'integration-1', 'mode': 'live', 'status': 'live',
            'config': {'real_api_tested': True, 'storehub_outlets': [{'id': 'outlet-1'}]},
        }

        def fetch(integration, path, params):
            self.requests.append(deepcopy(params))
            assert path == '/transactions'
            return {'rows': deepcopy(responder(params))}

        def parse_timestamp(value):
            return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None

        self.env = load([
            '_storehub_transaction_event_time', '_storehub_recent_rows',
            '_storehub_page_fingerprint', '_storehub_rows_for_outlet',
            '_storehub_rows_time_bounds', '_storehub_paging_hint',
            '_storehub_fetch_recent_transaction_rows', '_log_storehub_void_sync',
            '_fetch_storehub_void_rows',
        ], {
            'datetime': FrozenDateTime, 'timedelta': timedelta, 'timezone': timezone,
            'Optional': Optional, 'HTTPException': FakeHTTPException,
            'time': SimpleNamespace(sleep=Mock()),
            'STOREHUB_TX_PAGE_SIZE': page_size, 'STOREHUB_TX_MAX_PROBE_PAGES': 30,
            'STOREHUB_TX_PROBE_SLEEP_SECONDS': 0, 'STOREHUB_VOID_LOOKBACK_DAYS': 1,
            '_storehub_get': fetch, '_storehub_list': lambda value: value['rows'],
            '_storehub_is_placeholder_location_id': lambda value: value.startswith('test-'),
            '_storehub_save_paging_hint': self.hint_saved,
            '_storehub_tx_fetch_log': lambda **kwargs: self.logs.append(kwargs),
            '_companion_debug': lambda event, **kwargs: self.debug_events.append((event, kwargs)),
            'log_event': lambda event, level, **kwargs: self.warning_events.append((event, level, kwargs)),
            '_pos_parse_timestamp': parse_timestamp,
            '_storehub_register_id': lambda row: row.get('terminal', ''),
        })

    def observe(self, rows):
        self.observed.extend(deepcopy(rows))

    def fetch(self, **kwargs):
        return self.env['_storehub_fetch_recent_transaction_rows'](
            self.integration, start=NOW - timedelta(days=1), end=NOW,
            external_branch_id='outlet-1', row_observer=self.observe, **kwargs)


class CancellationFetchTests(unittest.TestCase):
    def test_void_fetch_retains_cancellations_before_checkout_active_sale_slicing(self):
        cancelled = receipt('void-1', cancelled=True)
        rows = [cancelled] + [receipt(f'sale-{number}') for number in range(160)]
        harness = FetchHarness(lambda params: rows)
        result = harness.env['_fetch_storehub_void_rows'](harness.integration, 'outlet-1')
        self.assertEqual(result, [cancelled])
        checkout_rows = harness.env['_storehub_recent_rows'](rows, 20, 'outlet-1')
        self.assertTrue(all(row['isCancelled'] is False for row in checkout_rows))
        self.assertEqual(len(harness.requests), 1)

    def test_void_fetch_keeps_more_than_forty_cancellations(self):
        cancelled = [receipt(f'void-{number}', cancelled=True) for number in range(60)]
        rows = cancelled + [receipt(f'sale-{number}') for number in range(120)]
        harness = FetchHarness(lambda params: rows)
        result = harness.env['_fetch_storehub_void_rows'](harness.integration, 'outlet-1')
        self.assertEqual(result, cancelled)

    def test_observer_keeps_base_and_deep_probe_cancellations_before_final_truncation(self):
        old = timedelta(days=3)
        first = [receipt('base-void', cancelled=True, age=old)] + [
            receipt(f'base-{number}', age=old) for number in range(149)]
        advanced = [receipt('advanced-void', cancelled=True)] + [
            receipt(f'advanced-{number}') for number in range(119)]
        harness = FetchHarness(lambda params: advanced if params.get('offset') == 150 else first,
                               page_size=150)
        _, returned, metadata = harness.fetch(deep_probe=True)
        observed_cancellations = [row['refId'] for row in harness.observed if row['isCancelled'] is True]
        self.assertEqual(observed_cancellations, ['base-void', 'advanced-void'])
        self.assertFalse(any(row['isCancelled'] for row in returned),
                         'Checkout sorting can discard voids; observer must retain them independently')
        self.assertEqual(len(returned), 100)
        self.assertEqual(metadata['provider_requests'], 2)

    def test_observer_keeps_hint_page_cancellation_when_return_advances_to_next_page(self):
        first = [receipt('hint-void', cancelled=True)] + [receipt(f'hint-{number}') for number in range(149)]
        advanced = [receipt('next-void', cancelled=True)] + [receipt(f'next-{number}') for number in range(19)]
        harness = FetchHarness(lambda params: first if params.get('offset') == 150 else advanced,
                               page_size=150)
        harness.integration['config']['storehub_transaction_paging'] = {
            'strategy': 'offset', 'cursor': 150, 'external_branch_id': 'outlet-1',
        }
        _, returned, metadata = harness.fetch(deep_probe=False)
        self.assertEqual([row['refId'] for row in harness.observed if row['isCancelled']],
                         ['hint-void', 'next-void'])
        self.assertEqual([row['refId'] for row in returned if row['isCancelled']], ['next-void'])
        self.assertTrue(metadata['used_persisted_hint'])
        self.assertEqual([request['offset'] for request in harness.requests], [150, 300])

    def test_void_worker_ignores_checkout_hint_from_different_date_window(self):
        cancelled = receipt('recent-void', cancelled=True)
        harness = FetchHarness(lambda params: [] if 'offset' in params else [cancelled])
        hint = {'strategy': 'offset', 'cursor': 5000, 'external_branch_id': 'outlet-1'}
        harness.integration['config']['storehub_transaction_paging'] = deepcopy(hint)
        result = harness.env['_fetch_storehub_void_rows'](harness.integration, 'outlet-1')
        self.assertEqual(result, [cancelled], 'Void scan must not reuse a cursor for another date window')
        self.assertEqual(harness.requests, [{'from': '2026-10-13', 'to': '2026-10-14', 'storeId': 'outlet-1'}])
        self.assertEqual(harness.integration['config']['storehub_transaction_paging'], hint,
                         'Void fetch must leave checkout paging configuration intact')

    def test_capped_recent_void_scan_does_not_probe_historical_pages_each_minute(self):
        rows = [receipt(f'item-{number}') for number in range(150)]
        harness = FetchHarness(lambda params: rows, page_size=150)
        self.assertEqual(harness.env['_fetch_storehub_void_rows'](harness.integration, 'outlet-1'), [])
        self.assertEqual(len(harness.requests), 1)
        harness.hint_saved.assert_not_called()
        self.assertIn(('storehub_void_page_capped', 'warning', {
            'integration_id': 'integration-1', 'outlet_id': 'outlet-1', 'row_count': 150,
        }), harness.warning_events)

    def test_unmapped_or_foreign_outlet_fails_before_provider_request(self):
        for outlet in ('test-placeholder', 'foreign-outlet'):
            with self.subTest(outlet=outlet):
                harness = FetchHarness(lambda params: [])
                with self.assertRaises(RuntimeError):
                    harness.env['_fetch_storehub_void_rows'](harness.integration, outlet)
                self.assertEqual(harness.requests, [])


class ReadOnlyPeekTests(unittest.TestCase):
    def test_real_peek_adapter_does_not_invoke_reversal_or_wallet_even_for_cancelled_rows(self):
        rows = [receipt('cancelled-sale', cancelled=True), receipt('active-sale')]
        harness = FetchHarness(lambda params: rows)
        device = {
            'id': 'device-1', 'provider': 'storehub', 'business_id': 'business-1',
            'branch_id': 'branch-1', 'integration_id': 'integration-1', 'metadata': {},
        }
        mapping = {'external_branch_id': 'outlet-1', 'branch_id': 'branch-1', 'integration_id': 'integration-1'}
        database_tables = []

        def table(name):
            database_tables.append(name)
            if name != 'pos_integrations':
                raise AssertionError(f'Unexpected read-only adapter mutation {name}')
            query = Mock()
            query.update.return_value = query
            query.eq.return_value = query
            query.execute.return_value = SimpleNamespace(data=[])
            return query

        def normalize(provider, row):
            return {'transaction_type': 'void' if row['isCancelled'] else 'sale',
                    'external_transaction_id': row['refId'],
                    'external_receipt_number': row['invoiceNumber'],
                    'transacted_at': row['transactionTime'], 'gross_amount': row['total']}

        def upsert(device, item, mapping):
            return {'id': f"normalized-{item['external_transaction_id']}",
                    'integration_id': device['integration_id'], 'branch_id': device['branch_id'],
                    'currency': 'PHP', 'status': 'received', **item}

        blocked_reversal = Mock(side_effect=AssertionError('Read-only peek must not reverse points'))
        blocked_wallet = Mock(side_effect=AssertionError('Read-only peek must not refresh Wallet'))
        harness.env.update({
            'Header': lambda **kwargs: '', 'supabase': SimpleNamespace(table=table),
            '_require_pos_device': lambda token: deepcopy(device),
            '_get_pos_integration': lambda business_id, provider: deepcopy(harness.integration),
            '_companion_mock_mapping': lambda device: deepcopy(mapping),
            '_pos_current_register_device': lambda device, require_unambiguous=True: deepcopy(device),
            '_pos_record_storehub_registers': Mock(),
            '_pos_device_register_id': lambda device: '',
            '_pos_device_seen_register_ids': lambda device: [],
            '_companion_normalize_provider_transaction': normalize,
            '_companion_upsert_bridge_transaction': upsert,
            '_companion_reverse_voided_sales': blocked_reversal,
            '_storehub_void_sync_service': blocked_reversal,
            'enqueue_wallet_sync': blocked_wallet,
            '_ph_time_text': lambda value: value,
        })
        load(['_pos_transaction_register_id', '_companion_provider_rows', 'companion_pos_peek'], harness.env)
        result = harness.env['companion_pos_peek'](limit=10, x_lt_device_token='fake')
        self.assertTrue(result['read_only'])
        self.assertEqual([row['external_transaction_id'] for row in result['transactions']], ['active-sale'])
        blocked_reversal.assert_not_called()
        blocked_wallet.assert_not_called()
        self.assertEqual(database_tables, ['pos_integrations'])


class VoidLoggerTests(unittest.TestCase):
    def test_warning_events_remain_visible_with_companion_debug_disabled(self):
        logs, printing = Mock(), Mock()
        env = load(['_companion_debug', '_log_storehub_void_sync'], {
            'POS_COMPANION_DEBUG': False, 'datetime': FrozenDateTime,
            'log_event': logs, 'print': printing,
        })
        cases = (
            ('storehub_void_sync_failed', {'device_id': 'device-1'}),
            ('storehub_void_page_capped', {'outlet_id': 'outlet-1', 'row_count': 5000}),
            ('void_custom_failure', {'error': 'queue unavailable'}),
        )
        for event, fields in cases:
            with self.subTest(event=event):
                env['_log_storehub_void_sync'](event, **fields)
                logs.assert_called_with(event, 'warning', **fields)
        self.assertEqual(logs.call_count, len(cases))
        printing.assert_not_called()

    def test_success_events_stay_quiet_when_companion_debug_disabled(self):
        logs, printing = Mock(), Mock()
        env = load(['_companion_debug', '_log_storehub_void_sync'], {
            'POS_COMPANION_DEBUG': False, 'datetime': FrozenDateTime,
            'log_event': logs, 'print': printing,
        })
        env['_log_storehub_void_sync']('void_points_reversed', transaction_id='tx-1')
        logs.assert_not_called()
        printing.assert_not_called()


class WorkerLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def run_lifecycle(self, enabled):
        state = SimpleNamespace()
        app = SimpleNamespace(state=state)
        started = []
        cancelled = []
        pending = asyncio.Event()

        async def worker(name):
            started.append(name)
            try:
                await pending.wait()
            finally:
                cancelled.append(name)

        async def periodic(sync_once, interval_seconds, logger):
            self.assertIs(sync_once, sync_callback)
            self.assertEqual(interval_seconds, 60)
            self.assertIs(logger, logger_callback)
            await worker('void')

        sync_callback = Mock()
        logger_callback = Mock()
        monitor_stop, http_stop, profiler_stop = AsyncMock(), AsyncMock(), AsyncMock()
        profiler_checkpoint = Mock()
        env = load(['start_wallet_queue_worker', 'stop_monitoring'], {
            'app': app, 'asyncio': asyncio,
            'STOREHUB_VOID_SYNC_ENABLED': enabled, 'STOREHUB_VOID_SYNC_SECONDS': 60,
            'STOREHUB_OFFLINE_SALES_ENABLED': False,
            'lt_benefits_enabled': lambda: False,
            '_env_bool': lambda *_:False,
            'wallet_queue_worker': lambda: worker('wallet'),
            '_apple_layout_release_startup': lambda: worker('apple'),
            'periodic_void_sync': periodic, '_sync_storehub_voids_once': sync_callback,
            '_log_storehub_void_sync': logger_callback,
            'monitor': SimpleNamespace(stop=monitor_stop),
            'shared_http': SimpleNamespace(stop=http_stop),
            'profiler': SimpleNamespace(stop=profiler_stop, checkpoint=profiler_checkpoint),
        })
        await env['start_wallet_queue_worker']()
        profiler_checkpoint.assert_called_once_with('background_workers_scheduled')
        await asyncio.sleep(0)
        self.assertCountEqual(started, ['wallet', 'apple', 'void'] if enabled else ['wallet', 'apple'])
        self.assertEqual(hasattr(state, 'storehub_void_worker'), enabled)
        try:
            await env['stop_monitoring']()
            self.assertCountEqual(cancelled, started)
            for name in ('wallet_worker', 'apple_release_task', 'storehub_void_worker'):
                task = getattr(state, name, None)
                if task is not None:
                    self.assertTrue(task.done())
                    self.assertTrue(task.cancelled())
            monitor_stop.assert_awaited_once()
            http_stop.assert_awaited_once()
            profiler_stop.assert_awaited_once()
            sync_callback.assert_not_called()
        finally:
            for name in ('wallet_worker', 'apple_release_task', 'storehub_void_worker'):
                task = getattr(state, name, None)
                if task is not None and not task.done():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)

    async def test_startup_installs_sixty_second_void_worker_and_shutdown_cancels_it(self):
        await self.run_lifecycle(True)

    async def test_disabled_void_worker_leaves_wallet_and_apple_workers_running(self):
        await self.run_lifecycle(False)


if __name__ == '__main__':
    unittest.main()
