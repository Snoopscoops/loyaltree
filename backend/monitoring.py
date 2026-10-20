"""Privacy-filtered JSON events, bounded persistence and monitoring API."""
import asyncio
import contextvars
import hmac
import json
import os
import re
import threading
import traceback
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from fastapi import Header, HTTPException, Query
from fastapi.responses import JSONResponse
from starlette.routing import Match
from shared_http import shared_http
from runtime_profiling import profiler

request_context = contextvars.ContextVar('monitor_request', default=None)
PERSISTED = {'error', 'push', 'wallet_sync', 'hourly_summary'}
SENSITIVE = re.compile(r'email|phone|token|secret|password|authorization|cookie', re.I)


def sanitize(value, key=''):
    if SENSITIVE.search(key):
        return '[redacted]'
    if isinstance(value, dict):
        return {k: sanitize(v, k) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize(v) for v in value]
    if isinstance(value, str):
        # Never print URLs/query strings, credentials or personal contacts found
        # in exception messages, announcement copy or upstream response bodies.
        value = re.sub(r'https?://\S+', '[url]', value)
        value = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', '[email]', value)
        value = re.sub(r'(?i)(bearer\s+)[\w.\-]+', r'\1[redacted]', value)
        value = re.sub(r'\beyJ[A-Za-z0-9_\-.]+|\bsb_(?:secret|publishable)_\S+', '[redacted]', value)
        value = re.sub(r'(?i)((?:token|secret|password|api[_-]?key|authorization)\s*[=:]\s*)[^\s,;]+', r'\1[redacted]', value)
        value = re.sub(r'(?<![\w])\+?\d[\d ()-]{7,}\d(?![\w])',
                       lambda match: match.group() if re.fullmatch(r'\d{4}-\d{2}-\d{2}', match.group()) else '[phone]', value)
        for name, secret in os.environ.items():
            if SENSITIVE.search(name) and len(secret) >= 8:
                value = value.replace(secret, '[redacted]')
        return value
    return value


