import React, { useEffect, useState } from 'react'

function AdminDashboard({ API_BASE, user }) {
  const [businesses, setBusinesses] = useState([])
  const [stats, setStats] = useState({})

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/admin/businesses`, {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
    .then(r => r.json())
    .then(setBusinesses)

    fetch(`${API_BASE}/api/v1/admin/stats`, {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
    .then(r => r.json())
    .then(setStats)
  }, [])

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <h1>🌳 LoyaltyTree Admin</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 15, marginBottom: 30 }}>
        <StatCard title="Total Businesses" value={stats.total_businesses || 0} />
        <StatCard title="Total Customers" value={stats.total_customers || 0} />
        <StatCard title="Total Stamps" value={stats.total_stamps || 0} />
        <StatCard title="Monthly Revenue" value={`$${stats.revenue || 0}`} />
      </div>
      <h2>Businesses</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#2d6a4f', color: 'white' }}>
            <th style={{ padding: 12, textAlign: 'left' }}>Name</th>
            <th style={{ padding: 12, textAlign: 'left' }}>Status</th>
            <th style={{ padding: 12, textAlign: 'left' }}>Plan</th>
            <th style={{ padding: 12, textAlign: 'left' }}>Customers</th>
          </tr>
        </thead>
        <tbody>
          {businesses.map(b => (
            <tr key={b.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>{b.name}</td>
              <td style={{ padding: 12 }}>
                <span style={{ padding: '4px 10px', borderRadius: 20, background: b.status === 'active' ? '#d4edda' : '#f8d7da', color: b.status === 'active' ? '#155724' : '#721c24', fontSize: 12 }}>
                  {b.status}
                </span>
              </td>
              <td style={{ padding: 12 }}>{b.plan}</td>
              <td style={{ padding: 12 }}>{b.customer_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatCard({ title, value }) {
  return (
    <div style={{ padding: 20, background: '#f8f9fa', borderRadius: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 32, fontWeight: 'bold', color: '#2d6a4f' }}>{value}</div>
      <div style={{ color: '#666', fontSize: 14 }}>{title}</div>
    </div>
  )
}

export default AdminDashboard
