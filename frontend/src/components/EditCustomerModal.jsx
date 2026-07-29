import React, { useState, useEffect } from 'react'

function EditCustomerModal({ API_BASE, businessSlug, customer, onClose, onSave }) {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // One-time coupon state - at most one active coupon per customer.
  const [activeCoupon, setActiveCoupon] = useState(null)
  const [couponLoading, setCouponLoading] = useState(true)
  const [showCouponForm, setShowCouponForm] = useState(false)
  const [couponText, setCouponText] = useState('')
  const [couponExpiry, setCouponExpiry] = useState('')
  const [couponError, setCouponError] = useState('')
  const [couponSaving, setCouponSaving] = useState(false)

  useEffect(() => {
    if (customer) {
      setForm({
        name: customer.name || '',
        phone: customer.phone || '',
        email: customer.email || '',
      })
      fetchCoupons()
    }
  }, [customer])

  const fetchCoupons = async () => {
    setCouponLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/customers/${customer.public_id}/coupons`)
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
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/customers/${customer.public_id}/coupons`, {
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
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/coupons/${activeCoupon.public_id}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setActiveCoupon(null)
      }
    } catch (err) {
      setCouponError('Failed to cancel coupon')
    }
  }

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

          <div style={styles.couponSection}>
            <div style={styles.couponHeader}>
              <span style={styles.label}>One-Time Coupon</span>
            </div>

            {couponLoading ? (
              <p style={styles.couponHint}>Loading...</p>
            ) : activeCoupon ? (
              <div style={styles.couponActive}>
                <div style={styles.couponActiveText}>🎟️ {activeCoupon.reward_text}</div>
                {activeCoupon.expires_at && (
                  <div style={styles.couponExpiryText}>Expires {activeCoupon.expires_at}</div>
                )}
                <button type="button" onClick={handleCancelCoupon} style={styles.couponCancelBtn}>
                  Cancel Coupon
                </button>
              </div>
            ) : showCouponForm ? (
              <div style={styles.couponForm}>
                <input
                  value={couponText}
                  onChange={e => setCouponText(e.target.value)}
                  placeholder="What's the coupon for? e.g. Free coffee"
                  style={styles.input}
                  maxLength={200}
                />
                <div style={styles.couponFormRow}>
                  <input
                    type="date"
                    value={couponExpiry}
                    onChange={e => setCouponExpiry(e.target.value)}
                    style={{ ...styles.input, flex: 1 }}
                  />
                  <span style={styles.optional}>expiry (optional)</span>
                </div>
                {couponError && <div style={styles.error}>{couponError}</div>}
                <div style={styles.couponFormActions}>
                  <button type="button" onClick={() => { setShowCouponForm(false); setCouponError('') }} style={styles.cancelBtn}>
                    Cancel
                  </button>
                  <button type="button" onClick={handleCreateCoupon} disabled={couponSaving} style={styles.saveBtn}>
                    {couponSaving ? 'Creating...' : 'Create Coupon'}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setShowCouponForm(true)} style={styles.couponCreateBtn}>
                🎟️ Create One-Time Coupon
              </button>
            )}
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
  couponSection: {
    marginBottom: 20,
    paddingTop: 16,
    borderTop: '1px solid #f1f5f9',
  },
  couponHeader: {
    marginBottom: 10,
  },
  couponHint: {
    fontSize: 13,
    color: '#94a3b8',
    margin: 0,
  },
  couponCreateBtn: {
    width: '100%',
    padding: '12px 16px',
    borderRadius: 10,
    border: '1.5px dashed #0d9488',
    background: '#f0fdfa',
    color: '#0f766e',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  couponActive: {
    background: '#f0fdfa',
    border: '1.5px solid #0d9488',
    borderRadius: 10,
    padding: '14px 16px',
  },
  couponActiveText: {
    fontSize: 14,
    fontWeight: 600,
    color: '#0f172a',
  },
  couponExpiryText: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  couponCancelBtn: {
    marginTop: 10,
    padding: '8px 14px',
    borderRadius: 8,
    border: 'none',
    background: '#fef2f2',
    color: '#dc2626',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  couponForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  couponFormRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  couponFormActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
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
