import { requestJsonResponse } from './requestTimeout.js'
import { checkoutRewardSelectionPayload } from './qrMenuRedemption.js'

export function menuItemOfferedAt(item, branchId) {
  if (!branchId || branchId === 'all') return true
  return !(item.unavailable_branch_public_ids || []).includes(branchId)
}
export function menuItemAvailable(item, branchId) {
  return item.is_available !== false && menuItemOfferedAt(item, branchId)
}
export function filterMenuItems(items, category, search) {
  const needle = search.trim().toLocaleLowerCase()
  return items.filter(item => (category === 'all' || item.category_public_id === category) &&
    (!needle || `${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(needle)))
}
export function groupMenuCategories(categories, items, branchId) {
  const grouped = categories.map(category => {
    const members = items.filter(item => item.category_public_id === category.public_id && menuItemOfferedAt(item, branchId))
    const photo = members.find(item => item.image_url && menuItemAvailable(item, branchId)) || members.find(item => item.image_url)
    return { ...category, items: members, image_url: photo?.image_url || '' }
  }).filter(category => category.items.length)
  const knownIds = new Set(categories.map(category => category.public_id))
  const others = items.filter(item => !knownIds.has(item.category_public_id) && menuItemOfferedAt(item, branchId))
  if (others.length) grouped.push({ public_id: '__uncategorized__', name: grouped.length ? 'More' : 'Menu', items: others, image_url: others.find(item => item.image_url)?.image_url || '' })
  return grouped
}
export function toggleMenuOption(selected, group, optionId) {
  if (!group.options.some(option => option.public_id === optionId)) return selected
  const current = selected[group.public_id] || []
  const next = current.includes(optionId) ? current.filter(id => id !== optionId) :
    group.selection_type === 'single' ? [optionId] :
    group.max_selections > 0 && current.length >= group.max_selections ? current : [...current, optionId]
  return { ...selected, [group.public_id]: next }
}
export function menuItemPrice(item, selected) {
  return Number(item.base_price || 0) + (item.modifier_groups || []).reduce((total, group) =>
    total + group.options.filter(option => (selected[group.public_id] || []).includes(option.public_id))
      .reduce((sum, option) => sum + Number(option.price_delta || 0), 0), 0)
}

export function validMenuPayload(value) {
  return Boolean(value?.business?.public_id && value.business.name && Array.isArray(value.items) && Array.isArray(value.categories) && Array.isArray(value.branches))
}

function lineKey(item, selected) {
  const options = (item.modifier_groups || []).flatMap(group =>
    group.options.filter(option => (selected[group.public_id] || []).includes(option.public_id)).map(option => option.public_id))
  return `${item.public_id}|${options.sort().join(',')}`
}

function lineOptions(item, selected) {
  return (item.modifier_groups || []).flatMap(group =>
    group.options.filter(option => (selected[group.public_id] || []).includes(option.public_id))
      .map(option => ({ public_id: option.public_id, name: option.name, price_delta: Number(option.price_delta || 0) })))
}

export function addCartItem(cart, item, selected = {}, quantity = 1) {
  if (!item?.public_id || !menuItemAvailable(item)) return cart
  const qty = Math.max(1, Math.min(20, Math.floor(Number(quantity) || 1)))
  const key = lineKey(item, selected)
  const current = cart.find(line => line.key === key)
  if (current) return cart.map(line => line.key === key ? { ...line, quantity: Math.min(20, line.quantity + qty) } : line)
  return [...cart, {
    key,
    item_id: item.public_id,
    name: item.name,
    unit_price: menuItemPrice(item, selected),
    quantity: qty,
    options: lineOptions(item, selected),
    // Kept only for the cart/receipt thumbnails. Never sent to the server.
    image_url: item.image_url || '',
  }]
}

export function changeCartQuantity(cart, key, quantity) {
  const qty = Math.floor(Number(quantity) || 0)
  if (qty <= 0) return cart.filter(line => line.key !== key)
  return cart.map(line => line.key === key ? { ...line, quantity: Math.min(20, qty) } : line)
}

export function cartSubtotal(cart) {
  return (cart || []).reduce((sum, line) => sum + Number(line.unit_price || 0) * Number(line.quantity || 0), 0)
}

export function buildMenuOrder({ merchantId, cart, orderId }) {
  const items = (cart || []).map(line => ({
    item_id: line.item_id,
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unit_price,
    line_total: Number(line.unit_price || 0) * Number(line.quantity || 0),
    options: line.options || [],
  }))
  return {
    order_id: orderId,
    merchant_id: merchantId,
    items,
    subtotal: cartSubtotal(cart),
    status: 'pending_payment',
  }
}

// No real payments yet. Cash is paid at the counter; QR Ph and card are test
// confirmations. The server decides the stored status from the method.
export const PAYMENT_METHODS = {
  cash: { label: 'Cash', detail: 'Pay at the counter' },
  qrph: { label: 'GCash / Maya / Bank transfer', detail: 'QR Ph · test payment' },
  card: { label: 'Card', detail: 'Test payment · no card details needed' },
}
export function paymentStatusFor(method) {
  if (method === 'cash') return 'unpaid'
  if (method === 'qrph' || method === 'card') return 'paid_test'
  return ''
}
// Cash orders are not prepared until the cashier confirms the payment.
export const CASH_NOTICE = 'Pay at the counter first. Your order will be prepared only after the cashier confirms your payment.'
export function payButtonLabel(method, totalText) {
  if (!PAYMENT_METHODS[method]) return 'Choose how you’ll pay'
  if (method === 'cash') return 'Place order · pay at counter'
  return `Pay ${totalText} (test)`
}
export function receiptCopy(method, totalText, businessName = 'the shop') {
  if (method === 'cash') return {
    waiting: true,
    title: 'Waiting for payment',
    badge: 'Waiting for payment',
    sub: `Show this order number at the counter and pay ${totalText}. The shop will start preparing once the cashier confirms.`,
    totalLabel: 'To pay at the counter',
  }
  return { waiting: false, title: `Order sent to ${businessName}`, badge: 'Order sent', sub: 'The shop has received your order.', totalLabel: 'Total paid' }
}
export function paymentReceiptLabel(method) {
  if (method === 'cash') return 'Cash · Pay at the counter'
  if (method === 'qrph') return 'Paid (test) · GCash / Maya / Bank (QR Ph)'
  if (method === 'card') return 'Paid (test) · Card'
  return 'Paid · test'
}

// The exact body POST /api/v1/public/menu/{public_id}/orders expects.
// Items are reduced to {name, quantity, line_total, options} so cart-only
// fields such as image_url never leave the browser.
export function menuOrderRequest(order) {
  const service = order?.service === 'dine-in' ? 'dine-in' : 'pickup'
  return {
    order_number: order?.order_id || '',
    payment_reference: order?.payment_reference || '',
    buyer_name: order?.buyer_name || '',
    service,
    table_no: service === 'dine-in' ? order?.table_no || '' : '',
    pickup_label: service === 'pickup' ? order?.pickup_label || '' : '',
    // The branch the customer chose, and their connected card (if any) so the
    // shop can see which branch and which members ordered. Both optional.
    branch_public_id: order?.branch_public_id || '',
    card_token: order?.card_token || '',
    payment_method: PAYMENT_METHODS[order?.payment_method] ? order.payment_method : '',
    payment_status: paymentStatusFor(order?.payment_method),
    ...checkoutRewardSelectionPayload(order?.reward_selection, order?.payment_method),
    items: (order?.items || []).map(line => ({
      name: line.name,
      quantity: line.quantity,
      line_total: line.line_total,
      options: line.options || [],
    })),
  }
}

export const MENU_ORDER_OFFLINE = 'We couldn’t send your order. Check your connection and try again.'

function menuOrderServerError(status, payload) {
  const detail = payload?.detail ?? payload?.message
  if (typeof detail === 'string' && detail.trim()) return detail.trim()
  return `We couldn’t save your order${status ? ` (error ${status})` : ''}. Please try again.`
}

// Sends one order and reports whether the shop actually saved it.
// Resolves { ok: true, order } only for a 2xx response; every failure resolves
// { ok: false, error } so the caller can stay on the payment step.
export async function sendMenuOrder({ fetchImpl, url, order, timeoutMs = 15000 }) {
  if (!url) return { ok: false, error: 'Ordering is not available in preview.' }
  if (!order?.items?.length) return { ok: false, error: 'Your cart is empty.' }
  let result
  try {
    result = await requestJsonResponse(fetchImpl, url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(menuOrderRequest(order)),
      cache: 'no-store',
    }, { timeoutMs, message: MENU_ORDER_OFFLINE })
  } catch (error) {
    return { ok: false, error: MENU_ORDER_OFFLINE, cause: error }
  }
  const { response, payload } = result
  if (!response?.ok) return { ok: false, status: response?.status || 0, error: menuOrderServerError(response?.status, payload) }
  return { ok: true, order: payload?.order || null }
}

// "1:30 PM" style label. Built by hand so every browser shows AM/PM.
export function pickupTimeLabel(date) {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return ''
  const hours = value.getHours()
  return `${hours % 12 || 12}:${String(value.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`
}

// Which branch the menu shows. No "All branches": with 2+ branches the
// customer must pick one (?branch=); with exactly one it is chosen for them.
export function resolveMenuBranch(branches, requested) {
  const list = Array.isArray(branches) ? branches : []
  const wanted = String(requested || '')
  if (list.length === 0) return { branchId: '', needsBranch: false, showSelector: false, invalidBranch: false }
  if (list.length === 1) return { branchId: list[0].public_id, needsBranch: false, showSelector: false, invalidBranch: false }
  const valid = list.some(branch => branch.public_id === wanted)
  return { branchId: valid ? wanted : '', needsBranch: !valid, showSelector: true, invalidBranch: Boolean(wanted) && !valid }
}

export function digitalMenuHref(config, slug) {
  if (config?.digital_menu_published !== true) return ''
  const id = String(config.public_id || slug || '').trim()
  return id ? `/menu/${encodeURIComponent(id)}` : ''
}
