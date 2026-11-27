import ast
import asyncio
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.testclient import TestClient

from backend.menu_order_access import check_order_branch
from backend.menu_order_adjustment_routes import register_menu_order_adjustment_routes, transition_counter_order
from backend.menu_checkout_redemption import reward_order_item
from backend.menu_order_insights import cash_awaiting_payment, payment_fields
from backend.tests.test_menu_order_insights import DB, Result


BUSINESS = {'id': 1, 'public_id': 'shop'}
SCOPE = {'role': 'cashier', 'staff_id': 15, 'branch': 'main'}
ROOT = 'a' * 32
CHILD = 'b' * 32
OTHER = 'c' * 32
LINE = 'd' * 32


def cash_order(public_id, **changes):
    return dict({
        'public_id': public_id, 'business_id': 1, 'branch_public_id': 'main',
        'service': 'dine-in', 'payment_status': 'unpaid', 'payment_method': 'cash',
        'status': 'new', 'batch_a_stock_tracked': True, 'total': 50,
        'items': [{'item_id': 'latte', 'line_id': LINE, 'item_name': 'Latte',
                   'quantity': 2, 'unit_price': 25, 'line_total': 50, 'options': []}],
    }, **changes)


def operator(public_id, authorization):
    if authorization not in ('Bearer cashier', 'Bearer owner', 'Bearer manager'):
        raise HTTPException(401, 'Session expired.')
    if public_id != BUSINESS['public_id']:
        raise HTTPException(403, 'Session does not match this business.')
    return BUSINESS, (dict(SCOPE, role='owner', staff_id=None) if authorization == 'Bearer owner' else dict(SCOPE, role='manager', staff_id=16) if authorization == 'Bearer manager' else SCOPE)


class AdjustmentDB(DB):
    def __init__(self):
        self.root = cash_order(ROOT, payment_status='paid', status='preparing')
        self.child = cash_order(CHILD, parent_order_public_id=ROOT)
        super().__init__({'menu_counter_orders': [
            self.root, self.child, cash_order(OTHER, branch_public_id='other'),
        ]})
        self.calls = []
        self.replay = False
        self.error = None
        self.transition = None

    def rpc(self, name, params):
        self.calls.append((name, params))
        if self.error is not None:
            raise self.error
        if name == 'menu_create_counter_suborder':
            order = params['p_order']
            if 'items' not in order and not self.replay:
                data = None
            else:
                data = {'order': self.child, 'changed': not self.replay}
        elif name == 'menu_void_counter_order_item':
            data = {'order': self.child, 'changed': True}
        else:
            assert name == 'menu_transition_counter_order'
            data = self.transition
        return SimpleNamespace(execute=lambda: Result(data))


@pytest.fixture
def routes():
    app = FastAPI()
    db = AdjustmentDB()
    prices = []
    pushes = []

    def normalize_items(items):
        return [{'item_id': item['item_id'], 'quantity': item['quantity'], 'options': []} for item in items]

    def price_items(business, branch, items):
        prices.append((business, branch, items))
        return db.child['items'], 50

    register_menu_order_adjustment_routes(app, db=db, operator=operator, normalize_items=normalize_items,
        price_items=price_items, order_public=dict, push_order=lambda *args: pushes.append(args))
    return TestClient(app), db, prices, pushes


def path(order=ROOT, action='sub-orders', slug='shop'):
    return f'/api/v1/business/{slug}/menu-orders/{order}/{action}'


def test_child_reprices_in_its_parent_branch_and_replay_does_not_renotify(routes):
    client, db, prices, pushes = routes
    payload = {'request_id': str(uuid4()), 'items': [{'item_id': 'latte', 'quantity': 2, 'unit_price': 0}],
               'branch_public_id': 'other', 'payment_status': 'paid', 'customer_note': ' add milk '}
    headers = {'Authorization': 'Bearer cashier'}
    response = client.post(path(), json=payload, headers=headers)
    assert response.status_code == 200
    assert response.json()['order']['payment_status'] == 'unpaid'
    assert response.json()['order']['parent_order_public_id'] == ROOT
    probe, save = [params for _, params in db.calls]
    assert probe['p_order'] == {'request_items': [{'item_id': 'latte', 'quantity': 2, 'options': []}],
                                'customer_note': 'add milk'}
    assert save['p_order']['total'] == 50
    assert save['p_branch'] == 'main'
    assert save['p_actor'] == 'cashier:15'
    assert len(prices) == len(pushes) == 1
    db.replay = True
    assert client.post(path(), json=payload, headers=headers).status_code == 200
    assert len(prices) == len(pushes) == 1
    assert len(db.calls) == 3


