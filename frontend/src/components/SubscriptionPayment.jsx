import React, { useState, useEffect, useRef, useCallback } from 'react'

// Drop this into the owner dashboard, e.g. as a "Billing" tab:
//   <SubscriptionPayment API_BASE={API_BASE} businessSlug={business.public_id} />
//
// Talks to the endpoints added in main.py:
//   GET  /api/v1/business/{public_id}/subscription            - current status
//   POST /api/v1/business/{public_id}/subscription/checkout   - new QR Ph payment
//   GET  /api/v1/business/{public_id}/subscription/payments   - billing history
//
// The QR itself is confirmed by PayMongo calling /api/v1/webhooks/paymongo on
// your server, not by this component - polling here just watches the
// database for that webhook to land.
//
// Reusable for two contexts:
//   - OwnerDashboard billing tab: <SubscriptionPayment API_BASE={..} businessSlug={..} />
//   - Post-signup activation portal: pass title/subtitle/successMessage to
//     match that context, and onPaid={fn} to react the moment the webhook
//     activates the account (see Signup.jsx).

const QR_TTL_SECONDS = 600 // PayMongo QR Ph codes expire ~10 minutes after generation
const POLL_INTERVAL_MS = 4000

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatMoney(n) {
  if (n == null) return '—'
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_META = {
  active: { label: 'Active', color: '#0d9488', bg: '#f0fdfa' },
  expiring_soon: { label: 'Expiring soon', color: '#d97706', bg: '#fffbeb' },
  expired: { label: 'Expired', color: '#dc2626', bg: '#fef2f2' },
  none: { label: 'No payment yet', color: '#64748b', bg: '#f1f5f9' },
}

function SubscriptionPayment({
  API_BASE,
  businessSlug,
  title = 'Billing',
  subtitle = 'Keep your subscription active with a QR Ph payment.',
  successMessage = '🎉 Payment received — your subscription has been extended.',
  onPaid,
}) {
  const [subscription, setSubscription] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
  const [error, setError] = useState('')
  const [checkout, setCheckout] = useState(null) // { qr_image_url, amount, payment_intent_id, ... }
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [paidJustNow, setPaidJustNow] = useState(false)
  const pollRef = useRef(null)
  const countdownRef = useRef(null)

  const loadSubscription = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription`)
      if (res.ok) setSubscription(await res.json())
    } catch (e) {
      // silent - the page still works, it just won't show current status
    }
  }, [API_BASE, businessSlug])

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription/payments`)
      if (res.ok) setHistory(await res.json())
    } catch (e) {
      // silent
    }
  }, [API_BASE, businessSlug])

  useEffect(() => {
    (async () => {
      setLoading(true)
      await Promise.all([loadSubscription(), loadHistory()])
      setLoading(false)
    })()
    return () => {
      clearInterval(pollRef.current)
      clearInterval(countdownRef.current)
    }
  }, [loadSubscription, loadHistory])

  const stopPolling = () => {
    clearInterval(pollRef.current)
    clearInterval(countdownRef.current)
  }

  const startPolling = (intentId) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription/payments`)
        if (!res.ok) return
        const rows = await res.json()
        const match = rows.find(r => r.paymongo_payment_intent_id === intentId)
        if (match && match.status === 'paid') {
          stopPolling()
          setPaidJustNow(true)
          setCheckout(null)
          await Promise.all([loadSubscription(), loadHistory()])
          if (onPaid) onPaid(match)
        } else if (match && (match.status === 'failed' || match.status === 'expired')) {
          stopPolling()
          setError(match.status === 'expired'
            ? 'That QR code expired before payment was completed. Generate a new one below.'
            : 'The payment did not go through. Please try again.')
          setCheckout(null)
        }
      } catch (e) {
        // silent - next tick will retry
      }
    }, POLL_INTERVAL_MS)

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

  const handleCheckout = async () => {
    setError('')
    setPaidJustNow(false)
    setCheckingOut(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/subscription/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'Could not start payment. Please try again.')
      } else {
        setCheckout(data)
        setSecondsLeft(data.expires_in_seconds || QR_TTL_SECONDS)
        startPolling(data.payment_intent_id)
      }
    } catch (e) {
      setError('Network error - please try again.')
    }
    setCheckingOut(false)
  }

  const statusMeta = STATUS_META[subscription?.subscription_status || 'none']
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
          <div style={styles.statusPlan}>
            {subscription?.plan ? subscription.plan.toUpperCase() : ''}
          </div>
        </div>

        {paidJustNow && (
          <div style={styles.successBanner}>
            {successMessage}
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        {!checkout ? (
          <button
            type="button"
            onClick={handleCheckout}
            disabled={checkingOut}
            style={styles.button}
          >
            {checkingOut ? 'Preparing QR code…' : 'Pay via QR Ph'}
          </button>
        ) : (
          <div style={styles.qrBox}>
            <p style={styles.qrAmount}>{formatMoney(checkout.amount)} <span style={styles.qrPlan}>· {checkout.plan_label}</span></p>
            {checkout.qr_image_url ? (
              <img src={checkout.qr_image_url} alt="Scan to pay via QR Ph" style={styles.qrImage} />
            ) : (
              <div style={styles.qrFallback}>QR code unavailable — try again.</div>
            )}
            <p style={styles.qrHint}>Scan with your banking or e-wallet app to pay.</p>
            <p style={styles.qrTimer}>Expires in {mm}:{ss}</p>
            <button
              type="button"
              onClick={() => { stopPolling(); setCheckout(null) }}
              style={styles.cancelButton}
            >
              Cancel
            </button>
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
                  <div style={styles.historyPlan}>{row.plan}</div>
                </div>
                <div style={styles.historyRight}>
                  <div style={styles.historyAmount}>{formatMoney(row.amount)}</div>
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
  page: {
    display: 'flex',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    background: 'white',
    borderRadius: 20,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.12)',
  },
  title: {
    color: '#0f172a',
    fontSize: 26,
    fontWeight: 700,
    margin: '0 0 6px',
    letterSpacing: '-0.5px',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 14.5,
    margin: '0 0 24px',
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 12,
    padding: '14px 18px',
    marginBottom: 20,
  },
  statusLabel: {
    fontSize: 15,
    fontWeight: 700,
  },
  statusDetail: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 2,
  },
  statusPlan: {
    fontSize: 12,
    fontWeight: 700,
    color: '#0f766e',
    letterSpacing: '0.5px',
  },
  successBanner: {
    padding: '12px 16px',
    background: '#f0fdfa',
    color: '#0f766e',
    borderRadius: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  error: {
    padding: '12px 16px',
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  button: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  qrBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    padding: '20px 16px',
    border: '1.5px solid #e2e8f0',
    borderRadius: 14,
    marginBottom: 8,
  },
  qrAmount: {
    fontSize: 20,
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
  },
  qrPlan: {
    fontSize: 13,
    fontWeight: 500,
    color: '#64748b',
  },
  qrImage: {
    width: 220,
    height: 220,
    objectFit: 'contain',
    margin: '8px 0',
  },
  qrFallback: {
    width: 220,
    height: 220,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f1f5f9',
    borderRadius: 10,
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    padding: 16,
  },
  qrHint: {
    fontSize: 13,
    color: '#64748b',
    margin: 0,
  },
  qrTimer: {
    fontSize: 13,
    fontWeight: 600,
    color: '#d97706',
    margin: '4px 0 8px',
  },
  cancelButton: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
    margin: '28px 0 12px',
  },
  emptyHistory: {
    fontSize: 13.5,
    color: '#94a3b8',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  historyRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  historyDate: {
    fontSize: 13.5,
    color: '#334155',
    fontWeight: 600,
  },
  historyPlan: {
    fontSize: 12,
    color: '#94a3b8',
    textTransform: 'capitalize',
  },
  historyRight: {
    textAlign: 'right',
  },
  historyAmount: {
    fontSize: 13.5,
    fontWeight: 700,
    color: '#0f172a',
  },
  historyStatus: {
    fontSize: 11.5,
    fontWeight: 600,
    textTransform: 'capitalize',
  },
}

export default SubscriptionPayment