class Monitor:
    def __init__(self):
        self.lock = threading.Lock()
        self.output_lock = threading.Lock()
        self.reset()
        self.queue = None
        self.loop = None
        self.tasks = []
        self.pending = 0

    def reset(self):
        self.counts = Counter()
        self.endpoints = Counter()
        self.businesses = Counter()
        self.errors = Counter()
        self.window_start = datetime.now(timezone.utc).isoformat()

    def emit(self, event, level='info', **fields):
        item = sanitize(dict(event=event, ts=datetime.now(timezone.utc).isoformat(), level=level, **fields))
        with self.output_lock:
            print(json.dumps(item, default=str, separators=(',', ':')), flush=True)
        if event in ('push', 'wallet_sync'):
            with self.lock:
                self.counts['pushes'] += 1
                self.counts['apple_pushes'] += int(fields.get('apple_ok') or 0)
                self.counts['google_pushes'] += int(fields.get('google_ok') or 0)
        if event in PERSISTED and self.loop and self.queue:
            # Reserve capacity before scheduling from worker threads. Both the
            # queue and the loop's callbacks stay bounded during DB outages.
            with self.lock:
                if self.pending >= 1000:
                    return
                self.pending += 1
            def enqueue():
                self.queue.put_nowait(item)
            self.loop.call_soon_threadsafe(enqueue)
        return item

    def record_request(self, endpoint, business, status):
        with self.lock:
            self.counts['requests'] += 1
            self.counts[f'status_{status // 100}xx'] += 1
            self.endpoints[endpoint] += 1
            if business:
                self.businesses[business] += 1

    def summary(self):
        with self.lock:
            item = {k: self.counts[k] for k in ('requests', 'status_2xx', 'status_4xx', 'status_5xx', 'pushes', 'apple_pushes', 'google_pushes')}
            item.update(window_start=self.window_start,
                        endpoint_counts=dict(self.endpoints), business_counts=dict(self.businesses),
                        top_endpoints=self.endpoints.most_common(5), top_businesses=self.businesses.most_common(5),
                        errors=[dict(endpoint=e, error_type=t, count=n) for (e, t), n in self.errors.items()])
            self.reset()
        return self.emit('hourly_summary', **item)

    async def start(self):
        self.loop = asyncio.get_running_loop()
        self.queue = asyncio.Queue(maxsize=1000)
        self.tasks = [asyncio.create_task(self.writer()), asyncio.create_task(self.hourly())]

    async def stop(self):
        self.summary()
        try:
            await asyncio.wait_for(self.queue.join(), timeout=5)
        except asyncio.TimeoutError:
            pass
        self.loop = None
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)

    async def hourly(self):
        while True:
            await asyncio.sleep(3600)
            self.summary()

    async def writer(self):
        while True:
            item = await self.queue.get()
            try:
                url, key = db_config()
                row = {k: item.get(k) for k in ('ts', 'event', 'level', 'business_slug', 'endpoint', 'status')}
                row['payload'] = item
                response = await shared_http.request('POST', f'{url}/rest/v1/system_events',
                    headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Prefer': 'return=minimal'}, json=row)
                response.raise_for_status()
            except Exception as exc:
                self.emit('event_persist_failed', 'warning', error_type=type(exc).__name__)
            finally:
                with self.lock:
                    self.pending -= 1
                self.queue.task_done()


monitor = Monitor()
log_event = monitor.emit


def db_config():
    return os.getenv('SUPABASE_URL', '').rstrip('/'), (os.getenv('SUPABASE_SECRET_KEY') or os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('SUPABASE_KEY', ''))


def route_context(app, scope):
    route = scope.get('route')
    params = scope.get('path_params', {})
    if route is None:
        for candidate in app.router.routes:
            match, child = candidate.matches(scope)
            if match == Match.FULL:
                route, params = candidate, child.get('path_params', {})
                break
    return getattr(route, 'path', '<unmatched>'), params.get('slug') or params.get('public_id') or params.get('business_slug')


def log_error(app, scope, status, exc=None):
    state = scope.setdefault('state', {})
    endpoint, business = route_context(app, scope)
    chain, seen = [], set()
    def visit(error):
        if error is None or id(error) in seen:
            return
        seen.add(id(error))
        chain.append(error)
        visit(error.__cause__ or error.__context__)
        for child in getattr(error, 'exceptions', ()):
            visit(child)
    visit(exc)
    # AnyIO/BaseHTTPMiddleware can attach cyclic ExceptionGroup context to
    # an already-unwrapped error. Report the concrete underlying failure.
    from shared_http import READ_FAILURES
    concrete = [error for error in chain if not getattr(error, 'exceptions', None)
                and not hasattr(error, 'status_code')]
    cause = next((error for error in reversed(concrete) if isinstance(error, READ_FAILURES)),
                 concrete[-1] if concrete else exc)
    kind = type(cause).__name__ if cause else 'HTTP5xx'
    rid = state.get('request_id', uuid.uuid4().hex)
    if not state.get('monitor_error_logged'):
        state['monitor_error_logged'] = True
        log_event('error', 'error', status=max(500, status), method=scope['method'], endpoint=endpoint,
                  business_slug=business, error_type=kind,
                  error=str(cause) if cause else 'Server error response', request_id=rid)
        with monitor.lock:
            monitor.errors[(endpoint, kind)] += 1
    if exc and not state.get('monitor_trace_logged'):
        state['monitor_trace_logged'] = True
        # Retain every frame of each chained exception; omit locals and source
        # literals because either may contain credentials or customer records.
        parts = []
        for error in reversed(chain):
            frames = traceback.extract_tb(error.__traceback__)
            parts.append(type(error).__name__ + ': ' + str(error))
            parts.extend(f'{f.filename}:{f.lineno} in {f.name}' for f in frames)
        log_event('error_traceback', 'error', request_id=rid, traceback='\n'.join(parts), error_type=kind)


class MonitoringMiddleware:
    def __init__(self, app, root):
        self.app, self.root = app, root

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        state = scope.setdefault('state', {})
        state['request_id'] = uuid.uuid4().hex
        token = request_context.set(scope)
        try: usage = profiler.request_started()
        except Exception: usage = None
        response_bytes, response_finished = 0, None
        status, started = 500, False
        async def capture(message):
            nonlocal status, started, response_bytes, response_finished
            if message['type'] == 'http.response.start':
                status, started = message['status'], True
                message.setdefault('headers', []).append((b'x-request-id', state['request_id'].encode()))
                if status >= 500:
                    log_error(self.root, scope, status)
            elif message['type'] == 'http.response.body':
                response_bytes += len(message.get('body', b''))
                if not message.get('more_body', False): response_finished = profiler.clock()
            await send(message)
        try:
            await self.app(scope, receive, capture)
        except Exception as exc:
            log_error(self.root, scope, status if started else 500, exc)
            if not started:
                await JSONResponse({'detail': 'Internal server error'}, status_code=500)(scope, receive, capture)
            else:
                raise
        finally:
            endpoint, business = route_context(self.root, scope)
            monitor.record_request(endpoint, business, status)
            if usage is not None:
                try:
                    profiler.request_finished(usage, method=scope['method'], endpoint=endpoint,
                        business_slug=business, status=status, response_bytes=response_bytes,
                        response_finished=response_finished)
                except Exception: pass
            request_context.reset(token)


async def health_report(hours: int = Query(24, ge=1, le=168), authorization: str = Header(default='')):
    secret = os.getenv('MONITOR_TOKEN', '')
    if not secret or not hmac.compare_digest(authorization, f'Bearer {secret}'):
        raise HTTPException(401, 'Invalid monitoring token')
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    url, key = db_config()
    rows, offset = [], 0
    try:
        while True:
            response = await shared_http.request('GET', f'{url}/rest/v1/system_events',
                headers={'apikey': key, 'Authorization': f'Bearer {key}'},
                params={'select': '*', 'ts': f'gte.{since}', 'order': 'ts.asc,id.asc', 'offset': offset, 'limit': 1000})
            response.raise_for_status()
            batch = response.json()
            rows.extend(batch)
            if not batch:
                break
            offset += len(batch)
    except Exception as exc:
        log_event('health_report_failed', 'warning', error_type=type(exc).__name__)
        raise HTTPException(503, 'Monitoring storage unavailable') from exc
    totals, endpoints, businesses = Counter(), Counter(), Counter()
    errors, pushes = [], []
    for row in rows:
        p = row.get('payload') or {}
        if row['event'] == 'hourly_summary':
            for k in ('requests', 'status_2xx', 'status_4xx', 'status_5xx'):
                totals[k] += int(p.get(k) or 0)
            endpoints.update(p.get('endpoint_counts') or {})
            businesses.update(p.get('business_counts') or {})
        elif row['event'] == 'error':
            errors.append(dict(time=row['ts'], endpoint=row.get('endpoint'), business=row.get('business_slug'),
                               error=p.get('error'), error_type=p.get('error_type'), status=row.get('status')))
        elif row['event'] in ('push', 'wallet_sync'):
            pushes.append(dict(time=row['ts'], **{k: p.get(k) for k in ('event', 'kind', 'business_slug', 'business_name', 'announcement_id', 'title', 'message', 'notification_header', 'targets', 'google_ok', 'google_failed', 'apple_ok', 'apple_failed', 'sent')}))
    # The current, unsummarized process window is included only if entirely
    # inside the requested period; summaries describe explicit windows.
    with monitor.lock:
        if monitor.window_start >= since:
            for k in ('requests', 'status_2xx', 'status_4xx', 'status_5xx'):
                totals[k] += monitor.counts[k]
            endpoints.update(monitor.endpoints)
            businesses.update(monitor.businesses)
    return dict(hours=hours, totals={k: totals[k] for k in ('requests', 'status_2xx', 'status_4xx', 'status_5xx')},
                errors=errors, pushes=pushes, top_businesses=businesses.most_common(5),
                top_endpoints=endpoints.most_common(5),
                totals_basis='Completed summary windows plus current process window; free-tier downtime is not observed.')


def install_monitoring(app):
    import logging
    logging.getLogger('uvicorn.access').disabled = True
    app.add_middleware(MonitoringMiddleware, root=app)
    @app.exception_handler(Exception)
    async def handler(request, exc):
        log_error(app, request.scope, 500, exc)
        return JSONResponse({'detail': 'Internal server error'}, status_code=500)
    from starlette.exceptions import HTTPException as StarletteHTTPException
    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request, exc):
        if exc.status_code >= 500:
            log_error(app, request.scope, exc.status_code, exc)
        return JSONResponse({'detail': exc.detail}, status_code=exc.status_code, headers=exc.headers)
    app.get('/api/v1/admin/health-report')(health_report)

