"""Small native/process measurements; safe to import before app dependencies."""
import os
import resource
import sys
from threading import active_count
import tracemalloc

MIB = 1024 * 1024


def current_rss_mb():
    try:
        with open('/proc/self/statm') as file:
            return round(int(file.read().split()[1]) * os.sysconf('SC_PAGE_SIZE') / MIB, 2)
    except (OSError, ValueError, IndexError):
        return None  # A lifetime peak is not a substitute for current RSS.


def memory_usage():
    try: usage = resource.getrusage(resource.RUSAGE_SELF)
    except (OSError, ValueError): usage = None
    result = {'pid': os.getpid(), 'rss_mb': current_rss_mb(),
              'rss_peak_mb': round(usage.ru_maxrss / (MIB if sys.platform == 'darwin' else 1024), 2) if usage else None,
              'cpu_total_seconds': round(usage.ru_utime + usage.ru_stime, 4) if usage else None, 'threads': active_count(),
              'container_memory_mb': None, 'container_limit_mb': None,
              'python_heap_mb': None, 'python_heap_peak_mb': None, 'trace_overhead_mb': None}
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
    if tracemalloc.is_tracing():
        current, high = tracemalloc.get_traced_memory()
        result.update(python_heap_mb=round(current / MIB, 2), python_heap_peak_mb=round(high / MIB, 2),
                      trace_overhead_mb=round(tracemalloc.get_tracemalloc_memory() / MIB, 2))
    return result
