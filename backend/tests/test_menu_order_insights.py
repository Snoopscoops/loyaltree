from datetime import date, datetime, timezone
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.menu_order_insights import (
    daily_summary, insert_order, manila_day_bounds, member_from_card_token, missing_column,
    order_insights, payment_breakdown, payment_fields, register_menu_order_insight_routes, resolve_branch, top_items,
    cash_awaiting_payment, kpi_changes, kpis, normalize_period, period_days, period_report, ranked_items, sales_trend, split_period,
    report_filename, sales_report, product_buyer_insights,
)


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters = db, table, []

    def select(self, *_):
        return self

    def eq(self, field, value):
        self.filters.append(('eq', field, value)); return self

    def gte(self, field, value):
        self.filters.append(('gte', field, value)); return self

    def lt(self, field, value):
        self.filters.append(('lt', field, value)); return self

    def in_(self, field, values):
        self.filters.append(('in', field, list(values))); return self

    def order(self, *_, **__):
        return self

    def limit(self, *_):
        return self

    def range(self, start, end):
        self.start, self.end = start, end; return self

    def insert(self, row):
        self.row = row; return self

    def update(self, values):
        self.values = values; return self

    def execute(self):
        if hasattr(self, 'values'):
            hits = [r for r in self.db.rows.get(self.table, []) if all(r.get(f) == v for k, f, v in self.filters if k == 'eq')]
            for r in hits:
                r.update(self.values)
            return Result(hits)
        if hasattr(self, 'row'):
            missing = [c for c in self.row if c in self.db.missing]
            if missing:
                raise Exception(f"Could not find the '{missing[0]}' column of 'menu_counter_orders' in the schema cache")
            self.db.inserted.append(self.row)
            return Result([self.row])
        rows = list(self.db.rows.get(self.table, []))
        for kind, field, value in self.filters:
            if kind == 'eq':
                rows = [r for r in rows if r.get(field) == value]
            elif kind == 'in':
                rows = [r for r in rows if r.get(field) in value]
            elif kind == 'gte':
                rows = [r for r in rows if r.get(field, '') >= value]
            elif kind == 'lt':
                rows = [r for r in rows if r.get(field, '') < value]
        return Result(rows)


class DB:
    def __init__(self, rows=None, missing=()):
        self.rows, self.missing, self.inserted = rows or {}, set(missing), []

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        assert name == 'menu_transition_counter_order'
        assert params['p_target'] == 'paid'
        row = next(row for row in self.rows['menu_counter_orders']
                   if row['business_id'] == params['p_business_id']
                   and row['public_id'] == params['p_order_public_id']
                   and row.get('branch_public_id', '') == params['p_branch'])
        assert params['p_expected_amount'] == str(row['total'])
        row['payment_status'] = 'paid'
        return type('RPC', (), {'execute': lambda _: Result({'order': row})})()


def order(n, at, total=100, status='new', service='dine-in', branch='', branch_name='', member='', items=(('Latte', 1),)):
    return {'public_id': f'o{n}', 'business_id': 1, 'order_number': f'LT-{n}', 'status': status, 'service': service,
            'total': total, 'created_at': at, 'branch_public_id': branch, 'branch_name': branch_name,
            'member_customer_public_id': member, 'items': [{'item_name': name, 'quantity': qty} for name, qty in items]}


