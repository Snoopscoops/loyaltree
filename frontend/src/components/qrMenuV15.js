/** owner-v15 display-only helpers. No order/payment mutation or synthetic balances. */
export function loyaltyProgress(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return { type: 'unknown', label: 'Connect your card', filled: 0, goal: 0 }
  const stamps = snapshot.stamps_enabled && Number.isSafeInteger(snapshot.stamp_count) && snapshot.stamp_count >= 0
  const goal = snapshot.stamps_enabled && Number.isSafeInteger(snapshot.stamp_goal) && snapshot.stamp_goal > 0 ? snapshot.stamp_goal : 0
  if (stamps && goal) return { type: 'stamps', label: `${snapshot.stamp_count} of ${goal} stamps`, filled: Math.min(snapshot.stamp_count, goal), goal }
  if (stamps) return { type: 'stamps', label: `${snapshot.stamp_count} stamps`, filled: 0, goal: 0 }
  if (snapshot.points_enabled && Number.isSafeInteger(snapshot.points_balance) && snapshot.points_balance >= 0)
    return { type: 'points', label: `${snapshot.points_balance.toLocaleString()} points`, filled: 0, goal: 0 }
  return { type: 'other', label: 'View your card details', filled: 0, goal: 0 }
}
export function historyEvents(events, filter = 'all') {
  if (!Array.isArray(events)) return []
  return events.filter(e => e && typeof e === 'object' && ['earned', 'redeemed'].includes(e.type) &&
    (filter === 'all' || filter === e.type)).slice(0, 40)
}
export function quickReorderItems(lines, items, branchId, available, buildDraft, addLine) {
  if (!Array.isArray(lines) || !Array.isArray(items)) return []
  const seen = new Set()
  const result = []
  for (const line of lines.slice(0, 16)) {
    const product = items.find(i => i.public_id === line?.item_id)
    if (!product || seen.has(product.public_id) || !available(product, branchId)) continue
    const draft = buildDraft([line], items, branchId, available, addLine)
    if (!draft.cart.length || draft.skipped) continue
    seen.add(product.public_id)
    result.push({ item: product, line, draft: draft.cart })
    if (result.length === 3) break
  }
  return result
}
export function canQuickAdd(groups, selected) {
  if (!Array.isArray(groups)) return true
  if (groups.length > 2 || groups.some(g => !Array.isArray(g.options) || g.options.length > 6)) return false
  return groups.every(group => {
    const chosen = selected[group.public_id] || []
    const valid = chosen.every(id => group.options.some(opt => opt.public_id === id))
    const required = Math.max(0, Number(group.min_selections || (group.is_required ? 1 : 0)))
    const max = Number(group.max_selections || 0)
    return valid && chosen.length >= required && (!max || chosen.length <= max) &&
      (group.selection_type !== 'single' || chosen.length <= 1)
  })
}
