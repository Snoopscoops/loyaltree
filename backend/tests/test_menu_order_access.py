from datetime import datetime, timezone
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.menu_order_access import (
    NO_BRANCH, access_payload, check_order_branch, make_menu_order_operator, permissions,
    register_menu_order_access_routes, scoped_branch,
)
from backend.menu_order_insights import register_menu_order_insight_routes
from backend.tests.test_menu_order_insights import DB, order

TOKENS = {
    'Bearer owner': {'business_public_id': 'biz', 'role': 'owner', 'name': 'Alfred'},
    'Bearer ana': {'business_public_id': 'biz', 'role': 'cashier', 'staff_id': 1, 'name': 'Ana'},
    'Bearer ben': {'business_public_id': 'biz', 'role': 'manager', 'staff_id': 2, 'name': 'Ben'},
    'Bearer cy': {'business_public_id': 'biz', 'role': 'cashier', 'staff_id': 3, 'name': 'Cy'},
    'Bearer dee': {'business_public_id': 'biz', 'role': 'manager', 'staff_id': 4, 'name': 'Dee'},
    'Bearer gone': {'business_public_id': 'biz', 'role': 'cashier', 'staff_id': 5, 'name': 'Gone'},
}


def claims(public_id, authorization):
    found = TOKENS.get(authorization)
    if not found:
        raise HTTPException(401, 'Session expired - please log in again')
    if found['business_public_id'] != public_id:
        raise HTTPException(403, 'Session does not match this business')
    return found


