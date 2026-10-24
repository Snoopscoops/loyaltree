"""Small native/process measurements; safe to import before app dependencies."""
import os
import math
import resource
import sys
from threading import active_count, Lock
import time
import tracemalloc

MIB = 1024 * 1024
_details_lock = Lock()
_details_at, _details = None, {}


def current_rss_mb():
    try:
        with open('/proc/self/statm') as file:
            return round(int(file.read().split()[1]) * os.sysconf('SC_PAGE_SIZE') / MIB, 2)
    except (OSError, ValueError, IndexError):
        return None  # A lifetime peak is not a substitute for current RSS.


def container_memory():
    """Fresh admission measurements: two tiny cgroup files, no heap capture."""
    result = {'container_memory_mb': None, 'container_limit_mb': None}
    for paths, key in ((('/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes'), 'container_memory_mb'),
                       (('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'), 'container_limit_mb')):
        for path in paths:
            try:
                with open(path) as file:
                    value = int(file.read().strip())
                if 0 <= value < (1 << 60):  # v1 unlimited sentinels are not real limits.
                    result[key] = round(value / MIB, 2)
                break
            except (OSError, ValueError):
                pass
    return result


def container_headroom(values):
    """Unknown/unlimited/invalid limits are unavailable, never zero headroom."""
    used, limit = values.get('container_memory_mb'), values.get('container_limit_mb')
    if (isinstance(used, (int, float)) and isinstance(limit, (int, float))
            and math.isfinite(used) and math.isfinite(limit) and used >= 0 and limit > 0):
        return round(limit - used, 2)
    return None


def memory_details():
    """Bound diagnostic reads to once per 30 seconds, even during pass bursts.

    These components overlap; they must not be added to process RSS. Keep raw
    cgroup usage for admission rather than assuming all file cache reclaimable.
    """
    global _details_at, _details
    now = time.monotonic()
    with _details_lock:
        if _details_at is not None and now - _details_at < 30:
            return dict(_details)
        result = dict(container_anon_mb=None, container_file_mb=None,
                      container_kernel_mb=None, parent_pid=os.getppid(), parent_rss_mb=None)
        for path in ('/sys/fs/cgroup/memory.stat', '/sys/fs/cgroup/memory/memory.stat'):
            try:
                with open(path) as file:
                    stats = {key: int(value) for key, value in (line.split() for line in file)}
                for output, names in (('container_anon_mb', ('anon', 'total_rss', 'rss')),
                                      ('container_file_mb', ('file', 'total_cache', 'cache')),
                                      ('container_kernel_mb', ('kernel',))):
                    value = next((stats[name] for name in names if name in stats), None)
                    if value is not None and value >= 0:
                        result[output] = round(value / MIB, 2)
                break
            except (OSError, ValueError):
                pass
        try:
            with open('/proc/{}/statm'.format(result['parent_pid'])) as file:
                result['parent_rss_mb'] = round(int(file.read().split()[1]) * os.sysconf('SC_PAGE_SIZE') / MIB, 2)
        except (OSError, ValueError, IndexError):
            pass
        _details_at, _details = now, result
        return dict(result)


def memory_usage():
    try: usage = resource.getrusage(resource.RUSAGE_SELF)
    except (OSError, ValueError): usage = None
    result = {'pid': os.getpid(), 'rss_mb': current_rss_mb(),
              'rss_peak_mb': round(usage.ru_maxrss / (MIB if sys.platform == 'darwin' else 1024), 2) if usage else None,
              'cpu_total_seconds': round(usage.ru_utime + usage.ru_stime, 4) if usage else None, 'threads': active_count(),
              **container_memory(), **memory_details(),
              'python_heap_mb': None, 'python_heap_peak_mb': None, 'trace_overhead_mb': None}
    result['container_headroom_mb'] = container_headroom(result)
    if tracemalloc.is_tracing():
        current, high = tracemalloc.get_traced_memory()
        result.update(python_heap_mb=round(current / MIB, 2), python_heap_peak_mb=round(high / MIB, 2),
                      trace_overhead_mb=round(tracemalloc.get_tracemalloc_memory() / MIB, 2))
    return result
