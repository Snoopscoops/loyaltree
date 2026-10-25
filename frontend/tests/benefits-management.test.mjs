import test from 'node:test'
import assert from 'node:assert/strict'
import { benefitCentavos, benefitImage, benefitMoney, benefitOfferForm, benefitOfferPayload, benefitRequestError, benefitSettingsPayload, benefitUseCheck, newBenefitOffer, validBenefitCoupons, validBenefitOffers } from '../src/components/benefitsManagementModel.js'
import { BENEFIT_PHOTO_MAX_BYTES, uploadBenefitPhoto } from '../src/components/benefitPhotoUpload.js'

const ready = () => ({ ...newBenefitOffer(), title: 'Twenty pesos off', discount_php: '20.00', points_cost: '20', total_quantity: '100' })

test('peso entry uses exact centavos and rejects ambiguous, negative or unsafe amounts', () => {
  assert.equal(benefitCentavos('19.99'), 1999)
  assert.equal(benefitCentavos('0'), 0)
  assert.equal(benefitCentavos('20.5'), 2050)
  for (const value of ['', '-1', 'NaN', '1e3', '1,000', '2.001', Infinity, '99999999999999999999']) assert.equal(benefitCentavos(value), null)
  assert.match(benefitMoney(1999), /19\.99/)
  assert.equal(benefitMoney(undefined), '—')
})

test('offer creation sends canonical centavos, stock, category and finite claim dates only', () => {
  const { payload } = benefitOfferPayload({ ...ready(), description: ' Members only ', min_spend_php: '150.50', starts_at: '2026-10-21T09:00', ends_at: '2026-10-31T18:00', image_url: 'https://example.com/photo.jpg' })
  assert.equal(payload.discount_centavos, 2000)
  assert.equal(payload.min_spend_centavos, 15050)
  assert.equal(payload.points_cost, 20)
  assert.equal(payload.total_quantity, 100)
  assert.equal(payload.per_member_limit, 1)
  assert.equal(payload.weekly_limit, null)
  assert.equal(payload.coupon_valid_days, 30)
  assert.equal(payload.description, 'Members only')
  assert.equal(payload.category, 'food_drink')
  assert.ok(Date.parse(payload.ends_at) > Date.parse(payload.starts_at))
  assert.equal(payload.discount_php, undefined)
  assert.equal(payload.id, undefined)
})

test('weekly offer limits survive create and edit and can be cleared without changing minimum spend', () => {
  const { payload } = benefitOfferPayload({ ...ready(), min_spend_php: '150.50', weekly_limit: '5' })
  assert.equal(payload.weekly_limit, 5)
  assert.equal(payload.min_spend_centavos, 15050)
  const form = benefitOfferForm({ ...payload, id: 'existing-offer' })
  assert.equal(form.weekly_limit, 5)
  assert.equal(form.min_spend_php, '150.50')
  assert.equal(benefitOfferPayload(form).payload.weekly_limit, 5)
  form.weekly_limit = ''
  assert.equal(benefitOfferPayload(form).payload.weekly_limit, null)
  assert.equal(benefitOfferPayload(form).payload.min_spend_centavos, 15050)
  assert.equal(benefitOfferForm({ ...payload, weekly_limit: null }).weekly_limit, '')
  for (const weekly_limit of ['0', '-1', '1.2', '1e2', '1000001', ' ']) assert.ok(benefitOfferPayload({ ...ready(), weekly_limit }).error)
})

const signature = { cloud_name: 'sample-cloud', api_key: 'public-key', timestamp: 123, signature: 'signed-upload', folder: 'lt-benefits/cafe', upload_preset: 'images' }
const uploadedImage = 'https://res.cloudinary.com/sample-cloud/image/upload/v1/lt-benefits/cafe/photo.png'

test('uploaded photo uses a signed direct upload and saves an HTTPS URL in both create and edit', async () => {
  const file = new Blob(['synthetic-image'], { type: 'image/png' })
  const calls = []
  const image = await uploadBenefitPhoto({ file, businessSlug: 'cafe',
    request: async (path, options) => { calls.push({ path, options }); return signature },
    send: async (url, options) => {
      assert.equal(url, 'https://api.cloudinary.com/v1_1/sample-cloud/image/upload')
      assert.equal(options.method, 'POST')
      assert.equal(options.headers, undefined)
      assert.equal(options.body.get('signature'), signature.signature)
      assert.equal(options.body.get('file').size, file.size)
      assert.equal(options.body.get('Authorization'), null)
      return { ok: true, json: async () => ({ secure_url: uploadedImage }) }
    } })
  assert.equal(calls[0].path, '/api/v1/business/cafe/cloudinary-signature?purpose=lt_benefits')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(image, uploadedImage)
  const offer = benefitOfferPayload({ ...ready(), image_url: image }).payload
  assert.equal(offer.image_url, uploadedImage)
  assert.equal(benefitOfferPayload(benefitOfferForm(offer)).payload.image_url, uploadedImage)
})

test('invalid uploads and provider failures cannot save data URLs or unexpected upload hosts', async () => {
  let signed = 0
  const request = async () => { signed++; return signature }
  for (const file of [new Blob(['x'], { type: 'image/svg+xml' }), new Blob([], { type: 'image/png' }), { type: 'image/jpeg', size: BENEFIT_PHOTO_MAX_BYTES + 1 }]) {
    await assert.rejects(uploadBenefitPhoto({ file, businessSlug: 'cafe', request }), /photo/)
  }
  assert.equal(signed, 0)
  const file = new Blob(['x'], { type: 'image/png' })
  for (const secure_url of ['data:image/png;base64,abc', 'http://res.cloudinary.com/sample-cloud/image/upload/x', 'https://example.com/photo.png', 'https://res.cloudinary.com/other/image/upload/photo.png']) {
    await assert.rejects(uploadBenefitPhoto({ file, businessSlug: 'cafe', request, send: async () => ({ ok: true, json: async () => ({ secure_url }) }) }), /URL/)
  }
  await assert.rejects(uploadBenefitPhoto({ file, businessSlug: 'cafe', request, send: async () => ({ ok: false, json: async () => ({ error: { message: 'provider details' } }) }) }), /Could not upload/)
  assert.ok(benefitOfferPayload({ ...ready(), image_url: 'data:image/png;base64,abc' }).error)
  assert.equal(benefitImage('https://example.com/a b.png'), '')
})

