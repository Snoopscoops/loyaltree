export const BENEFITS_SESSION_KEY = 'lt_benefits_session_v2'
const ATTEMPT_KEY = 'lt_benefits_claim_attempts_v1'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string'
const count = value => Number.isSafeInteger(value) && value >= 0
const date = value => value === null || (text(value) && Number.isFinite(Date.parse(value)))
const rows = (value, check) => Array.isArray(value) && value.every(row => object(row) && check(row))

export function benefitsDemoAllowed({ development = false, hostname = '', search = '' } = {}) {
  return development === true && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) && new URLSearchParams(search).get('demo') === '1'
}

export function benefitsCardReference(search) {
  const params = new URLSearchParams(search)
  const customer_public_id = params.get('card') || ''
  const card_token = params.get('token') || ''
  return /^[A-Za-z0-9_-]{1,100}$/.test(customer_public_id) && /^[A-Za-z0-9._~-]{16,1024}$/.test(card_token) ? { customer_public_id, card_token } : null
}

export function scrubBenefitsReference(url) {
  const clean = new URL(url)
  clean.searchParams.delete('card'); clean.searchParams.delete('token')
  return `${clean.pathname}${clean.search}${clean.hash}`
}

export function safeBenefitsImage(value) {
  if (!text(value)) return ''
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : '' } catch { return '' }
}