def make_db():
    today = datetime.now(timezone.utc).isoformat()
    return DB({
        'staff': [
            {'id': 1, 'business_id': 1, 'branch_id': 10, 'role': 'cashier', 'name': 'Ana', 'is_active': True},
            {'id': 2, 'business_id': 1, 'branch_id': 10, 'role': 'manager', 'name': 'Ben', 'is_active': True},
            {'id': 3, 'business_id': 1, 'branch_id': None, 'role': 'cashier', 'name': 'Cy', 'is_active': True},
            {'id': 4, 'business_id': 1, 'branch_id': None, 'role': 'manager', 'name': 'Dee', 'is_active': True},
            {'id': 5, 'business_id': 1, 'branch_id': 10, 'role': 'cashier', 'name': 'Gone', 'is_active': False},
        ],
        'branches': [
            {'id': 10, 'business_id': 1, 'public_id': 'bgc', 'name': 'BGC', 'is_active': True},
            {'id': 11, 'business_id': 1, 'public_id': 'qc', 'name': 'QC', 'is_active': True},
        ],
        'menu_counter_orders': [
            dict(order(1, today, 200, branch='bgc', branch_name='BGC'), payment_method='cash', payment_status='unpaid'),
            dict(order(2, today, 300, branch='qc', branch_name='QC'), payment_method='cash', payment_status='unpaid'),
        ],
        'customers': [],
    })


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()
        self.op = make_menu_order_operator(db=self.db, get_business=lambda pid: {'id': 1, 'public_id': pid, 'name': 'Mirah'},
                                           get_claims=claims)

    def test_owner_sees_every_branch(self):
        _, scope = self.op('biz', 'Bearer owner')
        self.assertEqual((scope['role'], scope['branch'], scope['all_branches']), ('owner', '', True))

    def test_cashier_is_locked_to_the_branch_from_the_database(self):
        _, scope = self.op('biz', 'Bearer ana')
        self.assertEqual((scope['role'], scope['branch'], scope['branch_name']), ('cashier', 'bgc', 'BGC'))
        self.assertEqual(scoped_branch(scope, ''), 'bgc')
        with self.assertRaises(HTTPException) as ctx:
            scoped_branch(scope, 'qc')
        self.assertEqual(ctx.exception.status_code, 403)
        with self.assertRaises(HTTPException):
            check_order_branch(scope, {'branch_public_id': 'qc'})
        check_order_branch(scope, {'branch_public_id': 'bgc'})

    def test_cashier_without_branch_is_told_to_ask_the_owner(self):
        with self.assertRaises(HTTPException) as ctx:
            self.op('biz', 'Bearer cy')
        self.assertEqual((ctx.exception.status_code, ctx.exception.detail), (403, NO_BRANCH))
        _, scope = self.op('biz', 'Bearer cy', need_branch=False)
        self.assertTrue(access_payload(scope)['needs_branch'])

    def test_manager_without_branch_sees_all_and_moves_take_effect_now(self):
        _, scope = self.op('biz', 'Bearer dee')
        self.assertEqual((scope['branch'], scope['all_branches']), ('', True))
        self.db.rows['staff'][3]['branch_id'] = 11
        _, scope = self.op('biz', 'Bearer dee')
        self.assertEqual(scope['branch'], 'qc')

    def test_inactive_wrong_role_and_bad_tokens(self):
        for token, code in (('Bearer gone', 403), ('Bearer nope', 401), ('', 401)):
            with self.assertRaises(HTTPException) as ctx:
                self.op('biz', token)
            self.assertEqual(ctx.exception.status_code, code)
        with self.assertRaises(HTTPException) as ctx:
            self.op('biz', 'Bearer ana', allow=('owner', 'manager'))
        self.assertEqual(ctx.exception.status_code, 403)
        self.op('biz', 'Bearer ben', allow=('owner', 'manager'))

    def test_missing_database_role_cannot_inherit_token_privileges(self):
        self.db.rows['staff'][1]['role'] = None
        with self.assertRaises(HTTPException) as ctx:
            self.op('biz', 'Bearer ben')
        self.assertEqual(ctx.exception.status_code, 403)

    def test_missing_active_flag_fails_closed(self):
        self.db.rows['staff'][1]['is_active'] = None
        with self.assertRaises(HTTPException) as ctx:
            self.op('biz', 'Bearer ben')
        self.assertEqual(ctx.exception.status_code, 403)

    def test_manager_with_invalid_assigned_branch_cannot_get_all_branches(self):
        self.db.rows['branches'][0]['public_id'] = ''
        with self.assertRaises(HTTPException) as ctx:
            self.op('biz', 'Bearer ben')
        self.assertEqual(ctx.exception.status_code, 403)

    def test_owner_obeys_explicit_role_allowlist(self):
        with self.assertRaises(HTTPException) as ctx:
            self.op('biz', 'Bearer owner', allow=('manager',))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_permission_table(self):
        self.assertFalse(any(permissions('unknown').values()))
        self.assertTrue(permissions('cashier')['cancel_order'])
        self.assertFalse(permissions('cashier')['void_items'])
        self.assertTrue(permissions('manager')['void_items'])
        self.assertTrue(permissions('owner')['void_items'])
        self.assertFalse(permissions('owner')['refund'])
        self.assertFalse(permissions('cashier')['report'])
        self.assertFalse(permissions('cashier')['stamp_corrections'])
        self.assertTrue(permissions('manager')['report'])
        self.assertFalse(permissions('manager')['analytics'])
        self.assertFalse(permissions('manager')['billing'])
        self.assertTrue(permissions('owner')['billing'])


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()
        app = FastAPI()
        op = make_menu_order_operator(db=self.db, get_business=lambda pid: {'id': 1, 'public_id': pid, 'name': 'Mirah'}, get_claims=claims)

        def owner(public_id, authorization):
            if authorization != 'Bearer owner':
                raise HTTPException(403, 'Owner access required')
        register_menu_order_insight_routes(app, db=self.db, get_business=lambda pid: {'id': 1, 'public_id': pid, 'name': 'Mirah'},
                                           require_owner=owner, operator=op)
        register_menu_order_access_routes(app, operator=op)
        self.client = TestClient(app)

    def get(self, path, who):
        return self.client.get('/api/v1/business/biz' + path, headers={'Authorization': 'Bearer ' + who})

    def test_access_route(self):
        body = self.get('/menu-orders/access', 'ana').json()
        self.assertEqual((body['role'], body['branch']['name'], body['can']['report']), ('cashier', 'BGC', False))
        body = self.get('/menu-orders/access', 'cy').json()
        self.assertEqual((body['needs_branch'], body['message']), (True, NO_BRANCH))

    def test_cashier_marks_paid_only_in_own_branch(self):
        auth = {'Authorization': 'Bearer ana'}
        self.assertEqual(self.client.patch('/api/v1/business/biz/menu-orders/o2/payment', headers=auth).status_code, 403)
        self.assertEqual(self.db.rows['menu_counter_orders'][1]['payment_status'], 'unpaid')
        self.assertEqual(self.client.patch('/api/v1/business/biz/menu-orders/o1/payment', headers=auth).status_code, 400)
        response = self.client.patch('/api/v1/business/biz/menu-orders/o1/payment?expected_amount=200.00', headers=auth)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['payment_status'], 'paid')
        self.assertEqual(self.client.patch('/api/v1/business/biz/menu-orders/o2/payment?expected_amount=300.00', headers={'Authorization': 'Bearer owner'}).status_code, 200)

    def test_summary_and_report_for_managers_only_and_scoped(self):
        self.assertEqual(self.get('/menu-orders/summary', 'ana').status_code, 403)
        self.assertEqual(self.get('/menu-orders/report?format=json', 'ana').status_code, 403)
        summary = self.get('/menu-orders/summary', 'ben').json()
        self.assertEqual((summary['orders'], summary['branch']), (1, 'bgc'))
        self.assertEqual(self.get('/menu-orders/summary?branch=qc', 'ben').status_code, 403)
        report = self.get('/menu-orders/report?format=json', 'ben').json()
        self.assertEqual((report['orders'], report['sales']), (1, 200.0))
        self.assertEqual(self.get('/menu-orders/summary', 'dee').json()['orders'], 2)
        self.assertEqual(self.get('/menu-orders/summary', 'owner').json()['orders'], 2)

    def test_insights_stay_owner_only(self):
        self.assertEqual(self.get('/menu-orders/insights?period=today', 'ben').status_code, 403)
        self.assertEqual(self.get('/menu-orders/insights?period=today', 'owner').status_code, 200)


class MainSourceTests(unittest.TestCase):
    def test_list_and_status_routes_use_the_branch_scope_and_ttl_is_12h(self):
        source = open(__file__.replace('tests/test_menu_order_access.py', 'main.py'), encoding='utf-8').read()
        listing = source[source.index('async def owner_list_menu_orders'):source.index('async def owner_update_menu_order_status')]
        self.assertIn('_menu_order_operator, public_id, authorization', listing)
        self.assertIn(".eq('branch_public_id', order_scope['branch'])", listing)
        self.assertNotIn('require_owner_session', listing)
        status = source[source.index('async def owner_update_menu_order_status'):source.index("@app.get('/api/v1/business/{public_id}/order-ahead/orders')")]
        self.assertIn('_menu_order_check_branch(order_scope, current_order)', status)
        self.assertIn('operator=_menu_order_operator', source)
        self.assertIn('register_menu_order_access_routes(app, operator=_menu_order_operator)', source)
        self.assertIn('STAFF_SESSION_TTL_HOURS = 12', source)


if __name__ == '__main__':
    unittest.main()
