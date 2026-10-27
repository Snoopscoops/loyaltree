import React, { useEffect, useRef, useState } from 'react'
import { benefitDate, benefitNumber, benefitSettingsPayload } from './benefitsManagementModel'
import { BenefitField, BenefitMessage, BenefitMetric, useBenefitsRequest } from './BenefitsShared'
import './benefits-management.css'

const validSettings = value => value && typeof value.enabled === 'boolean' && Number.isSafeInteger(value.pesos_per_point) && value.pesos_per_point > 0 && value.pesos_per_point <= 1000000 && Number.isSafeInteger(value.rule_version) && value.rule_version >= 0 && (value.max_points_per_transaction == null || (Number.isSafeInteger(value.max_points_per_transaction) && value.max_points_per_transaction > 0 && value.max_points_per_transaction <= 1000000))

export default function BenefitsAdmin(props) {
  return <AdminBenefitsContent key={props.sessionKey || props.token || 'admin'} {...props}/>
}

function AdminBenefitsContent({ API_BASE = '', token, authFetch }) {
  const request = useBenefitsRequest({ API_BASE, token, authFetch, relativeAuth: true })
  const [settings, setSettings] = useState(null), [form, setForm] = useState({ enabled: false, pesos_per_point: '500', max_points_per_transaction: '' })
  const [businesses, setBusinesses] = useState([]), [approvalBusy, setApprovalBusy] = useState('')
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [reload, setReload] = useState(0)
  const alive = useRef(true), mutation = useRef(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; mutation.current?.abort() } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError('')
    request('/api/v1/admin/lt-benefits/settings', { signal: controller.signal }).then(data => {
      if (!validSettings(data)) throw new Error('The LT Rewards settings response was incomplete. Please refresh.')
      if (!controller.signal.aborted) { setSettings(data); setForm({ enabled: data.enabled, pesos_per_point: String(data.pesos_per_point), max_points_per_transaction: data.max_points_per_transaction == null ? '' : String(data.max_points_per_transaction) }) }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    request('/api/v1/admin/lt-benefits/businesses', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted && data && Array.isArray(data.businesses)) setBusinesses(data.businesses)
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [request, reload])
  const save = async event => {
    event.preventDefault()
    if (mutation.current) return
    const result = benefitSettingsPayload(form)
    if (result.error) { setError(result.error); return }
    const controller = new AbortController(); mutation.current = controller
    setSaving(true); setError(''); setNotice('')
    try {
      const data = await request('/api/v1/admin/lt-benefits/settings', { method: 'PUT', body: JSON.stringify(result.payload), signal: controller.signal })
      if (!validSettings(data)) throw new Error('Settings were submitted, but the response was incomplete. Refresh to verify the saved rule.')
      if (alive.current) { setSettings(data); setForm({ enabled: data.enabled, pesos_per_point: String(data.pesos_per_point), max_points_per_transaction: data.max_points_per_transaction == null ? '' : String(data.max_points_per_transaction) }); setNotice('LT Points earning settings saved. Existing ledger entries retain the rule used when they were earned.') }
    } catch (failure) { if (alive.current && failure.name !== 'AbortError') setError(failure.message) }
    finally { mutation.current = null; if (alive.current) setSaving(false) }
  }
  const setApproval = async (slug, approved) => {
    if (approvalBusy) return
    setApprovalBusy(slug); setError(''); setNotice('')
    try {
      const data = await request(`/api/v1/admin/lt-benefits/businesses/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify({ approved }) })
      if (alive.current) {
        setBusinesses(current => current.map(row => row.public_id === slug ? { ...row, approved: data.approved === true } : row))
        setNotice(approved ? 'This business can now be redeemed. Other businesses stay Coming soon.' : 'This business is Coming soon again.')
      }
    } catch (failure) { if (alive.current) setError(failure.message) }
    finally { if (alive.current) setApprovalBusy('') }
  }
  return <section className="lt-benefits">
    <header className="lt-benefit-heading"><div><p className="lt-benefit-eyebrow">SUPER ADMIN · NETWORK RULES</p><h2>LT Points settings</h2><p>Set the platform earning rule used across participating businesses.</p></div><button type="button" disabled={loading || saving} onClick={() => { setNotice(''); setReload(value => value + 1) }}>{loading ? 'Loading…' : 'Reload settings'}</button></header>
    <BenefitMessage error>{error}</BenefitMessage><BenefitMessage>{notice}</BenefitMessage>
    {loading && !settings && <p role="status" className="lt-benefit-empty">Loading LT Points settings…</p>}
    {settings && <>
      <div className="lt-benefit-metrics"><BenefitMetric label="Network earning" value={settings.enabled ? 'Enabled' : 'Paused'} detail="Shared LT Points"/><BenefitMetric label="Spend per LT Point" value={`₱${benefitNumber(settings.pesos_per_point)}`} detail="Eligible purchase amount"/><BenefitMetric label="Current rule" value={`v${benefitNumber(settings.rule_version)}`} detail={settings.updated_at ? `Saved ${benefitDate(settings.updated_at)}` : 'Version saved with earned points'}/></div>
      {settings.available === false && <BenefitMessage>LT Rewards is not available for customer use yet. The saved earning rule will apply when the feature is available.</BenefitMessage>}
      <form className="lt-benefit-panel" onSubmit={save}><header><div><h3>Points earning rule</h3><p>For example, ₱500 of eligible purchases earns 1 LT Point. Merchants separately choose the points cost and discount of their coupons.</p></div></header>
        <label className="lt-benefit-toggle"><input type="checkbox" checked={form.enabled} disabled={saving || loading} onChange={event => setForm(previous => ({ ...previous, enabled: event.target.checked }))}/><span><strong>Enable LT Benefits</strong><small>When paused, earning, claiming and coupon use are unavailable. Saved points and coupons remain recorded; coupon expiry dates still apply.</small></span></label>
        <div className="lt-benefit-form-grid"><BenefitField label="Pesos spent per 1 LT Point" hint="Positive whole pesos. Applies to new eligible transactions."><div className="lt-benefit-input-prefix"><span>₱</span><input type="number" min="1" max="1000000" step="1" value={form.pesos_per_point} required disabled={saving || loading} onChange={event => setForm(previous => ({ ...previous, pesos_per_point: event.target.value }))}/></div></BenefitField><BenefitField label="Maximum LT Points per transaction" hint="Optional · Leave blank for no transaction cap."><input type="number" min="1" max="1000000" step="1" value={form.max_points_per_transaction} disabled={saving || loading} onChange={event => setForm(previous => ({ ...previous, max_points_per_transaction: event.target.value }))}/></BenefitField></div>
        <p className="lt-benefit-note">This setting controls how points are earned. A merchant coupon defines its own discount and required LT Points; there is no cash-out value set here.</p>
        <div className="lt-benefit-actions"><button type="submit" className="is-primary" disabled={saving || loading}>{saving ? 'Saving…' : 'Save earning rule'}</button></div>
      </form>
      <section className="lt-benefit-panel"><header><div><h3>Approve a business</h3><p>Benefits stay Coming soon until you approve that business. Approve one business first so you can test it. Everyone else stays Coming soon.</p></div></header>
        {businesses.length ? <div className="lt-benefit-table-wrap"><table><thead><tr><th>Business</th><th>Benefits</th><th></th></tr></thead><tbody>{businesses.map(row => <tr key={row.public_id}><td><strong>{row.name}</strong><small>{row.public_id}</small></td><td>{row.approved ? 'Live' : 'Coming soon'}</td><td><button type="button" disabled={!!approvalBusy} onClick={() => setApproval(row.public_id, !row.approved)}>{approvalBusy === row.public_id ? 'Saving…' : row.approved ? 'Set coming soon' : 'Approve'}</button></td></tr>)}</tbody></table></div> : <p className="lt-benefit-empty">No businesses to approve yet.</p>}
      </section>
    </>}
  </section>
}
