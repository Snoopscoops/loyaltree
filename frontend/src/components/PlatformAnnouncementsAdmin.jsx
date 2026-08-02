import React, { useState, useEffect } from 'react'

const EMPTY_FORM = { title: '', message: '', type: 'promo', end_date: '', is_active: true }

// Lets the platform admin write/edit/delete the promos that show up as a
// dismissible banner on every business owner's dashboard (PlatformPromoBanner.jsx).
function PlatformAnnouncementsAdmin({ API_BASE, token }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const authedFetch = (path, opts = {}) => fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Authorization': `Bearer ${token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })

  const load = async () => {
    setLoading(true)
    try {
      const res = await authedFetch('/api/v1/admin/platform-announcements')
      const data = await res.json()
      setItems(Array.isArray(data) ? data : [])
    } catch (err) {
      // best-effort - list just stays empty/stale if this fails
    }
    setLoading(false)
  }

  useEffect(() => { if (token) load() }, [token])

  const startEdit = (item) => {
    setEditingId(item.public_id)
    setForm({
      title: item.title || '',
      message: item.message || '',
      type: item.type || 'promo',
      end_date: item.end_date || '',
      is_active: item.is_active !== false,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim() || !form.message.trim()) {
      setError('Title and message are required')
      return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type,
        end_date: form.end_date || null,
        is_active: form.is_active,
      }
      const res = editingId
        ? await authedFetch(`/api/v1/admin/platform-announcements/${editingId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await authedFetch('/api/v1/admin/platform-announcements', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
      if (res.ok) {
        cancelEdit()
        load()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Failed to save')
      }
    } catch (err) {
      setError('Network error')
    }
    setSaving(false)
  }

  const toggleActive = async (item) => {
    try {
      await authedFetch(`/api/v1/admin/platform-announcements/${item.public_id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !item.is_active }),
      })
      load()
    } catch (err) {
      // best-effort
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.title}"? This removes it from every owner's dashboard.`)) return
    try {
      await authedFetch(`/api/v1/admin/platform-announcements/${item.public_id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      // best-effort
    }
  }

  return (
    <div style={styles.section}>
      <h2 style={styles.sectionTitle}>📣 Platform Promotions</h2>
      <p style={styles.sectionSubtitle}>
        Post an announcement to every business owner's dashboard - promos, feature updates, reminders.
      </p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
          placeholder="Title, e.g. Refer a friend, get a free month"
          style={styles.input}
        />
        <textarea
          value={form.message}
          onChange={e => setForm({ ...form, message: e.target.value })}
          placeholder="Message shown to owners"
          style={{ ...styles.input, minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={styles.formRow}>
          <select
            value={form.type}
            onChange={e => setForm({ ...form, type: e.target.value })}
            style={styles.select}
          >
            <option value="promo">Promo</option>
            <option value="info">Info</option>
            <option value="update">Feature update</option>
          </select>
          <input
            type="date"
            value={form.end_date}
            onChange={e => setForm({ ...form, end_date: e.target.value })}
            style={styles.select}
            title="Optional end date"
          />
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm({ ...form, is_active: e.target.checked })}
            />
            Active
          </label>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.formActions}>
          {editingId && (
            <button type="button" onClick={cancelEdit} style={styles.cancelBtn}>Cancel</button>
          )}
          <button type="submit" disabled={saving} style={styles.submitBtn}>
            {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Post to All Owners'}
          </button>
        </div>
      </form>

      {loading ? (
        <p style={styles.hint}>Loading...</p>
      ) : items.length === 0 ? (
        <p style={styles.hint}>No platform announcements yet.</p>
      ) : (
        <div style={styles.list}>
          {items.map(item => (
            <div key={item.public_id} style={styles.item}>
              <div style={styles.itemTop}>
                <span style={{ ...styles.badge, opacity: item.is_active ? 1 : 0.5 }}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </span>
                <span style={styles.itemTitle}>{item.title}</span>
              </div>
              <div style={styles.itemMessage}>{item.message}</div>
              {item.end_date && <div style={styles.itemMeta}>Ends {item.end_date}</div>}
              <div style={styles.itemActions}>
                <button onClick={() => toggleActive(item)} style={styles.smallBtn}>
                  {item.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => startEdit(item)} style={styles.smallBtn}>Edit</button>
                <button onClick={() => handleDelete(item)} style={{ ...styles.smallBtn, color: '#dc2626' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = {
  section: {
    background: 'white',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    border: '1px solid #e2e8f0',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    margin: 0,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#64748b',
    margin: '4px 0 16px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginBottom: 20,
    paddingBottom: 20,
    borderBottom: '1px solid #f1f5f9',
  },
  input: {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
  },
  formRow: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  select: {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    background: 'white',
    fontFamily: 'inherit',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 13.5,
    color: '#334155',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
  },
  submitBtn: {
    padding: '10px 20px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(135deg, #0d9488, #0f766e)',
    color: 'white',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
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
  error: {
    padding: '10px 14px',
    background: '#fef2f2',
    color: '#dc2626',
    borderRadius: 10,
    fontSize: 13.5,
  },
  hint: {
    fontSize: 13.5,
    color: '#94a3b8',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  item: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '12px 16px',
  },
  itemTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  badge: {
    fontSize: 11,
    fontWeight: 700,
    color: '#0f766e',
    background: '#f0fdfa',
    padding: '2px 8px',
    borderRadius: 20,
    textTransform: 'uppercase',
  },
  itemTitle: {
    fontSize: 14.5,
    fontWeight: 700,
    color: '#0f172a',
  },
  itemMessage: {
    fontSize: 13.5,
    color: '#334155',
  },
  itemMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
  },
  itemActions: {
    display: 'flex',
    gap: 8,
    marginTop: 10,
  },
  smallBtn: {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: 'white',
    color: '#475569',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  },
}

export default PlatformAnnouncementsAdmin
