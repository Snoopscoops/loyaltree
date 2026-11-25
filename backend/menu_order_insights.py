"""Digital-menu orders: branch + member link, today's summary, and what groups order.

Pure helpers are kept separate from the routes so they can be unit tested.
Only data that really exists is used: the order rows themselves, plus the
customer fields saved on a loyalty card (age range, gender, occupation, card
join date) when the buyer connected their card on the menu.
"""
import calendar
import csv
import io
from collections import Counter, defaultdict
from datetime import date, datetime, time as dtime, timedelta, timezone
from zoneinfo import ZoneInfo
import re
from decimal import Decimal, InvalidOperation

from fastapi import Header, HTTPException, Response

try:
    from .customer_demographics import AGE_LABELS, GENDER_LABELS, OCCUPATION_LABELS, age_bracket
    from .menu_order_access import scoped_branch
    from .menu_order_adjustment_routes import read_counter_order, transition_counter_order
except ImportError:  # running from backend/
    from customer_demographics import AGE_LABELS, GENDER_LABELS, OCCUPATION_LABELS, age_bracket
    from menu_order_access import scoped_branch
    from menu_order_adjustment_routes import read_counter_order, transition_counter_order

MANILA = ZoneInfo('Asia/Manila')
OPTIONAL_ORDER_COLUMNS = ('branch_public_id', 'branch_name', 'member_customer_public_id', 'payment_method')
PAYMENT_METHODS = {'cash': 'Cash', 'qrph': 'GCash / Maya / Bank (QR Ph)', 'card': 'Card'}
PAID_STATUSES = ('paid', 'paid_test')
PAGE = 1000
MAX_ROWS = 20000
# Demographic groups are shown only with enough orders from enough people,
# so one regular's order history can't be read off the screen.
MIN_GROUP_ORDERS = 5
MIN_GROUP_MEMBERS = 3
NEW_MEMBER_DAYS = 30
TIME_SLOTS = (('morning', 'Morning (before 11 AM)', 0, 11), ('midday', 'Lunch (11 AM–2 PM)', 11, 14),
              ('afternoon', 'Afternoon (2–5 PM)', 14, 17), ('evening', 'Evening (5 PM on)', 17, 24))
WEEKDAYS = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')


# ---------------------------------------------------------------- writing ---

def missing_column(exc, candidates):
    """Name of an optional column the database says is missing, else None."""
    message = str(getattr(exc, 'message', '') or exc)
    code = str(getattr(exc, 'code', '') or '')
    if code not in ('42703', 'PGRST204') and 'column' not in message.lower():
        return None
    for field in candidates:
        if re.search(rf"\b{re.escape(field)}\b", message):
            return field
    return None


def insert_order(db, row, optional=OPTIONAL_ORDER_COLUMNS):
    """Insert, dropping optional columns the table does not have yet.

    Until the owner runs menu_order_branches.sql the order still saves, just
    without branch/member columns. Returns (saved_row, dropped_columns).
    """
    data = dict(row)
    dropped = []
    while True:
        try:
            result = db.table('menu_counter_orders').insert(data).execute()
            rows = getattr(result, 'data', None) or []
            return (rows[0] if rows else data), dropped
        except Exception as exc:
            field = missing_column(exc, [key for key in optional if key in data])
            if not field:
                raise
            data.pop(field, None)
            dropped.append(field)


def payment_fields(method):
    """(payment_method, payment_status). No real payments exist yet.

    cash -> 'unpaid'     customer pays at the counter; staff marks it paid.
    qrph -> 'paid_test'  mock GCash / Maya / bank QR Ph payment, nothing charged.
    card -> 'paid_test'  mock card payment, nothing charged.
    missing/unknown -> ('', 'paid') so older menus keep their old behavior.
    The status is decided here, never taken from the browser.
    """
    value = str(method or '').strip().lower()
    if value == 'cash':
        return 'cash', 'unpaid'
    if value in ('qrph', 'card'):
        return value, 'paid_test'
    return '', 'paid'


def resolve_branch(db, business_id, branch_public_id):
    """(public_id, name) for an active branch of this business. '' -> ('', '')."""
    wanted = str(branch_public_id or '').strip()[:80]
    if not wanted:
        return '', ''
    try:
        rows = (db.table('branches').select('public_id,name,is_active')
                .eq('business_id', business_id).eq('public_id', wanted).limit(1).execute().data or [])
    except Exception:
        # Never lose an order over a branch lookup hiccup; save it unassigned.
        return '', ''
    if not rows or rows[0].get('is_active') is False:
        raise HTTPException(status_code=400, detail='That branch is not available. Choose another branch.')
    return str(rows[0].get('public_id') or wanted), str(rows[0].get('name') or 'Branch')[:120]