_apple_delivery = contextvars.ContextVar('apple_delivery', default=None)


def begin_apple_delivery():
    _apple_delivery.set({'attempted': 0, 'ok': 0})


def _record_apple_delivery(attempted, ok):
    counts = _apple_delivery.get()
    if counts is not None:
        counts['attempted'] += attempted
        counts['ok'] += ok


def log_push(kind, business, ann, actor, result):
    apple = _apple_delivery.get() or {}
    log_event('push', kind=kind, announcement_id=ann.get('id'),
              business_slug=business.get('public_id'), business_name=business.get('name'),
              program_id=ann.get('program_public_id') or ann.get('program_id'),
              sent_by='staff' if actor == 'manager' else actor,
              title=ann.get('title'), message=ann.get('message'), notification_header=result.get('header'),
              targets=int(result.get('target_count') or 0),
              google_ok=int(result.get('google_sent') or 0), google_failed=int(result.get('google_failed') or 0),
              apple_ok=int(result.get('apple_sent') or 0),
              apple_failed=max(0, apple.get('attempted', 0) - apple.get('ok', 0)),
              sent=bool(result.get('sent')))


def log_wallet_sync(customer, business, reason, google, apple):
    google, apple = google or {}, apple or {}
    aok = int(apple.get('pushes_sent') or 0)
    gok = int(google.get('status') in ('updated', 'created', 'recreated', 'synced'))
    log_event('wallet_sync', business_slug=business.get('public_id'), business_name=business.get('name'),
              customer_id=customer.get('public_id'), reason=reason, targets=1,
              google_ok=gok, google_failed=int(google.get('status') == 'error'),
              apple_ok=aok, apple_failed=max(0, int(apple.get('registrations') or 0) - aok),
              google_status=google.get('status'), apple_status=apple.get('status'), sent=bool(aok or gok))


