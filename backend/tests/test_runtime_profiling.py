"""Process diagnostics without database calls, live profiles, or customer records."""
import asyncio
import importlib
from io import StringIO
import json
from pathlib import Path
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from backend import runtime_metrics as metrics
from backend import runtime_profiling as profiling


def measurement(**changes):
    return {**dict(rss_mb=100, rss_peak_mb=120, container_memory_mb=200, container_limit_mb=512,
                cpu_total_seconds=1, threads=3, python_heap_mb=None, trace_overhead_mb=None), **changes}


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.clock, self.values = [0.0], measurement()
        self.service = profiling.SystemProfiler(clock=lambda: self.clock[0], memory_reader=lambda: dict(self.values),
            rss_reader=lambda: self.values['rss_mb'], endpoint_limit=3, business_limit=3)

    def request(self, endpoint='/api/v1/business/{slug}/stats', business='test-cafe', status=200, size=30):
        token = self.service.request_started()
        self.clock[0] += .1
        self.service.request_finished(token, method='GET', endpoint=endpoint, business_slug=business,
                                      status=status, response_bytes=size)

    def test_concurrency_timings_body_bytes_and_response_vs_background_work(self):
        a, b = self.service.request_started(), self.service.request_started()
        self.clock[0] = .2
        self.values['rss_mb'] = 130
        self.service.request_finished(a, method='GET', endpoint='/api/v1/business/{slug}/stats', business_slug='test-cafe',
            status=200, response_bytes=40, response_finished=.1)
        self.service.request_finished(b, method='GET', endpoint='/api/v1/business/{slug}/stats', business_slug='test-cafe',
            status=503, response_bytes=20, response_finished=.2)
        report = self.service.report()
        self.assertEqual(report['summary']['requests'], 2)
        self.assertEqual(report['summary']['inflight'], 0)
        self.assertEqual(report['summary']['peak_inflight'], 2)
        self.assertEqual(report['summary']['response_bytes'], 60)
        row = report['endpoints'][0]
        self.assertAlmostEqual(row['avg_ms'], 150)
        self.assertAlmostEqual(row['avg_work_ms'], 200)
        self.assertEqual(row['observed_rss_max_rise_mb'], 30)
        self.assertNotIn('observed_rss_max_rise_mb', report['businesses'][0])
        self.assertEqual(report['businesses'][0]['status_5xx'], 1)

    def test_group_and_history_bounds_include_overflow_without_exposing_customer_ids(self):
        for index in range(250):
            self.request(endpoint=f'/api/v1/business/{{slug}}/route-{index}', business=f'shop-{index}')
            self.service.record_wallet(f'job_{index}', 'test-cafe', duration_ms=30, wait_ms=10,
                                       outcome='ok', before=110, after=100)
            self.service.sample()
            self.service.checkpoint('test')
        self.request('/api/v1/customer/{public_id}', 'private-customer-id')
        report = self.service.report()
        self.assertLessEqual(len(report['endpoints']), 3)
        self.assertLessEqual(len(report['businesses']), 3)
        self.assertLessEqual(len(report['wallet_jobs']), 32)
        self.assertEqual(len(report['samples']), 180)
        self.assertEqual(len(report['startup']), 16)
        self.assertEqual(len(report['recent_wallet_jobs']), 40)
        self.assertEqual(sum(row['requests'] for row in report['endpoints']), 251)
        self.assertEqual(sum(row['requests'] for row in report['businesses']), 250)
        self.assertNotIn('private-customer-id', json.dumps(report))
        self.assertGreater(report['limits']['overflow']['endpoint_groups'], 0)
        self.assertEqual(report['recent_wallet_jobs'][0]['observed_rss_change_mb'], -10)
        self.assertEqual(report['wallet_jobs'][0]['avg_ms'], 20)
        self.assertEqual(report['wallet_jobs'][0]['avg_wait_ms'], 10)

    def test_cpu_averages_may_exceed_one_core_and_unavailable_rss_stays_null(self):
        self.service.sample()
        self.clock[0] = 2
        self.values.update(cpu_total_seconds=5, rss_mb=None)
        self.service.sample()
        report = self.service.report()
        self.assertEqual(report['process']['current']['cpu_percent'], 200)
        self.assertIsNone(report['process']['current']['rss_mb'])
        self.assertEqual(report['process']['current']['rss_peak_mb'], 120)

    def test_failed_measurement_does_not_leak_inflight_or_break_usage_report(self):
        def broken(): raise OSError('private path must not escape')
        self.service.read_rss = broken
        self.request()
        self.assertEqual(self.service.report()['summary']['inflight'], 0)
        self.service.read_memory = broken
        report = self.service.report()
        self.assertIsNone(report['process']['current']['rss_mb'])
        self.assertNotIn('private path', json.dumps(report))

    def test_admin_auth_precedes_report_or_capture_and_results_are_private(self):
        app, reads = FastAPI(), []
        def admin(request: Request):
            if request.headers.get('authorization') != 'Bearer fixture-admin': raise HTTPException(401, 'Admin authentication required')
        self.service.configure(caches=lambda: {'wallet_art': {'items': 2, 'bytes': 1024, 'max_bytes': 4194304}},
                               retained_maps=lambda: {'rate_buckets': 4})
        original = self.service.read_memory
        self.service.read_memory = lambda: (reads.append(True), original())[1]
        profiling.register_profiling_routes(app, require_admin=admin, service=self.service)
        with TestClient(app) as client:
            for headers in ({}, {'Authorization': 'Bearer owner-session'}):
                self.assertEqual(client.get('/api/v1/admin/system-usage', headers=headers).status_code, 401)
                self.assertEqual(client.post('/api/v1/admin/system-usage/profile', headers=headers).status_code, 401)
            self.assertFalse(reads)
            response = client.get('/api/v1/admin/system-usage', headers={'Authorization': 'Bearer fixture-admin'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'private, no-store')
            self.assertEqual(response.json()['caches'][0]['items'], 2)
            self.assertEqual(response.json()['retained_maps'], [{'name': 'rate_buckets', 'items': 4}])
            self.assertEqual(client.post('/api/v1/admin/system-usage/profile?seconds=600', headers={'Authorization': 'Bearer fixture-admin'}).status_code, 422)

    def test_package_and_flat_imports_share_the_same_profiler(self):
        self.assertIs(importlib.import_module('runtime_profiling').profiler,
                      importlib.import_module('backend.runtime_profiling').profiler)

    def test_os_measurements_preserve_binary_units_and_missing_fields(self):
        files = {'/proc/self/statm': '100 256 0', '/sys/fs/cgroup/memory.current': '104857600',
                 '/sys/fs/cgroup/memory.max': '536870912'}
        def read(path, *args, **kwargs):
            if path not in files: raise FileNotFoundError(path)
            return StringIO(files[path])
        with patch('builtins.open', side_effect=read), patch.object(metrics.os, 'sysconf', return_value=4096), \
             patch.object(metrics.resource, 'getrusage', return_value=SimpleNamespace(ru_maxrss=2048, ru_utime=.2, ru_stime=.3)), \
             patch.object(metrics.sys, 'platform', 'linux'):
            values = metrics.memory_usage()
            self.assertEqual(values['rss_mb'], 1)
            self.assertEqual(values['rss_peak_mb'], 2)
            self.assertEqual(values['container_memory_mb'], 100)
            self.assertEqual(values['container_limit_mb'], 512)
            self.assertEqual(values['cpu_total_seconds'], .5)
            files['/sys/fs/cgroup/memory.max'] = 'max'
            files.pop('/proc/self/statm')
            values = metrics.memory_usage()
            self.assertIsNone(values['rss_mb'])
            self.assertIsNone(values['container_limit_mb'])

    def test_allocation_rows_expose_code_locations_without_private_host_paths_or_source(self):
        backend = Path(profiling.__file__).resolve().parent
        def allocation(filename):
            return SimpleNamespace(traceback=[SimpleNamespace(filename=filename, lineno=12)], size=100, count=2)
        stats = [allocation(str(backend / 'main.py')),
                 allocation('/Users/private-person/lib/site-packages/fastapi/routing.py'),
                 allocation('/Users/private-person/email@example.invalid.py')]
        fake = SimpleNamespace(statistics=lambda grouping: stats)
        with patch.object(profiling.tracemalloc, 'take_snapshot', return_value=fake):
            rows = self.service._allocation_rows()
        self.assertEqual([row['file'] for row in rows], ['backend/main.py', 'site-packages/fastapi/routing.py'])
        self.assertNotIn('private-person', json.dumps(rows))
        self.assertNotIn('example.invalid', json.dumps(rows))


class TraceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.values = measurement()
        self.service = profiling.SystemProfiler(memory_reader=lambda: dict(self.values))
        self.enabled = False
        self.start = patch.object(profiling.tracemalloc, 'start', side_effect=self.enable).start()
        self.stop = patch.object(profiling.tracemalloc, 'stop', side_effect=self.disable).start()
        patch.object(profiling.tracemalloc, 'is_tracing', side_effect=lambda: self.enabled).start()
        self.addCleanup(patch.stopall)
        self.service._allocation_rows = lambda: [dict(file='backend/example.py', line=4, bytes=50, count=2)]

    def enable(self, *args): self.enabled = True
    def disable(self): self.enabled = False

    async def asyncTearDown(self): await self.service.stop()

    async def test_manual_capture_is_bounded_and_restores_tracing_to_off(self):
        result = await self.service.start_capture(.001)
        self.assertEqual(result['status'], 'started')
        await asyncio.wait_for(self.service.trace_task, 1)
        self.assertFalse(self.enabled)
        trace = self.service.report()['trace']
        self.assertFalse(trace['running'])
        self.assertEqual(trace['last_capture']['top_allocations'][0]['file'], 'backend/example.py')
        self.assertIsNone(trace['last_capture']['error'])

    async def test_overlap_and_memory_pressure_do_not_start_expensive_snapshots(self):
        await self.service.start_capture(30)
        with self.assertRaises(HTTPException) as error: await self.service.start_capture(30)
        self.assertEqual(error.exception.status_code, 409)
        await self.service.stop()
        self.assertFalse(self.enabled)  # Includes cancellation before coroutine first runs.
        self.values['container_memory_mb'] = 450
        with self.assertRaises(HTTPException) as error: await self.service.start_capture(30)
        self.assertEqual(error.exception.status_code, 409)
        self.assertFalse(self.enabled)

    async def test_shutdown_drains_snapshot_worker_before_stopping_tracing(self):
        entered, release = threading.Event(), threading.Event()
        observed = []
        def snapshot():
            entered.set(); release.wait(2)
            observed.append(self.enabled)
            return []
        self.service._allocation_rows = snapshot
        await self.service.start_capture(0)
        try:
            self.assertTrue(await asyncio.to_thread(entered.wait, 1))
            stopping = asyncio.create_task(self.service.stop())
            await asyncio.sleep(.01)
            self.assertTrue(self.service.trace['running'])
            self.assertFalse(stopping.done())
        finally: release.set()
        await stopping
        self.assertEqual(observed, [True])
        self.assertFalse(self.enabled)
        self.assertFalse(self.service.trace['running'])

    async def test_headroom_is_rechecked_before_snapshot(self):
        called = []
        self.service._allocation_rows = lambda: called.append(True)
        await self.service.start_capture(.001)
        self.values['container_memory_mb'] = 450
        await self.service.trace_task
        self.assertFalse(called)
        self.assertIn('skipped', self.service.trace['last_capture']['error'])

    async def test_startup_environment_trace_has_an_automatic_deadline(self):
        with patch.dict(profiling.os.environ, {'MEMORY_TRACE': '1'}): self.service.bootstrap()
        self.assertTrue(self.enabled)
        self.assertEqual(self.service.trace['source'], 'environment')
        self.service.environment_deadline = self.service.clock()
        loop = asyncio.create_task(self.service.run(lambda *args, **kwargs: None))
        try:
            await asyncio.sleep(0)
            await asyncio.wait_for(asyncio.shield(self.service.trace_task), 1)
            self.assertFalse(self.enabled)
        finally:
            loop.cancel(); await asyncio.gather(loop, return_exceptions=True)

    async def test_sampler_stops_tracing_when_container_memory_is_high(self):
        with patch.dict(profiling.os.environ, {'MEMORY_TRACE': '1'}): self.service.bootstrap()
        self.values['container_memory_mb'] = 450
        loop = asyncio.create_task(self.service.run(lambda *args, **kwargs: None))
        try:
            for _ in range(10):
                if not self.enabled: break
                await asyncio.sleep(0)
            self.assertFalse(self.enabled)
            self.assertIn('stopped automatically', self.service.trace['last_capture']['error'])
        finally:
            loop.cancel(); await asyncio.gather(loop, return_exceptions=True)
