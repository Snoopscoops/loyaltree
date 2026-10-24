"""Dashboard metrics regressions; no startup, network, DB or customer data."""
import ast
import asyncio
from collections import defaultdict
from datetime import datetime, timezone, date
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from fastapi import HTTPException, Query, Header
from backend import owner_activity as activity


def parse_ts(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc).replace(tzinfo=None) if parsed.tzinfo else parsed
    except ValueError:
        return None


NOW = datetime(2026, 10, 17, 8, tzinfo=timezone.utc)
TZ = ZoneInfo('Asia/Manila')


class VisitMetricsTests(unittest.TestCase):
    def summary(self, customers, rows=None, ready=None, **kwargs):
        return activity.build_owner_activity(customers, rows or {}, ready or {},
            parse_ts=parse_ts, local_tz=TZ, now=NOW, **kwargs)

    def test_segments_are_exclusive_and_return_denominator_is_recorded_visitors(self):
        customers = [{'id': n, 'public_id': f'member-{n}', 'created_at': '2026-10-16'} for n in range(1, 6)]
        rows = [{'customer_id': 1, 'created_at': f'2026-10-{day:02}T02:00:00Z'} for day in (14, 15, 16)]
        rows += [{'customer_id': 2, 'created_at': f'2026-10-{day:02}T02:00:00Z'} for day in (15, 16)]
        rows += [{'customer_id': 3, 'created_at': '2026-10-16T02:00:00Z'},
                 {'customer_id': 5, 'created_at': '2026-08-01T02:00:00Z'}]
        result = self.summary(customers, {'stamp_events': rows}, {'2': True})
        self.assertEqual(result['total_customer_visits'], 7)
        self.assertEqual(result['return_rate'], 50)  # 2 of 4 visitors, not 2 of 5 signups
        self.assertEqual(result['customer_segments'], {'regulars': 1, 'occasional': 1, 'first_time': 2, 'at_risk': 1})
        self.assertEqual(result['rewards_ready'], 1)
        self.assertTrue(result['customer_activity']['member-2']['rewards_ready'])
        self.assertEqual(result['customer_activity']['member-4']['visits'], 0)

    def test_local_days_merge_duplicate_taps_and_hybrid_engines(self):
        customer = {'id': 1, 'public_id': 'sample'}
        rows = {'stamp_events': [
            {'customer_id': 1, 'created_at': '2026-10-15T16:05:00Z'},
            {'customer_id': 1, 'created_at': '2026-10-16T15:00:00Z'},
            {'customer_id': 1, 'created_at': '2026-10-16T16:00:00Z'}],
            'points_events': [{'customer_id': 1, 'created_at': '2026-10-16T01:00:00Z'}]}
        result = self.summary([customer], rows)
        self.assertEqual(result['total_customer_visits'], 2)
        self.assertEqual(result['customer_activity']['sample']['segment'], 'occasional')

    def test_balances_redemption_adjustment_pack_issue_and_clockout_are_not_visits(self):
        customer = {'id': 1, 'public_id': 'sample', 'stamp_count': 500,
                    'points_balance': 1000, 'updated_at': '2026-10-17'}
        rows = {'vip_events': [{'customer_id': 1, 'action': 'tier_points_adjust', 'created_at': '2026-10-16'}],
                'multipass_events': [{'customer_id': 1, 'action': 'issued', 'created_at': '2026-10-16'}],
                'employee_attendance_events': [{'customer_id': 1, 'action': 'time_out', 'created_at': '2026-10-16'}]}
        result = self.summary([customer], rows)
        self.assertEqual(result['total_customer_visits'], 0)
        self.assertEqual(result['return_rate'], 0)

    def test_tier_sales_pack_usage_and_clockin_are_visits(self):
        rows = {'vip_events': [{'customer_id': 1, 'action': 'tier_points_sale', 'created_at': '2026-10-15'}],
                'multipass_events': [{'customer_id': 1, 'action': 'used', 'created_at': '2026-10-16'}],
                'employee_attendance_events': [{'customer_id': 1, 'action': 'time_in', 'created_at': '2026-10-17'}]}
        result = self.summary([{'id': 1, 'public_id': 'sample'}], rows)
        self.assertEqual(result['total_customer_visits'], 3)

    def test_membership_service_date_uses_staff_selected_local_date(self):
        result = activity.build_owner_activity([{'id': 1, 'public_id': 'sample'}], {
            'membership_events': [{'customer_id': 1, 'service_date': '2026-10-16', 'created_at': '2026-10-17T01:00:00Z'}],
            'points_events': [{'customer_id': 1, 'created_at': '2026-10-16T20:00:00Z'}],
        }, {}, parse_ts=parse_ts, local_tz=ZoneInfo('America/New_York'), now=NOW)
        self.assertEqual(result['total_customer_visits'], 1)

    def test_program_scope_bad_timestamps_future_dates_and_pii(self):
        result = self.summary([{'id': 1, 'public_id': 'sample', 'name': 'Fictional Name',
                                'email': 'fictional@example.invalid', 'phone': '000'}], {'stamp_events': [
            {'customer_id': 2, 'created_at': '2026-10-16'},
            {'customer_id': 1, 'created_at': 'garbage'},
            {'customer_id': 1, 'created_at': '2026-10-18'},
        ]}, {'2': True})
        self.assertEqual(result['total_customer_visits'], 0)
        self.assertEqual(result['rewards_ready'], 0)
        self.assertNotIn('Fictional', str(result))
        self.assertNotIn('fictional@example', str(result))

    def test_churn_threshold_takes_precedence_over_regular_frequency(self):
        rows = {'stamp_events': [{'customer_id': 1, 'created_at': f'2026-10-{day:02}'} for day in (1, 2, 3)]}
        result = self.summary([{'id': 1, 'public_id': 'sample'}], rows, churn_days=14)
        self.assertEqual(result['customer_activity']['sample']['segment'], 'at_risk')
        self.assertEqual(self.summary([{'id': 1, 'public_id': 'sample'}], rows, churn_days=15)['customer_activity']['sample']['segment'], 'regulars')

    def test_upstream_failure_is_unknown_instead_of_confirmed_zero(self):
        result = self.summary([{'id': 1, 'public_id': 'sample'}], activity_available=False, rewards_available=False)
        self.assertTrue(result['partial'])
        self.assertIsNone(result['total_customer_visits'])
        self.assertIsNone(result['return_rate'])
        self.assertIsNone(result['rewards_ready'])
        self.assertIsNone(result['customer_segments'])
        self.assertIsNone(result['customer_activity']['sample']['segment'])
        self.assertIsNone(result['customer_activity']['sample']['rewards_ready'])


