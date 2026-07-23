import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'

function WalletPass({ API_BASE }) {
  const { customerId } = useParams()
  const [passData, setPassData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/customer/${customerId}/wallet-pass`)
      .then(r => r.json())
      .then(data => {
        if (data.pass_data) {
          setPassData(data)
        } else {
          setError('Pass not found')
        }
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load pass')
        setLoading(false)
      })
  }, [customerId])

  const addToGoogleWallet = () => {
    if (passData?.add_to_wallet_url && passData.add_to_wallet_url.includes('pay.google.com')) {
      window.open(passData.add_to_wallet_url, '_blank')
    } else {
      alert('Save this page to your home screen for quick access!')
    }
  }

  const shareCard = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${passData?.pass_data?.business_name} Loyalty Card`,
          text: `My loyalty card for ${passData?.pass_data?.business_name}`,
          url: window.location.href
        })
      } catch (err) {
        // User cancelled
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(window.location.href)
      alert('Card link copied to clipboard!')
    }
  }

  if (loading) return <div style={styles.container}><p>Loading your loyalty card...</p></div>
  if (error) return <div style={styles.container}><p>{error}</p></div>

  const { pass_data } = passData
  const progress = (pass_data.stamps / pass_data.goal) * 100

  return (
    <div style={styles.container}>
      <div style={{ ...styles.card, background: pass_data.primary_color || '#0d9488' }}>
        <div style={styles.cardHeader}>
          <div style={styles.logo}>🌳</div>
          <div>
            <h2 style={styles.businessName}>{pass_data.business_name}</h2>
            <p style={styles.memberId}>Member: {pass_data.customer_id?.slice(0, 8)}</p>
          </div>
        </div>

        <div style={styles.memberSection}>
          <div style={styles.avatar}>{pass_data.customer_name?.[0]?.toUpperCase() || '?'}</div>
          <div>
            <h3 style={styles.customerName}>{pass_data.customer_name}</h3>
            <p style={styles.tier}>Loyalty Member</p>
          </div>
        </div>

        <div style={styles.progressSection}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }}></div>
          </div>
          <p style={styles.progressText}>{pass_data.stamps} / {pass_data.goal} stamps</p>
        </div>

        <div style={styles.stampGrid}>
          {Array.from({ length: pass_data.goal }).map((_, i) => (
            <div key={i} style={{
              ...styles.stampSlot,
              background: i < pass_data.stamps ? '#fbbf24' : 'rgba(255,255,255,0.2)',
              borderColor: i < pass_data.stamps ? '#f59e0b' : 'rgba(255,255,255,0.3)'
            }}>
              {i < pass_data.stamps ? '★' : ''}
            </div>
          ))}
        </div>

        {pass_data.reward_unlocked && (
          <div style={styles.rewardBanner}>
            <span style={styles.rewardIcon}>🎉</span>
            <span>Reward Unlocked!</span>
          </div>
        )}

        <div style={styles.qrSection}>
          <p style={styles.qrLabel}>Show this QR code to cashier</p>
          <div style={styles.qrCode}>{pass_data.qr_code}</div>
        </div>
      </div>

      <div style={styles.actions}>
        <button onClick={addToGoogleWallet} style={styles.googleBtn}>
          <span style={styles.googleIcon}>G</span>
          Add to Google Wallet
        </button>
        <button onClick={shareCard} style={{ ...styles.googleBtn, background: '#0d9488', marginTop: 10 }}>
          <span style={styles.googleIcon}>🔗</span>
          Share Card
        </button>
        <p style={styles.note}>
          💡 <strong>Tip:</strong> Screenshot this card or save this page to your home screen for quick access!
        </p>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f5f5f5',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 30,
    color: 'white',
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
    marginBottom: 20,
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 25,
    borderBottom: '1px solid rgba(255,255,255,0.2)',
    paddingBottom: 15,
  },
  logo: {
    fontSize: 36,
    marginRight: 12,
  },
  businessName: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
  },
  memberId: {
    margin: 0,
    fontSize: 12,
    opacity: 0.8,
  },
  memberSection: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 25,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    background: 'rgba(255,255,255,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 'bold',
    marginRight: 15,
  },
  customerName: {
    margin: 0,
    fontSize: 22,
    fontWeight: 600,
  },
  tier: {
    margin: 0,
    fontSize: 14,
    opacity: 0.8,
  },
  progressSection: {
    marginBottom: 20,
  },
  progressBar: {
    height: 12,
    background: 'rgba(255,255,255,0.2)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#fbbf24',
    borderRadius: 6,
    transition: 'width 0.5s ease',
  },
  progressText: {
    textAlign: 'center',
    marginTop: 8,
    fontSize: 14,
    fontWeight: 600,
  },
  stampGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 10,
    marginBottom: 20,
  },
  stampSlot: {
    aspectRatio: '1',
    borderRadius: 10,
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    fontWeight: 'bold',
    color: '#92400e',
  },
  rewardBanner: {
    background: '#fbbf24',
    color: '#92400e',
    padding: 15,
    borderRadius: 12,
    textAlign: 'center',
    fontWeight: 700,
    fontSize: 16,
    marginBottom: 20,
  },
  rewardIcon: {
    marginRight: 8,
  },
  qrSection: {
    background: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: 20,
    textAlign: 'center',
  },
  qrLabel: {
    margin: 0,
    marginBottom: 10,
    fontSize: 14,
    opacity: 0.9,
  },
  qrCode: {
    fontFamily: 'monospace',
    fontSize: 12,
    wordBreak: 'break-all',
    background: 'white',
    color: '#333',
    padding: 10,
    borderRadius: 8,
  },
  actions: {
    width: '100%',
    maxWidth: 400,
  },
  googleBtn: {
    width: '100%',
    padding: 16,
    background: '#4285f4',
    color: 'white',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleIcon: {
    fontSize: 20,
  },
  note: {
    marginTop: 15,
    padding: 12,
    background: '#e0f2fe',
    borderRadius: 8,
    fontSize: 13,
    color: '#0369a1',
    textAlign: 'center',
  },
}

export default WalletPass
