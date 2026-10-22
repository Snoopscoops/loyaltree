"""Bound expensive Apple work before submitting it to the thread pool."""
import asyncio
import hashlib
import json

from fastapi import HTTPException


class AppleBuilds:
    def __init__(self, concurrency=2, queue_size=16):
        self.semaphore = asyncio.Semaphore(concurrency)
        self.capacity = concurrency + queue_size
        self.inflight = {}

    async def run(self, build, *args):
        # Include content, not just serial: a concurrent stamp/edit must never
        # join an older build. The same revision shares signing and image work.
        key = (build.__name__, hashlib.sha256(json.dumps(args, sort_keys=True, default=str).encode()).digest())
        task = self.inflight.get(key)
        if task is None:
            if len(self.inflight) >= self.capacity:
                raise HTTPException(503, 'Apple Wallet is busy. Please retry.', headers={'Retry-After': '15'})
            async def work():
                try:
                    async with self.semaphore:
                        return await asyncio.to_thread(build, *args)
                finally:
                    self.inflight.pop(key, None)
            task = asyncio.create_task(work())
            self.inflight[key] = task
            # A disconnected phone must not free a slot while its native
            # thread is still building. Also consume orphaned task errors.
            task.add_done_callback(lambda done: None if done.cancelled() else done.exception())
        return await asyncio.shield(task)


apple_builds = AppleBuilds()
