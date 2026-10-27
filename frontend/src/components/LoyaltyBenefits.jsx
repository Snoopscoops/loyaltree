import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import loyaltyTreeLogo from './logo-192.png'
import { BENEFITS_CATEGORIES, benefitMoney, benefitPoints, benefitsCardReference, benefitsClaimKey, benefitsClaimState, benefitsDemoAllowed, benefitsFailure, readBenefitsEntry, saveBenefitsEntry, clearBenefitsClaimKey, clearBenefitsSession, filterBenefitsOffers, offerCategory, readBenefitsSession, safeBenefitsImage, saveBenefitsSession, scrubBenefitsReference, validBenefitsClaim, validBenefitsConfig, validBenefitsMe, validBenefitsOffers } from './benefitsModel'
import './loyalty-benefits.css'

const PAGE_SIZE = 24
const localDate = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'No expiry listed'
const storage = { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: key => window.localStorage.removeItem(key) }

function Icon({ name, ...props }) {
  const paths = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    spark: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z"/></>,
    ticket: <><path d="M3 8V5h18v3a4 4 0 0 0 0 8v3H3v-3a4 4 0 0 0 0-8Z"/><path d="M15 5v3m0 3v2m0 3v3"/></>,
    card: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-14 5h4"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/></>,
    check: <path d="m5 12 4 4L19 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>, lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/></>,
    leaf: <><path d="M20 3C8 2 3 9 6 16c7 3 14-2 14-13Z"/><path d="M4 21 16 8"/></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.spark}</svg>
}

