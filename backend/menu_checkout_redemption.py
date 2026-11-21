"""owner-v12: validate a selected checkout reward against LIVE, merchant-scoped entitlements.

Never trust a prize name, cost, balance, or customer ID sent by the browser.
Nothing is redeemed until the protected owner order status is 'completed' and cash
payment is confirmed. The SQL functions handle concurrent claims transactionally.
"""
from fastapi import HTTPException

SUPPORTED = {'points_prize', 'stamp_reward'}


def selected_reward(selection, available, customer, program, *, payment_method, valid_member):
    if selection in (None, ''):
        return None
    if not isinstance(selection, dict):
        raise HTTPException(422, 'Choose a valid checkout reward.')
    kind = str(selection.get('kind') or '')
    reward_id = str(selection.get('id') or '')
    if kind not in SUPPORTED or not reward_id or len(reward_id) > 100:
        raise HTTPException(422, 'This reward cannot be redeemed at checkout.')
    if payment_method != 'cash':
        raise HTTPException(409, 'Checkout rewards require payment at the counter.')
    if not valid_member or not customer or not program:
        raise HTTPException(401, 'Reconnect your loyalty card to redeem this reward.')
    if str(customer.get('public_id') or '') != str(valid_member):
        raise HTTPException(401, 'The connected card does not match this reward.')
    # Available comes from get_current_card_redeemables, not the client payload.
    matches = [r for r in (available or [])
               if isinstance(r, dict) and r.get('kind') == kind
               and str(r.get('id') or '') == reward_id]
    if len(matches) != 1:
        raise HTTPException(409, 'This reward is no longer available. Refresh checkout.')
    reward = matches[0]
    name = str(reward.get('title') or '').strip()[:120]
    if not name:
        raise HTTPException(409, 'This reward is no longer available.')
    if kind == 'points_prize':
        cost = int(reward.get('points_cost') or 0)
        if cost < 1 or int(customer.get('points_balance') or 0) < cost:
            raise HTTPException(409, 'Not enough points for this reward.')
        return {'kind': kind, 'id': reward_id, 'name': name,
                'points_cost': cost, 'card_cycle': 1, 'required_stamps': 0}
    threshold = int(reward.get('required_stamps') or 0)
    if threshold < 1 or int(customer.get('stamp_count') or 0) < threshold:
        raise HTTPException(409, 'Stamp milestone is no longer available.')
    return {'kind': kind, 'id': reward_id, 'name': name,
            'points_cost': 0, 'card_cycle': max(1, int(customer.get('card_cycle') or 1)),
            'required_stamps': threshold}


def reward_order_item(reward):
    return {'item_name': f"🎁 REWARD: {reward['name']}"[:120],
            'quantity': 1, 'line_total': 0,
            'options': ['Redeems after confirmed payment and completion']}


def is_reward_order(order):
    return bool((order or {}).get('checkout_reward_kind'))


def reserve_reward_order(db, row, *, business_id, customer_id, reward):
    response = db.rpc('menu_place_cash_reward_order', {
        'p_business_id': business_id, 'p_customer_id': customer_id,
        'p_order': row, 'p_kind': reward['kind'], 'p_reward_id': reward['id'],
        'p_reward_name': reward['name'], 'p_points_cost': reward['points_cost'],
        'p_card_cycle': reward['card_cycle'], 'p_required_stamps': reward['required_stamps'],
    }).execute()
    if not isinstance(response.data, dict) or not response.data.get('public_id'):
        raise RuntimeError('Reward order was not saved; database returned no order')
    return response.data


def finalize_reward_order(db, *, business_id, order_public_id, target):
    response = db.rpc('menu_finalize_cash_reward_order', {
        'p_business_id': business_id, 'p_order_public_id': order_public_id,
        'p_target': target,
    }).execute()
    if not isinstance(response.data, dict) or not response.data.get('public_id'):
        raise RuntimeError('Redemption was not confirmed; order was not changed')
    return response.data
