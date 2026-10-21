import { benefitsDemoAllowed } from '../src/components/benefitsModel.js'

// Local preview only: fictional brands and benefits, no native network transport.
export function createBenefitsDemo({ development, hostname, search, latency = 100 } = {}) {
  if (!benefitsDemoAllowed({ development, hostname, search })) throw new Error('Benefits demo is available only in local development.')
  const scenario = new URLSearchParams(search).get('demo_state')
  const now = Date.now()
  const date = days => new Date(now + days * 86400000).toISOString()
  const token = 'local-demo-benefits-session'
  const photos = {
    coffee: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=1000&q=85',
    pastry: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=1000&q=85',
    wellness: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1000&q=85',
    coffee_pair: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1000&q=85',
  }
  let offers = [
    { id: '00000000-0000-4000-8000-000000000001', business_slug: 'demo-northstar', business_name: 'Northstar Coffee', title: 'Your next coffee, on us.', description: 'A handcrafted iced or hot latte. A small pause, made a little sweeter.', category: 'coffee', image_url: photos.coffee, discount_centavos: 15000, points_cost: 40, total_quantity: 100, claimed_count: 27, remaining_quantity: 73, per_member_limit: 2, min_spend_centavos: 0 },
    { id: '00000000-0000-4000-8000-000000000002', business_slug: 'demo-northstar', business_name: 'Northstar Coffee', title: 'A buttery little bonus.', description: 'A freshly baked croissant with your favorite coffee. Go on, make a morning of it.', category: 'food_drink', image_url: photos.pastry, discount_centavos: 9500, points_cost: 25, total_quantity: 80, claimed_count: 29, remaining_quantity: 51, per_member_limit: 2, min_spend_centavos: 15000 },
    { id: '00000000-0000-4000-8000-000000000003', business_slug: 'demo-moss', business_name: 'Moss Wellness', title: 'Make room for a reset.', description: 'A little time for you. Enjoy a complimentary 30-minute relaxation session.', category: 'wellness', image_url: photos.wellness, discount_centavos: 35000, points_cost: 100, total_quantity: 30, claimed_count: 12, remaining_quantity: 18, per_member_limit: 1, min_spend_centavos: 0 },
    { id: '00000000-0000-4000-8000-000000000004', business_slug: 'demo-northstar', business_name: 'Northstar Coffee', title: 'Good coffee. Better company.', description: 'Bring your favorite person. Two signature drinks, one lovely little catch-up.', category: 'experiences', image_url: photos.coffee_pair, discount_centavos: 28000, points_cost: 75, total_quantity: 60, claimed_count: 19, remaining_quantity: 41, per_member_limit: 1, min_spend_centavos: 0 },
  ].map(offer => ({ ...offer, terms: 'Fictional local demo offer only. Show a linked loyalty card to the participating merchant. Cannot be exchanged for cash or combined with another promotion. Available while quantities last.', business_logo_url: null, coupon_valid_days: 30, starts_at: date(-2), ends_at: date(30), status: 'active' }))
  if (scenario === 'empty') offers = []
  if (scenario === 'soldout') offers = offers.map(offer => ({ ...offer, remaining_quantity: 0, claimed_count: offer.total_quantity }))
  const makeCoupon = (offer, id, status = 'claimed') => ({ id, offer_id: offer.id, title: offer.title, business_slug: offer.business_slug, business_name: offer.business_name, points_cost: offer.points_cost, discount_centavos: offer.discount_centavos, min_spend_centavos: offer.min_spend_centavos, status, claimed_at: date(-1), expires_at: date(30), used_at: status === 'used' ? date(-0.5) : null })
  const me = {
    member: { id: 'demo-benefits-member', email_masked: 'h***@example.test' }, balance_points: 260, available_points: 260,
    cards: [{ customer_public_id: 'demo-northstar-card', business_slug: 'demo-northstar', business_name: 'Northstar Coffee' }, { customer_public_id: 'demo-moss-card', business_slug: 'demo-moss', business_name: 'Moss Wellness' }],
    coupons: offers.length ? [makeCoupon(offers[1], 'demo-saved-coupon'), { ...makeCoupon(offers[2], 'demo-used-coupon', 'used'), title: 'A little moment of calm.', points_cost: 35 }] : [],
    activity: [{ id: 'demo-earn-1', kind: 'earn', points_delta: 200, created_at: date(-4), description: 'LT Points from eligible purchases' }, { id: 'demo-earn-2', kind: 'earn', points_delta: 120, created_at: date(-2), description: 'LT Points from eligible purchases' }, { id: 'demo-claim-1', kind: 'claim', points_delta: -25, created_at: date(-1), description: 'Claimed a Northstar Coffee benefit' }, { id: 'demo-claim-2', kind: 'claim', points_delta: -35, created_at: date(-1), description: 'Claimed a Moss Wellness benefit' }], has_more: false,
  }
  const claims = new Map()
  let sequence = 0
  return async (path, options = {}) => {
    if (latency) await new Promise(resolve => setTimeout(resolve, latency))
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const url = new URL(`https://local-fixture.invalid${path}`)
    const endpoint = url.pathname
    const done = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const body = typeof options.body === 'string' ? JSON.parse(options.body || '{}') : {}
    const method = options.method || 'GET'
    if (endpoint === '/config' && method === 'GET') return done({ enabled: scenario !== 'disabled', available: scenario !== 'unavailable', pesos_per_point: 500, currency: 'PHP' })
    if (scenario === 'offline') return done({ detail: 'Demo service unavailable.' }, 503)
    if (endpoint === '/entry' && method === 'POST') return done({email_masked:'h***@e***',business_name:'Northstar Coffee',verified:options.headers?.Authorization === `Bearer ${token}`})
    if (endpoint === '/offers' && method === 'GET') {
      if (options.headers?.Authorization !== `Bearer ${token}`) return done({detail:'Open your Wallet card and verify.'},401)
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 24)
      return done({ offers: offers.slice(offset, offset + limit), offset, limit, has_more: offers.length > offset + limit })
    }
    if (endpoint === '/auth/request-code' && method === 'POST') return body.consent && body.customer_public_id && body.card_token && !body.email ? done({ challenge_id: 'demo-challenge', expires_in: 600, retry_after: 1, message: 'Demo only. No email was sent.' }) : done({ detail: 'Consent required.' }, 400)
    if (endpoint === '/auth/verify' && method === 'POST') return body.challenge_id === 'demo-challenge' && body.code === '123456' ? done({ access_token: token, token_type: 'bearer', expires_in: 604800, member: me.member, linked: true, customer_public_id: 'demo-northstar-card' }) : done({ detail: 'Invalid verification code.' }, 400)
    if (options.headers?.Authorization !== `Bearer ${token}`) return done({ detail: 'Benefits session required.' }, 401)
    if (endpoint === '/me' && method === 'GET') return done(me)
    if (endpoint === '/logout' && method === 'POST') return done({ logged_out: true })
    if (endpoint === '/link' && method === 'POST') return done({ linked: true, card: me.cards[0] })
    const claim = endpoint.match(/^\/offers\/([^/]+)\/claim$/)
    if (claim && method === 'POST') {
      const key = options.headers?.['Idempotency-Key']
      if (!key) return done({ detail: 'Claim reference required.' }, 400)
      if (claims.has(key)) return done({ ...claims.get(key), idempotent_replay: true })
      const offer = offers.find(value => value.id === claim[1])
      if (!offer || offer.status !== 'active') return done({ detail: 'Offer closed.' }, 409)
      if (!offer.remaining_quantity) return done({ detail: 'Stock sold out.' }, 409)
      if (me.available_points < offer.points_cost) return done({ detail: 'Insufficient points balance.' }, 409)
      if (me.coupons.filter(coupon => coupon.offer_id === offer.id).length >= offer.per_member_limit) return done({ detail: 'Per-member claim limit reached.' }, 409)
      const coupon = { ...makeCoupon(offer, `demo-claimed-${++sequence}`), claimed_at: new Date().toISOString() }
      me.balance_points -= offer.points_cost; me.available_points -= offer.points_cost
      me.coupons.unshift(coupon); me.activity.unshift({ id: `demo-activity-${sequence}`, kind: 'claim', points_delta: -offer.points_cost, created_at: coupon.claimed_at, description: `Claimed ${offer.title}` })
      offer.remaining_quantity -= 1; offer.claimed_count += 1
      const result = { coupon, balance_points: me.balance_points, available_points: me.available_points, idempotent_replay: false }
      claims.set(key, result)
      return done(result)
    }
    const use = endpoint.match(/^\/__demo\/use\/([^/]+)$/)
    if (use && method === 'POST') {
      const coupon = me.coupons.find(value => value.id === use[1])
      if (!coupon || coupon.status !== 'claimed') return done({ detail: 'Coupon is no longer ready to use.' }, 409)
      coupon.status = 'used'; coupon.used_at = new Date().toISOString()
      return done({ used: true })
    }
    return done({ detail: 'Unmatched fixture route blocked.' }, 403)
  }
}