class WriteTests(unittest.TestCase):
    def test_insert_drops_optional_columns_until_migration_runs(self):
        db = DB(missing={'branch_public_id', 'branch_name', 'member_customer_public_id'})
        saved, dropped = insert_order(db, {'order_number': 'LT-1', 'branch_public_id': 'bgc', 'branch_name': 'BGC', 'member_customer_public_id': 'c1'})
        self.assertEqual(sorted(dropped), ['branch_name', 'branch_public_id', 'member_customer_public_id'])
        self.assertEqual(db.inserted, [{'order_number': 'LT-1'}])
        db = DB()
        saved, dropped = insert_order(db, {'order_number': 'LT-2', 'branch_public_id': 'bgc'})
        self.assertEqual((dropped, saved['branch_public_id']), ([], 'bgc'))

    def test_other_insert_errors_are_not_swallowed(self):
        class Broken(DB):
            def table(self, name):
                raise RuntimeError('connection refused')
        with self.assertRaises(RuntimeError):
            insert_order(Broken(), {'order_number': 'x'})
        self.assertIsNone(missing_column(Exception('duplicate key'), ['branch_name']))

    def test_branch_must_belong_to_the_business(self):
        db = DB({'branches': [{'business_id': 1, 'public_id': 'bgc', 'name': 'BGC', 'is_active': True},
                              {'business_id': 2, 'public_id': 'other', 'name': 'Other', 'is_active': True},
                              {'business_id': 1, 'public_id': 'closed', 'name': 'Closed', 'is_active': False}]})
        self.assertEqual(resolve_branch(db, 1, 'bgc'), ('bgc', 'BGC'))
        self.assertEqual(resolve_branch(db, 1, ''), ('', ''))
        for bad in ('other', 'closed', 'nope'):
            with self.assertRaises(HTTPException) as caught:
                resolve_branch(db, 1, bad)
            self.assertEqual(caught.exception.status_code, 400)

    def test_card_token_links_a_member_only_for_this_business(self):
        def read(token, kind):
            if token == 'bad':
                raise HTTPException(401, 'expired')
            return {'business_public_id': token.split(':')[0], 'customer_public_id': 'cust1', 'kind': kind}
        self.assertEqual(member_from_card_token('biz:ok', 'biz', read), 'cust1')
        self.assertEqual(member_from_card_token('other:ok', 'biz', read), '')
        self.assertEqual(member_from_card_token('bad', 'biz', read), '')
        self.assertEqual(member_from_card_token('', 'biz', read), '')


class SummaryTests(unittest.TestCase):
    def test_manila_day_bounds(self):
        start, end = manila_day_bounds(date(2026, 11, 21))
        self.assertEqual(start.isoformat(), '2026-11-20T16:00:00+00:00')
        self.assertEqual(end.isoformat(), '2026-11-21T16:00:00+00:00')

    def test_daily_summary_counts_sales_services_cancelled_items_and_branches(self):
        rows = [
            order(1, '2026-11-21T01:00:00+00:00', 750, branch='bgc', branch_name='BGC', items=(('Mocha Matcha', 2), ('Latte', 1))),
            order(2, '2026-11-21T02:00:00+00:00', 160, service='pickup', branch='main', branch_name='Main', items=(('Latte', 2),)),
            order(3, '2026-11-21T03:00:00+00:00', 300, status='cancelled', branch='bgc', branch_name='BGC', items=(('Croissant', 9),)),
            order(4, '2026-11-21T04:00:00+00:00', 90, items=(('Croissant', 1),)),
        ]
        summary = daily_summary(rows, date(2026, 11, 21))
        self.assertEqual((summary['orders'], summary['sales'], summary['dine_in'], summary['pickup'], summary['cancelled']), (3, 1000.0, 2, 1, 1))
        self.assertEqual(summary['top_items'], [{'name': 'Latte', 'quantity': 3}, {'name': 'Mocha Matcha', 'quantity': 2}, {'name': 'Croissant', 'quantity': 1}])
        branches = {b['name']: b for b in summary['branches']}
        self.assertEqual(branches['BGC'], {'public_id': 'bgc', 'name': 'BGC', 'orders': 1, 'sales': 750.0, 'cancelled': 1})
        self.assertEqual(branches['Before branches']['orders'], 1)
        bgc = daily_summary(rows, date(2026, 11, 21), 'bgc')
        self.assertEqual((bgc['orders'], bgc['sales'], bgc['cancelled']), (1, 750.0, 1))


