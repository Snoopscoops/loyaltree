import React, { useState, useEffect, useRef, useCallback } from 'react'
import { formatMoney } from './currency'

// Owner billing + post-signup activation.
// PH: QR Ph by default, with an optional card path.
// International V1: foreign Visa/Mastercard via PayMongo card Payment Intents.
// PayMongo currently processes these Payment Intents in PHP, so the UI always
// discloses the exact PHP processor charge next to the fixed localized LT price.
// Raw card data is sent from the browser straight to PayMongo and never to LT.

const QR_TTL_SECONDS = 600
const POLL_INTERVAL_MS = 4000
const PENDING_CARD_KEY = 'loyaltree_paymongo_pending_card'

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

const BILLING_TERMS = {
  monthly: { label: 'Monthly', payLabel: '1 Month', pricingKey: 'monthly', summary: '30 days of access per payment.' },
  '3_months': { label: '3 Months', payLabel: '3 Months', pricingKey: '3_months', summary: 'Prepay 3 months of access at the regular monthly rate.' },
  '6_months': { label: '6 Months', payLabel: '6 Months', pricingKey: '6_months', summary: 'Prepay 6 months of access at the regular monthly rate.' },
  annual: { label: '1 Year', payLabel: '1 Year', pricingKey: 'annual', summary: '12 months of access for the price of 10 monthly periods.', savings: '2 months free' },
}

function normalizeBillingCycle(value) {
  return BILLING_TERMS[value] ? value : 'monthly'
}

function billingCycleLabel(value) {
  return BILLING_TERMS[normalizeBillingCycle(value)].label
}

const STATUS_META = {
  active: { label: 'Active', color: '#0d9488', bg: '#f0fdfa' },
  expiring_soon: { label: 'Expiring soon', color: '#d97706', bg: '#fffbeb' },
  expired: { label: 'Expired', color: '#dc2626', bg: '#fef2f2' },
  none: { label: 'No payment yet', color: '#64748b', bg: '#f1f5f9' },
}

function paymongoError(payload, fallback) {
  return payload?.errors?.[0]?.detail || payload?.errors?.[0]?.code || payload?.detail || fallback
}

