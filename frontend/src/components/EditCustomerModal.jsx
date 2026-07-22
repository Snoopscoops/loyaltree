import React, { useState, useEffect } from 'react'

function EditCustomerModal({ API_BASE, businessSlug, customer, onClose, onSave }) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (customer) {
      setForm({
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
      })
    }
  }, [customer])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/customers/${customer.public_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      if (res.ok) {
        onSave()
      } else {
        const data = await res.json()
        setError(data.detail || 'Failed to update')
      }
    } catch (err) {
      setError('Network error')
    }
    setLoading(false)
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete ${customer.name}? This cannot be undone.`)) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/customers/${customer.public_id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        onSave()
      }
    } catch (err) {
      setError('Failed to delete')
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>✏️ Edit Customer</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={styles.body}>
          <div style={styles.avatarSection}>
            <div style={styles.avatar}>{form.name?.[0] || '?'}</div>
            <div style={styles.memberInfo}>
              <div style={styles.memberLabel}>Member ID</div>
              <code style={styles.memberId}>{customer.public_id}</code>
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Full Name</label>
            <input
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Phone Number</label>
            <input
              value={form.phone}
              onChange={e => setForm({...form, phone: e.target.value})}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Email <span style={styles.optional}>(optional)</span></label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({...form, email: e.target.value})}
              style={styles.input}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.footer}>
            <button type="button" onClick={handleDelete} style={styles.deleteBtn}>
              🗑️ Delete
            </button>
            <div style={styles.actions}>
              <button type="button" onClick={onClose} style={styles.cancelBtn}>Cancel</button>
              <button type="submit" disabled={loading} style={styles.saveBtn}>
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modal: {
    background: 'white',
    borderRadius: 20,
    width: '100%',
    maxWidth: 440,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    borderBottom: '1px solid #e2e8f0',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    border: 'none',
    background: '#f1f5f9',
    color: '#64748b',
    fontSize: 18,
    cursor: 'pointer',
  },
  body: {
    padding: '24px',
  },
  avatarSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
    paddingBottom: 20,
    borderBottom: '1px solid #f1f5f9',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    fontWeight: 700,
  },
  memberInfo: {
    flex: 1,
  },
  memberLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 4,
  },
  memberId: {
    fontSize: 12,
    color: '#64748b',
    background: '#f8fafc',
    padding: '4px 8px',
    borderRadius: 6,
    fontFamily: 'monospace',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    marginBottom: 6,
  },
  optional: {
    color: '#94a3b8',
    fontWeight: 400,
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  error: {
    padding: '12px 16px',
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  deleteBtn: {
    padding: '10px 16px',
    background: '#fef2f2',
    color: '#dc2626',
    border: 'none',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  actions: {
    display: 'flex',
    gap: 10,
  },
  cancelBtn: {
    padding: '10px 20px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    background: 'white',
    color: '#475569',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  saveBtn: {
    padding: '10px 24px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

export default EditCustomerModal
