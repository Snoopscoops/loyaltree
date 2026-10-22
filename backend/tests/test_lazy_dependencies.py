from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch
from backend.lazy_imports import LazyModule
from backend import shared_http


class LazyDependencyTests(unittest.TestCase):
    def test_shared_helpers_do_not_import_supabase_qrcode_or_pillow(self):
        backend = Path(__file__).resolve().parents[1]
        script = "import sys; import shared_http,wallet_memory; db=shared_http.create_pooled_supabase('https://example.supabase.co','fixture'); assert db; assert not any(k in sys.modules for k in ['supabase','qrcode','PIL.Image'])"
        result = subprocess.run([sys.executable, '-c', script], cwd=backend, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_concurrent_sdk_first_access_initializes_once(self):
        client=Mock();client.table.return_value='query'
        with patch.object(shared_http, '_create_supabase_client', return_value=client) as create:
            db=shared_http.create_pooled_supabase('https://example.supabase.co','fixture')
            create.assert_not_called()
            with ThreadPoolExecutor(max_workers=8) as pool:
                self.assertEqual(list(pool.map(lambda _:db.table('customers'),range(8))), ['query']*8)
            create.assert_called_once()

    def test_lazy_module_does_not_import_until_first_attribute(self):
        with patch('backend.lazy_imports.import_module', return_value=Mock(value=7)) as load:
            module=LazyModule('fixture')
            load.assert_not_called()
            self.assertEqual(module.value,7)
            self.assertEqual(module.value,7)
            load.assert_called_once_with('fixture')


if __name__ == '__main__': unittest.main()
