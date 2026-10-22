"""Bound Wallet memory, including native Pillow buffers missed by tracemalloc."""
from collections import OrderedDict
from collections.abc import MutableMapping
from contextlib import contextmanager
from functools import wraps
from io import BytesIO
import sys
from threading import RLock
import time

from PIL import Image
try:
    from .runtime_metrics import memory_usage
    from .runtime_profiling import profiler
except ImportError:
    from runtime_metrics import memory_usage
    from runtime_profiling import profiler

MIB = 1024 * 1024
MAX_IMAGE_BYTES = 5 * MIB
MAX_IMAGE_PIXELS = 12_000_000
WALLET_IMAGE_SIZE = (1200, 1200)
# RLock allows a pass renderer to call another decorated image helper.
RENDER_LOCK = RLock()
_CACHES = {}


def payload_size(value):
    if isinstance(value, (bytes, bytearray, str)):
        return sys.getsizeof(value)
    if isinstance(value, dict):
        return sys.getsizeof(value) + sum(payload_size(k) + payload_size(v) for k, v in value.items())
    if isinstance(value, (tuple, list)):
        return sys.getsizeof(value) + sum(payload_size(v) for v in value)
    return sys.getsizeof(value)


class BoundedTTLCache(MutableMapping):
    """Hard byte/item limits and global expiry, including never-read-again keys."""
    def __init__(self, name, *, max_bytes, max_items, ttl, clock=time.monotonic):
        self.max_bytes, self.max_items, self.ttl, self.clock = max_bytes, max_items, ttl, clock
        self._items, self._bytes, self._lock = OrderedDict(), 0, RLock()
        _CACHES[name] = self

    def _prune(self):
        now = self.clock()
        for key, (expires, _, size) in list(self._items.items()):
            if expires <= now:
                self._items.pop(key)
                self._bytes -= size

    def __getitem__(self, key):
        with self._lock:
            self._prune()
            _, value, _ = self._items[key]
            self._items.move_to_end(key)
            return value

    def __setitem__(self, key, value):
        size = payload_size(key) + payload_size(value)
        with self._lock:
            self._prune()
            previous = self._items.pop(key, None)
            if previous:
                self._bytes -= previous[2]
            if size > self.max_bytes:
                return  # Cache miss is safe; the freshly built response still returns.
            while self._items and (self._bytes + size > self.max_bytes or len(self._items) >= self.max_items):
                _, (_, _, removed) = self._items.popitem(last=False)
                self._bytes -= removed
            self._items[key] = (self.clock() + self.ttl, value, size)
            self._bytes += size

    def __delitem__(self, key):
        with self._lock:
            self._bytes -= self._items.pop(key)[2]

    def __iter__(self):
        with self._lock:
            self._prune()
            return iter(tuple(self._items))

    def __len__(self):
        with self._lock:
            self._prune()
            return len(self._items)

    def stats(self):
        with self._lock:
            self._prune()
            return {'items': len(self._items), 'bytes': self._bytes, 'max_bytes': self.max_bytes}


def cache_stats():
    return {name: cache.stats() for name, cache in _CACHES.items()}


def decode_wallet_image(content, size=WALLET_IMAGE_SIZE):
    """Decode at Wallet resolution; do not retain an owner's original bitmap.

    JPEG draft downsamples before allocating its full raster. PNG is bounded
    by the pixel limit, then resized before the extra RGBA allocation.
    """
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise ValueError('Wallet image exceeds the download limit')
    with RENDER_LOCK, BytesIO(content) as stream, Image.open(stream) as source:
        source.draft('RGB', size)
        if source.width * source.height > MAX_IMAGE_PIXELS:
            raise ValueError('Wallet image exceeds the pixel limit')
        source.thumbnail(size, Image.Resampling.LANCZOS)
        return source.convert('RGBA')


def _emit(**fields):
    try:
        try:
            from monitoring import log_event, request_context
        except ImportError:
            from .monitoring import log_event, request_context
        scope = request_context.get() or {}
        request_id = scope.get('state', {}).get('request_id')
        log_event('wallet_memory', request_id=request_id, **fields)
    except Exception:
        pass  # Diagnostics must never fail a pass, push, or response.


@contextmanager
def memory_span(operation, business_slug=None):
    started = time.monotonic()
    try: before = memory_usage()
    except Exception: before = {}
    span = {'wait_ms': 0}
    _emit(operation=operation, stage='before', business_slug=business_slug, **before)
    outcome = 'ok'
    try:
        yield span
    except BaseException:
        outcome = 'failed'
        raise
    finally:
        try: after = memory_usage()
        except Exception: after = {}
        try: caches = cache_stats()
        except Exception: caches = {}
        duration = (time.monotonic() - started) * 1000
        _emit(operation=operation, stage='after', business_slug=business_slug, outcome=outcome,
              duration_ms=round(duration, 2), wait_ms=round(span['wait_ms'], 2),
              work_ms=round(max(0, duration - span['wait_ms']), 2), caches=caches, **after)
        try:
            profiler.record_wallet(operation, business_slug, duration_ms=duration, wait_ms=span['wait_ms'],
                outcome=outcome, before=before.get('rss_mb'), after=after.get('rss_mb'))
        except Exception: pass


def wallet_work(operation, *, business_arg=None, serialize=True):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            business = kwargs.get('business') or (args[business_arg] if business_arg is not None and len(args) > business_arg else {})
            with memory_span(operation, business.get('public_id') if isinstance(business, dict) else None) as span:
                if serialize:
                    waiting = time.monotonic()
                    with RENDER_LOCK:
                        span['wait_ms'] = (time.monotonic() - waiting) * 1000
                        if operation.startswith('apple_') and operation.endswith('pass_build'):
                            try: from .apple_memory import memory_pressure
                            except ImportError: from apple_memory import memory_pressure
                            if memory_pressure.paused():
                                from fastapi import HTTPException
                                raise HTTPException(503, 'Apple Wallet is temporarily busy.', headers={'Retry-After': '30'})
                        return fn(*args, **kwargs)
                return fn(*args, **kwargs)
        return wrapped
    return decorate


async def memory_sampler(emit):
    # Lifecycle stays with the existing app task; tracing bootstraps before imports.
    await profiler.run(emit)
