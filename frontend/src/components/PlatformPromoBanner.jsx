import React, { useState, useEffect } from 'react'

// Shows active LoyaltyTree -> business-owner promos/announcements (created
// from the admin dashboard) at the top of the owner's dashboard. Separate
// from <Announcements /> which is the owner's own announcements to their
// customers - this is the platform talking to the owner.
function PlatformPromoBanner({ API_BASE, businessSlug }) {
  const [promos, setPromos] = useState([])
  const [dismissing, setDismissing] = useState(null)

  useEffect(() => {
    if (!businessSlug) return
    fetch(`${API_BASE}/api/v1/business/${businessSlug}/platform-announcements`)
      .then(r => r.json())
      .then(data => setPromos(Array.isArray(data) ? data : []))
      .catch(() => {}) // best-effort - dashboard still works if this fails
  }, [API_BASE, businessSlug])

  const dismiss = async (id) => {
    setDismissing(id)
    setPromos(prev => prev.filter(p => p.id !== id)) // optimistic - feels instant
    try {
      await fetch(`${API_BASE}/api/v1/business/${businessSlug}/platform-announcements/${id}/dismiss`, {
        method: 'POST',
      })
    } catch (err) {
      // best-effort - worst case it reappears next visit, not worth blocking the UI over
    }
    setDismissing(null)
  }

  if (promos.length === 0) return null

  return (
    <div style={styles.stack}>
      {promos.map(promo => (
        <div key={promo.id} style={styles.banner}>
          <span style={styles.icon}>📣</span>
          <div style={styles.textCol}>
            <div style={styles.title}>{promo.title}</div>
            <div style={styles.message}>{promo.message}</div>
          </div>
          <button
            onClick={() => dismiss(promo.id)}
            disabled={dismissing === promo.id}
            style={styles.dismissBtn}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

const styles = {
  stack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '16px 24px 0',
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    background: 'linear-gradient(135deg, #f0fdfa, #ecfeff)',
    border: '1.5px solid #0d9488',
    borderRadius: 14,
    padding: '14px 18px',
  },
  icon: {
    fontSize: 22,
  },
  textCol: {
    flex: 1,
  },
  title: {
    fontSize: 14.5,
    fontWeight: 700,
    color: '#0f172a',
  },
  message: {
    fontSize: 13.5,
    color: '#334155',
    marginTop: 2,
  },
  dismissBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: 'none',
    background: 'rgba(15,23,42,0.06)',
    color: '#64748b',
    fontSize: 14,
    cursor: 'pointer',
    flexShrink: 0,
  },
}

export default PlatformPromoBanner
