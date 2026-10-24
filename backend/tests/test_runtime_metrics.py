"""Bounded, dependency-free container diagnostics using synthetic proc files."""
from io import StringIO
import unittest
from unittest.mock import patch

from backend import runtime_metrics as metrics


class ContainerMetricsTests(unittest.TestCase):
    def setUp(self):
        self.saved = metrics._details_at, metrics._details
        metrics._details_at, metrics._details = None, {}
        self.files, self.reads = {}, []

    def tearDown(self):
        metrics._details_at, metrics._details = self.saved

    def open(self, path, *args, **kwargs):
        self.reads.append(path)
        if path not in self.files: raise FileNotFoundError(path)
        return StringIO(self.files[path])

    def test_fresh_cgroup_usage_and_limit_do_not_read_breakdown_or_capture_heap(self):
        self.files = {'/sys/fs/cgroup/memory.current': str(388 * metrics.MIB),
                      '/sys/fs/cgroup/memory.max': str(512 * metrics.MIB)}
        with patch('builtins.open', side_effect=self.open):
            values = metrics.container_memory()
        self.assertEqual(metrics.container_headroom(values), 124)
        self.assertEqual(self.reads, list(self.files))
        self.assertEqual(set(values), {'container_memory_mb', 'container_limit_mb'})

    def test_v1_fallback_and_unlimited_or_missing_limits_remain_unavailable(self):
        self.files = {'/sys/fs/cgroup/memory/memory.usage_in_bytes': str(200 * metrics.MIB),
                      '/sys/fs/cgroup/memory/memory.limit_in_bytes': str(512 * metrics.MIB)}
        with patch('builtins.open', side_effect=self.open):
            self.assertEqual(metrics.container_headroom(metrics.container_memory()), 312)
            self.files['/sys/fs/cgroup/memory/memory.limit_in_bytes'] = str(1 << 63)
            self.assertIsNone(metrics.container_memory()['container_limit_mb'])
            self.assertIsNone(metrics.container_headroom(metrics.container_memory()))
            self.files.clear()
            self.assertEqual(metrics.container_memory(), {'container_memory_mb': None, 'container_limit_mb': None})

    def test_container_components_and_parent_rss_are_cached_for_30_seconds(self):
        self.files = {'/sys/fs/cgroup/memory.stat': 'anon 52428800\nfile 83886080\nkernel 12582912\n',
                      '/proc/60/statm': '1000 512 0'}
        now = [0]
        with patch('builtins.open', side_effect=self.open), \
             patch.object(metrics.os, 'getppid', return_value=60), \
             patch.object(metrics.os, 'sysconf', return_value=4096), \
             patch.object(metrics.time, 'monotonic', side_effect=lambda: now[0]):
            values = metrics.memory_details()
            self.assertEqual(values, dict(container_anon_mb=50, container_file_mb=80,
                container_kernel_mb=12, parent_pid=60, parent_rss_mb=2))
            count = len(self.reads)
            values['container_anon_mb'] = 999  # Callers cannot mutate the cache.
            now[0] = 29
            self.assertEqual(metrics.memory_details()['container_anon_mb'], 50)
            self.assertEqual(len(self.reads), count)
            now[0] = 30
            metrics.memory_details()
            self.assertEqual(len(self.reads), count * 2)

    def test_v1_component_names_and_missing_parent_or_kernel_are_not_fabricated(self):
        self.files = {'/sys/fs/cgroup/memory/memory.stat': 'total_rss 10485760\ntotal_cache 20971520\n'}
        with patch('builtins.open', side_effect=self.open):
            values = metrics.memory_details()
        self.assertEqual(values['container_anon_mb'], 10)
        self.assertEqual(values['container_file_mb'], 20)
        self.assertIsNone(values['container_kernel_mb'])
        self.assertIsNone(values['parent_rss_mb'])

    def test_invalid_or_unlimited_container_values_have_no_headroom(self):
        for used, limit in ((-1, 512), (100, 0), (100, None), (None, 512),
                            (float('nan'), 512), (100, float('inf'))):
            self.assertIsNone(metrics.container_headroom({
                'container_memory_mb': used, 'container_limit_mb': limit}))


if __name__ == '__main__': unittest.main()
