"""Minimal, read-only LoyaltyTree rewards snapshot for Digital Menu checkout.

All entitlements come from the existing loyalty engine; this module does not
reserve, spend, or change points, coupons, cash prices, or staff permissions.
"""


def checkout_rewards_payload(customer, program, available_rewards, uses_points, uses_stamps):
    customer = customer or {}
    program = program or {}
    points_enabled = bool(program and uses_points(program))
    stamps_enabled = bool(program and uses_stamps(program))
    points_balance = max(0, int(customer.get('points_balance') or 0)) if points_enabled else None
    stamp_count = max(0, int(customer.get('stamp_count') or 0)) if stamps_enabled else None
    result = []
    seen_prizes = set()
    for reward in (available_rewards or [])[:60]:
        if not isinstance(reward, dict):
            continue
        name = str(reward.get('title') or '').strip()[:140]
        if not name:
            continue
        kind = str(reward.get('kind') or 'reward')[:35]
        detail = str(reward.get('detail') or '').strip()[:180]
        if kind == 'points_prize':
            seen_prizes.add(str(reward.get('id') or ''))
        result.append({'kind': kind, 'name': name, 'detail': detail,
                       'available': True})
    # Show upcoming point prizes as locked, not accidentally redeemable.
    if points_enabled:
        for prize in (program.get('points_prizes') or [])[:40]:
            if not isinstance(prize, dict) or str(prize.get('id') or '') in seen_prizes:
                continue
            name = str(prize.get('name') or '').strip()[:140]
            try:
                cost = int(prize.get('points_cost') or 0)
            except (TypeError, ValueError):
                continue
            if name and cost > 0 and cost > points_balance:
                result.append({'kind': 'points_prize', 'name': name,
                               'detail': f'{cost:,} points', 'available': False})
    return {'points_balance': points_balance, 'stamp_count': stamp_count,
            'points_enabled': points_enabled, 'stamps_enabled': stamps_enabled,
            'rewards': result[:60], 'redemption_mode': 'at_counter',
            'notice': 'Show your reward to the staff. No points or discounts are deducted online.'}