def member_from_card_token(token, business_public_id, read_token):
    """customer_public_id from a connected menu card, or '' (walk-in).

    A bad or expired card token never blocks an order; it is just not linked.
    """
    token = str(token or '').strip()
    if not token or read_token is None:
        return ''
    try:
        payload = read_token(token, 'session')
    except Exception:
        return ''
    if str(payload.get('business_public_id') or '') != str(business_public_id):
        return ''
    return str(payload.get('customer_public_id') or '')[:80]


# --------------------------------------------------------------- reading ---

def manila_day_bounds(day):
    start = datetime.combine(day, dtime.min, tzinfo=MANILA)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def parse_when(value):
    try:
        parsed = datetime.fromisoformat(str(value or '').replace('Z', '+00:00'))
    except ValueError:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).astimezone(MANILA)


def read_orders(db, business_id, since_utc, until_utc=None):
    rows, offset = [], 0
    while offset < MAX_ROWS:
        query = (db.table('menu_counter_orders').select('*').eq('business_id', business_id)
                 .gte('created_at', since_utc.isoformat()))
        if until_utc is not None:
            query = query.lt('created_at', until_utc.isoformat())
        page = query.order('created_at', desc=True).range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < PAGE:
            break
        offset += PAGE
    return rows


def branch_key(row):
    return str(row.get('branch_public_id') or '')


def branch_label(row):
    # Orders placed before branches were saved on menu orders.
    return str(row.get('branch_name') or '').strip() or 'Before branches'


def filter_branch(rows, branch):
    return [row for row in rows if not branch or branch_key(row) == branch]


def _items(row):
    for item in row.get('items') or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get('item_name') or item.get('name') or 'Item').strip() or 'Item'
        try:
            qty = max(1, int(item.get('quantity') or 1))
        except (TypeError, ValueError):
            qty = 1
        yield name, qty


def _money(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def top_items(rows, limit=3):
    counts = Counter()
    for row in rows:
        for name, qty in _items(row):
            counts[name] += qty
    return [{'name': name, 'quantity': qty} for name, qty in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]]


def daily_summary(rows, day, branch=''):
    """Today's numbers. Cancelled orders are counted separately, not in sales."""
    scoped = filter_branch(rows, branch)
    live = [row for row in scoped if row.get('status') != 'cancelled']
    per_branch = defaultdict(lambda: {'orders': 0, 'sales': 0.0, 'cancelled': 0})
    names = {}
    for row in scoped:
        key = branch_key(row)
        names[key] = branch_label(row)
        bucket = per_branch[key]
        if row.get('status') == 'cancelled':
            bucket['cancelled'] += 1
        else:
            bucket['orders'] += 1
            bucket['sales'] = round(bucket['sales'] + _money(row.get('total')), 2)
    return {
        'date': day.isoformat(),
        'timezone': 'Asia/Manila',
        'branch': branch or '',
        'orders': len(live),
        'sales': round(sum(_money(row.get('total')) for row in live), 2),
        'dine_in': sum(1 for row in live if row.get('service') == 'dine-in'),
        'pickup': sum(1 for row in live if row.get('service') != 'dine-in'),
        'cancelled': len(scoped) - len(live),
        'top_items': top_items(live, 3),
        'payments': payment_breakdown(live),
        'branches': sorted(({'public_id': key, 'name': names[key], **value} for key, value in per_branch.items()),
                           key=lambda value: (-value['sales'], value['name'])),
    }


def payment_breakdown(rows):
    methods = {key: {'method': key, 'label': label, 'orders': 0, 'sales': 0.0} for key, label in PAYMENT_METHODS.items()}
    methods['other'] = {'method': 'other', 'label': 'Not recorded', 'orders': 0, 'sales': 0.0}
    paid = {'orders': 0, 'sales': 0.0}
    unpaid = {'orders': 0, 'sales': 0.0}
    for row in rows:
        amount = _money(row.get('total'))
        bucket = methods.get(str(row.get('payment_method') or ''), methods['other'])
        bucket['orders'] += 1
        bucket['sales'] = round(bucket['sales'] + amount, 2)
        target = unpaid if str(row.get('payment_status') or '') not in PAID_STATUSES else paid
        target['orders'] += 1
        target['sales'] = round(target['sales'] + amount, 2)
    return {'by_method': [value for value in methods.values() if value['orders']], 'paid': paid, 'unpaid': unpaid}


def _group(key, label, rows, members_needed=False):
    people = {str(row.get('member_customer_public_id')) for row in rows if row.get('member_customer_public_id')}
    hidden = members_needed and (len(rows) < MIN_GROUP_ORDERS or len(people) < MIN_GROUP_MEMBERS)
    items = [] if hidden else top_items(rows, 3)
    return {'key': key, 'label': label, 'orders': len(rows), 'hidden': hidden,
            'top_items': items, 'top_item': items[0]['name'] if items else ''}


