import { requestJsonResponse } from './requestTimeout.js'

export const ORDER_TRACKING_STEPS = ['Waiting for acceptance', 'Preparing your order', 'Order done']
const ORDER_ID = /^[0-9a-f]{32}$/i
const VALID_STATUS = new Set(['new', 'preparing', 'ready', 'completed', 'cancelled'])

// The server is authoritative. Cash payments must be confirmed before preparation.
export function menuOrderPhase(order = {}) {
  const status = String(order?.status || 'new').toLowerCase()
  const cashUnpaid = order?.payment_method === 'cash' && order?.payment_status !== 'paid'
  const pickup = order?.service !== 'dine-in'
  if (status === 'cancelled') return { stage: -1, title: 'Order cancelled', sub: 'Please speak to the counter for help.', cancelled: true }
  if (status === 'completed') return { stage: 2, title: 'Order completed', sub: 'Thank you for ordering with us!', done: true }
  if (status === 'ready') return { stage: 2, title: 'Order done', sub: pickup ? 'Your order is ready for pickup.' : 'Your order is ready and will be brought to your table.', done: true }
  if (status === 'preparing') return { stage: 1, title: 'Preparing your order', sub: 'The shop accepted your order and is preparing it now.' }
  if (cashUnpaid) return { stage: 0, title: 'Waiting for payment', sub: 'Show your order number at the counter. The kitchen starts after payment is confirmed.', awaitingPayment: true }
  return { stage: 0, title: 'Waiting for order acceptance', sub: 'Order received. We will update this screen when the shop accepts it.' }
}

// This endpoint reveals only stage/payment status, not name, items, card token or reward.
export async function fetchMenuOrderPhase({ fetchImpl, apiBase, businessId, orderId, signal, timeoutMs = 8000 }) {
  if (!ORDER_ID.test(String(orderId || '')) || !businessId || !apiBase) throw new Error('Order tracking unavailable')
  const url = `${apiBase.replace(/\/$/, '')}/api/v1/public/menu/${encodeURIComponent(businessId)}/orders/${encodeURIComponent(orderId)}/status`
  const { response, payload } = await requestJsonResponse(fetchImpl, url, {
    method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal,
  }, { signal, timeoutMs, message: 'Tracking temporarily unavailable' })
  if (!response?.ok || !payload || !VALID_STATUS.has(payload.status) ||
      !['paid', 'unpaid', 'paid_test', ''].includes(payload.payment_status)) {
    throw new Error('Tracking temporarily unavailable')
  }
  return { status: payload.status, payment_status: payload.payment_status }
}
