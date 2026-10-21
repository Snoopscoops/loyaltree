import React, { useEffect, useRef, useState } from 'react'
import { benefitCentavos, benefitDate, benefitMoney, benefitNumber, benefitUseCheck, validBenefitCoupons } from './benefitsManagementModel'
import { BenefitField, BenefitMessage, useBenefitsRequest } from './BenefitsShared'
import './benefits-management.css'

export default function BenefitsCashier(props) {
  return <CashierBenefitsContent key={`${props.businessSlug}:${props.customerPublicId}:${props.ownerToken || props.staffSessionToken || ''}`} {...props}/>
}

function CashierBenefitsContent({ API_BASE = '', businessSlug, customerPublicId, ownerToken, staffSessionToken, onRedeemed }) {
  const request = useBenefitsRequest({ API_BASE, token: ownerToken || staffSessionToken })
  const base = `/api/v1/business/${encodeURIComponent(businessSlug || '')}/lt-benefits`
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0)
  const [selected, setSelected] = useState(null), [bill, setBill] = useState(''), [receipt, setReceipt] = useState(''), [confirming, setConfirming] = useState(false), [saving, setSaving] = useState(false)
  const alive = useRef(true), mutation = useRef(null), idempotency = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; mutation.current?.abort() } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    if (!customerPublicId || !businessSlug || (!ownerToken && !staffSessionToken)) { setLoading(false); setError('Scan a customer card while signed in to this business.'); return () => controller.abort() }
    request(`${base}/customer/${encodeURIComponent(customerPublicId)}`, { signal: controller.signal }).then(result => {
      if (!validBenefitCoupons(result)) throw new Error('The coupon response was incomplete. Please refresh.')
      if (!controller.signal.aborted) { setData(result); setSelected(null); setConfirming(false); idempotency.current = null }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [request, base, customerPublicId, businessSlug, ownerToken, staffSessionToken, reload])
  const choose = coupon => { setSelected(coupon); setBill(''); setReceipt(''); setConfirming(false); setError(''); setNotice(''); idempotency.current = null }
  const review = event => { event.preventDefault(); const problem = benefitUseCheck(selected, bill); if (problem) { setError(problem); return }; setError(''); setConfirming(true) }
  const useCoupon = async () => {
    if (mutation.current || !confirming) return
    const problem = benefitUseCheck(selected, bill)
    if (problem) { setConfirming(false); setError(problem); return }
    if (!idempotency.current) {
      if (!globalThis.crypto?.randomUUID) { setError('Use a secure browser connection to redeem this coupon.'); return }
      idempotency.current = globalThis.crypto.randomUUID()
    }
    const controller = new AbortController(); mutation.current = controller
    setSaving(true); setError('')
    try {
      const result = await request(`${base}/coupons/${encodeURIComponent(selected.id)}/use`, { method: 'POST', headers: { 'Idempotency-Key': idempotency.current }, body: JSON.stringify({ customer_public_id: customerPublicId, bill_amount_centavos: benefitCentavos(bill), ...(receipt.trim() ? { receipt_reference: receipt.trim() } : {}) }), signal: controller.signal })
      if (!result.used || !result.coupon) throw new Error('The redemption response was incomplete. Refresh to check this coupon before trying again.')
      if (alive.current) { setNotice(result.idempotent_replay ? 'This coupon was already confirmed by this request.' : 'Coupon used successfully. Apply the saved discount to this bill.'); setData(previous => ({ ...previous, coupons: previous.coupons.map(coupon => coupon.id === selected.id ? { ...coupon, ...result.coupon, status: 'used' } : coupon) })); setSelected(null); setConfirming(false); onRedeemed?.(result) }
    } catch (failure) { if (alive.current && failure.name !== 'AbortError') setError(failure.message) }
    finally { mutation.current = null; if (alive.current) setSaving(false) }
  }
  const coupons = data?.coupons || []
  return <section className="lt-benefits lt-benefits-cashier"><header className="lt-benefit-heading"><div><p className="lt-benefit-eyebrow">NETWORK COUPONS</p><h3>LT Rewards at this business</h3><p>Redeem a member’s claimed coupon with their linked loyalty card.</p></div><button type="button" disabled={loading || saving} onClick={() => setReload(value => value + 1)}>{loading ? 'Loading…' : 'Refresh'}</button></header>
    <BenefitMessage error>{error}</BenefitMessage><BenefitMessage>{notice}</BenefitMessage>
    {loading && !data && <p role="status" className="lt-benefit-empty">Checking this member’s coupons…</p>}
    {data && !data.linked && <p className="lt-benefit-empty">This card is not linked to an LT Points account yet.</p>}
    {data?.linked && !coupons.length && <p className="lt-benefit-empty">No claimed LT coupons at this business.</p>}
    {!!coupons.length && <div className="lt-benefit-cashier-list">{coupons.map(coupon => {
      const expired = coupon.expires_at && Date.parse(coupon.expires_at) <= Date.now()
      const usable = coupon.status === 'claimed' && !expired
      return <article key={coupon.id} className={`lt-benefit-cashier-coupon${selected?.id === coupon.id ? ' is-selected' : ''}`}><div><span className={`lt-benefit-status is-${expired && coupon.status === 'claimed' ? 'expired' : coupon.status}`}>{expired && coupon.status === 'claimed' ? 'expired' : coupon.status}</span><h4>{coupon.title}</h4><strong>{benefitMoney(coupon.discount_centavos)} off</strong><p>Minimum {benefitMoney(coupon.min_spend_centavos)} · Claimed for {benefitNumber(coupon.points_cost)} LT Points</p>{coupon.terms && <p>{coupon.terms}</p>}<small>Expires {benefitDate(coupon.expires_at)}</small></div>{usable && <button type="button" disabled={saving || loading} onClick={() => choose(coupon)}>{selected?.id === coupon.id ? 'Selected' : 'Use coupon'}</button>}</article>
    })}</div>}
    {selected && <form className="lt-benefit-panel lt-benefit-redeem" onSubmit={review}><h4>Use “{selected.title}”</h4><p className="lt-benefit-small">Saved discount: {benefitMoney(selected.discount_centavos)} · Minimum bill: {benefitMoney(selected.min_spend_centavos)}</p><div className="lt-benefit-form-grid"><BenefitField label="Bill before this coupon (₱)"><input type="number" min="0.01" step="0.01" required value={bill} disabled={saving || confirming} onChange={event => { setBill(event.target.value); setConfirming(false); idempotency.current = null }}/></BenefitField><BenefitField label="Receipt reference (optional)"><input value={receipt} maxLength={100} disabled={saving || confirming} onChange={event => { setReceipt(event.target.value); idempotency.current = null }}/></BenefitField></div>
      {confirming ? <div className="lt-benefit-confirm"><strong>Confirm one-time use?</strong><p>{benefitMoney(selected.discount_centavos)} off a {benefitMoney(benefitCentavos(bill))} bill. This coupon will be marked used.</p><div className="lt-benefit-actions"><button type="button" className="is-primary" disabled={saving} onClick={useCoupon}>{saving ? 'Confirming…' : 'Confirm & use coupon'}</button><button type="button" disabled={saving} onClick={() => setConfirming(false)}>Back</button></div></div> : <div className="lt-benefit-actions"><button className="is-primary" type="submit" disabled={saving || loading}>Review redemption</button><button type="button" onClick={() => setSelected(null)} disabled={saving}>Cancel</button></div>}
    </form>}
  </section>
}
