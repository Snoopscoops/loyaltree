import React, { useEffect, useState } from 'react'
import LoyaltySettings from './LoyaltySettings'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'

function OwnerDashboard({ API_BASE, user }) {
  const [customers, setCustomers] = useState([])
  const [stats, setStats] = useState({})
  const [staff, setStaff] = useState([])
  const [showAddStaff, setShowAddStaff] = useState(false)
  const [newStaff, setNewStaff] = useState({ name: '', email: '' })
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [cRes, sRes, stRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/customers`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/stats`),
        fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff`),
      ])
      const cData = await cRes.json()
      const sData = await sRes.json()
      const stData = await stRes.json()
      setCustomers(Array.isArray(cData) ? cData : [])
      setStats(sData || {})
      setStaff(Array.isArray(stData) ? stData : [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const addStaff = async (e) => {
    e.preventDefault()
    await fetch(`${API_BASE}/api/v1/business/${user.business_slug}/staff/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newStaff, role: 'cashier' })
    })
    setNewStaff({ name: '', email: '' })
    setShowAddStaff(false)
    fetchData()
  }

  const joinUrl = `${window.location.origin}/join/${user.business_slug}`

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={{ textAlign: 'center', padding: 100, color: '#64748b' }}>Loading...</div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brand}>
            <span style={styles.brandIcon}>🌳</span>
            <span style={styles.brandText}>LoyaltyTree</span>
          </div>
          <div style={styles.user}>
            <button onClick={() => setShowSettings(true)} style={styles.settingsBtn}>⚙️ Settings</button>
            <span style={styles.userName}>{user.business_name}</span>
            <Link to="/" style={styles.logout} onClick={() => localStorage.clear()}>Logout</Link>
          </div>
        </div>
      </div>

      <div style={styles.container}>
        {/* Stats */}
        <div style={styles.statsGrid}>
          <StatCard icon="👥" label="Customers" value={stats.total_customers || 0} color="#0d9488" />
          <StatCard icon="🎫" label="Active Cards" value={stats.active_cards || 0} color="#6366f1" />
          <StatCard icon="⭐" label="Stamps Issued" value={stats.stamps_issued || 0} color="#f59e0b" />
          <StatCard icon="🎁" label="Rewards Given" value={stats.rewards_redeemed || 0} color="#ec4899" />
        </div>

        {/* Two Column Layout */}
        <div style={styles.twoCol}>
          {/* QR Code */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>📱 Customer QR Code</h3>
            <p style={styles.cardDesc}>Place this at your counter for customers to scan and join</p>
            <div style={styles.qrBox}>
              <QRCodeSVG value={joinUrl} size={180} level="H" />
            </div>
            <div style={styles.urlBox}>
              <code style={styles.urlText}>{joinUrl}</code>
              <button onClick={() => navigator.clipboard.writeText(joinUrl)} style={styles.copyBtn}>Copy</button>
            </div>
          </div>

          {/* Staff */}
          <div style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.cardTitle}>👥 Staff</h3>
              <button onClick={() => setShowAddStaff(!showAddStaff)} style={styles.addBtn}>+ Add</button>
            </div>
            {showAddStaff && (
              <form onSubmit={addStaff} style={styles.inlineForm}>
                <input placeholder="Name" value={newStaff.name} onChange={e => setNewStaff({...newStaff, name: e.target.value})} style={styles.smallInput} required />
                <input placeholder="Email" value={newStaff.email} onChange={e => setNewStaff({...newStaff, email: e.target.value})} style={styles.smallInput} required />
                <button type="submit" style={styles.smallBtn}>Add</button>
              </form>
            )}
            <div style={styles.list}>
              {staff.map(s => (
                <div key={s.id} style={styles.listItem}>
                  <div style={styles.listAvatar}>{s.name?.[0] || '?'}</div>
                  <div style={styles.listInfo}>
                    <div style={styles.listName}>{s.name}</div>
                    <div style={styles.listMeta}>{s.email} · {s.role}</div>
                  </div>
                  <span style={{...styles.badge, background: s.is_active ? '#d1fae5' : '#fee2e2', color: s.is_active ? '#065f46' : '#991b1b'}}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
              {staff.length === 0 && <div style={styles.empty}>No staff yet</div>}
            </div>
          </div>
        </div>

        {/* Customers Table */}
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Recent Customers</h3>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHead}>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Phone</th>
                  <th style={styles.th}>Stamps</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {customers.slice(0, 20).map(c => (
                  <tr key={c.id} style={styles.tr}>
                    <td style={styles.td}>
                      <div style={styles.customerCell}>
                        <div style={styles.customerAvatar}>{c.name?.[0] || '?'}</div>
                        <span style={styles.customerName}>{c.name}</span>
                      </div>
                    </td>
                    <td style={styles.td}>{c.phone}</td>
                    <td style={styles.td}>
                      <div style={styles.stampBar}>
                        <div style={styles.stampFill}>
                          {Array.from({length: c.stamp_count || 0}).map((_, i) => (
                            <span key={i} style={styles.stampDot}>⭐</span>
                          ))}
                        </div>
                        <span style={styles.stampText}>{c.stamp_count || 0}/{c.reward_threshold || 8}</span>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={{...styles.badge, background: c.reward_unlocked ? '#d1fae5' : '#f1f5f9', color: c.reward_unlocked ? '#065f46' : '#475569'}}>
                        {c.reward_unlocked ? '🎁 Ready!' : 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
                {customers.length === 0 && (
                  <tr><td colSpan={4} style={styles.emptyTd}>No customers yet. Share your QR code!</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showSettings && (
        <LoyaltySettings
          API_BASE={API_BASE}
          businessSlug={user.business_slug}
          onClose={() => setShowSettings(false)}
          onSave={() => fetchData()}
        />
      )}
    </div>
  )
}

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{...styles.statCard, borderLeft: `4px solid ${color}`}}>
      <div style={styles.statIcon}>{icon}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    background: 'white',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky',
    top: 0,
    zIndex: 100,
  },
  headerInner: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '16px 24px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    fontSize: 24,
  },
  brandText: {
    fontSize: 20,
    fontWeight: 700,
    color: '#0f172a',
    letterSpacing: '-0.5px',
  },
  user: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  userName: {
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
  },
  logout: {
    color: '#0d9488',
    fontSize: 14,
    fontWeight: 500,
    textDecoration: 'none',
  },
  settingsBtn: {
    padding: '8px 16px',
    background: '#f1f5f9',
    color: '#475569',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
  },
  statCard: {
    background: 'white',
    borderRadius: 16,
    padding: '20px 24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  statIcon: {
    fontSize: 24,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 32,
    fontWeight: 700,
    color: '#0f172a',
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
    fontWeight: 500,
  },
  twoCol: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: 24,
  },
  card: {
    background: 'white',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 4px',
  },
  cardDesc: {
    fontSize: 13,
    color: '#64748b',
    margin: '0 0 20px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  qrBox: {
    display: 'flex',
    justifyContent: 'center',
    padding: 24,
    background: '#f8fafc',
    borderRadius: 12,
    marginBottom: 16,
  },
  urlBox: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  urlText: {
    flex: 1,
    fontSize: 12,
    color: '#64748b',
    background: '#f1f5f9',
    padding: '8px 12px',
    borderRadius: 8,
    wordBreak: 'break-all',
  },
  copyBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  addBtn: {
    padding: '6px 14px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  inlineForm: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  },
  smallInput: {
    flex: 1,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    fontFamily: 'inherit',
  },
  smallBtn: {
    padding: '8px 16px',
    background: '#0d9488',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '12px',
    background: '#f8fafc',
    borderRadius: 10,
  },
  listAvatar: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    fontWeight: 600,
  },
  listInfo: {
    flex: 1,
  },
  listName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
  },
  listMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  badge: {
    padding: '4px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 500,
  },
  empty: {
    textAlign: 'center',
    color: '#94a3b8',
    padding: 24,
    fontSize: 14,
  },
  tableWrap: {
    overflowX: 'auto',
    marginTop: 16,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  tableHead: {
    background: '#f8fafc',
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontWeight: 600,
    color: '#475569',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  tr: {
    borderBottom: '1px solid #f1f5f9',
  },
  td: {
    padding: '14px 16px',
    color: '#334155',
  },
  customerCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 600,
  },
  customerName: {
    fontWeight: 500,
    color: '#0f172a',
  },
  stampBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  stampFill: {
    display: 'flex',
    gap: 2,
  },
  stampDot: {
    fontSize: 14,
  },
  stampText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: 500,
  },
  emptyTd: {
    padding: 40,
    textAlign: 'center',
    color: '#94a3b8',
  },
}

export default OwnerDashboard
