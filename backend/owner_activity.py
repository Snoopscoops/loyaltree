"""Read-only owner visit metrics without customer personal data.

A visit is a customer-local calendar day with recorded loyalty activity.
Balances, redemptions, adjustments, pack issuance and clock-outs aren't visits.
"""
from collections import defaultdict
from datetime import datetime, timezone
from threading import Lock
from time import monotonic

_CACHE = {}
_CACHE_LOCK = Lock()
_CACHE_EPOCH = 0
_CACHE_SECONDS = 120
_PAGE_SIZE = 1000
VISIT_TABLES = (
    'stamp_events', 'points_events', 'membership_events',
    'multipass_events', 'vip_events', 'employee_attendance_events',
)


def read_customer_rows(db, business_id, program_id=None):
    """Keep customer lists and summary totals complete beyond 1,000 members."""
    rows = []
    offset = 0
    while True:
        query = db.table('customers').select('*').eq('business_id', business_id)
        if program_id is not None:
            query = query.eq('program_id', program_id)
        batch = query.order('id').range(offset, offset + _PAGE_SIZE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < _PAGE_SIZE:
            return rows
        offset += _PAGE_SIZE


def invalidate_owner_activity(business_id):
    global _CACHE_EPOCH
    with _CACHE_LOCK:
        _CACHE_EPOCH += 1
        for key in list(_CACHE):
            if key[0] == str(business_id):
                del _CACHE[key]


def _read_pages(db, table, columns, business_id, customer_ids, filters=()):
    """Page past PostgREST's row limit; keep small program queries DB-scoped."""
    rows = []
    offset = 0
    while True:
        query = db.table(table).select(columns).eq('business_id', business_id)
        # Avoid excessively long URLs for large customer lists. The business
        # constraint is always applied, with customer filtering below as well.
        if len(customer_ids) <= 300:
            query = query.in_('customer_id', list(customer_ids))
        for field, value in filters:
            query = query.eq(field, value)
        batch = query.order('id').range(offset, offset + _PAGE_SIZE - 1).execute().data or []
        rows.extend(row for row in batch if str(row.get('customer_id')) in customer_ids)
        if len(batch) < _PAGE_SIZE:
            return rows
        offset += _PAGE_SIZE


def _missing_table(exc):
    code = getattr(exc, 'code', None)
    if not code and exc.args and isinstance(exc.args[0], dict):
        code = exc.args[0].get('code')
    return str(code or '').upper() in ('42P01', 'PGRST205')


def read_visit_rows(db, business_id, customer_ids, tables, required_tables=()):
    """Reuse narrow history reads for two minutes, invalidated by mutations.

    An absent optional ledger is exposed as missing coverage, so an older
    installation without employee attendance can still show its stamp history.
    Missing a ledger required by the current program or any transport/permission
    failure remains an unavailable metric, never an invented zero.
    """
    customer_ids = {str(value) for value in customer_ids}
    key = (str(business_id), tuple(sorted(customer_ids)), tuple(sorted(tables)), tuple(sorted(required_tables)))
    now = monotonic()
    with _CACHE_LOCK:
        epoch = _CACHE_EPOCH
        hit = _CACHE.get(key)
        if hit and now - hit[0] < _CACHE_SECONDS:
            return hit[1], hit[2], hit[3]
    result = {}
    missing_sources = []
    if customer_ids:
        for table in tables:
            extra = ',action' if table in ('multipass_events', 'vip_events', 'employee_attendance_events') else ''
            if table == 'membership_events':
                extra += ',service_date'
            try:
                result[table] = _read_pages(db, table, 'customer_id,created_at' + extra,
                                           business_id, customer_ids)
            except Exception as exc:
                if table in required_tables or not _missing_table(exc):
                    raise
                missing_sources.append(table)
    as_of = datetime.now(timezone.utc).isoformat()
    with _CACHE_LOCK:
        # A mutation can finish while these sequential reads are in flight.
        # Do not repopulate the cache with the older pre-mutation snapshot.
        if _CACHE_EPOCH != epoch:
            return result, as_of, missing_sources
        for old_key, hit in list(_CACHE.items()):
            if now - hit[0] >= _CACHE_SECONDS:
                del _CACHE[old_key]
        if len(_CACHE) >= 128:
            del _CACHE[next(iter(_CACHE))]
        _CACHE[key] = (now, result, as_of, missing_sources)
    return result, as_of, missing_sources


def read_reward_rows(db, business_id, customer_ids, need_stamp_claims):
    ids = {str(value) for value in customer_ids}
    if not ids:
        return [], []
    coupons = _read_pages(db, 'coupons', 'customer_id,status,starts_at,expires_at',
                          business_id, ids, (('status', 'active'),))
    claims = []
    if need_stamp_claims:
        claims = _read_pages(db, 'stamp_reward_claims', 'customer_id,milestone_id,card_cycle',
                            business_id, ids)
    return coupons, claims


def build_owner_activity(customers, visit_rows, reward_ready, *, parse_ts, local_tz,
                         churn_days=30, now=None, activity_available=True,
                         rewards_available=True, as_of=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(local_tz).date()
    visits = defaultdict(set)
    last_visits = {}
    customer_ids = {str(row.get('id')) for row in customers}
    for table, rows in (visit_rows or {}).items():
        for row in rows:
            cid = str(row.get('customer_id'))
            if cid not in customer_ids:
                continue
            action = str(row.get('action') or '')
            if table == 'multipass_events' and action != 'used':
                continue
            if table == 'employee_attendance_events' and action != 'time_in':
                continue
            if table == 'vip_events' and action not in {
                'sale', 'vip_sale', 'tier_points_sale', 'tier_stamp', 'vip_tier_stamp',
            }:
                continue
            raw = (row.get('service_date') if table == 'membership_events' else None) or row.get('created_at')
            parsed = parse_ts(raw)
            if not parsed:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            # Staff-selected service_date is already a local date, not UTC.
            day = parsed.date() if table == 'membership_events' and len(str(raw)) == 10 else parsed.astimezone(local_tz).date()
            if day > today:
                continue
            visits[cid].add(day)
            if cid not in last_visits or parsed > last_visits[cid]:
                last_visits[cid] = parsed
    segments = {key: 0 for key in ('regulars', 'first_time', 'occasional', 'at_risk')}
    activity = {}
    returning = visited = 0
    for customer in customers:
        cid = str(customer.get('id'))
        count = len(visits[cid])
        last = max(visits[cid]) if count else None
        joined = parse_ts(customer.get('created_at'))
        if joined and joined.tzinfo is None:
            joined = joined.replace(tzinfo=timezone.utc)
        activity_date = last or (joined.astimezone(local_tz).date() if joined else None)
        inactive_days = (today - activity_date).days if activity_date else None
        if inactive_days is not None and inactive_days >= churn_days:
            segment = 'at_risk'
        elif count >= 3:
            segment = 'regulars'
        elif count <= 1:
            segment = 'first_time'
        else:
            segment = 'occasional'
        segments[segment] += 1
        visited += count > 0
        returning += count >= 2
        activity[str(customer.get('public_id') or customer.get('id'))] = {
            'visits': count if activity_available else None,
            'last_visit_at': last_visits[cid].isoformat() if cid in last_visits and activity_available else None,
            'segment': segment if activity_available else None,
            'rewards_ready': bool(reward_ready.get(cid)) if rewards_available else None,
        }
    result = {
        'total_customer_visits': sum(len(days) for days in visits.values()) if activity_available else None,
        'return_rate': round(returning / visited * 100, 1) if activity_available and visited else (0 if activity_available else None),
        'rewards_ready': sum(bool(reward_ready.get(str(row.get('id')))) for row in customers) if rewards_available else None,
        'customer_segments': segments if activity_available else None,
        'customer_activity': activity,
        'activity_available': activity_available,
        'rewards_available': rewards_available,
        'activity_as_of': as_of or now.isoformat(),
        'churn_days': churn_days,
        'visit_definition': 'unique_customer_visit_days',
        'return_rate_definition': 'returning_customers_over_customers_with_recorded_visits',
    }
    if not activity_available or not rewards_available:
        result['partial'] = True
    return result