def _finish_sections(sections):
    """Share of orders per group, and how many groups are too small to show."""
    for section in sections:
        groups = section.get('groups') or []
        total = sum(group['orders'] for group in groups)
        for group in groups:
            group['share_percent'] = round(group['orders'] / total * 100, 1) if total else 0.0
        section['total_orders'] = total
        section['hidden_groups'] = sum(1 for group in groups if group['hidden'])
        section['empty'] = total == 0
    return sections


def order_insights(rows, customers, today, branch='', days=30):
    """What different groups order most, from real order and card data only."""
    scoped = [row for row in filter_branch(rows, branch) if row.get('status') != 'cancelled']
    by_id = {str(c.get('public_id')): c for c in customers if c.get('public_id')}
    linked = [row for row in scoped if str(row.get('member_customer_public_id') or '') in by_id]
    sections = []

    walk_ins = [row for row in scoped if not row.get('member_customer_public_id')]
    members = [row for row in scoped if row.get('member_customer_public_id')]
    sections.append({'key': 'membership', 'title': 'Card members vs walk-ins', 'groups': [
        _group('members', 'Loyalty card members', members, True), _group('walk_ins', 'Walk-ins (no card)', walk_ins)]})

    new, returning = [], []
    for row in linked:
        joined = parse_when(by_id[str(row['member_customer_public_id'])].get('created_at'))
        placed = parse_when(row.get('created_at'))
        if joined and placed and placed - joined <= timedelta(days=NEW_MEMBER_DAYS):
            new.append(row)
        elif joined and placed:
            returning.append(row)
    sections.append({'key': 'tenure', 'title': 'New vs returning members', 'note': f'New = card made in the {NEW_MEMBER_DAYS} days before the order.',
                     'groups': [_group('new', 'New members', new, True), _group('returning', 'Returning members', returning, True)]})

    for field, title, labels in (('age', 'By age range', AGE_LABELS), ('gender', 'By gender', GENDER_LABELS),
                                 ('occupation', 'By occupation', OCCUPATION_LABELS)):
        buckets = defaultdict(list)
        for row in linked:
            customer = by_id[str(row['member_customer_public_id'])]
            value = age_bracket(customer, today) if field == 'age' else str(customer.get(field) or '').strip().lower()
            if value in labels:
                buckets[value].append(row)
        sections.append({'key': field, 'title': title,
                         'groups': [_group(key, label, buckets[key], True) for key, label in labels.items() if buckets.get(key)]})

    slots = defaultdict(list)
    weekdays = defaultdict(list)
    for row in scoped:
        placed = parse_when(row.get('created_at'))
        if not placed:
            continue
        for key, label, start, end in TIME_SLOTS:
            if start <= placed.hour < end:
                slots[key].append(row)
        weekdays[placed.weekday()].append(row)
    sections.append({'key': 'time', 'title': 'By time of day',
                     'groups': [_group(key, label, slots[key]) for key, label, _, _ in TIME_SLOTS if slots.get(key)]})
    sections.append({'key': 'weekday', 'title': 'By day of week',
                     'groups': [_group(str(index), WEEKDAYS[index], weekdays[index]) for index in range(7) if weekdays.get(index)]})
    if not branch:
        per_branch = defaultdict(list)
        names = {}
        for row in scoped:
            per_branch[branch_key(row)].append(row)
            names[branch_key(row)] = branch_label(row)
        sections.append({'key': 'branch', 'title': 'By branch',
                         'groups': [_group(key or 'none', names[key], value) for key, value in sorted(per_branch.items(), key=lambda kv: -len(kv[1]))]})
    return {
        'days': days, 'branch': branch or '', 'timezone': 'Asia/Manila',
        'orders': len(scoped), 'top_items': top_items(scoped, 5),
        'member_orders': len(members), 'linked_member_orders': len(linked),
        'member_coverage_percent': round(len(members) / len(scoped) * 100, 1) if scoped else None,
        'privacy': {'min_group_orders': MIN_GROUP_ORDERS, 'min_group_members': MIN_GROUP_MEMBERS},
        'notes': [
            'Age range, gender and occupation come only from loyalty cards connected on the menu.',
            'Customer city is not collected, so there is no location breakdown.',
        ],
        'sections': _finish_sections(sections),
    }


# ---------------------------------------------------------------- periods ---

PERIODS = {'today': 'Today', 'week': 'This week', 'month': 'This month', '3months': 'Last 3 months'}
PERIOD_ALIASES = {'1d': 'today', '7d': 'week', '30d': 'month', '90d': '3months', 'this_week': 'week',
                  'this_month': 'month', '3m': '3months', 'quarter': '3months'}


def normalize_period(value):
    key = str(value or '').strip().lower()
    key = PERIOD_ALIASES.get(key, key)
    return key if key in PERIODS else ''