class QueryFixture:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters = []
        self.start, self.end = 0, 999

    def select(self, columns):
        self.columns = columns
        return self

    def eq(self, field, value):
        self.filters.append((field, value))
        return self

    def in_(self, field, values):
        self.filters.append((field, set(map(str, values))))
        return self

    def order(self, _field):
        return self

    def range(self, start, end):
        self.start, self.end = start, end
        return self

    def execute(self):
        self.db.calls.append((self.table, self.filters, self.start, self.end))
        error = self.db.error.get(self.table) if isinstance(self.db.error, dict) else self.db.error
        if error:
            raise error
        rows = self.db.rows.get(self.table, [])
        for field, value in self.filters:
            rows = [row for row in rows if str(row.get(field)) in value] if isinstance(value, set) else [row for row in rows if row.get(field) == value]
        return SimpleNamespace(data=rows[self.start:self.end + 1])


class DatabaseFixture:
    def __init__(self, rows=None, error=None):
        self.rows, self.error, self.calls = rows or {}, error, []

    def table(self, name):
        return QueryFixture(self, name)


class VisitReadTests(unittest.TestCase):
    def setUp(self):
        activity._CACHE.clear()

    def test_scope_pagination_cache_and_invalidation(self):
        rows = [{'id': n, 'business_id': 1, 'customer_id': 10, 'created_at': '2026-10-16'} for n in range(1001)]
        rows += [{'id': 1002, 'business_id': 2, 'customer_id': 10}]
        db = DatabaseFixture({'stamp_events': rows})
        first, _, _ = activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        self.assertEqual(len(first['stamp_events']), 1001)
        self.assertEqual(len(db.calls), 2)
        self.assertIn(('business_id', 1), db.calls[0][1])
        self.assertIn(('customer_id', {'10'}), db.calls[0][1])
        activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        self.assertEqual(len(db.calls), 2)
        activity.invalidate_owner_activity(2)
        activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        self.assertEqual(len(db.calls), 2)
        activity.invalidate_owner_activity(1)
        activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        self.assertEqual(len(db.calls), 4)

    def test_failed_reads_are_never_cached_as_empty(self):
        db = DatabaseFixture(error=TimeoutError('read timeout'))
        with self.assertRaises(TimeoutError):
            activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        db.error = None
        db.rows['stamp_events'] = [{'business_id': 1, 'customer_id': 10}]
        result, _, _ = activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        self.assertEqual(len(result['stamp_events']), 1)

    def test_large_scope_still_excludes_other_programs(self):
        db = DatabaseFixture({'stamp_events': [{'business_id': 1, 'customer_id': n} for n in range(302)]})
        rows, _, _ = activity.read_visit_rows(db, 1, list(range(301)), {'stamp_events'})
        self.assertEqual(len(rows['stamp_events']), 301)

    def test_optional_absent_ledger_is_partial_coverage_and_required_absence_fails(self):
        class MissingTable(Exception):
            code = '42P01'
        db = DatabaseFixture({'stamp_events': [{'business_id': 1, 'customer_id': 10}]},
                             {'employee_attendance_events': MissingTable('relation does not exist')})
        rows, _, missing = activity.read_visit_rows(db, 1, [10],
            {'stamp_events', 'employee_attendance_events'}, {'stamp_events'})
        self.assertEqual(len(rows['stamp_events']), 1)
        self.assertEqual(missing, ['employee_attendance_events'])
        with self.assertRaises(MissingTable):
            activity.read_visit_rows(db, 1, [10], {'employee_attendance_events'}, {'employee_attendance_events'})

    def test_optional_transport_or_permission_failures_are_not_treated_as_absent_tables(self):
        class NoPermission(Exception):
            code = '42501'
        for error in (TimeoutError('timeout'), NoPermission('permission denied')):
            with self.subTest(error=type(error).__name__), self.assertRaises(type(error)):
                activity.read_visit_rows(DatabaseFixture(error=error), 1, [10], {'employee_attendance_events'})

    def test_ttl_bounds_staleness_for_other_workers(self):
        db = DatabaseFixture()
        with patch.object(activity, 'monotonic', side_effect=[10, 11, 131]):
            activity.read_visit_rows(db, 1, [10], {'stamp_events'})
            activity.read_visit_rows(db, 1, [10], {'stamp_events'})
            activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        self.assertEqual(len(db.calls), 2)

    def test_mutation_during_read_cannot_repopulate_old_cache(self):
        db = DatabaseFixture()
        original = db.table
        def table(name):
            query = original(name)
            execute = query.execute
            def execute_with_mutation():
                activity.invalidate_owner_activity(1)
                return execute()
            query.execute = execute_with_mutation
            return query
        db.table = table
        activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        activity.read_visit_rows(db, 1, [10], {'stamp_events'})
        self.assertEqual(len(db.calls), 2)

    def test_customer_list_pages_beyond_postgrest_limit_without_losing_scope(self):
        rows = [{'id': n, 'business_id': 1, 'program_id': 2} for n in range(1001)]
        rows += [{'id': 1002, 'business_id': 1, 'program_id': 3}, {'id': 1003, 'business_id': 2, 'program_id': 2}]
        db = DatabaseFixture({'customers': rows})
        self.assertEqual(len(activity.read_customer_rows(db, 1, 2)), 1001)
        self.assertEqual(len(db.calls), 2)
        self.assertIn(('program_id', 2), db.calls[1][1])

    def test_rewards_are_read_fresh_and_skip_unused_stamp_ledger(self):
        db = DatabaseFixture({'coupons': [{'business_id': 1, 'customer_id': 10, 'status': 'active'}]})
        activity.read_reward_rows(db, 1, [10], False)
        db.rows['coupons'] = []
        coupons, _ = activity.read_reward_rows(db, 1, [10], False)
        self.assertEqual(coupons, [])
        self.assertEqual([call[0] for call in db.calls], ['coupons', 'coupons'])


