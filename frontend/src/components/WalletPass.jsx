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
    if (passData?.save_url && passData.save_url.includes('pay.google.com')) {
      window.open(passData.save_url, '_blank')
    } else {
      alert('Save this page to your home screen for quick access!')
    }
  }

  // Apple Wallet has no JS API to trigger from - it's a direct link to a
  // signed .pkpass file. Safari on iOS/macOS recognizes the file's content
  // type and shows the native "Add to Apple Wallet" sheet; other browsers
  // just download the file. So this is a plain <a href>, not a click handler.
  const appleWalletUrl = passData?.apple_pass_url || `${API_BASE}/api/v1/customer/${customerId}/apple-wallet-pass`

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
      navigator.clipboard.writeText(window.location.href)
      alert('Card link copied to clipboard!')
    }
  }

  if (loading) return <div style={styles.container}><p>Loading your loyalty card...</p></div>
  if (error) return <div style={styles.container}><p>{error}</p></div>

  const { pass_data } = passData
  const isPoints = pass_data.card_type === 'points'
  const progress = isPoints ? 0 : (pass_data.stamps / pass_data.goal) * 100

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

        {isPoints ? (
          <div style={styles.pointsSection}>
            <div style={styles.pointsBalance}>{pass_data.points_balance ?? 0}</div>
            <p style={styles.pointsLabel}>points</p>
            {pass_data.points_prizes?.length > 0 && (
              <div style={styles.prizeList}>
                {pass_data.points_prizes.map((prize, i) => {
                  const affordable = (pass_data.points_balance ?? 0) >= prize.points_cost
                  return (
                    <div key={prize.id || i} style={{ ...styles.prizeRow, opacity: affordable ? 1 : 0.5 }}>
                      <span>{prize.name}</span>
                      <span style={styles.prizeCost}>{prize.points_cost} pts</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <>
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
          </>
        )}

        {!isPoints && pass_data.reward_unlocked && (
          <div style={styles.rewardBanner}>
            <span style={styles.rewardIcon}>🎉</span>
            <span>Reward Unlocked!</span>
          </div>
        )}

        <div style={styles.qrSection}>
          <p style={styles.qrLabel}>Show this QR code to cashier</p>
          <div style={styles.qrWrapper}>
            <img 
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pass_data.qr_code)}`}
              alt="QR Code"
              style={styles.qrImage}
              onError={(e) => {
                e.target.style.display = 'none'
                e.target.nextSibling.style.display = 'flex'
              }}
            />
            <div style={{...styles.qrFallback, display: 'none'}}>
              <p style={{margin: 0, fontSize: 11}}>QR: {pass_data.qr_code}</p>
            </div>
          </div>
        </div>
      </div>

      <div style={styles.actions}>
        <button onClick={addToGoogleWallet} style={styles.googleBtn}>
          <span style={styles.googleIcon}>G</span>
          Add to Google Wallet
        </button>
        <a href={appleWalletUrl} style={{ ...styles.googleBtn, ...styles.appleBtn, marginTop: 10 }}>
          <span style={styles.googleIcon}></span>
          Add to Apple Wallet
        </a>
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
  pointsSection: {
    textAlign: 'center',
    marginBottom: 20,
  },
  pointsBalance: {
    fontSize: 44,
    fontWeight: 800,
    lineHeight: 1,
  },
  pointsLabel: {
    fontSize: 13,
    opacity: 0.85,
    marginTop: 4,
  },
  prizeList: {
    marginTop: 16,
    borderTop: '1px solid rgba(255,255,255,0.25)',
    paddingTop: 10,
    textAlign: 'left',
  },
  prizeRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
    fontSize: 13,
  },
  prizeCost: {
    fontSize: 12,
    fontWeight: 700,
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
  qrWrapper: {
    background: 'white',
    borderRadius: 8,
    padding: 10,
    display: 'inline-block',
  },
  qrImage: {
    width: 200,
    height: 200,
    display: 'block',
  },
  qrFallback: {
    width: 200,
    height: 200,
    background: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: '#333',
    wordBreak: 'break-all',
    padding: 10,
    boxSizing: 'border-box',
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
  appleBtn: {
    background: '#000000',
    textDecoration: 'none',
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
