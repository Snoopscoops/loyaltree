// Billing credentials stay in this tab's session storage and only go to LT.
export const ONBOARDING_SESSION_KEY = 'loyaltree_pending_onboarding'
export const PENDING_PAYMENT_KEY = 'loyaltree_paymongo_pending_card'

function tabStorage() {
  try { return globalThis.sessionStorage } catch { return null }
}

function readStored(key, storage) {
  try { return JSON.parse(storage?.getItem(key) || 'null') } catch { return null }
}

function writeStored(key, value, storage) {
  try {
    if (!storage) return false
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch { return false }
}

export function readOnboardingSession(storage = tabStorage()) {
  const value = readStored(ONBOARDING_SESSION_KEY, storage)
  return typeof value?.business_slug === 'string' && value.business_slug ? value : null
}

export function saveOnboardingSession(value, storage = tabStorage()) {
  // Never persist the registration password, agreement, contact details or an
  // owner session. This capability can only read billing/start payment.
  return writeStored(ONBOARDING_SESSION_KEY, {
    business_slug: value.business_slug,
    billing_token: value.billing_token || '',
    trial: value.trial || null,
    billing_cycle: value.billing_cycle,
    pricing_region: value.pricing_region,
    started_at: value.started_at || new Date().toISOString(),
  }, storage)
}

export function clearOnboardingSession(storage = tabStorage()) {
  try { storage?.removeItem(ONBOARDING_SESSION_KEY) } catch { /* storage unavailable */ }
}

export function readPendingPayment(businessSlug, storage = tabStorage()) {
  const value = readStored(PENDING_PAYMENT_KEY, storage)
  return value?.businessSlug === businessSlug && typeof value?.payment_intent_id === 'string'
    && value.payment_intent_id ? value : null
}

export function readPaymentReturn(search, businessSlug) {
  const params = new URLSearchParams(search)
  const slug = params.get('business_slug') || ''
  const intent = params.get('payment_intent') || ''
  if (params.get('paymongo_return') !== '1' || !/^[a-zA-Z0-9_-]{1,200}$/.test(slug)
      || !/^pi_[a-zA-Z0-9_-]{1,128}$/.test(intent) || (businessSlug && slug !== businessSlug)) return null
  // Public routing context only. The server must still verify owner credentials
  // or the billing capability and its exact payment-attempt scope.
  return { business_slug: slug, payment_intent_id: intent }
}

export function pendingPaymentForReturn(businessSlug, search, storage = tabStorage()) {
  const returned = readPaymentReturn(search, businessSlug)
  const pending = readPendingPayment(businessSlug, storage)
  if (!returned || pending?.payment_intent_id === returned.payment_intent_id) return pending
  return { businessSlug, payment_intent_id: returned.payment_intent_id, payment_method: 'card' }
}

export function clearPaymentReturnUrl(href, businessSlug) {
  const url = new URL(href)
  if (!readPaymentReturn(url.search, businessSlug)) return href
  for (const key of ['paymongo_return', 'payment_intent', 'business_slug']) url.searchParams.delete(key)
  return url.toString()
}

export function savePendingPayment(businessSlug, payment, storage = tabStorage()) {
  const fields = ['payment_intent_id', 'payment_method', 'display_amount', 'display_currency',
    'processor_amount', 'processor_currency', 'plan_label', 'billing_cycle_label',
    'amount', 'currency', 'qr_image_url', 'expires_at', 'review_required']
  return writeStored(PENDING_PAYMENT_KEY, {
    businessSlug,
    ...Object.fromEntries(fields.filter(key => payment[key] != null).map(key => [key, payment[key]])),
  }, storage)
}

export function clearPendingPayment(storage = tabStorage()) {
  try { storage?.removeItem(PENDING_PAYMENT_KEY) } catch { /* storage unavailable */ }
}

export class BillingRequestError extends Error {
  constructor(message, status = 0) { super(message); this.status = status }
}

async function requestJson(fetchImpl, url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, { ...options, credentials: 'omit', cache: 'no-store',
      redirect: 'error', signal: controller.signal })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = payload?.detail
      throw new BillingRequestError(response.status === 401
        ? 'Your billing session has expired. Please verify your account to continue.'
        : typeof detail === 'string' ? detail : detail?.message || 'Billing is temporarily unavailable. Please try again.', response.status)
    }
    if (payload == null) throw new BillingRequestError('Billing returned an invalid response. Please try again.')
    return payload
  } catch (error) {
    if (error instanceof BillingRequestError) throw error
    throw new BillingRequestError(error?.name === 'AbortError'
      ? 'Billing is taking too long. Please try again.'
      : 'Unable to reach billing. Please try again.')
  } finally { clearTimeout(timer) }
}

export function requestBilling(fetchImpl, { API_BASE, businessSlug, sessionToken, path = '', timeoutMs = 30000, ...options }) {
  if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
    return Promise.reject(new BillingRequestError('Please verify your account before continuing to billing.', 401))
  }
  if (!['', '/checkout', '/payments'].includes(path) && !/^\/payments\/[^/?#]+$/.test(path)) {
    return Promise.reject(new BillingRequestError('Invalid billing request.'))
  }
  return requestJson(fetchImpl, `${API_BASE.replace(/\/$/, '')}/api/v1/business/${encodeURIComponent(businessSlug)}/subscription${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
  }, timeoutMs)
}

export function requestBillingHistory(fetchImpl, options, onboarding = false) {
  return onboarding ? Promise.resolve([]) : requestBilling(fetchImpl, { ...options, path: '/payments' })
}

export function requestPaymentStatus(fetchImpl, options, intentId) {
  return requestBilling(fetchImpl, { ...options, path: `/payments/${encodeURIComponent(intentId)}` })
}

export function paymentNeedsReview(payment) {
  return payment?.fulfillment_status === 'legacy_review' || payment?.status === 'review_required'
}

export async function renewBillingSession(fetchImpl, API_BASE, { email, password, payment_intent_id }) {
  try {
    return await requestJson(fetchImpl, `${API_BASE.replace(/\/$/, '')}/api/v1/auth/billing-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ...(payment_intent_id ? { payment_intent_id } : {}) }),
    })
  } catch (error) {
    if (error.status === 401) throw new BillingRequestError('We could not verify those account details. Check your business email and password.', 401)
    throw error
  }
}
