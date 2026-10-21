export const BENEFIT_CATEGORIES = [{ value: 'food_drink', label: 'Food & drink' }, { value: 'shopping', label: 'Shopping' }, { value: 'wellness', label: 'Wellness' }, { value: 'experiences', label: 'Experiences' }, { value: 'other', label: 'Other' }]

export const newBenefitOffer = () => ({ title: '', description: '', terms: '', image_url: '', category: 'food_drink', discount_php: '', points_cost: '', total_quantity: '', min_spend_php: '0', per_member_limit: '1', coupon_valid_days: '30', starts_at: '', ends_at: '', status: 'active' })

// Parse currency as decimal text, never binary floating point or scientific notation.
export function benefitCentavos(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(amount) ? amount : null
}

export const benefitMoney = centavos => Number.isSafeInteger(centavos) && centavos >= 0 ? new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(centavos / 100) : '—'
export const benefitNumber = value => Number.isFinite(value) ? value.toLocaleString('en-PH') : '—'
export const benefitDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

export function benefitImage(value) {
  if (!value) return ''
  if (String(value).startsWith('data:image/')) return value
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : '' } catch { return '' }
}

const integer = (value, minimum = 1) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum
const localDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null

export function benefitOfferPayload(form) {
  const title = String(form.title || '').trim()
  if (!title || title.length > 120) return { error: 'Enter a coupon title of up to 120 characters.' }
  if (!integer(form.points_cost) || !integer(form.total_quantity) || !integer(form.per_member_limit) || !integer(form.coupon_valid_days)) return { error: 'Points cost, quantity, validity and member limit must be positive whole numbers.' }
  if (Number(form.points_cost) > 10000000 || Number(form.total_quantity) > 1000000 || Number(form.per_member_limit) > 100 || Number(form.coupon_valid_days) > 365) return { error: 'Use at most 10,000,000 points, 1,000,000 coupons, 100 claims per member and 365 valid days.' }
  if (Number(form.per_member_limit) > Number(form.total_quantity)) return { error: 'The member limit cannot exceed the total quantity.' }
  const discount = benefitCentavos(form.discount_php), minimum = benefitCentavos(form.min_spend_php)
  if (discount == null || discount < 1 || minimum == null) return { error: 'Enter a positive peso discount and a valid minimum spend, using up to two decimal places.' }
  if (discount > 100000000 || minimum > 100000000) return { error: 'Coupon discount and minimum spend cannot exceed ₱1,000,000.' }
  if (String(form.description || '').trim().length > 2000 || String(form.terms || '').trim().length > 3000) return { error: 'Keep the description within 2,000 characters and terms within 3,000 characters.' }
  const startsAt = localDate(form.starts_at), endsAt = localDate(form.ends_at)
  if ((form.starts_at && !startsAt) || (form.ends_at && !endsAt)) return { error: 'Enter valid start and end dates.' }
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return { error: 'The end date must be after the start date.' }
  const image = String(form.image_url || '').trim()
  if (image && !benefitImage(image)) return { error: 'Use a valid HTTPS photo URL without embedded sign-in details.' }
  if (!['draft', 'active', 'paused'].includes(form.status)) return { error: 'Choose a valid offer status.' }
  if (!BENEFIT_CATEGORIES.some(item => item.value === form.category)) return { error: 'Choose a valid coupon category.' }
  return { payload: { title, description: String(form.description || '').trim(), terms: String(form.terms || '').trim(), image_url: image || null, category: form.category, discount_centavos: discount, points_cost: Number(form.points_cost), total_quantity: Number(form.total_quantity), min_spend_centavos: minimum, per_member_limit: Number(form.per_member_limit), coupon_valid_days: Number(form.coupon_valid_days), starts_at: startsAt, ends_at: endsAt, status: form.status } }
}