function SubscriptionPayment({
  API_BASE,
  businessSlug,
  title = 'Billing',
  subtitle = 'Keep your subscription active with secure billing.',
  successMessage = '🎉 Payment received — your subscription has been extended.',
  initialBillingCycle,
  onPaid,
}) {
  const [subscription, setSubscription] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
  const [cardPaying, setCardPaying] = useState(false)
  const [error, setError] = useState('')
  const [checkout, setCheckout] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [paidJustNow, setPaidJustNow] = useState(false)
  const [billingCycle, setBillingCycle] = useState(normalizeBillingCycle(initialBillingCycle))
  const [paymentMethod, setPaymentMethod] = useState('qrph')
  const [card, setCard] = useState({ number: '', expMonth: '', expYear: '', cvc: '' })
  const pollRef = useRef(null)
  const countdownRef = useRef(null)

  const loadSubscription = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription`)
      if (res.ok) {
        const data = await res.json()
        setSubscription(data)
        if (!initialBillingCycle && data?.billing_cycle) {
          setBillingCycle(normalizeBillingCycle(data.billing_cycle))
        }
        if (data?.pricing_region && data.pricing_region !== 'PH') setPaymentMethod('card')
      }
    } catch (e) {
      // Keep the page usable; checkout will surface a useful error if needed.
    }
  }, [API_BASE, businessSlug, initialBillingCycle])

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription/payments`)
      if (res.ok) setHistory(await res.json())
    } catch (e) {
      // silent
    }
  }, [API_BASE, businessSlug])

  const stopPolling = useCallback(() => {
    clearInterval(pollRef.current)
    clearInterval(countdownRef.current)
  }, [])

  const clearPendingCard = () => {
    try { sessionStorage.removeItem(PENDING_CARD_KEY) } catch (e) { /* ignore */ }
  }

  const startPolling = useCallback((intentId, options = {}) => {
    const { qrCountdown = false } = options
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription/payments`)
        if (!res.ok) return
        const rows = await res.json()
        const match = rows.find(r => r.paymongo_payment_intent_id === intentId)
        if (match && match.status === 'paid') {
          stopPolling()
          clearPendingCard()
          setPaidJustNow(true)
          setCheckout(null)
          await Promise.all([loadSubscription(), loadHistory()])
          if (onPaid) onPaid(match)
        } else if (match && (match.status === 'failed' || match.status === 'expired')) {
          stopPolling()
          clearPendingCard()
          setError(match.status === 'expired'
            ? 'That payment attempt expired before it was completed. Start a new payment below.'
            : 'The payment did not go through. Please try again.')
          setCheckout(null)
        }
      } catch (e) {
        // next tick retries
      }
    }, POLL_INTERVAL_MS)

    if (qrCountdown) {
      countdownRef.current = setInterval(() => {
        setSecondsLeft(s => {
          if (s <= 1) {
            stopPolling()
            setError('This QR code has expired. Generate a new one to try again.')
            setCheckout(null)
            return 0
          }
          return s - 1
        })
      }, 1000)
    }
  }, [API_BASE, businessSlug, loadHistory, loadSubscription, onPaid, stopPolling])

  useEffect(() => {
    (async () => {
      setLoading(true)
      await Promise.all([loadSubscription(), loadHistory()])
      setLoading(false)
    })()
    return () => stopPolling()
  }, [loadSubscription, loadHistory, stopPolling])

  // Resume webhook polling after a 3DS bank-authentication redirect returns.
  useEffect(() => {
    if (loading) return
    try {
      const raw = sessionStorage.getItem(PENDING_CARD_KEY)
      if (!raw) return
      const pending = JSON.parse(raw)
      if (!pending?.payment_intent_id || pending?.businessSlug !== businessSlug) return
      setCheckout({ ...pending, payment_method: 'card', confirming: true })
      setPaymentMethod('card')
      startPolling(pending.payment_intent_id, { qrCountdown: false })
    } catch (e) {
      clearPendingCard()
    }
  }, [loading, businessSlug, startPolling])

  const handleCheckout = async () => {
    setError('')
    setPaidJustNow(false)
    setCheckingOut(true)
    try {
      const selectedMethod = subscription?.pricing_region === 'PH' ? paymentMethod : 'card'
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_cycle: billingCycle, payment_method: selectedMethod }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.detail
        setError(typeof detail === 'string' ? detail : (detail?.message || 'Could not start payment. Please try again.'))
      } else {
        setCheckout(data)
        if (data.payment_method === 'qrph') {
          setSecondsLeft(data.expires_in_seconds || QR_TTL_SECONDS)
          startPolling(data.payment_intent_id, { qrCountdown: true })
        }
      }
    } catch (e) {
      setError('Network error — please try again.')
    }
    setCheckingOut(false)
  }

  const payCard = async () => {
    if (!checkout?.payment_intent_id || !checkout?.client_key || !checkout?.paymongo_public_key) {
      setError('Card checkout was not initialized correctly. Start a new payment.')
      return
    }

    const number = card.number.replace(/\D/g, '')
    const expMonth = Number(card.expMonth)
    let expYear = Number(card.expYear)
    if (expYear > 0 && expYear < 100) expYear += 2000
    const cvc = card.cvc.replace(/\D/g, '')
    if (number.length < 12 || number.length > 19 || expMonth < 1 || expMonth > 12 || expYear < new Date().getFullYear() || cvc.length < 3) {
      setError('Enter a valid Visa/Mastercard number, expiry date, and CVC.')
      return
    }

    setError('')
    setCardPaying(true)
    try {
      const auth = `Basic ${btoa(`${checkout.paymongo_public_key}:`)}`
      const pmRes = await fetch('https://api.paymongo.com/v1/payment_methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          data: {
            attributes: {
              type: 'card',
              details: {
                card_number: number,
                exp_month: expMonth,
                exp_year: expYear,
                cvc,
              },
              billing: {
                name: checkout.billing_name || 'Business Owner',
                email: checkout.billing_email || undefined,
                phone: checkout.billing_phone || undefined,
                address: checkout.billing_country ? { country: checkout.billing_country } : undefined,
              },
            },
          },
        }),
      })
      const pmJson = await pmRes.json()
      if (!pmRes.ok || !pmJson?.data?.id) throw new Error(paymongoError(pmJson, 'PayMongo could not tokenize this card.'))

      const returnUrl = new URL(window.location.href)
      returnUrl.searchParams.set('paymongo_return', '1')
      returnUrl.searchParams.set('payment_intent', checkout.payment_intent_id)

      const attachRes = await fetch(`https://api.paymongo.com/v1/payment_intents/${checkout.payment_intent_id}/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          data: {
            attributes: {
              payment_method: pmJson.data.id,
              client_key: checkout.client_key,
              return_url: returnUrl.toString(),
            },
          },
        }),
      })
      const attachJson = await attachRes.json()
      if (!attachRes.ok) throw new Error(paymongoError(attachJson, 'PayMongo could not process this card.'))

      const attrs = attachJson?.data?.attributes || {}
      const pending = {
        businessSlug,
        payment_intent_id: checkout.payment_intent_id,
        display_amount: checkout.display_amount,
        display_currency: checkout.display_currency,
        processor_amount: checkout.processor_amount,
        processor_currency: checkout.processor_currency,
        plan_label: checkout.plan_label,
        billing_cycle_label: checkout.billing_cycle_label,
      }
      try { sessionStorage.setItem(PENDING_CARD_KEY, JSON.stringify(pending)) } catch (e) { /* ignore */ }

      const redirectUrl = attrs?.next_action?.redirect?.url
      if (attrs.status === 'awaiting_next_action' && redirectUrl) {
        window.location.assign(redirectUrl)
        return
      }
      if (attrs.status === 'awaiting_payment_method') {
        clearPendingCard()
        throw new Error(attrs?.last_payment_error?.failed_message || 'The card was declined. Please try another card.')
      }

      // processing/succeeded: webhook remains the source of truth for extending access.
      setCheckout({ ...checkout, confirming: true })
      startPolling(checkout.payment_intent_id, { qrCountdown: false })
    } catch (e) {
      setError(e?.message || 'Card payment could not be completed. Please try again.')
    } finally {
      setCardPaying(false)
    }
  }

  const cancelCheckout = () => {
    stopPolling()
    clearPendingCard()
    setCheckout(null)
    setCard({ number: '', expMonth: '', expYear: '', cvc: '' })
  }

  const statusMeta = STATUS_META[subscription?.subscription_status || 'none']
  const paymentAvailable = subscription?.payment_capabilities?.available !== false
  const qrAvailable = subscription?.payment_capabilities?.qrph_available !== false
  const cardAvailable = subscription?.payment_capabilities?.card_available !== false
  const isPH = subscription?.pricing_region === 'PH'
  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  if (loading) {
    return <div style={styles.page}><div style={styles.card}><p style={styles.subtitle}>Loading billing details…</p></div></div>
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.title}>{title}</h1>
        <p style={styles.subtitle}>{subtitle}</p>

        <div style={{ ...styles.statusRow, background: statusMeta.bg }}>
          <div>
            <div style={{ ...styles.statusLabel, color: statusMeta.color }}>{statusMeta.label}</div>
            <div style={styles.statusDetail}>
              {subscription?.subscription_expires_at
                ? `Access until ${formatDate(subscription.subscription_expires_at)}`
                : 'No active subscription period yet'}
            </div>
          </div>
          <div style={styles.statusPlan}>{subscription?.plan ? subscription.plan.toUpperCase() : ''}</div>
        </div>

        {paidJustNow && <div style={styles.successBanner}>{successMessage}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!checkout ? (
          <>
            <div style={styles.billingToggle}>
              {Object.entries(BILLING_TERMS).map(([key, term]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setBillingCycle(key)}
                  style={{ ...styles.billingToggleBtn, ...(billingCycle === key ? styles.billingToggleBtnActive : {}) }}
                >
                  {term.label}
                  {subscription?.pricing?.[term.pricingKey] != null && (
                    <span style={styles.billingTogglePrice}>{formatMoney(subscription.pricing[term.pricingKey], subscription?.currency || 'PHP')}</span>
                  )}
                  {term.savings && <small style={styles.billingSavings}>{term.savings}</small>}
                </button>
              ))}
            </div>
            <div style={styles.billingSummary}>{BILLING_TERMS[billingCycle]?.summary || BILLING_TERMS.monthly.summary}</div>

            {isPH && (
              <div style={styles.methodRow}>
                <button type="button" disabled={!qrAvailable} onClick={() => setPaymentMethod('qrph')} style={{ ...styles.methodBtn, ...(paymentMethod === 'qrph' ? styles.methodBtnActive : {}), opacity: qrAvailable ? 1 : .45 }}>QR Ph</button>
                <button type="button" disabled={!cardAvailable} onClick={() => setPaymentMethod('card')} style={{ ...styles.methodBtn, ...(paymentMethod === 'card' ? styles.methodBtnActive : {}), opacity: cardAvailable ? 1 : .45 }}>Credit / Debit Card</button>
              </div>
            )}

            {!isPH && (
              <div style={styles.processorNotice}>
                <b>International card payment via PayMongo.</b><br />
                Your Loyalty Tree price stays fixed in {subscription?.currency}. PayMongo will charge the disclosed PHP equivalent to your Visa/Mastercard; your card issuer handles conversion and may apply its own FX fee.
              </div>
            )}

            {!paymentAvailable && <div style={styles.processorNotice}>PayMongo card processing is not configured on this server yet.</div>}
            <button type="button" onClick={handleCheckout} disabled={checkingOut || !paymentAvailable || (paymentMethod === 'card' && !cardAvailable) || (paymentMethod === 'qrph' && !qrAvailable)} style={{ ...styles.button, opacity: checkingOut || !paymentAvailable || (paymentMethod === 'card' && !cardAvailable) || (paymentMethod === 'qrph' && !qrAvailable) ? 0.6 : 1 }}>
              {checkingOut
                ? 'Preparing payment…'
                : paymentMethod === 'qrph' && isPH
                  ? `Pay ${BILLING_TERMS[billingCycle]?.payLabel || '1 Month'} via QR Ph`
                  : `Pay ${BILLING_TERMS[billingCycle]?.payLabel || '1 Month'} by Card`}
            </button>
          </>
        ) : checkout.payment_method === 'qrph' ? (
          <div style={styles.qrBox}>
            <p style={styles.qrAmount}>{formatMoney(checkout.display_amount ?? checkout.amount, checkout.display_currency || checkout.currency || subscription?.currency || 'PHP')} <span style={styles.qrPlan}>· {checkout.plan_label} · {checkout.billing_cycle_label || billingCycleLabel(billingCycle)}</span></p>
            {checkout.qr_image_url ? <img src={checkout.qr_image_url} alt="Scan to pay via QR Ph" style={styles.qrImage} /> : <div style={styles.qrFallback}>QR code unavailable — try again.</div>}
            <p style={styles.qrHint}>Scan with your banking or e-wallet app to pay.</p>
            <p style={styles.qrTimer}>Expires in {mm}:{ss}</p>
            <button type="button" onClick={cancelCheckout} style={styles.cancelButton}>Cancel</button>
          </div>
        ) : (
          <div style={styles.cardPayBox}>
            <div style={styles.cardPriceRow}>
              <div>
                <div style={styles.cardPriceLabel}>Loyalty Tree price</div>
                <div style={styles.cardPrice}>{formatMoney(checkout.display_amount, checkout.display_currency)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={styles.cardPriceLabel}>PayMongo card charge</div>
                <div style={styles.cardPrice}>{formatMoney(checkout.processor_amount, checkout.processor_currency || 'PHP')}</div>
              </div>
            </div>
            {checkout.fx_disclosure_required && (
              <div style={styles.fxNotice}>Your bank/card issuer converts the PHP charge. Its final exchange rate or foreign-transaction fee may differ from Loyalty Tree's displayed local price.</div>
            )}

            {checkout.confirming ? (
              <div style={styles.confirmingBox}>
                <div style={styles.spinner}>●</div>
                <b>Confirming payment…</b>
                <span>We’ll activate/extend the subscription after PayMongo’s verified payment webhook arrives.</span>
              </div>
            ) : (
              <>
                <label style={styles.fieldLabel}>Card number</label>
                <input
                  inputMode="numeric"
                  autoComplete="cc-number"
                  value={card.number}
                  onChange={e => setCard(v => ({ ...v, number: e.target.value }))}
                  placeholder="Visa or Mastercard"
                  style={styles.input}
                />
                <div style={styles.cardFieldsRow}>
                  <div style={{ flex: 1 }}>
                    <label style={styles.fieldLabel}>Exp. month</label>
                    <input inputMode="numeric" autoComplete="cc-exp-month" value={card.expMonth} onChange={e => setCard(v => ({ ...v, expMonth: e.target.value }))} placeholder="MM" style={styles.input} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.fieldLabel}>Exp. year</label>
                    <input inputMode="numeric" autoComplete="cc-exp-year" value={card.expYear} onChange={e => setCard(v => ({ ...v, expYear: e.target.value }))} placeholder="YYYY" style={styles.input} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={styles.fieldLabel}>CVC</label>
                    <input inputMode="numeric" autoComplete="cc-csc" type="password" value={card.cvc} onChange={e => setCard(v => ({ ...v, cvc: e.target.value }))} placeholder="123" style={styles.input} />
                  </div>
                </div>
                <button type="button" onClick={payCard} disabled={cardPaying} style={{ ...styles.button, opacity: cardPaying ? 0.6 : 1 }}>
                  {cardPaying ? 'Processing securely…' : `Pay ${formatMoney(checkout.processor_amount, checkout.processor_currency || 'PHP')}`}
                </button>
                <div style={styles.securityNote}>Card details are sent directly to PayMongo and are never stored on Loyalty Tree.</div>
              </>
            )}
            <button type="button" onClick={cancelCheckout} style={styles.cancelButton}>Cancel</button>
          </div>
        )}

        <h2 style={styles.historyTitle}>Payment history</h2>
        {history.length === 0 ? (
          <p style={styles.emptyHistory}>No payments yet.</p>
        ) : (
          <div style={styles.historyList}>
            {history.map(row => (
              <div key={row.public_id || row.id} style={styles.historyRow}>
                <div>
                  <div style={styles.historyDate}>{formatDate(row.paid_at || row.created_at)}</div>
                  <div style={styles.historyPlan}>{row.plan} · {billingCycleLabel(row.billing_cycle)} · {row.payment_method || 'paymongo'}</div>
                </div>
                <div style={styles.historyRight}>
                  <div style={styles.historyAmount}>{formatMoney(row.display_amount ?? row.amount, row.display_currency || subscription?.currency || 'PHP')}</div>
                  {row.processor_currency && row.display_currency && row.processor_currency !== row.display_currency && (
                    <div style={styles.processorAmount}>Charged {formatMoney(row.processor_amount, row.processor_currency)}</div>
                  )}
                  <div style={{ ...styles.historyStatus, ...historyStatusStyle(row.status) }}>{row.status}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function historyStatusStyle(status) {
  if (status === 'paid') return { color: '#0d9488' }
  if (status === 'pending') return { color: '#d97706' }
  return { color: '#dc2626' }
}

const styles = {
  page: { display: 'flex', justifyContent: 'center', padding: 20 },
  card: { background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 520, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.12)' },
  title: { color: '#0f172a', fontSize: 26, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.5px' },
  subtitle: { color: '#64748b', fontSize: 14.5, margin: '0 0 24px' },
  statusRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: 12, padding: '14px 18px', marginBottom: 20 },
  statusLabel: { fontSize: 15, fontWeight: 700 },
  statusDetail: { fontSize: 12.5, color: '#64748b', marginTop: 2 },
  statusPlan: { fontSize: 12, fontWeight: 700, color: '#0f766e', letterSpacing: '0.5px' },
  successBanner: { padding: '12px 16px', background: '#f0fdfa', color: '#0f766e', borderRadius: 10, fontSize: 14, marginBottom: 16 },
  error: { padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: 10, fontSize: 14, marginBottom: 16 },
  billingToggle: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 10 },
  billingToggleBtn: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '11px 10px', border: '1.5px solid #e2e8f0', borderRadius: 11, background: '#fff', color: '#64748b', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  billingToggleBtnActive: { borderColor: '#0d9488', background: '#f0fdfa', color: '#0f766e' },
  billingTogglePrice: { fontSize: 13.5, fontWeight: 800, color: '#0f172a' },
  billingSavings: { fontSize: 10.5, fontWeight: 800, color: '#047857' },
  billingSummary: { fontSize: 12.5, color: '#64748b', textAlign: 'center', margin: '0 0 12px' },
  methodRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '0 0 12px' },
  methodBtn: { padding: '10px 8px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 700, cursor: 'pointer' },
  methodBtnActive: { borderColor: '#0d9488', background: '#f0fdfa', color: '#0f766e' },
  button: { width: '100%', padding: '14px', background: 'linear-gradient(135deg, #0d9488, #0f766e)', color: 'white', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  processorNotice: { margin: '0 0 12px', padding: '11px 12px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, lineHeight: 1.5 },
  qrBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '20px 16px', border: '1.5px solid #e2e8f0', borderRadius: 14, marginBottom: 8 },
  qrAmount: { fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0 },
  qrPlan: { fontSize: 13, fontWeight: 500, color: '#64748b' },
  qrImage: { width: 220, height: 220, objectFit: 'contain', margin: '8px 0' },
  qrFallback: { width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', borderRadius: 10, color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 16 },
  qrHint: { fontSize: 13, color: '#64748b', margin: 0 },
  qrTimer: { fontSize: 13, fontWeight: 600, color: '#d97706', margin: '4px 0 8px' },
  cardPayBox: { padding: '18px', border: '1.5px solid #e2e8f0', borderRadius: 14, marginBottom: 8 },
  cardPriceRow: { display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 12 },
  cardPriceLabel: { color: '#64748b', fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' },
  cardPrice: { color: '#0f172a', fontSize: 20, fontWeight: 800, marginTop: 2 },
  fxNotice: { padding: '10px 11px', borderRadius: 9, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', fontSize: 11.5, lineHeight: 1.45, marginBottom: 14 },
  fieldLabel: { display: 'block', color: '#334155', fontSize: 12, fontWeight: 700, margin: '8px 0 5px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 9, border: '1.5px solid #cbd5e1', fontSize: 14, outline: 'none' },
  cardFieldsRow: { display: 'flex', gap: 8, marginBottom: 14 },
  securityNote: { color: '#64748b', fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 1.4 },
  confirmingBox: { minHeight: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center', color: '#334155', fontSize: 13 },
  spinner: { color: '#0d9488', fontSize: 24 },
  cancelButton: { display: 'block', margin: '12px auto 0', background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' },
  historyTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', margin: '28px 0 12px' },
  emptyHistory: { fontSize: 13.5, color: '#94a3b8' },
  historyList: { display: 'flex', flexDirection: 'column', gap: 10 },
  historyRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' },
  historyDate: { fontSize: 13.5, color: '#334155', fontWeight: 600 },
  historyPlan: { fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' },
  historyRight: { textAlign: 'right' },
  historyAmount: { fontSize: 13.5, fontWeight: 700, color: '#0f172a' },
  processorAmount: { fontSize: 10.5, color: '#94a3b8' },
  historyStatus: { fontSize: 11.5, fontWeight: 600, textTransform: 'capitalize' },
}

export default SubscriptionPayment
