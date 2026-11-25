import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.menu_order_access import make_menu_order_operator
from backend.menu_order_insights import payment_fields
from backend.menu_order_push import (
    ENV_NAME, FcmSender, TABLE, branch_label, is_unregistered, load_credentials, make_order_pusher,
    order_message, recipients, register_menu_order_push_routes,
)


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], 'select', None

    def select(self, *_):
        return self

    def eq(self, field, value):
        self.filters.append(('eq', field, value)); return self

    def in_(self, field, values):
        self.filters.append(('in', field, list(values))); return self

    def limit(self, *_):
        return self

    def upsert(self, row, on_conflict=None):
        self.op, self.payload, self.conflict = 'upsert', row, on_conflict; return self

    def delete(self):
        self.op = 'delete'; return self

    def _match(self, row):
        for kind, field, value in self.filters:
            if kind == 'eq' and row.get(field) != value:
                return False
            if kind == 'in' and row.get(field) not in value:
                return False
        return True

    def execute(self):
        if self.table in self.db.broken:
            raise Exception(f"relation \"public.{self.table}\" does not exist")
        rows = self.db.rows.setdefault(self.table, [])
        if self.op == 'upsert':
            for row in rows:
                if row.get(self.conflict) == self.payload.get(self.conflict):
                    row.update(self.payload)
                    return Result([row])
            rows.append(dict(self.payload))
            return Result([self.payload])
        if self.op == 'delete':
            gone = [r for r in rows if self._match(r)]
            self.db.rows[self.table] = [r for r in rows if not self._match(r)]
            return Result(gone)
        return Result([dict(r) for r in rows if self._match(r)])


class DB:
    def __init__(self, rows=None, broken=()):
        self.rows, self.broken = rows or {}, set(broken)

    def table(self, name):
        return Query(self, name)


TOKENS = {
    'Bearer owner': {'business_public_id': 'biz', 'role': 'owner', 'name': 'Alfred'},
    'Bearer ana': {'business_public_id': 'biz', 'role': 'cashier', 'staff_id': 1},
    'Bearer ben': {'business_public_id': 'biz', 'role': 'manager', 'staff_id': 2},
}


def claims(public_id, authorization):
    found = TOKENS.get(authorization)
    if not found:
        raise HTTPException(401, 'Session expired - please log in again')
    if found['business_public_id'] != public_id:
        raise HTTPException(403, 'Session does not match this business')
    return found


BUSINESS = {'id': 1, 'public_id': 'biz', 'name': 'Kaldi'}


def base_rows():
    return {
        'staff': [
            {'id': 1, 'business_id': 1, 'branch_id': 10, 'role': 'cashier', 'is_active': True, 'name': 'Ana'},
            {'id': 2, 'business_id': 1, 'branch_id': None, 'role': 'manager', 'is_active': True, 'name': 'Ben'},
            {'id': 3, 'business_id': 1, 'branch_id': 20, 'role': 'cashier', 'is_active': True, 'name': 'Cy'},
            {'id': 4, 'business_id': 1, 'branch_id': 10, 'role': 'cashier', 'is_active': False, 'name': 'Gone'},
            {'id': 5, 'business_id': 1, 'branch_id': None, 'role': 'cashier', 'is_active': True, 'name': 'NoBranch'},
        ],
        'branches': [
            {'id': 10, 'business_id': 1, 'public_id': 'bgc', 'name': 'BGC', 'is_active': True},
            {'id': 20, 'business_id': 1, 'public_id': 'qc', 'name': 'QC', 'is_active': True},
        ],
        TABLE: [],
    }


def device(token, role, staff_id=None, branch='', business_id=1):
    return {'token': token, 'business_id': business_id, 'role': role, 'staff_id': staff_id, 'branch_public_id': branch}


