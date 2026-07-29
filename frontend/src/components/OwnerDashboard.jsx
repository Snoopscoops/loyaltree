import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Announcements from './Announcements'
import LoyaltyCardCustomizer from './LoyaltyCardCustomizer'

// Turns an ISO timestamp into a short relative label like "2 days ago"
function formatLastStamped(isoString) {
  if (!isoString) return 'Never stamped'
  const then = new Date(isoString)
  if (isNaN(then.getTime())) return 'Never stamped'
  const diffMs = Date.now() - then.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Stamped today'
  if (diffDays === 1) return 'Stamped yesterday'
  if (diffDays < 30) return `Stamped ${diffDays} days ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `Stamped ${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`
  const diffYears = Math.floor(diffMonths / 12)
  return `Stamped ${diffYears} year${diffYears !== 1 ? 's' : ''} ago`
}

function OwnerDashboard({ API_BASE, user, onLogout }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('tree')
  const [business, setBusiness] = useState(null)
  const [customers, setCustomers] = useState([])
  const [staff, setStaff] = useState([])
  const [branches, setBranches] = useState([])
  const [stats, setStats] = useState(null)
  const [program, setProgram] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showQRModal, setShowQRModal] = useState(false)
  const [showCardModal, setShowCardModal] = useState(false)
  const [showAnnouncements, setShowAnnouncements] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [showStaffEditModal, setShowStaffEditModal] = useState(false)
  const [staffEditForm, setStaffEditForm] = useState({})
  const [savingStaff, setSavingStaff] = useState(false)
  const [deletingStaff, setDeletingStaff] = useState(false)
  const [qrImageUrl, setQrImageUrl] = useState(null)

  // One-time coupon state - at most one active coupon per customer,
  // scoped to whichever customer is currently open in the Edit modal.
  const [activeCoupon, setActiveCoupon] = useState(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const [showCouponForm, setShowCouponForm] = useState(false)
  const [couponText, setCouponText] = useState('')
  const [couponExpiry, setCouponExpiry] = useState('')
  const [couponError, setCouponError] = useState('')
  const [couponSaving, setCouponSaving] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', email: '', phone: '', role: 'cashier', branch_public_id: '' })
  const [newBranchName, setNewBranchName] = useState('')
  const [savingBranch, setSavingBranch] = useState(false)
  const [message, setMessage] = useState('')
  const [stampCounts, setStampCounts] = useState({}) // staff public_id -> stamps added
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)

  // Frontend URL for customer-facing pages
  const FRONTEND_URL = 'https://loyaltree-btw1.onrender.com'
  const onboardingKey = user?.business_slug ? `loyaltree_onboarding_seen_${user.business_slug}` : null
  const isActive = (business?.status || '').toUpperCase() === 'ACTIVE'

  useEffect(() => {
    if (!user?.business_slug) return
    loadData()

    // Stamps and redemptions happen from the cashier's device, a separate
    // session, so this dashboard has no way to know data changed unless it
    // asks again. Poll periodically to keep Leaves/Rings/Fruits current.
    const interval = setInterval(loadData, 15000)
    return () => clearInterval(interval)
  }, [user])

  // Auto-launch the setup tutorial the first time the business goes live,
  // so the owner is walked through Edit Card -> Cashier -> Share Tree ->
  // Analytics before they start using the dashboard on their own.
  useEffect(() => {
    if (!isActive || !onboardingKey) return
    const seen = localStorage.getItem(onboardingKey)
    if (!seen) {
      setOnboardingStep(0)
      setShowOnboarding(true)
    }
  }, [isActive, onboardingKey])

  const closeOnboarding = () => {
    if (onboardingKey) localStorage.setItem(onboardingKey, '1')
    setShowOnboarding(false)
  }

  const loadData = async () => {
    try {
      const [bizRes, custRes, staffRes, statsRes, progRes, stampCountRes, branchRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/stats`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/loyalty-config`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/stamp-counts`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/branches`),
      ])

      const bizData = await bizRes.json().catch(() => null)
      const custData = await custRes.json().catch(() => [])
      const staffData = await staffRes.json().catch(() => [])
      const statsData = await statsRes.json().catch(() => null)
      const progData = await progRes.json().catch(() => null)
      const stampCountData = await stampCountRes.json().catch(() => [])
      const branchData = await branchRes.json().catch(() => [])

      setBusiness(bizData)
      setCustomers(custData)
      setStaff(staffData)
      setStats(statsData)
      setProgram(progData)
      setBranches(Array.isArray(branchData) ? branchData : [])

      if (Array.isArray(stampCountData)) {
        const map = {}
        stampCountData.forEach(row => { map[row.staff_public_id] = row.stamp_count })
        setStampCounts(map)
      }
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
        setInviteForm({ name: '', email: '', phone: '', role: 'cashier', branch_public_id: '' })
        loadData()
      } else {
        const data = await res.json()
        setMessage(data.detail || 'Invite failed')
      }
    } catch (err) {
      setMessage('Network error')
    }
  }

  const addBranch = async (e) => {
    e.preventDefault()
    if (!newBranchName.trim()) return
    setSavingBranch(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newBranchName.trim() })
      })
      if (res.ok) {
        setNewBranchName('')
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not add branch')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setSavingBranch(false)
  }

  const renameBranch = async (branch, name) => {
    if (!name.trim() || name === branch.name) return
    try {
      await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/branches/${branch.public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      })
      loadData()
    } catch (err) {
      setMessage('Network error')
    }
  }

  const openEditCustomer = (c) => {
    setEditForm({
      public_id: c.public_id,
      name: c.name || '',
      address: c.address || '',
      age: c.age ?? '',
      phone: c.phone || '',
      email: c.email || '',
      birthday: c.birthday || '',
      occupation: c.occupation || '',
      last_order_date: c.last_order_date || '',
      stamp_count: c.stamp_count ?? 0,
    })
    setShowCouponForm(false)
    setCouponError('')
    setCouponText('')
    setCouponExpiry('')
    fetchCoupons(c.public_id)
    setShowEditModal(true)
  }

  const fetchCoupons = async (customerPublicId) => {
    setCouponLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${customerPublicId}/coupons`)
      if (res.ok) {
        const coupons = await res.json()
        const today = new Date().toISOString().slice(0, 10)
        const active = coupons.find(c => c.status === 'active' && (!c.expires_at || c.expires_at >= today))
        setActiveCoupon(active || null)
      }
    } catch (err) {
      // best-effort - editing the customer still works without coupon data
    }
    setCouponLoading(false)
  }

  const handleCreateCoupon = async () => {
    setCouponError('')
    if (!couponText.trim()) {
      setCouponError('Enter what the coupon is for')
      return
    }
    setCouponSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${editForm.public_id}/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reward_text: couponText.trim(),
          expires_at: couponExpiry || null,
        })
      })
      const data = await res.json()
      if (res.ok) {
        setActiveCoupon(data)
        setShowCouponForm(false)
        setCouponText('')
        setCouponExpiry('')
      } else {
        setCouponError(data.detail || 'Failed to create coupon')
      }
    } catch (err) {
      setCouponError('Network error')
    }
    setCouponSaving(false)
  }

  const handleCancelCoupon = async () => {
    if (!activeCoupon) return
    if (!window.confirm('Cancel this coupon?')) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/coupons/${activeCoupon.public_id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setActiveCoupon(null)
      }
    } catch (err) {
      setCouponError('Failed to cancel coupon')
    }
  }

  const saveCustomer = async (e) => {
    e.preventDefault()
    setSavingCustomer(true)
    try {
      const { public_id, ...fields } = editForm
      const payload = {
        ...fields,
        age: fields.age === '' ? null : parseInt(fields.age, 10),
        stamp_count: fields.stamp_count === '' ? null : parseInt(fields.stamp_count, 10),
      }
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers/${public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        setShowEditModal(false)
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not save customer')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setSavingCustomer(false)
  }

  const openEditStaff = (s) => {
    const currentBranch = branches.find(b => b.id === s.branch_id)
    setStaffEditForm({
      public_id: s.public_id,
      name: s.name || '',
      email: s.email || '',
      phone: s.phone || '',
      role: s.role || 'cashier',
      pin: s.pin || '0000',
      is_active: s.is_active !== false,
      branch_public_id: currentBranch?.public_id || '',
    })
    setShowStaffEditModal(true)
  }

  const saveStaff = async (e) => {
    e.preventDefault()
    setSavingStaff(true)
    try {
      const { public_id, ...fields } = staffEditForm
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/${public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      })
      if (res.ok) {
        setShowStaffEditModal(false)
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not save cashier')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setSavingStaff(false)
  }

  const deleteStaff = async () => {
    if (!staffEditForm.public_id) return
    if (!window.confirm(`Remove ${staffEditForm.name || 'this cashier'} from your team? This can't be undone.`)) return
    setDeletingStaff(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/${staffEditForm.public_id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setShowStaffEditModal(false)
        loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage(data.detail || 'Could not remove cashier')
      }
    } catch (err) {
      setMessage('Network error')
    }
    setDeletingStaff(false)
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
    // Generate QR code with correct frontend URL (bypass backend wrong URL)
    const joinUrl = `${FRONTEND_URL}/join/${user.business_slug}`
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(joinUrl)}`
    setQrImageUrl(qrApiUrl)
    setShowQRModal(true)
  }

  const shareQR = async () => {
    const joinUrl = `${FRONTEND_URL}/join/${user.business_slug}`
    const shareText = `Join ${user?.business_name || 'our'} loyalty program! Scan the QR code or visit: ${joinUrl}`

    try {
      // Fetch the QR image as a blob for sharing
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(joinUrl)}`
      const qrRes = await fetch(qrApiUrl)
      const qrBlob = await qrRes.blob()
      const qrFile = new File([qrBlob], 'loyaltree-qr.png', { type: 'image/png' })

      if (navigator.canShare && navigator.canShare({ files: [qrFile] })) {
        await navigator.share({
          title: `Join ${user?.business_name || 'Us'} Rewards`,
          text: shareText,
          url: joinUrl,
          files: [qrFile]
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
          await navigator.share({
            title: `Join ${user?.business_name || 'Us'} Rewards`,
            text: `Get stamps and earn rewards!`,
            url: joinUrl,
          })
        } catch (e2) {
          await navigator.clipboard.writeText(joinUrl)
          setMessage('Join link copied!')
        }
      }
    }
  }

  const downloadQR = () => {
    if (!qrImageUrl) return
    const link = document.createElement('a')
    link.href = qrImageUrl
    link.download = `${user?.business_name || 'business'}-qr-code.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const viewCustomerCard = (customer) => {
    setSelectedCustomer(customer)
    fetchCoupons(customer.public_id)
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
          <button onClick={() => { setOnboardingStep(0); setShowOnboarding(true) }} style={styles.navBtn}>🎓 Setup Guide</button>
          <button onClick={() => setShowAnnouncements(true)} style={styles.navBtn}>📢 Announcements</button>
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
          </div>
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
          { id: 'program', label: '✏️ Edit Card', icon: '✏️' },
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
              <div style={styles.actionCard} onClick={() => navigate('/scanner', { state: { ownerMode: true, businessSlug: user.business_slug, ownerName: user.business_name } })}>
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
                    {(c.age || c.occupation) && (
                      <p style={{...styles.customerPhone, fontSize: 12, color: '#94a3b8'}}>
                        {c.age ? `${c.age} yrs` : ''}{c.age && c.occupation ? ' · ' : ''}{c.occupation ? c.occupation.replace('_', ' ') : ''}
                      </p>
                    )}
                    <div style={styles.stampRings}>
                      {Array.from({length: c.reward_threshold || 8}).map((_, i) => (
                        <span key={i} style={{
                          ...styles.stampRing,
                          background: i < (c.stamp_count % (c.reward_threshold || 8)) ? '#0d9488' : '#e2e8f0'
                        }}></span>
                      ))}
                    </div>
                    <p style={styles.stampText}>{c.stamp_count % (c.reward_threshold || 8)} / {c.reward_threshold || 8} rings</p>
                    <p style={styles.lastStampedText}>{formatLastStamped(c.last_stamp_at)}</p>
                    {c.reward_unlocked && <span style={styles.fruitBadge}>🍎 Reward Ready!</span>}
                  </div>
                  <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                    <button
                      onClick={() => viewCustomerCard(c)}
                      style={styles.viewCardBtn}
                    >
                      View Card
                    </button>
                    <button
                      onClick={() => openEditCustomer(c)}
                      style={{...styles.viewCardBtn, background: 'transparent', color: '#0d9488', border: '1px solid #a7f3d0'}}
                    >
                      ✏️ Edit
                    </button>
                  </div>
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

            <div style={{background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 12, padding: '14px 16px', marginBottom: 16}}>
              <p style={{margin: '0 0 8px 0', fontSize: 13, fontWeight: 600, color: '#0f766e'}}>
                🏢 Branches
              </p>
              {branches.map(b => (
                <div key={b.public_id} style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6}}>
                  <input
                    defaultValue={b.name}
                    onBlur={e => renameBranch(b, e.target.value)}
                    style={{...styles.input, margin: 0, flex: 1, fontSize: 13, padding: '6px 10px'}}
                  />
                </div>
              ))}
              <form onSubmit={addBranch} style={{display: 'flex', gap: 8, marginTop: 8}}>
                <input
                  placeholder="New branch name"
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  style={{...styles.input, margin: 0, flex: 1, fontSize: 13, padding: '6px 10px'}}
                />
                <button type="submit" disabled={savingBranch} style={{padding: '6px 12px', background: '#0d9488', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'}}>
                  + Add
                </button>
              </form>
            </div>

            <div style={{background: '#f0fdf4', border: '1px solid #a7f3d0', borderRadius: 12, padding: '14px 16px', marginBottom: 16}}>
              <p style={{margin: '0 0 4px 0', fontSize: 13, fontWeight: 600, color: '#0f766e'}}>
                Business ID (cashiers need this to log in)
              </p>
              <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <code style={{fontSize: 13, color: '#1e293b', background: 'white', padding: '6px 10px', borderRadius: 8, wordBreak: 'break-all', flex: 1}}>
                  {user.business_slug}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(user.business_slug)}
                  style={{padding: '6px 12px', background: '#0d9488', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap'}}
                >
                  Copy
                </button>
              </div>
            </div>

            <div style={styles.staffGrid}>
              {staff.map(s => (
                <div key={s.public_id} style={styles.staffCard}>
                  <div style={styles.staffAvatar}>{s.name?.[0]?.toUpperCase()}</div>
                  <div style={styles.staffInfo}>
                    <h4>{s.name}</h4>
                    <p style={styles.staffRole}>{s.role}</p>
                    <p style={styles.staffEmail}>{s.email}</p>
                    {branches.find(b => b.id === s.branch_id) && (
                      <p style={{margin: '4px 0 0 0', fontSize: 12, color: '#0f766e'}}>
                        🏢 {branches.find(b => b.id === s.branch_id).name}
                      </p>
                    )}
                    <p style={{margin: '4px 0 0 0', fontSize: 12, color: '#0f766e', fontWeight: 600}}>
                      PIN: <code style={{background: '#f0fdf4', padding: '2px 6px', borderRadius: 6}}>{s.pin || '0000'}</code>
                    </p>
                    <p style={{margin: '4px 0 0 0', fontSize: 12, color: '#64748b'}}>
                      🏷️ {stampCounts[s.public_id] || 0} stamps added
                    </p>
                    <span style={{...styles.statusBadge, background: s.is_active ? '#dcfce7' : '#fee2e2', color: s.is_active ? '#166534' : '#991b1b'}}>
                      {s.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <button
                    onClick={() => openEditStaff(s)}
                    style={{...styles.viewCardBtn, background: 'transparent', color: '#0d9488', border: '1px solid #a7f3d0', alignSelf: 'flex-start'}}
                  >
                    ✏️ Edit
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'program' && (
          <div style={styles.programTab}>
            <LoyaltyCardCustomizer API_BASE={API_BASE} user={user} onSaved={loadData} />

            {business?.status !== 'active' && (
              <div style={{...styles.goLiveCard, marginTop: 16, maxWidth: 500, marginLeft: 'auto', marginRight: 'auto'}}>
                <h3>🚀 Ready to Plant?</h3>
                <p>Your loyalty program is configured. Go live to start growing!</p>
                <button onClick={goLive} style={styles.goLiveBtn}>Go Live 🌱</button>
              </div>
            )}
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

            {activeCoupon && (
              <div style={{ background: '#f0fdfa', border: '1.5px dashed #0d9488', borderRadius: 10, padding: '10px 14px', textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0f766e' }}>🎟️ {activeCoupon.reward_text}</div>
              </div>
            )}

            {/* QR Code */}
            <div style={{textAlign: 'center', margin: '20px 0'}}>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(`${API_BASE}/stamp/${selectedCustomer.public_id}`)}`}
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
      {/* Edit Customer Modal */}
      {showEditModal && (
        <div style={styles.modalOverlay} onClick={() => setShowEditModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>✏️ Edit Customer</h3>
            <form onSubmit={saveCustomer}>
              <label style={styles.label}>Full Name</label>
              <input style={styles.input} value={editForm.name || ''} onChange={e => setEditForm({...editForm, name: e.target.value})} required />
              <label style={styles.label}>
                Stamps {program?.stamp_goal ? `(of ${program.stamp_goal} for a reward)` : ''}
              </label>
              <input
                style={styles.input}
                type="number"
                min="0"
                value={editForm.stamp_count}
                onChange={e => setEditForm({...editForm, stamp_count: e.target.value})}
              />
              <label style={styles.label}>Address</label>
              <input style={styles.input} value={editForm.address || ''} onChange={e => setEditForm({...editForm, address: e.target.value})} />
              <label style={styles.label}>Age</label>
              <input style={styles.input} type="number" min="0" max="120" value={editForm.age} onChange={e => setEditForm({...editForm, age: e.target.value})} />
              <label style={styles.label}>Number</label>
              <input style={styles.input} value={editForm.phone || ''} onChange={e => setEditForm({...editForm, phone: e.target.value})} required />
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={editForm.email || ''} onChange={e => setEditForm({...editForm, email: e.target.value})} />
              <label style={styles.label}>Birthday</label>
              <input style={styles.input} type="date" value={editForm.birthday || ''} onChange={e => setEditForm({...editForm, birthday: e.target.value})} />
              <label style={styles.label}>Occupation</label>
              <select style={styles.input} value={editForm.occupation || ''} onChange={e => setEditForm({...editForm, occupation: e.target.value})}>
                <option value="">Not specified</option>
                <option value="working">Working</option>
                <option value="business_owner">Business Owner</option>
                <option value="unemployed">Unemployed</option>
              </select>
              <label style={styles.label}>Since When Last Ordered</label>
              <input style={styles.input} type="date" value={editForm.last_order_date || ''} onChange={e => setEditForm({...editForm, last_order_date: e.target.value})} />
              <button type="submit" style={styles.submitBtn} disabled={savingCustomer}>
                {savingCustomer ? 'Saving...' : 'Save Changes'}
              </button>
            </form>

            {/* One-Time Coupon */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
              <label style={styles.label}>One-Time Coupon</label>
              {couponLoading ? (
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Loading...</p>
              ) : activeCoupon ? (
                <div style={{ background: '#f0fdfa', border: '1.5px solid #0d9488', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>🎟️ {activeCoupon.reward_text}</div>
                  {activeCoupon.expires_at && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Expires {activeCoupon.expires_at}</div>
                  )}
                  <button
                    type="button"
                    onClick={handleCancelCoupon}
                    style={{ marginTop: 10, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Cancel Coupon
                  </button>
                </div>
              ) : showCouponForm ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input
                    style={styles.input}
                    value={couponText}
                    onChange={e => setCouponText(e.target.value)}
                    placeholder="What's the coupon for? e.g. Free coffee"
                    maxLength={200}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input
                      style={{ ...styles.input, flex: 1 }}
                      type="date"
                      value={couponExpiry}
                      onChange={e => setCouponExpiry(e.target.value)}
                    />
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>expiry (optional)</span>
                  </div>
                  {couponError && <div style={{ color: '#dc2626', fontSize: 13 }}>{couponError}</div>}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => { setShowCouponForm(false); setCouponError('') }}
                      style={{ ...styles.submitBtn, background: 'transparent', color: '#64748b' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateCoupon}
                      disabled={couponSaving}
                      style={styles.submitBtn}
                    >
                      {couponSaving ? 'Creating...' : 'Create Coupon'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCouponForm(true)}
                  style={{ width: '100%', padding: '12px 16px', borderRadius: 10, border: '1.5px dashed #0d9488', background: '#f0fdfa', color: '#0f766e', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  🎟️ Create One-Time Coupon
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {showStaffEditModal && (
        <div style={styles.modalOverlay} onClick={() => setShowStaffEditModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3>✏️ Edit Cashier</h3>
            <form onSubmit={saveStaff}>
              <label style={styles.label}>Name</label>
              <input style={styles.input} value={staffEditForm.name || ''} onChange={e => setStaffEditForm({...staffEditForm, name: e.target.value})} required />
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={staffEditForm.email || ''} onChange={e => setStaffEditForm({...staffEditForm, email: e.target.value})} required />
              <label style={styles.label}>Phone</label>
              <input style={styles.input} value={staffEditForm.phone || ''} onChange={e => setStaffEditForm({...staffEditForm, phone: e.target.value})} />
              <label style={styles.label}>Role</label>
              <select style={styles.input} value={staffEditForm.role || 'cashier'} onChange={e => setStaffEditForm({...staffEditForm, role: e.target.value})}>
                <option value="cashier">Cashier</option>
                <option value="manager">Manager</option>
              </select>
              <label style={styles.label}>Branch</label>
              <select style={styles.input} value={staffEditForm.branch_public_id || ''} onChange={e => setStaffEditForm({...staffEditForm, branch_public_id: e.target.value})}>
                <option value="">No branch assigned</option>
                {branches.map(b => (
                  <option key={b.public_id} value={b.public_id}>{b.name}</option>
                ))}
              </select>
              <label style={styles.label}>PIN</label>
              <input
                style={styles.input}
                value={staffEditForm.pin || ''}
                onChange={e => setStaffEditForm({...staffEditForm, pin: e.target.value.replace(/\D/g, '').slice(0, 6)})}
                inputMode="numeric"
                placeholder="0000"
              />
              <label style={{...styles.label, display: 'flex', alignItems: 'center', gap: 8}}>
                <input
                  type="checkbox"
                  checked={staffEditForm.is_active !== false}
                  onChange={e => setStaffEditForm({...staffEditForm, is_active: e.target.checked})}
                />
                Active (can clock in / stamp cards)
              </label>
              <button type="submit" style={styles.submitBtn} disabled={savingStaff}>
                {savingStaff ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={deleteStaff}
                disabled={deletingStaff}
                style={{...styles.submitBtn, background: 'transparent', color: '#dc2626', border: '1px solid #fecaca', marginTop: 8}}
              >
                {deletingStaff ? 'Removing...' : '🗑️ Remove Cashier'}
              </button>
            </form>
          </div>
        </div>
      )}

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
              <select style={styles.input} value={inviteForm.branch_public_id} onChange={e => setInviteForm({...inviteForm, branch_public_id: e.target.value})}>
                <option value="">No branch assigned</option>
                {branches.map(b => (
                  <option key={b.public_id} value={b.public_id}>{b.name}</option>
                ))}
              </select>
              <button type="submit" style={styles.submitBtn}>Send Invite</button>
            </form>
          </div>
        </div>
      )}

      {showAnnouncements && (
        <Announcements
          API_BASE={API_BASE}
          businessSlug={user.business_slug}
          onClose={() => setShowAnnouncements(false)}
        />
      )}

      {showOnboarding && (() => {
        const steps = [
          {
            emoji: '✏️',
            title: '1. Set Up Your Card',
            body: "Configure your loyalty program: how many stamps until a reward, what the reward is, your card color, and your logo. Make sure to save & publish so your card is actually live - customers won't see your branding on their Google Wallet card until you do.",
            cta: 'Go to Edit Card',
            action: () => { setActiveTab('program'); closeOnboarding() },
          },
          {
            emoji: '🌿',
            title: '2. Set Up Your Cashiers',
            body: "Invite your staff and each one gets a 4-digit PIN. Important: cashiers also need your Business ID (shown on the Team tab) to log into the scanner - without it, their PIN alone won't work. Share both with them.",
            cta: 'Go to Team',
            action: () => { setActiveTab('staff'); closeOnboarding() },
          },
          {
            emoji: '🔗',
            title: '3. Share Your Tree',
            body: "Get your join QR code and print it out. Keep it at the counter or entrance so customers can scan it themselves as they come in, sign up in seconds, and start earning stamps right away.",
            cta: 'Get QR Code',
            action: () => { setActiveTab('tree'); closeOnboarding(); fetchQRImage() },
          },
          {
            emoji: '📊',
            title: '4. Analytics & Announcements',
            body: "Check Analytics to see visit trends, repeat customers, and redemption rates. Use Announcements to push a message straight to customers' Google Wallet cards - great for promos or reminders.",
            cta: 'View Analytics',
            action: () => { closeOnboarding(); navigate('/analytics') },
          },
        ]
        const step = steps[onboardingStep]
        const isLast = onboardingStep === steps.length - 1
        return (
          <div style={styles.modalOverlay} onClick={closeOnboarding}>
            <div style={{...styles.modal, textAlign: 'center', maxWidth: 420}} onClick={e => e.stopPropagation()}>
              <div style={{fontSize: 40, marginBottom: 8}}>{step.emoji}</div>
              <h3 style={{marginBottom: 12}}>{step.title}</h3>
              <p style={{color: '#64748b', fontSize: 14, marginBottom: 20, lineHeight: 1.5}}>{step.body}</p>

              <div style={{display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 20}}>
                {steps.map((_, i) => (
                  <span key={i} style={{
                    width: 8, height: 8, borderRadius: 4,
                    background: i === onboardingStep ? '#0d9488' : '#e2e8f0',
                  }} />
                ))}
              </div>

              <div style={{display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 12}}>
                {onboardingStep > 0 && (
                  <button onClick={() => setOnboardingStep(s => s - 1)} style={{...styles.submitBtn, background: '#64748b'}}>
                    Back
                  </button>
                )}
                <button onClick={step.action} style={styles.submitBtn}>
                  {step.cta}
                </button>
                {!isLast && (
                  <button onClick={() => setOnboardingStep(s => s + 1)} style={{...styles.submitBtn, background: 'transparent', color: '#0d9488', border: '1px solid #a7f3d0'}}>
                    Next
                  </button>
                )}
              </div>

              <button onClick={closeOnboarding} style={{background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer'}}>
                Skip tutorial
              </button>
            </div>
          </div>
        )
      })()}
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
    flexWrap: 'wrap',
    rowGap: 10,
    padding: '12px 16px',
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
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap',
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
    padding: '32px 16px',
    textAlign: 'center',
    position: 'relative',
  },
  treeVisual: {
    position: 'relative',
    width: 300,
    maxWidth: '100%',
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
    flexWrap: 'wrap',
    gap: 12,
    maxWidth: 360,
    margin: '20px auto 0',
  },
  statOrb: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px 20px',
    background: 'white',
    borderRadius: 16,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    minWidth: 90,
    flex: '1 1 90px',
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
    flexWrap: 'wrap',
    gap: 8,
    padding: '0 16px 16px',
    borderBottom: '1px solid rgba(13,148,136,0.1)',
  },
  tab: {
    padding: '10px 16px',
    border: 'none',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    whiteSpace: 'nowrap',
  },
  content: {
    padding: '20px 16px',
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
    flexWrap: 'wrap',
    gap: 12,
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
  lastStampedText: {
    margin: '2px 0 0 0',
    fontSize: 11.5,
    color: '#94a3b8',
    fontStyle: 'italic',
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
    maxWidth: 1000,
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
    padding: 16,
  },
  modal: {
    background: 'white',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '90vh',
    overflowY: 'auto',
    boxSizing: 'border-box',
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
    fontSize: 16,
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
