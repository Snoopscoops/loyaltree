// owner-v12: UI eligibility only; backend always independently verifies live entitlement.
export function checkoutRewardIsEligible(reward) {
  return Boolean(reward && reward.available === true && reward.selectable === true
    && typeof reward.id === 'string' && reward.id.length > 0
    && (reward.kind === 'points_prize' || reward.kind === 'stamp_reward'))
}

export function checkoutRewardSelectionPayload(selection, paymentMethod) {
  if (paymentMethod !== 'cash' || !selection ||
      !['points_prize', 'stamp_reward'].includes(selection.kind) ||
      typeof selection.id !== 'string' || !selection.id) return {}
  return { reward_selection: { kind: selection.kind, id: selection.id } }
}
