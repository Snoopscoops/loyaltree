"""Current-RSS LT worker recovery without app startup, threads or real sleeps."""
import ast
import asyncio
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock, patch

from backend import runtime_metrics
from backend.apple_memory import MemoryPressure


SOURCE = Path(os.environ.get('LT_MEMORY_MAIN_SOURCE', Path(__file__).resolve().parents[1] / 'main.py'))
if not SOURCE.is_file():
    SOURCE = Path('/Users/user24/Desktop/loyaltree/backend/main.py')
NAMES = {'_current_rss_mb', '_lt_benefits_worker'}
NODES = [node for node in ast.parse(SOURCE.read_text()).body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in NAMES]
if {node.name for node in NODES} != NAMES:
    raise AssertionError('Production LT memory guard or worker missing')
CODE = compile(ast.Module(body=NODES, type_ignores=[]), str(SOURCE), 'exec')


def fixture(stop_after=1):
    sleeps, calls, logs = [], [], []
    async def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) >= stop_after:
            raise asyncio.CancelledError
    async def to_thread(fn, *args, **kwargs):
        return fn(*args, **kwargs)
    def operation(name):
        return lambda *args, **kwargs: calls.append((name, args, kwargs))
    env = dict(__name__='backend._lt_memory_worker_test', __package__='backend', Optional=Optional,
        asyncio=SimpleNamespace(sleep=sleep, to_thread=to_thread),
        _lt_retry_purchase_awards=operation('purchase_retries'),
        _lt_benefits=SimpleNamespace(maintenance=operation('maintenance'), process_wallet_jobs=operation('wallet_jobs')),
        _lt_card_upgrades=SimpleNamespace(tick=operation('card_upgrades')),
        log_event=lambda *args, **fields: logs.append((args, fields)))
    exec(CODE, env)
    env['memory_pressure'] = MemoryPressure(lambda: runtime_metrics.current_rss_mb(), env['log_event'])
    return env, sleeps, calls, logs


class BenefitsWorkerMemoryTests(unittest.TestCase):
    def run_worker(self, env):
        with self.assertRaises(asyncio.CancelledError):
            asyncio.run(env['_lt_benefits_worker']())

    def assert_normal_work(self, calls):
        self.assertEqual(calls, [('purchase_retries', (), {}), ('maintenance', (), {'limit': 10}),
                                ('wallet_jobs', (), {'limit': 2}), ('card_upgrades', (), {'limit': 2})])

    def test_actual_helper_uses_current_rss_never_lifetime_peak_and_preserves_unknown(self):
        env, _, _, _ = fixture()
        with patch.object(runtime_metrics, 'current_rss_mb', return_value=245.25), \
             patch('resource.getrusage', return_value=SimpleNamespace(ru_maxrss=999 * 1024)) as peak:
            self.assertEqual(env['_current_rss_mb'](), 245.25)
            peak.assert_not_called()
        with patch.object(runtime_metrics, 'current_rss_mb', return_value=None):
            self.assertIsNone(env['_current_rss_mb']())
        with patch.object(runtime_metrics, 'current_rss_mb', side_effect=OSError('Synthetic metrics unavailable')):
            self.assertIsNone(env['_current_rss_mb']())

    def test_high_current_memory_pauses_then_worker_recovers_after_memory_falls(self):
        env, sleeps, calls, logs = fixture(stop_after=3)
        with patch.object(runtime_metrics, 'current_rss_mb', side_effect=[410.0, 365.0, 245.0]) as reader:
            self.run_worker(env)
        self.assertEqual(reader.call_count, 3)
        self.assertEqual(sleeps, [30, 30, 20])
        self.assert_normal_work(calls)
        self.assertEqual([event[0][0] for event in logs], ['lt_benefits_memory_pause', 'wallet_memory_resumed'])
        self.assertEqual([event[1]['rss_mb'] for event in logs], [410.0, 245.0])

    def test_unknown_or_failed_measurement_does_not_throw_skip_work_or_trigger_pause(self):
        for outcome in (None, OSError('Synthetic unavailable reading')):
            with self.subTest(outcome=type(outcome).__name__):
                env, sleeps, calls, logs = fixture()
                reader = Mock(side_effect=outcome) if isinstance(outcome, BaseException) else Mock(return_value=outcome)
                with patch.object(runtime_metrics, 'current_rss_mb', reader):
                    self.run_worker(env)
                self.assertEqual(sleeps, [20])
                self.assert_normal_work(calls)
                self.assertEqual(logs, [])

    def test_existing_350_mib_boundary_keeps_normal_worker_limits_and_cadence(self):
        env, sleeps, calls, logs = fixture()
        with patch.object(runtime_metrics, 'current_rss_mb', return_value=350.0):
            self.run_worker(env)
        self.assertEqual(sleeps, [20])
        self.assert_normal_work(calls)
        self.assertEqual(logs, [])


if __name__ == '__main__':
    unittest.main()
