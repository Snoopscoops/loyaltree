from datetime import date, datetime, timedelta, timezone

try:
    from backend.menu_customer_pulse_v192 import customer_pulse
except ImportError:
    from menu_customer_pulse_v192 import customer_pulse


def order(number, *, item='Coffee', item_id='coffee-uuid', time='2026-11-20T07:00:00+00:00',
          amount=200, status='completed', pay='paid', buyer='', branch='A', service='dine-in', table='4'):
    return {'order_number': str(number), 'created_at': time, 'status': status, 'payment_status': pay,
            'total': amount, 'member_customer_public_id': buyer, 'branch_public_id': branch,
            'service': service, 'table_no': table,
            'items': [{'item_id': item_id, 'item_name': item, 'quantity': 1, 'line_total': amount}]}


def test_money_only_confirmed_paid_and_not_test_or_cancelled():
    rows = [order(1), order(2, pay='paid_test'), order(3, pay='unpaid'), order(4, status='cancelled')]
    result = customer_pulse(rows, [], today=date(2026, 11, 20))
    assert result['summary']['paid_orders'] == 1
    assert result['summary']['sales'] == 200
    assert result['summary']['average_order_value'] == 200
    assert result['summary']['average_per_guest'] is None
    assert result['summary']['average_per_table_visit'] is None


def test_product_hour_weekday_and_table_day_are_separate():
    # 7AM UTC = 3PM Manila, Friday. Two orders at same table/day are one table-day.
    rows = [order(1), order(2, amount=100, buyer='x'), order(3, item='Tea', item_id='tea',
            time='2026-11-20T09:00:00+00:00', amount=60, table='5')]
    result = customer_pulse(rows, [], product_id='coffee-uuid', weekday=4, hour=15)
    assert result['summary']['average_per_table_day'] == 180
    assert result['summary']['table_days'] == 2
    assert result['hourly'][15]['orders'] == 2
    assert result['weekday_hours'][4]['hours'][0]['hour'] == 15
    assert len(result['product_hours']) == 1
    assert result['product_hours'][0]['quantity'] == 2
    assert result['product_hours'][0]['product'] == 'Coffee'


def test_small_demographic_cohorts_suppressed():
    customers = [{'public_id': f'{i}', 'gender': 'female', 'age_bracket': '25-34'} for i in range(2)]
    rows = [order(i, buyer=str(i % 2)) for i in range(10)]
    result = customer_pulse(rows, customers, product_id='coffee-uuid')
    assert not result['audience']['available']
    assert result['audience']['age'] == []
    assert result['audience']['gender'] == []


def test_cross_filters_do_not_leak_small_hourly_demographics():
    customers = [{'public_id': f'{i}', 'gender': 'female', 'age_bracket': '25-34'} for i in range(5)]
    rows = [order(i, buyer=str(i)) for i in range(5)]
    all_day = customer_pulse(rows, customers, product_id='coffee-uuid', hour=15)
    assert all_day['audience']['available']
    restricted = customer_pulse(rows, customers, product_id='coffee-uuid', hour=14)
    assert not restricted['audience']['available']


def test_average_linked_buyer_is_not_cost_per_guest():
    rows = [order(1, buyer='a', amount=300), order(2, buyer='a', amount=100),
            order(3, buyer='b', amount=200)]
    report = customer_pulse(rows, [])
    assert report['summary']['average_per_linked_buyer'] == 300
    assert report['summary']['average_order_value'] == 200
    assert report['summary']['average_per_guest'] is None


def test_real_guest_and_table_session_fields_enable_precise_metrics_when_present():
    rows = [order(1, amount=300), order(2, amount=200)]
    rows[0]['guest_count'] = 3
    rows[1]['guest_count'] = 2
    rows[0]['table_session_id'] = 'visit-a'
    rows[1]['table_session_id'] = 'visit-a'
    data = customer_pulse(rows, [])
    assert data['summary']['average_per_guest'] == 166.67
    assert data['summary']['average_per_table_visit'] == 500
    assert data['summary']['table_visits'] == 1


def test_product_hour_uses_local_manila_time_and_branch_filter():
    rows = [order(1, branch='A'), order(2, branch='B')]
    data = customer_pulse(rows, [], branch='A', weekday=4, hour=15)
    assert data['summary']['paid_orders'] == 1
    assert data['hourly'][15]['orders'] == 1
    assert data['product_hours'][0]['weekday'] == 4
    assert data['product_hours'][0]['hour'] == 15


def test_no_data_is_not_fabricated_as_guest_or_table_spending():
    data = customer_pulse([], [])
    assert data['summary']['paid_orders'] == 0
    assert data['summary']['average_order_value'] is None
    assert data['summary']['average_per_guest'] is None
    assert data['summary']['average_per_table_visit'] is None
    assert data['products'] == []
    assert data['audience']['age'] == []


def test_two_orders_same_table_session_do_not_double_count_guests():
    rows = [order(1, amount=300), order(2, amount=200)]
    for row in rows:
        row['guest_count'] = 2
        row['table_session_id'] = 'same-seating'
    result = customer_pulse(rows, [])
    assert result['summary']['average_per_guest'] == 250
    assert result['summary']['average_per_table_visit'] == 500