class InsightTests(unittest.TestCase):
    def test_demographics_come_only_from_linked_cards_and_small_groups_are_hidden(self):
        customers = [{'public_id': f'c{i}', 'created_at': '2025-01-01T00:00:00+00:00', 'age_bracket': '25_34', 'gender': 'female'} for i in range(4)]
        customers.append({'public_id': 'solo', 'created_at': '2026-11-15T00:00:00+00:00', 'age_bracket': '45_54', 'gender': 'male'})
        rows = [order(i, f'2026-11-20T0{i}:30:00+00:00', member=f'c{i % 4}', items=(('Spanish Latte', 1),)) for i in range(6)]
        rows.append(order(10, '2026-11-20T10:00:00+00:00', member='solo', items=(('Ube Pandesal', 3),)))
        rows.append(order(11, '2026-11-20T11:00:00+00:00', items=(('Americano', 1),)))
        report = order_insights(rows, customers, date(2026, 11, 21))
        sections = {s['key']: s for s in report['sections']}
        age = {g['key']: g for g in sections['age']['groups']}
        self.assertEqual(age['25_34']['top_items'], [{'name': 'Spanish Latte', 'quantity': 6}])
        self.assertFalse(age['25_34']['hidden'])
        self.assertTrue(age['45_54']['hidden'])
        self.assertEqual(age['45_54']['top_items'], [])
        self.assertNotIn('city', sections)
        walk = {g['key']: g for g in sections['membership']['groups']}['walk_ins']
        self.assertEqual(walk['top_items'], [{'name': 'Americano', 'quantity': 1}])
        tenure = {g['key']: g for g in sections['tenure']['groups']}
        self.assertEqual((tenure['returning']['orders'], tenure['new']['orders']), (6, 1))
        self.assertEqual(report['member_orders'], 7)
        self.assertEqual(top_items([]), [])

    def test_unknown_values_are_not_invented(self):
        rows = [order(i, '2026-11-20T01:00:00+00:00', member='c1') for i in range(6)]
        report = order_insights(rows, [{'public_id': 'c1', 'created_at': '2025-01-01T00:00:00+00:00', 'gender': '', 'age_bracket': None}], date(2026, 11, 21))
        sections = {s['key']: s for s in report['sections']}
        self.assertEqual(sections['age']['groups'], [])
        self.assertEqual(sections['gender']['groups'], [])


class RouteTests(unittest.TestCase):
    def setUp(self):
        today = datetime.now(timezone.utc).isoformat()
        self.db = DB({'menu_counter_orders': [order(1, today, 200, branch='bgc', branch_name='BGC')], 'customers': []})
        app = FastAPI()
        def owner(public_id, authorization):
            if authorization != 'Bearer ok':
                raise HTTPException(401, 'Owner authentication required')
        register_menu_order_insight_routes(app, db=self.db, get_business=lambda pid: {'id': 1, 'public_id': pid}, require_owner=owner)
        self.client = TestClient(app)

    def test_summary_and_insights_need_the_owner(self):
        self.assertEqual(self.client.get('/api/v1/business/biz/menu-orders/summary').status_code, 401)
        body = self.client.get('/api/v1/business/biz/menu-orders/summary', headers={'Authorization': 'Bearer ok'}).json()
        self.assertEqual(body['timezone'], 'Asia/Manila')
        self.assertEqual(self.client.get('/api/v1/business/biz/menu-orders/summary?date=nope', headers={'Authorization': 'Bearer ok'}).status_code, 400)
        insights = self.client.get('/api/v1/business/biz/menu-orders/insights?days=7&branch=bgc', headers={'Authorization': 'Bearer ok'}).json()
        self.assertEqual(insights['orders'], 1)
        report = self.client.get('/api/v1/business/biz/menu-orders/insights?period=today', headers={'Authorization': 'Bearer ok'}).json()
        self.assertEqual((report['period'], report['kpis']['orders'], report['kpis']['sales']), ('today', 1, 200.0))
        self.assertEqual(report['trend_unit'], 'hour')
        week = self.client.get('/api/v1/business/biz/menu-orders/summary?period=week', headers={'Authorization': 'Bearer ok'}).json()
        self.assertEqual((week['period'], week['orders']), ('week', 1))