ORDER = {
    'public_id': 'o1', 'order_number': '123', 'branch_public_id': 'bgc', 'branch_name': 'BGC',
    'total': 250.0, 'service': 'pickup', 'pickup_label': '3:30 PM', 'payment_method': 'cash',
    'payment_status': 'unpaid', 'created_at': '2026-11-21T01:00:00+00:00',
    'items': [{'item_name': 'Latte', 'quantity': 2, 'line_total': 200}, {'item_name': 'Cookie', 'quantity': 1, 'line_total': 50}],
}


class FakeSender:
    def __init__(self, info, project_id=None, results=None):
        self.info, self.project_id, self.sent = info, project_id, []
        self.results = results or {}

    def send(self, token, data):
        self.sent.append((token, data))
        result = self.results.get(token, 'ok')
        if result == 'boom':
            raise RuntimeError('network down')
        return result


SA = json.dumps({'type': 'service_account', 'project_id': 'loyaltytree-7a81a',
                 'client_email': 'push@loyaltytree-7a81a.iam.gserviceaccount.com', 'private_key': 'KEY'})


class Resp:
    def __init__(self, status_code, body):
        self.status_code, self.body = status_code, body

    def json(self):
        return self.body


class CredentialsTest(unittest.TestCase):
    def test_missing_or_bad_env_turns_push_off(self):
        self.assertIsNone(load_credentials({}))
        self.assertIsNone(load_credentials({ENV_NAME: '   '}))
        self.assertIsNone(load_credentials({ENV_NAME: '{not json'}))
        self.assertIsNone(load_credentials({ENV_NAME: json.dumps({'client_email': 'x'})}))

    def test_reads_json_and_fixes_one_line_key(self):
        info = load_credentials({ENV_NAME: json.dumps({'client_email': 'a@b', 'private_key': 'line1\\nline2'})})
        self.assertEqual(info['private_key'], 'line1\nline2')


class MessageTest(unittest.TestCase):
    def test_title_names_branch_and_is_data_only_strings(self):
        data = order_message(BUSINESS, ORDER)
        self.assertEqual(data['title'], 'New order #123 · BGC branch')
        self.assertEqual(data['items'], '3')
        self.assertEqual(data['note'], 'Pickup · 3:30 PM')
        self.assertTrue(all(isinstance(v, str) for v in data.values()))
        self.assertEqual(data['order_id'], 'o1')

    def test_branch_label(self):
        self.assertEqual(branch_label(''), 'No branch')
        self.assertEqual(branch_label('Makati Branch'), 'Makati Branch')
        self.assertEqual(branch_label('QC'), 'QC branch')


class RecipientsTest(unittest.TestCase):
    def setUp(self):
        self.rows = base_rows()
        self.rows[TABLE] = [
            device('t-owner', 'owner'),
            device('t-ana', 'cashier', 1, 'bgc'),
            device('t-ben', 'manager', 2, ''),
            device('t-cy', 'cashier', 3, 'qc'),
            device('t-gone', 'cashier', 4, 'bgc'),
            device('t-nobranch', 'cashier', 5, ''),
            device('t-moved', 'cashier', 3, 'bgc'),  # saved as BGC, staff row now says QC
            device('t-other-biz', 'owner', None, '', business_id=2),
        ]

    def tokens(self, branch):
        return sorted(d['token'] for d in recipients(DB(self.rows), 1, branch))

    def test_bgc_order_rings_owner_bgc_cashier_and_all_branch_manager(self):
        self.assertEqual(self.tokens('bgc'), ['t-ana', 't-ben', 't-owner'])

    def test_qc_order(self):
        self.assertEqual(self.tokens('qc'), ['t-ben', 't-cy', 't-moved', 't-owner'])

    def test_order_without_branch_rings_owner_and_all_branch_managers(self):
        self.assertEqual(self.tokens(''), ['t-ben', 't-owner'])

    def test_staff_lookup_failure_falls_back_to_saved_scope(self):
        db = DB(self.rows, broken={'staff'})
        got = sorted(d['token'] for d in recipients(db, 1, 'bgc'))
        self.assertEqual(got, ['t-ana', 't-ben', 't-gone', 't-moved', 't-owner'])


