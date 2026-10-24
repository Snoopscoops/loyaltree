"""One bounded business burst aggregate with sampled worker/container peaks."""
import asyncio
from collections import OrderedDict
import math
from threading import Lock
import time

try:
    from .runtime_metrics import current_rss_mb, container_memory, container_headroom
except ImportError:
    from runtime_metrics import current_rss_mb, container_memory, container_headroom


class WalletBursts:
    def __init__(self, read=None, clock=time.monotonic, emit=None, *, read_container=None):
        self.read, self.clock, self.emit = read or current_rss_mb, clock, emit
        self.read_container = read_container or (container_memory if read is None else None)
        self.rows, self.lock = OrderedDict(), Lock()

    def record(self, business, kind=None):
        if not business: return
        try: rss = self.read()
        except Exception: rss = None
        evicted = None
        with self.lock:
            if business not in self.rows:
                if len(self.rows) >= 128: evicted = self.rows.popitem(last=False)
                self.rows[business] = dict(passes_built=0, cache_hits=0, failed=0,
                    peak_rss_mb=None, peak_container_memory_mb=None, min_container_headroom_mb=None,
                    container_limit_mb=None, last=self.clock())
            row = self.rows[business]
            self.rows.move_to_end(business)
            row['last'] = self.clock()
            if kind in ('passes_built','cache_hits','failed'): row[kind] += 1
            if rss is not None: row['peak_rss_mb'] = max(row['peak_rss_mb'] or rss, rss)
        if evicted: self._emit(*evicted)

    def _emit(self, business, row):
        try:
            emit = self.emit
            if emit is None:
                try: from .monitoring import log_event as emit
                except ImportError: from monitoring import log_event as emit
            emit('wallet_burst_summary', business_slug=business, **{k:v for k,v in row.items() if k != 'last'})
        except Exception: pass

    def sample(self, flush=False):
        with self.lock:
            if not self.rows: return
        try: rss = self.read()
        except Exception: rss = None
        # Container reads happen once per sample, never per card/request. This
        # is an observed peak shared across concurrent businesses, not memory
        # allocated to an individual business.
        try: container = self.read_container() if self.read_container else {}
        except Exception: container = {}
        if not isinstance(container, dict): container = {}
        headroom = container_headroom(container)
        used = container.get('container_memory_mb')
        valid_used = isinstance(used, (int, float)) and math.isfinite(used) and used >= 0
        done = []
        with self.lock:
            for business, row in list(self.rows.items()):
                if rss is not None: row['peak_rss_mb'] = max(row['peak_rss_mb'] or rss, rss)
                if valid_used:
                    row['peak_container_memory_mb'] = max(row['peak_container_memory_mb'] or used, used)
                if headroom is not None:
                    previous = row['min_container_headroom_mb']
                    row['min_container_headroom_mb'] = min(previous, headroom) if previous is not None else headroom
                    row['container_limit_mb'] = container['container_limit_mb']
                if flush or self.clock()-row['last'] >= 30:
                    done.append((business, self.rows.pop(business)))
        for business, row in done: self._emit(business, row)

    async def run(self):
        try:
            while True:
                self.sample()
                await asyncio.sleep(1)
        finally:
            self.sample(flush=True)


wallet_bursts = WalletBursts()
