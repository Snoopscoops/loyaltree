import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import BenefitsOwner from '../src/components/BenefitsOwner'
import BenefitsAdmin from '../src/components/BenefitsAdmin'
import BenefitsCashier from '../src/components/BenefitsCashier'
import { BenefitsAdminCardUpgrade } from '../src/components/BenefitsCardUpgrade'

const now = Date.now()
const iso = days => new Date(now + days * 86400000).toISOString()
let settings = { enabled: true, available: true, pesos_per_point: 500, rule_version: 1, max_points_per_transaction: null, updated_at: iso(-1) }
let offers = [
  { id: 'offer-coffee', title: 'A little treat on your next visit', description: 'Make your next coffee break a little sweeter.', image_url: null, category: 'food_drink', terms: 'One coupon per bill. Valid for drinks and pastries.', discount_centavos: 2000, min_spend_centavos: 15000, points_cost: 20, total_quantity: 100, remaining_quantity: 82, claimed_count: 18, used_count: 5, expired_count: 0, per_member_limit: 1, coupon_valid_days: 30, starts_at: null, ends_at: iso(30), status: 'active' },
  { id: 'offer-shopping', title: 'Your next neighborhood find', description: 'A thank-you for choosing to shop local.', image_url: null, category: 'shopping', terms: 'Regular-priced items only.', discount_centavos: 5000, min_spend_centavos: 50000, points_cost: 45, total_quantity: 50, remaining_quantity: 47, claimed_count: 3, used_count: 1, expired_count: 0, per_member_limit: 1, coupon_valid_days: 30, starts_at: null, ends_at: null, status: 'paused' },
]
let coupons = [{ id: 'coupon-saved', offer_id: 'offer-coffee', business_slug: 'preview-cafe', business_name: 'Neighborhood Café', title: 'Your saved ₱20 coffee perk', discount_centavos: 2000, min_spend_centavos: 15000, points_cost: 20, terms: 'Original saved terms. One coupon per bill.', status: 'claimed', customer_public_id: 'preview-member-0001', claimed_at: iso(-1), expires_at: iso(29), used_at: null }]
let lastUsedKey = null
let cardUpgrade = { available: true, total_cards: 284, eligible_cards: 284, enabled_cards: 0, rollout: null }
let rolloutRead = 0
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const mockFetch = async (url, options = {}) => {
  if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const path = new URL(url, 'http://local.preview').pathname
  const method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : {}
  if (/^\/api\/v1\/admin\/businesses\/preview-cafe\/lt-benefits\/card-upgrade$/.test(path)) {
    if (method === 'POST') {
      if (body.confirm !== true) return json({ detail: 'Confirmation is required.' }, 400)
      if (!cardUpgrade.rollout || ['completed', 'failed'].includes(cardUpgrade.rollout.status)) { rolloutRead = 0; cardUpgrade.rollout = { id: 'local-preview-upgrade', status: 'queued', total: 284, scanned: 0, queued: 0, failed: 0, remaining: 284, error_type: null } }
    } else if (cardUpgrade.rollout && ['queued', 'processing'].includes(cardUpgrade.rollout.status)) {
      rolloutRead += 1
      const scanned = Math.min(284, rolloutRead * 100)
      cardUpgrade = { ...cardUpgrade, enabled_cards: scanned, eligible_cards: 284 - scanned, rollout: { ...cardUpgrade.rollout, status: scanned === 284 ? 'completed' : 'processing', scanned, queued: scanned, remaining: 284 - scanned } }
    }
    return json(cardUpgrade)
  }
  if (path.endsWith('/settings')) {
    if (method === 'PUT') settings = { ...settings, ...body, rule_version: settings.rule_version + 1, updated_at: iso(0) }
    return json(settings)
  }
  if (path.endsWith('/offers')) {
    if (method === 'POST') { const offer = { ...body, id: `offer-${offers.length + 1}`, remaining_quantity: body.total_quantity, claimed_count: 0, used_count: 0, expired_count: 0 }; offers = [offer, ...offers]; return json(offer) }
    return json({ offers, has_more: false })
  }
  if (/\/offers\/[^/]+$/.test(path) && method === 'PATCH') { const id = path.split('/').pop(); offers = offers.map(item => item.id === id ? { ...item, ...body, remaining_quantity: (body.total_quantity ?? item.total_quantity) - item.claimed_count } : item); return json(offers.find(item => item.id === id)) }
  if (path.endsWith('/report')) return json({ totals: { claimed: 21, used: 6 + coupons.filter(item => item.status === 'used').length, expired: 0 }, offers: [], recent: coupons, has_more: false })
  if (path.includes('/customer/')) return json({ linked: true, customer_public_id: 'preview-member-0001', coupons })
  if (path.endsWith('/use')) {
    const key = options.headers?.['Idempotency-Key']
    const id = path.split('/').at(-2), coupon = coupons.find(item => item.id === id)
    if (!coupon) return json({}, 404)
    if (coupon.status === 'used') return key === lastUsedKey ? json({ coupon, used: true, idempotent_replay: true }) : json({ detail: 'This coupon has already been used.' }, 409)
    lastUsedKey = key; coupons = coupons.map(item => item.id === id ? { ...item, status: 'used', used_at: iso(0) } : item)
    return json({ coupon: coupons.find(item => item.id === id), used: true, idempotent_replay: false })
  }
  return json({}, 404)
}

// Keep this fixture transport local: no real requests, messages, points or redemptions.
function Preview() {
  const [view, setView] = useState('owner')
  const originalFetch = React.useRef(globalThis.fetch)
  React.useEffect(() => { globalThis.fetch = mockFetch; return () => { globalThis.fetch = originalFetch.current } }, [])
  const signedFetch = (url, options) => mockFetch(url, options)
  return <><style>{`body{margin:0;background:#f3f5ef;color:#244331;font-family:Inter,system-ui,sans-serif}.preview-bar{padding:14px 22px;background:#153e2d;color:#eff8e6;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px}.preview-bar strong{letter-spacing:.08em;font-size:10px}.preview-bar select{background:#f7fbf3;color:#21462f;border:0;padding:8px 12px;border-radius:8px;font:inherit}main{max-width:1120px;margin:28px auto;padding:0 20px}.preview-title{margin:0 0 18px;color:#62775d;font-size:12px}`}</style><header className="preview-bar"><strong>LOCAL PREVIEW · FICTIONAL DATA</strong><label>View <select value={view} onChange={event => setView(event.target.value)}><option value="owner">Owner coupon manager</option><option value="admin">Super Admin settings</option><option value="admin-cards">Super Admin card upgrades</option><option value="cashier">Cashier redemption</option></select></label></header><main><p className="preview-title">Neighborhood Café / LT Rewards</p>{view === 'owner' && <BenefitsOwner API_BASE="" businessSlug="preview-cafe" ownerToken="local-preview" authFetch={signedFetch}/ >}{view === 'admin-cards' && <BenefitsAdminCardUpgrade businessSlug="preview-cafe" businessName="Neighborhood Café" token="local-preview" authFetch={signedFetch}/>}{view === 'admin' && <BenefitsAdmin token="local-preview" authFetch={signedFetch}/ >}{view === 'cashier' && <BenefitsCashier businessSlug="preview-cafe" customerPublicId="preview-member-0001" staffSessionToken="local-preview"/ >}</main></>
}
createRoot(document.getElementById('root')).render(<Preview/> )
