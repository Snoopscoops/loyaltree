import React, { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

function OwnerDashboard({ API_BASE, user }) {
  const [customers, setCustomers] = useState([])
  const [stats, setStats] = useState({})
  const [staff, setStaff] = useState([])
  const [showAddStaff, setShowAddStaff] = useState(false)
  const [newStaffEmail, setNewStaffEmail] = useState('')
  const [newStaffName, setNewStaffName] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/business/${user.business_id}/customers`, {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
    .then(r => r.json())
    .then(setCustomers)

    fetch(`${API_BASE}/api/v1/business/${user.business_id}/stats`, {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
    .then(r => r.json())
    .then(setStats)

    fetch(`${API_BASE}/api/v1/business/${user.business_id}/staff`, {
      headers: { 'Authorization': `Bearer ${user.token}` }
    })
    .then(r => r.json())
    .then(setStaff)
  }, [])

  const addStaff = async (e) => {
    e.preventDefault()
    const res = await fetch(`${API_BASE}/api/v1/business/${user.business_id}/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.token}` },
      body: JSON.stringify({ email: newStaffEmail, name: newStaffName, role: 'cashier' })
    })
    if (res.ok) {
      setNewStaffEmail('')
      setNewStaffName('')
      setShowAddStaff(false)
      alert('Cashier invited! They can log in with email and password: cashier123')
    }
  }

  const joinUrl = `${window.location.origin}/join/${user.business_slug || user.business_id}`

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <h1>📊 {user.business_name || 'My Business'} Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 15, marginBottom: 30 }}>
        <StatCard title="Total Customers" value={stats.total_customers || 0} />
        <StatCard title="Active Cards" value={stats.active_cards || 0} />
        <StatCard title="Stamps Issued" value={stats.stamps_issued || 0} />
        <StatCard title="Rewards Redeemed" value={stats.rewards_redeemed || 0} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 30 }}>
        <div style={{ padding: 20, background: '#f8f9fa', borderRadius: 10 }}>
          <h3>📱 Customer QR Code</h3>
          <p style={{ color: '#666', fontSize: 14 }}>Print this and put it at your counter. Customers scan to join.</p>
          <div style={{ textAlign: 'center', padding: 20 }}>
            <QRCodeSVG value={joinUrl} size={200} />
          </div>
          <p style={{ fontSize: 12, wordBreak: 'break-all', color: '#666' }}>{joinUrl}</p>
        </div>

        <div style={{ padding: 20, background: '#f8f9fa', borderRadius: 10 }}>
          <h3>👥 Staff Management</h3>
          <button onClick={() => setShowAddStaff(!showAddStaff)} style={{ padding: '8px 16px', background: '#2d6a4f', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', marginBottom: 10 }}>
            + Add Cashier
          </button>
          {showAddStaff && (
            <form onSubmit={addStaff} style={{ marginBottom: 15 }}>
              <input placeholder="Cashier Name" value={newStaffName} onChange={e => setNewStaffName(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 5, borderRadius: 4, border: '1px solid #ccc' }} required />
              <input placeholder="Cashier Email" value={newStaffEmail} onChange={e => setNewStaffEmail(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 5, borderRadius: 4, border: '1px solid #ccc' }} required />
              <button type="submit" style={{ padding: '6px 12px', background: '#2d6a4f', color: 'white', border: 'none', borderRadius: 4 }}>Invite</button>
            </form>
          )}
          {staff.map(s => (
            <div key={s.id} style={{ padding: 8, borderBottom: '1px solid #eee' }}>
              {s.name} <span style={{ color: '#666', fontSize: 12 }}>({s.email})</span>
            </div>
          ))}
        </div>
      </div>

      <h2>Recent Customers</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#2d6a4f', color: 'white' }}>
            <th style={{ padding: 12, textAlign: 'left' }}>Name</th>
            <th style={{ padding: 12, textAlign: 'left' }}>Phone</th>
            <th style={{ padding: 12, textAlign: 'left' }}>Stamps</th>
            <th style={{ padding: 12, textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {customers.slice(0, 20).map(c => (
            <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 12 }}>{c.name}</td>
              <td style={{ padding: 12 }}>{c.phone}</td>
              <td style={{ padding: 12 }}>{c.stamp_count || 0} / {c.reward_threshold || 8}</td>
              <td style={{ padding: 12 }}>
                <span style={{ padding: '4px 10px', borderRadius: 20, background: c.reward_unlocked ? '#d4edda' : '#fff3cd', color: c.reward_unlocked ? '#155724' : '#856404', fontSize: 12 }}>
                  {c.reward_unlocked ? 'Reward Ready!' : 'Active'}
                </span>
              </td>
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

export default OwnerDashboard