export function benefitsEntryUrl(value, origin) {
  if (!text(value) || !value) return ''
  try {
    const base = new URL(origin), url = new URL(value, base)
    const allowed = url.origin === base.origin || ['theloyaltytree.com', 'www.theloyaltytree.com'].includes(url.hostname)
    return allowed && url.pathname === '/benefits' && !url.username && !url.password && (url.protocol === 'https:' || (url.origin === base.origin && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ? url.href : ''
  } catch { return '' }
}

export function validBenefitsConfig(value) { return object(value) && typeof value.enabled === 'boolean' && typeof value.available === 'boolean' }
export function validBenefitsOffers(value) {
  return object(value) && typeof value.has_more === 'boolean' && rows(value.offers, offer => text(offer.id) && text(offer.title) && text(offer.business_slug) && text(offer.business_name) && text(offer.description ?? '') && text(offer.terms ?? '') && count(offer.points_cost) && offer.points_cost > 0 && count(offer.discount_centavos) && offer.discount_centavos > 0 && count(offer.total_quantity) && count(offer.claimed_count) && count(offer.remaining_quantity) && count(offer.per_member_limit) && count(offer.min_spend_centavos) && date(offer.starts_at) && date(offer.ends_at) && text(offer.status))
}
export function validBenefitsMe(value) {
  return object(value) && object(value.member) && text(value.member.id) && text(value.member.email_masked) && Number.isSafeInteger(value.balance_points) && count(value.available_points) && rows(value.cards, card => text(card.customer_public_id) && text(card.business_slug) && text(card.business_name)) && rows(value.coupons, validBenefitsCoupon) && rows(value.activity, item => text(item.id) && text(item.kind) && Number.isSafeInteger(item.points_delta) && date(item.created_at) && text(item.description))
}
export function validBenefitsCoupon(coupon) { return object(coupon) && text(coupon.id) && text(coupon.offer_id) && text(coupon.title) && text(coupon.business_slug) && text(coupon.business_name) && count(coupon.points_cost) && coupon.points_cost > 0 && count(coupon.discount_centavos) && coupon.discount_centavos > 0 && count(coupon.min_spend_centavos) && ['claimed', 'used', 'expired'].includes(coupon.status) && date(coupon.claimed_at) && date(coupon.expires_at) && date(coupon.used_at) }
export function validBenefitsClaim(value) { return object(value) && validBenefitsCoupon(value.coupon) && count(value.balance_points) && count(value.available_points) && typeof value.idempotent_replay === 'boolean' }

export function offerCategory(offer) { return typeof offer.category === 'string' && offer.category.trim() ? offer.category.trim() : 'other' }
export const BENEFITS_CATEGORIES = { all: 'All benefits', food_drink: 'Food & drinks', coffee: 'Coffee', dining: 'Dining', wellness: 'Wellness', shopping: 'Shopping', experiences: 'Experiences', other: 'More discoveries' }
export function filterBenefitsOffers(offers, { category = 'all', search = '', affordable = false, points = 0 } = {}) {
  const query = search.trim().toLocaleLowerCase()
  return offers.filter(offer => (category === 'all' || offerCategory(offer) === category) && (!affordable || offer.points_cost <= points) && (!query || [offer.title, offer.business_name, offer.description, offerCategory(offer)].some(value => String(value || '').toLocaleLowerCase().includes(query))))
}
export function benefitsClaimState(offer, points, now = Date.now()) {
  if (offer.coming_soon === true) return 'coming_soon'
  if (offer.remaining_quantity <= 0) return 'sold_out'
  if (offer.status !== 'active' || (offer.starts_at && Date.parse(offer.starts_at) > now) || (offer.ends_at && Date.parse(offer.ends_at) < now)) return 'closed'
  if (points !== null && offer.points_cost > points) return 'insufficient'
  return 'available'
}
export const benefitPoints = value => Number(value || 0).toLocaleString()
export const benefitMoney = centavos => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(centavos / 100)

export function readBenefitsSession(storage, now = Date.now()) {
  try { const saved = JSON.parse(storage.getItem(BENEFITS_SESSION_KEY)); return object(saved) && text(saved.token) && saved.token.length > 0 && Number.isFinite(saved.expires_at) && saved.expires_at > now ? saved : null } catch { return null }
}
export function saveBenefitsSession(storage, token, expiresIn, now = Date.now()) {
  const saved = { token, expires_at: now + expiresIn * 1000 }
  try { storage.setItem(BENEFITS_SESSION_KEY, JSON.stringify(saved)) } catch { /* A blocked storage does not block this tab's authenticated session. */ }
  return saved
}
export function clearBenefitsSession(storage) { try { storage.removeItem(BENEFITS_SESSION_KEY); storage.removeItem(ATTEMPT_KEY) } catch { /* Storage can be blocked. */ } }

export function benefitsClaimKey(storage, memberId, offerId, createKey) {
  const identity = `${memberId}:${offerId}`
  let attempts = {}
  try { const value = JSON.parse(storage.getItem(ATTEMPT_KEY)); if (object(value)) attempts = value } catch { /* Start a new attempt. */ }
  if (typeof attempts[identity] === 'string') return attempts[identity]
  const key = createKey()
  attempts = { ...Object.fromEntries(Object.entries(attempts).slice(-19)), [identity]: key }
  try { storage.setItem(ATTEMPT_KEY, JSON.stringify(attempts)) } catch { /* The caller also retains this key for retries. */ }
  return key
}
export function clearBenefitsClaimKey(storage, memberId, offerId) {
  try { const attempts = JSON.parse(storage.getItem(ATTEMPT_KEY)); if (object(attempts)) { delete attempts[`${memberId}:${offerId}`]; storage.setItem(ATTEMPT_KEY, JSON.stringify(attempts)) } } catch { /* Best effort only. */ }
}

export function benefitsFailure(status, detail = '') {
  if (status === 401) return 'Open Benefits from your Wallet card and verify again to continue.'
  if (status === 403) return 'This action is unavailable for this account or card.'
  if (status === 429) return 'Please wait a moment before trying again. Too many attempts were made.'
  if (status === 503) return 'Loyalty Tree Benefits is temporarily unavailable. Please try again shortly.'
  if (status === 409) {
    if (/insufficient|not enough|balance/i.test(detail)) return 'You need more LT Points for this benefit. Your balance has been refreshed.'
    if (/stock|quantity|sold out/i.test(detail)) return 'This benefit has just sold out. Your points have not been spent.'
    if (/limit|already claimed/i.test(detail)) return 'You have reached the claim limit for this benefit.'
    if (/email|phone/i.test(detail)) return 'Add a valid email and phone number to this card before connecting Benefits. Ask the business to update your details.'
    return detail || 'This benefit is no longer available to claim. Refresh to see the latest availability.'
  }
  if (status === 400) return 'Please check your details or verification code and try again.'
  return 'We could not complete that request. Please try again. If you were claiming a benefit, retrying uses the same claim reference.'
}

export const BENEFITS_ENTRY_KEY = 'lt_benefits_wallet_entry_v1'
export function readBenefitsEntry(storage) {
  try { const ref = JSON.parse(storage.getItem(BENEFITS_ENTRY_KEY)); return ref && benefitsCardReference(new URLSearchParams({card:ref.customer_public_id,token:ref.card_token}).toString()) } catch { return null }
}
export function saveBenefitsEntry(storage, reference) {
  try { storage.setItem(BENEFITS_ENTRY_KEY, JSON.stringify(reference)) } catch { /* This tab retains the entry in memory. */ }
}
