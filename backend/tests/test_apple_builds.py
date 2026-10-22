import asyncio
from concurrent.futures import ThreadPoolExecutor
import threading
import unittest

from fastapi import HTTPException
from backend.apple_builds import AppleBuilds


class BuildLimitsTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_builds_and_bounded_queue_with_single_flight(self):
        gate = AppleBuilds(concurrency=2, queue_size=1)
        started, release = threading.Event(), threading.Event()
        active = peak = calls = 0
        lock = threading.Lock()
        def build(card):
            nonlocal active, peak, calls
            with lock:
                active += 1; calls += 1; peak = max(peak, active)
                if active == 2: started.set()
            release.wait(3)
            with lock: active -= 1
            return card['public_id'].encode()
        tasks = [asyncio.create_task(gate.run(build, {'public_id': str(i)})) for i in range(3)]
        same = asyncio.create_task(gate.run(build, {'public_id': '0'}))
        try:
            self.assertTrue(await asyncio.to_thread(started.wait, 1))
            with self.assertRaises(HTTPException) as error:
                await gate.run(build, {'public_id': 'full'})
            self.assertEqual(error.exception.status_code, 503)
            self.assertEqual(error.exception.headers['Retry-After'], '15')
            self.assertEqual(peak, 2)
        finally:
            release.set()
        self.assertEqual(await asyncio.gather(*tasks, same), [b'0', b'1', b'2', b'0'])
        self.assertEqual(calls, 3)
        self.assertFalse(gate.inflight)

    async def test_disconnect_keeps_slot_until_thread_finishes_and_errors_retry(self):
        gate = AppleBuilds(1, 0)
        started, release = threading.Event(), threading.Event()
        def build(value):
            started.set(); release.wait(3)
            return b'pass'
        caller = asyncio.create_task(gate.run(build, 'serial'))
        await asyncio.to_thread(started.wait, 1)
        caller.cancel()
        with self.assertRaises(asyncio.CancelledError): await caller
        try:
            with self.assertRaises(HTTPException): await gate.run(build, 'other')
            duplicate = asyncio.create_task(gate.run(build, 'serial'))
        finally: release.set()
        self.assertEqual(await duplicate, b'pass')
        def failed(value): raise ValueError('synthetic')
        for _ in range(2):
            with self.assertRaises(ValueError): await gate.run(failed, 'serial')
        self.assertFalse(gate.inflight)


if __name__ == '__main__': unittest.main()