class PusherTest(unittest.TestCase):
    def make(self, env, results=None, rows=None):
        self.senders = []

        def factory(info, project_id=None):
            sender = FakeSender(info, project_id, results)
            self.senders.append(sender)
            return sender

        self.db = DB(rows or base_rows())
        return make_order_pusher(db=self.db, environ=env, sender_factory=factory)

    def test_no_env_is_silent_noop(self):
        push = self.make({})
        self.assertEqual(push(BUSINESS, ORDER)['skipped'], True)
        self.assertEqual(self.senders, [])

    def test_missing_table_never_raises(self):
        push = self.make({ENV_NAME: SA})
        self.db.broken.add(TABLE)
        self.assertTrue(push(BUSINESS, ORDER)['skipped'])

    def test_sends_and_removes_unregistered(self):
        rows = base_rows()
        rows[TABLE] = [device('t-owner', 'owner'), device('t-ana', 'cashier', 1, 'bgc'), device('t-cy', 'cashier', 3, 'qc')]
        push = self.make({ENV_NAME: SA}, results={'t-ana': 'unregistered'}, rows=rows)
        result = push(BUSINESS, ORDER)
        self.assertEqual(result, {'sent': 1, 'removed': 1, 'skipped': False})
        self.assertEqual(self.senders[0].project_id, 'loyaltytree-7a81a')
        self.assertEqual(sorted(t for t, _ in self.senders[0].sent), ['t-ana', 't-owner'])
        self.assertEqual(sorted(d['token'] for d in self.db.rows[TABLE]), ['t-cy', 't-owner'])

    def test_one_failing_send_does_not_stop_others(self):
        rows = base_rows()
        rows[TABLE] = [device('t-owner', 'owner'), device('t-ana', 'cashier', 1, 'bgc')]
        push = self.make({ENV_NAME: SA}, results={'t-owner': 'boom'}, rows=rows)
        self.assertEqual(push(BUSINESS, ORDER)['sent'], 1)
        self.assertEqual(len(self.db.rows[TABLE]), 2)


class FcmSenderTest(unittest.TestCase):
    def setUp(self):
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption()).decode()
        self.info = {'client_email': 'push@test.iam.gserviceaccount.com', 'private_key': pem, 'project_id': 'loyaltytree-7a81a'}
        self.calls, self.replies = [], []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if url.endswith('/token'):
            return Resp(200, {'access_token': f'at{len(self.calls)}', 'expires_in': 3600})
        return self.replies.pop(0)

    def test_http_v1_message_is_data_only_high_priority(self):
        self.replies = [Resp(200, {'name': 'projects/x/messages/1'})]
        sender = FcmSender(self.info, post=self.post)
        self.assertEqual(sender.send('tok', {'title': 'New order #1 · BGC branch'}), 'ok')
        url, kwargs = self.calls[-1]
        self.assertEqual(url, 'https://fcm.googleapis.com/v1/projects/loyaltytree-7a81a/messages:send')
        message = kwargs['json']['message']
        self.assertNotIn('notification', message)
        self.assertEqual(message['android']['priority'], 'HIGH')
        self.assertEqual(message['data']['title'], 'New order #1 · BGC branch')
        self.assertTrue(kwargs['headers']['Authorization'].startswith('Bearer at'))

    def test_access_token_is_cached(self):
        self.replies = [Resp(200, {}), Resp(200, {})]
        sender = FcmSender(self.info, post=self.post)
        sender.send('a', {}); sender.send('b', {})
        self.assertEqual(sum(1 for u, _ in self.calls if u.endswith('/token')), 1)

    def test_unregistered_and_401_retry(self):
        unregistered = Resp(404, {'error': {'status': 'NOT_FOUND', 'details': [
            {'@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', 'errorCode': 'UNREGISTERED'}]}})
        self.assertTrue(is_unregistered(unregistered))
        self.assertFalse(is_unregistered(Resp(400, {'error': {'status': 'INVALID_ARGUMENT'}})))
        self.replies = [Resp(401, {}), unregistered]
        sender = FcmSender(self.info, post=self.post)
        self.assertEqual(sender.send('tok', {}), 'unregistered')
        self.assertEqual(sum(1 for u, _ in self.calls if u.endswith('/token')), 2)


