import React, { useCallback, useEffect, useRef, useState } from 'react'
import { BenefitMessage, useBenefitsRequest } from './BenefitsShared'
import loyaltyTreeLogo from './logo-192.png'
import { benefitNumber } from './benefitsManagementModel'
import { cardUpgradeActive, cardUpgradeProgress, cardUpgradeShouldPoll, validCardUpgradeSnapshot } from './benefitsCardUpgradeModel'

const POLL_MS = 20_000

export function BenefitsAdminCardUpgrade({ API_BASE = '', token, authFetch, businessSlug, businessName }) {
  const request = useBenefitsRequest({ API_BASE, token, authFetch, relativeAuth: true })
  if (!businessSlug) return null
  const base = `/api/v1/admin/businesses/${encodeURIComponent(businessSlug)}/lt-benefits`
  return <div className="lt-benefits"><BenefitsCardUpgrade key={`${businessSlug}:${token || ''}`} request={request} base={base} businessName={businessName}/></div>
}

export default function BenefitsCardUpgrade({ request, base, businessName }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loading, setLoading] = useState(true), [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false), [error, setError] = useState('')
  const alive = useRef(true), pending = useRef(null)
  const current = useRef(snapshot); current.current = snapshot
  const endpoint = `${base}/card-upgrade`
  const read = useCallback(async (signal) => {
    const data = await request(endpoint, { signal })
    if (!validCardUpgradeSnapshot(data)) throw new Error('Card update progress was incomplete. Please refresh.')
    if (!signal.aborted && alive.current) setSnapshot(data)
    return data
  }, [endpoint, request])

  useEffect(() => {
    alive.current = true
    const controller = new AbortController()
    setLoading(true); setError(''); setSnapshot(null); setConfirming(false)
    read(controller.signal).catch(failure => { if (!controller.signal.aborted) setError(failure.message || 'Could not load card update progress.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { alive.current = false; controller.abort(); pending.current?.abort() }
  }, [read])

  const active = cardUpgradeActive(snapshot)
  useEffect(() => {
    if (!active) return undefined
    let timer = null, controller = null, stopped = false
    const schedule = () => {
      clearTimeout(timer)
      if (!stopped && cardUpgradeShouldPoll(current.current, document.visibilityState)) timer = setTimeout(poll, POLL_MS)
    }
    const poll = async () => {
      if (stopped || !cardUpgradeShouldPoll(current.current, document.visibilityState)) return
      controller = new AbortController()
      try { await read(controller.signal); if (!controller.signal.aborted) setError('') }
      catch (failure) { if (!controller.signal.aborted) setError(failure.message || 'Could not refresh card update progress.') }
      finally { controller = null; schedule() }
    }
    const visibility = () => { if (document.visibilityState !== 'visible') { clearTimeout(timer); controller?.abort() } else schedule() }
    schedule(); document.addEventListener('visibilitychange', visibility)
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility) }
  }, [active, read])

  const refresh = async () => {
    if (pending.current) return
    const controller = new AbortController(); pending.current = controller
    setLoading(true); setError('')
    try { await read(controller.signal) }
    catch (failure) { if (!controller.signal.aborted && alive.current) setError(failure.message || 'Could not load card update progress.') }
    finally { pending.current = null; if (alive.current) setLoading(false) }
  }
  const start = async () => {
    if (pending.current || !snapshot?.available || active) return
    const controller = new AbortController(); pending.current = controller
    setSubmitting(true); setError('')
    try {
      const data = await request(endpoint, { method: 'POST', body: JSON.stringify({ confirm: true }), signal: controller.signal })
      if (!validCardUpgradeSnapshot(data)) throw new Error('The request may have been accepted, but its progress was incomplete. Refresh before trying again.')
      if (!controller.signal.aborted && alive.current) { setSnapshot(data); setConfirming(false) }
    } catch (failure) { if (!controller.signal.aborted && alive.current) setError(failure.message || 'Could not request card updates. Refresh progress before trying again.') }
    finally { pending.current = null; if (alive.current) setSubmitting(false) }
  }
  const progress = cardUpgradeProgress(snapshot)
  const retry = progress?.canRetry
  const hasEligible = (snapshot?.eligible_cards || 0) > 0
  const complete = snapshot?.available && !hasEligible && !active && !retry
  const canStart = snapshot?.available && !active && (hasEligible || retry)

  return <section className="lt-benefit-panel lt-card-upgrade" aria-labelledby="lt-card-upgrade-title">
    <header><div><p className="lt-benefit-eyebrow">SUPER ADMIN · EXISTING WALLET CARDS</p><h3 id="lt-card-upgrade-title">Upgrade cards to LT Benefits</h3>{businessName && <p><strong>Selected business: {businessName}</strong></p>}<p>Business branding and its own stamps or points stay in place. Add shared LT Points and the Loyalty Tree Benefits link to this business’s existing Apple and Google Wallet cards.</p></div><img className="lt-card-upgrade-mark" src={loyaltyTreeLogo} alt=""/></header>
    <p className="lt-benefit-note">New customers receive the new card experience automatically. Super Admin controls when this business’s existing cards are upgraded.</p>
    <BenefitMessage error>{error}</BenefitMessage>
    {loading && !snapshot && <p className="lt-benefit-small" role="status">Checking your existing cards…</p>}
    {snapshot && <>
      <div className="lt-card-upgrade-counts"><span><strong>{benefitNumber(snapshot.total_cards)}</strong> total cards</span><span><strong>{benefitNumber(snapshot.enabled_cards)}</strong> enabled for LT Benefits</span><span><strong>{benefitNumber(snapshot.eligible_cards)}</strong> ready to update</span></div>
      {!snapshot.available && <p className="lt-benefit-message">Card updates will be available when Loyalty Tree Benefits is enabled.</p>}
      {progress && <div className="lt-card-upgrade-progress" role="status" aria-live="polite"><div className="lt-card-upgrade-progress-heading"><strong>{progress.label}</strong><span>{benefitNumber(snapshot.rollout.scanned)} / {benefitNumber(snapshot.rollout.total)} cards checked</span></div><progress max="100" value={progress.percent} aria-label="Cards checked"/><p>{benefitNumber(snapshot.rollout.queued)} wallet updates queued{snapshot.rollout.failed ? ` · ${benefitNumber(snapshot.rollout.failed)} failed` : ''}{active ? ` · ${benefitNumber(snapshot.rollout.remaining)} cards left to check` : ''}</p></div>}
      {complete && !progress && <p className="lt-benefit-message">{snapshot.total_cards ? 'All existing cards are already enabled for LT Benefits.' : 'No existing cards to update yet.'}</p>}
      {(hasEligible || progress) && <p className="lt-benefit-small">Updates run gradually in the background. Queued updates are not confirmation of delivery; each wallet app controls when the new card appears.</p>}
      {confirming && canStart ? <div className="lt-benefit-confirm lt-card-upgrade-confirm"><strong>{retry ? 'Retry the card update?' : `Update ${benefitNumber(snapshot.eligible_cards)} existing cards?`}</strong><p>Prepare and queue wallet updates for <strong>{businessName || 'this business'}</strong>. Customers keep their current cards and business rewards. This may take time for a large customer list.</p><div className="lt-benefit-actions"><button type="button" className="is-primary" onClick={start} disabled={submitting}>{submitting ? 'Requesting update…' : retry ? 'Confirm retry' : 'Confirm card update'}</button><button type="button" onClick={() => setConfirming(false)} disabled={submitting}>Cancel</button></div></div> : <div className="lt-benefit-actions"><button type="button" className="is-primary" disabled={!canStart || loading || submitting} onClick={() => setConfirming(true)}>{active ? 'Updating cards…' : retry ? 'Retry card updates' : complete ? 'Cards are up to date' : 'Update all cards to LT Benefits'}</button><button type="button" onClick={refresh} disabled={loading || submitting}>{loading ? 'Refreshing…' : 'Refresh progress'}</button></div>}
    </>}
    {!snapshot && !loading && <button type="button" onClick={refresh}>Retry loading card progress</button>}
  </section>
}
