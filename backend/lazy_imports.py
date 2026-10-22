"""Defer optional render dependencies until an actual QR/image request."""
from importlib import import_module
from threading import RLock


class LazyModule:
    def __init__(self, name):
        self._name, self._module, self._lock = name, None, RLock()

    def __getattr__(self, name):
        with self._lock:
            if self._module is None:
                self._module = import_module(self._name)
            module = self._module
        return getattr(module, name)
