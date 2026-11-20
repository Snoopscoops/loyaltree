// "Welcome back" on the tap/scan page (/join/:slug).
//
// The page can only know a card is connected on THIS phone and browser:
// - lt-join-card:<business>   saved when the customer joins on this page
// - lt-menu-card:<business>   saved when they connect their card on the digital menu
//   (plus lt-menu-card-name:<business> for the first name)
// A new phone, another browser, private mode or cleared site data shows Join again.

export const joinCardKey = id => `lt-join-card:${id}`
export const menuCardKey = id => `lt-menu-card:${id}`
export const menuCardNameKey = id => `lt-menu-card-name:${id}`

const ids = list => [...new Set((list || []).map(value => String(value || '').trim()).filter(Boolean))]

function safeGet(storage, key) {
  try { return storage?.getItem(key) || '' } catch { return '' }
}

export function readKnownCard(storage, businessIds) {
  for (const id of ids(businessIds)) {
    const raw = safeGet(storage, joinCardKey(id))
    if (raw) {
      try {
        const saved = JSON.parse(raw)
        if (saved && typeof saved.customerId === 'string' && saved.customerId) {
          return { businessId: id, customerId: saved.customerId, name: String(saved.name || ''), token: safeGet(storage, menuCardKey(id)) }
        }
      } catch { /* bad value; ignore it */ }
    }
    const token = safeGet(storage, menuCardKey(id))
    if (token) return { businessId: id, customerId: '', name: safeGet(storage, menuCardNameKey(id)), token }
  }
  return null
}

export function rememberJoinedCard(storage, businessId, customerId, name) {
  if (!businessId || !customerId) return
  try { storage?.setItem(joinCardKey(businessId), JSON.stringify({ customerId: String(customerId), name: String(name || '').slice(0, 80), savedAt: new Date().toISOString() })) } catch { /* storage is optional */ }
}

export function forgetKnownCard(storage, businessIds) {
  for (const id of ids(businessIds)) {
    for (const key of [joinCardKey(id), menuCardKey(id), menuCardNameKey(id)]) {
      try { storage?.removeItem(key) } catch { /* ignore */ }
    }
  }
}

export function firstName(name) {
  const clean = String(name || '').trim()
  if (!clean || clean.toLowerCase() === 'loyalty card' || clean.toLowerCase() === 'customer') return ''
  return clean.split(/\s+/)[0].slice(0, 30)
}

export function welcomeTitle(name) {
  const first = firstName(name)
  return first ? `Welcome back, ${first}!` : 'Welcome back!'
}

// Card progress from GET /api/v1/customer/{id}. Returns null when unknown.
export function cardProgress(payload) {
  const customer = payload?.customer || {}
  const program = payload?.program || {}
  const type = String(payload?.current_card_type || program.card_type || '')
  const loyalty = type === 'hybrid' ? String(program.hybrid_loyalty_type || '') : type
  if (loyalty === 'stamp') {
    const current = Math.max(0, parseInt(customer.stamp_count, 10) || 0)
    const goals = [parseInt(program.stamp_goal, 10) || 0, ...(Array.isArray(program.stamp_rewards) ? program.stamp_rewards.map(r => parseInt(r?.stamps, 10) || 0) : [])].filter(n => n > 0)
    const goal = goals.length ? Math.max(...goals) : 8
    const shown = Math.min(current, goal)
    return { label: `${shown} / ${goal} stamps`, percent: Math.round((shown / goal) * 100), note: current >= goal ? 'Reward ready. Show your card at the counter.' : `${goal - shown} more to your reward` }
  }
  if (loyalty === 'points') {
    const balance = Math.max(0, parseInt(customer.points_balance, 10) || 0)
    return { label: `${balance.toLocaleString('en-PH')} ${balance === 1 ? 'point' : 'points'}`, percent: null, note: '' }
  }
  return null
}

// The customer belongs to this business (ignore a stale id from another shop).
export function sameBusiness(payload, businessIds) {
  const owner = String(payload?.business?.public_id || '')
  return !owner || ids(businessIds).includes(owner)
}
