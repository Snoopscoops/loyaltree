"""Read-only, aggregate daily loyalty reporting for the existing super-admin guard."""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import Depends, HTTPException, Query

MANILA = ZoneInfo("Asia/Manila")
PAGE = 500
MAX_ROWS = 100000

def _rows(db, table, columns, start=None, end=None, naive=False):
    result = []
    last = 0
    while True:
        q = db.table(table).select(columns).gt("id", last).order("id").limit(PAGE)
        if start is not None:
            def fmt(dt):
                return (dt.replace(tzinfo=None) if naive else dt).isoformat()
            q = q.gte("created_at", fmt(start)).lt("created_at", fmt(end))
        batch = q.execute().data or []
        if not batch:
            return result
        next_id = int(batch[-1]["id"])
        if next_id <= last or len(result) + len(batch) > MAX_ROWS:
            raise RuntimeError("Daily report exceeds safe scan limit")
        result.extend(batch)
        last = next_id

def _day(value):
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(MANILA).date().isoformat()

def _bucket():
    return {"new_memberships": 0, "new_businesses": 0, "new_branches": 0,
            "stamp_events": 0, "redemption_events": 0, "points_events": 0, "points_earned": 0, "active_memberships": 0}

def build_daily_report(db, days, now=None):
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(MANILA).date()
    first = today - timedelta(days=days-1)
    start = datetime.combine(first, datetime.min.time(), MANILA).astimezone(timezone.utc)
    end = min(now, datetime.combine(today+timedelta(days=1), datetime.min.time(), MANILA).astimezone(timezone.utc))
    businesses = {r["id"]: r for r in _rows(db, "businesses", "id,name,public_id,is_demo,created_at") if not r.get("is_demo")}
    series = {(first+timedelta(days=i)).isoformat(): _bucket() for i in range(days)}
    per_business = defaultdict(_bucket)
    active = defaultdict(set)
    active_business = defaultdict(set)
    branches = {}
    for r in _rows(db, "branches", "id,business_id,name,created_at"):
        if r["business_id"] in businesses:
            branches[r["id"]] = r
            if r.get("created_at"):
                d = _day(r["created_at"])
                if d in series:
                    series[d]["new_branches"] += 1
                    per_business[(d,r["business_id"])]["new_branches"] += 1
    for bid, r in businesses.items():
        if r.get("created_at"):
            d = _day(r["created_at"])
            if d in series:
                series[d]["new_businesses"] += 1
                per_business[(d,bid)]["new_businesses"] += 1
    for r in _rows(db,"customers","id,business_id,created_at",start,end,True):
        bid = r["business_id"]
        if bid not in businesses:
            continue
        d = _day(r["created_at"])
        if d in series:
            series[d]["new_memberships"] += 1
            per_business[(d,bid)]["new_memberships"] += 1
    per_branch = defaultdict(lambda: {"stamp_events":0,"redemption_events":0,"points_events":0,"points_earned":0})
    for table in ("stamp_events","redemption_events","points_events"):
        columns = "id,business_id,customer_id,branch_id,created_at" + (",points_earned" if table == "points_events" else "")
        for r in _rows(db,table,columns,start,end):
            bid = r["business_id"]
            if bid not in businesses:
                continue
            d = _day(r["created_at"])
            if d not in series:
                continue
            series[d][table] += 1
            per_business[(d,bid)][table] += 1
            points = int(r.get("points_earned") or 0) if table == "points_events" else 0
            series[d]["points_earned"] += points
            per_business[(d,bid)]["points_earned"] += points
            cid = r.get("customer_id")
            if cid is not None:
                active[d].add((bid,cid))
                active_business[(d,bid)].add(cid)
            branch = branches.get(r.get("branch_id"))
            if branch and branch["business_id"] == bid:
                per_branch[(d,bid,branch["id"])][table] += 1
                per_branch[(d,bid,branch["id"])]["points_earned"] += points
            else:
                per_branch[(d,bid,None)][table] += 1
                per_branch[(d,bid,None)]["points_earned"] += points
    for d, ids in active.items():
        series[d]["active_memberships"] = len(ids)
    for key, ids in active_business.items():
        per_business[key]["active_memberships"] = len(ids)
    rows = []
    for (d,bid), values in sorted(per_business.items()):
        rows.append({"date":d,"business_name":businesses[bid]["name"],
                     "business_public_id":businesses[bid]["public_id"],**values})
    branch_rows = [{"date":d,"business_public_id":businesses[bid]["public_id"],
                    "branch_name":branches[branch]["name"] if branch is not None else "Unattributed",
                    **values} for (d,bid,branch),values in per_branch.items()]
    return {"timezone":"Asia/Manila","as_of":now.isoformat(),"today":today.isoformat(),
            "daily":[{"date":d,**v} for d,v in series.items()],
            "businesses":rows,"branches":branch_rows,
            "definitions":{"new_memberships":"Customer card records; not unique humans across programs.",
            "stamp_events":"Recorded stamp events, not net balance or visits.",
            "active_memberships":"Distinct customer cards with stamp, points or redemption activity.",
            "points_earned":"Sum of recorded points_earned; not outstanding balance.",
            "branch_registrations":"Unavailable: no direct branch attribution."}}

def register_daily_growth_routes(app, db, require_admin):
    @app.get("/api/v1/admin/daily-growth")
    def daily_growth(days: int = Query(7, ge=2, le=31), _: bool = Depends(require_admin)):
        if db is None:
            raise HTTPException(503, "Database unavailable")
        try:
            return build_daily_report(db, days)
        except Exception as exc:
            raise HTTPException(503, "Daily report unavailable") from exc
