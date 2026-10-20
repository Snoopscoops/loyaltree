"""Bounded, process-local usage diagnostics. No request bodies or customer data."""
import asyncio
from collections import OrderedDict, deque
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import re
import sys
from threading import RLock
from threading import active_count
import time
import tracemalloc

try:
    from .runtime_metrics import memory_usage, current_rss_mb
except ImportError:
    from runtime_metrics import memory_usage, current_rss_mb

# main.py and its existing dependencies mix package and flat imports. They must
# all see one profiler, including when started with `uvicorn backend.main:app`.
sys.modules.setdefault('runtime_profiling', sys.modules[__name__])
sys.modules.setdefault('backend.runtime_profiling', sys.modules[__name__])

INTERVAL = 30
SAMPLE_LIMIT = 180
SLUG = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def _base():
    return dict(requests=0, status_2xx=0, status_3xx=0, status_4xx=0, status_5xx=0,
                duration_ms=0, work_ms=0, max_ms=0, response_bytes=0, largest_response_bytes=0,
                observed_rss_max_rise_mb=None, rss_observations=0)


class SystemProfiler:
    def __init__(self, *, clock=time.monotonic, memory_reader=memory_usage, rss_reader=current_rss_mb,
                 endpoint_limit=128, business_limit=100):
        self.clock, self.read_memory, self.read_rss = clock, memory_reader, rss_reader
        self.started, self.started_at = clock(), utc_now()
        self.lock = RLock()
        self.summary = _base()
        self.inflight = self.peak_inflight = 0
        self.endpoints, self.businesses, self.wallet_jobs = OrderedDict(), OrderedDict(), OrderedDict()
        self.endpoint_limit, self.business_limit = endpoint_limit, business_limit
        self.overflow = dict(endpoint_groups=0, business_groups=0, wallet_groups=0)
        self.samples, self.startup, self.recent_wallet = deque(maxlen=SAMPLE_LIMIT), deque(maxlen=16), deque(maxlen=40)
        self.cache_provider, self.maps_provider = lambda: {}, lambda: {}
        self.last_cpu = None
        self.trace_task = None
        self.trace_stop_after = False
        self.environment_deadline = None
        self.trace = dict(enabled=False, source='off', running=False, deadline=None, started_at=None, last_capture=None, overhead_mb=None)

    def configure(self, *, caches=None, retained_maps=None):
        if caches is not None: self.cache_provider = caches
        if retained_maps is not None: self.maps_provider = retained_maps

    def _memory(self):
        try: return self.read_memory()
        except Exception:
            return dict(pid=os.getpid(), rss_mb=None, rss_peak_mb=None, container_memory_mb=None,
                        container_limit_mb=None, cpu_total_seconds=None, cpu_percent=None,
                        threads=active_count(), python_heap_mb=None, trace_overhead_mb=None)

    def bootstrap(self):
        # Start early enough to include imports/models/routes when explicitly enabled.
        if os.getenv('MEMORY_TRACE', '').lower() in ('1', 'true') or tracemalloc.is_tracing():
            if not tracemalloc.is_tracing(): tracemalloc.start(1)
            self.trace.update(enabled=True, source='environment', started_at=utc_now())
            self.environment_deadline = self.started + 120
        self.checkpoint('main_module_enter')

    def checkpoint(self, name):
        values = self._memory()
        item = {key: values.get(key) for key in ('rss_mb', 'rss_peak_mb', 'python_heap_mb', 'cpu_total_seconds')}
        item.update(name=name[:64], ts=utc_now(), elapsed_ms=round((self.clock() - self.started) * 1000, 2))
        with self.lock: self.startup.append(item)

    def request_started(self):
        token = {'started': self.clock(), 'rss_mb': self._rss()}
        with self.lock:
            self.inflight += 1
            self.peak_inflight = max(self.peak_inflight, self.inflight)
        return token

    def _rss(self):
        try: return self.read_rss()
        except Exception: return None

    @staticmethod
    def _increment(row, *, status, duration, work, size, delta):
        row['requests'] += 1
        category = f'status_{status // 100}xx'
        if category in row: row[category] += 1
        row['duration_ms'] += duration
        row['work_ms'] += work
        row['max_ms'] = max(row['max_ms'], duration)
        row['response_bytes'] += size
        row['largest_response_bytes'] = max(row['largest_response_bytes'], size)
        if delta is not None:
            row['rss_observations'] += 1
            row['observed_rss_max_rise_mb'] = max(row['observed_rss_max_rise_mb'] or 0, delta, 0)

    def _group(self, collection, key, limit, overflow, fallback):
        if key not in collection:
            if len(collection) >= max(0, limit - 1):
                key = fallback
                self.overflow[overflow] += 1
            if key not in collection: collection[key] = _base()
        return collection[key]

    def request_finished(self, token, *, method, endpoint, business_slug, status, response_bytes, response_finished=None):
        ended, after = self.clock(), self._rss()
        work = max(0, (ended - token['started']) * 1000)
        duration = max(0, ((response_finished if response_finished is not None else ended) - token['started']) * 1000)
        before = token['rss_mb']
        delta = round(after - before, 2) if after is not None and before is not None else None
        # Only route templates supplied by the router, never raw paths/queries.
        endpoint = endpoint if isinstance(endpoint, str) and len(endpoint) <= 256 else '<other>'
        method = method if method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS') else 'OTHER'
        args = dict(status=status, duration=duration, work=work, size=max(0, response_bytes), delta=delta)
        with self.lock:
            self.inflight = max(0, self.inflight - 1)
            self._increment(self.summary, **args)
            self._increment(self._group(self.endpoints, (method, endpoint), self.endpoint_limit,
                                        'endpoint_groups', ('OTHER', '<other>')), **args)
            # `public_id` also names customers in other routes. Restrict business
            # attribution to actual business routes or explicit validated slugs.
            if endpoint.startswith('/api/v1/business/') and business_slug and SLUG.fullmatch(str(business_slug)):
                self._increment(self._group(self.businesses, str(business_slug), self.business_limit,
                                            'business_groups', '<other>'), **args)

    @staticmethod
    def _row(row, *, rss=True):
        result = {key: value for key, value in row.items() if key not in ('duration_ms', 'work_ms')}
        n = row['requests']
        result.update(avg_ms=round(row['duration_ms'] / n, 2) if n else 0,
                      avg_work_ms=round(row['work_ms'] / n, 2) if n else 0)
        result['max_ms'] = round(result['max_ms'], 2)
        if not rss:
            result.pop('observed_rss_max_rise_mb', None)
            result.pop('rss_observations', None)
        return result

    def record_wallet(self, operation, business_slug, *, duration_ms, wait_ms, outcome, before, after):
        operation = operation if re.fullmatch(r'[a-z0-9_]{1,64}', operation) else '<other>'
        business_slug = business_slug if business_slug and SLUG.fullmatch(str(business_slug)) else None
        work = max(0, duration_ms - wait_ms)
        delta = round(after - before, 2) if before is not None and after is not None else None
        with self.lock:
            if operation not in self.wallet_jobs and len(self.wallet_jobs) >= 31:
                operation = '<other>'; self.overflow['wallet_groups'] += 1
            row = self.wallet_jobs.setdefault(operation, dict(calls=0, failed=0, duration_ms=0, max_ms=0,
                                                              wait_ms=0, max_wait_ms=0, observed_rss_max_rise_mb=None))
            row['calls'] += 1; row['failed'] += int(outcome == 'failed')
            row['duration_ms'] += work; row['max_ms'] = max(row['max_ms'], work)
            row['wait_ms'] += wait_ms; row['max_wait_ms'] = max(row['max_wait_ms'], wait_ms)
            if delta is not None: row['observed_rss_max_rise_mb'] = max(row['observed_rss_max_rise_mb'] or 0, delta, 0)
            self.recent_wallet.append(dict(ts=utc_now(), operation=operation, business_slug=business_slug,
                duration_ms=round(work, 2), wait_ms=round(wait_ms, 2), outcome=outcome,
                rss_before_mb=before, rss_after_mb=after, observed_rss_change_mb=delta))

    def _current(self, values, now):
        result = dict(values)
        cpu = values.get('cpu_total_seconds')
        result['cpu_percent'] = None
        if self.last_cpu and cpu is not None:
            previous_time, previous_cpu = self.last_cpu
            if now - previous_time >= .1:
                result['cpu_percent'] = round(max(0, (cpu - previous_cpu) / (now - previous_time) * 100), 2)
        return result

    def sample(self):
        now, values = self.clock(), self._memory()
        with self.lock:
            current = self._current(values, now)
            if values.get('cpu_total_seconds') is not None: self.last_cpu = (now, values['cpu_total_seconds'])
            item = {key: current.get(key) for key in ('rss_mb', 'rss_peak_mb', 'container_memory_mb', 'container_limit_mb',
                        'cpu_percent', 'threads', 'python_heap_mb', 'trace_overhead_mb')}
            item.update(ts=utc_now(), inflight=self.inflight)
            self.samples.append(item)
        return current

    def _cache_rows(self):
        try:
            return [dict(name=str(name)[:64], **{key: int(value.get(key) or 0) for key in ('items', 'bytes', 'max_bytes')})
                    for name, value in list(self.cache_provider().items())[:32]]
        except Exception: return []

    def report(self):
        now, values = self.clock(), self._memory()
        caches = self._cache_rows()
        try: maps = [dict(name=str(k)[:64], items=int(v)) for k, v in list(self.maps_provider().items())[:32]]
        except Exception: maps = []
        with self.lock:
            wallet_rows = []
            for name, row in self.wallet_jobs.items():
                item = {k: v for k, v in row.items() if k not in ('duration_ms', 'wait_ms')}
                item.update(operation=name, avg_ms=round(row['duration_ms'] / row['calls'], 2),
                            avg_wait_ms=round(row['wait_ms'] / row['calls'], 2))
                wallet_rows.append(item)
            trace = {**self.trace, 'enabled': tracemalloc.is_tracing(), 'overhead_mb': values.get('trace_overhead_mb')}
            return dict(generated_at=utc_now(),
                process=dict(pid=os.getpid(), started_at=self.started_at, uptime_seconds=round(now - self.started, 1),
                             scope='current_process', sample_interval_seconds=INTERVAL,
                             current={**values, 'cpu_percent': self.samples[-1]['cpu_percent'] if self.samples else None}),
                summary={**self._row(self.summary), 'inflight': self.inflight, 'peak_inflight': self.peak_inflight},
                samples=list(self.samples), startup=list(self.startup),
                endpoints=[dict(method=key[0], endpoint=key[1], **self._row(row)) for key, row in sorted(self.endpoints.items(), key=lambda pair: pair[1]['requests'], reverse=True)],
                businesses=[dict(business_slug=key, **self._row(row, rss=False)) for key, row in sorted(self.businesses.items(), key=lambda pair: pair[1]['requests'], reverse=True)],
                wallet_jobs=sorted(wallet_rows, key=lambda row: row['max_ms'], reverse=True), recent_wallet_jobs=list(reversed(self.recent_wallet)),
                caches=caches, retained_maps=maps, trace=trace,
                limits=dict(endpoint_groups=self.endpoint_limit, business_groups=self.business_limit,
                            wallet_groups=32, memory_samples=SAMPLE_LIMIT, recent_wallet_jobs=40, overflow=dict(self.overflow)),
                notes=['This report covers one worker PID since backend import started and resets on restart. Other workers are not combined.',
                       'The first checkpoint is main module entry, after Python has compiled this module. It is not a pristine interpreter baseline.',
                       'RSS changes are process-wide observations during concurrent work, not memory allocated by a business or endpoint. Do not add them together.',
                       'Response duration ends at the final body chunk. Work duration also includes server background tasks. Wallet work excludes render-lock waiting.',
                       'CPU uses one core = 100% and may exceed 100%. Python tracing excludes native Pillow and SSL allocations.',
                       'CPU is averaged between periodic samples. Current RSS is read when the report is requested.',
                       'Container usage includes more than process RSS. Missing measurements are unavailable, not zero. Diagnostics have bounded in-memory history and no database reads.'])

    @staticmethod
    def _headroom(values):
        used, limit = values.get('container_memory_mb'), values.get('container_limit_mb')
        # Reject a potentially expensive snapshot close to an enforced limit.
        return used is None or limit is None or (limit > 0 and limit - used >= max(160, limit * .3))

    async def start_capture(self, seconds):
        from fastapi import HTTPException
        values = self._memory()
        with self.lock:
            if self.trace['running']: raise HTTPException(409, 'A Python profile is already running.')
            if not self._headroom(values): raise HTTPException(409, 'Not enough memory headroom for allocation profiling. Use the lightweight usage measurements first.')
            already = tracemalloc.is_tracing()
            if not already: tracemalloc.start(1)
            source = self.trace['source'] if already and self.trace['source'] != 'off' else 'manual'
            self.trace.update(enabled=True, source=source, running=True,
                              started_at=self.trace['started_at'] if already else utc_now(),
                              deadline=(datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat())
            self.trace_stop_after = not already
            self.trace_task = asyncio.create_task(self._capture_later(seconds, stop_after=not already))
        return {'status': 'started', 'seconds': seconds}

    @staticmethod
    def _allocation_rows():
        snapshot = tracemalloc.take_snapshot()
        backend = Path(__file__).resolve().parent
        rows = []
        for stat in snapshot.statistics('lineno'):
            frame = stat.traceback[0]
            path = Path(frame.filename)
            try: name = 'backend/' + path.relative_to(backend).as_posix()
            except ValueError:
                parts = path.parts
                if 'site-packages' in parts:
                    name = 'site-packages/' + '/'.join(parts[parts.index('site-packages') + 1:])
                elif path.name.endswith('.py') and (path.is_relative_to(sys.base_prefix) or path.is_relative_to(sys.prefix)):
                    name = 'stdlib/' + path.name
                else: continue
            if not re.fullmatch(r'[A-Za-z0-9_./-]{1,200}', name): continue
            rows.append(dict(file=name[:200], line=frame.lineno, bytes=stat.size, count=stat.count))
            if len(rows) == 20: break
        return rows

    async def _capture_later(self, seconds, *, stop_after):
        error, rows = None, []
        snapshot_task = None
        try:
            await asyncio.sleep(seconds)
            if not self._headroom(self._memory()): error = 'Snapshot skipped because container memory is high.'
            else:
                snapshot_task = asyncio.create_task(asyncio.to_thread(self._allocation_rows))
                rows = await asyncio.shield(snapshot_task)
        except asyncio.CancelledError:
            error = 'Capture cancelled during shutdown.'
            # Cancelling to_thread does not stop its worker. Drain it before
            # stopping global tracing or accepting another capture.
            if snapshot_task is not None:
                await asyncio.gather(snapshot_task, return_exceptions=True)
            raise
        except Exception:
            error = 'Python allocation capture was unavailable.'
        finally:
            if stop_after and tracemalloc.is_tracing(): tracemalloc.stop()
            with self.lock:
                self.trace.update(enabled=tracemalloc.is_tracing(), running=False, deadline=None,
                    last_capture=dict(finished_at=utc_now(), duration_seconds=seconds,
                        scope='Retained Python allocations since tracing started; not per-business usage and excludes native allocations.',
                        top_allocations=rows, error=error))

    async def run(self, emit):
        if self.environment_deadline is not None and self.trace_task is None and tracemalloc.is_tracing():
            remaining = max(0, self.environment_deadline - self.clock())
            self.trace.update(running=True, deadline=(datetime.now(timezone.utc) + timedelta(seconds=remaining)).isoformat())
            self.trace_stop_after = True
            self.trace_task = asyncio.create_task(self._capture_later(remaining, stop_after=True))
        while True:
            try:
                current = self.sample()
                used, limit = current.get('container_memory_mb'), current.get('container_limit_mb')
                if used is not None and limit and used / limit >= .8 and tracemalloc.is_tracing():
                    await self.stop()
                    if tracemalloc.is_tracing(): tracemalloc.stop()
                    self.trace.update(enabled=False, running=False, deadline=None,
                        last_capture=dict(finished_at=utc_now(), duration_seconds=0,
                            scope='No allocation snapshot was collected.', top_allocations=[],
                            error='Tracing stopped automatically because container memory is high.'))
                emit('runtime_memory', caches=self.cache_provider(), worker_env=os.getenv('WEB_CONCURRENCY'), **current)
            except Exception: pass
            await asyncio.sleep(INTERVAL)

    async def stop(self):
        if self.trace_task and not self.trace_task.done():
            if not self.trace_task.cancelling(): self.trace_task.cancel()
            await asyncio.gather(asyncio.shield(self.trace_task), return_exceptions=True)
        # A task cancelled before its coroutine first runs never enters finally.
        if self.trace['running'] and (self.trace_task is None or self.trace_task.done()):
            if self.trace_stop_after and tracemalloc.is_tracing(): tracemalloc.stop()
            self.trace.update(enabled=tracemalloc.is_tracing(), running=False, deadline=None,
                last_capture=dict(finished_at=utc_now(), duration_seconds=0,
                    scope='No allocation snapshot was collected.', top_allocations=[], error='Capture cancelled during shutdown.'))


profiler = SystemProfiler()


def register_profiling_routes(app, *, require_admin, service=profiler):
    from fastapi import Depends, HTTPException, Query, Response

    @app.get('/api/v1/admin/system-usage')
    def system_usage(response: Response, _: bool = Depends(require_admin)):
        response.headers['Cache-Control'] = 'private, no-store'
        return service.report()

    @app.post('/api/v1/admin/system-usage/profile', status_code=202)
    async def profile_python(response: Response, seconds: int = Query(30, ge=10, le=60), _: bool = Depends(require_admin)):
        response.headers['Cache-Control'] = 'private, no-store'
        try: return await service.start_capture(seconds)
        except HTTPException as exc:
            exc.headers = {**(exc.headers or {}), 'Cache-Control': 'private, no-store'}
            raise
