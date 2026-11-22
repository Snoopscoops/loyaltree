"""Contracts for owner-v12.2; a real Postgres acceptance test is still needed."""
import asyncio
from pathlib import Path

from backend.menu_order_wallet import make_menu_order_wallet


class DB:
    class Table:
        def insert(self, *_): return self
        def update(self, *_): return self
        def eq(self, *_): return self
        def execute(self): return type('R', (), {'data': []})()
    def table(self, _): return self.Table()


def test_final_stamp_reset_order_does_not_earn_stamp_again():
    called = []
    async def auth(_): return 'owner'
    async def stamp(*_, **__):
        called.append('stamp')
        return {'stamp_count': 1}
    async def points(*_, **__):
        called.append('points')
        return {'points_earned': 2}
    cls = make_menu_order_wallet(
        db=DB(), get_customer=lambda _: {'public_id': 'member', 'business_id': 10},
        get_program=lambda *args: {'card_type': 'stamp'},
        uses_points=lambda _: False, uses_stamps=lambda _: True,
        owner_authorization=auth, add_points=points, add_stamp=stamp,
        points_request=lambda **kw: kw, stamp_request=lambda **kw: kw,
        apple_refresh=lambda _: None, google_message=lambda *args: None,
    )
    order = dict(public_id='order', status='completed', payment_status='paid', total=200,
                 member_customer_public_id='member', _stamp_cycle_reset=True)
    result = asyncio.run(cls.status_changed({'id':10, 'public_id':'merchant'}, order, 'ready'))
    assert called == []
    assert result['award']['stamp_skipped'] == 'final_stamp_reward_cycle_reset'


def test_non_reset_order_still_earns_and_points_untouched():
    called = []
    async def auth(_): return 'owner'
    async def stamp(*_, **__):
        called.append('stamp')
        return {'stamp_count': 2}
    async def points(*_, **__):
        called.append('points')
        return {'points_earned': 3}
    cls = make_menu_order_wallet(
        db=DB(), get_customer=lambda _: {'public_id': 'member', 'business_id': 10},
        get_program=lambda *args: {'card_type': 'hybrid'},
        uses_points=lambda _: True, uses_stamps=lambda _: True,
        owner_authorization=auth, add_points=points, add_stamp=stamp,
        points_request=lambda **kw: kw, stamp_request=lambda **kw: kw,
        apple_refresh=lambda _: None, google_message=lambda *args: None,
    )
    order = dict(public_id='order-2', status='completed', payment_status='paid', total=200,
                 member_customer_public_id='member', _stamp_cycle_reset=False)
    result = asyncio.run(cls.status_changed({'id':10, 'public_id':'merchant'}, order, 'ready'))
    assert called == ['points', 'stamp']
    assert result['award']['stamps_earned'] == 1
    assert result['award']['points_earned'] == 3


def test_sql_is_atomic_gated_and_only_resets_final_standalone_stamp():
    sql = (Path(__file__).resolve().parents[1] / 'menu_checkout_stamp_reset_v12_2.sql').read_text()
    assertions = (
        'CREATE OR REPLACE FUNCTION public.menu_finalize_cash_reward_order',
        "v_program.card_type='stamp'",
        'v_program.stamp_reset_after_final IS NOT FALSE',
        'v_reward.required_stamps = v_final_stamps',
        'v_customer.program_id',
        'FOR UPDATE',
        "v_reward.status<>'pending'",
        "v_order.payment_status<>'paid'",
        'stamp_reward_claims',
        'SET stamp_count=0',
        'card_cycle=v_reward.card_cycle+1',
        'reward_unlocked=false',
        'last_card_reset_at=now()',
        "v_reward.kind='points_prize'",
        "status='redeemed'",
        "_stamp_cycle_reset",
        'Another stamp reward order is pending',
        'TO service_role',
        'BEGIN;',
        'COMMIT;',
    )
    for phrase in assertions:
        assert phrase in sql, phrase
    # New function must not change the order's price or point awards.
    assert 'total=0' not in sql
    assert "UPDATE public.customers SET points_balance=points_balance-v_reward.points_cost" in sql
    assert 'UPDATE public.menu_order_redemptions' in sql


def test_owner_order_status_wiring_keeps_atomic_result_marker():
    main = (Path(__file__).resolve().parents[1] / 'main.py').read_text()
    start = main.index('async def owner_update_menu_order_status(')
    body = main[start:main.index('\n@app.', start)]
    assert 'saved = _menu_reward_finish(' in body
    assert '{**(current_order or {}), **saved}' in body
    assert 'background_tasks.add_task(_menu_order_wallet.status_changed' in body