test('invalid offer values fail before sending and do not silently round points or money', () => {
  for (const change of [{ title: '' }, { points_cost: '1.2' }, { points_cost: '1e2' }, { total_quantity: '0' }, { discount_php: '0' }, { min_spend_php: '-1' }, { per_member_limit: '101' }, { coupon_valid_days: '0' }, { category: 'arbitrary' }, { image_url: 'javascript:alert(1)' }, { starts_at: '2026-10-31T18:00', ends_at: '2026-10-21T09:00' }]) assert.ok(benefitOfferPayload({ ...ready(), ...change }).error, JSON.stringify(change))
})

test('editing a live offer makes an independent payload without mutating a claimed coupon snapshot', () => {
  const coupon = Object.freeze({ title: 'Original title', discount_centavos: 2000, points_cost: 20, min_spend_centavos: 10000, terms: 'Original terms', expires_at: '2026-11-20T00:00:00Z' })
  const offer = { ...coupon, id: 'offer-1', total_quantity: 100, remaining_quantity: 98, claimed_count: 2, per_member_limit: 1, coupon_valid_days: 30, category: 'food_drink', status: 'active', starts_at: null, ends_at: null }
  const form = benefitOfferForm(offer)
  form.title = 'Future title'; form.discount_php = '30'; form.terms = 'Future terms'
  const { payload } = benefitOfferPayload(form)
  assert.equal(payload.title, 'Future title')
  assert.equal(payload.discount_centavos, 3000)
  assert.equal(payload.expires_at, undefined)
  assert.equal(payload.claimed_count, undefined)
  assert.equal(coupon.title, 'Original title')
  assert.equal(coupon.discount_centavos, 2000)
})

test('cashier validates the saved coupon minimum, expiry and status before confirmation', () => {
  const coupon = { status: 'claimed', discount_centavos: 2000, min_spend_centavos: 15000, expires_at: '2026-10-22T00:00:00Z' }
  const now = Date.parse('2026-10-21T00:00:00Z')
  assert.equal(benefitUseCheck(coupon, '150', now), '')
  assert.match(benefitUseCheck(coupon, '149.99', now), /minimum spend/)
  assert.match(benefitUseCheck(coupon, '', now), /bill amount/)
  assert.match(benefitUseCheck(coupon, '150', Date.parse(coupon.expires_at)), /expired/)
  assert.match(benefitUseCheck({ ...coupon, status: 'used' }, '150', now), /not available/)
  assert.match(benefitUseCheck({ ...coupon, min_spend_centavos: 0 }, '10', now), /full coupon discount/)
  assert.match(benefitUseCheck({ ...coupon, expires_at: 'invalid' }, '150', now), /expired/)
})

test('admin earning rate is independent from merchant coupon value', () => {
  const { payload } = benefitSettingsPayload({ enabled: true, pesos_per_point: '500', max_points_per_transaction: '' })
  assert.deepEqual(payload, { enabled: true, pesos_per_point: 500, max_points_per_transaction: null })
  assert.equal(payload.cash_value, undefined)
  assert.equal(payload.discount_centavos, undefined)
  assert.equal(benefitSettingsPayload({ enabled: true, pesos_per_point: '500', max_points_per_transaction: '10' }).payload.max_points_per_transaction, 10)
  for (const rate of ['0', '1.5', '1e3', '-1']) assert.ok(benefitSettingsPayload({ pesos_per_point: rate }).error)
  assert.ok(benefitSettingsPayload({ pesos_per_point: '500', max_points_per_transaction: '-1' }).error)
  assert.ok(benefitSettingsPayload({ pesos_per_point: '1000001', max_points_per_transaction: '' }).error)
  assert.ok(benefitSettingsPayload({ pesos_per_point: '500', max_points_per_transaction: '1000001' }).error)
  assert.deepEqual(benefitSettingsPayload({ enabled: true, pesos_per_point: '1000000', max_points_per_transaction: '1000000' }).payload, { enabled: true, pesos_per_point: 1000000, max_points_per_transaction: 1000000 })
})

test('disabled, unauthorized and malformed responses provide safe states', () => {
  assert.match(benefitRequestError(503, { detail: 'private upstream error' }), /unavailable/)
  assert.doesNotMatch(benefitRequestError(503, { detail: 'private upstream error' }), /upstream/)
  assert.match(benefitRequestError(401), /sign in/)
  assert.match(benefitRequestError(403), /access/)
  assert.equal(benefitRequestError(409, { detail: 'Already used.' }), 'Already used.')
  assert.equal(validBenefitOffers({ offers: [] }), true)
  assert.equal(validBenefitOffers({ offers: [null] }), false)
  assert.equal(validBenefitCoupons({ linked: false, coupons: [] }), true)
  assert.equal(validBenefitCoupons({ linked: true, coupons: [{}] }), false)
  assert.equal(benefitImage('https://user:secret@example.com/photo.jpg'), '')
  assert.equal(benefitImage('http://example.com/photo.jpg'), '')
  assert.equal(benefitImage('https://example.com/photo.jpg'), 'https://example.com/photo.jpg')
})
