import React, { useEffect, useRef, useState } from 'react'
import { BENEFIT_CATEGORIES, benefitDate, benefitImage, benefitMoney, benefitNumber, benefitOfferForm, benefitOfferPayload, newBenefitOffer, validBenefitOffers } from './benefitsManagementModel'
import { BenefitField, BenefitMessage, BenefitMetric, useBenefitsRequest } from './BenefitsShared'
import './benefits-management.css'

const PAGE_SIZE = 25
const categoryName = value => BENEFIT_CATEGORIES.find(item => item.value === value)?.label || 'Other'

export default function BenefitsOwner(props) {
  return <OwnerBenefitsContent key={`${props.businessSlug}:${props.ownerToken || ''}`} {...props}/>
}

function OwnerBenefitsContent({ API_BASE = '', businessSlug, ownerToken, authFetch }) {
  const request = useBenefitsRequest({ API_BASE, token: ownerToken, authFetch })
  const base = `/api/v1/business/${encodeURIComponent(businessSlug || '')}/lt-benefits`
  const [offers, setOffers] = useState([]), [report, setReport] = useState(null)
  const [offset, setOffset] = useState(0), [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [error, setError] = useState('')
  const [form, setForm] = useState(newBenefitOffer), [editing, setEditing] = useState(null), [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false), [changing, setChanging] = useState(null), [formError, setFormError] = useState(''), [notice, setNotice] = useState('')
  const [reload, setReload] = useState(0)
  const alive = useRef(true), mutation = useRef(null), formRef = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; mutation.current?.abort() } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setLoaded(false); setOffers([]); setReport(null)
    if (!businessSlug) { setLoading(false); setError('Choose a business to manage its LT Rewards.'); return () => controller.abort() }
    Promise.all([
      request(`${base}/offers?limit=${PAGE_SIZE}&offset=${offset}`, { signal: controller.signal }),
      request(`${base}/report`, { signal: controller.signal }),
    ]).then(([data, stats]) => {
      if (!validBenefitOffers(data) || !stats?.totals || !Array.isArray(stats.recent)) throw new Error('The LT Rewards response was incomplete. Please refresh.')
      if (!controller.signal.aborted) { setOffers(data.offers); setHasMore(!!data.has_more); setReport(stats); setLoaded(true) }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message || 'Could not load LT Rewards.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [base, businessSlug, offset, reload, request])

  const update = event => { const { name, value } = event.target; setForm(previous => ({ ...previous, [name]: value })) }
  const closeForm = () => { setFormOpen(false); setEditing(null); setForm(newBenefitOffer()); setFormError('') }
  const openForm = offer => { setEditing(offer?.id ?? null); setForm(offer ? benefitOfferForm(offer) : newBenefitOffer()); setFormError(''); setNotice(''); setFormOpen(true); requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }
  const save = async event => {
    event.preventDefault()
    if (mutation.current) return
    const result = benefitOfferPayload(form)
    if (result.error) { setFormError(result.error); return }
    const current = offers.find(item => item.id === editing)
    if (current && result.payload.total_quantity < Number(current.claimed_count || 0)) { setFormError('Total quantity cannot be lower than the number already claimed.'); return }
    const controller = new AbortController(); mutation.current = controller
    setSaving(true); setFormError(''); setNotice('')
    try {
      await request(`${base}/offers${editing != null ? `/${encodeURIComponent(editing)}` : ''}`, { method: editing != null ? 'PATCH' : 'POST', body: JSON.stringify(result.payload), signal: controller.signal })
      if (alive.current) { setNotice(editing != null ? 'Offer updated. Previously claimed coupons keep their original details.' : 'Coupon offer created.'); closeForm(); setOffset(0); setReload(value => value + 1) }
    } catch (failure) { if (alive.current && failure.name !== 'AbortError') setFormError(failure.message) }
    finally { mutation.current = null; if (alive.current) setSaving(false) }
  }
  const changeStatus = async offer => {
    if (mutation.current) return
    const controller = new AbortController(); mutation.current = controller
    setChanging(offer.id); setError(''); setNotice('')
    const status = offer.status === 'active' ? 'paused' : 'active'
    try {
      await request(`${base}/offers/${encodeURIComponent(offer.id)}`, { method: 'PATCH', body: JSON.stringify({ status }), signal: controller.signal })
      if (alive.current) { setNotice(status === 'paused' ? 'New claims paused. Existing claimed coupons remain valid until their saved expiry.' : 'Offer activated for new claims.'); setReload(value => value + 1) }
    } catch (failure) { if (alive.current && failure.name !== 'AbortError') setError(failure.message) }
    finally { mutation.current = null; if (alive.current) setChanging(null) }
  }
  const now = Date.now()
  const available = offers.filter(row => row.status === 'active' && (!row.starts_at || Date.parse(row.starts_at) <= now) && (!row.ends_at || Date.parse(row.ends_at) > now)).reduce((sum, row) => sum + Math.max(0, row.remaining_quantity), 0)
  const input = (name, label, { type = 'text', hint, min, max, step, required = false, wide = false, placeholder } = {}) => <BenefitField label={label} hint={hint} wide={wide}><input name={name} value={form[name] ?? ''} onChange={update} type={type} min={min} max={max} step={step} required={required} maxLength={name === 'title' ? 120 : undefined} placeholder={placeholder} disabled={saving}/></BenefitField>

  return <section className="lt-benefits">
    <header className="lt-benefit-heading"><div><p className="lt-benefit-eyebrow">LOYALTY TREE NETWORK</p><h2>LT Rewards</h2><p>Create limited coupons customers can claim with their shared LT Points.</p></div><div className="lt-benefit-actions"><button type="button" onClick={() => setReload(value => value + 1)} disabled={loading || saving || changing != null}>{loading ? 'Refreshing…' : 'Refresh'}</button><button className="is-primary" type="button" onClick={() => openForm()} disabled={!loaded || saving || changing != null}>＋ Create coupon</button></div></header>
    <BenefitMessage error>{error}</BenefitMessage><BenefitMessage>{notice}</BenefitMessage>
    {loading && !loaded && <p role="status" className="lt-benefit-empty">Loading your business’s coupon offers…</p>}
    {loaded && <>
      <div className="lt-benefit-metrics"><BenefitMetric label="Available" value={benefitNumber(available)} detail="Active, unclaimed stock on this page"/><BenefitMetric label="Claimed" value={benefitNumber(report?.totals.claimed)} detail="All claims for your business"/><BenefitMetric label="Used" value={benefitNumber(report?.totals.used)} detail="Confirmed by your cashiers"/></div>
      {formOpen && <form ref={formRef} className="lt-benefit-panel lt-benefit-editor" onSubmit={save}>
        <header><div><p className="lt-benefit-eyebrow">{editing != null ? 'EDIT OFFER' : 'NEW OFFER'}</p><h3>{editing != null ? 'Update coupon details' : 'Give members a reason to visit'}</h3></div><button type="button" onClick={closeForm} disabled={saving}>Cancel</button></header>
        {editing != null && <p className="lt-benefit-note">Changes apply to future claims. Claimed coupons keep their original title, discount, points cost, terms and expiry.</p>}
        <div className="lt-benefit-form-grid">
          {input('title', 'Coupon title', { required: true, wide: true, placeholder: '₱20 off your next visit' })}
          <BenefitField label="Description" wide><textarea name="description" value={form.description} onChange={update} rows={2} maxLength={2000} disabled={saving} placeholder="Tell customers what makes this reward worth claiming."/></BenefitField>
          <BenefitField label="Category"><select name="category" value={form.category} onChange={update} disabled={saving}>{BENEFIT_CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></BenefitField>
          {input('image_url', 'Photo URL', { type: 'url', hint: 'Optional · HTTPS image URL', placeholder: 'https://…' })}
          {input('discount_php', 'Discount (₱)', { type: 'number', min: '0.01', max: '1000000', step: '0.01', required: true })}
          {input('points_cost', 'LT Points to claim', { type: 'number', min: '1', max: '10000000', step: '1', required: true })}
          {input('total_quantity', 'Total coupons', { type: 'number', min: '1', max: '1000000', step: '1', required: true, hint: 'Includes any coupons already claimed.' })}
          {input('min_spend_php', 'Minimum bill (₱)', { type: 'number', min: '0', max: '1000000', step: '0.01', required: true })}
          {input('per_member_limit', 'Claims per member', { type: 'number', min: '1', max: '100', step: '1', required: true })}
          {input('weekly_limit', 'Max redemptions per week', { type: 'number', min: '1', step: '1', placeholder: 'Unlimited' })}
          {input('coupon_valid_days', 'Valid days after claiming', { type: 'number', min: '1', max: '365', step: '1', required: true, hint: 'The offer end date can shorten this period.' })}
          {input('starts_at', 'Claims open', { type: 'datetime-local', hint: 'Optional · Your local time' })}
          {input('ends_at', 'Offer ends', { type: 'datetime-local', hint: 'Optional · Claiming and redemption cutoff, in your local time.' })}
          <BenefitField label="Terms" wide><textarea name="terms" value={form.terms} onChange={update} rows={3} maxLength={3000} disabled={saving} placeholder="Eligible items, exclusions and how the coupon can be used."/></BenefitField>
          <BenefitField label="Offer status"><select name="status" value={form.status} onChange={update} disabled={saving}><option value="active">Active · Accept new claims</option><option value="draft">Draft</option><option value="paused">Paused</option></select></BenefitField>
        </div>
        <BenefitMessage error>{formError}</BenefitMessage><div className="lt-benefit-actions"><button type="submit" className="is-primary" disabled={saving}>{saving ? 'Saving…' : editing != null ? 'Save offer' : 'Create coupon offer'}</button><button type="button" disabled={saving} onClick={closeForm}>Cancel</button></div>
      </form>}
      <div className="lt-benefit-section-label"><h3>Your coupon offers</h3><span>{offers.length ? `${offset + 1}–${offset + offers.length}` : '0'} shown</span></div>
      {!offers.length ? <div className="lt-benefit-empty"><strong>Your next customer perk starts here.</strong><p>Create a limited coupon with a clear discount, points cost and quantity.</p></div> : <div className="lt-benefit-offer-grid">{offers.map(offer => <article className="lt-benefit-offer" key={offer.id}>
        {offer.image_url && <img className="lt-benefit-offer-photo" src={offer.image_url} alt="" />}
        {benefitImage(offer.image_url) ? <img className="lt-benefit-offer-photo" src={benefitImage(offer.image_url)} alt="" loading="lazy" referrerPolicy="no-referrer"/> : <div className="lt-benefit-offer-placeholder" aria-hidden="true"><span>LT</span><small>MEMBER REWARD</small></div>}
        <div className="lt-benefit-offer-body"><div className="lt-benefit-offer-meta"><span>{categoryName(offer.category)}</span><span className={`lt-benefit-status is-${offer.status}`}>{offer.status}</span></div><h3>{offer.title}</h3><div className="lt-benefit-offer-value"><strong>{benefitMoney(offer.discount_centavos)} off</strong><span>{benefitNumber(offer.points_cost)} LT Points</span></div>{offer.description && <p>{offer.description}</p>}<p className="lt-benefit-small">Minimum bill {benefitMoney(offer.min_spend_centavos)} · {benefitNumber(offer.per_member_limit ?? 1)} claim(s) per member{offer.weekly_limit ? ` · ${offer.weekly_limit} per week` : ''}</p><div className="lt-benefit-stock"><span><strong>{benefitNumber(offer.remaining_quantity)}</strong> left</span><span><strong>{benefitNumber(offer.claimed_count ?? 0)}</strong> claimed</span><span><strong>{benefitNumber(offer.used_count ?? 0)}</strong> used</span></div><p className="lt-benefit-small">{offer.starts_at ? `Opens ${benefitDate(offer.starts_at)} · ` : ''}{offer.ends_at ? `Ends ${benefitDate(offer.ends_at)}` : `${offer.coupon_valid_days ?? 30} days to use after claiming`}</p><div className="lt-benefit-actions"><button type="button" onClick={() => openForm(offer)} disabled={saving || changing != null}>Edit offer</button><button type="button" onClick={() => changeStatus(offer)} disabled={saving || changing != null}>{changing === offer.id ? 'Updating…' : offer.status === 'active' ? 'Pause claims' : 'Activate'}</button></div></div>
      </article>)}</div>}
      {(offset > 0 || hasMore) && <div className="lt-benefit-pagination"><button type="button" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - PAGE_SIZE))}>Previous</button><span>Page {Math.floor(offset / PAGE_SIZE) + 1}</span><button type="button" disabled={!hasMore || loading} onClick={() => setOffset(value => value + PAGE_SIZE)}>Next</button></div>}
      <section className="lt-benefit-panel"><header><div><h3>Recent coupon activity</h3><p>Claims and usage for this business. Details below are saved when each coupon is claimed.</p></div></header>{!report?.recent.length ? <p className="lt-benefit-empty">No coupons have been claimed yet.</p> : <div className="lt-benefit-table-wrap" tabIndex={0} role="region" aria-label="Coupon activity"><table><thead><tr><th>Coupon</th><th>Customer card</th><th>Claimed value</th><th>Status</th><th>Claimed / used</th><th>Expires</th></tr></thead><tbody>{report.recent.map(coupon => <tr key={coupon.id}><td><strong>{coupon.title}</strong><small>{benefitNumber(coupon.points_cost)} LT Points · Minimum {benefitMoney(coupon.min_spend_centavos)}</small>{coupon.terms && <small>{coupon.terms}</small>}</td><td><code>{coupon.customer_public_id ? `…${String(coupon.customer_public_id).slice(-8)}` : 'Linked member'}</code></td><td>{benefitMoney(coupon.discount_centavos)}</td><td><span className={`lt-benefit-status is-${coupon.status}`}>{coupon.status}</span></td><td>{benefitDate(coupon.claimed_at)}{coupon.used_at && <small>Used {benefitDate(coupon.used_at)}</small>}</td><td>{benefitDate(coupon.expires_at)}</td></tr>)}</tbody></table></div>}{report?.has_more && <p className="lt-benefit-small">Showing recent activity only. Totals include all coupons for your business.</p>}</section>
    </>}
  </section>
}