@pytest.mark.parametrize(('order_id', 'slug', 'token', 'status'), [
    (ROOT, 'shop', '', 401),
    (ROOT, 'other-business', 'Bearer cashier', 403),
    (OTHER, 'shop', 'Bearer cashier', 403),
    (CHILD, 'shop', 'Bearer cashier', 409),
])
def test_suborder_rejects_unauthorized_or_nested_request_before_rpc(routes, order_id, slug, token, status):
    client, db, prices, _ = routes
    response = client.post(path(order_id, slug=slug), headers={'Authorization': token},
        json={'request_id': str(uuid4()), 'items': [{'item_id': 'latte', 'quantity': 1}]})
    assert response.status_code == status
    assert not db.calls and not prices


@pytest.mark.parametrize(('token', 'actor'), [('owner', 'owner'), ('manager', 'manager:16')])
def test_void_uses_validated_line_quantity_reason_and_scoped_actor(routes, token, actor):
    client, db, _, _ = routes
    payload = {'request_id': str(uuid4()), 'line_id': LINE, 'quantity': 1, 'reason': ' wrong item '}
    assert client.patch(path(CHILD, 'void-item'), headers={'Authorization': 'Bearer cashier'}, json=payload).status_code == 403
    assert not db.calls
    headers = {'Authorization': 'Bearer ' + token}
    assert client.patch(path(CHILD, 'void-item'), headers=headers, json={**payload, 'quantity': True}).status_code == 400
    assert client.patch(path(CHILD, 'void-item'), headers=headers, json={**payload, 'reason': ' '}).status_code == 400
    assert client.patch(path(OTHER, 'void-item'), headers=headers, json=payload).status_code == 403
    assert not db.calls
    assert client.patch(path(CHILD, 'void-item'), headers=headers, json=payload).status_code == 200
    assert db.calls == [('menu_void_counter_order_item', {
        'p_business_id': 1, 'p_branch': 'main', 'p_order_public_id': CHILD,
        'p_request_id': payload['request_id'], 'p_line_id': LINE, 'p_quantity': 1,
        'p_reason': 'wrong item', 'p_actor': actor,
    })]


@pytest.fixture
def status_handlers():
    db = AdjustmentDB()
    notices = []
    source_path = Path(__file__).resolve().parents[1] / 'main.py'
    names = {'owner_update_menu_order_status', '_menu_counter_order_public', 'public_place_menu_order'}
    definitions = [node for node in ast.parse(source_path.read_text()).body if getattr(node, 'name', '') in names]
    for node in definitions:
        node.decorator_list = []

    def read_first(result):
        return dict(result.data[0]) if result.data else None

    scope = dict(asyncio=asyncio, supabase=db, HTTPException=HTTPException, Request=Request,
        BackgroundTasks=BackgroundTasks, Header=Header, transition_counter_order=transition_counter_order,
        _menu_order_operator=operator, _supabase_first_row=read_first, _menu_order_check_branch=check_order_branch,
        _menu_order_cash_unpaid=cash_awaiting_payment, _menu_has_reward=lambda row: bool(row.get('checkout_reward_kind')),
        _menu_order_wallet=SimpleNamespace(status_changed=lambda *args: notices.append(args)))
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(source_path), 'exec'), scope)
    return scope, db, notices


async def set_status(scope, order_id, status):
    async def body():
        return {'status': status}
    tasks = BackgroundTasks()
    response = await scope['owner_update_menu_order_status'](
        'shop', order_id, SimpleNamespace(json=body), tasks, 'Bearer cashier')
    await tasks()
    return response


def test_only_root_completion_dispatches_the_aggregate_loyalty_award(status_handlers):
    scope, db, notices = status_handlers
    db.child['payment_status'] = 'paid'
    db.transition = {'order': dict(db.child, status='completed'), 'loyalty_order': None,
                     'changed': True, 'previous_status': 'ready'}
    assert asyncio.run(set_status(scope, CHILD, 'completed'))['order']['total'] == 50
    assert not notices
    settlement = dict(db.root, status='completed', total=100, member_customer_public_id='card')
    db.transition = {'order': dict(db.root, status='completed'), 'loyalty_order': settlement,
                     'changed': True, 'previous_status': 'ready'}
    assert asyncio.run(set_status(scope, ROOT, 'completed'))['order']['total'] == 50
    assert notices == [(BUSINESS, settlement, '')]
    db.transition.update(changed=False, previous_status='completed')
    asyncio.run(set_status(scope, ROOT, 'completed'))
    assert notices[-1] == (BUSINESS, settlement, '')


