"""One pooled AsyncClient; sync compatibility for the existing Supabase SDK.

The client lives on a dedicated I/O loop so existing sync SDK calls (including
legacy async routes) cannot deadlock the ASGI loop. No writes are retried.
"""
import asyncio
import threading
import httpx

READ_FAILURES = (httpx.ReadError, httpx.ConnectError, httpx.TimeoutException)


class ResponseTooLarge(httpx.RequestError):
    """A bounded artwork download is rejected without retrying its body."""


class SharedHTTP:
    def __init__(self):
        self.loop = None
        self.thread = None
        self.client = None

    async def start(self, apple_cert=None):
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self.thread.start()
        async def create():
            mounts = {}
            if apple_cert and apple_cert[0]:
                import ssl
                context = ssl.create_default_context()
                context.load_cert_chain(*apple_cert)
                mounts['https://api.push.apple.com'] = httpx.AsyncHTTPTransport(
                    verify=context, http2=True,
                    limits=httpx.Limits(max_connections=5, max_keepalive_connections=3))
            self.client = httpx.AsyncClient(
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                timeout=httpx.Timeout(30, connect=10, pool=10), mounts=mounts)
        await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(create(), self.loop))

    async def stop(self):
        if self.client:
            await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(self.client.aclose(), self.loop))
        if self.loop:
            self.loop.call_soon_threadsafe(self.loop.stop)
            await asyncio.to_thread(self.thread.join)
            self.loop.close()
        self.client = self.loop = self.thread = None

    async def _send(self, request):
        for attempt in range(2):
            try:
                response = await self.client.send(request, stream=True)
                try:
                    maximum = request.extensions.get('lt_max_response_bytes')
                    if maximum:
                        data = bytearray()
                        async for chunk in response.aiter_bytes():
                            if len(data) + len(chunk) > maximum:
                                raise ResponseTooLarge('Wallet image download exceeded its size limit', request=request)
                            data.extend(chunk)
                        content = bytes(data)
                    else:
                        content = await response.aread()
                finally:
                    await response.aclose()
                # AsyncClient has already decoded gzip/deflate/br by aread().
                # Do not forward wire-encoding headers with decoded bytes: the
                # sync SDK would try to decompress the JSON a second time.
                headers = [(name, value) for name, value in response.headers.raw
                           if name.lower() not in (b'content-encoding', b'content-length', b'transfer-encoding')]
                return httpx.Response(response.status_code, headers=headers,
                                      content=content, request=request,
                                      extensions=response.extensions)
            except READ_FAILURES:
                if attempt or request.method not in ('GET', 'HEAD', 'OPTIONS'):
                    raise
                await asyncio.sleep(0.2)

    def send(self, request):
        if not self.client or not self.loop:
            raise httpx.ConnectError('Shared HTTP client is not started', request=request)
        return asyncio.run_coroutine_threadsafe(self._send(request), self.loop).result()

    async def request(self, method, url, **kwargs):
        return await asyncio.to_thread(lambda: pooled_client().request(method, url, **kwargs))


shared_http = SharedHTTP()


class BridgeTransport(httpx.BaseTransport):
    def handle_request(self, request):
        request.read()
        # Convert the sync body stream before handing it to AsyncClient.
        async_request = httpx.Request(request.method, request.url, headers=request.headers,
                                      content=request.content, extensions=request.extensions)
        try:
            return shared_http.send(async_request)
        except READ_FAILURES as exc:
            from monitoring import request_context
            scope = request_context.get()
            if scope is not None and request.method == 'GET':
                scope.setdefault('state', {})['upstream_read_failure'] = {'type': type(exc).__name__, 'error': str(exc)}
            raise

    def close(self):
        pass  # Lifecycle belongs to app startup/shutdown, not per-call contexts.


# One no-socket sync facade owns redirect/cookie handling. Scoped adapters
# below change per-operation options without constructing clients per request.
_sync_facade = httpx.Client(transport=BridgeTransport(), timeout=httpx.Timeout(30, connect=10, pool=10))


class ScopedClient:
    def __init__(self, **kwargs):
        self.timeout = kwargs.get('timeout', httpx.Timeout(30, connect=10, pool=10))
        self.follow_redirects = kwargs.get('follow_redirects', False)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def request(self, method, url, **kwargs):
        kwargs.setdefault('timeout', self.timeout)
        kwargs.setdefault('follow_redirects', self.follow_redirects)
        return _sync_facade.request(method, url, **kwargs)

    def get(self, url, **kwargs):
        return self.request('GET', url, **kwargs)

    def post(self, url, **kwargs):
        return self.request('POST', url, **kwargs)

    def put(self, url, **kwargs):
        return self.request('PUT', url, **kwargs)

    def patch(self, url, **kwargs):
        return self.request('PATCH', url, **kwargs)

    def delete(self, url, **kwargs):
        return self.request('DELETE', url, **kwargs)


def pooled_client(**kwargs):
    return ScopedClient(**kwargs)


def _sdk_facade(**kwargs):
    # SDK sessions are created once per module (Motolite's factory is cached).
    return httpx.Client(transport=BridgeTransport(), **kwargs)


def _create_supabase_client(url, key):
    """Support both older and newer Supabase SDK transport injection APIs."""
    import inspect
    from supabase import create_client, ClientOptions
    timeout = httpx.Timeout(30, connect=10, pool=10)
    if 'httpx_client' in inspect.signature(ClientOptions).parameters:
        return create_client(url, key, options=ClientOptions(httpx_client=_sdk_facade(timeout=timeout), postgrest_client_timeout=timeout))
    db = create_client(url, key, options=ClientOptions(postgrest_client_timeout=timeout))
    postgrest = db.postgrest
    original = postgrest.session
    postgrest.session = _sdk_facade(base_url=str(original.base_url), headers=dict(original.headers),
                                     timeout=timeout, follow_redirects=True)
    original.close()
    return db


class LazySupabase:
    def __init__(self, url, key):
        self._url, self._key = url, key
        self._client, self._lock = None, threading.RLock()

    def __getattr__(self, name):
        with self._lock:
            if self._client is None:
                self._client = _create_supabase_client(self._url, self._key)
                self._key = None
            client = self._client
        return getattr(client, name)


def create_pooled_supabase(url, key):
    return LazySupabase(url, key)
