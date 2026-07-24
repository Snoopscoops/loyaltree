import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

function OwnerDashboard({ API_BASE, user, onLogout }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('tree')
  const [business, setBusiness] = useState(null)
  const [customers, setCustomers] = useState([])
  const [staff, setStaff] = useState([])
  const [stats, setStats] = useState(null)
  const [program, setProgram] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showCardModal, setShowCardModal] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [qrImageUrl, setQrImageUrl] = useState(null)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', phone: '', role: 'cashier' })
  const [configForm, setConfigForm] = useState({})
  const [message, setMessage] = useState('')

  // Frontend URL for customer-facing pages
  const FRONTEND_URL = 'https://loyaltree-app.onrender.com'

  useEffect(() => {
    if (!user?.business_slug) return
    loadData()
  }, [user])

  const loadData = async () => {
    try {
      const [bizRes, custRes, staffRes, statsRes, progRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/stats`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`),
      ])

      const bizData = await bizRes.json().catch(() => null)
      const custData = await custRes.json().catch(() => [])
      const staffData = await staffRes.json().catch(() => [])
      const statsData = await statsRes.json().catch(() => null)
      const progData = await progRes.json().catch(() => null)

      setBusiness(bizData)
      setCustomers(custData)
      setStaff(staffData)
      setStats(statsData)
      setProgram(progData)
      if (progData) setConfigForm(progData)
    } catch (err) {
      console.error('Load error:', err)
    }
    setLoading(false)
  }

  const inviteStaff = async (e) => {
    e.preventDefault()
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inviteForm)
      })
      if (res.ok) {
        setMessage('Staff invited! PIN: 0000')
        setShowInviteModal(false)
        setInviteForm({ name: '', email: '', phone: '', role: 'cashier' })
        loadData()
      } else {
        const data = await res.json()
        setMessage(data.detail || 'Invite failed')
      }
    } catch (err) {
      setMessage('Network error')
    }
  }

  const saveConfig = async (e) => {
    e.preventDefault()
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForm)
      })
      if (res.ok) {
        setMessage('Program updated!')
        setShowConfigModal(false)
        loadData()
      } else {
        const data = await res.json()
        setMessage(data.detail || 'Update failed')
      }
    } catch (err) {
      setMessage('Network error')
    }
  }

  const goLive = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/go-live`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        setMessage(data.message)
        loadData()
      } else {
        setMessage(data.detail || 'Go live failed')
      }
    } catch (err) {
      setMessage('Network error')
    }
  }

  const fetchQRImage = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/qr-code`)
      const data = await res.json()
      if (data.qr_code) {
        const svgBase64 = data.qr_code.replace('data:image/svg+xml;base64,', '')
        const svgString = atob(svgBase64)
        const blob = new Blob([svgString], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        setQrImageUrl(url)
        setShowQRModal(true)
      }
    } catch (err) {
      setMessage('Could not load QR code')
    }
  }

  const shareQR = async () => {
    const joinUrl = `${FRONTEND_URL}/join/${user.business_slug}`
    const shareText = `Join ${user?.business_name || 'our'} loyalty program! Scan the QR code or visit: ${joinUrl}`

    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/qr-code`)
      const data = await res.json()

      if (data.qr_code && navigator.canShare && navigator.canShare({ files: [] })) {
        const svgBase64 = data.qr_code.replace('data:image/svg+xml;base64,', '')
        const byteCharacters = atob(svgBase64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const file = new File([byteArray], 'loyaltree-qr.svg', { type: 'image/svg+xml' })

        await navigator.share({
          title: `Join ${user?.business_name || 'Us'} Rewards`,
          text: shareText,
          url: joinUrl,
          files: [file]
        })
      } else if (navigator.share) {
        await navigator.share({
          title: `Join ${user?.business_name || 'Us'} Rewards`,
          text: shareText,
          url: joinUrl,
        })
      } else {
        await navigator.clipboard.writeText(`${shareText} ${joinUrl}`)
        setMessage('Link copied to clipboard!')
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          const joinUrl = `${FRONTEND_URL}/join/${user.business_slug}`
          await navigator.share({
            title: `Join ${user?.business_name || 'Us'} Rewards`,
            text: `Get stamps and earn rewards!`,
            url: joinUrl,
          })
        } catch (e2) {
          await navigator.clipboard.writeText(`${FRONTEND_URL}/join/${user.business_slug}`)
          setMessage('Join link copied!')
        }
      }
    }
  }

  const downloadQR = () => {
    if (!qrImageUrl) return
    const link = document.createElement('a')
    link.href = qrImageUrl
    link.download = `${user?.business_name || 'business'}-qr-code.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const viewCustomerCard = (customer) => {
    setSelectedCustomer(customer)
    setShowCardModal(true)
  }

  const addToGoogleWallet = (customer) => {
    const walletUrl = `${API_BASE}/api/v1/customer/${customer.public_id}/wallet-pass`
    fetch(walletUrl)
      .then(res => res.json())
      .then(data => {
        if (data.add_to_wallet_url) {
          window.open(data.add_to_wallet_url, '_blank')
        } else {
          setMessage('Google Wallet link not available yet')
        }
      })
      .catch(() => setMessage('Could not get wallet link'))
  }

  const addToAppleWallet = (customer) => {
    setMessage('Apple Wallet coming soon!')
  }

  if (loading) return (
    <div style={styles.container}>
      <div style={styles.loadingTree}>
        <div style={styles.treeIcon}>🌳</div>
        <p>Growing your digital forest...</p>
      </div>
    </div>
  )

  const confirmedStamps = customers.reduce((sum, c) => sum + (c.stamp_count || 0), 0)
  const unlockedRewards = customers.filter(c => c.reward_unlocked).length
  const growthStage = customers.length < 10 ? 'seedling' : customers.length < 50 ? 'sapling' : customers.length < 200 ? 'growing' : 'mature'

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={styles.logo}>🌳</span>
          <div>
            <h1 style={styles.brandName}>LoyaltyTree</h1>
            <p style={styles.brandTagline}>Where businesses grow with customers</p>
          </div>
        </div>
        <div style={styles.headerActions}>
          <span style={styles.planBadge}>{user?.business_name}</span>
          <button onClick={() => navigate('/analytics')} style={styles.navBtn}>📊 Analytics</button>
          <button onClick={onLogout} style={styles.logoutBtn}>Logout</button>
        </div>
      </header>

      {message && (
        <div style={styles.toast} onClick={() => setMessage('')}>
          {message}
        </div>
      )}

      {/* Tree Visualization */}
      <div style={styles.treeSection}>
        <div style={styles.treeVisual}>
          <div style={{...styles.treeCanopy, transform: `scale(${Math.min(1 + customers.length * 0.01, 1.5)})`}}>
            {Array.from({length: Math.min(customers.length, 20)}).map((_, i) => (
              <div key={i} style={{
                ...styles.leaf,
                left: `${30 + Math.random() * 40}%`,
                top: `${20 + Math.random() * 30}%`,
                animationDelay: `${i * 0.1}s`,
              }}>🍃</div>
            ))}
            <div style={styles.treeTop}>🌳</div>
          </div>
          <div style={styles.treeTrunk}>
            <div style={styles.roots}>
              <div style={styles.root}>🏪 {user?.business_name}</div>
            </div>
            <div style={styles.statsRing}>
              <div style={styles.statOrb}>
                <span style={styles.orbNumber}>{customers.length}</span>
                <span style={styles.orbLabel}>Leaves</span>
              </div>
              <div style={styles.statOrb}>
                <span style={styles.orbNumber}>{confirmedStamps}</span>
                <span style={styles.orbLabel}>Rings</span>
              </div>
              <div style={styles.statOrb}>
                <span style={styles.orbNumber}>{unlockedRewards}</span>
                <span style={styles.orbLabel}>Fruits</span>
              </div>
            </div>
          </div>
        </div>
        <div style={styles.growthBadge}>
          <span style={styles.growthIcon}>
            {growthStage === 'seedling' ? '🌱' : growthStage === 'sapling' ? '🌿' : growthStage === 'growing' ? '🌳' : '🌲'}
          </span>
          <span style={styles.growthText}>{growthStage.charAt(0).toUpperCase() + growthStage.slice(1)} Stage</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={styles.tabs}>
        {[
          { id: 'tree', label: '🌳 My Tree', icon: '🌳' },
          { id: 'customers', label: '🍃 Leaves', icon: '🍃' },
          { id: 'staff', label: '🌿 Team', icon: '🌿' },
          { id: 'program', label: '⚙️ Roots', icon: '⚙️' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tab,
              background: activeTab === tab.id ? '#0d9488' : 'transparent',
              color: activeTab === tab.id ? 'white' : '#64748b',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={styles.content}>
        {activeTab === 'tree' && (
          <div style={styles.treeTab}>
            <div style={styles.actionCards}>
              <div style={styles.actionCard} onClick={() => setActiveTab('customers')}>
                <div style={styles.actionIcon}>🍃</div>
                <h3>View All Leaves</h3>
                <p>{customers.length} customers connected</p>
              </div>
              <div style={styles.actionCard} onClick={() => navigate('/scanner')}>
                <div style={styles.actionIcon}>📷</div>
                <h3>Scan Leaf</h3>
                <p>Add stamp via QR scan</p>
              </div>
              <div style={styles.actionCard} onClick={() => setShowInviteModal(true)}>
                <div style={styles.actionIcon}>🌿</div>
                <h3>Grow Team</h3>
                <p>Invite staff members</p>
              </div>
              <div style={styles.actionCard} onClick={fetchQRImage}>
                <div style={styles.actionIcon}>🔗</div>
                <h3>Share Tree</h3>
                <p>Get join QR code</p>
              </div>
            </div>

            {business?.status !== 'active' && (
              <div style={styles.goLiveCard}>
                <h3>🚀 Ready to Plant?</h3>
                <p>Your loyalty program is configured. Go live to start growing!</p>
                <button onClick={goLive} style={styles.goLiveBtn}>Go Live 🌱</button>
              </div>
            )}

            <div style={styles.recentActivity}>
              <h3 style={styles.sectionTitle}>🌊 Recent Sap Flow</h3>
              {customers.slice(0, 5).map(c => (
                <div key={c.public_id} style={styles.activityRow}>
                  <span style={styles.activityLeaf}>🍃</span>
                  <span style={styles.activityName}>{c.name}</span>
                  <span style={styles.activityStamps}>{c.stamp_count} rings</span>
                  {c.reward_unlocked && <span style={styles.activityFruit}>🍎</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'customers' && (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>🍃 Your Leaves ({customers.length})</h2>
              <button onClick={() => navigate('/analytics')} style={styles.viewAnalyticsBtn}>📊 View Analytics</button>
            </div>
            <div style={styles.customerGrid}>
              {customers.map(c => (
                <div key={c.public_id} style={styles.customerCard}>
                  <div style={styles.customerAvatar}>{c.name?.[0]?.toUpperCase() || '?'}</div>
                  <div style={styles.customerInfo}>
                    <h4 style={styles.customerName}>{c.name}</h4>
                    <p style={styles.customerPhone}>{c.phone}</p>
                    <div style={styles.stampRings}>
                      {Array.from({length: c.reward_threshold || 8}).map((_, i) => (
                        <span key={i} style={{
                          ...styles.stampRing,
                          background: i < (c.stamp_count % (c.reward_threshold || 8)) ? '#0d9488' : '#e2e8f0'
                        }}></span>
                      ))}
                    </div>
                    <p style={styles.stampText}>{c.stamp_count % (c.reward_threshold || 8)} / {c.reward_threshold || 8} rings</p>
                    {c.reward_unlocked && <span style={styles.fruitBadge}>🍎 Reward Ready!</span>}
                  </div>
                  <button 
                    onClick={() => viewCustomerCard(c)}
                    style={styles.viewCardBtn}
                  >
                    View Card
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'staff' && (
          <div>
            <div style={styles.sectionHeader}>
              <h2 style={styles.sectionTitle}>🌿 Your Team ({staff.length})</h2>
              <button onClick={() => setShowInviteModal(true)} style={styles.addBtn}>+ Grow Team</button>
            </div>
            <div style={styles.staffGrid}>
              {staff.map(s => (
                <div key={s.public_id} style={styles.staffCard}>
                  <div style={styles.staffAvatar}>{s.name?.[0]?.toUpperCase()}</div>
                  <div style={styles.staffInfo}>
                    <h4>{s.name}</h4>
                    <p style={styles.staffRole}>{s.role}</p>
                    <p style={styles.staffEmail}>{s.email}</p>
                    <span style={{...styles.statusBadge, background: s.is_active ? '#dcfce7' : '#fee2e2', color: s.is_active ? '#166534' : '#991b1b'}}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'program' && (
          <div style={styles.programTab}>
            <h2 style={styles.sectionTitle}>⚙️ Root System</h2>
            <div style={styles.programCard}>
              <div style={styles.programRow}>
                <span style={styles.programLabel}>🎯 Stamp Goal</span>
                <span style={styles.programValue}>{program?.stamp_goal || 8} stamps</span>
              </div>
              <div style={styles.programRow}>
                <span style={styles.programLabel}>🎁 Reward</span>
                <span style={styles.programValue}>{program?.reward_name || 'Free Service'}</span>
              </div>
              <div style={styles.programRow}>
                <span style={styles.programLabel}>🎨 Primary Color</span>
                <span style={{...styles.programValue, color: program?.primary_color || '#3b82f6'}}>{program?.primary_color || '#3b82f6'}</span>
              </div>
              <div style={styles.programRow}>
                <span style={styles.programLabel}>📅 Reward Expiry</span>
                <span style={styles.programValue}>{program?.reward_expiry_days || 30} days</span>
              </div>
              <button onClick={() => setShowConfigModal(true)} style={styles.editBtn}>🌱 Configure Roots</button>
            </div>
          </div>
        )}
      </div>

      {/* QR Code Modal */}
      {showQRModal && (
        <div style={styles.modalOverlay} onClick={() => setShowQRModal(false)}>
          <div style={{...styles.modal, textAlign: 'center'}} onClick={e => e.stopPropagation()}>
            <h3>🔗 Share Your Tree</h3>
            <p style={{color: '#64748b', fontSize: 14, marginBottom: 16}}>
              Customers scan this QR code to join your loyalty program
            </p>
            {qrImageUrl && (
              <img 
                src={qrImageUrl} 
                alt="QR Code" 
                style={{width: 200, height: 200, marginBottom: 16}} 
              />
            )}
            <p style={{fontSize: 12, color: '#94a3b8', wordBreak: 'break-all', marginBottom: 16}}>
              {FRONTEND_URL}/join/{user.business_slug}
            </p>
            <div style={{display: 'flex', gap: 12, justifyContent: 'center'}}>
              <button onClick={shareQR} style={styles.submitBtn}>
                📤 Share
              </button>
              <button onClick={downloadQR} style={{...styles.submitBtn, background: '#64748b'}}>
                ⬇️ Download
              </button>
            </div>
            <button 
              onClick={() => setShowQRModal(false)} 
              style={{...styles.submitBtn, background: 'transparent', color: '#64748b', marginTop: 8}}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Customer Loyalty Card Modal */}
      {showCardModal && selectedCustomer && (
        <div style={styles.modalOverlay} onClick={() => setShowCardModal(false)}>
          <div style={{...styles.modal, maxWidth: 380}} onClick={e => e.stopPropagation()}>
            {/* Digital Card Preview */}
            <div style={{
              ...styles.loyaltyCard,
              background: `linear-gradient(135deg, ${program?.primary_color || '#0d9488'} 0%, ${program?.primary_color || '#14b8a6'} 100%)`,
            }}>
              <div style={styles.cardHeader}>
                <span style={styles.cardLogo}>🌳</span>
                <span style={styles.cardBusiness}>{user?.business_name}</span>
              </div>
              <div style={styles.cardBody}>
                <h3 style={styles.cardName}>{selectedCustomer.name}</h3>
                <p style={styles.cardId}>ID: {selectedCustomer.public_id?.slice(0, 8)}...</p>
                <div style={styles.cardStamps}>
                  {Array.from({length: program?.stamp_goal || 8}).map((_, i) => (
                    <span key={i} style={{
                      ...styles.cardStamp,
                      background: i < (selectedCustomer.stamp_count % (program?.stamp_goal || 8)) ? 'white' : 'rgba(255,255,255,0.3)',
                    }}>★</span>
                  ))}
                </div>
                <p style={styles.cardProgress}>
                  {selectedCustomer.stamp_count % (program?.stamp_goal || 8)} / {program?.stamp_goal || 8} stamps
                </p>
                {selectedCustomer.reward_unlocked && (
                  <div style={styles.cardReward}>🎁 {program?.reward_name || 'Free Reward'} Unlocked!</div>
                )}
              </div>
            </div>

            {/* QR Code */}
            <div style={{textAlign: 'center', margin: '20px 0'}}>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${selectedCustomer.public_id}`}
                alt="Customer QR"
                style={{borderRadius: 12, border: '2px solid #e2e8f0'}}
              />
              <p style={{fontSize: 11, color: '#94a3b8', marginTop: 8}}>Scan at checkout</p>
            </div>

            {/* Wallet Buttons */}
            <div style={{display: 'flex', gap: 10, flexDirection: 'column'}}>
              <button 
                onClick={() => addToGoogleWallet(selectedCustomer)}
                style={styles.googleWalletBtn}
              >
                <span style={{fontSize: 20}}>🎫</span> Add to Google Wallet
              </button>
              <button 
                onClick={() => addToAppleWallet(selectedCustomer)}
                style={styles.appleWalletBtn}
              >
                <span style={{fontSize: 20}}>🍎</span> Add to Apple Wallet
              </button>
              <button 
                onClick={() => {
                  const cardUrl = `${FRONTEND_URL}/wallet/${selectedCustomer.public_id}`
                  if (navigator.share) {
                    navigator.share({
                      title: `${user?.business_name} Loyalty Card`,
                      text: `My loyalty card for ${user?.business_name}`,
                      url: cardUrl
                    })
                  } else {
                    navigator.clipboard.writeText(cardUrl)
                    setMessage('Card link copied!')
                  }
                }}
                style={{...styles.submitBtn, background: '#f0fdf4', color: '#0d9488'}}
              >
                🔗 Share Card Link
              </button>
            </div>

            <button 
              onClick={() => setShowCardModal(false)} 
              style={{...styles.submitBtn, background: 'transparent', color: '#64748b', marginTop: 12}}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {showInviteModal && (
        <div style={styles.modalOverlay} onClick={() => setShowInviteModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>🌿 Grow Your Team</h3>
            <form onSubmit={inviteStaff}>
              <input style={styles.input} placeholder="Name" value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})} required />
              <input style={styles.input} placeholder="Email" type="email" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} required />
              <input style={styles.input} placeholder="Phone" value={inviteForm.phone} onChange={e => setInviteForm({...inviteForm, phone: e.target.value})} />
              <select style={styles.input} value={inviteForm.role} onChange={e => setInviteForm({...inviteForm, role: e.target.value})}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
              <button type="submit" style={styles.submitBtn}>Send Invite</button>
            </form>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfigModal && (
        <div style={styles.modalOverlay} onClick={() => setShowConfigModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>🌱 Configure Root System</h3>
            <form onSubmit={saveConfig}>
              <label style={styles.label}>Stamp Goal</label>
              <input style={styles.input} type="number" min="3" max="20" value={configForm.stamp_goal || 8} onChange={e => setConfigForm({...configForm, stamp_goal: parseInt(e.target.value)})} />
              <label style={styles.label}>Reward Name</label>
              <input style={styles.input} value={configForm.reward_name || ''} onChange={e => setConfigForm({...configForm, reward_name: e.target.value})} />
              <label style={styles.label}>Primary Color</label>
              <input style={styles.input} type="color" value={configForm.primary_color || '#3b82f6'} onChange={e => setConfigForm({...configForm, primary_color: e.target.value})} />
              <label style={styles.label}>Reward Expiry (days)</label>
              <input style={styles.input} type="number" min="1" value={configForm.reward_expiry_days || 30} onChange={e => setConfigForm({...configForm, reward_expiry_days: parseInt(e.target.value)})} />
              <button type="submit" style={styles.submitBtn}>Save Configuration</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 50%, #d1fae5 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loadingTree: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    fontSize: 18,
    color: '#0d9488',
  },
  treeIcon: {
    fontSize: 64,
    animation: 'sway 2s ease-in-out infinite',
    marginBottom: 16,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 24px',
    background: 'rgba(255,255,255,0.9)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(13,148,136,0.1)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    fontSize: 36,
  },
  brandName: {
    margin: 0,
    fontSize: 20,
    fontWeight: 700,
    color: '#0f766e',
  },
  brandTagline: {
    margin: 0,
    fontSize: 12,
    color: '#0d9488',
  },
  headerActions: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  planBadge: {
    padding: '6px 12px',
    background: '#ccfbf1',
    color: '#0f766e',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
  },
  navBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  logoutBtn: {
    padding: '8px 16px',
    background: 'transparent',
    color: '#64748b',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
  },
  toast: {
    position: 'fixed',
    top: 80,
    right: 24,
    padding: '12px 20px',
    background: '#0d9488',
    color: 'white',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 200,
    cursor: 'pointer',
  },
  treeSection: {
    padding: '40px 24px',
    textAlign: 'center',
    position: 'relative',
  },
  treeVisual: {
    position: 'relative',
    width: 300,
    height: 350,
    margin: '0 auto',
  },
  treeCanopy: {
    position: 'relative',
    width: 250,
    height: 200,
    margin: '0 auto',
    transition: 'transform 0.5s ease',
  },
  treeTop: {
    fontSize: 120,
    position: 'absolute',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.1))',
  },
  leaf: {
    position: 'absolute',
    fontSize: 20,
    animation: 'float 3s ease-in-out infinite',
  },
  treeTrunk: {
    position: 'relative',
    width: 200,
    margin: '0 auto',
  },
  roots: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: 8,
  },
  root: {
    padding: '8px 16px',
    background: 'rgba(13,148,136,0.1)',
    borderRadius: 20,
    fontSize: 13,
    color: '#0f766e',
    fontWeight: 600,
  },
  statsRing: {
    display: 'flex',
    justifyContent: 'center',
    gap: 20,
    marginTop: 20,
  },
  statOrb: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 20px',
    background: 'white',
    borderRadius: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    minWidth: 80,
  },
  orbNumber: {
    fontSize: 24,
    fontWeight: 700,
    color: '#0f766e',
  },
  orbLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  growthBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 20,
    padding: '8px 20px',
    background: 'white',
    borderRadius: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  growthIcon: {
    fontSize: 24,
  },
  growthText: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f766e',
  },
  tabs: {
    display: 'flex',
    justifyContent: 'center',
    gap: 8,
    padding: '0 24px 16px',
    borderBottom: '1px solid rgba(13,148,136,0.1)',
  },
  tab: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  content: {
    padding: 24,
    maxWidth: 900,
    margin: '0 auto',
  },
  treeTab: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
  },
  actionCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 16,
  },
  actionCard: {
    background: 'white',
    borderRadius: 16,
    padding: 24,
    textAlign: 'center',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    border: '1px solid rgba(13,148,136,0.08)',
  },
  actionIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  goLiveCard: {
    background: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
    borderRadius: 16,
    padding: 24,
    color: 'white',
    textAlign: 'center',
  },
  goLiveBtn: {
    padding: '12px 32px',
    background: 'white',
    color: '#0d9488',
    border: 'none',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: 12,
  },
  recentActivity: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  sectionTitle: {
    margin: '0 0 16px 0',
    fontSize: 18,
    fontWeight: 700,
    color: '#0f766e',
  },
  activityRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  activityLeaf: {
    fontSize: 16,
  },
  activityName: {
    flex: 1,
    fontSize: 14,
    color: '#1e293b',
  },
  activityStamps: {
    fontSize: 13,
    color: '#64748b',
  },
  activityFruit: {
    fontSize: 16,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  viewAnalyticsBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  customerGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap: 16,
  },
  customerCard: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
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
  customerInfo: {
    flex: 1,
  },
  customerName: {
    margin: '0 0 4px 0',
    fontSize: 16,
    color: '#1e293b',
  },
  customerPhone: {
    margin: '0 0 8px 0',
    fontSize: 12,
    color: '#94a3b8',
  },
  stampRings: {
    display: 'flex',
    gap: 4,
    marginBottom: 4,
  },
  stampRing: {
    width: 12,
    height: 12,
    borderRadius: 6,
    transition: 'background 0.3s',
  },
  stampText: {
    margin: 0,
    fontSize: 12,
    color: '#64748b',
  },
  fruitBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    background: '#fef3c7',
    color: '#92400e',
    borderRadius: 12,
    fontSize: 11,
    fontWeight: 600,
    marginTop: 4,
  },
  viewCardBtn: {
    padding: '8px 16px',
    background: '#f0fdf4',
    color: '#0d9488',
    border: '1px solid #a7f3d0',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  addBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  staffGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 16,
  },
  staffCard: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
    display: 'flex',
    gap: 16,
    alignItems: 'center',
  },
  staffAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    background: '#e0f2fe',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#0369a1',
    fontSize: 20,
    fontWeight: 700,
  },
  staffInfo: {
    flex: 1,
  },
  staffRole: {
    margin: '2px 0',
    fontSize: 12,
    color: '#64748b',
    textTransform: 'capitalize',
  },
  staffEmail: {
    margin: '2px 0',
    fontSize: 12,
    color: '#94a3b8',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    marginTop: 4,
  },
  programTab: {
    maxWidth: 500,
    margin: '0 auto',
  },
  programCard: {
    background: 'white',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
  },
  programRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 0',
    borderBottom: '1px solid #f1f5f9',
  },
  programLabel: {
    fontSize: 14,
    color: '#64748b',
  },
  programValue: {
    fontSize: 14,
    fontWeight: 600,
    color: '#1e293b',
  },
  editBtn: {
    width: '100%',
    padding: '12px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 16,
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 300,
    padding: 20,
  },
  modal: {
    background: 'white',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 400,
    boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
  },
  loyaltyCard: {
    borderRadius: 16,
    padding: 24,
    color: 'white',
    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    borderBottom: '1px solid rgba(255,255,255,0.2)',
    paddingBottom: 12,
  },
  cardLogo: {
    fontSize: 28,
  },
  cardBusiness: {
    fontSize: 16,
    fontWeight: 700,
  },
  cardBody: {
    textAlign: 'center',
  },
  cardName: {
    margin: '0 0 4px 0',
    fontSize: 20,
    fontWeight: 700,
  },
  cardId: {
    margin: '0 0 16px 0',
    fontSize: 11,
    opacity: 0.8,
  },
  cardStamps: {
    display: 'flex',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardStamp: {
    width: 28,
    height: 28,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    color: '#0d9488',
    fontWeight: 700,
  },
  cardProgress: {
    margin: '0 0 12px 0',
    fontSize: 13,
    opacity: 0.9,
  },
  cardReward: {
    padding: '8px 16px',
    background: 'rgba(255,255,255,0.2)',
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    display: 'inline-block',
  },
  googleWalletBtn: {
    width: '100%',
    padding: '14px',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  appleWalletBtn: {
    width: '100%',
    padding: '14px',
    background: '#1c1c1e',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  input: {
    width: '100%',
    padding: '12px 16px',
    marginBottom: 12,
    border: '2px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 14,
    boxSizing: 'border-box',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#64748b',
    marginBottom: 4,
    marginTop: 8,
  },
  submitBtn: {
    width: '100%',
    padding: '14px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
  },
}

export default OwnerDashboard