class PaymentTests(unittest.TestCase):
    def test_status_comes_from_the_method_not_the_browser(self):
        self.assertEqual(payment_fields('cash'), ('cash', 'unpaid'))
        self.assertEqual(payment_fields('QRPH'), ('qrph', 'paid_test'))
        self.assertEqual(payment_fields('card'), ('card', 'paid_test'))
        self.assertEqual(payment_fields(''), ('', 'paid'))
        self.assertEqual(payment_fields('bitcoin'), ('', 'paid'))

    def test_breakdown_by_method_and_paid_vs_unpaid(self):
        rows = [dict(order(1, 'x', 100), payment_method='cash', payment_status='unpaid'),
                dict(order(2, 'x', 250), payment_method='qrph', payment_status='paid_test'),
                dict(order(3, 'x', 50), payment_method='cash', payment_status='paid'),
                dict(order(4, 'x', 80), payment_status='paid')]
        result = payment_breakdown(rows)
        methods = {m['method']: m for m in result['by_method']}
        self.assertEqual((methods['cash']['orders'], methods['cash']['sales']), (2, 150.0))
        self.assertEqual(methods['qrph']['sales'], 250.0)
        self.assertEqual(methods['other']['orders'], 1)
        self.assertNotIn('card', methods)
        self.assertEqual(result['paid'], {'orders': 3, 'sales': 380.0})
        self.assertEqual(result['unpaid'], {'orders': 1, 'sales': 100.0})
        self.assertIn('payments', daily_summary(rows, date(2026, 11, 21)))

    def test_owner_marks_a_cash_order_paid(self):
        today = datetime.now(timezone.utc).isoformat()
        db = DB({'menu_counter_orders': [dict(order(1, today, 100), payment_method='cash', payment_status='unpaid')]})
        app = FastAPI()
        def owner(public_id, authorization):
            if authorization != 'Bearer ok':
                raise HTTPException(401, 'no')
        register_menu_order_insight_routes(app, db=db, get_business=lambda pid: {'id': 1}, require_owner=owner)
        client = TestClient(app)
        self.assertEqual(client.patch('/api/v1/business/b/menu-orders/o1/payment').status_code, 401)
        self.assertEqual(client.patch('/api/v1/business/b/menu-orders/nope/payment', headers={'Authorization': 'Bearer ok'}).status_code, 404)
        body = client.patch('/api/v1/business/b/menu-orders/o1/payment?expected_amount=100', headers={'Authorization': 'Bearer ok'}).json()
        self.assertEqual(body['payment_status'], 'paid')
        self.assertEqual(db.rows['menu_counter_orders'][0]['payment_status'], 'paid')

    def test_owner_marks_legacy_null_branch_cash_order_paid(self):
        db = DB({'menu_counter_orders': [dict(order(1, ''), payment_method='cash', payment_status='unpaid',
                                                branch_public_id=None)]})
        app = FastAPI()
        register_menu_order_insight_routes(app, db=db, get_business=lambda _: {'id': 1}, require_owner=lambda *_: None)
        response = TestClient(app).patch('/api/v1/business/b/menu-orders/o1/payment?expected_amount=100')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['payment_status'], 'paid')


