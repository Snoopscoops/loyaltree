import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel

from backend.menu_order_wallet import TABLE, apple_field, make_menu_order_wallet, step_message


class Result:
    def __init__(self, data):
        self.data = data


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.filters, self.op, self.payload = db, table, [], 'select', None

    def select(self, *_):
        return self

    def eq(self, f, v):
        self.filters.append(('eq', f, v)); return self

    def gte(self, f, v):
        self.filters.append(('gte', f, v)); return self

    def order(self, *_, **__):
        return self

    def limit(self, n):
        self.n = n; return self

    def insert(self, row):
        self.op, self.payload = 'insert', row; return self

    def update(self, values):
        self.op, self.payload = 'update', values; return self

    def delete(self):
        self.op = 'delete'; return self

    def _match(self, r):
        for kind, f, v in self.filters:
            if kind == 'eq' and r.get(f) != v:
                return False
            if kind == 'gte' and str(r.get(f) or '') < v:
                return False
        return True

    def execute(self):
        if self.table in self.db.broken:
            raise Exception(f'relation "public.{self.table}" does not exist')
        rows = self.db.rows.setdefault(self.table, [])
        if self.op == 'insert':
            if self.table == TABLE and any(r['order_public_id'] == self.payload['order_public_id'] and r['kind'] == self.payload['kind']
                                           and r['step'] == self.payload['step'] for r in rows):
                raise Exception('duplicate key value violates unique constraint (23505)')
            rows.append(dict(self.payload, google_sent=False, created_at=datetime.now(timezone.utc).isoformat()))
            return Result([self.payload])
        if self.op == 'update':
            for r in rows:
                if self._match(r):
                    r.update(self.payload)
            return Result([])
        if self.op == 'delete':
            self.db.rows[self.table] = [r for r in rows if not self._match(r)]
            return Result([])
        found = [dict(r) for r in rows if self._match(r)]
        if self.table == 'menu_counter_orders':
            found.sort(key=lambda r: r.get('created_at') or '', reverse=True)
        return Result(found[:getattr(self, 'n', None)])


class DB:
    def __init__(self, rows=None, broken=()):
        self.rows, self.broken = rows or {}, set(broken)

    def table(self, name):
        return Query(self, name)


class PointsReq(BaseModel):
    customer_public_id: str
    amount_spent: float
    as_owner: bool = False


class StampReq(BaseModel):
    customer_public_id: str
    as_owner: bool = False
    stamp_kind: str = None


BUSINESS = {'id': 1, 'public_id': 'kaldi', 'name': 'Kaldi'}
CUSTOMER = {'id': 9, 'public_id': 'cust-1', 'business_id': 1}


def order(status='ready', **extra):
    row = {'public_id': 'o1', 'order_number': '123', 'status': status, 'business_id': 1, 'service': 'pickup',
           'total': 250, 'payment_status': 'paid', 'member_customer_public_id': 'cust-1',
           'created_at': datetime.now(timezone.utc).isoformat()}
    row.update(extra)
    return row


class Harness:
    def __init__(self, program=None, db=None, stamp_error=None, points_error=None):
        self.db = db or DB()
        self.calls, self.google, self.apple, self.keys = [], [], [], []
        self.program = program if program is not None else {'card_type': 'points'}
        self.balances = {'points': 100, 'stamps': 6}
        self.done = {}
        self.stamp_error, self.points_error = stamp_error, points_error

        async def owner_auth(business):
            return 'Bearer internal-owner'

        async def add_points(public_id, req, tasks, authorization, x_idempotency_key):
            self.keys.append(x_idempotency_key)
            if self.points_error:
                raise self.points_error
            if x_idempotency_key in self.done:
                return dict(self.done[x_idempotency_key], duplicate_prevented=True)
            earned = int(req.amount_spent / 10)
            self.balances['points'] += earned
            tasks.add_task(lambda: self.calls.append(('wallet_sync', 'points_sale')))
            self.done[x_idempotency_key] = {'points_earned': earned, 'points_balance': self.balances['points']}
            return self.done[x_idempotency_key]

        async def add_stamp(public_id, req, tasks, authorization, x_idempotency_key):
            self.keys.append(x_idempotency_key)
            if self.stamp_error:
                raise self.stamp_error
            self.balances['stamps'] += 1
            tasks.add_task(lambda: self.calls.append(('wallet_sync', 'stamp_add')))
            return {'stamp_count': self.balances['stamps']}

        self.hooks = make_menu_order_wallet(
            db=self.db, get_customer=lambda p: dict(CUSTOMER) if p == 'cust-1' else ({'public_id': p, 'business_id': 2} if p else None),
            get_program=lambda c, b: self.program,
            uses_points=lambda p: p.get('card_type') in ('points', 'hybrid'),
            uses_stamps=lambda p: p.get('card_type') in ('stamp', 'hybrid'),
            owner_authorization=owner_auth, add_points=add_points, add_stamp=add_stamp,
            points_request=PointsReq, stamp_request=StampReq,
            apple_refresh=lambda c: self.apple.append(c['public_id']),
            google_message=lambda c, h, b, mid: self.google.append((h, b, mid)) or True,
        )

    def run(self, coro):
        return asyncio.run(coro)


