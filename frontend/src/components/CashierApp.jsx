import React, { useState, useEffect } from 'react'
import { Html5QrcodeScanner } from 'html5-qrcode'

function CashierApp({ API_BASE }) {
  const [scanResult, setScanResult] = useState(null)
  const [businessSlug, setBusinessSlug] = useState('')
  const [staffPin, setStaffPin] = useState('')
  const [customerData, setCustomerData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manualId, setManualId] = useState('')

  useEffect(() => {
    if (!businessSlug || !staffPin) return

    const scanner = new Html5QrcodeScanner('reader', {
      qrbox: { width: 250, height: 250 },
      fps: 10,
    })

    scanner.render(onScanSuccess, onScanError)

    function onScanSuccess(decodedText) {
      scanner.clear()
      setScanResult(decodedText)
      fetchCustomer(decodedText)
    }

    function onScanError(err) {
      console.warn('QR scan error:', err)
    }

    return () => {
      scanner.clear().catch(() => {})
    }
  }, [businessSlug, staffPin])

  const fetchCustomer = async (customerId) => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/customer/${customerId}/profile`)
      if (res.ok) {
        const data = await res.json()
        setCustomerData(data)
      } else {
        setMessage('Customer not found')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setLoading(false)
  }

  const addStamp = async () => {
    if (!customerData || !businessSlug || !staffPin) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/stamps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          staff_pin: staffPin,
          payment_method: 'cash'
          // transaction_id is now optional - backend auto-generates it
        })
      })
      const data = await res.json()
      if (res.ok) {
        setMessage(`✅ Stamp added! ${data.customer_name} now has ${data.total_stamps_now} stamps`)
        if (data.reward_unlocked) {
          setMessage(prev => prev + ' 🎉 REWARD UNLOCKED!')
        }
        // Refresh customer data
        fetchCustomer(customerData.public_id)
      } else {
        setMessage(data.detail || 'Failed to add stamp')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setLoading(false)
  }

  const redeemReward = async () => {
    if (!customerData) return
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/reward/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerData.id })
      })
      const data = await res.json()
      if (res.ok) {
        setMessage('🎁 Reward redeemed successfully!')
        fetchCustomer(customerData.public_id)
      } else {
        setMessage(data.detail || 'No reward to redeem')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setLoading(false)
  }

  if (!businessSlug || !staffPin) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <div style={styles.logo}>🌳</div>
          <h2 style={styles.title}>LoyaltyTree Cashier</h2>
          <p style={styles.subtitle}>Scan leaves, grow rewards</p>
          <input
            style={styles.input}
            placeholder="Business Slug"
            value={businessSlug}
            onChange={e => setBusinessSlug(e.target.value)}
          />
          <input
            style={styles.input}
            placeholder="Staff PIN"
            type="password"
            value={staffPin}
            onChange={e => setStaffPin(e.target.value)}
          />
          <button
            style={styles.btn}
            onClick={() => {}}
            disabled={!businessSlug || !staffPin}
          >
            Start Scanning 🍃
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerBrand}>
          <span style={styles.headerLogo}>🌳</span>
          <span style={styles.headerTitle}>Cashier</span>
        </div>
        <button style={styles.resetBtn} onClick={() => {
          setBusinessSlug('')
          setStaffPin('')
          setScanResult(null)
          setCustomerData(null)
        }}>
          Switch Account
        </button>
      </header>

      {message && (
        <div style={styles.toast} onClick={() => setMessage('')}>
          {message}
        </div>
      )}

      {!scanResult && !showManual && (
        <div style={styles.scanSection}>
          <div style={styles.scanCard}>
            <h3 style={styles.scanTitle}>🍃 Scan Customer Leaf</h3>
            <div id="reader" style={styles.reader}></div>
            <p style={styles.scanHint}>Point camera at customer QR code</p>
            <button style={styles.manualBtn} onClick={() => setShowManual(true)}>
              Enter ID Manually ✏️
            </button>
          </div>
        </div>
      )}

      {showManual && !customerData && (
        <div style={styles.manualCard}>
          <h3>✏️ Enter Customer ID</h3>
          <input
            style={styles.input}
            placeholder="Customer Public ID"
            value={manualId}
            onChange={e => setManualId(e.target.value)}
          />
          <button style={styles.btn} onClick={() => {
            if (manualId) fetchCustomer(manualId)
          }}>
            Find Customer 🔍
          </button>
          <button style={styles.backBtn} onClick={() => setShowManual(false)}>
            Back to Scanner
          </button>
        </div>
      )}

      {customerData && (
        <div style={styles.customerCard}>
          <div style={styles.customerHeader}>
            <div style={styles.customerAvatar}>{customerData.name?.[0]?.toUpperCase()}</div>
            <div>
              <h3 style={styles.customerName}>{customerData.name}</h3>
              <p style={styles.customerMeta}>{customerData.stamp_count} rings • {customerData.reward_threshold - (customerData.stamp_count % customerData.reward_threshold)} to next fruit</p>
            </div>
          </div>

          <div style={styles.stampVisual}>
            {Array.from({length: customerData.reward_threshold}).map((_, i) => (
              <div key={i} style={{
                ...styles.stampDot,
                background: i < (customerData.stamp_count % customerData.reward_threshold) ? '#0d9488' : '#e2e8f0',
                transform: i < (customerData.stamp_count % customerData.reward_threshold) ? 'scale(1.1)' : 'scale(1)',
              }}>
                {i < (customerData.stamp_count % customerData.reward_threshold) ? '🍃' : ''}
              </div>
            ))}
          </div>

          {customerData.reward_unlocked && (
            <div style={styles.rewardBanner}>
              <span style={styles.rewardEmoji}>🍎</span>
              <span style={styles.rewardText}>Fruit Ready to Harvest!</span>
            </div>
          )}

          <div style={styles.actions}>
            <button
              style={{...styles.actionBtn, background: '#0d9488'}}
              onClick={addStamp}
              disabled={loading}
            >
              {loading ? 'Adding...' : '🍃 Add Ring'}
            </button>
            {customerData.reward_unlocked && (
              <button
                style={{...styles.actionBtn, background: '#f59e0b'}}
                onClick={redeemReward}
                disabled={loading}
              >
                {loading ? 'Redeeming...' : '🍎 Harvest Fruit'}
              </button>
            )}
          </div>

          <button style={styles.scanAgainBtn} onClick={() => {
            setScanResult(null)
            setCustomerData(null)
            setShowManual(false)
            setManualId('')
          }}>
            Scan Next Leaf 🔄
          </button>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(13,148,136,0.1)',
  },
  headerBrand: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  headerLogo: {
    fontSize: 28,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f766e',
  },
  resetBtn: {
    padding: '6px 12px',
    background: 'transparent',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 12,
    color: '#64748b',
    cursor: 'pointer',
  },
  loginCard: {
    maxWidth: 360,
    margin: '80px auto',
    padding: 40,
    background: 'white',
    borderRadius: 20,
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
    textAlign: 'center',
  },
  logo: {
    fontSize: 56,
    marginBottom: 8,
  },
  title: {
    margin: '0 0 4px 0',
    fontSize: 22,
    fontWeight: 700,
    color: '#0f766e',
  },
  subtitle: {
    margin: '0 0 24px 0',
    fontSize: 14,
    color: '#64748b',
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    marginBottom: 12,
    border: '2px solid #e2e8f0',
    borderRadius: 12,
    fontSize: 16,
    boxSizing: 'border-box',
  },
  btn: {
    width: '100%',
    padding: '14px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  toast: {
    position: 'fixed',
    top: 80,
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '14px 24px',
    background: '#0d9488',
    color: 'white',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 200,
    cursor: 'pointer',
    textAlign: 'center',
    maxWidth: '90%',
  },
  scanSection: {
    padding: 20,
    maxWidth: 500,
    margin: '0 auto',
  },
  scanCard: {
    background: 'white',
    borderRadius: 20,
    padding: 24,
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
    textAlign: 'center',
  },
  scanTitle: {
    margin: '0 0 16px 0',
    fontSize: 18,
    color: '#0f766e',
  },
  reader: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  scanHint: {
    margin: '12px 0 0 0',
    fontSize: 13,
    color: '#94a3b8',
  },
  manualBtn: {
    marginTop: 16,
    padding: '10px 20px',
    background: '#f0fdf4',
    color: '#0d9488',
    border: '1px solid #a7f3d0',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  manualCard: {
    maxWidth: 400,
    margin: '40px auto',
    padding: 28,
    background: 'white',
    borderRadius: 20,
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
  },
  backBtn: {
    width: '100%',
    padding: '12px',
    background: 'transparent',
    color: '#64748b',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 14,
    cursor: 'pointer',
    marginTop: 8,
  },
  customerCard: {
    maxWidth: 420,
    margin: '20px auto',
    padding: 24,
    background: 'white',
    borderRadius: 20,
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
  },
  customerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: '1px solid #f1f5f9',
  },
  customerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    background: 'linear-gradient(135deg, #0d9488, #14b8a6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: 24,
    fontWeight: 700,
  },
  customerName: {
    margin: '0 0 4px 0',
    fontSize: 20,
    color: '#1e293b',
  },
  customerMeta: {
    margin: 0,
    fontSize: 13,
    color: '#64748b',
  },
  stampVisual: {
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: 8,
    marginBottom: 20,
  },
  stampDot: {
    aspectRatio: '1',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    transition: 'all 0.3s ease',
  },
  rewardBanner: {
    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
    borderRadius: 12,
    padding: 16,
    textAlign: 'center',
    marginBottom: 20,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rewardEmoji: {
    fontSize: 24,
  },
  rewardText: {
    fontSize: 16,
    fontWeight: 700,
    color: '#92400e',
  },
  actions: {
    display: 'flex',
    gap: 12,
    marginBottom: 16,
  },
  actionBtn: {
    flex: 1,
    padding: '14px',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  },
  scanAgainBtn: {
    width: '100%',
    padding: '12px',
    background: '#f1f5f9',
    color: '#64748b',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

export default CashierApp
