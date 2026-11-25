import { requestJsonResponse } from './requestTimeout.js'

export function canAddToOrder(order, family, branchId) {
  return Boolean(order?.addon_token && family?.can_add === true &&
    family.parent?.public_id === order.server_order_id && family.branch_public_id === branchId &&
    ['new', 'preparing', 'ready'].includes(family.parent?.status) &&
    ['new', 'preparing', 'ready'].includes(order.status))
}

export async function addonRequest({ fetchImpl, apiBase, businessId, order, payload, signal }) {
  if (!apiBase || !order?.addon_token || !/^[a-f0-9]{32}$/.test(order.server_order_id || '')) throw new Error('Order receipt unavailable.')
  const url = `${apiBase.replace(/\/$/, '')}/api/v1/public/menu/${encodeURIComponent(businessId)}/orders/${encodeURIComponent(order.server_order_id)}/${payload ? 'sub-orders' : 'family'}`
  const { response, payload: data } = await requestJsonResponse(fetchImpl, url, {
    method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${order.addon_token}`, 'Content-Type': 'application/json' },
    ...(payload ? { body: JSON.stringify(payload) } : {}), cache: 'no-store', signal,
  }, { timeoutMs: 15000, message: 'Connection interrupted. Retry the same add-on.' })
  if (!response?.ok || !data || (payload ? !data.order?.public_id : data.parent?.public_id !== order.server_order_id || !Array.isArray(data.children))) {
    const error = new Error(typeof data?.detail === 'string' ? data.detail : 'Could not verify the add-on. Please retry.')
    error.status = response?.ok ? 0 : response?.status || 0
    throw error
  }
  return data
}