def _shift_months(day, months):
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def period_days(period, today):
    """(start, end, previous_start, previous_end) as Manila dates; end is exclusive.

    The previous period covers the same number of elapsed days, so "This month"
    on Nov 21 is compared with Oct 1-21, not with all of October.
    """
    period = normalize_period(period) or 'month'
    end = today + timedelta(days=1)
    if period == 'today':
        return today, end, today - timedelta(days=1), today
    if period == 'week':
        start = today - timedelta(days=today.weekday())
        return start, end, start - timedelta(days=7), end - timedelta(days=7)
    start = today.replace(day=1) if period == 'month' else _shift_months(today.replace(day=1), -2)
    months = 1 if period == 'month' else 3
    previous_start = _shift_months(start, -months)
    previous_end = min(_shift_months(today, -months) + timedelta(days=1), start)
    return start, end, previous_start, previous_end


def manila_range_bounds(start_day, end_day):
    start = datetime.combine(start_day, dtime.min, tzinfo=MANILA)
    end = datetime.combine(end_day, dtime.min, tzinfo=MANILA)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def split_period(rows, start_day, previous_end=None):
    """Rows from one read of previous+current period -> (current, previous).

    Rows between previous_end and start_day (not the same elapsed days) are left out.
    """
    current, previous = [], []
    for row in rows:
        placed = parse_when(row.get('created_at'))
        if placed is None:
            continue
        if placed.date() >= start_day:
            current.append(row)
        elif previous_end is None or placed.date() < previous_end:
            previous.append(row)
    return current, previous


def kpis(rows):
    live = [row for row in rows if row.get('status') != 'cancelled']
    sales = round(sum(_money(row.get('total')) for row in live), 2)
    members = sum(1 for row in live if row.get('member_customer_public_id'))
    return {'sales': sales, 'orders': len(live), 'avg_order': round(sales / len(live), 2) if live else 0.0,
            'members_percent': round(members / len(live) * 100, 1) if live else 0.0}


def _change(now, before):
    if not before:
        return None
    return round((now - before) / before * 100, 1)


def kpi_changes(current, previous):
    """Percent change per KPI; members is the change in percentage points. None = no earlier data."""
    return {
        'sales': _change(current['sales'], previous['sales']),
        'orders': _change(current['orders'], previous['orders']),
        'avg_order': _change(current['avg_order'], previous['avg_order']),
        'members_percent': round(current['members_percent'] - previous['members_percent'], 1) if previous['orders'] else None,
    }


def _hour_label(hour):
    suffix = 'AM' if hour < 12 else 'PM'
    return f"{(hour % 12) or 12} {suffix}"


def sales_trend(rows, period, start_day, today):
    """Bars for the chart: hours for today, days for week/month, weeks for 3 months."""
    period = normalize_period(period) or 'month'
    live = [row for row in rows if row.get('status') != 'cancelled']
    placed = [(parse_when(row.get('created_at')), _money(row.get('total'))) for row in live]
    placed = [(when, amount) for when, amount in placed if when is not None]
    buckets = []
    if period == 'today':
        hours = [when.hour for when, _ in placed]
        first, last = (min(hours + [9]), max(hours + [18])) if hours else (9, 18)
        for hour in range(first, last + 1):
            hits = [amount for when, amount in placed if when.hour == hour]
            buckets.append({'label': _hour_label(hour), 'key': f'{hour:02d}', 'orders': len(hits), 'sales': round(sum(hits), 2)})
        return 'hour', buckets
    if period == '3months':
        week = start_day - timedelta(days=start_day.weekday())
        while week <= today:
            stop = week + timedelta(days=7)
            hits = [amount for when, amount in placed if week <= when.date() < stop]
            buckets.append({'label': f"{week.strftime('%b')} {week.day}", 'key': week.isoformat(), 'orders': len(hits), 'sales': round(sum(hits), 2)})
            week = stop
        return 'week', buckets
    day = start_day
    while day <= today:
        hits = [amount for when, amount in placed if when.date() == day]
        label = WEEKDAYS[day.weekday()][:3] if period == 'week' else str(day.day)
        buckets.append({'label': label, 'key': day.isoformat(), 'orders': len(hits), 'sales': round(sum(hits), 2)})
        day += timedelta(days=1)
    return 'day', buckets


def ranked_items(rows, limit=10):
    """Top items with quantity and pesos (line totals as saved on the order)."""
    quantity, sales = Counter(), Counter()
    for row in rows:
        if row.get('status') == 'cancelled':
            continue
        for item in row.get('items') or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get('item_name') or item.get('name') or 'Item').strip() or 'Item'
            try:
                qty = max(1, int(item.get('quantity') or 1))
            except (TypeError, ValueError):
                qty = 1
            quantity[name] += qty
            sales[name] += _money(item.get('line_total'))
    ordered = sorted(quantity.items(), key=lambda kv: (-kv[1], -sales[kv[0]], kv[0]))[:limit]
    return [{'name': name, 'quantity': qty, 'sales': round(sales[name], 2)} for name, qty in ordered]


