"""Connected-card Digital Menu snapshot: merchant-validated eligibility + choice IDs.

This GET endpoint itself never reserves or spends rewards. owner-v12 separately
reserves only eligible points prizes/stamp milestones on a CASH order and
redeems only upon staff-confirmed paid+completed via a restricted database RPC.
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
        selectable = (kind in ('points_prize', 'stamp_reward')
                      and bool(str(reward.get('id') or '').strip()))
        result.append({'kind': kind, 'id': str(reward.get('id') or '')[:100] if selectable else '',
                       'name': name, 'detail': detail, 'available': True,
                       'selectable': selectable})
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
                               'detail': f'{cost:,} points', 'available': False,
                               'selectable': False, 'id': ''})
    card_type = str(program.get('card_type') or '').lower()[:32]
    raw_goal = program.get('stamp_goal') if stamps_enabled else None
    try:
        stamp_goal = max(1, min(9999, int(raw_goal))) if raw_goal is not None and int(raw_goal) > 0 else None
    except (TypeError, ValueError, OverflowError):
        stamp_goal = None
    card_name = str(program.get('name') or program.get('program_name') or 'Loyalty card')[:100]
    return {'card_type': card_type, 'card_name': card_name, 'stamp_goal': stamp_goal,
            'points_balance': points_balance, 'stamp_count': stamp_count,
            'points_enabled': points_enabled, 'stamps_enabled': stamps_enabled,
            'rewards': result[:60], 'redemption_mode': 'checkout_cash_only',
            'notice': 'Choose one Points or Stamp reward for cash checkout. Redeemed only after confirmed payment and completion. No price discounts are applied online.'}
