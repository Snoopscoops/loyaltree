/** Recent menu receipts, scoped to one business and one browser.
 *  Local device storage is not an account. Never persist member card tokens,
 *  buyer name/email, payment secrets or payment references here.
 */
export const RECENT_ORDER_TTL_MS = 3 * 24 * 60 * 60 * 1000
const ORDER_ID = /^[0-9a-f]{32}$/i
const ORDER_NUMBER = /^[a-z0-9-]{3,48}$/i
const STATUSES = new Set(['new','preparing','ready','completed','cancelled'])
const PAYMENTS = new Set(['cash','qrph','card'])
const PAYMENT_STATUSES = new Set(['paid','unpaid','paid_test',''])
const MAX_LINES = 30

export function recentOrderKey(businessId) {
  return `lt-menu-recent-v14:${String(businessId || '')}`
}
const txt = (value, len) => String(value ?? '').slice(0, len)
const amount = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.min(Number(value), 1e7) : 0
function cleanLine(line) {
  if (!line || typeof line !== 'object' || !line.item_id || !line.name) return null
  return {
    item_id: txt(line.item_id, 96), name: txt(line.name, 120),
    quantity: Math.min(20, Math.max(1, Math.floor(Number(line.quantity) || 1))),
    unit_price: amount(line.unit_price),
    options: Array.isArray(line.options) ? line.options.slice(0, 15).map(opt => ({
      public_id: txt(opt?.public_id, 96), name: txt(opt?.name, 100), price_delta: amount(opt?.price_delta),
    })).filter(opt => opt.public_id) : [],
  }
}
function snapshot(order) {
  if (!order || !ORDER_ID.test(String(order.server_order_id || '')) ||
      !ORDER_NUMBER.test(String(order.order_number || '')) ||
      !STATUSES.has(order.status) || !PAYMENTS.has(order.payment_method) ||
      !PAYMENT_STATUSES.has(order.payment_status || '')) return null
  return {
    server_order_id: order.server_order_id, order_number: order.order_number,
    status: order.status, payment_status: order.payment_status || '',
    payment_method: order.payment_method,
    service: order.service === 'dine-in' ? 'dine-in' : 'pickup',
    table_no: txt(order.table_no, 24), pickup_label: txt(order.pickup_label, 64),
    branch_name: txt(order.branch_name, 96),
    subtotal: amount(order.subtotal),
    lines: (Array.isArray(order.lines) ? order.lines : []).slice(0, MAX_LINES).map(cleanLine).filter(Boolean),
  }
}
export function saveRecentOrder(storage, businessId, order, now = Date.now()) {
  if (!storage || !businessId) return false
  const safe = snapshot(order)
  if (!safe) return false
  try {
    storage.setItem(recentOrderKey(businessId), JSON.stringify({ v: 1, at: now, ...safe }))
    return true
  } catch { return false }
}
export function forgetRecentOrder(storage, businessId) {
  try { storage?.removeItem(recentOrderKey(businessId)) } catch { /* storage denied */ }
}
export function readRecentOrder(storage, businessId, now = Date.now()) {
  if (!storage || !businessId) return null
  try {
    const raw = storage.getItem(recentOrderKey(businessId))
    if (!raw || raw.length > 24000) return null
    const parsed = JSON.parse(raw)
    if (parsed?.v !== 1 || !Number.isSafeInteger(parsed.at) || parsed.at > now + 60000 ||
        now - parsed.at > RECENT_ORDER_TTL_MS) {
      forgetRecentOrder(storage, businessId)
      return null
    }
    return snapshot(parsed)
  } catch { forgetRecentOrder(storage, businessId); return null }
}

// Reorders are only a draft cart. Always use today's catalog prices, branch
// availability and valid options; never replay old payment details or submit.
export function buildReorderDraft(lines, items, branchId, isAvailable, addLine) {
  let draft = []
  let skipped = 0
  for (const line of (Array.isArray(lines) ? lines : []).slice(0, MAX_LINES)) {
    const item = (items || []).find(value => value.public_id === line?.item_id)
    if (!item || !isAvailable(item, branchId)) { skipped++; continue }
    const chosen = (line.options || []).map(option => option.public_id)
    const groups = item.modifier_groups || []
    const all = groups.flatMap(group => group.options || [])
    if (chosen.some(id => !all.some(option => option.public_id === id))) { skipped++; continue }
    const selected = Object.fromEntries(groups.map(group => [group.public_id,
      (group.options || []).filter(option => chosen.includes(option.public_id)).map(option => option.public_id)]))
    const incompatible = groups.some(group => {
      const n = selected[group.public_id].length
      return n < Number(group.min_selections || (group.is_required ? 1 : 0)) ||
        (group.max_selections > 0 && n > group.max_selections) ||
        (group.selection_type === 'single' && n > 1)
    })
    if (incompatible) { skipped++; continue }
    draft = addLine(draft, item, selected, line.quantity)
  }
  return { cart: draft, skipped }
}