class RoutesTest(unittest.TestCase):
    def setUp(self):
        self.db = DB(base_rows())
        app = FastAPI()
        operator = make_menu_order_operator(db=self.db, get_business=lambda p: BUSINESS if p == 'biz' else None, get_claims=claims)
        self.push = register_menu_order_push_routes(app, db=self.db, operator=operator,
                                                    get_business=lambda p: BUSINESS if p == 'biz' else None, environ={})
        self.client = TestClient(app)

    def test_register_stores_role_and_branch_scope(self):
        r = self.client.post('/api/v1/business/biz/app-devices', json={'token': 'tok-ana'}, headers={'Authorization': 'Bearer ana'})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['push_ready'], False)
        saved = self.db.rows[TABLE][0]
        self.assertEqual((saved['role'], saved['staff_id'], saved['branch_public_id']), ('cashier', 1, 'bgc'))
        self.client.post('/api/v1/business/biz/app-devices', json={'token': 'tok-ana'}, headers={'Authorization': 'Bearer owner'})
        self.assertEqual(len(self.db.rows[TABLE]), 1)
        self.assertEqual(self.db.rows[TABLE][0]['role'], 'owner')

    def test_register_needs_session_and_token(self):
        self.assertEqual(self.client.post('/api/v1/business/biz/app-devices', json={'token': 't'}).status_code, 401)
        self.assertEqual(self.client.post('/api/v1/business/biz/app-devices', json={'token': ''},
                                          headers={'Authorization': 'Bearer owner'}).status_code, 400)

    def test_register_without_table_gives_clear_503(self):
        self.db.broken.add(TABLE)
        r = self.client.post('/api/v1/business/biz/app-devices', json={'token': 't'}, headers={'Authorization': 'Bearer ben'})
        self.assertEqual(r.status_code, 503)

    def test_remove_works_without_session(self):
        self.db.rows[TABLE] = [device('tok', 'cashier', 1, 'bgc'), device('tok2', 'owner')]
        r = self.client.post('/api/v1/business/biz/app-devices/remove', json={'token': 'tok'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([d['token'] for d in self.db.rows[TABLE]], ['tok2'])
        self.assertEqual(self.client.post('/api/v1/business/nope/app-devices/remove', json={'token': 'tok2'}).status_code, 404)

    def test_pusher_is_noop_without_env(self):
        self.assertTrue(self.push(BUSINESS, ORDER)['skipped'])


class MainWiringTest(unittest.TestCase):
    """public_place_menu_order from main.py (via AST, no app start): the push is a
    background task, so the order is saved and answered first."""

    def load(self):
        import ast
        import uuid
        from datetime import datetime, timezone
        from pathlib import Path
        from fastapi import BackgroundTasks, Request
        source = (Path(__file__).resolve().parents[1] / 'main.py').read_text()
        self.assertIn("background_tasks.add_task(_menu_order_push", source)
        self.assertIn('register_menu_order_push_routes(app', source)
        node = next(n for n in ast.parse(source).body
                    if isinstance(n, ast.AsyncFunctionDef) and n.name == 'public_place_menu_order')
        node.decorator_list = []
        self.pushed = []
        # Simulates menu_order_branches.sql not run: saved row lacks the branch columns.
        self.insert_order = Mock(side_effect=lambda db, row: (
            {key: value for key, value in row.items() if not key.startswith('branch')}, []
        ))
        scope = {
            'BackgroundTasks': BackgroundTasks, 'Request': Request, 'HTTPException': HTTPException,
            'datetime': datetime, 'timezone': timezone, 'uuid': uuid, 'supabase': None,
            'safe_get_business': lambda p: dict(BUSINESS),
            '_menu_order_resolve_branch': lambda db, bid, branch: ('bgc', 'BGC'),
            '_menu_order_member': lambda *a: None, '_menu_card_read_token': None,
            '_menu_order_payment': payment_fields,
            '_menu_price_counter_items': lambda business, branch, items: (items, 120.0),
            '_menu_order_insert': self.insert_order,
            'friendly_db_error': str,
            '_menu_counter_order_public': lambda row: {'public_id': row.get('public_id')},
            '_menu_order_push': lambda business, order: self.pushed.append((business, order)),
            # owner-v8: the loyalty card refresh is queued next to the push.
            '_menu_order_wallet': type('W', (), {'order_placed': staticmethod(lambda business, order: self.placed.append(order))}),
        }
        self.placed = []
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'main.py', 'exec'), scope)
        return scope['public_place_menu_order']

    def test_order_saved_then_push_queued_with_branch(self):
        import asyncio
        from fastapi import BackgroundTasks

        handler = self.load()

        class Req:
            async def json(self):
                return {'items': [{'name': 'Latte', 'quantity': 1, 'line_total': 120}],
                        'order_number': '123', 'service': 'dine-in', 'payment_method': 'cash', 'payment_status': 'paid'}

        tasks = BackgroundTasks()
        result = asyncio.run(handler('biz', Req(), tasks))
        self.assertTrue(result['success'])
        saved_order = self.insert_order.call_args.args[1]
        self.assertEqual((saved_order['service'], saved_order['payment_method'], saved_order['payment_status']), ('dine-in', 'cash', 'unpaid'))
        self.assertEqual(self.pushed, [])  # not sent before the response
        self.assertEqual(len(tasks.tasks), 2)  # owner phones (v6) + customer's card (v8)
        asyncio.run(tasks())
        self.assertEqual(self.placed[0]['order_number'], '123')
        business, order = self.pushed[0]
        self.assertEqual((order['branch_public_id'], order['branch_name'], order['order_number']), ('bgc', 'BGC', '123'))

    def test_public_checkout_rejects_electronic_and_unspecified_payments_before_saving(self):
        import asyncio
        from fastapi import BackgroundTasks

        handler = self.load()
        for payment in ({'payment_method': 'card'}, {'payment_method': 'qrph'}, {}):
            with self.subTest(payment=payment):
                request = SimpleNamespace(json=AsyncMock(return_value={
                    'items': [{'name': 'Latte', 'quantity': 1, 'line_total': 120}],
                    'service': 'dine-in', **payment,
                }))
                tasks = BackgroundTasks()
                with self.assertRaises(HTTPException) as caught:
                    asyncio.run(handler('biz', request, tasks))
                self.assertEqual(caught.exception.status_code, 400)
                self.assertIn('Please select cash', caught.exception.detail)
                self.insert_order.assert_not_called()
                self.assertEqual(tasks.tasks, [])


    def test_public_checkout_rejects_non_dine_in_before_saving(self):
        import asyncio
        from fastapi import BackgroundTasks

        handler = self.load()
        for service in ({'service': 'pickup'}, {'service': 'delivery'}, {'service': 'unknown'}, {'service': None}, {}):
            for payment in ('cash', 'card', 'qrph'):
                with self.subTest(service=service, payment=payment):
                    request = SimpleNamespace(json=AsyncMock(return_value={
                        'items': [{'name': 'Latte', 'quantity': 1, 'line_total': 120}],
                        'payment_method': payment, **service,
                    }))
                    tasks = BackgroundTasks()
                    with self.assertRaises(HTTPException) as caught:
                        asyncio.run(handler('biz', request, tasks))
                    self.assertEqual(caught.exception.status_code, 400)
                    self.assertIn('Only dine-in is available', caught.exception.detail)
                    self.insert_order.assert_not_called()
                    self.assertEqual(tasks.tasks, [])


if __name__ == '__main__':
    unittest.main()