def period_report(rows, previous_rows, customers, period, today, branch=''):
    """Everything the Analytics screen needs for one period and (optional) branch."""
    period = normalize_period(period) or 'month'
    start, end, previous_start, previous_end = period_days(period, today)
    scoped = filter_branch(rows, branch)
    earlier = filter_branch(previous_rows, branch)
    report = order_insights(rows, customers, today, branch, (end - start).days)
    current, before = kpis(scoped), kpis(earlier)
    unit, trend = sales_trend(scoped, period, start, today)
    report.update({
        'period': period, 'period_label': PERIODS[period],
        'start': start.isoformat(), 'end': (end - timedelta(days=1)).isoformat(),
        'previous_start': previous_start.isoformat(), 'previous_end': (previous_end - timedelta(days=1)).isoformat(),
        'kpis': current, 'previous': before, 'change': kpi_changes(current, before),
        'trend_unit': unit, 'trend': trend, 'top_items': ranked_items(scoped, 10),
    })
    return report


def cash_awaiting_payment(row):
    """A cash order the cashier has not confirmed yet. It must not be prepared."""
    return bool(row) and str(row.get('payment_method') or '') == 'cash' and str(row.get('payment_status') or '') == 'unpaid'


def read_customers(db, business_id, public_ids):
    ids = sorted({str(value) for value in public_ids if value})
    found = []
    columns = ['public_id', 'created_at', 'age_bracket', 'age', 'birthday', 'gender', 'occupation']
    for start in range(0, len(ids), 100):
        chunk = ids[start:start + 100]
        while True:
            try:
                found.extend(db.table('customers').select(','.join(columns)).eq('business_id', business_id)
                             .in_('public_id', chunk).execute().data or [])
                break
            except Exception as exc:
                field = missing_column(exc, [c for c in columns if c not in ('public_id', 'created_at')])
                if not field:
                    raise
                columns.remove(field)
    return found



# ----------------------------------------------------------------- report ---

PAYMENT_STATUS_LABELS = {'paid': 'Paid', 'paid_test': 'Paid (test)', 'unpaid': 'Waiting for payment'}
ORDER_STATUS_LABELS = {'new': 'New', 'preparing': 'Preparing', 'ready': 'Ready', 'completed': 'Completed', 'cancelled': 'Cancelled'}
REPORT_SECTIONS = ('membership', 'tenure', 'age', 'gender', 'occupation', 'time', 'branch')


def _clock(when):
    return f"{(when.hour % 12) or 12}:{when.minute:02d} {'AM' if when.hour < 12 else 'PM'}"


def _day_label(day):
    return f"{day.strftime('%a, %b')} {day.day}, {day.year}"


def _peso(value):
    return f"\u20b1{_money(value):,.2f}"


def _customer_label(row):
    name = ' '.join(str(row.get('buyer_name') or '').split())[:120]
    if not name or name.lower() == 'customer':
        return 'Member' if row.get('member_customer_public_id') else 'Walk-in'
    return name


def _item_text(row):
    return '; '.join(f"{name} x{qty}" for name, qty in _items(row))


def _file_part(text):
    return re.sub(r'[^a-z0-9]+', '-', str(text or '').lower()).strip('-')[:40]


def report_filename(business_name, branch_name, start_day, end_day):
    parts = [_file_part(business_name) or 'loyaltytree', _file_part(branch_name) or 'all-branches', 'sales', start_day.isoformat()]
    if end_day != start_day:
        parts.append('to-' + end_day.isoformat())
    return '-'.join(parts) + '.csv'