SOURCE = Path(__file__).resolve().parents[1] / 'main.py'


def dashboard_namespace():
    names = {'_owner_dashboard_activity_stats', 'get_stats', 'get_stamp_rewards'}
    def scoped_owner(public_id, authorization):
        # Metric fixtures represent an already verified owner. Real HTTP auth
        # and cross-business denial are covered by the access-control suite.
        if public_id != 'sample-business' or authorization != 'Bearer fixture-owner':
            raise HTTPException(401, 'Synthetic owner session required')
        return {'role': 'owner', 'business_slug': public_id}
    env = dict(Optional=Optional, Query=Query, Header=Header, HTTPException=HTTPException, asyncio=asyncio,
        require_owner_session=MagicMock(side_effect=scoped_owner),
        defaultdict=defaultdict, build_owner_activity=activity.build_owner_activity,
        _parse_ts=parse_ts, LOYALTY_TIMEZONE=TZ, _loyalty_today=lambda: NOW.astimezone(TZ).date(),
        _date_only=lambda value: date.fromisoformat(str(value)[:10]) if value else None,
        _card_cycle_enabled=lambda row: row.get('card_expiration_enabled', False),
        _hybrid_expiry_enabled=lambda row, engine: row.get(f'hybrid_{engine}_expiration_enabled', False),
        program_reward_uses_stamps=lambda row: row.get('card_type') == 'stamp',
        program_reward_uses_points=lambda row: row.get('card_type') == 'points',
        program_has_membership=lambda row: row.get('card_type') in ('membership', 'hybrid'),
        program_has_tier=lambda row: row.get('card_type') == 'vip',
        program_is_employee_experience=lambda row: row.get('card_type') == 'employee',
        _get_retention_rule=lambda *args: {'days_threshold': 45},
        read_visit_rows=MagicMock(return_value=({}, NOW.isoformat(), [])),
        read_reward_rows=MagicMock(return_value=([], [])), read_customer_rows=activity.read_customer_rows,
        VISIT_TABLES=activity.VISIT_TABLES, log_event=MagicMock(), List=list)
    nodes = []
    for node in ast.parse(SOURCE.read_text()).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names:
            node.decorator_list = []
            nodes.append(node)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
    return env


