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
  const [debugInfo, setDebugInfo] = useState('')

  useEffect(() => {
    if (!businessSlug || !staffPin) return

    const scanner = new Html5QrcodeScanner('reader', {
      qrbox: { width: 250, height: 250 },
      fps: 10,
    })

    scanner.render(onScanSuccess, onScanError)

    function onScanSuccess(decodedText) {
      scanner.clear()
      setDebugInfo('Scanned: ' + decodedText.substring(0, 30))

      // Extract customer ID from URL if needed
      let customerId = decodedText.trim()

      // If it's a URL, extract the last path segment
      if (customerId.includes('/')) {
        const parts = customerId.split('/')
        customerId = parts[parts.length - 1]
      }

      // Remove any query params
      if (customerId.includes('?')) {
        customerId = customerId.split('?')[0]
      }

      // Remove any hash
      if (customerId.includes('#')) {
        customerId = customerId.split('#')[0]
      }

      setDebugInfo(prev => prev + ' | ID: ' + customerId.substring(0, 20))
      setScanResult(customerId)
      fetchCustomer(customerId)
    }

    function onScanError(err) {
      // Silent - QR scanning has many false errors
    }

    return () => {
      scanner.clear().catch(() => {})
    }
  }, [businessSlug, staffPin])

  const fetchCustomer = async (customerId) => {
    setLoading(true)
    setMessage('')
    const url = `${API_BASE}/api/v1/customer/${customerId}/profile`
    setDebugInfo(prev => prev + ' | URL: ' + url.replace(API_BASE, ''))

    try {
      const res = await fetch(url)
      setDebugInfo(prev => prev + ' | Status: ' + res.status)

      if (res.ok) {
        const data = await res.json()
        setCustomerData(data)
        setMessage(`Found: ${data.name}`)
      } else {
        const errorData = await res.json().catch(() => ({}))
        setMessage(`Not found: ${customerId.substring(0, 12)}...`)
        setDebugInfo(prev => prev + ' | Error: ' + (errorData.detail || 'Unknown'))
      }
    } catch (err) {
      setMessage('Network error - check connection')
      setDebugInfo(prev => prev + ' | Network Error')
    }
    setLoading(false)
  }

  const addStamp = async () => {
    if (!customerData || !businessSlug || !staffPin) {
      setMessage('Missing info - scan again')
      return
    }
    setLoading(true)
    setMessage('Adding stamp...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/stamps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_public_id: customerData.public_id,
          staff_pin: staffPin,
          payment_method: 'cash'
        })
      })

      const data = await res.json()

      if (res.ok) {
        let msg = `✅ Stamp added! ${data.customer_name} now has ${data.total_stamps_now} stamps`
        if (data.reward_unlocked) {
          msg += ' 🎉 REWARD UNLOCKED!'
        }
        setMessage(msg)
        // Refresh customer data
        fetchCustomer(customerData.public_id)
      } else {
        setMessage(`❌ Failed: ${data.detail || 'Unknown error'}`)
      }
    } catch (err) {
      setMessage('❌ Network error - stamp not added')
    }
    setLoading(false)
  }

  const redeemReward = async () => {
    if (!customerData) return
    setLoading(true)
    setMessage('Redeeming...')

    try {
      const res = await fetch(`${API_BASE}/api/v1/reward/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerData.id })
      })

      const data = await res.json()

      if (res.ok) {
        setMessage('🎁 Reward redeemed!')
        fetchCustomer(customerData.public_id)
      } else {
        setMessage(`❌ ${data.detail || 'No reward to redeem'}`)
      }
    } catch (err) {
      setMessage('❌ Network error')
    }
    setLoading(false)
  }

  const resetScan = () => {
    setScanResult(null)
    setCustomerData(null)
    setShowManual(false)
    setManualId('')
    setMessage('')
    setDebugInfo('')
  }

  // Login screen
  if (!businessSlug || !staffPin) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <div style={styles.logo}>🌳</div>
          <h2 style={styles.title}>Cashier</h2>
          <p style={styles.subtitle}>Scan leaves, grow rewards</p>

          <input
            style={styles.input}
            placeholder="Business ID (from URL)"
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

          {message && <div style={styles.errorBox}>{message}</div>}

          <button
            style={styles.btn}
            onClick={() => {
              if (!businessSlug || !staffPin) {
                setMessage('Enter both Business ID and PIN')
                return
              }
              setMessage('')
            }}
            disabled={!businessSlug || !staffPin}
          >
            Start Scanning 🍃
          </button>

          <p style={styles.hint}>Business ID is the last part of your dashboard URL</p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerBrand}>
          <span style={styles.headerLogo}>🌳</span>
          <span style={styles.headerTitle}>Cashier</span>
        </div>
        <button style={styles.resetBtn} onClick={() => {
          setBusinessSlug('')
          setStaffPin('')
          resetScan()
        }}>
          Switch
        </button>
      </header>

      {/* Message Area */}
      {message && (
        <div style={message.includes('✅') || message.includes('🎉') ? styles.successToast : styles.errorToast}>
          {message}
        </div>
      )}

      {/* Debug Info (small text for troubleshooting) */}
      {debugInfo && (
        <div style={styles.debugBox}>{debugInfo}</div>
      )}

      {/* Scanner or Customer Card */}
      {!customerData ? (
        <div style={styles.scanSection}>
          <div style={styles.scanCard}>
            <h3 style={styles.scanTitle}>🍃 Scan Customer QR</h3>
            <div id="reader" style={styles.reader}></div>
            <p style={styles.scanHint}>Point camera at customer QR code</p>

            <button style={styles.manualBtn} onClick={() => setShowManual(true)}>
              ✏️ Enter ID Manually
            </button>
          </div>

          {showManual && (
            <div style={styles.manualCard}>
              <h4>Manual Entry</h4>
              <input
                style={styles.input}
                placeholder="Customer ID"
                value={manualId}
                onChange={e => setManualId(e.target.value)}
              />
              <button style={styles.btn} onClick={() => {
                if (manualId) fetchCustomer(manualId)
              }}>
                Find Customer
              </button>
              <button style={styles.backBtn} onClick={() => setShowManual(false)}>
                Back
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={styles.customerCard}>
          {/* Customer Info */}
          <div style={styles.customerHeader}>
            <div style={styles.customerAvatar}>{customerData.name?.[0]?.toUpperCase()}</div>
            <div>
              <h3 style={styles.customerName}>{customerData.name}</h3>
              <p style={styles.customerMeta}>
                {customerData.stamp_count} rings • {customerData.reward_threshold - (customerData.stamp_count % customerData.reward_threshold)} to fruit
              </p>
            </div>
          </div>

          {/* Stamp Rings */}
          <div style={styles.stampVisual}>
            {Array.from({length: customerData.reward_threshold || 8}).map((_, i) => (
              <div key={i} style={{
                ...styles.stampDot,
                background: i < (customerData.stamp_count % (customerData.reward_threshold || 8)) ? '#0d9488' : '#e2e8f0',
              }}>
                {i < (customerData.stamp_count % (customerData.reward_threshold || 8)) ? '🍃' : ''}
              </div>
            ))}
          </div>

          {/* Reward Banner */}
          {customerData.reward_unlocked && (
            <div style={styles.rewardBanner}>
              <span style={styles.rewardEmoji}>🍎</span>
              <span style={styles.rewardText}>Fruit Ready!</span>
            </div>
          )}

          {/* Actions */}
          <div style={styles.actions}>
            <button
              style={{...styles.actionBtn, background: '#0d9488'}}
              onClick={addStamp}
              disabled={loading}
            >
              {loading ? '...' : '🍃 Add Ring'}
            </button>
            {customerData.reward_unlocked && (
              <button
                style={{...styles.actionBtn, background: '#f59e0b'}}
                onClick={redeemReward}
                disabled={loading}
              >
                {loading ? '...' : '🍎 Harvest'}
              </button>
            )}
          </div>

          <button style={styles.scanAgainBtn} onClick={resetScan}>
            🔄 Scan Next
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
    padding: '12px 16px',
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
    fontSize: 24,
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
    margin: '60px auto',
    padding: 32,
    background: 'white',
    borderRadius: 20,
    boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
    textAlign: 'center',
  },
  logo: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    margin: '0 0 4px 0',
    fontSize: 22,
    fontWeight: 700,
    color: '#0f766e',
  },
  subtitle: {
    margin: '0 0 20px 0',
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
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 12,
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 12,
  },
  successToast: {
    margin: '12px 16px',
    padding: '14px 16px',
    background: '#dcfce7',
    color: '#166534',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'center',
  },
  errorToast: {
    margin: '12px 16px',
    padding: '14px 16px',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'center',
  },
  debugBox: {
    margin: '4px 16px',
    padding: '6px 10px',
    background: '#f1f5f9',
    color: '#64748b',
    borderRadius: 6,
    fontSize: 10,
    fontFamily: 'monospace',
    wordBreak: 'break-all',
  },
  scanSection: {
    padding: 16,
    maxWidth: 500,
    margin: '0 auto',
  },
  scanCard: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
    textAlign: 'center',
  },
  scanTitle: {
    margin: '0 0 12px 0',
    fontSize: 18,
    color: '#0f766e',
  },
  reader: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  scanHint: {
    margin: '8px 0 0 0',
    fontSize: 13,
    color: '#94a3b8',
  },
  manualBtn: {
    marginTop: 12,
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
    background: 'white',
    borderRadius: 16,
    padding: 20,
    marginTop: 12,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
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
    margin: '12px auto',
    padding: 20,
    background: 'white',
    borderRadius: 16,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  customerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
    paddingBottom: 12,
    borderBottom: '1px solid #f1f5f9',
  },
  customerAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    background: 'linear-gradient(135deg, #0d9488, #14b8a6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: 20,
    fontWeight: 700,
  },
  customerName: {
    margin: '0 0 2px 0',
    fontSize: 18,
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
    gap: 6,
    marginBottom: 16,
  },
  stampDot: {
    aspectRatio: '1',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
  },
  rewardBanner: {
    background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
    borderRadius: 10,
    padding: 12,
    textAlign: 'center',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rewardEmoji: {
    fontSize: 20,
  },
  rewardText: {
    fontSize: 15,
    fontWeight: 700,
    color: '#92400e',
  },
  actions: {
    display: 'flex',
    gap: 10,
    marginBottom: 12,
  },
  actionBtn: {
    flex: 1,
    padding: '14px',
    color: 'white',
    border: 'none',
    borderRadius: 10,
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
