import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

function AdminDashboard({ API_BASE, user }) {
  const [businesses, setBusinesses] = useState([])
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      const [bRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/businesses`),
        fetch(`${API_BASE}/api/v1/admin/stats`),
      ])
      setBusinesses(await bRes.json())
      setStats(await sRes.json())
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={{ textAlign: 'center', padding: 100, color: '#64748b' }}>Loading...</div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brand}>
            <span style={styles.brandIcon}>🌳</span>
            <span style={styles.brandText}>LoyaltyTree Admin</span>
          </div>
          <Link to="/" style={styles.logout} onClick={() => localStorage.clear()}>Logout</Link>
        </div>
      </div>

      <div style={styles.container}>
        <div style={styles.statsGrid}>
          <StatCard icon="🏢" label="Businesses" value={stats.total_businesses || 0} color="#0d9488" />
          <StatCard icon="👥" label="Customers" value={stats.total_customers || 0} color="#6366f1" />
          <StatCard icon="⭐" label="Stamps" value={stats.total_stamps || 0} color="#f59e0b" />
          <StatCard icon="💰" label="Revenue" value={`$${stats.revenue || 0}`} color="#ec4899" />
        </div>

        <div style={styles.card}>
          <h3 style={styles.cardTitle}>All Businesses</h3>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHead}>
                  <th style={styles.th}>Business</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Plan</th>
                  <th style={styles.th}>Customers</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map(b => (
                  <tr key={b.id} style={styles.tr}>
                    <td style={styles.td}>
                      <div style={styles.bizCell}>
                        <div style={styles.bizAvatar}>{b.name?.[0] || '?'}</div>
                        <span style={styles.bizName}>{b.name}</span>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={{...styles.badge, background: b.status === 'active' ? '#d1fae5' : '#fef3c7', color: b.status === 'active' ? '#065f46' : '#92400e'}}>
                        {b.status}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{...styles.planBadge, background: b.plan === 'pro' ? '#ede9fe' : b.plan === 'growth' ? '#dbeafe' : '#f1f5f9', color: b.plan === 'pro' ? '#5b21b6' : b.plan === 'growth' ? '#1e40af' : '#475569'}}>
                        {b.plan}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={styles.count}>{b.customer_count}</span>
                    </td>
                  </tr>
                ))}
                {businesses.length === 0 && (
                  <tr><td colSpan={4} style={styles.emptyTd}>No businesses yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
  logout: {
    color: '#0d9488',
    fontSize: 14,
    fontWeight: 500,
    textDecoration: 'none',
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
  card: {
    background: 'white',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 16px',
  },
  tableWrap: {
    overflowX: 'auto',
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
    fontSize: 12,
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
  bizCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  bizAvatar: {
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
  bizName: {
    fontWeight: 600,
    color: '#0f172a',
  },
  badge: {
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  planBadge: {
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
  },
  count: {
    fontWeight: 700,
    color: '#0f172a',
  },
  emptyTd: {
    padding: 40,
    textAlign: 'center',
    color: '#94a3b8',
  },
}

export default AdminDashboard