function Modal({ title, onClose, className = '', children }) {
  const ref = useRef(null)
  const titleId = useId()
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { if (dialog?.open) dialog.close() } }, [])
  return <dialog ref={ref} className={`lt-benefit-dialog ${className}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === ref.current) onClose() }}><div className="lt-benefit-dialog-inner"><button className="lt-benefit-close" type="button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button><h2 id={titleId}>{title}</h2>{children}</div></dialog>
}

function Photo({ offer, large = false }) {
  const [failed, setFailed] = useState('')
  const source = safeBenefitsImage(offer.image_url)
  return <div className={`lt-benefit-photo lt-benefit-photo-${offerCategory(offer)}${large ? ' is-large' : ''}`}>
    {source && failed !== source ? <img src={source} alt="" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setFailed(source)}/> : <div className="lt-benefit-photo-art" aria-hidden="true"><span/><span/><Icon name="ticket"/><b>A little<br/>something good.</b></div>}
    <span className="lt-benefit-photo-shade"/>
  </div>
}

function Merchant({ offer }) {
  const [failed, setFailed] = useState('')
  const logo = safeBenefitsImage(offer.business_logo_url)
  return <span className="lt-benefit-merchant">{logo && failed !== logo ? <img src={logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(logo)}/> : <span className="lt-benefit-merchant-mark">{offer.business_name.slice(0, 1)}</span>}<span>{offer.business_name}</span></span>
}

function OfferTile({ offer, onOpen, points }) {
  const state = benefitsClaimState(offer, points)
  return <button type="button" className={`lt-benefit-offer${state === 'sold_out' || state === 'closed' || state === 'coming_soon' ? ' is-unavailable' : ''}${state === 'coming_soon' ? ' is-soon' : ''}`} onClick={() => onOpen(offer)} aria-label={`View ${offer.title} from ${offer.business_name}, ${benefitPoints(offer.points_cost)} LT Points`}>
    <div className="lt-benefit-offer-image"><Photo offer={offer}/><span className="lt-benefit-cost"><Icon name="spark"/>{benefitPoints(offer.points_cost)} <small>LT Points</small></span>{state === 'sold_out' && <span className="lt-benefit-stock-badge">Fully claimed</span>}{state === 'closed' && <span className="lt-benefit-stock-badge">Not available</span>}{state === 'coming_soon' && <span className="lt-benefit-stock-badge">Coming soon</span>}<span className="lt-benefit-image-category">{BENEFITS_CATEGORIES[offerCategory(offer)] || offerCategory(offer).replaceAll('_', ' ')}</span></div>
    <div className="lt-benefit-offer-copy"><Merchant offer={offer}/><h3>{offer.title}</h3><p>{offer.description || 'A little extra from a business you’ll love.'}</p><div className="lt-benefit-offer-bottom"><span>{offer.remaining_quantity > 0 ? `${benefitPoints(offer.remaining_quantity)} available` : 'Check back for more'}{offer.min_spend_centavos > 0 ? ` · Min. ${benefitMoney(offer.min_spend_centavos)}` : ''}</span><span className="lt-benefit-open-arrow"><Icon name="arrow"/></span></div></div>
  </button>
}

function AuthDialog({ request, cardReference, entry, onVerified, onClose, demo }) {
  const [consent, setConsent] = useState(false), [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [resendAt, setResendAt] = useState(0), [seconds, setSeconds] = useState(0)
  useEffect(() => { if (!resendAt) return; const update = () => setSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000))); update(); const timer = window.setInterval(update, 1000); return () => window.clearInterval(timer) }, [resendAt])
  const sendCode = async event => {
    event?.preventDefault()
    if (busy || !consent || !cardReference || seconds > 0) return
    setBusy(true); setError('')
    try {
      const body = await request('/auth/request-code', { method: 'POST', body: { ...cardReference, consent: true } })
      if (typeof body.challenge_id !== 'string') throw new Error('The verification request was incomplete. Please try again.')
      setChallenge(body.challenge_id); setResendAt(Date.now() + Math.max(1, Number(body.retry_after) || 60) * 1000)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  const verify = async event => {
    event.preventDefault(); if (busy || !/^\d{6}$/.test(code)) return
    setBusy(true); setError('')
    try {
      const body = await request('/auth/verify', { method: 'POST', body: { challenge_id: challenge, code } })
      if (typeof body.access_token !== 'string' || !body.access_token || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new Error('The verified session was incomplete. Please try again.')
      onVerified(body)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  return <Modal title={challenge ? 'One code. All your benefits.' : 'Verify your Wallet card.'} onClose={busy ? () => {} : onClose} className="lt-benefit-auth">
    {demo && <p className="lt-benefit-demo-note">Local demo only · Use code <b>123456</b>. No email is sent.</p>}
    {challenge ? <form onSubmit={verify}><p>Enter the 6-digit code sent to <b>{entry?.email_masked || 'the email on your card'}</b>.</p><label className="lt-benefit-field">Verification code<input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="000000"/></label><button className="lt-benefit-primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify & open Benefits'}</button><button type="button" className="lt-benefit-text-button" disabled={busy || seconds > 0} onClick={sendCode}>{seconds > 0 ? `Resend code in ${seconds}s` : 'Resend verification code'}</button></form> : <form onSubmit={sendCode}><p>Your LT profile is created automatically when you register for a loyalty card. We use the email and phone already saved on this card.</p><p>Send a code to <b>{entry?.email_masked || 'your registered email'}</b> to safely connect this card to your shared points and coupons.</p><label className="lt-benefit-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>I agree to connect this card to my Loyalty Tree profile using my registered email and phone. <a href="/privacy">Privacy Policy</a></span></label><button className="lt-benefit-primary" disabled={busy || !consent}>{busy ? 'Sending…' : 'Send verification code'}</button></form>}
    {error && <p role="alert" className="lt-benefit-error">{error}</p>}
  </Modal>
}

function OfferDialog({ offer, me, busy, error, onClaim, onSignIn, onClose }) {
  const state = benefitsClaimState(offer, me?.available_points ?? null)
  return <Modal title={offer.title} onClose={busy ? () => {} : onClose} className="lt-benefit-offer-dialog"><Photo offer={offer} large/><Merchant offer={offer}/><div className="lt-benefit-detail-cost"><Icon name="spark"/><strong>{benefitPoints(offer.points_cost)}</strong><span>LT Points</span></div><p>{offer.description}</p><div className="lt-benefit-terms"><h3>The little details</h3><p>{offer.terms || 'Present your claimed coupon and linked loyalty card to the merchant. Ask the team about eligible items before ordering.'}</p><dl><div><dt>Available</dt><dd>{benefitPoints(offer.remaining_quantity)} coupons</dd></div><div><dt>Per member</dt><dd>{offer.per_member_limit}</dd></div>{Number.isSafeInteger(offer.discount_centavos) && <div><dt>Coupon discount</dt><dd>{benefitMoney(offer.discount_centavos)} off</dd></div>}<div><dt>Claim until</dt><dd>{localDate(offer.ends_at)}</dd></div>{Number.isInteger(offer.coupon_valid_days) && <div><dt>Coupon validity</dt><dd>Up to {offer.coupon_valid_days} days after claim</dd></div>}{offer.min_spend_centavos > 0 && <div><dt>Minimum spend</dt><dd>{benefitMoney(offer.min_spend_centavos)}</dd></div>}</dl></div>
    {me && <p className="lt-benefit-claim-confirm">Claiming uses <b>{benefitPoints(offer.points_cost)} LT Points</b>. Your coupon will be saved in My Coupons. The merchant marks it used after you redeem in store.</p>}
    {error && <p role="alert" className="lt-benefit-error">{error}</p>}
    <button className="lt-benefit-primary" type="button" disabled={busy || state === 'sold_out' || state === 'closed' || state === 'coming_soon' || (me && state === 'insufficient')} onClick={me ? () => onClaim(offer) : onSignIn}>{busy ? 'Sending code…' : state === 'sold_out' ? 'Fully claimed' : state === 'closed' ? 'Currently unavailable' : state === 'coming_soon' ? 'Coming soon' : !me ? 'Verify card to claim' : state === 'insufficient' ? `Need ${benefitPoints(offer.points_cost - me.available_points)} more LT Points` : `Send code to redeem · ${benefitPoints(offer.points_cost)} LT Points`}<Icon name="arrow"/></button><p className="lt-benefit-fineprint">{state === 'coming_soon' ? 'This business is not open for redeem yet.' : me ? 'A code goes to your email every time you redeem. The coupon is added to your card at this business.' : 'Open from your Wallet card and verify to claim a benefit.'}</p>
  </Modal>
}

function CouponDialog({ coupon, demo, onDemoUse, busy, error, onClose }) {
  return <Modal title={coupon.title} onClose={onClose}><p className={`lt-benefit-status is-${coupon.status}`}>{coupon.status === 'used' ? 'Used in store' : coupon.status === 'expired' ? 'Expired' : 'Claimed · ready to use'}</p><h3>{coupon.business_name}</h3>{Number.isSafeInteger(coupon.discount_centavos) && <p><strong>{benefitMoney(coupon.discount_centavos)} off</strong> at this business</p>}{coupon.status === 'claimed' ? <><p>Your coupon is saved. At the participating store, show your existing linked loyalty card. The cashier scans your card, finds this coupon, and confirms redemption.</p>{coupon.min_spend_centavos > 0 && <p className="lt-benefit-card-notice">Minimum spend: {benefitMoney(coupon.min_spend_centavos)}</p>}<div className="lt-benefit-use-card"><Icon name="card"/><strong>Same card. A little extra.</strong><span>No new QR code needed.</span></div></> : <p>{coupon.status === 'used' ? `The merchant marked this coupon used${coupon.used_at ? ` on ${localDate(coupon.used_at)}` : ''}.` : 'This coupon is past its valid redemption period.'}</p>}<p className="lt-benefit-fineprint">Claimed {localDate(coupon.claimed_at)} · Valid until {localDate(coupon.expires_at)}</p>{demo && coupon.status === 'claimed' && <button type="button" className="lt-benefit-secondary" disabled={busy} onClick={() => onDemoUse(coupon)}>{busy ? 'Simulating…' : 'Demo: simulate cashier redemption'}</button>}{error && <p role="alert" className="lt-benefit-error">{error}</p>}</Modal>
}

// Decorative pattern only: this is not a customer barcode or a redeemable card.
const previewQrCells = Array.from({ length: 25 * 25 }, (_, index) => ({ x: index % 25, y: Math.floor(index / 25) })).filter(({ x, y }) => !((x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16) || (x > 5 && x < 20 && y > 10 && y < 15)) && ((x * 13 + y * 7 + x * y) % 9 < 4))

function PreviewQr() {
  return <svg className="lt-benefit-pass-qr" viewBox="0 0 29 29" role="img" aria-label="Illustrative QR pattern. Not a working loyalty card."><rect width="29" height="29" rx="1" fill="#fff"/><g transform="translate(2 2)" fill="#111">{[[0, 0], [18, 0], [0, 18]].map(([x, y]) => <g key={`${x}-${y}`}><rect x={x} y={y} width="7" height="7"/><rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff"/><rect x={x + 2} y={y + 2} width="3" height="3"/></g>)}{previewQrCells.map(({ x, y }) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1"/>)}<text x="12.5" y="13.9" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="2.45">SAMPLE</text></g></svg>
}

function AppleWalletPreview({ points, disabled, onExplore }) {
  return <aside className="lt-benefit-wallet-preview" aria-labelledby="benefit-wallet-preview-title">
    <div className="lt-benefit-wallet-preview-label" id="benefit-wallet-preview-title"><Icon name="card"/>YOUR CARD, WITH A LITTLE EXTRA</div>
    <div className="lt-benefit-iphone" role="group" aria-label={`Illustrative Apple Wallet loyalty card. Sample merchant rewards: eight of ten stamps. Shared LT Points: ${points == null ? 'loading' : benefitPoints(points)}. The QR is a sample.`}>
      <div className="lt-benefit-iphone-screen">
        <div className="lt-benefit-iphone-status" aria-hidden="true"><b>9:41</b><span className="lt-benefit-iphone-island"/><span className="lt-benefit-iphone-indicators"><svg viewBox="0 0 17 13"><path d="M1 12V9h2v3M5 12V6h2v6M9 12V3h2v9M13 12V0h2v12" stroke="currentColor" strokeWidth="1.2"/></svg><svg viewBox="0 0 17 13"><path d="M1 4Q8.5-2 16 4M4 7q4.5-4 9 0M7 10q1.5-1.5 3 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg><span className="lt-benefit-iphone-battery"/></span></div>
        <div className="lt-benefit-wallet-toolbar" aria-hidden="true"><span><svg viewBox="0 0 16 20"><path d="m11 3-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/></svg>Wallet</span><span className="lt-benefit-wallet-more">•••</span></div>
        <article className="lt-benefit-apple-pass" aria-hidden="true">
          <header className="lt-benefit-pass-header"><div className="lt-benefit-pass-merchant"><span className="lt-benefit-pass-merchant-mark"><Icon name="leaf"/></span><span><strong>Your business</strong><small>LOYALTY CARD</small></span></div><div className="lt-benefit-pass-header-stamps"><span>STAMPS</span><strong>8 <small>/ 10</small></strong></div></header>
          <div className="lt-benefit-pass-strip"><span className="lt-benefit-pass-sample">SAMPLE REWARDS</span><div className="lt-benefit-pass-stamps">{Array.from({length:10}, (_, index) => <span key={index} className={index < 8 ? 'is-earned' : ''}>{index < 8 ? <Icon name="leaf"/> : index === 9 ? <Icon name="spark"/> : null}</span>)}</div><p>A little closer to your next treat.</p></div>
          <div className="lt-benefit-pass-fields"><div><span>MEMBER</span><strong>You</strong></div><div className="lt-benefit-pass-shared"><span>LT POINTS</span><strong>{points == null ? '—' : benefitPoints(points)}</strong></div></div>
          <div className="lt-benefit-pass-barcode"><PreviewQr/><span>SAMPLE · NOT FOR SCANNING</span></div>
          <footer className="lt-benefit-pass-cobrand"><img src={loyaltyTreeLogo} alt=""/><span>With <b>Loyalty Tree</b></span></footer>
        </article>
        <div className="lt-benefit-wallet-featured-action"><button type="button" disabled={disabled} onClick={onExplore} aria-label="Explore Loyalty Tree Benefits, illustrative Wallet action"><Icon name="ticket"/><span>Offers &amp; Rewards</span></button><p>Opens Loyalty Tree Benefits · iOS 27</p></div>
        <span className="lt-benefit-iphone-home" aria-hidden="true"/>
      </div>
    </div>
    <p className="lt-benefit-wallet-caption">Apple Wallet concept · sample merchant rewards<br/><span>Your business rewards + your shared LT Points.</span></p>
    <p className="lt-benefit-wallet-compatibility">Older iOS: open Pass Details → Loyalty Tree Benefits</p>
    <button className="lt-benefit-wallet-explore" type="button" disabled={disabled} onClick={onExplore}>Explore benefits <Icon name="arrow"/></button>
  </aside>
}

function HowItWorks() {
  return <section className="lt-benefit-how" id="benefits-how"><div><span className="lt-benefit-eyebrow">A LITTLE LOYALTY GOES FURTHER</span><h2>Your usual favorites.<br/>Some unusual extras.</h2></div><ol><li><span>01</span><h3>Collect LT Points</h3><p>Eligible purchases at participating businesses grow your Benefits balance.</p></li><li><span>02</span><h3>Find your little win</h3><p>Choose an available benefit and exchange your LT Points for a coupon.</p></li><li><span>03</span><h3>Show your same card</h3><p>Visit the merchant. The cashier scans your linked loyalty card and redeems the coupon.</p></li></ol></section>
}


function QrConnect({ request, businessSlug, onVerified }) {
  const [email, setEmail] = useState(''), [consent, setConsent] = useState(false), [challenge, setChallenge] = useState('')
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const send = async event => {
    event.preventDefault()
    if (busy || !consent) return
    setBusy(true); setError('')
    try {
      const body = await request('/qr/request-code', { method: 'POST', body: { email: email.trim(), business_slug: businessSlug, consent: true } })
      if (typeof body.challenge_id !== 'string') throw new Error('The verification request was incomplete. Please try again.')
      setChallenge(body.challenge_id)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  const verify = async event => {
    event.preventDefault()
    if (busy || !/^\d{6}$/.test(code)) return
    setBusy(true); setError('')
    try {
      const body = await request('/auth/verify', { method: 'POST', body: { challenge_id: challenge, code } })
      if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('The verified session was incomplete. Please try again.')
      onVerified(body)
    } catch (failure) { setError(failure.message) } finally { setBusy(false) }
  }
  if (challenge) return <form onSubmit={verify}><label className="lt-benefit-field">Verification code<input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></label><button className="lt-benefit-primary" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Stay logged in on this phone'}</button>{error && <p role="alert" className="lt-benefit-error">{error}</p>}</form>
  return <form onSubmit={send}><label className="lt-benefit-field">Email on your cards<input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@email.com"/></label><label className="lt-benefit-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)}/><span>I agree to connect the cards on this email to my Loyalty Tree profile. <a href="/privacy">Privacy Policy</a></span></label><button className="lt-benefit-primary" disabled={busy || !consent}>{busy ? 'Sending…' : 'Send verification code'}</button>{error && <p role="alert" className="lt-benefit-error">{error}</p>}</form>
}

export default function LoyaltyBenefits({ API_BASE = '' }) {
  const demo = benefitsDemoAllowed({ development: import.meta.env.DEV, hostname: window.location.hostname, search: window.location.search })
  const initialReference = useRef(demo ? {customer_public_id:'demo-northstar-card',card_token:'local-demo-card-proof'} : benefitsCardReference(window.location.search) || readBenefitsEntry(storage))
  const [cardReference] = useState(initialReference.current)
  const [session, setSession] = useState(() => demo ? null : readBenefitsSession(storage))
  const sessionRef = useRef(session); sessionRef.current = session
  const [entry, setEntry] = useState(null), [entryError, setEntryError] = useState(''), [entryLoading, setEntryLoading] = useState(!!initialReference.current)
  const [config, setConfig] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [me, setMe] = useState(null)
  const [view, setView] = useState('discover')
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [affordable, setAffordable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [accountLoading, setAccountLoading] = useState(false)
  const [loadingCoupons, setLoadingCoupons] = useState(false)
  const [moreCoupons, setMoreCoupons] = useState(false)
  const couponOffset = useRef(0)
  const [error, setError] = useState('')
  const [accountError, setAccountError] = useState('')
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const [authOpen, setAuthOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [selectedCoupon, setSelectedCoupon] = useState(null)
  const [claimError, setClaimError] = useState('')
  const [claimBusy, setClaimBusy] = useState(false)
  const [redeemOffer, setRedeemOffer] = useState(null)
  const [redeemChallenge, setRedeemChallenge] = useState('')
  const [redeemCode, setRedeemCode] = useState('')
  const [emailCards, setEmailCards] = useState(null)
  const [cardPick, setCardPick] = useState({})
  const [confirmBusy, setConfirmBusy] = useState(false)
  const businessSlugRef = useRef((() => { const value = new URLSearchParams(window.location.search).get('business') || ''; return /^[A-Za-z0-9_-]{1,120}$/.test(value) ? value : '' })())
  const claimAttempt = useRef(null)
  const operationBusy = useRef(false)
  const requests = useRef(new Set())
  const transport = useMemo(() => import.meta.env.DEV && demo ? import('../../dev/loyalty-benefits-fixtures.js').then(module => module.createBenefitsDemo({ development: true, hostname: window.location.hostname, search: window.location.search })) : Promise.resolve((path, options) => fetch(`${API_BASE.replace(/\/$/, '')}/api/v1/benefits${path}`, options)), [demo, API_BASE])
  const clearSession = useCallback(() => { clearBenefitsSession(storage); setSession(null); sessionRef.current = null; setMe(null); setAffordable(false) }, [])
  const scrubReference = () => { window.history.replaceState(window.history.state, '', scrubBenefitsReference(window.location.href)) }
  const request = useCallback(async (path, options = {}) => {
    const controller = new AbortController(); requests.current.add(controller)
    try {
      const send = await transport
      const response = await send(path, { method: options.method || 'GET', cache: 'no-store', signal: options.signal || controller.signal, referrerPolicy: 'no-referrer', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}), ...(options.headers || {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) { if (response.status === 401 && options.token && sessionRef.current?.token === options.token) clearSession(); const failure = new Error(benefitsFailure(response.status, typeof body.detail === 'string' ? body.detail : '')); failure.status = response.status; throw failure }
      return body
    } catch (failure) { if (failure.name === 'AbortError' || failure.status) throw failure; throw new Error('We could not connect to Benefits. Please try again shortly.') }
    finally { requests.current.delete(controller) }
  }, [transport, clearSession])
  useEffect(() => () => { for (const controller of requests.current) controller.abort() }, [])
  useEffect(() => {
    if (!cardReference) { setEntryLoading(false); return }
    const controller = new AbortController(); let active = true
    setEntryLoading(true); setEntryError('')
    request('/entry', {method:'POST', body:cardReference, token: session?.token, signal: controller.signal}).then(value => {
      if (typeof value.verified !== 'boolean' || typeof value.email_masked !== 'string') throw new Error('This Wallet entry could not be verified.')
      if (!active) return
      setEntry(value); saveBenefitsEntry(storage, cardReference)
      if (!value.verified && session?.token) clearSession()
    }).catch(failure => { if (active && failure.name !== 'AbortError') setEntryError(failure.message) }).finally(() => { if (active) setEntryLoading(false) })
    return () => { active = false; controller.abort() }
  }, [cardReference, session?.token, request, clearSession, retry])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true); setError('')
    ;(async () => {
      try {
        const settings = await request('/config', { signal: controller.signal })
        if (!validBenefitsConfig(settings)) throw new Error('Benefits returned an incomplete response. Please try again shortly.')
        if (!active) return
        setConfig(settings)
        if (!settings.enabled || !settings.available) { setCatalog([]); return }
        if (!session?.token || (cardReference && !entry?.verified)) { setCatalog([]); return }
        const body = await request(`/offers?limit=${PAGE_SIZE}&offset=0`, { signal: controller.signal, token: session.token })
        if (!validBenefitsOffers(body)) throw new Error('The benefits catalog could not be loaded. Please try again shortly.')
        if (active) { setCatalog(body.offers); setHasMore(body.has_more) }
      } catch (failure) { if (active && failure.name !== 'AbortError') setError(failure.message) }
      finally { if (active) setLoading(false) }
    })()
    return () => { active = false; controller.abort() }
  }, [request, retry, entry?.verified, session?.token])
  const loadMe = useCallback(async (token, signal) => {
    const body = await request('/me', { token, signal })
    if (!validBenefitsMe(body)) throw new Error('Your Benefits account could not be loaded completely. Please refresh shortly.')
    if (sessionRef.current?.token === token) { setMe(body); couponOffset.current = 0; setMoreCoupons(body.has_more === true && body.coupons.length === 25); window.history.replaceState(window.history.state, '', scrubBenefitsReference(window.location.href)) }
    return body
  }, [request])
  useEffect(() => {
    if (!session?.token || !config?.enabled || !config?.available) return
    let active = true
    const controller = new AbortController(); setAccountLoading(true); setAccountError('')
    loadMe(session.token, controller.signal).catch(failure => { if (active && failure.name !== 'AbortError') { if (failure.status === 401) clearSession(); setAccountError(failure.message) } }).finally(() => { if (active) setAccountLoading(false) })
    return () => { active = false; controller.abort() }
  }, [session?.token, config?.enabled, config?.available, loadMe, clearSession])
  useEffect(() => {
    if (!session?.token || !me) return
    let active = true
    request(`/email-cards?business=${encodeURIComponent(businessSlugRef.current)}`, { token: session.token }).then(data => {
      if (active && data && Array.isArray(data.cards)) setEmailCards(data)
    }).catch(() => { if (active) setEmailCards(null) })
    return () => { active = false }
  }, [session?.token, me, request])
  const ready = config?.enabled && config?.available
  const auth = () => { setClaimError(''); setSelected(null); setAuthOpen(true) }
  const verified = body => {
    const saved = demo ? { token: body.access_token, expires_at: Date.now() + body.expires_in * 1000 } : saveBenefitsSession(storage, body.access_token, body.expires_in)
    sessionRef.current = saved; setSession(saved); setAuthOpen(false); setAccountError(''); scrubReference()
    setEntry(current => ({...current, verified: true})); setNotice('Your card is connected. Your shared LT Points and coupons are ready.')
  }
  const moreOffers = async () => {
    if (loadingMore) return
    setLoadingMore(true); setError('')
    try { const body = await request(`/offers?limit=${PAGE_SIZE}&offset=${catalog.length}`, {token: sessionRef.current?.token}); if (!validBenefitsOffers(body)) throw new Error('More benefits could not be loaded. Please try again.'); setCatalog(current => [...current, ...body.offers.filter(offer => !current.some(previous => previous.id === offer.id))]); setHasMore(body.has_more) } catch (failure) { setError(failure.message) } finally { setLoadingMore(false) }
  }
  const loadMoreCoupons = async () => {
    if (loadingCoupons || !sessionRef.current) return
    setLoadingCoupons(true); setAccountError('')
    const token = sessionRef.current.token, offset = couponOffset.current + 25
    try {
      const body = await request(`/me?limit=25&offset=${offset}`, { token })
      if (!validBenefitsMe(body)) throw new Error('More coupons could not be loaded. Please try again shortly.')
      if (sessionRef.current?.token !== token) return
      setMe(current => current ? { ...current, coupons: [...current.coupons, ...body.coupons.filter(coupon => !current.coupons.some(saved => saved.id === coupon.id))] } : current)
      couponOffset.current = offset; setMoreCoupons(body.has_more === true && body.coupons.length === 25)
    } catch (failure) { setAccountError(failure.message) } finally { setLoadingCoupons(false) }
  }
  const beginRedeem = async offer => {
    if (!me || !sessionRef.current || operationBusy.current) return
    if (offer.coming_soon) { setClaimError('This benefit is coming soon.'); return }
    operationBusy.current = true; setClaimBusy(true); setClaimError('')
    try {
      const body = await request('/redeem/request-code', { method: 'POST', body: { offer_id: offer.id }, token: sessionRef.current.token })
      if (typeof body.challenge_id !== 'string') throw new Error('The redeem code could not be sent.')
      setRedeemOffer(offer); setRedeemChallenge(body.challenge_id); setRedeemCode(''); setSelected(null)
    } catch (failure) { setClaimError(failure.message) }
    finally { operationBusy.current = false; setClaimBusy(false) }
  }
  const claim = async offer => {
    if (!me || !sessionRef.current || operationBusy.current || redeemCode.length !== 6 || !redeemChallenge) return
    operationBusy.current = true; setClaimBusy(true); setClaimError('')
    const token = sessionRef.current.token
    try {
      const identity = `${me.member.id}:${offer.id}`
      const key = claimAttempt.current?.identity === identity ? claimAttempt.current.key : benefitsClaimKey(demo ? null : storage, me.member.id, offer.id, () => crypto.randomUUID())
      claimAttempt.current = { identity, key }
      const body = await request(`/offers/${encodeURIComponent(offer.id)}/claim`, { method: 'POST', body: {}, token, key, headers: { 'X-Redeem-Challenge': redeemChallenge, 'X-Redeem-Code': redeemCode } })
      if (!validBenefitsClaim(body)) throw new Error('The claim response was incomplete. Retry with the same claim reference before claiming again.')
      if (sessionRef.current?.token !== token) return
      clearBenefitsClaimKey(demo ? null : storage, me.member.id, offer.id); claimAttempt.current = null
      setMe(current => current ? { ...current, balance_points: body.balance_points, available_points: body.available_points, coupons: [body.coupon, ...current.coupons.filter(coupon => coupon.id !== body.coupon.id)] } : current)
      setSelected(null); setRedeemOffer(null); setRedeemChallenge(''); setRedeemCode(''); setView('coupons'); setNotice('Benefit redeemed. The coupon is on your card at that business. Show that card to the cashier.'); setSelectedCoupon(body.coupon)
      await loadMe(token).catch(failure => setAccountError(failure.message))
      const listing = await request(`/offers?limit=${PAGE_SIZE}&offset=0`, {token}).catch(() => null)
      if (validBenefitsOffers(listing)) { setCatalog(listing.offers); setHasMore(listing.has_more) }
    } catch (failure) {
      setClaimError(failure.message)
      if (failure.status === 401 && sessionRef.current?.token === token) { clearSession(); setSelected(null); setAuthOpen(true) }
      if (failure.status === 409) { claimAttempt.current = null; clearBenefitsClaimKey(demo ? null : storage, me.member.id, offer.id); await loadMe(token).catch(() => {}) }
    } finally { operationBusy.current = false; setClaimBusy(false) }
  }
  const signOut = async () => { const token = sessionRef.current?.token; clearSession(); setView('discover'); setNotice('Logged out on this phone.'); if (token) await request('/logout', { method: 'POST', token }).catch(() => {}) }
  const demoUse = async coupon => { if (!demo || claimBusy) return; setClaimBusy(true); setClaimError(''); try { await request(`/__demo/use/${coupon.id}`, { method: 'POST', token: sessionRef.current.token }); const updated = await loadMe(sessionRef.current.token); setSelectedCoupon(updated.coupons.find(value => value.id === coupon.id)); setNotice('Demo: the cashier marked this coupon used in store. No live record was changed.') } catch (failure) { setClaimError(failure.message) } finally { setClaimBusy(false) } }
  const categories = ['all', ...new Set(catalog.map(offerCategory))]
  const filtered = filterBenefitsOffers(catalog, { category, search, affordable, points: me?.available_points || 0 })
  const coupons = me?.coupons || []
  const go = next => { setView(next); setSearch(''); setNotice('') }
  const qrLocked = !cardReference && !session?.token
  const walletLocked = !!cardReference && (entryLoading || entryError || !entry?.verified || !session?.token)
  if (qrLocked || walletLocked) return <div className="lt-benefits-customer"><main className="lt-benefit-entry-gate"><img src={loyaltyTreeLogo} alt="Loyalty Tree"/><p className="lt-benefit-eyebrow">LOYALTY TREE BENEFITS</p><h1>{qrLocked ? 'Your benefits, on this phone.' : 'Your card. More possibilities.'}</h1><p>{qrLocked ? 'Enter the email on your loyalty cards. One code keeps Benefits and Cards open on this phone. Redeem still asks for a code every time.' : entryLoading ? 'Checking your Wallet card…' : entryError || `Welcome from ${entry?.business_name || 'your loyalty card'}. Verify the code sent to your registered email to connect your shared points and coupons. No password or separate registration needed.`}</p>{notice && <p className="lt-benefit-success" role="status"><Icon name="check"/>{notice}</p>}{demo && <p className="lt-benefit-demo-note">LOCAL DEMO · No live email is sent. Use code 123456.</p>}{qrLocked && <QrConnect request={request} businessSlug={businessSlugRef.current} onVerified={verified}/>}{cardReference && !entryLoading && !entryError && <button type="button" className="lt-benefit-primary" onClick={auth}>Continue with my card <Icon name="arrow"/></button>}{entryError && <button className="lt-benefit-secondary" onClick={() => setRetry(value => value + 1)}>Check card again</button>}<p className="lt-benefit-fineprint">{qrLocked ? 'The login stays in this browser until you log out.' : 'Cards from different businesses connect after verification when both your registered email and phone match.'}</p></main>{authOpen && <AuthDialog request={request} cardReference={cardReference} entry={entry} onVerified={verified} onClose={() => setAuthOpen(false)} demo={demo}/>}</div>

  return <div className="lt-benefits-customer">
    {demo && <div className="lt-benefit-demo-banner"><b>LOCAL DEMO</b> Fictional businesses, benefits and points. No email, payment or live notification is sent.</div>}
    <div className="lt-benefit-topline"><span><Icon name="spark"/>A little loyalty. More possibilities.</span><a href="#benefits-how">How it works <span>↗</span></a></div>
    <header className="lt-benefit-header"><a className="lt-benefit-brand" href="/benefits" aria-label="Loyalty Tree Benefits home"><img src={loyaltyTreeLogo} alt=""/><span>Loyalty Tree<small>BENEFITS</small></span></a><nav aria-label="Benefits navigation">{[{ id: 'discover', label: 'Discover', icon: 'spark' }, { id: 'coupons', label: 'My Coupons', icon: 'ticket' }, { id: 'account', label: 'My Cards', icon: 'card' }].map(item => <button key={item.id} type="button" className={view === item.id ? 'is-active' : ''} onClick={() => go(item.id)} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon}/>{item.label}{item.id === 'coupons' && coupons.some(coupon => coupon.status === 'claimed') && <span className="lt-benefit-nav-count">{coupons.filter(coupon => coupon.status === 'claimed').length}</span>}</button>)}</nav><button className="lt-benefit-account-button" type="button" disabled={!ready} onClick={me ? () => go('account') : auth}><Icon name={me ? 'spark' : 'user'}/><span>{me ? `${benefitPoints(me.available_points)} LT Points` : accountLoading ? 'Loading…' : 'Verify card'}</span></button></header>
    <main className="lt-benefit-main">
      {notice && <p className="lt-benefit-success" role="status"><Icon name="check"/>{notice}<button type="button" onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></p>}
      {accountError && <p className="lt-benefit-error" role="alert">{accountError}<button type="button" onClick={session ? () => loadMe(session.token).then(() => setAccountError('')).catch(failure => setAccountError(failure.message)) : auth}>{session ? 'Refresh account' : 'Verify card'}</button></p>}
      {view === 'discover' && <>
        <section className="lt-benefit-hero"><div className="lt-benefit-hero-copy"><span className="lt-benefit-eyebrow"><span/>EVERYDAY LOYALTY. EXTRAORDINARY LITTLE WINS.</span><h1>Good things<br/>come <span>back.</span><svg viewBox="0 0 300 20" aria-hidden="true"><path d="M2 15Q130 0 294 9"/></svg></h1><p>Your coffee runs. Your local favorites. Now a little more rewarding. Turn your LT Points into benefits worth coming back for.</p><div className="lt-benefit-hero-actions"><a className="lt-benefit-primary" href="#benefits-catalog">Find my next benefit<Icon name="arrow"/></a><a className="lt-benefit-hero-link" href="#benefits-how">Meet your LT Points <span>↗</span></a></div><div className="lt-benefit-hero-trust"><span><Icon name="card"/>Your existing loyalty cards</span><i/><span><Icon name="ticket"/>A whole new set of extras</span></div></div><AppleWalletPreview points={me?.available_points} disabled={!ready} onExplore={me ? () => document.getElementById('benefits-catalog')?.scrollIntoView({ behavior: 'smooth' }) : auth}/></section>
        <section className="lt-benefit-catalog" id="benefits-catalog" aria-labelledby="benefit-catalog-title"><div className="lt-benefit-section-heading"><div><span className="lt-benefit-eyebrow">THE GOOD STUFF</span><h2 id="benefit-catalog-title">Little treats. Big yes.</h2></div><p>Discover benefits from participating businesses.<br/>Find a favorite. Make it yours.</p></div>
          {loading ? <div className="lt-benefit-skeletons" role="status" aria-label="Loading benefits"><span/><span/><span/></div> : error && !catalog.length ? <div className="lt-benefit-empty" role="alert"><Icon name="leaf"/><h3>Let’s try that again.</h3><p>{error}</p><button className="lt-benefit-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Reload benefits</button></div> : !ready ? <div className="lt-benefit-empty"><Icon name="spark"/><h3>{config?.enabled ? 'A little pause for something good.' : 'Good things are on their way.'}</h3><p>{config?.enabled ? 'Benefits is being prepared or is temporarily unavailable. Please check back shortly.' : 'Loyalty Tree Benefits is not open yet. Your existing loyalty cards keep working as usual.'}</p><a href="/" className="lt-benefit-secondary">Visit Loyalty Tree <Icon name="arrow"/></a></div> : <>
            <div className="lt-benefit-tools"><nav className="lt-benefit-filters" aria-label="Benefit categories">{categories.map(value => <button type="button" key={value} aria-pressed={category === value} className={category === value ? 'is-active' : ''} onClick={() => setCategory(value)}>{BENEFITS_CATEGORIES[value] || value.replaceAll('_', ' ')}</button>)}</nav><label className="lt-benefit-search"><Icon name="search"/><input type="search" placeholder="Find your next favorite" aria-label="Search benefits" value={search} onChange={event => setSearch(event.target.value)}/></label></div><div className="lt-benefit-result-row"><span>{benefitPoints(filtered.length)} {filtered.length === 1 ? 'benefit' : 'benefits'} to explore</span><label className="lt-benefit-affordable"><input type="checkbox" checked={affordable} disabled={!me} onChange={event => setAffordable(event.target.checked)}/>Within my points</label></div>
            {filtered.length ? <div className="lt-benefit-grid">{filtered.map(offer => <OfferTile offer={offer} points={me?.available_points ?? null} key={offer.id} onOpen={value => { setSelected(value); setClaimError('') }}/>)}</div> : <div className="lt-benefit-empty"><Icon name="ticket"/><h3>{catalog.length ? 'Your next favorite is out there.' : 'The shelf is getting ready.'}</h3><p>{catalog.length ? 'Try another category or search to find a little something good.' : 'No benefits are available right now. Check back for new offers from participating businesses.'}</p>{catalog.length > 0 && <button type="button" className="lt-benefit-secondary" onClick={() => { setCategory('all'); setSearch(''); setAffordable(false) }}>Explore all benefits</button>}</div>}
            {error && <p className="lt-benefit-error" role="alert">{error}</p>}{hasMore && <button type="button" className="lt-benefit-load-more lt-benefit-secondary" disabled={loadingMore} onClick={moreOffers}>{loadingMore ? 'Finding more good things…' : 'Discover more benefits'}<Icon name="arrow"/></button>}
          </>}
        </section>
      </>}
      {view === 'coupons' && <section className="lt-benefit-personal"><span className="lt-benefit-eyebrow">SAVED FOR SOMETHING GOOD</span><h1>My Coupons<span>.</span></h1><p>Your claimed benefits, ready for their little moment in store.</p>{accountLoading ? <p className="lt-benefit-state" role="status">Loading your coupons…</p> : !me ? <div className="lt-benefit-empty"><Icon name="ticket"/><h3>Your little wins live here.</h3><p>Verify your Wallet card to see your claimed coupons.</p><button type="button" className="lt-benefit-primary" disabled={!ready} onClick={auth}>Find my coupons<Icon name="arrow"/></button></div> : !coupons.length ? <div className="lt-benefit-empty"><Icon name="ticket"/><h3>A little empty. A lot of potential.</h3><p>Claim your first benefit with LT Points. It will be saved right here.</p><button type="button" className="lt-benefit-primary" onClick={() => go('discover')}>Discover benefits<Icon name="arrow"/></button></div> : <div className="lt-benefit-coupon-grid">{coupons.map(coupon => <button className={`lt-benefit-saved-coupon is-${coupon.status}`} type="button" key={coupon.id} onClick={() => { setSelectedCoupon(coupon); setClaimError('') }}><div><span className={`lt-benefit-status is-${coupon.status}`}>{coupon.status === 'used' ? 'Used in store' : coupon.status === 'expired' ? 'Expired' : 'Claimed · ready to use'}</span><small>{coupon.business_name}</small><h3>{coupon.title}</h3><p>Valid until {localDate(coupon.expires_at)}</p></div><span className="lt-benefit-coupon-stub"><Icon name="ticket"/><span>View<br/>benefit ↗</span></span></button>)}</div>}{me && moreCoupons && <button type="button" className="lt-benefit-load-more lt-benefit-secondary" disabled={loadingCoupons} onClick={loadMoreCoupons}>{loadingCoupons ? 'Loading more coupons…' : 'Load more coupons'}<Icon name="arrow"/></button>}<p className="lt-benefit-personal-note"><Icon name="card"/>Bring your linked loyalty card. The cashier scans it to find and redeem your coupon.</p></section>}
      {view === 'account' && <section className="lt-benefit-personal"><span className="lt-benefit-eyebrow">ONE YOU. MORE POSSIBILITIES.</span><h1>All your loyalty<span>.</span></h1><p>Linked cards, shared LT Points, and the businesses you come back to.</p>{accountLoading ? <p className="lt-benefit-state" role="status">Loading your linked cards…</p> : !me ? <div className="lt-benefit-empty"><Icon name="card"/><h3>Your cards belong together.</h3><p>Verify the email on your loyalty cards to connect eligible cards to Benefits.</p><button type="button" className="lt-benefit-primary" disabled={!ready} onClick={auth}>Connect my cards<Icon name="arrow"/></button></div> : <><div className="lt-benefit-account-summary"><div><span>YOUR LT POINTS</span><strong>{benefitPoints(me.available_points)} <small>available</small></strong><p>{benefitPoints(me.balance_points)} total balance · Store points and stamps stay with each business.</p></div><div><span>VERIFIED EMAIL</span><strong className="lt-benefit-email">{me.member.email_masked}</strong><button className="lt-benefit-text-button" type="button" onClick={signOut}>Log out</button></div></div><h2 className="lt-benefit-card-heading">Your linked cards <span>{me.cards.length}</span></h2>{me.cards.length ? <div className="lt-benefit-wallet-grid">{me.cards.map((card, index) => <article className={`lt-benefit-wallet-card tone-${index % 3}`} key={card.customer_public_id}><div><span>LINKED LOYALTY CARD</span><Icon name="leaf"/></div><strong>{card.business_name}</strong><p>Part of your Loyalty Tree Benefits account</p><footer><span><Icon name="check"/>Verified & linked</span><Icon name="card"/></footer></article>)}</div> : <div className="lt-benefit-state">No cards are linked yet. Open Loyalty Tree Benefits from your existing Wallet card to review and link it.</div>}{emailCards && <section className="lt-benefit-activity"><h2>Cards on this email</h2><p className="lt-benefit-fineprint">Check a card to include it. The card you just verified is already included when it is on this email.</p>{emailCards.cards.map(card => <label key={card.customer_public_id} className="lt-benefit-consent"><input type="checkbox" checked={card.included || !!cardPick[card.customer_public_id]} disabled={card.included || confirmBusy} onChange={event => setCardPick(current => ({...current, [card.customer_public_id]: event.target.checked}))}/><span><b>{card.name}</b> · {card.business_name}{card.included ? ' · included' : ''}</span></label>)}{!emailCards.cards.length && <p>No other cards were found on this email.</p>}{emailCards.has_card_at_business === false && emailCards.business_slug && <a className="lt-benefit-primary" href={`/join/${encodeURIComponent(emailCards.business_slug)}`}>Join this business loyalty card</a>}<button type="button" className="lt-benefit-secondary" disabled={confirmBusy || !Object.values(cardPick).some(Boolean)} onClick={async () => { const ids = Object.entries(cardPick).filter(([, on]) => on).map(([id]) => id); if (!ids.length || !sessionRef.current) return; setConfirmBusy(true); setAccountError(''); try { const result = await request('/email-cards/confirm', { method: 'POST', body: { customer_public_ids: ids }, token: sessionRef.current.token }); setCardPick({}); if (result.failed?.length) setAccountError(result.failed[0].detail || 'Some cards could not be included yet.'); else setNotice('Selected cards were included.'); const data = await request(`/email-cards?business=${encodeURIComponent(businessSlugRef.current)}`, { token: sessionRef.current.token }); if (data && Array.isArray(data.cards)) setEmailCards(data); await loadMe(sessionRef.current.token).catch(() => {}) } catch (failure) { setAccountError(failure.message) } finally { setConfirmBusy(false) } }}>{confirmBusy ? 'Including…' : 'Include selected cards'}</button></section>}
{me.activity.length > 0 && <section className="lt-benefit-activity"><h2>Your recent activity</h2>{me.activity.slice(0, 10).map(item => <div key={item.id}><span className="lt-benefit-activity-icon"><Icon name={item.points_delta > 0 ? 'spark' : 'ticket'}/></span><span><strong>{item.description}</strong><small>{localDate(item.created_at)}</small></span><b>{item.points_delta > 0 ? '+' : ''}{benefitPoints(item.points_delta)}<small> LT Points</small></b></div>)}</section>}</> }</section>}
      <HowItWorks/>
    </main>
    <footer className="lt-benefit-footer"><a className="lt-benefit-brand" href="/"><img src={loyaltyTreeLogo} alt=""/><span>Loyalty Tree<small>GOOD THINGS GROW HERE.</small></span></a><p>LT Points are for participating Benefits offers.<br/>Each business’s own loyalty program stays its own.</p><nav aria-label="Benefits footer"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Get in touch ↗</a></nav></footer>
    {authOpen && <AuthDialog request={request} cardReference={cardReference} entry={entry} onVerified={verified} onClose={() => setAuthOpen(false)} demo={demo}/>}
    {selected && <OfferDialog offer={selected} me={me} busy={claimBusy} error={claimError} onClaim={beginRedeem} onSignIn={auth} onClose={() => setSelected(null)}/>}
    {redeemOffer && <Modal title="Code to redeem" onClose={claimBusy ? () => {} : () => { setRedeemOffer(null); setRedeemCode(''); setRedeemChallenge('') }}><p>Enter the 6-digit code sent to your email. The coupon is added to your card at <b>{redeemOffer.business_name}</b>.</p><form onSubmit={event => { event.preventDefault(); claim(redeemOffer) }}><label className="lt-benefit-field">Redeem code<input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={redeemCode} onChange={event => setRedeemCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></label><button className="lt-benefit-primary" disabled={claimBusy || redeemCode.length !== 6}>{claimBusy ? 'Redeeming…' : 'Redeem benefit'}</button></form>{claimError && <p role="alert" className="lt-benefit-error">{claimError}</p>}</Modal>}
    {selectedCoupon && <CouponDialog coupon={selectedCoupon} demo={demo} onDemoUse={demoUse} busy={claimBusy} error={claimError} onClose={() => setSelectedCoupon(null)}/>}

  </div>
}
