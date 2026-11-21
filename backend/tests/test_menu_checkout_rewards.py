"""owner-v12: reward snapshots distinguish available, selectable and locked prizes."""
from backend.menu_checkout_rewards import checkout_rewards_payload


def _points(program):
    return bool(program.get('points_enabled'))


def _stamps(program):
    return bool(program.get('stamps_enabled'))


def test_available_and_locked_prizes():
    program = {'points_enabled': True, 'stamps_enabled': True, 'points_prizes': [
        {'id': 'a', 'name': 'Free latte', 'points_cost': 100},
        {'id': 'b', 'name': 'Free cake', 'points_cost': 300},
    ]}
    value = checkout_rewards_payload({'points_balance': 150, 'stamp_count': 7}, program,
        [{'kind': 'points_prize', 'id': 'a', 'title': 'Free latte', 'detail': '100 points'},
         {'kind': 'stamp_reward', 'title': 'Free drink', 'detail': '5 stamps'}], _points, _stamps)
    assert value['points_balance'] == 150
    assert value['stamp_count'] == 7
    assert [(r['name'], r['available']) for r in value['rewards']] == [
        ('Free latte', True), ('Free drink', True), ('Free cake', False)]
    assert value['redemption_mode'] == 'checkout_cash_only'
    assert value['rewards'][0]['id'] == 'a'
    assert value['rewards'][0]['selectable'] is True
    assert value['rewards'][1]['selectable'] is False  # fixture has no stable milestone id
    assert value['rewards'][2]['selectable'] is False


def test_missing_program_does_not_expose_balances():
    value = checkout_rewards_payload({'points_balance': 700}, {}, [], _points, _stamps)
    assert value['points_balance'] is None
    assert value['rewards'] == []


def test_malformed_price_and_no_mutation():
    program = {'points_enabled': True, 'points_prizes': [
        {'id': 'bad', 'name': 'Bad price', 'points_cost': 'n/a'}]}
    member = {'points_balance': 22}
    value = checkout_rewards_payload(member, program, [{'kind': 'coupon', 'title': 'Welcome discount'}], _points, _stamps)
    assert value['rewards'][0]['name'] == 'Welcome discount'
    assert len(value['rewards']) == 1
    assert member['points_balance'] == 22


def test_verified_member_route_is_business_scoped(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.menu_card_link import register_menu_card_routes, sign
    monkeypatch.setenv('LT_BENEFITS_AUTH_SECRET', 'a-valid-test-secret-longer-than-24-characters')
    api = FastAPI()
    register_menu_card_routes(api, db=None, get_business=lambda p: {'id': 10, 'public_id': p, 'status': 'ACTIVE'},
        has_feature=lambda b, name: True, on_hold=lambda b: False, send_email=lambda *args: True, frontend_url='',
        get_customer_by_public_id=lambda public_id: {'public_id': public_id, 'business_id': 10, 'points_balance': 42},
        get_program=lambda customer, business_id: {'points_enabled': True, 'points_prizes': []},
        get_redeemables=lambda b, c, p: [], uses_points=_points, uses_stamps=_stamps)
    client = TestClient(api)
    assert client.get('/api/v1/public/menu/merchant/card/rewards').status_code == 401
    import time
    token = sign({'kind': 'session', 'business_public_id': 'merchant', 'customer_public_id': 'member',
                  'exp': int(time.time()) + 100})
    result = client.get('/api/v1/public/menu/merchant/card/rewards', headers={'Authorization': 'Bearer ' + token})
    assert result.status_code == 200
    assert result.json()['points_balance'] == 42
    assert result.headers.get('cache-control') == 'private, no-store'
    assert client.get('/api/v1/public/menu/other/card/rewards', headers={'Authorization': 'Bearer ' + token}).status_code == 401
