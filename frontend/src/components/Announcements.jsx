import React, { useState, useEffect } from 'react'

function Announcements({ API_BASE, businessSlug, onClose }) {
  const [announcements, setAnnouncements] = useState([])
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({
    title: '',
    message: '',
    type: 'info',
    is_active: true,
    end_date: '',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState(null)
  const [notifyingId, setNotifyingId] = useState(null)
  const [planInfo, setPlanInfo] = useState(null)

  useEffect(() => {
    fetchAnnouncements()
    fetchPlanInfo()
  }, [])

  const fetchPlanInfo = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/plan`)
      if (res.ok) {
        setPlanInfo(await res.json())
      }
    } catch (err) {
      console.error(err)
    }
  }

  const fetchAnnouncements = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/announcements`)
      if (res.ok) {
        const data = await res.json()
        setAnnouncements(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setBanner(null)
    try {
      const url = editing
        ? `${API_BASE}/api/v1/business/${businessSlug}/announcements/${editing}`
        : `${API_BASE}/api/v1/business/${businessSlug}/announcements`

      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })

      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (!editing) {
          if (data._push_sent) {
            setBanner({ type: 'success', text: '📣 Posted and pushed to everyone who saved their card.' })
          } else if (data._push_error) {
            setBanner({ type: 'warn', text: `Posted, but not pushed: ${data._push_error}` })
          }
        }
        setForm({ title: '', message: '', type: 'info', is_active: true, end_date: '' })
        setEditing(null)
        fetchAnnouncements()
        if (!editing) fetchPlanInfo()
      } else {
        const errData = await res.json().catch(() => ({}))
        setBanner({ type: 'warn', text: errData.detail || 'Could not save announcement.' })
      }
    } catch (err) {
      console.error(err)
    }
    setSaving(false)
  }

  const handleEdit = (ann) => {
    setEditing(ann.id)
    setForm({
      title: ann.title,
      message: ann.message,
      type: ann.type || 'info',
      is_active: ann.is_active !== false,
      end_date: ann.end_date ? ann.end_date.split('T')[0] : '',
    })
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this announcement?')) return
    try {
      await fetch(`${API_BASE}/api/v1/business/${businessSlug}/announcements/${id}`, {
        method: 'DELETE'
      })
      fetchAnnouncements()
    } catch (err) {
      console.error(err)
    }
  }

  const handleNotify = async (id) => {
    setNotifyingId(id)
    setBanner(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessSlug}/announcements/${id}/notify`, {
        method: 'POST'
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setBanner({ type: 'success', text: '📣 Sent to everyone who saved their card.' })
        fetchAnnouncements()
      } else {
        setBanner({ type: 'warn', text: data.detail || 'Could not send notification.' })
      }
    } catch (err) {
      console.error(err)
      setBanner({ type: 'warn', text: 'Network error sending notification.' })
    }
    setNotifyingId(null)
  }

  const handleNew = () => {
    setEditing(null)
    setForm({ title: '', message: '', type: 'info', is_active: true, end_date: '' })
  }

  const typeColors = {
    info: { bg: '#dbeafe', text: '#1e40af', icon: 'ℹ️' },
    promo: { bg: '#fce7f3', text: '#be185d', icon: '🏷️' },
    event: { bg: '#d1fae5', text: '#065f46', icon: '📅' },
    alert: { bg: '#fee2e2', text: '#991b1b', icon: '⚠️' },
  }

  const announcementsUsed = planInfo
    ? (planInfo.usage.announcements_used_this_cycle ?? planInfo.usage.announcements_used_this_month ?? 0)
    : 0
  const quotaReached = !!(planInfo && planInfo.usage.announcements_limit !== null &&
    announcementsUsed >= planInfo.usage.announcements_limit)

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>📢 Announcements</h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.body}>
          {banner && (
            <div style={{
              ...styles.banner,
              background: banner.type === 'success' ? '#f0fdf4' : '#fffbeb',
              color: banner.type === 'success' ? '#166534' : '#92400e',
              border: `1px solid ${banner.type === 'success' ? '#bbf7d0' : '#fde68a'}`,
            }}>
              {banner.text}
            </div>
          )}
          {planInfo && (
            <div style={styles.quotaNote}>
              <strong>{planInfo.plan_label} plan:</strong>{' '}
              {planInfo.usage.announcements_limit === null
                ? 'unlimited announcements this subscription cycle'
                : (() => {
                    const left = Math.max(planInfo.usage.announcements_limit - announcementsUsed, 0)
                    return `${left} of ${planInfo.usage.announcements_limit} announcements left this subscription cycle`
                  })()}
              {planInfo.usage.announcements_limit !== null &&
                announcementsUsed >= planInfo.usage.announcements_limit && (
                  <span style={styles.quotaUpgrade}> · upgrade your plan for more</span>
                )}
              <div style={{marginTop:4,fontSize:12,opacity:0.78}}>Allowance resets after your next successful subscription payment.</div>
            </div>
          )}
          {/* Editor */}
          <div style={styles.editor}>
            <h3 style={styles.editorTitle}>{editing ? 'Edit Announcement' : 'New Announcement'}</h3>
            <form onSubmit={handleSubmit}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Title</label>
                <input
                  value={form.title}
                  onChange={e => setForm({...form, title: e.target.value})}
                  style={styles.input}
                  placeholder="e.g. Summer Special, New Service Launch"
                  required
                />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Message</label>
                <textarea
                  value={form.message}
                  onChange={e => setForm({...form, message: e.target.value})}
                  style={styles.textarea}
                  placeholder="What do you want to tell your customers?"
                  rows={4}
                  required
                />
              </div>
              <div style={styles.row}>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Type</label>
                  <select
                    value={form.type}
                    onChange={e => setForm({...form, type: e.target.value})}
                    style={styles.select}
                  >
                    <option value="info">ℹ️ Info</option>
                    <option value="promo">🏷️ Promotion</option>
                    <option value="event">📅 Event</option>
                    <option value="alert">⚠️ Alert</option>
                  </select>
                </div>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>End Date (optional)</label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={e => setForm({...form, end_date: e.target.value})}
                    style={styles.input}
                  />
                </div>
              </div>
              <div style={styles.formFooter}>
                {editing && (
                  <button type="button" onClick={handleNew} style={styles.newBtn}>
                    + New
                  </button>
                )}
                <button type="submit" disabled={saving || (!editing && quotaReached)} style={styles.saveBtn}>
                  {saving ? 'Saving...' : quotaReached && !editing ? 'Cycle limit reached' : (editing ? 'Update' : 'Post Announcement')}
                </button>
              </div>
            </form>
          </div>

          {/* List */}
          <div style={styles.listSection}>
            <h3 style={styles.listTitle}>Published ({announcements.length})</h3>
            {loading ? (
              <div style={styles.empty}>Loading...</div>
            ) : announcements.length === 0 ? (
              <div style={styles.empty}>No announcements yet. Create your first one above!</div>
            ) : (
              <div style={styles.list}>
                {announcements.map(ann => {
                  const style = typeColors[ann.type] || typeColors.info
                  return (
                    <div key={ann.id} style={styles.annCard}>
                      <div style={{...styles.annBadge, background: style.bg, color: style.text}}>
                        {style.icon} {ann.type}
                      </div>
                      <h4 style={styles.annTitle}>{ann.title}</h4>
                      <p style={styles.annMessage}>{ann.message}</p>
                      <div style={styles.annMeta}>
                        <span style={styles.annDate}>
                          {new Date(ann.created_at).toLocaleDateString()}
                          {ann.end_date && ` → ${new Date(ann.end_date).toLocaleDateString()}`}
                          {ann.notified_at && (
                            <span style={styles.sentTag}> · 🔔 sent {new Date(ann.notified_at).toLocaleDateString()}</span>
                          )}
                        </span>
                        <div style={styles.annActions}>
                          <button
                            onClick={() => handleNotify(ann.id)}
                            disabled={notifyingId === ann.id}
                            style={styles.actionBtn}
                          >
                            {notifyingId === ann.id ? 'Sending...' : (ann.notified_at ? '🔔 Resend' : '🔔 Notify')}
                          </button>
                          <button onClick={() => handleEdit(ann)} style={styles.actionBtn}>✏️ Edit</button>
                          <button onClick={() => handleDelete(ann.id)} style={styles.actionBtn}>🗑️</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
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
    maxWidth: 720,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
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
    fontSize: 20,
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
    flex: 1,
    overflowY: 'auto',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },
  banner: {
    padding: '12px 16px',
    borderRadius: 12,
    fontSize: 13,
    fontWeight: 500,
    lineHeight: 1.5,
  },
  quotaNote: {
    padding: '10px 16px',
    borderRadius: 12,
    fontSize: 13,
    color: '#0f766e',
    background: '#f0fdf4',
    border: '1px solid #a7f3d0',
  },
  quotaUpgrade: {
    color: '#0d9488',
    fontWeight: 600,
  },
  sentTag: {
    color: '#0d9488',
    fontWeight: 600,
  },
  editor: {
    background: '#f8fafc',
    borderRadius: 16,
    padding: 20,
  },
  editorTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    margin: '0 0 16px',
  },
  inputGroup: {
    marginBottom: 14,
    flex: 1,
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  },
  textarea: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  select: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: 10,
    border: '1.5px solid #e2e8f0',
    fontSize: 14,
    outline: 'none',
    background: 'white',
    fontFamily: 'inherit',
  },
  row: {
    display: 'flex',
    gap: 12,
  },
  formFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  newBtn: {
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
  listSection: {
    flex: 1,
  },
  listTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    margin: '0 0 16px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  annCard: {
    background: 'white',
    border: '1px solid #e2e8f0',
    borderRadius: 14,
    padding: 16,
    transition: 'box-shadow 0.2s',
  },
  annBadge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 10,
  },
  annTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 6px',
  },
  annMessage: {
    fontSize: 14,
    color: '#475569',
    margin: '0 0 12px',
    lineHeight: 1.5,
  },
  annMeta: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  annDate: {
    fontSize: 12,
    color: '#94a3b8',
  },
  annActions: {
    display: 'flex',
    gap: 8,
  },
  actionBtn: {
    padding: '6px 12px',
    borderRadius: 8,
    border: 'none',
    background: '#f1f5f9',
    color: '#475569',
    fontSize: 12,
    cursor: 'pointer',
  },
  empty: {
    textAlign: 'center',
    padding: 40,
    color: '#94a3b8',
    fontSize: 14,
  },
}

export default Announcements