class MessageTest(unittest.TestCase):
    def test_messages(self):
        o = order()
        self.assertEqual(step_message(o, 'new', 'Kaldi'), 'Order #123 received by Kaldi.')
        self.assertEqual(step_message(o, 'preparing', 'Kaldi'), 'Order #123 accepted. Kaldi is preparing it now.')
        self.assertEqual(step_message(o, 'ready', 'Kaldi'), 'Order #123 is ready for pickup.')
        self.assertEqual(step_message(order(service='dine-in', table_no='5'), 'ready'), 'Order #123 is ready. We will bring it to Table 5.')
        self.assertEqual(step_message(o, 'completed'), 'Order #123 completed. Thank you!')
        self.assertEqual(step_message(o, 'cancelled'), 'Order #123 was cancelled. Please ask the counter.')


class AppleFieldTest(unittest.TestCase):
    def test_latest_linked_order_shows_with_change_message(self):
        db = DB({'menu_counter_orders': [order('preparing', created_at='2026-11-21T00:00:00+00:00'),
                                         order('ready', public_id='o2', order_number='124', created_at='2026-11-21T01:00:00+00:00'),
                                         order('new', public_id='x', member_customer_public_id='someone-else')]})
        now = datetime(2026, 11, 21, 2, 0, tzinfo=timezone.utc)
        field = apple_field(db, CUSTOMER, {'id': 1, 'name': '50% Cafe'}, now=now)
        self.assertEqual(field['key'], 'menu_order_status')
        self.assertEqual(field['value'], '#124 · READY')
        self.assertEqual(field['changeMessage'], 'Order #124 is ready for pickup.')
        self.assertEqual(apple_field(db, CUSTOMER, {'id': 1, 'name': '50% Cafe'}, now=now)['label'], 'CURRENT ORDER')

    def test_percent_is_escaped_and_old_orders_hide(self):
        db = DB({'menu_counter_orders': [order('preparing', created_at='2026-11-21T00:00:00+00:00')]})
        field = apple_field(db, CUSTOMER, {'id': 1, 'name': '50% Cafe'}, now=datetime(2026, 11, 21, 1, tzinfo=timezone.utc))
        self.assertIn('50%% Cafe', field['changeMessage'])
        self.assertIsNone(apple_field(db, CUSTOMER, BUSINESS, now=datetime(2026, 11, 23, tzinfo=timezone.utc)))
        done = DB({'menu_counter_orders': [order('completed', created_at='2026-11-21T00:00:00+00:00')]})
        self.assertIsNotNone(apple_field(done, CUSTOMER, BUSINESS, now=datetime(2026, 11, 21, 5, tzinfo=timezone.utc)))
        self.assertIsNone(apple_field(done, CUSTOMER, BUSINESS, now=datetime(2026, 11, 21, 7, tzinfo=timezone.utc)))

    def test_no_table_or_no_order_is_none(self):
        self.assertIsNone(apple_field(DB(broken={'menu_counter_orders'}), CUSTOMER, BUSINESS))
        self.assertIsNone(apple_field(DB(), CUSTOMER, BUSINESS))


