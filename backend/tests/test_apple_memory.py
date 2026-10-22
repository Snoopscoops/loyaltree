import unittest
import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fastapi import HTTPException
from backend.apple_memory import MemoryPressure
from backend.wallet_memory import wallet_work


class MemoryGateTests(unittest.TestCase):
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
