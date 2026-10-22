"""One current-RSS hysteresis gate for Apple builds, pushes and rollouts."""
from threading import Lock

try:
    from .runtime_metrics import current_rss_mb
except ImportError:
    from runtime_metrics import current_rss_mb


class MemoryPressure:
    def __init__(self, read=None, log=None):
        self.read, self.log = read or current_rss_mb, log
        self._paused, self._lock = False, Lock()

    def paused(self):
        try: rss = self.read()
        except Exception: rss = None
        with self._lock:
            old = self._paused
            if rss is not None:
                if rss > 350: self._paused = True
                elif rss < 300: self._paused = False
            paused = self._paused
        if old != paused:
            try:
                log = self.log
                if log is None:
                    try: from .monitoring import log_event as log
                    except ImportError: from monitoring import log_event as log
                log('lt_benefits_memory_pause' if paused else 'wallet_memory_resumed',
                    'warning' if paused else 'info', rss_mb=rss)
            except Exception: pass
        return paused


memory_pressure = MemoryPressure()
