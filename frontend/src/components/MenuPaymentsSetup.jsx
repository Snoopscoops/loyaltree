import React, { useEffect, useState } from 'react'
import { requestJsonResponse } from './requestTimeout'

const EMPTY = {
  trade_name: '', address_line: '', city: '', industry: '', description: '', business_age: '',
  business_size: '', monthly_volume: '', business_tin: '', owner_name: '', birthday: '', nationality: '',
  birth_place: '', mobile: '', email: '', work: '', source_of_funds: '', owner_tin: '', owner_address: '',
  payout_kind: 'gcash', payout_institution: '', payout_account_name: '', payout_account_number: '', payout_last4: '',
}

export default function MenuPaymentsSetup({ API_BASE, slug, authFetch }) {
  const [form, setForm] = useState(EMPTY)
  const [saved, setSaved] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [verifyNote, setVerifyNote] = useState('')
  const endpoint = `${API_BASE}/api/v1/business/${encodeURIComponent(slug)}/qr-menu/payments`
  const set = key => event => setForm(current => ({ ...current, [key]: event.target.value }))

  useEffect(() => {
    const controller = new AbortController()
    requestJsonResponse(authFetch, endpoint, { signal: controller.signal })
      .then(({ response, payload }) => {
        if (controller.signal.aborted) return
        if (!response.ok) { setError(payload?.detail || 'Could not load payment setup'); return }
        setSaved(payload)
        setForm(current => ({ ...current, ...payload, payout_account_number: '' }))
      })
      .catch(value => { if (!controller.signal.aborted) setError(value.message) })
    return () => controller.abort()
  }, [endpoint])

  const save = async event => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      const { response, payload } = await requestJsonResponse(authFetch, endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      if (!response.ok) throw new Error(payload?.detail || 'Could not save payment setup')
      setSaved(payload)
      setForm(current => ({ ...current, ...payload, payout_account_number: '' }))
    } catch (value) { setError(value.message) }
    finally { setSaving(false) }
  }

  const missing = new Set(saved?.missing || [])
  const balance = typeof saved?.balance_centavos === 'number'
    ? `₱${(saved.balance_centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null
  const identityUrl = typeof saved?.identity_url === 'string' && saved.identity_url.startsWith('https://') ? saved.identity_url : ''
  const withdrawals = Array.isArray(saved?.withdrawals) ? saved.withdrawals : []
  return <div className="lt-qr-payments-layout">
  <form className="lt-qr-payments" onSubmit={save}>
    <div className="lt-qr-payments-head">
      <div>
        <p className="lt-qr-eyebrow">PAYMENTS</p>
        <h3>Accept payments on this menu</h3>
        <p>Customers pay on this menu through PayMongo. Loyalty Tree's 3% is automatic.</p>
      </div>
      <strong>3% automatic</strong>
    </div>
    {error && <div className="lt-qr-error" role="alert">{error}</div>}
    {saved?.ready && <p className="lt-qr-owner-notice" role="status">Saved. PayMongo is not accepting new accounts yet, so this is not submitted. The 3% is already set for the first paid order.</p>}
    <details open>
      <summary>Business</summary>
      <label>Trade name<input value={form.trade_name} onChange={set('trade_name')} /></label>
      <label>Address<input value={form.address_line} onChange={set('address_line')} /></label>
      <label>City<input value={form.city} onChange={set('city')} /></label>
      <label>Industry<input value={form.industry} onChange={set('industry')} /></label>
      <label>What you sell<textarea value={form.description} onChange={set('description')} /></label>
      <label>How long operating<select value={form.business_age} onChange={set('business_age')}><option value="">Choose</option><option value="under_1_year">Under 1 year</option><option value="1_to_2_years">1 to 2 years</option><option value="3_to_5_years">3 to 5 years</option><option value="over_5_years">Over 5 years</option></select></label>
      <label>Size<select value={form.business_size} onChange={set('business_size')}><option value="">Choose</option><option value="just_me">Just me</option><option value="2_to_10">2 to 10 people</option><option value="11_to_50">11 to 50 people</option><option value="over_50">Over 50 people</option></select></label>
      <label>Monthly sales<select value={form.monthly_volume} onChange={set('monthly_volume')}><option value="">Choose</option><option value="under_100k">Under ₱100,000</option><option value="100k_to_500k">₱100,000 to ₱500,000</option><option value="500k_to_1m">₱500,000 to ₱1,000,000</option><option value="over_1m">Over ₱1,000,000</option></select></label>
      <label>Business TIN<input value={form.business_tin} onChange={set('business_tin')} inputMode="numeric" /></label>
    </details>
    <details>
      <summary>Owner</summary>
      <label>Full name<input value={form.owner_name} onChange={set('owner_name')} /></label>
      <label>Birthday<input type="date" value={form.birthday} onChange={set('birthday')} /></label>
      <label>Nationality<input value={form.nationality} onChange={set('nationality')} /></label>
      <label>Place of birth<input value={form.birth_place} onChange={set('birth_place')} /></label>
      <label>Mobile<input value={form.mobile} onChange={set('mobile')} inputMode="tel" /></label>
      <label>Email<input type="email" value={form.email} onChange={set('email')} /></label>
      <label>Nature of work<input value={form.work} onChange={set('work')} /></label>
      <label>Source of funds<select value={form.source_of_funds} onChange={set('source_of_funds')}><option value="">Choose</option><option value="business_sales">Sales of the business</option><option value="salary">Salary</option><option value="commission">Commission</option><option value="other">Other</option></select></label>
      <label>Owner TIN<input value={form.owner_tin} onChange={set('owner_tin')} inputMode="numeric" /></label>
      <label>Home address<input value={form.owner_address} onChange={set('owner_address')} /></label>
    </details>
    <details>
      <summary>Where the money goes</summary>
      <div className="lt-qr-pay-choice" role="radiogroup" aria-label="Payout destination">
        {[['gcash', 'GCash'], ['bank', 'Bank']].map(([value, label]) => <button type="button" key={value} aria-pressed={form.payout_kind === value} onClick={() => setForm(current => ({ ...current, payout_kind: value }))}>{label}</button>)}
      </div>
      {form.payout_kind === 'bank' && <label>Bank name<input value={form.payout_institution} onChange={set('payout_institution')} /></label>}
      <label>Account name<input value={form.payout_account_name} onChange={set('payout_account_name')} /></label>
      <label>{form.payout_kind === 'gcash' ? 'GCash mobile number' : 'Account number'}<input value={form.payout_account_number} onChange={set('payout_account_number')} inputMode="numeric" autoComplete="off" placeholder={form.payout_last4 ? `Saved ending ${form.payout_last4}` : ''} /></label>
      <p className="lt-qr-owner-hint">GCash is instant up to ₱50,000 per send. Above that, use a bank. We keep only the last 4 digits.</p>
    </details>
    <p className="lt-qr-owner-hint">DTI or SEC is not required for QR Ph.</p>
    {saved?.missing?.length > 0 && <p className="lt-qr-owner-hint">Still needed: {saved.missing.join(', ')}.</p>}
    <button type="submit" className="lt-qr-primary" disabled={saving}>{saving ? 'Saving…' : 'Save payment setup'}</button>
  </form>
  <aside className="lt-qr-pay-wallet">
    <p className="lt-qr-eyebrow">POWERED BY PAYMONGO</p>
    <h3>Your PayMongo wallet</h3>
    <p>Loyalty Tree takes a 3% platform fee from each paid order. PayMongo charges its own payment fee. Both come from the business, not the customer. The 3% goes to Loyalty Tree. The rest stays in this wallet.</p>
    <div>
      <span>Current balance</span>
      <strong>{balance || 'Not available yet'}</strong>
    </div>
    <h4>Withdrawals</h4>
    {withdrawals.length === 0 ? <p>No withdrawals yet.</p> : <ul>{withdrawals.map(item => <li key={item.id}>{item.destination || 'Payout'} · {item.status}</li>)}</ul>}
    <p>Payouts go to the saved GCash or bank. ₱10 per send, and one send each week is free. GCash is up to ₱50,000.</p>
    {identityUrl
      ? <a className="lt-qr-primary" href={identityUrl} target="_blank" rel="noreferrer">Verify ID and selfie</a>
      : <button type="button" className="lt-qr-primary" onClick={() => setVerifyNote('PayMongo is not accepting new accounts yet. When it opens, this button goes to their camera page for one government ID and a selfie. Loyalty Tree does not keep the photos.')}>Verify ID and selfie</button>}
    {verifyNote && <p role="status">{verifyNote}</p>}
  </aside>
  </div>
}
