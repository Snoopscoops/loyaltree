import React, { useEffect, useMemo, useState } from 'react'

const AGE_ROWS = [
  ['under_18','Under 18'],
  ['18_24','18–24'],
  ['25_34','25–34'],
  ['35_44','35–44'],
  ['45_54','45–54'],
  ['55_64','55–64'],
  ['65_plus','65+'],
]

const GENDER_ROWS = [
  ['female','Female'],
  ['male','Male'],
  ['lgbtq','LGBTQ+'],
  ['rather_not_say','Prefer not to say'],
]

const RANGE_LABELS = {
  '7d':'Last 7 Days',
  '30d':'Last 30 Days',
  '90d':'Last 90 Days',
  'all':'All Time',
}

function number(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function safeCount(value) {
  if (value === null || value === undefined) return '—'
  return number(value).toLocaleString()
}

function hourLabel(hour) {
  const h = Number(hour)
  if (!Number.isFinite(h)) return '—'
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 || 12
  return `${hour12}:00 ${suffix}`
}

function topVisibleGroup(obj, rows) {
  if (!obj) return null
  let best = null
  for (const [key,label] of rows) {
    const raw = obj?.[key]
    if (raw == null) continue
    const value = number(raw)
    if (!best || value > best.value) best = { key, label, value }
  }
  return best
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0

  async function run() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      try {
        results[index] = await worker(items[index], index)
      } catch (error) {
        results[index] = { error: error?.message || 'Could not load branch analytics' }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run())
  await Promise.all(workers)
  return results
}

export default function InterBranchAnalytics({
  API_BASE,
  user,
  timeRange = '30d',
  branches = [],
}) {
  const [branchAnalytics, setBranchAnalytics] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState('performance')
  const [selectedHour, setSelectedHour] = useState(null)
  const [hourMetric, setHourMetric] = useState('activity')

  const activeBranches = useMemo(
    () => (Array.isArray(branches) ? branches : []).filter(branch => branch?.public_id && branch?.is_active !== false),
    [branches]
  )

  const loadInterBranch = async () => {
    if (!user?.business_slug || !user?.token || !activeBranches.length) {
      setBranchAnalytics([])
      return
    }

    setLoading(true)
    setError('')

    const base = `${API_BASE}/api/v1/business/${user.business_slug}`
    const rows = await mapWithConcurrency(activeBranches, 6, async branch => {
      const res = await fetch(
        `${base}/analytics?range=${encodeURIComponent(timeRange)}&branch_id=${encodeURIComponent(branch.public_id)}`,
        { headers: { Authorization: `Bearer ${user.token}` }, cache: 'no-store' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `Could not load ${branch.name || 'branch'}`)
      return {
        branch,
        data,
      }
    })

    const good = []
    const failed = []
    rows.forEach((row, index) => {
      if (row?.data) good.push(row)
      else failed.push(activeBranches[index]?.name || 'Branch')
    })

    setBranchAnalytics(good)
    if (failed.length) {
      setError(`${failed.length} branch${failed.length === 1 ? '' : 'es'} could not be loaded: ${failed.slice(0,4).join(', ')}${failed.length > 4 ? '…' : ''}`)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadInterBranch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.business_slug, user?.token, timeRange, activeBranches.map(b => b.public_id).join('|')])

  const rows = useMemo(() => branchAnalytics.map(({ branch, data }) => {
    const overview = data?.overview || {}
    const customers = data?.customers || {}
    const demographics = data?.demographics || {}
    const time = data?.time_analytics || {}
    const hours = Array.isArray(time?.hours) ? time.hours : []
    const peak = [...hours].sort((a,b) => number(b.activity_count) - number(a.activity_count))[0] || null
    const topAge = topVisibleGroup(demographics?.age, AGE_ROWS)
    const topGender = topVisibleGroup(demographics?.gender, GENDER_ROWS)

    return {
      branch,
      data,
      overview,
      customers,
      demographics,
      time,
      hours,
      peak,
      topAge,
      topGender,
      activity: number(overview.total_stamps),
      rewards: number(overview.total_rewards),
      activeMembers: number(overview.active_members),
      newCustomers: number(overview.new_customers),
      retention: number(customers.retention_rate),
      trackedSales: data?.revenue?.tracked ? number(data?.revenue?.stamp_revenue) : null,
    }
  }), [branchAnalytics])

  const allHours = useMemo(() => Array.from({ length: 24 }, (_, hour) => {
    const branchesAtHour = rows.map(row => {
      const h = row.hours.find(item => Number(item.hour) === hour) || {}
      return {
        branch: row.branch,
        activity: number(h.activity_count),
        customers: number(h.unique_customers),
        rewards: number(h.reward_count),
        sales: row.time?.sales_tracked ? number(h.sales_count) : null,
        salesAmount: row.time?.sales_tracked ? number(h.sales_amount) : null,
      }
    })

    return {
      hour,
      label: hourLabel(hour),
      branches: branchesAtHour,
      totalActivity: branchesAtHour.reduce((sum, x) => sum + x.activity, 0),
      totalCustomers: branchesAtHour.reduce((sum, x) => sum + x.customers, 0),
      totalRewards: branchesAtHour.reduce((sum, x) => sum + x.rewards, 0),
      totalSales: branchesAtHour.reduce((sum, x) => sum + number(x.sales), 0),
    }
  }), [rows])

  const busiestHour = [...allHours].sort((a,b) => b.totalActivity - a.totalActivity)[0] || null
  const effectiveHour = selectedHour == null ? busiestHour?.hour ?? 0 : selectedHour
  const selectedHourRow = allHours.find(row => row.hour === effectiveHour) || allHours[0]

  const selectedHourBranchRows = useMemo(() => rows.map(row => {
    const hour = row.hours.find(item => Number(item.hour) === Number(effectiveHour)) || {}
    const bucketHours = Math.max(1, number(row.time?.demographic_windows?.bucket_hours) || 2)
    const startHour = Math.floor(Number(effectiveHour) / bucketHours) * bucketHours
    const demographicWindow = (row.time?.demographic_windows?.hours || [])
      .find(item => Number(item.start_hour) === Number(startHour)) || null

    return {
      ...row,
      hourData: hour,
      demographicWindow,
      bucketHours,
      startHour,
    }
  }), [rows, effectiveHour])

  const bestRetention = [...rows].sort((a,b) => b.retention - a.retention)[0] || null
  const busiestBranch = [...rows].sort((a,b) => b.activity - a.activity)[0] || null
  const mostNew = [...rows].sort((a,b) => b.newCustomers - a.newCustomers)[0] || null

  const metricAtHour = (branchHour) => {
    if (hourMetric === 'customers') return branchHour.customers
    if (hourMetric === 'rewards') return branchHour.rewards
    if (hourMetric === 'sales') return branchHour.sales
    return branchHour.activity
  }

  const salesAvailable = rows.some(row => row.time?.sales_tracked)

  return (
    <section style={styles.wrap}>
      <div style={styles.hero}>
        <div>
          <div style={styles.eyebrow}>INTER-BRANCH ANALYSIS</div>
          <h2 style={styles.title}>Compare branches side-by-side</h2>
          <p style={styles.subtitle}>
            Performance, retention, demographics, and hourly activity for {RANGE_LABELS[timeRange] || timeRange}.
            Demographics stay aggregate-only and follow the privacy suppression already enforced by LoyaltyTree.
          </p>
        </div>
        <button type="button" onClick={loadInterBranch} disabled={loading} style={styles.refreshBtn}>
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>

      {!!error && <div style={styles.warning}>{error}</div>}

      {!activeBranches.length ? (
        <div style={styles.empty}>Create active branches first to use Inter-Branch Analysis.</div>
      ) : loading && !rows.length ? (
        <div style={styles.empty}>Loading {activeBranches.length} branch{activeBranches.length === 1 ? '' : 'es'}…</div>
      ) : (
        <>
          <div style={styles.tabs}>
            {[
              ['performance','Performance'],
              ['demographics','Demographics'],
              ['hourly','Hourly'],
            ].map(([key,label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                style={{...styles.tab,...(view === key ? styles.tabActive : {})}}
              >
                {label}
              </button>
            ))}
          </div>

          {view === 'performance' && (
            <>
              <div style={styles.summaryGrid}>
                <SummaryCard
                  label="Highest retention"
                  value={bestRetention ? `${bestRetention.retention}%` : '—'}
                  hint={bestRetention?.branch?.name || 'No data'}
                />
                <SummaryCard
                  label="Most loyalty activity"
                  value={busiestBranch ? busiestBranch.activity.toLocaleString() : '—'}
                  hint={busiestBranch?.branch?.name || 'No data'}
                />
                <SummaryCard
                  label="Most new customers"
                  value={mostNew ? mostNew.newCustomers.toLocaleString() : '—'}
                  hint={mostNew?.branch?.name || 'No data'}
                />
                <SummaryCard
                  label="Branches compared"
                  value={rows.length.toLocaleString()}
                  hint={`${activeBranches.length} active`}
                />
              </div>

              <div style={styles.tableCard}>
                <div style={styles.cardHeader}>
                  <div>
                    <h3 style={styles.cardTitle}>Branch performance</h3>
                    <p style={styles.cardSub}>Loyalty activity is not labeled as total business sales unless tracked purchase value exists.</p>
                  </div>
                </div>
                <div style={styles.tableScroll}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Branch</th>
                        <th style={styles.th}>Active</th>
                        <th style={styles.th}>New</th>
                        <th style={styles.th}>Retention</th>
                        <th style={styles.th}>Activity</th>
                        <th style={styles.th}>Rewards</th>
                        <th style={styles.th}>Peak hour</th>
                        <th style={styles.th}>Largest age group</th>
                        <th style={styles.th}>Largest gender group</th>
                        <th style={styles.th}>Tracked value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.branch.public_id}>
                          <td style={styles.td}>
                            <strong>{row.branch.name || 'Branch'}</strong>
                            {row.branch.address && <small style={styles.sub}>{row.branch.address}</small>}
                          </td>
                          <td style={styles.td}>{row.activeMembers.toLocaleString()}</td>
                          <td style={styles.td}>{row.newCustomers.toLocaleString()}</td>
                          <td style={styles.td}><strong>{row.retention}%</strong></td>
                          <td style={styles.td}>{row.activity.toLocaleString()}</td>
                          <td style={styles.td}>{row.rewards.toLocaleString()}</td>
                          <td style={styles.td}>{row.peak ? `${row.peak.label || hourLabel(row.peak.hour)} · ${number(row.peak.activity_count)}` : '—'}</td>
                          <td style={styles.td}>{row.topAge ? `${row.topAge.label} · ${row.topAge.value}` : 'Suppressed / unavailable'}</td>
                          <td style={styles.td}>{row.topGender ? `${row.topGender.label} · ${row.topGender.value}` : 'Suppressed / unavailable'}</td>
                          <td style={styles.td}>{row.trackedSales == null ? '—' : `₱${row.trackedSales.toLocaleString(undefined,{maximumFractionDigits:2})}`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {view === 'demographics' && (
            <>
              <div style={styles.privacyNote}>
                🔒 <strong>Privacy-safe demographics.</strong> Exact small groups are not reconstructed here. If the branch API suppresses a segment, this comparison keeps it hidden.
              </div>

              <div style={styles.demoGrid}>
                {rows.map(row => {
                  const privacy = row.demographics?.privacy || {}
                  return (
                    <article key={row.branch.public_id} style={styles.demoCard}>
                      <div style={styles.demoHead}>
                        <div>
                          <h3 style={styles.demoTitle}>{row.branch.name || 'Branch'}</h3>
                          <div style={styles.demoSub}>{row.activeMembers} active members · {row.retention}% retention</div>
                        </div>
                        <span style={styles.lockBadge}>Aggregate</span>
                      </div>

                      <div style={styles.demoColumns}>
                        <div>
                          <div style={styles.miniTitle}>Age brackets</div>
                          {!privacy.age_available ? (
                            <div style={styles.smallEmpty}>Not enough age responses.</div>
                          ) : AGE_ROWS.map(([key,label]) => row.demographics?.age?.[key] == null ? null : (
                            <MetricRow key={key} label={label} value={safeCount(row.demographics.age[key])} />
                          ))}
                        </div>
                        <div>
                          <div style={styles.miniTitle}>Gender</div>
                          {!privacy.gender_available ? (
                            <div style={styles.smallEmpty}>Not enough gender responses.</div>
                          ) : GENDER_ROWS.map(([key,label]) => row.demographics?.gender?.[key] == null ? null : (
                            <MetricRow key={key} label={label} value={safeCount(row.demographics.gender[key])} />
                          ))}
                        </div>
                      </div>

                      {(privacy.age_suppressed || privacy.gender_suppressed) && (
                        <div style={styles.suppressed}>Small demographic groups are suppressed to prevent reconstruction.</div>
                      )}
                    </article>
                  )
                })}
              </div>

              <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>Age mix across branches</h3>
                <div style={styles.tableScroll}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Branch</th>
                        {AGE_ROWS.map(([,label]) => <th key={label} style={styles.th}>{label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.branch.public_id}>
                          <td style={styles.td}><strong>{row.branch.name}</strong></td>
                          {AGE_ROWS.map(([key]) => (
                            <td key={key} style={styles.td}>{row.demographics?.age?.[key] == null ? '—' : safeCount(row.demographics.age[key])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={styles.tableCard}>
                <h3 style={styles.cardTitle}>Gender mix across branches</h3>
                <div style={styles.tableScroll}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Branch</th>
                        {GENDER_ROWS.map(([,label]) => <th key={label} style={styles.th}>{label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.branch.public_id}>
                          <td style={styles.td}><strong>{row.branch.name}</strong></td>
                          {GENDER_ROWS.map(([key]) => (
                            <td key={key} style={styles.td}>{row.demographics?.gender?.[key] == null ? '—' : safeCount(row.demographics.gender[key])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {view === 'hourly' && (
            <>
              <div style={styles.hourControls}>
                <div>
                  <div style={styles.miniTitle}>Hourly metric</div>
                  <div style={styles.metricButtons}>
                    {[
                      ['activity','Activity'],
                      ['customers','Customers'],
                      ['rewards','Rewards'],
                      ...(salesAvailable ? [['sales','Sales']] : []),
                    ].map(([key,label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setHourMetric(key)}
                        style={{...styles.metricBtn,...(hourMetric === key ? styles.metricBtnActive : {})}}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={styles.hourSelected}>
                  Selected hour: <strong>{hourLabel(effectiveHour)}</strong>
                </div>
              </div>

              <div style={styles.hourGrid}>
                {allHours.map(hour => {
                  const total =
                    hourMetric === 'customers' ? hour.totalCustomers :
                    hourMetric === 'rewards' ? hour.totalRewards :
                    hourMetric === 'sales' ? hour.totalSales :
                    hour.totalActivity
                  return (
                    <button
                      key={hour.hour}
                      type="button"
                      onClick={() => setSelectedHour(hour.hour)}
                      style={{...styles.hourBtn,...(Number(effectiveHour) === hour.hour ? styles.hourBtnActive : {})}}
                    >
                      <span>{hour.label}</span>
                      <strong>{total.toLocaleString()}</strong>
                    </button>
                  )
                })}
              </div>

              <div style={styles.tableCard}>
                <div style={styles.cardHeader}>
                  <div>
                    <h3 style={styles.cardTitle}>{hourLabel(effectiveHour)} across branches</h3>
                    <p style={styles.cardSub}>
                      Activity is truly hourly. Demographics use the backend’s privacy-safe demographic window, which may cover {selectedHourBranchRows[0]?.bucketHours || 2} hours.
                    </p>
                  </div>
                </div>
                <div style={styles.tableScroll}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Branch</th>
                        <th style={styles.th}>Activity</th>
                        <th style={styles.th}>Customers</th>
                        <th style={styles.th}>Rewards</th>
                        {salesAvailable && <th style={styles.th}>Sales</th>}
                        <th style={styles.th}>Demographic window</th>
                        <th style={styles.th}>Top age</th>
                        <th style={styles.th}>Top gender</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedHourBranchRows.map(row => {
                        const age = topVisibleGroup(row.demographicWindow?.age, AGE_ROWS)
                        const gender = topVisibleGroup(row.demographicWindow?.gender, GENDER_ROWS)
                        return (
                          <tr key={row.branch.public_id}>
                            <td style={styles.td}><strong>{row.branch.name}</strong></td>
                            <td style={styles.td}>{safeCount(row.hourData?.activity_count)}</td>
                            <td style={styles.td}>{safeCount(row.hourData?.unique_customers)}</td>
                            <td style={styles.td}>{safeCount(row.hourData?.reward_count)}</td>
                            {salesAvailable && <td style={styles.td}>{row.time?.sales_tracked ? safeCount(row.hourData?.sales_count) : '—'}</td>}
                            <td style={styles.td}>{row.demographicWindow?.label || `${hourLabel(row.startHour)} window`}</td>
                            <td style={styles.td}>{row.demographicWindow?.age_available && age ? `${age.label} · ${age.value}` : 'Suppressed / unavailable'}</td>
                            <td style={styles.td}>{row.demographicWindow?.gender_available && gender ? `${gender.label} · ${gender.value}` : 'Suppressed / unavailable'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={styles.branchHourCards}>
                {selectedHourBranchRows.map(row => (
                  <article key={row.branch.public_id} style={styles.hourBranchCard}>
                    <div style={styles.demoHead}>
                      <div>
                        <h3 style={styles.demoTitle}>{row.branch.name}</h3>
                        <div style={styles.demoSub}>{hourLabel(effectiveHour)} · {number(row.hourData?.activity_count)} activities</div>
                      </div>
                      {row.peak && Number(row.peak.hour) === Number(effectiveHour) && <span style={styles.peakBadge}>Peak</span>}
                    </div>

                    <div style={styles.inlineStats}>
                      <Mini label="Customers" value={safeCount(row.hourData?.unique_customers)} />
                      <Mini label="Rewards" value={safeCount(row.hourData?.reward_count)} />
                      {row.time?.sales_tracked && <Mini label="Sales" value={safeCount(row.hourData?.sales_count)} />}
                    </div>

                    <div style={styles.demoWindowBox}>
                      <div style={styles.miniTitle}>Demographics · {row.demographicWindow?.label || 'privacy-safe window'}</div>
                      {!row.demographicWindow ? (
                        <div style={styles.smallEmpty}>No demographic window data.</div>
                      ) : (
                        <div style={styles.demoColumns}>
                          <div>
                            {row.demographicWindow?.age_available
                              ? AGE_ROWS.map(([key,label]) => row.demographicWindow?.age?.[key] == null ? null : (
                                  <MetricRow key={key} label={label} value={safeCount(row.demographicWindow.age[key])} />
                                ))
                              : <div style={styles.smallEmpty}>Age sample is below the privacy threshold.</div>}
                          </div>
                          <div>
                            {row.demographicWindow?.gender_available
                              ? GENDER_ROWS.map(([key,label]) => row.demographicWindow?.gender?.[key] == null ? null : (
                                  <MetricRow key={key} label={label} value={safeCount(row.demographicWindow.gender[key])} />
                                ))
                              : <div style={styles.smallEmpty}>Gender sample is below the privacy threshold.</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

function SummaryCard({ label, value, hint }) {
  return (
    <div style={styles.summaryCard}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={styles.summaryValue}>{value}</div>
      <div style={styles.summaryHint}>{hint}</div>
    </div>
  )
}

function MetricRow({ label, value }) {
  return (
    <div style={styles.metricRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Mini({ label, value }) {
  return (
    <div style={styles.mini}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

const styles = {
  wrap:{display:'grid',gap:16},
  hero:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,flexWrap:'wrap',padding:18,background:'linear-gradient(135deg,#f0fdfa,#ffffff)',border:'1px solid #ccfbf1',borderRadius:16},
  eyebrow:{fontSize:10,fontWeight:900,letterSpacing:'.11em',color:'#0f766e'},
  title:{margin:'4px 0 5px',fontSize:22,color:'#0f172a'},
  subtitle:{margin:0,maxWidth:760,fontSize:12.5,lineHeight:1.55,color:'#64748b'},
  refreshBtn:{border:'1px solid #99f6e4',background:'#fff',color:'#0f766e',borderRadius:10,padding:'9px 12px',fontSize:12,fontWeight:850,cursor:'pointer'},
  warning:{padding:'10px 12px',borderRadius:11,background:'#fffbeb',border:'1px solid #fde68a',color:'#92400e',fontSize:12},
  empty:{padding:32,textAlign:'center',border:'1px dashed #cbd5e1',borderRadius:14,color:'#64748b',background:'#fff'},
  tabs:{display:'flex',gap:7,flexWrap:'wrap'},
  tab:{border:'1px solid #e2e8f0',background:'#fff',color:'#475569',borderRadius:999,padding:'8px 13px',fontSize:12,fontWeight:850,cursor:'pointer'},
  tabActive:{background:'#0f766e',borderColor:'#0f766e',color:'#fff'},
  summaryGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10},
  summaryCard:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:14,padding:14},
  summaryLabel:{fontSize:10,fontWeight:850,color:'#64748b',textTransform:'uppercase',letterSpacing:'.05em'},
  summaryValue:{fontSize:25,fontWeight:900,color:'#0f172a',marginTop:5},
  summaryHint:{fontSize:11,color:'#0f766e',fontWeight:750,marginTop:4},
  tableCard:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:15,overflow:'hidden'},
  cardHeader:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-start',marginBottom:10},
  cardTitle:{margin:'0 0 3px',fontSize:15,color:'#0f172a'},
  cardSub:{margin:0,fontSize:11,color:'#64748b',lineHeight:1.45},
  tableScroll:{overflowX:'auto'},
  table:{width:'100%',borderCollapse:'collapse',minWidth:860},
  th:{textAlign:'left',padding:'10px 9px',fontSize:10,fontWeight:900,color:'#64748b',background:'#f8fafc',borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'},
  td:{padding:'10px 9px',fontSize:11.5,color:'#334155',borderBottom:'1px solid #f1f5f9',verticalAlign:'top'},
  sub:{display:'block',fontSize:9.5,color:'#94a3b8',marginTop:3,maxWidth:220},
  privacyNote:{padding:'11px 13px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:12,fontSize:11.5,color:'#475569'},
  demoGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:12},
  demoCard:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:15},
  demoHead:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10},
  demoTitle:{margin:0,fontSize:15,color:'#0f172a'},
  demoSub:{fontSize:10.5,color:'#64748b',marginTop:3},
  lockBadge:{fontSize:9.5,fontWeight:850,color:'#0f766e',background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:999,padding:'4px 7px'},
  peakBadge:{fontSize:9.5,fontWeight:900,color:'#92400e',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:999,padding:'4px 7px'},
  demoColumns:{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:14,marginTop:13},
  miniTitle:{fontSize:10,fontWeight:900,color:'#64748b',textTransform:'uppercase',letterSpacing:'.04em',marginBottom:6},
  metricRow:{display:'flex',justifyContent:'space-between',gap:10,padding:'5px 0',borderBottom:'1px solid #f8fafc',fontSize:11,color:'#475569'},
  smallEmpty:{fontSize:10.5,color:'#94a3b8',lineHeight:1.45,padding:'7px 0'},
  suppressed:{fontSize:9.5,color:'#92400e',background:'#fffbeb',borderRadius:8,padding:'7px 8px',marginTop:10},
  hourControls:{display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:12,flexWrap:'wrap',background:'#fff',border:'1px solid #e2e8f0',borderRadius:14,padding:12},
  metricButtons:{display:'flex',gap:6,flexWrap:'wrap'},
  metricBtn:{border:'1px solid #e2e8f0',background:'#fff',borderRadius:999,padding:'6px 9px',fontSize:10.5,fontWeight:800,color:'#475569',cursor:'pointer'},
  metricBtnActive:{background:'#0f766e',borderColor:'#0f766e',color:'#fff'},
  hourSelected:{fontSize:11,color:'#64748b'},
  hourGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(92px,1fr))',gap:7},
  hourBtn:{border:'1px solid #e2e8f0',background:'#fff',borderRadius:11,padding:'8px 7px',display:'flex',flexDirection:'column',gap:2,alignItems:'flex-start',fontSize:9.5,color:'#64748b',cursor:'pointer'},
  hourBtnActive:{borderColor:'#14b8a6',background:'#f0fdfa',color:'#0f766e'},
  branchHourCards:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(310px,1fr))',gap:12},
  hourBranchCard:{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:15},
  inlineStats:{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:7,marginTop:12},
  mini:{background:'#f8fafc',border:'1px solid #eef2f7',borderRadius:9,padding:'8px 9px',display:'flex',flexDirection:'column',gap:2},
  demoWindowBox:{marginTop:12,borderTop:'1px solid #e2e8f0',paddingTop:12},
}
