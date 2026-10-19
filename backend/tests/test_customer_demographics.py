import json
from datetime import date
from types import SimpleNamespace
import unittest

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from backend.customer_demographics import (
    AGE_LABELS, CustomerDemographicsReport, age_bracket, build_customer_demographics,
    read_pages, register_customer_demographics_routes, safe_distribution,
)


class Database:
    def __init__(self, rows):
        self.rows, self.calls, self.fail, self.missing = rows, [], False, None

    def table(self, table):
        return Query(self, table)


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.columns = db, table, ''

    def select(self, columns):
        self.columns = columns
        return self

    def order(self, field):
        assert field == 'id'
        return self

    def range(self, start, end):
        self.start, self.end = start, end
        return self

    def execute(self):
        self.db.calls.append((self.table, self.columns, self.start, self.end))
        if self.db.fail:
            raise RuntimeError('private upstream credentials must not be returned')
        if self.db.missing and self.db.missing in self.columns.split(','):
            raise ValueError(f'column {self.table}.{self.db.missing} does not exist')
        rows = self.db.rows.get(self.table, [])[self.start:self.end + 1]
        return SimpleNamespace(data=[{key: row[key] for key in self.columns.split(',') if key in row} for row in rows])


def sample_rows():
    return {
        'businesses': [{'id': 1, 'is_demo': False, 'email': 'owner-private@example.invalid'}, {'id': 2, 'is_demo': False}, {'id': 3, 'is_demo': True}],
        'loyalty_programs': [{'id': 7, 'business_id': 1, 'card_type': 'stamp'}, {'id': 8, 'business_id': 1, 'card_type': 'employee'}, {'id': 9, 'business_id': 2, 'card_type': 'membership', 'membership_employee_mode': True}],
        'customers': [{'id': 1, 'business_id': 1, 'program_id': 7, 'identity_id': 10, 'age_bracket': '25_34', 'gender': 'female', 'occupation': 'working', 'name': 'private customer', 'phone': 'private phone'},
                      {'id': 2, 'business_id': 1, 'program_id': 8, 'age_bracket': '18_24'},
                      {'id': 3, 'business_id': 3, 'age_bracket': '18_24'},
                      {'id': 4, 'business_id': 2, 'program_id': 9, 'age_bracket': '18_24'}],
    }