class StatusTest(unittest.TestCase):
    def test_each_step_notifies_once(self):
        h = Harness()
        r = h.run(h.hooks.status_changed(BUSINESS, order('preparing'), 'new'))
        self.assertTrue(r['google_sent'])
        self.assertEqual(h.apple, ['cust-1'])
        self.assertEqual(h.google[0][0], 'Order accepted')
        h.run(h.hooks.status_changed(BUSINESS, order('ready'), 'preparing'))
        self.assertEqual(h.google[1], ('Order ready', 'Order #123 is ready for pickup.', 'menu-order-ready-o1'))
        # Tapping Ready again (e.g. another phone) does not notify again.
        again = h.run(h.hooks.status_changed(BUSINESS, order('ready'), 'new'))
        self.assertEqual(again['notice'], 'already_sent')
        self.assertEqual(len(h.google), 2)
        self.assertEqual(h.run(h.hooks.status_changed(BUSINESS, order('ready'), 'ready'))['skipped'], 'no_change')

    def test_google_cap_keeps_room_for_ready(self):
        h = Harness()
        for i in range(3):
            h.run(h.hooks.status_changed(BUSINESS, order('preparing', public_id=f'p{i}'), 'new'))
        self.assertEqual(len(h.google), 1)  # only the first "accepted" uses Google
        self.assertEqual(len(h.apple), 3)  # Apple still gets every step
        h.run(h.hooks.status_changed(BUSINESS, order('ready', public_id='p0'), 'preparing'))
        h.run(h.hooks.status_changed(BUSINESS, order('ready', public_id='p1'), 'preparing'))
        self.assertEqual([g[0] for g in h.google], ['Order accepted', 'Order ready'])

    def test_unlinked_or_other_business_card_does_nothing(self):
        h = Harness()
        self.assertEqual(h.run(h.hooks.status_changed(BUSINESS, order(member_customer_public_id=''), 'new'))['skipped'], 'no_card')
        self.assertEqual(h.run(h.hooks.status_changed(BUSINESS, order(member_customer_public_id='other'), 'new'))['skipped'], 'no_card')
        self.assertEqual((h.google, h.apple), ([], []))

    def test_errors_never_raise(self):
        h = Harness()
        h.hooks_google_boom = True

        def boom(*_):
            raise RuntimeError('google down')
        h2 = Harness()
        h2.hooks = make_menu_order_wallet(
            db=DB(), get_customer=lambda p: dict(CUSTOMER), get_program=lambda c, b: {}, uses_points=lambda p: False,
            uses_stamps=lambda p: False, owner_authorization=None, add_points=None, add_stamp=None,
            points_request=PointsReq, stamp_request=StampReq, apple_refresh=boom, google_message=boom)
        self.assertEqual(h2.run(h2.hooks.status_changed(BUSINESS, order('ready'), 'new'))['skipped'], 'error')

    def test_placed_refreshes_apple_only(self):
        h = Harness()
        self.assertTrue(h.run(h.hooks.order_placed(BUSINESS, order('new')))['apple_refreshed'])
        self.assertEqual((h.apple, h.google), (['cust-1'], []))