def sales_report(rows, customers, start_day, end_day, branch='', business_name='', branch_name='', generated_at=None):
    """A sales report the owner can send to staff: totals, every order, top items, who bought what.

    start_day/end_day are inclusive Manila dates. Demographic groups use the same
    privacy rule as the Analytics screen (small groups are hidden). No phone or email.
    Returns {'csv', 'text', 'filename', ...}.
    """
    generated_at = (generated_at or datetime.now(MANILA)).astimezone(MANILA)
    scoped = sorted(filter_branch(rows, branch), key=lambda row: str(row.get('created_at') or ''))
    live = [row for row in scoped if row.get('status') != 'cancelled']
    cancelled = [row for row in scoped if row.get('status') == 'cancelled']
    sales = round(sum(_money(row.get('total')) for row in live), 2)
    payments = payment_breakdown(live)
    unpaid_cash = [row for row in live if cash_awaiting_payment(row)]
    members = [row for row in live if row.get('member_customer_public_id')]
    insights = order_insights(scoped, customers, end_day, branch, (end_day - start_day).days + 1)
    items = ranked_items(scoped, 20)
    scope_label = branch_name or ('All branches' if not branch else 'Branch')
    when_label = _day_label(start_day) if start_day == end_day else f"{_day_label(start_day)} to {_day_label(end_day)}"

    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(['LoyaltyTree sales report'])
    w.writerow(['Business', business_name or 'Your business'])
    w.writerow(['Branch', scope_label])
    w.writerow(['Date', when_label])
    w.writerow(['Generated', f"{_day_label(generated_at.date())} {_clock(generated_at)} PHT"])
    w.writerow(['Source', 'Digital menu orders, Manila time (PHT)'])
    w.writerow([])
    w.writerow(['SUMMARY'])
    w.writerow(['Total sales (PHP)', f"{sales:.2f}"])
    w.writerow(['Orders', len(live)])
    w.writerow(['Average order (PHP)', f"{(sales / len(live) if live else 0):.2f}"])
    w.writerow(['Dine in', sum(1 for row in live if row.get('service') == 'dine-in')])
    w.writerow(['Pickup', sum(1 for row in live if row.get('service') != 'dine-in')])
    w.writerow(['Card members', len(members)])
    w.writerow(['Walk-ins', len(live) - len(members)])
    w.writerow(['Paid orders', payments['paid']['orders'], f"{payments['paid']['sales']:.2f}"])
    w.writerow(['Cash waiting for payment', len(unpaid_cash), f"{sum(_money(r.get('total')) for r in unpaid_cash):.2f}"])
    w.writerow(['Cancelled (not in sales)', len(cancelled), f"{sum(_money(r.get('total')) for r in cancelled):.2f}"])
    w.writerow([])
    w.writerow(['BY PAYMENT METHOD', 'Orders', 'Sales (PHP)'])
    for method in payments['by_method']:
        w.writerow([method['label'], method['orders'], f"{method['sales']:.2f}"])
    if not payments['by_method']:
        w.writerow(['No orders'])
    if not branch:
        per_branch = defaultdict(lambda: [0, 0.0])
        names = {}
        for row in live:
            names[branch_key(row)] = branch_label(row)
            per_branch[branch_key(row)][0] += 1
            per_branch[branch_key(row)][1] += _money(row.get('total'))
        if len(per_branch) > 1:
            w.writerow([])
            w.writerow(['BY BRANCH', 'Orders', 'Sales (PHP)'])
            for key, (count, amount) in sorted(per_branch.items(), key=lambda kv: -kv[1][1]):
                w.writerow([names[key], count, f"{amount:.2f}"])
    w.writerow([])
    w.writerow(['ORDERS'])
    w.writerow(['Order no.', 'Date', 'Time', 'Branch', 'Customer', 'Card member', 'Service', 'Items', 'Total (PHP)', 'Payment', 'Payment status', 'Order status'])
    for row in scoped:
        placed = parse_when(row.get('created_at'))
        method = str(row.get('payment_method') or '')
        w.writerow([
            row.get('order_number') or '', placed.date().isoformat() if placed else '', _clock(placed) if placed else '',
            branch_label(row), _customer_label(row), 'Yes' if row.get('member_customer_public_id') else 'No',
            'Dine in' if row.get('service') == 'dine-in' else 'Pickup', _item_text(row), f"{_money(row.get('total')):.2f}",
            PAYMENT_METHODS.get(method, 'Not recorded'),
            PAYMENT_STATUS_LABELS.get(str(row.get('payment_status') or ''), 'Paid' if not row.get('payment_status') else str(row.get('payment_status'))),
            ORDER_STATUS_LABELS.get(str(row.get('status') or 'new'), str(row.get('status') or '')),
        ])
    if not scoped:
        w.writerow(['No orders for this date.'])
    w.writerow([])
    w.writerow(['TOP ITEMS', 'Qty', 'Sales (PHP)'])
    for item in items:
        w.writerow([item['name'], item['quantity'], f"{item['sales']:.2f}"])
    if not items:
        w.writerow(['No items sold'])
    w.writerow([])
    w.writerow(['WHO BOUGHT WHAT', 'Group', 'Orders', 'Share %', 'Bought most'])
    sections = {section['key']: section for section in insights['sections']}
    for key in REPORT_SECTIONS:
        section = sections.get(key)
        if not section:
            continue
        groups = section.get('groups') or []
        if not groups:
            w.writerow([section['title'], 'No card data for this date'])
            continue
        for group in groups:
            if not group['orders']:
                continue
            if group['hidden']:
                # Counts are hidden too, so a small group can't be matched to a name in ORDERS.
                w.writerow([section['title'], group['label'], '', '',
                            f"Hidden for privacy (needs {MIN_GROUP_ORDERS}+ orders from {MIN_GROUP_MEMBERS}+ people)"])
                continue
            most = ', '.join(f"{item['name']} x{item['quantity']}" for item in group['top_items']) or '-'
            w.writerow([section['title'], group['label'], group['orders'], group['share_percent'], most])
    w.writerow([])
    w.writerow(['Notes'])
    w.writerow(['Age range, gender and occupation come only from loyalty cards connected on the menu.'])
    w.writerow(['Small groups are hidden so one customer cannot be identified. Weekly or monthly reports show more groups.'])
    w.writerow(['Phone numbers and emails are not included.'])

    lines = [f"{business_name or 'LoyaltyTree'} · {scope_label}", f"Sales report · {when_label}",
             f"Sales {_peso(sales)} · {len(live)} {'order' if len(live) == 1 else 'orders'}"
             + (f" · Avg {_peso(sales / len(live))}" if live else '')]
    if unpaid_cash:
        lines.append(f"Cash waiting for payment: {len(unpaid_cash)} ({_peso(sum(_money(r.get('total')) for r in unpaid_cash))})")
    if cancelled:
        lines.append(f"Cancelled: {len(cancelled)}")
    if items:
        lines.append('Top: ' + ', '.join(f"{item['name']} x{item['quantity']}" for item in items[:3]))
    lines.append('Full details are in the attached file.')
    return {
        'csv': out.getvalue(), 'text': '\n'.join(lines),
        'filename': report_filename(business_name, branch_name if branch else '', start_day, end_day),
        'start': start_day.isoformat(), 'end': end_day.isoformat(), 'branch': branch or '',
        'orders': len(live), 'sales': sales, 'cancelled': len(cancelled),
    }


