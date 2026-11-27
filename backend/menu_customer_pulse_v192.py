"""Owner-only customer pulse calculations for real digital-menu orders.

No customer identities leave this helper. Demographic cells are suppressed for
small samples and use only explicitly linked loyalty-card demographics.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

MANILA = ZoneInfo('Asia/Manila')
MIN_AUDIENCE_ORDERS = 5
MIN_AUDIENCE_CUSTOMERS = 5
WEEKDAYS = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')


def _time(value):
    try:
        stamp = datetime.fromisoformat(str(value or '').replace('Z', '+00:00'))
        return (stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)).astimezone(MANILA)
    except (ValueError, TypeError):
        return None


def _money(value):
    try:
        return max(0., float(value or 0))
    except (TypeError, ValueError):
        return 0.


def _lines(order):
    for item in order.get('items') or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get('item_name') or item.get('name') or 'Unnamed item').strip()
        key = str(item.get('item_id') or item.get('public_id') or name)
        try:
            qty = max(1, min(1000, int(item.get('quantity') or 1)))
        except (TypeError, ValueError):
            qty = 1
        yield key, name, qty


def _audience(rows, customers, product_id='', weekday=None, hour=None, today=None):
    from datetime import date
    try:
        from .customer_demographics import AGE_LABELS, GENDER_LABELS, OCCUPATION_LABELS, age_bracket
    except ImportError:
        from customer_demographics import AGE_LABELS, GENDER_LABELS, OCCUPATION_LABELS, age_bracket

    today = today or datetime.now(MANILA).date()
    buyers = {str(c.get('public_id')): c for c in customers if c.get('public_id')}
    matched = []
    for order in rows:
        when = _time(order.get('created_at'))
        if not when or (weekday is not None and when.weekday() != weekday) or (hour is not None and when.hour != hour):
            continue
        if product_id and not any(key == product_id for key, _, _ in _lines(order)):
            continue
        buyer = str(order.get('member_customer_public_id') or '')
        if buyer in buyers:
            matched.append((buyer, buyers[buyer]))
    unique = {key for key, _ in matched}
    result = {
        'linked_orders': None, 'linked_buyers': None,
        'available': len(matched) >= MIN_AUDIENCE_ORDERS and len(unique) >= MIN_AUDIENCE_CUSTOMERS,
        'age': [], 'gender': [], 'occupation': [],
        'min_orders': MIN_AUDIENCE_ORDERS, 'min_buyers': MIN_AUDIENCE_CUSTOMERS,
        'note': 'Voluntary demographics of loyalty-card-linked buyers only; small groups are suppressed.',
    }
    if not result['available']:
        return result
    result['linked_orders'] = len(matched)
    result['linked_buyers'] = len(unique)
    for name, labels in [('age', AGE_LABELS), ('gender', GENDER_LABELS), ('occupation', OCCUPATION_LABELS)]:
        samples = defaultdict(list)
        for buyer, customer in matched:
            value = age_bracket(customer, today) if name == 'age' else str(customer.get(name) or '').lower().strip()
            if value in labels:
                samples[value].append(buyer)
        # Do not expose small cell counts, even if a selected product/time is narrow.
        result[name] = [
            {'key': key, 'label': label, 'orders': len(samples[key]), 'buyers': len(set(samples[key]))}
            for key, label in labels.items()
            if len(samples[key]) >= MIN_AUDIENCE_ORDERS and len(set(samples[key])) >= MIN_AUDIENCE_CUSTOMERS
        ]
    return result


def purchase_frequency(rows):
    """Count distinct paid bills, not add-on rows, for linked buyers.

    Only explicitly recorded cash payments enter spending metrics until
    verified online payment settlement is available. No identities returned.
    """
    buyers = defaultdict(lambda: {'bills': set(), 'spend': 0.0})
    for row in rows:
        if row.get('status') == 'cancelled' or row.get('payment_status') != 'paid' or row.get('payment_method') != 'cash':
            continue
        buyer = str(row.get('member_customer_public_id') or '').strip()
        root = str(row.get('parent_order_public_id') or row.get('public_id') or '').strip()
        if not buyer or not root:
            continue
        entry = buyers[buyer]
        entry['bills'].add((str(row.get('branch_public_id') or ''), root))
        entry['spend'] += _money(row.get('total'))
    count = len(buyers)
    repeat = sum(len(entry['bills']) > 1 for entry in buyers.values())
    return {
        'linked_buyers': count,
        'repeat_buyers': repeat,
        'single_bill_buyers': count - repeat,
        'repeat_buyer_percent': round(100 * repeat / count, 1) if count else None,
        'average_bills_per_buyer': round(sum(len(entry['bills']) for entry in buyers.values()) / count, 2) if count else None,
        'average_cash_spend_per_buyer': round(sum(entry['spend'] for entry in buyers.values()) / count, 2) if count else None,
        'source': 'cash_confirmed_linked_orders_in_selected_period',
    }


def customer_pulse(rows, customers, *, days=30, branch='', product_id='', weekday=None, hour=None, today=None):
    """Aggregate paid digital-menu orders, product/hour metrics and private cohorts.

    No totals from unpaid, test-paid, or cancelled orders enter financial KPIs.
    Table/day means one table number at one branch on one calendar date, not a
    table visit (a table may have multiple seatings in a single day).
    """
    paid = [r for r in rows if r.get('status') != 'cancelled' and
            r.get('payment_status') == 'paid' and (not branch or str(r.get('branch_public_id') or '') == branch)]
    hourly = defaultdict(lambda: {'orders': 0, 'sales': 0.})
    by_product = defaultdict(lambda: {'name': '', 'orders': 0, 'quantity': 0})
    by_product_hour = defaultdict(lambda: {'orders': 0, 'quantity': 0})
    linked_spend = defaultdict(float)
    table_days = defaultdict(float)
    table_visits = defaultdict(float)
    guest_total = 0
    guest_spend = 0.0
    session_guest_counts = {}
    session_guest_sales = defaultdict(float)
    timed = 0
    for row in paid:
        when = _time(row.get('created_at'))
        if not when:
            continue
        timed += 1
        amount = _money(row.get('total'))
        cell = hourly[(when.weekday(), when.hour)]
        cell['orders'] += 1
        cell['sales'] += amount
        buyer = str(row.get('member_customer_public_id') or '').strip()
        if buyer:
            linked_spend[buyer] += amount
        try:
            guests = int(row.get('guest_count') or 0)
        except (TypeError, ValueError):
            guests = 0
        session_id = str(row.get('table_session_id') or '').strip()
        if session_id:
            session_key = (str(row.get('branch_public_id') or ''), session_id)
            session_guest_sales[session_key] += amount
            if 0 < guests <= 100:
                session_guest_counts[session_key] = max(guests, session_guest_counts.get(session_key, 0))
        elif 0 < guests <= 100:
            # A one-off order with its own guest_count but no seating ID.
            guest_total += guests
            guest_spend += amount
        if str(row.get('service') or '').lower().replace('_', '-') in {'dine-in', 'dinein'}:
            table = str(row.get('table_no') or '').strip()
            if table:
                key = (str(row.get('branch_public_id') or ''), when.date().isoformat(), table)
                table_days[key] += amount
                if session_id:
                    table_visits[(str(row.get('branch_public_id') or ''), session_id)] += amount
        unique_items = set()
        for key, name, quantity in _lines(row):
            product = by_product[key]
            product['name'] = name
            product['quantity'] += quantity
            group = by_product_hour[(key, when.weekday(), when.hour)]
            group['quantity'] += quantity
            if key not in unique_items:
                product['orders'] += 1
                group['orders'] += 1
                unique_items.add(key)

    guest_total += sum(session_guest_counts.values())
    guest_spend += sum(session_guest_sales[k] for k in session_guest_counts)
    total = sum(_money(r.get('total')) for r in paid)
    products = [{'id': key, **value} for key, value in by_product.items()]
    products.sort(key=lambda p: (-p['quantity'], -p['orders'], p['name']))
    product_windows = []
    for (key, day, h), value in by_product_hour.items():
        if product_id and key != product_id:
            continue
        if weekday is not None and day != weekday:
            continue
        if hour is not None and h != hour:
            continue
        product_windows.append({'product_id': key, 'product': by_product[key]['name'], 'weekday': day,
                                'day': WEEKDAYS[day], 'hour': h, **value})
    product_windows.sort(key=lambda p: (-p['quantity'], p['weekday'], p['hour'], p['product']))
    hours = [{'hour': h, 'orders': sum(hourly[(d, h)]['orders'] for d in range(7)),
              'sales': round(sum(hourly[(d, h)]['sales'] for d in range(7)), 2)} for h in range(24)]
    weekday_hours = [{'weekday': d, 'day': WEEKDAYS[d], 'hours': [
        {'hour': h, 'orders': hourly[(d, h)]['orders'], 'sales': round(hourly[(d, h)]['sales'], 2)}
        for h in range(24) if hourly[(d, h)]['orders'] > 0
    ]} for d in range(7)]
    return {
        'days': days, 'timezone': 'Asia/Manila', 'source': 'confirmed_paid_digital_menu_orders',
        'branch': branch, 'summary': {
            'paid_orders': len(paid), 'sales': round(total, 2),
            'average_order_value': round(total / len(paid), 2) if paid else None,
            'average_per_linked_buyer': round(sum(linked_spend.values()) / len(linked_spend), 2) if linked_spend else None,
            'linked_buyers': len(linked_spend), 'guest_count_available': guest_total > 0,
            'average_per_guest': round(guest_spend / guest_total, 2) if guest_total else None,
            'average_per_table_visit': round(sum(table_visits.values()) / len(table_visits), 2) if table_visits else None,
            'average_per_table_day': round(sum(table_days.values()) / len(table_days), 2) if table_days else None,
            'table_days': len(table_days), 'table_visits': len(table_visits),
            'orders_with_valid_time': timed,
        },
        'purchase_frequency': purchase_frequency(paid),
        'hourly': hours, 'weekday_hours': weekday_hours,
        'products': products[:100], 'product_hours': product_windows[:100],
        'audience': _audience(paid, customers, product_id, weekday, hour, today),
        'filters': {'product_id': product_id, 'weekday': weekday, 'hour': hour},
        'notes': [
            'Sales include confirmed paid digital-menu orders only (not unpaid, cancelled, or mock payments).',
            'Average per linked buyer is per known loyalty identity, not per guest.',
            'Average per table-day groups table numbers by branch and day; it is not a table visit metric.',
            'Per guest and per seating require recorded guest_count and table_session_id; unavailable when not supplied.',
            'Demographic cohorts include only loyalty-linked orders with supplied demographics; small groups are hidden.',
            'This report does not automatically include offline or POS purchases.',
            'Purchase frequency counts distinct linked cash-paid bills in the selected period, not lifetime visits. Unlinked add-ons are not attributed to a buyer.',
        ]
    }
