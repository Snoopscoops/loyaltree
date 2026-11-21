"""owner-v12: checkout redemption contracts; DB SQL is installed separately by owner.

Actual concurrent Postgres transactions/Wallet delivery must be verified in staging.
"""
from pathlib import Path
from types import SimpleNamespace
import pytest
from fastapi import HTTPException
from backend.menu_checkout_redemption import (
    selected_reward, reward_order_item, reserve_reward_order, finalize_reward_order,
)


CUSTOMER = {'id': 31, 'public_id': 'member-1', 'business_id': 11,
            'points_balance': 180, 'stamp_count': 7, 'card_cycle': 2}
AVAILABLE = [
    {'kind': 'points_prize', 'id': 'latte', 'title': 'Free Latte', 'points_cost': 120},
    {'kind': 'stamp_reward', 'id': '5-stamp', 'title': 'Free Drink', 'required_stamps': 5},
    {'kind': 'coupon', 'public_id': 'coupon-1', 'title': '₱50 off'},
]


def selected(choice, **kw):
    return selected_reward(choice, AVAILABLE, CUSTOMER, {'card_type': 'hybrid'},
                           payment_method=kw.get('payment_method', 'cash'),
                           valid_member=kw.get('valid_member', 'member-1'))


def test_points_cost_and_name_always_come_from_program_not_browser():
    got = selected({'kind': 'points_prize', 'id': 'latte', 'points_cost': 1,
                    'name': '₱10,000 discount'})
    assert got == {'kind': 'points_prize', 'id': 'latte', 'name': 'Free Latte',
                   'points_cost': 120, 'card_cycle': 1, 'required_stamps': 0}
    assert reward_order_item(got)['line_total'] == 0
    assert 'REWARD' in reward_order_item(got)['item_name']


def test_stamp_milestone_claim_preserves_card_cycle():
    got = selected({'kind': 'stamp_reward', 'id': '5-stamp'})
    assert got['required_stamps'] == 5
    assert got['card_cycle'] == 2
    assert got['points_cost'] == 0


@pytest.mark.parametrize('invalid', [
    {'kind': 'coupon', 'id': 'coupon-1'},
    {'kind': 'points_prize', 'id': 'unknown'},
    {'kind': 'stamp_reward', 'id': 'unknown'},
    {'kind': 'points_prize'},
    'latte', [], {},
])
def test_forged_or_unsupported_reward_is_rejected(invalid):
    with pytest.raises(HTTPException) as error:
        selected(invalid)
    assert error.value.status_code in (409, 422)


@pytest.mark.parametrize('method', ['card', 'qrph', '', None])
def test_mock_payments_may_not_redeem_real_rewards(method):
    with pytest.raises(HTTPException) as error:
        selected({'kind': 'points_prize', 'id': 'latte'}, payment_method=method)
    assert error.value.status_code == 409


def test_missing_or_wrong_business_card_is_rejected():
    with pytest.raises(HTTPException) as error:
        selected({'kind': 'points_prize', 'id': 'latte'}, valid_member='other-member')
    assert error.value.status_code == 401


def test_no_reward_does_not_trigger_sql_or_cost():
    assert selected(None) is None


class RPC:
    def __init__(self, value):
        self.value = value
        self.calls = []

    def rpc(self, name, args):
        self.calls.append((name, args))
        return self

    def execute(self):
        return SimpleNamespace(data=self.value)


def test_atomic_sql_reserve_uses_server_approved_values():
    db = RPC({'public_id': 'order-1'})
    reward = selected({'kind': 'points_prize', 'id': 'latte'})
    saved = reserve_reward_order(db, {'public_id': 'order-1'},
                                business_id=11, customer_id=31, reward=reward)
    assert saved['public_id'] == 'order-1'
    name, args = db.calls[0]
    assert name == 'menu_place_cash_reward_order'
    assert args['p_points_cost'] == 120
    assert args['p_business_id'] == 11
    assert args['p_reward_id'] == 'latte'


def test_finish_requires_db_confirmed_return():
    db = RPC({'public_id': 'order-1', 'status': 'completed'})
    assert finalize_reward_order(db, business_id=11, order_public_id='order-1',
                                 target='completed')['status'] == 'completed'
    assert db.calls[0][0] == 'menu_finalize_cash_reward_order'
    with pytest.raises(RuntimeError):
        finalize_reward_order(RPC(None), business_id=11, order_public_id='order-1',
                              target='completed')


def test_sql_contract_guards_payment_idempotency_and_claims():
    sql = (Path(__file__).resolve().parent.parent / 'menu_checkout_redemption.sql').read_text()
    for term in ('FOR UPDATE', 'pg_advisory_xact_lock', 'payment_status',
                 "<>'paid'", 'points_balance', 'stamp_reward_claims',
                 'status=\'redeemed\'', "status='released'", 'REVOKE ALL ON FUNCTION',
                 'service_role', 'menu_order_redemptions'):
        assert term in sql