def _branch_name(db, business_id, branch, rows):
    if not branch:
        return ''
    for row in rows:
        if branch_key(row) == branch and str(row.get('branch_name') or '').strip():
            return str(row.get('branch_name')).strip()
    try:
        found = (db.table('branches').select('public_id,name').eq('business_id', business_id)
                 .eq('public_id', branch).limit(1).execute().data or [])
    except Exception:
        found = []
    return str((found[0].get('name') if found else '') or 'Branch')


def register_menu_order_insight_routes(app, *, db, get_business, require_owner, friendly_error=str, operator=None):
    def business_for(public_id, authorization):
        require_owner(public_id, authorization)
        business = get_business(public_id)
        if not business:
            raise HTTPException(status_code=404, detail='Business not found')
        return business

    def scoped_for(public_id, authorization, branch, allow):
        """Owner sees any branch. Managers and cashiers are held to their own branch."""
        if operator is None:
            return business_for(public_id, authorization), str(branch or '').strip(), None
        business, scope = operator(public_id, authorization, allow=allow)
        return business, scoped_branch(scope, branch), scope

    @app.get('/api/v1/business/{public_id}/menu-orders/summary')
    def menu_orders_summary(public_id: str, date: str = '', branch: str = '', period: str = '', authorization: str = Header(default='')):
        business, branch, _ = scoped_for(public_id, authorization, branch, ('owner', 'manager'))
        chosen = normalize_period(period)
        if chosen and not date:
            start_day, end_day, _, _ = period_days(chosen, datetime.now(MANILA).date())
            start, end = manila_range_bounds(start_day, end_day)
            try:
                rows = read_orders(db, business['id'], start, end)
            except Exception as exc:
                raise HTTPException(status_code=503, detail=f'Menu orders are not ready yet: {friendly_error(exc)}')
            summary = daily_summary(rows, start_day, branch.strip())
            summary.update({'period': chosen, 'period_label': PERIODS[chosen], 'start': start_day.isoformat(),
                            'end': (end_day - timedelta(days=1)).isoformat()})
            return summary
        try:
            day = datetime.strptime(date, '%Y-%m-%d').date() if date else datetime.now(MANILA).date()
        except ValueError:
            raise HTTPException(status_code=400, detail='Use a date like 2026-11-21.')
        start, end = manila_day_bounds(day)
        try:
            rows = read_orders(db, business['id'], start, end)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f'Menu orders are not ready yet: {friendly_error(exc)}')
        return daily_summary(rows, day, branch.strip())

    @app.get('/api/v1/business/{public_id}/menu-orders/report')
    def menu_orders_report(public_id: str, date: str = '', branch: str = '', period: str = '', format: str = 'csv',
                           authorization: str = Header(default='')):
        """Download a sales report: one day (default today, Manila) or this week / this month."""
        business, branch, _ = scoped_for(public_id, authorization, branch, ('owner', 'manager'))
        today = datetime.now(MANILA).date()
        chosen = normalize_period(period)
        if chosen and not date:
            start_day, end_day, _, _ = period_days(chosen, today)
            end_day = end_day - timedelta(days=1)
        else:
            try:
                start_day = end_day = datetime.strptime(date, '%Y-%m-%d').date() if date else today
            except ValueError:
                raise HTTPException(status_code=400, detail='Use a date like 2026-11-21.')
        since, until = manila_range_bounds(start_day, end_day + timedelta(days=1))
        branch = branch.strip()
        try:
            rows = read_orders(db, business['id'], since, until)
            customers = read_customers(db, business['id'], [row.get('member_customer_public_id') for row in filter_branch(rows, branch)])
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f'Menu orders are not ready yet: {friendly_error(exc)}')
        report = sales_report(rows, customers, start_day, end_day, branch,
                              str(business.get('name') or ''), _branch_name(db, business['id'], branch, rows))
        if str(format or '').lower() == 'json':
            return report
        return Response(content=('\ufeff' + report['csv']).encode('utf-8'), media_type='text/csv; charset=utf-8',
                        headers={'Content-Disposition': f'attachment; filename="{report["filename"]}"', 'Cache-Control': 'no-store'})

    @app.patch('/api/v1/business/{public_id}/menu-orders/{order_public_id}/payment')
    def menu_order_mark_paid(public_id: str, order_public_id: str, expected_amount: str = '', authorization: str = Header(default='')):
        """Owner, manager or cashier confirms a cash order was paid at the counter (own branch only for staff)."""
        business, _, scope = scoped_for(public_id, authorization, '', ('owner', 'manager', 'cashier'))
        row = read_counter_order(db, business, scope, order_public_id)
        if row.get('payment_method') != 'cash':
            if row.get('payment_status') in PAID_STATUSES:
                return {'success': True, 'payment_status': row['payment_status']}
            raise HTTPException(409, 'Only cash can be confirmed at the counter.')
        try:
            amount = Decimal(expected_amount)
            if not amount.is_finite() or amount < 0 or amount > Decimal('1000000000') or amount != amount.quantize(Decimal('0.01')):
                raise ValueError()
        except (InvalidOperation, ValueError):
            raise HTTPException(400, 'Confirm the exact displayed order amount.')
        result = transition_counter_order(db, business, scope, row, 'paid', expected_amount=str(amount))
        return {'success': True, 'payment_status': result['order']['payment_status']}

    @app.get('/api/v1/business/{public_id}/menu-orders/customer-pulse')
    def menu_orders_customer_pulse(public_id: str, days: int = 30, branch: str = '',
                                   product_id: str = '', weekday: int = -1, hour: int = -1,
                                   authorization: str = Header(default='')):
        """Private, real purchase aggregates; never expose customer identities."""
        business = business_for(public_id, authorization)
        if not (1 <= days <= 90):
            raise HTTPException(status_code=400, detail='Days must be between 1 and 90.')
        if weekday not in (-1, 0, 1, 2, 3, 4, 5, 6) or hour not in range(-1, 24):
            raise HTTPException(status_code=400, detail='Invalid day or hour filter.')
        since = datetime.now(timezone.utc) - timedelta(days=days)
        try:
            rows = read_orders(db, business['id'], since)
            scoped = filter_branch(rows, branch.strip())
            customers = read_customers(db, business['id'], [r.get('member_customer_public_id') for r in scoped])
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f'Could not load purchase analytics: {friendly_error(exc)}')
        try:
            from .menu_customer_pulse_v192 import customer_pulse
        except ImportError:
            from menu_customer_pulse_v192 import customer_pulse
        report = customer_pulse(scoped, customers, days=days, branch=branch.strip(),
                                product_id=product_id.strip()[:80],
                                weekday=None if weekday == -1 else weekday,
                                hour=None if hour == -1 else hour,
                                today=datetime.now(MANILA).date())
        report['limited_to_max_orders'] = len(rows) >= MAX_ROWS
        if report['limited_to_max_orders']:
            report['notes'].append('Reporting source reached its row limit; reduce the date window for complete results.')
        return report

    @app.get('/api/v1/business/{public_id}/menu-orders/insights')
    def menu_orders_insights(public_id: str, days: int = 30, branch: str = '', period: str = '', authorization: str = Header(default='')):
        business = business_for(public_id, authorization)
        chosen = normalize_period(period)
        if chosen:
            today = datetime.now(MANILA).date()
            start_day, end_day, previous_start, previous_end = period_days(chosen, today)
            since, until = manila_range_bounds(previous_start, end_day)
            try:
                rows = read_orders(db, business['id'], since, until)
                current, previous = split_period(rows, start_day, previous_end)
                customers = read_customers(db, business['id'], [row.get('member_customer_public_id') for row in current])
            except Exception as exc:
                raise HTTPException(status_code=503, detail=f'Menu orders are not ready yet: {friendly_error(exc)}')
            return period_report(current, previous, customers, chosen, today, branch.strip())
        days = max(1, min(365, int(days or 30)))
        today = datetime.now(MANILA).date()
        since = datetime.now(timezone.utc) - timedelta(days=days)
        try:
            rows = read_orders(db, business['id'], since)
            customers = read_customers(db, business['id'], [row.get('member_customer_public_id') for row in rows])
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f'Menu orders are not ready yet: {friendly_error(exc)}')
        return order_insights(rows, customers, today, branch.strip(), days)