def test_cashier_capabilities_expose_canonical_ids_and_stay_off_public_payloads(status_handlers):
    scope, db, _ = status_handlers
    render = scope['_menu_counter_order_public']
    staff_root = render(db.root, staff=True)
    assert staff_root['can_create_suborder'] and not staff_root['can_void_items'] and not staff_root['can_cancel']
    staff_child = render(db.child, staff=True)
    assert staff_child['parent_order_public_id'] == ROOT and not staff_child['can_create_suborder']
    assert staff_child['can_void_items'] and staff_child['can_cancel']
    assert staff_child['items'][0]['line_id'] == LINE
    public = render(db.root)
    assert 'can_create_suborder' not in public and 'line_id' not in public['items'][0]


def test_legacy_cash_completion_preserves_the_existing_workflow(status_handlers):
    scope, db, notices = status_handlers
    db.root.update(batch_a_stock_tracked=False, status='ready')
    result = asyncio.run(set_status(scope, ROOT, 'completed'))
    assert result['order']['status'] == 'completed' and result['order']['total'] == 50
    assert db.calls == []
    assert notices == [(BUSINESS, db.root, 'ready')]


def test_reward_cash_cancellation_uses_the_locking_rpc(status_handlers):
    scope, db, _ = status_handlers
    db.root.update(batch_a_stock_tracked=False, checkout_reward_kind='points_prize',
                   status='new', payment_status='unpaid')
    db.transition = {'order': dict(db.root, status='cancelled'), 'changed': True, 'previous_status': 'new'}
    result = asyncio.run(set_status(scope, ROOT, 'cancelled'))
    assert result['order']['status'] == 'cancelled'
    assert db.calls == [('menu_transition_counter_order', {
        'p_business_id': 1, 'p_branch': 'main', 'p_order_public_id': ROOT, 'p_target': 'cancelled',
        'p_actor': 'cashier:15', 'p_reason': 'Cancelled at the counter',
    })]


def test_reward_checkout_retries_use_identical_priced_items(status_handlers):
    scope, _, _ = status_handlers
    reward = {'kind': 'points_prize', 'id': 'latte-reward', 'name': 'Free Latte'}
    pending = []

    def reserve(db, row, **kwargs):
        pending.append(row)
        return pending[0]

    def price(*_):
        return [dict(cash_order(ROOT)['items'][0], line_id=uuid4().hex)], 50

    scope.update({
        'datetime': datetime, 'timezone': timezone, 'math': math, 'uuid': uuid,
        'safe_get_business': lambda _: BUSINESS, 'safe_get_customer': lambda _: {'id': 2, 'business_id': 1},
        'safe_get_customer_program': lambda *_: {}, 'get_current_card_redeemables': lambda *_: [],
        '_menu_order_resolve_branch': lambda *_: ('main', 'Main'), '_menu_order_payment': payment_fields,
        '_menu_order_member': lambda *_: 'member', '_menu_card_read_token': None,
        '_menu_reward_select': lambda *_, **__: reward, '_menu_reward_line': reward_order_item,
        '_menu_price_counter_items': price, '_menu_reward_reserve': reserve, 'friendly_db_error': str,
        '_menu_order_push': lambda *_: None,
        '_menu_order_wallet': SimpleNamespace(order_placed=lambda *_: None),
    })

    async def body():
        return {'service': 'dine-in', 'payment_method': 'cash', 'order_number': 'LT-RETRY',
                'items': [{'item_id': 'latte', 'quantity': 2}], 'reward_selection': reward}

    async def place_twice():
        for _ in range(2):
            response = await scope['public_place_menu_order']('shop', SimpleNamespace(json=body), BackgroundTasks())
            assert response['success']

    asyncio.run(place_twice())
    assert pending[0]['public_id'] != pending[1]['public_id']
    assert pending[0]['items'] == pending[1]['items']
    assert 'line_id' not in pending[0]['items'][0]
