import unittest
import ast
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fastapi import HTTPException
from backend.apple_memory import MemoryPressure
from backend.wallet_memory import wallet_work


class MemoryGateTests(unittest.TestCase):
    def test_container_headroom_pauses_before_worker_rss_limit_and_recovers_at_idle(self):
        used = [388]
        log = Mock()
        gate = MemoryPressure(lambda: 174, log,
            read_container=lambda: {'container_memory_mb': used[0], 'container_limit_mb': 512},
            pause_headroom_mb=100, resume_headroom_mb=120)
        results = []
        for value in (388, 413, 410, 395, 388):
            used[0] = value
            results.append(gate.paused())
        self.assertEqual(results, [False, True, True, True, False])
        first = log.call_args_list[0].kwargs
        self.assertEqual(first['pressure_sources'], ['container_headroom'])
        self.assertEqual(first['container_headroom_mb'], 99)

    def test_worker_and_container_pause_reasons_must_both_recover(self):
        rss, used = [351], [413]
        gate = MemoryPressure(lambda: rss[0], Mock(), read_container=lambda: {
            'container_memory_mb': used[0], 'container_limit_mb': 512})
        self.assertTrue(gate.paused())
        rss[0] = 200
        self.assertTrue(gate.paused())
        rss[0], used[0] = 400, 388
        self.assertTrue(gate.paused())
        rss[0] = 299
        self.assertFalse(gate.paused())

    def test_unknown_container_readings_preserve_its_pause_and_never_block_initially(self):
        readings = Mock(side_effect=[{}, {'container_memory_mb': 413, 'container_limit_mb': 512},
            OSError('unavailable'), {'container_memory_mb': 100, 'container_limit_mb': None},
            {'container_memory_mb': 388, 'container_limit_mb': 512}])
        gate = MemoryPressure(lambda: 174, Mock(), read_container=readings)
        self.assertEqual([gate.paused() for _ in range(5)], [False, True, True, True, False])
        for limit in (None, 0, float('inf'), float('nan')):
            gate = MemoryPressure(lambda: 174, Mock(), read_container=lambda: {
                'container_memory_mb': 500, 'container_limit_mb': limit})
            self.assertFalse(gate.paused())

    def test_explicit_rss_reader_does_not_read_host_container(self):
        with patch('backend.apple_memory.container_memory', side_effect=AssertionError('host cgroup read')):
            self.assertFalse(MemoryPressure(lambda: 174, Mock()).paused())

    def test_headroom_threshold_configuration_is_finite_positive_and_hysteretic(self):
        with patch.dict(os.environ, {'APPLE_MEMORY_PAUSE_HEADROOM_MB': '96',
                                    'APPLE_MEMORY_RESUME_HEADROOM_MB': '112'}):
            gate = MemoryPressure(lambda: 174, Mock())
            self.assertEqual((gate.pause_headroom, gate.resume_headroom), (96, 112))
        for pause, resume in (('nan', '-1'), ('bad', 'inf')):
            gate = MemoryPressure(lambda: 174, Mock(), pause_headroom_mb=pause, resume_headroom_mb=resume)
            self.assertEqual((gate.pause_headroom, gate.resume_headroom), (100, 120))
        gate = MemoryPressure(lambda: 174, Mock(), pause_headroom_mb=110, resume_headroom_mb=100)
        self.assertGreater(gate.resume_headroom, gate.pause_headroom)

    def test_native_build_uses_container_guard_even_when_worker_rss_is_low(self):
        build = Mock(return_value=b'signed')
        guarded = wallet_work('apple_pass_build')(build)
        gate = MemoryPressure(lambda: 174, Mock(), read_container=lambda: {
            'container_memory_mb': 420, 'container_limit_mb': 512})
        with patch('backend.apple_memory.memory_pressure', gate):
            with self.assertRaises(HTTPException) as error: guarded()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.headers['Retry-After'], '30')
        build.assert_not_called()

    def test_pushes_defer_without_provider_calls_and_drain_after_recovery(self):
        source = Path(__file__).resolve().parents[1] / 'main.py'
        nodes = [n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in {'_send_apple_wallet_pushes', '_drain_deferred_apple_pushes'}]
        for node in nodes: node.decorator_list=[]
        gate = MemoryPressure(Mock(side_effect=[400, 290]), Mock())
        env = dict(memory_pressure=gate, _APPLE_DEFERRED_PUSHES={}, log_event=Mock(), _record_apple_delivery=Mock(), get_apple_push_cert_files=Mock())
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), env)
        self.assertEqual(env['_send_apple_wallet_pushes'](['phone', 'phone']), 0)
        self.assertEqual(env['_APPLE_DEFERRED_PUSHES'], {'phone': True})
        env['get_apple_push_cert_files'].assert_not_called()
        send = env['_send_apple_wallet_pushes'] = Mock(return_value=1)
        env['_drain_deferred_apple_pushes']()
        send.assert_called_once_with(['phone'])
        self.assertFalse(env['_APPLE_DEFERRED_PUSHES'])

    def test_hysteresis_uses_current_memory_and_unknown_preserves_pause(self):
        read = Mock(side_effect=[250, 351, 330, None, 300, 299, 340])
        log = Mock()
        gate = MemoryPressure(read, log)
        self.assertEqual([gate.paused() for _ in range(7)], [False, True, True, True, True, False, False])
        self.assertEqual([c.args[0] for c in log.call_args_list], ['lt_benefits_memory_pause', 'wallet_memory_resumed'])

    def test_cold_native_build_is_blocked_then_resumes(self):
        build = Mock(return_value=b'signed')
        guarded = wallet_work('apple_pass_build')(build)
        with patch('backend.apple_memory.memory_pressure', MemoryPressure(lambda: 400, Mock())):
            with self.assertRaises(HTTPException) as error: guarded()
            self.assertEqual(error.exception.status_code, 503)
            self.assertEqual(error.exception.headers['Retry-After'], '30')
            build.assert_not_called()
        with patch('backend.apple_memory.memory_pressure', MemoryPressure(lambda: 200, Mock())):
            self.assertEqual(guarded(), b'signed')


if __name__ == '__main__': unittest.main()