class AwardTest(unittest.TestCase):
    def test_points_card_earns_once_on_completion(self):
        h = Harness({'card_type': 'points'})
        r = h.run(h.hooks.status_changed(BUSINESS, order('completed'), 'ready'))
        self.assertEqual(r['award'], {'points_earned': 25, 'points_balance': 125})
        self.assertEqual(h.keys, ['menu-order:o1:points'])
        self.assertIn(('wallet_sync', 'points_sale'), h.calls)  # normal wallet refresh ran
        self.assertEqual(h.db.rows[TABLE][0]['result'], {'points_earned': 25, 'points_balance': 125})
        again = h.run(h.hooks.status_changed(BUSINESS, order('completed'), 'ready'))
        self.assertEqual(again['award'], {'skipped': 'already_awarded'})
        self.assertEqual(h.balances['points'], 125)

    def test_stamp_card_and_hybrid(self):
        h = Harness({'card_type': 'stamp'})
        self.assertEqual(h.run(h.hooks.status_changed(BUSINESS, order('completed'), 'ready'))['award'],
                         {'stamps_earned': 1, 'stamp_count': 7})
        hy = Harness({'card_type': 'hybrid'})
        award = hy.run(hy.hooks.status_changed(BUSINESS, order('completed'), 'ready'))['award']
        self.assertEqual((award['points_earned'], award['stamps_earned']), (25, 1))
        self.assertEqual(hy.keys, ['menu-order:o1:points', 'menu-order:o1:stamp'])

    def test_owner_rules_like_once_per_day_are_respected(self):
        h = Harness({'card_type': 'stamp'}, stamp_error=HTTPException(409, 'This customer already received a stamp today.'))
        award = h.run(h.hooks.status_changed(BUSINESS, order('completed'), 'ready'))['award']
        self.assertIn('already received a stamp today', award['stamp_skipped'])

    def test_unpaid_or_no_earning_card_or_cancelled_earns_nothing(self):
        h = Harness({'card_type': 'points'})
        self.assertEqual(h.run(h.hooks.status_changed(BUSINESS, order('completed', payment_status='pending'), 'ready'))['award'],
                         {'skipped': 'not_paid'})
        m = Harness({'card_type': 'membership'})
        self.assertEqual(m.run(m.hooks.status_changed(BUSINESS, order('completed'), 'ready'))['award'],
                         {'skipped': 'card_has_no_purchase_earning'})
        c = Harness({'card_type': 'points'})
        self.assertNotIn('award', c.run(c.hooks.status_changed(BUSINESS, order('cancelled'), 'new')))
        self.assertEqual(c.keys, [])

    def test_failed_award_can_retry_and_idempotency_key_is_stable(self):
        h = Harness({'card_type': 'points'}, points_error=RuntimeError('db down'))
        first = h.run(h.hooks.award(BUSINESS, order('completed'), dict(CUSTOMER)))
        self.assertEqual(first['skipped'], 'error')
        h.points_error = None
        second = h.run(h.hooks.award(BUSINESS, order('completed'), dict(CUSTOMER)))
        self.assertEqual(second['points_earned'], 25)
        self.assertEqual(h.keys, ['menu-order:o1:points', 'menu-order:o1:points'])

    def test_without_table_memory_still_blocks_double_award(self):
        h = Harness({'card_type': 'points'}, db=DB(broken={TABLE}))
        h.run(h.hooks.status_changed(BUSINESS, order('completed'), 'ready'))
        again = h.run(h.hooks.status_changed(BUSINESS, order('completed'), 'ready'))
        self.assertEqual(again['award'], {'skipped': 'already_awarded'})
        self.assertEqual(h.balances['points'], 125)

    def test_tracked_settlement_requires_durable_claim(self):
        db = DB(broken={TABLE})
        h = Harness({'card_type': 'points'}, db=db)
        settlement = order('completed', batch_a_stock_tracked=True, total=450)
        self.assertEqual(h.run(h.hooks.status_changed(BUSINESS, settlement))['skipped'], 'error')
        self.assertEqual(h.keys, [])
        db.broken.clear()
        self.assertEqual(h.run(h.hooks.status_changed(BUSINESS, settlement))['award']['points_earned'], 45)

    def test_tracked_settlement_retries_server_error_and_awards_group_total_once(self):
        h = Harness({'card_type': 'hybrid'}, points_error=HTTPException(503, 'Temporary database error'))
        settlement = order('completed', batch_a_stock_tracked=True, total=450)
        first = h.run(h.hooks.status_changed(BUSINESS, settlement))
        self.assertEqual(first['award']['skipped'], 'error')
        h.points_error = None

        async def retry_concurrently():
            return await asyncio.gather(h.hooks.status_changed(BUSINESS, settlement),
                                        h.hooks.status_changed(BUSINESS, settlement))

        attempted = h.run(retry_concurrently())
        self.assertEqual({r['award'].get('skipped') for r in attempted}, {None, 'already_awarded'})
        self.assertEqual(h.balances, {'points': 145, 'stamps': 7})
        self.assertEqual(h.keys, ['menu-order:o1:points', 'menu-order:o1:points', 'menu-order:o1:stamp'])


class MainWiringTest(unittest.TestCase):
    def test_main_py_hooks(self):
        source = (Path(__file__).resolve().parents[1] / 'main.py').read_text()
        self.assertIn('background_tasks.add_task(_menu_order_wallet.status_changed', source)
        self.assertIn('background_tasks.add_task(_menu_order_wallet.order_placed', source)
        self.assertIn('order_ahead_status_field = _menu_order_wallet_field(customer, business)', source)
        self.assertIn('owner_authorization=_pos_internal_owner_authorization', source)
        self.assertIn("add_points=add_points_sale, add_stamp=add_stamp", source)
        start = source.index('async def owner_update_menu_order_status')
        body = source[start:source.index('\n@app.', start)]
        self.assertIn('background_tasks: BackgroundTasks', body)
        # The wallet work is queued only after the order row is saved.
        self.assertLess(body.index("saved = result['order']"), body.index('_menu_order_wallet.status_changed'))
        self.assertLess(body.index("if not saved:"), body.rindex('_menu_order_wallet.status_changed'))


if __name__ == '__main__':
    unittest.main()
