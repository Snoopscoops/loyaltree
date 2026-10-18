"""Public business totals remain cached and never query customer activity."""
import ast
from datetime import datetime
from pathlib import Path
from threading import Lock
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock

from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient


class PublicBusinessStatsTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).resolve().parents[1] / 'main.py'
        node = next(n for n in ast.parse(source.read_text()).body
                    if isinstance(n, ast.FunctionDef) and n.name == 'public_community_stats')
        self.clock = 1000.0
        self.db = MagicMock()
        self.query = self.db.table.return_value.select.return_value.limit.return_value
        self.query.execute.return_value = SimpleNamespace(count=12)
        self.cache = dict(value=None, expires_at=0, retry_at=0, saved_at=0)
        self.lock = Lock()
        app = FastAPI()
        env = dict(app=app, Response=Response, HTTPException=HTTPException,
                   datetime=datetime, time=SimpleNamespace(time=lambda: self.clock),
                   supabase=self.db, _COMMUNITY_STATS_CACHE=self.cache,
                   _COMMUNITY_STATS_LOCK=self.lock)
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), env)
        self.client = TestClient(app)

    def get(self):
        return self.client.get('/api/v1/public/community-stats')

    def test_only_business_total_is_public_and_only_businesses_are_queried(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {'businesses', 'updated_at'})
        self.assertEqual(response.json()['businesses'], 12)
        self.db.table.assert_called_once_with('businesses')
        self.assertIn('max-age=60', response.headers['cache-control'])

    def test_five_minute_cache_avoids_extra_database_queries(self):
        first = self.get().json()
        self.clock += 299
        self.assertEqual(self.get().json(), first)
        self.assertEqual(self.query.execute.call_count, 1)
        self.clock += 2
        self.query.execute.return_value = SimpleNamespace(count=13)
        self.assertEqual(self.get().json()['businesses'], 13)
        self.assertEqual(self.query.execute.call_count, 2)

    def test_upstream_failure_preserves_recent_count_then_returns_unavailable(self):
        first = self.get().json()
        self.clock += 301
        self.query.execute.side_effect = RuntimeError('private database details')
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), first)
        self.clock += 1801
        response = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertNotIn('private', response.text)
        calls = self.query.execute.call_count
        self.assertEqual(self.get().status_code, 503)
        self.assertEqual(self.query.execute.call_count, calls)

    def test_concurrent_cache_miss_does_not_start_another_refresh(self):
        self.lock.acquire()
        try:
            response = self.get()
        finally:
            self.lock.release()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['retry-after'], '3')
        self.db.table.assert_not_called()
