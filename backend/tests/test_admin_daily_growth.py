import importlib.util
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("daily_growth", Path(__file__).resolve().parents[1] / "admin_daily_growth.py")
growth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(growth)

class Query:
    def __init__(self, rows):
        self.rows = list(rows)
    def select(self, columns): return self
    def gt(self, key, value):
        self.rows = [r for r in self.rows if r[key] > value]; return self
    def gte(self, key, value):
        self.rows = [r for r in self.rows if r[key] >= value]; return self
    def lt(self, key, value):
        self.rows = [r for r in self.rows if r[key] < value]; return self
    def order(self, key):
        self.rows.sort(key=lambda r:r[key]); return self
    def limit(self, n):
        self.rows = self.rows[:n]; return self
    def execute(self): return SimpleNamespace(data=self.rows)

class DB:
    def __init__(self, rows): self.rows=rows
    def table(self, name): return Query(self.rows.get(name, []))

def test_daily_report_manila_boundary_and_distinct_memberships(monkeypatch):
    monkeypatch.setattr(growth, "PAGE", 1)
    now = datetime(2026,11,27,4,tzinfo=timezone.utc)
    rows = {
        "businesses":[{"id":1,"name":"Real","public_id":"b1","is_demo":False,"created_at":"2026-11-26T16:00:00"},
                      {"id":2,"name":"Demo","public_id":"b2","is_demo":True,"created_at":"2026-11-26T16:00:00"}],
        "branches":[{"id":1,"business_id":1,"name":"Main","created_at":"2026-11-26T16:00:00+00:00"}],
        "customers":[{"id":1,"business_id":1,"created_at":"2026-11-26T15:59:59"},
                     {"id":2,"business_id":1,"created_at":"2026-11-26T16:00:00"},
                     {"id":3,"business_id":2,"created_at":"2026-11-26T16:00:00"},
                     {"id":4,"business_id":1,"created_at":"2026-11-27T05:00:00"}],
        "stamp_events":[{"id":1,"business_id":1,"customer_id":2,"branch_id":1,"created_at":"2026-11-26T16:00:00+00:00"},
                        {"id":2,"business_id":1,"customer_id":2,"branch_id":1,"created_at":"2026-11-27T01:00:00+00:00"}],
        "redemption_events":[{"id":1,"business_id":1,"customer_id":2,"branch_id":None,"created_at":"2026-11-27T01:00:00+00:00"}],
        "points_events":[{"id":1,"business_id":1,"customer_id":2,"branch_id":1,"points_earned":9,"created_at":"2026-11-27T01:00:00+00:00"},
                         {"id":2,"business_id":1,"customer_id":1,"branch_id":1,"points_earned":3,"created_at":"2026-11-27T02:00:00+00:00"}]
    }
    report = growth.build_daily_report(DB(rows), 2, now)
    yesterday, today = report["daily"]
    assert yesterday["new_memberships"] == 1
    assert today["new_memberships"] == 1
    assert today["new_businesses"] == 1 and today["new_branches"] == 1
    assert today["stamp_events"] == 2
    assert today["redemption_events"] == 1
    assert today["points_events"] == 2 and today["points_earned"] == 12
    assert today["active_memberships"] == 2
    assert all(r["business_public_id"] == "b1" for r in report["businesses"])
    assert any(r["branch_name"] == "Unattributed" for r in report["branches"])

def test_empty_days_are_explicit():
    report = growth.build_daily_report(DB({}), 7, datetime(2026,11,27,4,tzinfo=timezone.utc))
    assert len(report["daily"]) == 7
    assert all(r["new_memberships"] == r["stamp_events"] == r["points_earned"] == 0 for r in report["daily"])
    assert report["businesses"] == []

def test_route_requires_admin():
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    app = FastAPI()
    def denied(): raise HTTPException(401, "Unauthorized")
    growth.register_daily_growth_routes(app, DB({}), denied)
    assert TestClient(app).get("/api/v1/admin/daily-growth").status_code == 401
