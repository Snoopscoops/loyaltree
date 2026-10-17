import React from 'react'
import { CUSTOMER_SEGMENTS } from './ownerCustomerMetrics'

export default function CustomerSegmentsChart({ stats, scopeLabel }) {
  const available = stats?.activity_available === true && stats?.customer_segments
  const segments = CUSTOMER_SEGMENTS.map(segment => ({ ...segment, count: Math.max(0, Number(stats?.customer_segments?.[segment.key]) || 0) }))
  const total = segments.reduce((sum, item) => sum + item.count, 0)
  let cursor = -Math.PI / 2
  return <article className="lt-customer-segments">
    <header><div><span className="lt-owner-eyebrow">CUSTOMER MIX</span><h2>Know who keeps coming back</h2><p>{scopeLabel} · {stats?.activity_missing_sources?.length ? 'Available recorded history' : 'All recorded history'}</p></div><span className="lt-customer-segment-total">{available ? total.toLocaleString() : '—'} customers</span></header>
    {!available ? <p role="status">Customer activity is currently unavailable. Please refresh shortly.</p> : <>
      <div className="lt-customer-segment-body">
        <svg viewBox="0 0 220 220" role="img" aria-label={total ? segments.map(s => `${s.label}: ${s.count}`).join(', ') : 'No customers yet'}>
          {!total && <circle cx="110" cy="110" r="100" fill="#e5ede8" />}
          {segments.filter(s => s.count > 0).map(segment => {
            const angle = segment.count / total * Math.PI * 2
            const start = cursor
            cursor += angle
            if (segment.count === total) return <circle key={segment.key} cx="110" cy="110" r="100" fill={segment.color}><title>{segment.label}: {segment.count}</title></circle>
            const path = `M110 110 L${110 + 100 * Math.cos(start)} ${110 + 100 * Math.sin(start)} A100 100 0 ${angle > Math.PI ? 1 : 0} 1 ${110 + 100 * Math.cos(cursor)} ${110 + 100 * Math.sin(cursor)} Z`
            return <path key={segment.key} d={path} fill={segment.color} stroke="#fff" strokeWidth="2"><title>{segment.label}: {segment.count}</title></path>
          })}
        </svg>
        <ul>{segments.map(segment => <li key={segment.key}><span className="lt-customer-segment-dot" style={{ background: segment.color }}/><span>{segment.label}</span><strong>{segment.count}</strong><small>{total ? Math.round(segment.count / total * 100) : 0}%</small></li>)}</ul>
      </div>
      {stats?.activity_missing_sources?.length > 0 && <p role="status" className="lt-customer-segment-note">Some older activity sources are unavailable. This chart uses the available recorded history.</p>}
      <p className="lt-customer-segment-note">Regulars have visited on 3+ days; occasional visitors on 2. First-time includes customers without a repeat visit. At risk means no visit for {Number(stats?.churn_days || 30)}+ days and takes priority over the other groups. Visits count once per customer per local day.</p>
    </>}
  </article>
}
