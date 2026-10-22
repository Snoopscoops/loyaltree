"""Best-effort glibc arena release; harmless on non-glibc platforms."""
import sys

_trim = None


def trim_memory():
    global _trim
    if _trim is None:
        try:
            if not sys.platform.startswith('linux'):
                _trim = False
            else:
                import ctypes
                _trim = ctypes.CDLL('libc.so.6').malloc_trim
                _trim.argtypes = [ctypes.c_size_t]
                _trim.restype = ctypes.c_int
        except (OSError, AttributeError):
            _trim = False
    if _trim:
        try: return bool(_trim(0))
        except Exception: pass
    return False