class PeriodTests(unittest.TestCase):
    def test_periods_use_manila_calendar_and_same_elapsed_days(self):
        today = date(2026, 11, 21)  # a Saturday
        self.assertEqual(normalize_period('30d'), 'month')
        self.assertEqual(normalize_period('nope'), '')
        self.assertEqual(period_days('today', today), (today, date(2026, 11, 22), date(2026, 11, 20), today))
        self.assertEqual(period_days('week', today), (date(2026, 11, 16), date(2026, 11, 22), date(2026, 11, 9), date(2026, 11, 15)))
        self.assertEqual(period_days('month', today), (date(2026, 11, 1), date(2026, 11, 22), date(2026, 10, 1), date(2026, 10, 22)))
        self.assertEqual(period_days('3months', today), (date(2026, 9, 1), date(2026, 11, 22), date(2026, 6, 1), date(2026, 8, 22)))
        self.assertEqual(period_days('6months', today), (date(2026, 6, 1), date(2026, 11, 22), date(2025, 12, 1), date(2026, 5, 22)))
        # March 31 compares with Feb 1-28, never past the period start.
        self.assertEqual(period_days('month', date(2027, 3, 31))[2:], (date(2027, 2, 1), date(2027, 3, 1)))

    def test_kpis_changes_trend_and_ranked_items(self):
        rows = [
            order(1, '2026-11-20T02:00:00+00:00', 100, member='c1'),
            order(2, '2026-11-21T03:00:00+00:00', 300, items=(('Mocha Matcha', 2),)),
            order(3, '2026-11-21T04:00:00+00:00', 999, status='cancelled'),
        ]
        rows[1]['items'][0]['line_total'] = 300
        current = kpis(rows)
        self.assertEqual(current, {'sales': 400.0, 'orders': 2, 'avg_order': 200.0, 'members_percent': 50.0})
        change = kpi_changes(current, {'sales': 200.0, 'orders': 4, 'avg_order': 50.0, 'members_percent': 25.0})
        self.assertEqual(change, {'sales': 100.0, 'orders': -50.0, 'avg_order': 300.0, 'members_percent': 25.0})
        self.assertIsNone(kpi_changes(current, kpis([]))['sales'])
        unit, bars = sales_trend(rows, 'week', date(2026, 11, 16), date(2026, 11, 21))
        self.assertEqual(unit, 'day')
        self.assertEqual([b['label'] for b in bars], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
        self.assertEqual(bars[-1]['sales'], 300.0)
        unit, bars = sales_trend(rows, '3months', date(2026, 9, 1), date(2026, 11, 21))
        self.assertEqual(unit, 'week')
        self.assertEqual(bars[0]['label'], 'Aug 31')
        self.assertEqual(sum(b['orders'] for b in bars), 2)
        self.assertEqual(ranked_items(rows)[0], {'name': 'Mocha Matcha', 'quantity': 2, 'sales': 300.0})

    def test_report_shares_top_item_and_split(self):
        rows = [order(i, '2026-11-0%dT03:00:00+00:00' % (i % 9 + 1), 100, member=f'c{i % 3}', items=(('Spanish Latte', 1),)) for i in range(6)]
        customers = [{'public_id': f'c{i}', 'created_at': '2025-01-01T00:00:00+00:00', 'age_bracket': '25_34'} for i in range(3)]
        report = period_report(rows, [], customers, 'month', date(2026, 11, 21))
        self.assertEqual(report['period_label'], 'This month')
        self.assertIsNone(report['change']['sales'])
        age = next(s for s in report['sections'] if s['key'] == 'age')
        self.assertEqual(age['groups'][0]['top_item'], 'Spanish Latte')
        self.assertEqual(age['groups'][0]['share_percent'], 100.0)
        self.assertEqual(age['hidden_groups'], 0)
        gender = next(s for s in report['sections'] if s['key'] == 'gender')
        self.assertTrue(gender['empty'])
        branch = next(s for s in report['sections'] if s['key'] == 'branch')
        self.assertEqual(branch['groups'][0]['label'], 'Before branches')
        current, previous = split_period([order(1, '2026-10-05T03:00:00+00:00'), order(2, '2026-10-28T03:00:00+00:00'),
                                          order(3, '2026-11-02T03:00:00+00:00')], date(2026, 11, 1), date(2026, 10, 22))
        self.assertEqual(([r['public_id'] for r in current], [r['public_id'] for r in previous]), (['o3'], ['o1']))

    def test_cash_orders_wait_for_payment(self):
        self.assertTrue(cash_awaiting_payment({'payment_method': 'cash', 'payment_status': 'unpaid'}))
        self.assertFalse(cash_awaiting_payment({'payment_method': 'cash', 'payment_status': 'paid'}))
        self.assertFalse(cash_awaiting_payment({'payment_method': 'qrph', 'payment_status': 'paid_test'}))
        self.assertFalse(cash_awaiting_payment(None))
        source = open(__file__.replace('tests/test_menu_order_insights.py', 'main.py'), encoding='utf-8').read()
        route = source[source.index('async def owner_update_menu_order_status'):source.index("@app.get('/api/v1/business/{public_id}/order-ahead/orders')")]
        self.assertIn('_menu_order_cash_unpaid(current_order)', route)
        self.assertIn('status_code=409', route)


class MainSourceTests(unittest.TestCase):
    def test_order_route_saves_branch_and_member_and_ttl_is_untouched(self):
        source = open(__file__.replace('tests/test_menu_order_insights.py', 'main.py'), encoding='utf-8').read()
        route = source[source.index("async def public_place_menu_order"):source.index("def _menu_counter_order_public")]
        for needle in ("payload.get('branch_public_id')", "payload.get('card_token')", "'branch_name': branch_name",
                       "'member_customer_public_id': member_customer_public_id", '_menu_order_insert(supabase, row)'):
            self.assertIn(needle, route)
        public = source[source.index("def _menu_counter_order_public"):source.index("@app.get('/api/v1/business/{public_id}/menu-orders')")]
        self.assertIn("'branch': {'public_id': row.get('branch_public_id') or '', 'name': row.get('branch_name') or ''}", public)
        self.assertIn("'payment_method': row.get('payment_method') or ''", public)
        self.assertIn("'payment_status': payment_status", route)
        self.assertIn("STAFF_SESSION_TTL_HOURS", source)
        staff = source[source.index('async def get_staff('):source.index('@app.get("/api/v1/business/{public_id}/staff/stamp-counts")')]
        self.assertIn('row["branch_public_id"]', staff)


if __name__ == '__main__':
    unittest.main()


class ReportTests(unittest.TestCase):
    def rows(self):
        return [
            dict(order(1, '2026-11-21T01:05:00+00:00', 250, branch='bgc', branch_name='BGC', member='c1', items=(('Spanish Latte', 2),)),
                 buyer_name='Ana Cruz', payment_method='qrph', payment_status='paid_test', phone='09171234567'),
            dict(order(2, '2026-11-21T05:30:00+00:00', 120, service='pickup', branch='main', branch_name='Main', items=(('Americano', 1),)),
                 buyer_name='Customer', payment_method='cash', payment_status='unpaid'),
            dict(order(3, '2026-11-21T06:00:00+00:00', 90, status='cancelled', branch='bgc', branch_name='BGC'), buyer_name='Ben'),
        ]

    def test_report_has_header_totals_orders_items_and_groups(self):
        customers = [{'public_id': 'c1', 'created_at': '2025-01-01T00:00:00+00:00', 'age_bracket': '25_34', 'gender': 'female'}]
        made = datetime(2026, 11, 21, 18, 5, tzinfo=timezone.utc)
        report = sales_report(self.rows(), customers, date(2026, 11, 21), date(2026, 11, 21), '', 'Mirah Krey', '', made)
        text = report['csv']
        self.assertIn('Business,Mirah Krey', text)
        self.assertIn('Branch,All branches', text)
        self.assertIn('Date,"Sat, Nov 21, 2026"', text)
        self.assertIn('Generated,"Sun, Nov 22, 2026 2:05 AM PHT"', text)
        self.assertIn('Total sales (PHP),370.00', text)
        self.assertIn('Cash waiting for payment,1,120.00', text)
        self.assertIn('Cancelled (not in sales),1,90.00', text)
        self.assertIn('LT-1,2026-11-21,9:05 AM,BGC,Ana Cruz,Yes,Dine in,Spanish Latte x2,250.00,GCash / Maya / Bank (QR Ph),Paid (test),New', text)
        self.assertIn('LT-2,2026-11-21,1:30 PM,Main,Walk-in,No,Pickup,Americano x1,120.00,Cash,Waiting for payment,New', text)
        self.assertIn('BY BRANCH', text)
        self.assertIn('Spanish Latte,2,0.00', text)
        # One member: the age group is listed but its items are hidden for privacy.
        self.assertIn('By age range,', text)
        self.assertIn('Hidden for privacy', text)
        self.assertNotIn('0917', text)
        self.assertEqual(report['filename'], 'mirah-krey-all-branches-sales-2026-11-21.csv')
        self.assertIn('Sales \u20b1370.00 · 2 orders', report['text'])
        self.assertIn('Cash waiting for payment: 1', report['text'])

    def test_branch_report_and_filename(self):
        report = sales_report(self.rows(), [], date(2026, 11, 21), date(2026, 11, 21), 'bgc', 'Mirah Krey', 'BGC')
        self.assertEqual((report['orders'], report['sales'], report['cancelled']), (1, 250.0, 1))
        self.assertNotIn('Americano', report['csv'])
        self.assertNotIn('BY BRANCH', report['csv'])
        self.assertEqual(report['filename'], 'mirah-krey-bgc-sales-2026-11-21.csv')
        self.assertEqual(report_filename('', '', date(2026, 11, 1), date(2026, 11, 21)), 'loyaltytree-all-branches-sales-2026-11-01-to-2026-11-21.csv')
        empty = sales_report([], [], date(2026, 11, 21), date(2026, 11, 21))
        self.assertIn('No orders for this date.', empty['csv'])

    def test_report_route_needs_owner_and_returns_csv_or_json(self):
        today = datetime.now(timezone.utc).isoformat()
        db = DB({'menu_counter_orders': [dict(order(1, today, 200, branch='bgc', branch_name='BGC'), buyer_name='Ana')], 'customers': [],
                 'branches': [{'business_id': 1, 'public_id': 'bgc', 'name': 'BGC'}]})
        app = FastAPI()
        def owner(public_id, authorization):
            if authorization != 'Bearer ok':
                raise HTTPException(401, 'no')
        register_menu_order_insight_routes(app, db=db, get_business=lambda pid: {'id': 1, 'public_id': pid, 'name': 'Mirah Krey'}, require_owner=owner)
        client = TestClient(app)
        auth = {'Authorization': 'Bearer ok'}
        self.assertEqual(client.get('/api/v1/business/b/menu-orders/report').status_code, 401)
        self.assertEqual(client.get('/api/v1/business/b/menu-orders/report?date=nope', headers=auth).status_code, 400)
        response = client.get('/api/v1/business/b/menu-orders/report', headers=auth)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers['content-type'].startswith('text/csv'))
        self.assertIn('attachment; filename="mirah-krey-all-branches-sales-', response.headers['content-disposition'])
        self.assertTrue(response.content.startswith('\ufeff'.encode('utf-8')))
        body = client.get('/api/v1/business/b/menu-orders/report?format=json&branch=bgc', headers=auth).json()
        self.assertEqual((body['orders'], body['sales']), (1, 200.0))
        self.assertTrue(body['filename'].startswith('mirah-krey-bgc-sales-'))
        self.assertIn('Ana', body['csv'])
        week = client.get('/api/v1/business/b/menu-orders/report?format=json&period=week', headers=auth).json()
        self.assertEqual(week['orders'], 1)
        self.assertLessEqual(week['start'], week['end'])


class ProductBuyerTests(unittest.TestCase):
    def test_paid_item_counts_and_small_group_privacy(self):
        customers = [{'public_id': f'm{i}', 'gender': 'female'} for i in range(3)]
        customers.append({'public_id': 'single', 'gender': 'male'})
        rows = [dict(order(i, '2026-11-21T03:00:00+00:00', member=f'm{i % 3}', items=(('Latte', 2), ('Latte', 1))), payment_status='paid') for i in range(5)]
        rows += [dict(order(10+i, '2026-11-21T03:00:00+00:00', member='single'), payment_status='paid') for i in range(5)]
        rows.append(dict(order(20, '2026-11-21T03:00:00+00:00', member='single'), payment_status='unpaid'))
        rows.append(dict(order(21, '2026-11-21T03:00:00+00:00', status='cancelled', member='single'), payment_status='paid'))
        product = product_buyer_insights(rows, customers, date(2026, 11, 21))[0]
        self.assertEqual(product['quantity'], 20)
        self.assertEqual(product['orders'], 10)
        self.assertEqual(len(product['groups']), 1)
        self.assertEqual(product['groups'][0]['orders'], 5)
        self.assertEqual(product['hidden_groups'], 1)