class DashboardStatsTests(unittest.TestCase):
    def setUp(self):
        self.env = dashboard_namespace()
        self.env['supabase'] = DatabaseFixture()
        self.business = {'id': 1, 'public_id': 'sample-business'}

    def metrics(self, customers, programs):
        return self.env['_owner_dashboard_activity_stats'](self.business, customers, programs)

    def test_unclaimed_milestones_affordable_points_and_valid_coupons(self):
        programs = [{'id': 1, 'card_type': 'stamp', 'stamp_goal': 12},
                    {'id': 2, 'card_type': 'points', 'points_prizes': [{'name': 'Tea', 'points_cost': 40}]},
                    {'id': 3, 'card_type': 'membership'}]
        customers = [{'id': 1, 'public_id': 'one', 'program_id': 1, 'stamp_count': 12, 'card_cycle': 2},
                     {'id': 2, 'public_id': 'two', 'program_id': 2, 'points_balance': 40},
                     {'id': 3, 'public_id': 'three', 'program_id': 3, 'membership_status': 'active'},
                     {'id': 4, 'public_id': 'four', 'program_id': 1, 'stamp_count': 8}]
        self.env['read_reward_rows'].return_value = ([{'customer_id': 3, 'starts_at': '2026-10-17', 'expires_at': '2026-10-17'}],
            [{'customer_id': 1, 'milestone_id': 'legacy-final', 'card_cycle': 1}])
        result = self.metrics(customers, programs)
        self.assertEqual(result['rewards_ready'], 3)
        self.assertFalse(result['customer_activity']['four']['rewards_ready'])  # goal is 12, not hardcoded 8
        self.assertEqual(result['churn_days'], 45)
        self.assertEqual(self.env['read_visit_rows'].call_args.args[-2], activity.VISIT_TABLES)
        self.assertEqual(self.env['read_visit_rows'].call_args.args[-1], {'stamp_events', 'points_events', 'membership_events'})

    def test_claimed_expired_and_access_only_cards_are_not_reward_ready(self):
        programs = [{'id': 1, 'card_type': 'stamp', 'stamp_goal': 8},
                    {'id': 2, 'card_type': 'points', 'card_expiration_enabled': True,
                     'points_prizes': [{'name': 'Tea', 'points_cost': 40}]},
                    {'id': 3, 'card_type': 'membership'}, {'id': 4, 'card_type': 'multipass'}]
        customers = [{'id': 1, 'public_id': 'one', 'program_id': 1, 'stamp_count': 8, 'reward_unlocked': True},
                     {'id': 2, 'public_id': 'two', 'program_id': 2, 'points_balance': 99, 'card_expires_at': '2026-10-16'},
                     {'id': 3, 'public_id': 'three', 'program_id': 3, 'membership_status': 'active'},
                     {'id': 4, 'public_id': 'four', 'program_id': 4, 'multipass_sessions_remaining': 9}]
        self.env['read_reward_rows'].return_value = ([{'customer_id': 3, 'expires_at': '2026-10-16'},
            {'customer_id': 4, 'starts_at': '2026-10-18'}],
            [{'customer_id': 1, 'milestone_id': 'legacy-final', 'card_cycle': 1}])
        self.assertEqual(self.metrics(customers, programs)['rewards_ready'], 0)

    def test_optional_read_failure_keeps_other_metrics_and_logs_no_pii(self):
        self.env['read_visit_rows'].side_effect = TimeoutError('upstream timeout')
        result = self.metrics([{'id': 1, 'public_id': 'one', 'program_id': 1, 'stamp_count': 8}],
                              [{'id': 1, 'card_type': 'stamp', 'stamp_goal': 8}])
        self.assertIsNone(result['total_customer_visits'])
        self.assertEqual(result['rewards_ready'], 1)
        self.assertTrue(result['partial'])
        self.assertEqual(self.env['log_event'].call_args.args, ('dashboard_metrics_unavailable', 'warning'))
        self.assertEqual(set(self.env['log_event'].call_args.kwargs), {'business_slug', 'metric', 'endpoint', 'error_type'})

    def test_stats_retains_legacy_fields_and_program_scope(self):
        db = DatabaseFixture({'customers': [
            {'id': 1, 'business_id': 1, 'program_id': 2, 'stamp_count': 5},
            {'id': 2, 'business_id': 1, 'program_id': 3, 'stamp_count': 99}]})
        self.env.update(supabase=db, safe_get_business=lambda _: self.business,
            safe_get_loyalty_program=lambda *args, **kwargs: {'id': 2, 'card_type': 'stamp', 'stamp_goal': 5},
            _owner_dashboard_activity_stats=MagicMock(return_value={'total_customer_visits': 3}))
        result = asyncio.run(self.env['get_stats']('sample-business', 'program-two', authorization='Bearer fixture-owner'))
        self.assertEqual(result['total_customers'], 1)
        self.assertEqual(result['total_stamps'], 5)
        self.assertIn('unlocked_rewards', result)
        self.assertEqual(result['total_customer_visits'], 3)
        self.assertIn(('program_id', 2), db.calls[0][1])
        self.assertEqual(len(self.env['_owner_dashboard_activity_stats'].call_args.args[1]), 1)

    def test_unknown_program_remains_404(self):
        self.env.update(safe_get_business=lambda _: self.business, safe_get_loyalty_program=lambda *args, **kwargs: None)
        with self.assertRaises(HTTPException) as error:
            asyncio.run(self.env['get_stats']('sample-business', 'missing', authorization='Bearer fixture-owner'))
        self.assertEqual(error.exception.status_code, 404)

    def test_optional_metric_failure_preserves_valid_customer_count(self):
        self.env.update(supabase=DatabaseFixture({'customers': [
            {'id': 1, 'business_id': 1, 'program_id': 2, 'stamp_count': 3}]}),
            safe_get_business=lambda _: self.business,
            safe_get_loyalty_program=lambda *args, **kwargs: {'id': 2, 'card_type': 'stamp'},
            _owner_dashboard_activity_stats=MagicMock(side_effect=TimeoutError('metrics read failed')))
        result = asyncio.run(self.env['get_stats']('sample-business', 'program-two', authorization='Bearer fixture-owner'))
        self.assertEqual(result['total_customers'], 1)
        self.assertTrue(result['customer_count_available'])
        self.assertEqual(result['total_stamps'], 3)
        self.assertIsNone(result['total_customer_visits'])
        self.assertFalse(result['activity_available'])
        self.assertTrue(result['partial'])


if __name__ == '__main__':
    unittest.main()
