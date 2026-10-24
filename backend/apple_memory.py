"""Hysteresis gates for worker RSS and enforced container memory headroom."""
import math
import os
from threading import Lock

try:
    from .runtime_metrics import current_rss_mb, container_memory, container_headroom
except ImportError:
    from runtime_metrics import current_rss_mb, container_memory, container_headroom


def _positive(value, default):
    try:
        number = float(value)
        return number if math.isfinite(number) and number > 0 else default
    except (TypeError, ValueError):
        return default


class MemoryPressure:
    def __init__(self, read=None, log=None, *, read_container=None,
                 pause_headroom_mb=None, resume_headroom_mb=None):
        self.read, self.log = read or current_rss_mb, log
        # Explicit RSS readers retain the original deterministic, RSS-only API.
        self.read_container = read_container or (container_memory if read is None else None)
        self.pause_headroom = _positive(pause_headroom_mb if pause_headroom_mb is not None
            else os.getenv('APPLE_MEMORY_PAUSE_HEADROOM_MB'), 100)
        self.resume_headroom = _positive(resume_headroom_mb if resume_headroom_mb is not None
            else os.getenv('APPLE_MEMORY_RESUME_HEADROOM_MB'), 120)
        if self.resume_headroom <= self.pause_headroom:
            self.resume_headroom = self.pause_headroom + 20
        self._worker_paused = self._container_paused = False
        self._paused, self._lock = False, Lock()

    def paused(self):
        try: rss = self.read()
        except Exception: rss = None
        try: container = self.read_container() if self.read_container else {}
        except Exception: container = {}
        if not isinstance(container, dict): container = {}
        headroom = container_headroom(container)
        with self._lock:
            old = self._paused
            if rss is not None:
                if rss > 350: self._worker_paused = True
                elif rss < 300: self._worker_paused = False
            if headroom is not None:
                if headroom <= self.pause_headroom: self._container_paused = True
                elif headroom >= self.resume_headroom: self._container_paused = False
            # Unknown measurements preserve each reason independently. A low
            # worker RSS cannot clear a container pause while cgroup is missing.
            self._paused = self._worker_paused or self._container_paused
            paused = self._paused
            reasons = (["worker_rss"] if self._worker_paused else []) + (["container_headroom"] if self._container_paused else [])
        if old != paused:
            try:
                log = self.log
                if log is None:
                    try: from .monitoring import log_event as log
                    except ImportError: from monitoring import log_event as log
                log('lt_benefits_memory_pause' if paused else 'wallet_memory_resumed',
                    'warning' if paused else 'info', rss_mb=rss,
                    container_memory_mb=container.get('container_memory_mb'),
                    container_limit_mb=container.get('container_limit_mb'),
                    container_headroom_mb=headroom, pressure_sources=reasons,
                    pause_headroom_mb=self.pause_headroom, resume_headroom_mb=self.resume_headroom)
            except Exception: pass
        return paused


memory_pressure = MemoryPressure()