def resilient_read(kind):
    """Only transport read failures degrade; auth and genuine DB errors stay intact."""
    import functools
    import inspect
    from shared_http import READ_FAILURES
    def decorate(fn):
        def fallback(exc, kwargs, args):
            current = exc
            seen = set()
            while current and id(current) not in seen:
                seen.add(id(current))
                if isinstance(current, READ_FAILURES):
                    break
                current = current.__cause__ or current.__context__
            scope = request_context.get() or {}
            failure = scope.get('state', {}).get('upstream_read_failure')
            if not current and not failure:
                raise exc
            if isinstance(exc, HTTPException) and exc.status_code in (401, 403):
                raise exc
            slug = kwargs.get('public_id') or (args[0] if args else None)
            log_event('upstream_read_failed', 'warning', business_slug=slug,
                      endpoint=f'/api/v1/business/{{public_id}}/{kind}',
                      error_type=type(current).__name__ if current else failure['type'],
                      error=str(current) if current else failure['error'])
            if kind == 'stats':
                return dict(total_customers=None, customer_count_available=False,
                            total_stamps=0, unlocked_rewards=0,
                            total_customer_visits=None, return_rate=None, rewards_ready=None,
                            customer_segments=None, customer_activity={},
                            activity_available=False, rewards_available=False, partial=True)
            if kind == 'fraud-alerts':
                return dict(alerts=[], total=0, reviewed_transactions=0, window_hours=kwargs.get('hours', 24), partial=True)
            return dict(total_customers=0, repeat_customers=0, repeat_customer_rate=0,
                        active_30=0, active_60=0, active_90=0, retention_30_rate=0,
                        retention_60_rate=0, retention_90_rate=0, average_days_between_activity=None,
                        segments={k: 0 for k in ('new','active','frequent','at_risk','inactive_60','inactive_90')}, partial=True)
        def success(value, kwargs, args):
            scope = request_context.get() or {}
            failure = scope.get('state', {}).get('upstream_read_failure')
            if failure and isinstance(value, dict):
                slug = kwargs.get('public_id') or (args[0] if args else None)
                log_event('upstream_read_failed', 'warning', business_slug=slug,
                          endpoint=f'/api/v1/business/{{public_id}}/{kind}',
                          error_type=failure['type'], error=failure['error'])
                value = dict(value, partial=True)
            return value
        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def wrapped(*args, **kwargs):
                try:
                    return success(await fn(*args, **kwargs), kwargs, args)
                except Exception as exc:
                    return fallback(exc, kwargs, args)
        else:
            @functools.wraps(fn)
            def wrapped(*args, **kwargs):
                try:
                    return success(fn(*args, **kwargs), kwargs, args)
                except Exception as exc:
                    return fallback(exc, kwargs, args)
        return wrapped
    return decorate


def legacy_diagnostic(*args, **kwargs):
    """Retire unsafe free-form prints; opt-in Python DEBUG gives source only.

    Never serialize old arguments: many contain customer names, tokens or raw
    provider response bodies. New operational events carry allowlisted fields.
    """
    import logging
    if logging.getLogger('loyaltytree').isEnabledFor(logging.DEBUG):
        import sys
        frame = sys._getframe(1)
        log_event('legacy_diagnostic', 'debug', source=frame.f_code.co_name, line=frame.f_lineno)