class CustomerDemographicsTests(unittest.TestCase):
    def build(self, rows=None):
        rows = rows or sample_rows()
        return build_customer_demographics(rows['businesses'], rows['loyalty_programs'], rows['customers'], date(2026, 10, 19))

    def test_only_real_merchant_customers_contribute(self):
        report = self.build()
        self.assertEqual(report['summary']['customers'], 1)
        self.assertEqual(report['summary']['businesses'], 2)
        self.assertEqual(report['summary']['businesses_with_customers'], 1)
        self.assertEqual(report['summary']['average_customers_per_business'], .5)
        self.assertEqual(report['summary']['employee_memberships_excluded'], 2)
        self.assertNotIn('private', json.dumps(report))

    def test_shared_cards_are_deduplicated_within_each_business_using_latest_valid_responses(self):
        rows = sample_rows()
        rows['customers'] = [
            {'id': 1, 'business_id': 1, 'identity_id': 11, 'age_bracket': '18_24', 'gender': 'female', 'occupation': 'working', 'updated_at': '2026-10-01T00:00:00Z'},
            {'id': 2, 'business_id': 1, 'identity_id': 11, 'age_bracket': '25_34', 'gender': None, 'updated_at': '2026-10-19T00:00:00Z'},
            {'id': 3, 'business_id': 2, 'identity_id': 11, 'age_bracket': '35_44'},
            {'id': 4, 'business_id': 1}, {'id': 5, 'business_id': 1},
        ]
        report = self.build(rows)
        self.assertEqual(report['summary']['customers'], 4)
        self.assertEqual(report['summary']['memberships'], 5)
        self.assertEqual(report['summary']['unlinked_memberships'], 2)
        self.assertEqual(report['age']['sample_size'], 2)
        self.assertEqual(report['gender']['sample_size'], 1)
        self.assertEqual(report['gender']['missing'], 3)

    def test_valid_responses_are_customer_weighted_not_averaged_business_percentages(self):
        rows = sample_rows()
        rows['customers'] = [{'id': i, 'business_id': 1, 'age_bracket': '25_34', 'gender': 'female', 'occupation': 'working'} for i in range(20)] + [{'id': 100 + i, 'business_id': 2, 'age_bracket': '18_24', 'gender': 'male'} for i in range(10)]
        report = self.build(rows)
        self.assertEqual(report['age']['largest_group']['label'], '25–34')
        self.assertEqual(report['age']['largest_group']['percent'], 66.7)
        self.assertEqual(report['occupation']['coverage_percent'], 66.7)
        self.assertEqual(report['occupation']['rows'][0]['percent'], 100)

    def test_small_groups_and_secondary_cells_stay_hidden_without_false_zeroes_or_leader(self):
        protected = safe_distribution({'18_24': 3, '25_34': 12, '35_44': 20}, AGE_LABELS, 40)
        self.assertTrue(protected['suppressed'])
        self.assertIsNone(protected['largest_group'])
        cells = {row['key']: row['count'] for row in protected['rows']}
        self.assertEqual([cells[key] for key in ('18_24', '25_34', '35_44')], [None, None, 20])
        self.assertEqual(protected['sample_size'], 35)
        self.assertEqual(protected['missing'], 5)
        small = safe_distribution({'25_34': 9}, AGE_LABELS, 10)
        self.assertFalse(small['available'])
        self.assertTrue(all(row['count'] is None and row['percent'] is None for row in small['rows']))

    def test_legacy_age_and_full_birthday_are_bucketed_but_missing_year_is_not_guessed(self):
        today = date(2026, 10, 19)
        self.assertEqual(age_bracket({'age': 31}, today), '25_34')
        self.assertEqual(age_bracket({'birthday': '2008-10-20'}, today), 'under_18')
        self.assertEqual(age_bracket({'birthday': '2008-10-19'}, today), '18_24')
        self.assertEqual(age_bracket({'age_bracket': '18_24', 'age': 88}, today), '18_24')
        for row in [{'birthday_month': 4, 'birthday_day': 2}, {'age': 500}, {'age': 'not an age'}, {'birthday': '2030-10-19'}]:
            self.assertIsNone(age_bracket(row, today))

    def test_empty_population_does_not_invent_an_average_or_coverage(self):
        report = build_customer_demographics([], [], [])
        self.assertIsNone(report['summary']['average_customers_per_business'])
        self.assertIsNone(report['age']['coverage_percent'])
        self.assertFalse(report['age']['available'])

    def test_pagination_is_complete_past_postgrest_first_page_and_reads_no_contact_fields(self):
        rows = sample_rows()
        rows['customers'] = [{'id': i, 'business_id': 1, 'age_bracket': '25_34'} for i in range(1007)]
        db = Database(rows)
        report = CustomerDemographicsReport(db).get()
        self.assertEqual(report['summary']['customers'], 1007)
        pages = [call for call in db.calls if call[0] == 'customers']
        self.assertEqual([call[2] for call in pages], [0, 1000])
        for _, columns, _, _ in db.calls:
            self.assertFalse({'*', 'name', 'email', 'phone', 'address', 'token'} & set(columns.split(',')))

    def test_missing_optional_columns_keep_the_report_available_and_expose_coverage(self):
        db = Database(sample_rows())
        db.missing = 'age_bracket'
        report = CustomerDemographicsReport(db).get()
        self.assertEqual(report['age']['sample_size'], 0)
        self.assertIn('customers.age_bracket', report['source_fields_missing'])
        self.assertEqual(report['gender']['sample_size'], 1)

    def test_cache_prevents_repeat_scans_and_upstream_failure_returns_labeled_recent_data(self):
        db, now = Database(sample_rows()), [1000]
        report = CustomerDemographicsReport(db, clock=lambda: now[0])
        first = report.get()
        calls = len(db.calls)
        self.assertEqual(report.get(), first)
        self.assertEqual(len(db.calls), calls)
        now[0] += 301
        db.fail = True
        self.assertTrue(report.get()['stale'])
        now[0] += 3600
        with self.assertRaises(HTTPException) as raised:
            report.get()
        self.assertEqual(raised.exception.status_code, 503)
        self.assertNotIn('private', raised.exception.detail)

    def test_endpoint_requires_admin_before_any_reads_and_returns_only_private_aggregates(self):
        db = Database(sample_rows())
        def admin(request: Request):
            if request.headers.get('authorization') != 'Bearer admin-fixture':
                raise HTTPException(401, 'Admin authentication required')
            return True
        app = FastAPI()
        register_customer_demographics_routes(app, db=db, require_admin=admin)
        client = TestClient(app)
        for headers in ({}, {'Authorization': 'Bearer owner-fixture'}, {'Authorization': 'Bearer staff-fixture'}):
            self.assertEqual(client.get('/api/v1/admin/customer-demographics', headers=headers).status_code, 401)
        self.assertEqual(db.calls, [])
        response = client.get('/api/v1/admin/customer-demographics', headers={'Authorization': 'Bearer admin-fixture'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['cache-control'], 'private, no-store')
        self.assertNotIn('private', response.text)
        self.assertNotIn('owner-private', response.text)


if __name__ == '__main__':
    unittest.main()
