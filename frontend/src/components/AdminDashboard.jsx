import React, { useState, useEffect } from 'react'
import PlatformAnnouncementsAdmin from './PlatformAnnouncementsAdmin'

const STATUS_OPTIONS = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']

function AdminDashboard({ API_BASE, user, onLogout }) {
  const token = user?.token

  const [overview, setOverview] = useState(null)
  const [plans, setPlans] = useState({})
  const [businesses, setBusinesses] = useState([])
  const [pendingApps, setPendingApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [sortByAddress, setSortByAddress] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [message, setMessage] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const authedFetch = (path, opts = {}) => fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      'Authorization': `Bearer ${token}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })

  const loadData = async () => {
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (planFilter) params.set('plan', planFilter)

      const [ovRes, plansRes, bizRes, pendingRes] = await Promise.all([
        authedFetch('/api/v1/admin/overview'),
        authedFetch('/api/v1/admin/plans'),
        authedFetch(`/api/v1/admin/businesses?${params.toString()}`),
        authedFetch('/api/v1/admin/businesses?status=PENDING'),
      ])
      if (ovRes.status === 401 || bizRes.status === 401) { onLogout(); return }
      setOverview(await ovRes.json().catch(() => null))
      setPlans(await plansRes.json().catch(() => ({})))
      setBusinesses(await bizRes.json().catch(() => []))
      setPendingApps(await pendingRes.json().catch(() => []))
    } catch (err) {
      console.error('Admin load error:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!token) return
    setLoading(true)
    loadData()
  }, [token, statusFilter, planFilter])

  // Debounce search so we're not firing a request per keystroke
  useEffect(() => {
    if (!token) return
    const t = setTimeout(loadData, 350)
    return () => clearTimeout(t)
  }, [search])

  const openDetail = async (biz) => {
    setSelected(biz)
    setDetail(null)
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${biz.public_id}`)
      setDetail(await res.json())
    } catch (err) {
      console.error(err)
    }
  }

  const updateBusiness = async (public_id, patch) => {
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${public_id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Update failed')
      setMessage(`Updated ${public_id}`)
      loadData()
      if (selected?.public_id === public_id) openDetail(selected)
    } catch (err) {
      setMessage(err.message)
    }
    setTimeout(() => setMessage(''), 3000)
  }

  const approveApplication = (public_id) => updateBusiness(public_id, { status: 'ACTIVE' })
  const rejectApplication = (public_id) => updateBusiness(public_id, { status: 'REJECTED' })

  const deleteBusiness = async (public_id) => {
    try {
      const res = await authedFetch(`/api/v1/admin/businesses/${public_id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setMessage(`Removed ${public_id}`)
      setConfirmDelete(null)
      setSelected(null)
      setDetail(null)
      loadData()
    } catch (err) {
      setMessage(err.message)
    }
    setTimeout(() => setMessage(''), 3000)
  }

  // ---------- Loading ----------
  if (loading) {
    return <div style={styles.loadingScreen}>Loading platform data…</div>
  }

  const filteredCount = businesses.length
  const displayBusinesses = sortByAddress
    ? [...businesses].sort((a, b) => (a.address || '\uffff').localeCompare(b.address || '\uffff'))
    : businesses

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={{ fontSize: 28 }}>🌳</span>
          <div>
            <h1 style={styles.brandName}>LoyaltyTree Admin</h1>
            <p style={styles.brandTagline}>{overview?.total_businesses ?? 0} businesses on the platform</p>
          </div>
        </div>
        <button onClick={onLogout} style={styles.logoutBtn}>Log out</button>
      </header>

      {message && <div style={styles.toast}>{message}</div>}

      <div style={styles.body}>
        {/* Applications - pending business signups awaiting approval */}
        {pendingApps.length > 0 && (
          <div style={styles.applicationsSection}>
            <h2 style={styles.sectionTitle}>
              Applications <span style={styles.pendingCountBadge}>{pendingApps.length}</span>
            </h2>
            <p style={styles.sectionSubtitle}>New businesses waiting for approval before they can sign in.</p>
            <div style={styles.applicationsList}>
              {pendingApps.map(b => (
                <div key={b.public_id} style={styles.applicationCard}>
                  {b.logo_url && <img src={b.logo_url} alt="" style={styles.bizLogo} />}
                  <div style={styles.applicationInfo}>
                    <div style={styles.bizName}>{b.name}</div>
                    <div style={styles.bizEmail}>{b.email}</div>
                    <div style={styles.bizPhone}>
                      {b.business_type} · {b.created_at ? new Date(b.created_at).toLocaleDateString() : ''}
                    </div>
                  </div>
                  <div style={styles.applicationActions}>
                    <button onClick={() => openDetail(b)} style={styles.viewBtn}>View</button>
                    <button onClick={() => approveApplication(b.public_id)} style={styles.approveBtn}>Approve</button>
                    <button onClick={() => rejectApplication(b.public_id)} style={styles.rejectBtn}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overview cards */}
        <div style={styles.statsGrid}>
          <StatCard label="Total businesses" value={overview?.total_businesses ?? '—'} />
          <StatCard label="Active" value={overview?.status_breakdown?.ACTIVE ?? 0} accent="#0d9488" />
          <StatCard label="Pending" value={overview?.status_breakdown?.PENDING ?? 0} accent="#d97706" />
          <StatCard label="Suspended" value={overview?.status_breakdown?.SUSPENDED ?? 0} accent="#dc2626" />
          <StatCard label="Rejected" value={overview?.status_breakdown?.REJECTED ?? 0} accent="#64748b" />
          <StatCard label="Total customers" value={overview?.total_customers ?? 0} />
          <StatCard label="Stamps (30d)" value={overview?.stamps_30d ?? 0} />
          <StatCard label="Redemptions (30d)" value={overview?.redemptions_30d ?? 0} />
          {overview?.card_type_breakdown?.points > 0 && (
            <>
              <StatCard label="Points businesses" value={overview.card_type_breakdown.points} accent="#7c3aed" />
              <StatCard label="Points sales (30d)" value={overview?.points_sales_30d ?? 0} accent="#7c3aed" />
              <StatCard label="Points issued (30d)" value={(overview?.points_issued_30d ?? 0).toLocaleString()} accent="#7c3aed" />
              <StatCard label="Points outstanding" value={(overview?.total_points_outstanding ?? 0).toLocaleString()} accent="#7c3aed" />
            </>
          )}
          {overview?.card_type_breakdown?.multipass > 0 && (
            <>
              <StatCard label="Multipass businesses" value={overview.card_type_breakdown.multipass} accent="#d97706" />
              <StatCard label="Sessions issued (30d)" value={(overview?.sessions_issued_30d ?? 0).toLocaleString()} accent="#d97706" />
              <StatCard label="Sessions used (30d)" value={(overview?.sessions_used_30d ?? 0).toLocaleString()} accent="#d97706" />
              <StatCard label="Sessions outstanding" value={(overview?.total_sessions_outstanding ?? 0).toLocaleString()} accent="#d97706" />
            </>
          )}
        </div>

        {overview?.plan_breakdown && (
          <div style={styles.planBar}>
            {Object.entries(overview.plan_breakdown).map(([plan, count]) => (
              <span key={plan} style={styles.planPill}>
                {plans[plan]?.label || plan}{plans[plan]?.price_month != null ? ` · ₱${plans[plan].price_month.toLocaleString()}/mo` : ''}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        )}

        <PlatformAnnouncementsAdmin API_BASE={API_BASE} token={token} />

        {/* Filters */}
        <div style={styles.filterRow}>
          <input
            style={{ ...styles.input, maxWidth: 280 }}
            placeholder="Search by name, email, or address…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            onClick={() => setSortByAddress(s => !s)}
            style={{ ...styles.select, cursor: 'pointer', background: sortByAddress ? '#0d9488' : 'white', color: sortByAddress ? 'white' : '#334155' }}
          >
            📍 Sort by location{sortByAddress ? ' ✓' : ''}
          </button>
          <select style={styles.select} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={styles.select} value={planFilter} onChange={e => setPlanFilter(e.target.value)}>
            <option value="">All plans</option>
            {Object.entries(plans).map(([key, p]) => <option key={key} value={key}>{p.label}{p.price_month != null ? ` (₱${p.price_month.toLocaleString()}/mo)` : ''}</option>)}
          </select>
          <span style={styles.resultCount}>{filteredCount} shown</span>
        </div>

        {/* Businesses table */}
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Business</th>
                <th style={styles.th}>Location</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Plan</th>
                <th style={styles.th}>Paid</th>
                <th style={styles.th}>Expires</th>
                <th style={styles.th}>Customers</th>
                <th style={styles.th}>Staff</th>
                <th style={styles.th}>Card</th>
                <th style={styles.th}>Activity (30d)</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {displayBusinesses.map(b => (
                <tr key={b.public_id} style={styles.tr}>
                  <td style={styles.td}>
                    <div onClick={() => openDetail(b)} style={styles.bizCell}>
                      {b.logo_url && <img src={b.logo_url} alt="" style={styles.bizLogo} />}
                      <div>
                        <div style={styles.bizName}>{b.name}</div>
                        <div style={styles.bizEmail}>{b.email}</div>
                        {b.phone && <div style={styles.bizPhone}>{b.phone}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={styles.td}>
                    {b.address ? <span style={styles.bizPhone}>{b.address}</span> : <span style={styles.resultCount}>—</span>}
                  </td>
                  <td style={styles.td}>
                    <select
                      value={b.status}
                      onChange={e => updateBusiness(b.public_id, { status: e.target.value })}
                      style={{ ...styles.statusSelect, ...statusStyle(b.status) }}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}>
                    <select
                      value={b.plan}
                      onChange={e => updateBusiness(b.public_id, { plan: e.target.value })}
                      style={styles.planSelect}
                    >
                      {Object.entries(plans).map(([key, p]) => <option key={key} value={key}>{p.label}{p.price_month != null ? ` (₱${p.price_month.toLocaleString()}/mo)` : ''}</option>)}
                    </select>
                    {b.price_month != null && (
                      <div style={styles.rowPriceHint}>₱{b.price_month.toLocaleString()}/mo · {b.branch_count} branch{b.branch_count !== 1 ? 'es' : ''}</div>
                    )}
                  </td>
                  <td style={styles.td}>{b.last_paid_at ? new Date(b.last_paid_at).toLocaleDateString() : '—'}</td>
                  <td style={styles.td}>
                    {b.subscription_expires_at ? (
                      <span style={{ fontWeight: 600, ...subscriptionStatusStyle(b.subscription_status) }}>
                        {new Date(b.subscription_expires_at).toLocaleDateString()}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={styles.td}>{b.customer_count}</td>
                  <td style={styles.td}>{b.staff_count}</td>
                  <td style={styles.td}>
                    <span style={cardTypeBadgeStyle(b.card_type)}>
                      {b.card_type === 'points' ? '⭐ Points' : b.card_type === 'multipass' ? '🎫 Multipass' : '🎟️ Stamp'}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {b.stamps_30d}
                    <div style={styles.rowPriceHint}>
                      {b.card_type === 'points' ? 'points sales' : b.card_type === 'multipass' ? 'sessions used' : 'stamps'}
                      {b.card_type === 'points' && b.points_balance_outstanding != null && (
                        <> · {b.points_balance_outstanding.toLocaleString()} pts outstanding</>
                      )}
                      {b.card_type === 'multipass' && b.sessions_outstanding != null && (
                        <> · {b.sessions_outstanding.toLocaleString()} sessions outstanding</>
                      )}
                    </div>
                  </td>
                  <td style={styles.td}>
                    <button onClick={() => openDetail(b)} style={styles.viewBtn}>View</button>
                    <button onClick={() => setConfirmDelete(b)} style={styles.deleteBtn}>Remove</button>
                  </td>
                </tr>
              ))}
              {displayBusinesses.length === 0 && (
                <tr><td style={styles.td} colSpan={11}>No businesses match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (
        <div style={styles.modalOverlay} onClick={() => { setSelected(null); setDetail(null) }}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>{detail?.name || selected.name}</h2>
            {!detail ? (
              <p>Loading…</p>
            ) : (
              <div style={styles.detailGrid}>
                <DetailRow label="Public ID" value={detail.public_id} />
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Name</span>
                  <input
                    type="text"
                    defaultValue={detail.name || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.name || '') && e.target.value.trim()) {
                        updateBusiness(selected.public_id, { name: e.target.value })
                      }
                    }}
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Email</span>
                  <input
                    type="email"
                    defaultValue={detail.email || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.email || '') && e.target.value.trim()) {
                        updateBusiness(selected.public_id, { email: e.target.value })
                      }
                    }}
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Phone</span>
                  <input
                    type="text"
                    defaultValue={detail.phone || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.phone || '')) {
                        updateBusiness(selected.public_id, { phone: e.target.value })
                      }
                    }}
                    placeholder="No phone on file"
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Business type</span>
                  <select
                    value={detail.business_type || 'other'}
                    onChange={e => updateBusiness(selected.public_id, { business_type: e.target.value })}
                    style={styles.dateInput}
                  >
                    <option value="spa">Spa</option>
                    <option value="salon">Salon</option>
                    <option value="fitness">Fitness</option>
                    <option value="restaurant">Restaurant</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Logo URL</span>
                  <input
                    type="text"
                    defaultValue={detail.logo_url || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.logo_url || '')) {
                        updateBusiness(selected.public_id, { logo_url: e.target.value })
                      }
                    }}
                    placeholder="No logo on file"
                    style={styles.addressInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Address</span>
                  <input
                    type="text"
                    defaultValue={detail.address || ''}
                    onBlur={e => {
                      if (e.target.value !== (detail.address || '')) {
                        updateBusiness(selected.public_id, { address: e.target.value })
                      }
                    }}
                    placeholder="No address on file"
                    style={styles.addressInput}
                  />
                </div>
                <DetailRow label="Status" value={detail.status} />
                <DetailRow label="Plan" value={detail.plan_label} />
                <DetailRow label="Branches" value={detail.branch_count} />
                <DetailRow label="Price" value={detail.price_month != null ? `₱${detail.price_month.toLocaleString()}/mo` : '—'} />
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>
                    Announcements/mo
                    {detail.plan_features?.announcements_per_month != null && (
                      <span style={styles.announcementBase}> (plan base: {detail.plan_features.announcements_per_month})</span>
                    )}
                  </span>
                  {detail.plan_features?.announcements_per_month == null ? (
                    <span style={styles.detailValue}>Unlimited</span>
                  ) : (
                    <div style={styles.announcementAdjustRow}>
                      <button
                        type="button"
                        onClick={() => updateBusiness(selected.public_id, { announcement_limit_adjustment: (detail.announcement_limit_adjustment || 0) - 1 })}
                        style={styles.stepBtn}
                      >
                        −
                      </button>
                      <span style={styles.announcementAdjustValue}>
                        {detail.announcements_per_month_effective}
                        {detail.announcement_limit_adjustment ? (
                          <span style={styles.announcementBase}>
                            {' '}({detail.announcement_limit_adjustment > 0 ? '+' : ''}{detail.announcement_limit_adjustment} admin)
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateBusiness(selected.public_id, { announcement_limit_adjustment: (detail.announcement_limit_adjustment || 0) + 1 })}
                        disabled={detail.announcements_per_month_effective >= 99}
                        style={{ ...styles.stepBtn, ...(detail.announcements_per_month_effective >= 99 ? styles.stepBtnDisabled : {}) }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Last paid</span>
                  <input
                    type="date"
                    value={detail.last_paid_at ? detail.last_paid_at.slice(0, 10) : ''}
                    onChange={e => updateBusiness(selected.public_id, { last_paid_at: e.target.value })}
                    style={styles.dateInput}
                  />
                </div>
                <div style={styles.detailRow}>
                  <span style={styles.detailLabel}>Subscription expires</span>
                  <input
                    type="date"
                    value={detail.subscription_expires_at ? detail.subscription_expires_at.slice(0, 10) : ''}
                    onChange={e => updateBusiness(selected.public_id, { subscription_expires_at: e.target.value })}
                    style={styles.dateInput}
                  />
                </div>
                {detail.subscription_expires_at && (
                  <DetailRow
                    label="Subscription status"
                    value={<span style={subscriptionStatusStyle(detail.subscription_status)}>{subscriptionStatusLabel(detail.subscription_status)}</span>}
                  />
                )}
                <DetailRow label="Customers" value={detail.customer_count} />
                <DetailRow label="Staff" value={detail.staff_count} />
                <DetailRow label="Card type" value={detail.card_type === 'points' ? '⭐ Points' : detail.card_type === 'multipass' ? '🎫 Multipass' : '🎟️ Stamp'} />
                {detail.card_type === 'points' ? (
                  <>
                    <DetailRow label="Points sales (30d)" value={detail.stamps_30d} />
                    <DetailRow label="Points issued (30d)" value={(detail.points_issued_30d ?? 0).toLocaleString()} />
                    <DetailRow label="Points outstanding" value={(detail.points_balance_outstanding ?? 0).toLocaleString()} />
                  </>
                ) : detail.card_type === 'multipass' ? (
                  <>
                    <DetailRow label="Sessions issued (30d)" value={(detail.sessions_issued_30d ?? 0).toLocaleString()} />
                    <DetailRow label="Sessions used (30d)" value={(detail.sessions_used_30d ?? 0).toLocaleString()} />
                    <DetailRow label="Sessions outstanding" value={(detail.sessions_outstanding ?? 0).toLocaleString()} />
                  </>
                ) : (
                  <DetailRow label="Stamps (30d)" value={detail.stamps_30d} />
                )}
                <DetailRow label="Redemptions (30d)" value={detail.redemptions_30d} />
                <DetailRow label="Created" value={detail.created_at ? new Date(detail.created_at).toLocaleDateString() : '—'} />
                {detail.loyalty_program && detail.card_type === 'points' ? (
                  <>
                    <DetailRow label="Points rate" value={`${detail.loyalty_program.points_per_amount ?? 0} pts per ₱${detail.loyalty_program.points_amount_pesos ?? 0}`} />
                    {(detail.loyalty_program.points_prizes || []).length > 0 && (
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Prize catalog</span>
                        <div style={{ textAlign: 'right' }}>
                          {detail.loyalty_program.points_prizes.map((p, i) => (
                            <div key={p.id || i} style={styles.detailValue}>
                              {p.name} — {p.points_cost} pts
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : detail.loyalty_program && detail.card_type === 'multipass' ? (
                  <>
                    <DetailRow label="Sessions per pass" value={detail.loyalty_program.multipass_session_count} />
                    <DetailRow label="Pass validity" value={`${detail.loyalty_program.multipass_validity_days ?? 0} days`} />
                    {detail.loyalty_program.description && (
                      <DetailRow label="What sessions are for" value={detail.loyalty_program.description} />
                    )}
                  </>
                ) : detail.loyalty_program && (
                  <>
                    <DetailRow label="Reward" value={detail.loyalty_program.reward_name} />
                    <DetailRow label="Stamp goal" value={detail.loyalty_program.stamp_goal} />
                  </>
                )}
              </div>
            )}
            <button onClick={() => { setSelected(null); setDetail(null) }} style={styles.closeBtn}>Close</button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div style={styles.modalOverlay} onClick={() => setConfirmDelete(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Remove {confirmDelete.name}?</h2>
            <p style={{ color: '#64748b', fontSize: 14 }}>
              This permanently deletes the business along with its customers, staff, announcements, and stamp/redemption history. This can't be undone.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button onClick={() => deleteBusiness(confirmDelete.public_id)} style={styles.confirmDeleteBtn}>
                Yes, delete permanently
              </button>
              <button onClick={() => setConfirmDelete(null)} style={styles.closeBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, accent }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color: accent || '#0f172a' }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div style={styles.detailRow}>
      <span style={styles.detailLabel}>{label}</span>
      <span style={styles.detailValue}>{value}</span>
    </div>
  )
}

function statusStyle(status) {
  if (status === 'ACTIVE') return { background: '#dcfce7', color: '#166534' }
  if (status === 'SUSPENDED') return { background: '#fee2e2', color: '#991b1b' }
  if (status === 'REJECTED') return { background: '#f1f5f9', color: '#475569' }
  return { background: '#fef3c7', color: '#92400e' }
}

function cardTypeBadgeStyle(cardType) {
  const base = {
    display: 'inline-block', padding: '3px 9px', borderRadius: 20,
    fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
  }
  if (cardType === 'points') return { ...base, background: '#ede9fe', color: '#6d28d9' }
  if (cardType === 'multipass') return { ...base, background: '#fef3c7', color: '#92400e' }
  return { ...base, background: '#f1f5f9', color: '#475569' }
}

function subscriptionStatusStyle(status) {
  if (status === 'expired') return { color: '#dc2626' }
  if (status === 'expiring_soon') return { color: '#d97706' }
  if (status === 'active') return { color: '#0d9488' }
  return { color: '#94a3b8' }
}

function subscriptionStatusLabel(status) {
  if (status === 'expired') return 'Expired'
  if (status === 'expiring_soon') return 'Expiring soon'
  if (status === 'active') return 'Active'
  return 'No expiry set'
}

const styles = {
  loginContainer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  loginCard: {
    background: 'white',
    borderRadius: 16,
    padding: 40,
    width: 360,
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
  },
  loginBrand: { textAlign: 'center', marginBottom: 24 },
  loginTitle: { margin: '8px 0 4px', fontSize: 22, fontWeight: 700, color: '#0f172a' },
  loginSubtitle: { margin: 0, fontSize: 13, color: '#64748b' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: 12 },
  loginBtn: {
    padding: '12px', background: '#0f172a', color: 'white', border: 'none',
    borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 8,
  },
  errorText: { color: '#dc2626', fontSize: 13, margin: 0 },
  loadingScreen: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#64748b', fontSize: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  container: {
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 24px', background: '#0f172a', color: 'white',
    position: 'sticky', top: 0, zIndex: 100,
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  brandName: { margin: 0, fontSize: 18, fontWeight: 700, color: 'white' },
  brandTagline: { margin: 0, fontSize: 12, color: '#94a3b8' },
  logoutBtn: {
    padding: '8px 16px', background: 'transparent', color: '#cbd5e1',
    border: '1px solid #334155', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  toast: {
    position: 'fixed', top: 80, right: 24, padding: '12px 20px', background: '#0d9488',
    color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 200,
  },
  body: { padding: '24px', maxWidth: 1200, margin: '0 auto' },
  applicationsSection: {
    background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14,
    padding: '18px 20px', marginBottom: 20,
  },
  sectionTitle: {
    margin: 0, fontSize: 16, fontWeight: 700, color: '#92400e',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  pendingCountBadge: {
    background: '#f59e0b', color: 'white', borderRadius: 999,
    fontSize: 12, fontWeight: 700, padding: '2px 9px',
  },
  sectionSubtitle: { margin: '4px 0 14px', fontSize: 13, color: '#b45309' },
  applicationsList: { display: 'flex', flexDirection: 'column', gap: 10 },
  applicationCard: {
    display: 'flex', alignItems: 'center', gap: 12, background: 'white',
    border: '1px solid #fde68a', borderRadius: 10, padding: '10px 14px',
    flexWrap: 'wrap',
  },
  applicationInfo: { flex: 1, minWidth: 180 },
  applicationActions: { display: 'flex', gap: 8, flexShrink: 0 },
  approveBtn: {
    padding: '6px 14px', background: '#0d9488', color: 'white',
    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  rejectBtn: {
    padding: '6px 14px', background: 'transparent', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  statsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 12, marginBottom: 16,
  },
  statCard: {
    background: 'white', borderRadius: 12, padding: '16px 18px',
    border: '1px solid #e2e8f0',
  },
  statValue: { fontSize: 24, fontWeight: 700 },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  planBar: { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  planPill: {
    padding: '6px 12px', background: '#ccfbf1', color: '#0f766e',
    borderRadius: 20, fontSize: 12, fontWeight: 600,
  },
  filterRow: { display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' },
  resultCount: { fontSize: 12, color: '#94a3b8', marginLeft: 'auto' },
  input: {
    padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
  },
  select: {
    padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 13, background: 'white', cursor: 'pointer',
  },
  tableWrap: { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left', padding: '12px 16px', fontSize: 12, fontWeight: 600,
    color: '#64748b', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap',
  },
  tr: { borderBottom: '1px solid #f1f5f9' },
  td: { padding: '12px 16px', fontSize: 13, color: '#0f172a', verticalAlign: 'middle' },
  bizCell: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' },
  bizLogo: { width: 32, height: 32, borderRadius: 8, objectFit: 'cover' },
  bizName: { fontWeight: 600, fontSize: 13 },
  bizEmail: { fontSize: 12, color: '#94a3b8' },
  bizPhone: { fontSize: 12, color: '#94a3b8' },
  statusSelect: {
    padding: '4px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer',
  },
  planSelect: {
    padding: '4px 8px', borderRadius: 8, fontSize: 12, border: '1px solid #e2e8f0',
    background: '#f8fafc', cursor: 'pointer',
  },
  rowPriceHint: {
    fontSize: 11, color: '#94a3b8', marginTop: 4,
  },
  viewBtn: {
    padding: '6px 10px', background: 'transparent', color: '#0d9488',
    border: '1px solid #a7f3d0', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginRight: 6,
  },
  deleteBtn: {
    padding: '6px 10px', background: 'transparent', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 16,
  },
  modal: {
    background: 'white', borderRadius: 16, padding: 28, width: 440,
    maxHeight: '85vh', overflow: 'auto',
  },
  modalTitle: { margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#0f172a' },
  detailGrid: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 },
  detailRow: {
    display: 'flex', justifyContent: 'space-between', fontSize: 13,
    padding: '6px 0', borderBottom: '1px solid #f1f5f9',
  },
  detailLabel: { color: '#64748b' },
  detailValue: { color: '#0f172a', fontWeight: 600 },
  dateInput: {
    padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 12, color: '#0f172a', cursor: 'pointer',
  },
  addressInput: {
    padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 12, color: '#0f172a', width: 200, textAlign: 'right',
  },
  announcementAdjustRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  announcementAdjustValue: {
    color: '#0f172a', fontWeight: 600, fontSize: 13, minWidth: 20, textAlign: 'center',
  },
  announcementBase: {
    color: '#94a3b8', fontWeight: 400, fontSize: 11.5,
  },
  stepBtn: {
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, border: '1px solid #e2e8f0', borderRadius: 6, background: 'white',
    color: '#334155', fontSize: 14, fontWeight: 700, cursor: 'pointer', lineHeight: 1,
  },
  stepBtnDisabled: {
    color: '#cbd5e1', cursor: 'not-allowed', background: '#f8fafc',
  },
  closeBtn: {
    padding: '10px 16px', background: '#f1f5f9', color: '#334155',
    border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  confirmDeleteBtn: {
    padding: '10px 16px', background: '#dc2626', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', flex: 1,
  },
}

export default AdminDashboard
