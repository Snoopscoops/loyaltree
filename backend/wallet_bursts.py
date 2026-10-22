"""One bounded aggregate per business burst, with sampled process RSS."""
import asyncio
from collections import OrderedDict
from threading import Lock
import time

try:
    from .runtime_metrics import current_rss_mb
except ImportError:
    from runtime_metrics import current_rss_mb


class WalletBursts:
    def __init__(self, read=current_rss_mb, clock=time.monotonic, emit=None):
        self.read, self.clock, self.emit = read, clock, emit
        self.rows, self.lock = OrderedDict(), Lock()

    def record(self, business, kind=None):
        if not business: return
        try: rss = self.read()
        except Exception: rss = None
        evicted = None
        with self.lock:
            if business not in self.rows:
                if len(self.rows) >= 128: evicted = self.rows.popitem(last=False)
                self.rows[business] = dict(passes_built=0, cache_hits=0, failed=0, peak_rss_mb=None, last=self.clock())
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
        try: rss = self.read()
        except Exception: rss = None
        done = []
        with self.lock:
            for business, row in list(self.rows.items()):
                if rss is not None: row['peak_rss_mb'] = max(row['peak_rss_mb'] or rss, rss)
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
