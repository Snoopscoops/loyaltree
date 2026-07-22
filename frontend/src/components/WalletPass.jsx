import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

function WalletPass({ API_BASE }) {
  const { customerId } = useParams()
  const [passData, setPassData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchPassData()
  }, [])

  const fetchPassData = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/customer/${customerId}/wallet-pass`)
      if (res.ok) {
        const data = await res.json()
        setPassData({
          ...data.pass_data,
          add_to_wallet_url: data.add_to_wallet_url,
          qr_code: data.qr_code
        })
      } else {
        setError('Could not load pass')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  const addToGoogleWallet = () => {
    // Check if we have a real Google Wallet URL
    if (passData?.add_to_wallet_url && passData.add_to_wallet_url.includes('pay.google.com')) {
      window.open(passData.add_to_wallet_url, '_blank')
    } else {
      // Fallback: show instructions to save the page
      alert('Google Wallet integration is being set up. For now, please:

1. Screenshot this card
2. Or bookmark this page
3. Or add to your home screen

Your loyalty card works the same way!')
    }
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={{ textAlign: 'center', padding: 100, color: '#64748b' }}>Loading your pass...</div>
      </div>
    )
  }

  if (error || !passData) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>😕</div>
          <h1 style={styles.title}>Pass Not Found</h1>
          <p style={styles.subtitle}>{error || 'Could not find your loyalty pass'}</p>
        </div>
      </div>
    )
  }

  const { business_name, customer_name, stamps, goal, reward_unlocked, primary_color } = passData
  const progress = Math.min((stamps / goal) * 100, 100)

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Pass Header */}
        <div style={{...styles.passHeader, background: primary_color}}>
          <div style={styles.passLogo}>🌳</div>
          <div style={styles.passBusiness}>{business_name}</div>
          <div style={styles.passProgram}>Loyalty Card</div>
        </div>

        {/* Pass Body */}
        <div style={styles.passBody}>
          <div style={styles.memberSection}>
            <div style={styles.memberAvatar}>{customer_name?.[0] || '?'}</div>
            <div>
              <div style={styles.memberName}>{customer_name}</div>
              <div style={styles.memberId}>Member ID: {customerId?.slice(0, 8)}...</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div style={styles.progressSection}>
            <div style={styles.progressHeader}>
              <span style={styles.progressLabel}>Stamp Progress</span>
              <span style={styles.progressValue}>{stamps}/{goal}</span>
            </div>
            <div style={styles.progressBar}>
              <div style={{...styles.progressFill, width: `${progress}%`, background: primary_color}} />
            </div>
            <div style={styles.stampGrid}>
              {Array.from({length: goal}).map((_, i) => (
                <div key={i} style={{
                  ...styles.stampSlot,
                  background: i < stamps ? primary_color : '#f1f5f9',
                }}>
                  {i < stamps && <span style={styles.stampIcon}>⭐</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Reward Status */}
          {reward_unlocked ? (
            <div style={styles.rewardBanner}>
              <span style={styles.rewardEmoji}>🎉</span>
              <div>
                <div style={styles.rewardTitle}>Reward Unlocked!</div>
                <div style={styles.rewardSub}>Show this to your cashier to redeem</div>
              </div>
            </div>
          ) : (
            <div style={styles.rewardPending}>
              <span style={styles.pendingEmoji}>🎯</span>
              <div style={styles.pendingText}>{goal - stamps} more stamps to unlock your reward!</div>
            </div>
          )}

          {/* QR Code */}
          <div style={styles.qrSection}>
            <div style={styles.qrBox}>
              <div style={styles.qrPlaceholder}>
                <div style={styles.qrPattern}>
                  {Array.from({length: 64}).map((_, i) => (
                    <div key={i} style={{
                      width: 8,
                      height: 8,
                      background: Math.random() > 0.5 ? '#0f172a' : 'white',
                    }} />
                  ))}
                </div>
              </div>
              <p style={styles.qrLabel}>Show this at checkout</p>
            </div>
          </div>
        </div>
      </div>

      {/* Add to Wallet Buttons */}
      <div style={styles.actions}>
        <button onClick={addToGoogleWallet} style={styles.googleBtn}>
          <span style={styles.googleIcon}>G</span>
          Add to Google Wallet
        </button>
        <button style={styles.appleBtn}>
          <span style={styles.appleIcon}>🍎</span>
          Add to Apple Wallet
          <span style={styles.comingSoon}>Coming Soon</span>
        </button>
      </div>

      <p style={styles.footer}>
        Your loyalty card updates automatically.<br/>
        Show the QR code to earn stamps on every visit.
      </p>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0f766e 0%, #134e4a 50%, #0f172a 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    background: 'white',
    borderRadius: 24,
    width: '100%',
    maxWidth: 380,
    overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)',
  },
  passHeader: {
    padding: '32px 24px 24px',
    textAlign: 'center',
    color: 'white',
  },
  passLogo: {
    fontSize: 40,
    marginBottom: 8,
  },
  passBusiness: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 4,
  },
  passProgram: {
    fontSize: 14,
    opacity: 0.9,
  },
  passBody: {
    padding: 24,
  },
  memberSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
    paddingBottom: 20,
    borderBottom: '1px solid #f1f5f9',
  },
  memberAvatar: {
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    fontWeight: 700,
  },
  memberName: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
  },
  memberId: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  progressSection: {
    marginBottom: 20,
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: '#475569',
  },
  progressValue: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
  },
  progressBar: {
    height: 8,
    background: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 14,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.5s ease',
  },
  stampGrid: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  stampSlot: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.3s',
  },
  stampIcon: {
    fontSize: 14,
  },
  rewardBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: 'linear-gradient(135deg, #d1fae5, #a7f3d0)',
    padding: '16px 20px',
    borderRadius: 14,
    marginBottom: 20,
  },
  rewardEmoji: {
    fontSize: 28,
  },
  rewardTitle: {
    fontSize: 15,
    fontWeight: 700,
    color: '#065f46',
  },
  rewardSub: {
    fontSize: 12,
    color: '#059669',
    marginTop: 2,
  },
  rewardPending: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#f8fafc',
    padding: '14px 18px',
    borderRadius: 14,
    marginBottom: 20,
  },
  pendingEmoji: {
    fontSize: 22,
  },
  pendingText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: 500,
  },
  qrSection: {
    display: 'flex',
    justifyContent: 'center',
  },
  qrBox: {
    textAlign: 'center',
  },
  qrPlaceholder: {
    width: 160,
    height: 160,
    background: '#0f172a',
    borderRadius: 16,
    padding: 12,
    margin: '0 auto 10px',
  },
  qrPattern: {
    width: '100%',
    height: '100%',
    display: 'grid',
    gridTemplateColumns: 'repeat(8, 1fr)',
    gap: 2,
  },
  qrLabel: {
    fontSize: 12,
    color: '#94a3b8',
  },
  actions: {
    marginTop: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    maxWidth: 380,
  },
  googleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '14px 24px',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(26, 115, 232, 0.3)',
  },
  googleIcon: {
    width: 24,
    height: 24,
    background: 'white',
    color: '#1a73e8',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: 14,
  },
  appleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '14px 24px',
    background: '#0f172a',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'not-allowed',
    opacity: 0.6,
    position: 'relative',
  },
  appleIcon: {
    fontSize: 18,
  },
  comingSoon: {
    position: 'absolute',
    top: -8,
    right: -8,
    background: '#f59e0b',
    color: 'white',
    fontSize: 9,
    fontWeight: 700,
    padding: '3px 8px',
    borderRadius: 10,
    textTransform: 'uppercase',
  },
  footer: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 24,
    lineHeight: 1.6,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 8px',
  },
  subtitle: {
    color: '#64748b',
    fontSize: 15,
  },
}

export default WalletPass