function dateInput(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function benefitOfferForm(offer) {
  return { ...newBenefitOffer(), ...offer, discount_php: Number.isSafeInteger(offer.discount_centavos) ? (offer.discount_centavos / 100).toFixed(2) : '', min_spend_php: Number.isSafeInteger(offer.min_spend_centavos) ? (offer.min_spend_centavos / 100).toFixed(2) : '0', starts_at: dateInput(offer.starts_at), ends_at: dateInput(offer.ends_at) }
}

export function benefitRequestError(status, body) {
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'Your account does not have access to these LT Rewards.'
  if (status === 503) return 'LT Rewards is currently unavailable. Try again later or contact support.'
  if (status === 404) return 'This LT Reward could not be found. Refresh the list and try again.'
  if (status === 422) return 'Check the coupon fields and amounts, then try again.'
  if (typeof body?.detail === 'string' && body.detail.length <= 400 && status === 409) return body.detail
  return 'Could not complete the LT Rewards request. Please try again.'
}

export function validBenefitOffers(value) {
  return !!value && Array.isArray(value.offers) && value.offers.every(row => row && (typeof row.id === 'string' || Number.isInteger(row.id)) && typeof row.title === 'string' && Number.isSafeInteger(row.points_cost) && row.points_cost > 0 && Number.isSafeInteger(row.total_quantity) && row.total_quantity > 0 && Number.isSafeInteger(row.remaining_quantity) && row.remaining_quantity >= 0 && Number.isSafeInteger(row.discount_centavos) && row.discount_centavos > 0 && Number.isSafeInteger(row.min_spend_centavos) && row.min_spend_centavos >= 0 && ['draft', 'active', 'paused'].includes(row.status))
}

export function validBenefitCoupons(value) {
  return !!value && typeof value.linked === 'boolean' && Array.isArray(value.coupons) && value.coupons.every(row => row && (typeof row.id === 'string' || Number.isInteger(row.id)) && typeof row.title === 'string' && typeof row.status === 'string' && Number.isSafeInteger(row.discount_centavos) && row.discount_centavos > 0 && Number.isSafeInteger(row.min_spend_centavos) && row.min_spend_centavos >= 0 && Number.isSafeInteger(row.points_cost) && row.points_cost > 0)
}

export function benefitUseCheck(coupon, bill, now = Date.now()) {
  if (!coupon || coupon.status !== 'claimed') return 'This coupon is not available to use.'
  if (coupon.expires_at && (!Number.isFinite(Date.parse(coupon.expires_at)) || Date.parse(coupon.expires_at) <= now)) return 'This coupon has expired.'
  const amount = benefitCentavos(bill)
  if (amount == null || amount <= 0) return 'Enter the bill amount before applying this coupon.'
  if (Number.isSafeInteger(coupon.min_spend_centavos) && amount < coupon.min_spend_centavos) return `The minimum spend is ${benefitMoney(coupon.min_spend_centavos)}.`
  if (Number.isSafeInteger(coupon.discount_centavos) && amount < coupon.discount_centavos) return 'The bill must cover the full coupon discount.'
  return ''
}

export function benefitSettingsPayload(form) {
  if (!integer(form.pesos_per_point)) return { error: 'Pesos per LT Point must be a positive whole number.' }
  if (Number(form.pesos_per_point) > 1000000) return { error: 'Pesos per LT Point cannot exceed ₱1,000,000.' }
  if (form.max_points_per_transaction !== '' && form.max_points_per_transaction != null && !integer(form.max_points_per_transaction)) return { error: 'The transaction cap must be blank or a positive whole number.' }
  if (Number(form.max_points_per_transaction) > 1000000) return { error: 'The transaction cap cannot exceed 1,000,000 LT Points.' }
  return { payload: { enabled: !!form.enabled, pesos_per_point: Number(form.pesos_per_point), max_points_per_transaction: form.max_points_per_transaction === '' || form.max_points_per_transaction == null ? null : Number(form.max_points_per_transaction) } }
}
