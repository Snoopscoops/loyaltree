"""Small bounded rolling-window budgets for the single Render worker."""
from collections import deque
from threading import Lock
import time


class RollingBudget:
    def __init__(self, count=5, seconds=60, clock=time.monotonic):
        self.count, self.seconds, self.clock = count, seconds, clock
        self.used, self.lock = deque(), Lock()

    def take(self):
        with self.lock:
            now = self.clock()
            while self.used and self.used[0] <= now-self.seconds:
                self.used.popleft()
            if len(self.used) >= self.count:
                return False
            self.used.append(now)
            return True


upgrade_delivery_budget = RollingBudget()
