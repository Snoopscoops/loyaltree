import { useState } from 'react'
import { datePresetRange, filterSummary, filtersAreActive, localIsoDate, retentionGroups, toolOverview, transactionView } from './advancedToolsModel'

const PRESETS = [['today', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days']]

function Scope({ businessName, programLabel }) {
  return <p className="lt-tools-scope">{businessName || 'This business'} · {programLabel || 'All programs'}</p>
}

function Header({ businessName, programLabel, title, text, onRefresh, loading, refreshLabel = 'Refresh' }) {
  return (
    <header className="lt-tools-head">
      <div>
        <Scope businessName={businessName} programLabel={programLabel} />
        <h2>{title}</h2>
        <p>{text}</p>
      </div>
      <button type="button" className="lt-tools-refresh" onClick={onRefresh} disabled={loading}>{loading ? 'Refreshing…' : refreshLabel}</button>
    </header>
  )
}

function Status({ kind, title, text, action, actionLabel }) {
  return (
    <div className={`lt-tools-note is-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <strong>{title}</strong>
      <p>{text}</p>
      {action && <button type="button" className="lt-tools-ghost" onClick={action}>{actionLabel}</button>}
    </div>
  )
}

export default function AdvancedTools({
  tool, businessName, programLabel, onOpen,
  securityLoading, securityLoaded, securityError, alerts = [], transactions = [], filters, branches = [], staff = [], onFilters, onApply, onReset,
  growthLoading, growthLoaded, toolErrors = {}, wallet = {}, crm = {}, retention = {}, opportunities = [], operations = {}, onRefreshGrowth,
}) {
  const [preset, setPreset] = useState('')
  const view = transactionView({ loading: securityLoading, error: securityError, transactions, filters })
  const summary = filterSummary(filters, { branches, staff })
  const groups = retentionGroups(opportunities)
  const cards = toolOverview({ securityLoaded, securityError, alerts: alerts.length, growthLoaded, toolErrors, wallet, crm, retention, operations, opportunities: opportunities.length })

  const choosePreset = (value) => {
    const range = datePresetRange(value, localIsoDate())
    if (!range) return
    const next = { ...filters, ...range }
    setPreset(value)
    onFilters(next)
    onApply(next)
  }

  if (tool === 'advanced') {
    return (
      <section className="lt-tools" aria-labelledby="lt-advanced-title">
        <header className="lt-tools-head">
          <div>
            <Scope businessName={businessName} programLabel={programLabel} />
            <h2 id="lt-advanced-title">Advanced tools</h2>
            <p>Checks for activity, wallet delivery, segments, retention, and branches. Nothing here sends a message or changes a card.</p>
          </div>
        </header>
        <div className="lt-tools-overview">
          {cards.map(card => (
            <article key={card.id} className="lt-tools-row">
              <h3>{card.title}</h3>
              <p>{card.purpose}</p>
              <p className="lt-tools-meta">{card.state}</p>
              <button type="button" className="lt-tools-refresh" onClick={() => onOpen(card.id)}>Open</button>
            </article>
          ))}
        </div>
      </section>
    )
  }

  if (tool === 'security') {
    return (
      <section className="lt-tools" aria-labelledby="lt-security-title">
        <Header businessName={businessName} programLabel={programLabel} title="Transactions & security" text="Card activity for the filters below. Alerts always cover the last 24 hours and do not stop the cashier." onRefresh={() => onApply(filters)} loading={securityLoading} />
        <div className="lt-tools-stats">
          <div className="lt-tools-stat"><b>{transactions.length}</b><span>Matching this filter</span></div>
          <div className="lt-tools-stat"><b>{alerts.length}</b><span>Alerts, last 24 hours</span></div>
          <div className="lt-tools-stat"><b>{transactions.filter(item => item.status === 'failed').length}</b><span>Failed in this filter</span></div>
        </div>
        <div className={`lt-tools-note ${alerts.length ? 'is-alert' : 'is-clear'}`}>
          <strong>{alerts.length ? 'Needs a look' : 'Nothing unusual'}</strong>
          {securityLoading && alerts.length === 0 ? <p>Checking the last 24 hours…</p> : alerts.length === 0 ? <p>No suspicious pattern in the last 24 hours.</p> : alerts.map((alert, index) => (
            <div key={`${alert.type}-${index}`} className="lt-tools-alert">
              <div className="lt-tools-row-top"><b>{alert.title}</b><span className={alert.severity === 'high' ? 'lt-pill bad' : 'lt-pill warn'}>{String(alert.severity || 'review').toUpperCase()}</span></div>
              <p>{alert.message}</p>
            </div>
          ))}
        </div>
        <form className="lt-tools-filters" onSubmit={(event) => { event.preventDefault(); onApply(filters) }}>
          <div>
            <label>Status<select value={filters.status} onChange={event => onFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option><option value="success">Success</option><option value="failed">Failed</option><option value="processing">Processing</option></select></label>
            <label>Branch<select value={filters.branch_public_id} onChange={event => onFilters({ ...filters, branch_public_id: event.target.value })}><option value="">All branches</option>{branches.map(branch => <option key={branch.public_id} value={branch.public_id}>{branch.name}</option>)}</select></label>
            <label>Cashier<select value={filters.staff_public_id} onChange={event => onFilters({ ...filters, staff_public_id: event.target.value })}><option value="">All cashiers</option>{staff.map(person => <option key={person.public_id} value={person.public_id}>{person.name}</option>)}</select></label>
          </div>
          <div role="group" aria-label="Date range">
            {PRESETS.map(([value, label]) => <button key={value} type="button" className="lt-tools-ghost" aria-pressed={preset === value} onClick={() => choosePreset(value)}>{label}</button>)}
          </div>
          <div>
            <label>From<input type="date" value={filters.date_from} onChange={event => { setPreset(''); onFilters({ ...filters, date_from: event.target.value }) }} /></label>
            <label>To<input type="date" value={filters.date_to} onChange={event => { setPreset(''); onFilters({ ...filters, date_to: event.target.value }) }} /></label>
          </div>
          <p className="lt-tools-meta">{summary.length ? `Active filters: ${summary.join(' · ')}.` : 'No filters yet. This list can show up to 300 transactions.'} Alerts stay on the last 24 hours.</p>
          <div className="lt-tools-actions">
            <button type="submit" className="lt-tools-refresh">Apply filters</button>
            <button type="button" className="lt-tools-ghost" onClick={() => { setPreset(''); onReset() }} disabled={!filtersAreActive(filters)}>Reset</button>
          </div>
        </form>
        {securityError && view !== 'error' && <Status kind="error" title="Some results did not refresh" text={securityError} action={() => onApply(filters)} actionLabel="Retry" />}
        {view === 'loading' && <Status kind="clear" title="Loading transactions" text="Checking this business. Nothing is being changed." />}
        {view === 'error' && <Status kind="error" title="Transactions did not load" text={securityError} action={() => onApply(filters)} actionLabel="Retry" />}
        {view === 'empty' && <Status kind="clear" title="No transactions yet" text="New stamps, points, and adjustments will show up here." />}
        {view === 'no-match' && <Status kind="clear" title="No transactions match these filters" text="Try a wider date range or reset the filters." action={() => { setPreset(''); onReset() }} actionLabel="Reset filters" />}
        {view === 'results' && <div className="lt-tools-list">
          {transactions.map((tx, index) => (
            <article key={tx.transaction_id || tx.id || index} className="lt-tools-row">
              <div className="lt-tools-row-top">
                <div><b>{String(tx.action || 'transaction').replaceAll('_', ' ')}</b><p className="lt-tools-meta">{tx.customer_name || 'No customer'} · {tx.staff_name || tx.actor_type || 'System'}{tx.branch_name ? ` · ${tx.branch_name}` : ''}</p></div>
                <span className={tx.status === 'failed' ? 'lt-pill bad' : tx.status === 'success' ? 'lt-pill' : 'lt-pill warn'}>{tx.status || 'unknown'}</span>
              </div>
              <p className="lt-tools-meta">{tx.created_at ? new Date(tx.created_at).toLocaleString() : '—'}{tx.delta !== null && tx.delta !== undefined ? ` · Change ${Number(tx.delta) > 0 ? '+' : ''}${tx.delta}` : ''}{tx.balance_before !== null && tx.balance_before !== undefined ? ` · Balance ${tx.balance_before} → ${tx.balance_after ?? '—'}` : ''}</p>
            </article>
          ))}
        </div>}
      </section>
    )
  }

  if (tool === 'walletqueue') {
    const jobs = wallet.jobs || []
    const failed = Boolean(toolErrors.wallet)
    return (
      <section className="lt-tools">
        <Header businessName={businessName} programLabel={programLabel} title="Wallet queue" text="Updates waiting to reach a saved Apple or Google card." onRefresh={onRefreshGrowth} loading={growthLoading} />
        {failed && jobs.length === 0 ? <Status kind="error" title="Wallet queue did not load" text={toolErrors.wallet} action={onRefreshGrowth} actionLabel="Retry" /> : <>
          <div className="lt-tools-stats">
            <div className="lt-tools-stat"><b>{wallet.pending || 0}</b><span>Waiting</span></div>
            <div className="lt-tools-stat"><b>{wallet.failed || 0}</b><span>Failed</span></div>
          </div>
          {failed && <Status kind="error" title="Could not refresh" text={toolErrors.wallet} action={onRefreshGrowth} actionLabel="Retry" />}
          {!growthLoaded && growthLoading && <Status kind="clear" title="Loading wallet queue" text="Checking saved card updates." />}
          {growthLoaded && jobs.length === 0 && <Status kind="clear" title="Nothing is waiting" text="Saved cards have no queued update." />}
          <div className="lt-tools-list">{jobs.slice(0, 50).map(job => (
            <article key={job.id} className="lt-tools-row">
              <div className="lt-tools-row-top"><b>{String(job.reason || 'update').replaceAll('_', ' ')}</b><span className={job.status === 'failed' ? 'lt-pill bad' : 'lt-pill'}>{job.status}</span></div>
              <p className="lt-tools-meta">Attempt {job.attempts}/{job.max_attempts}</p>
              {job.last_error && <p className="lt-tools-meta">{job.last_error}</p>}
            </article>
          ))}</div>
        </>}
      </section>
    )
  }

  if (tool === 'crm') {
    const customers = crm.customers || []
    return (
      <section className="lt-tools">
        <Header businessName={businessName} programLabel={programLabel} title="Customer segments" text="Members grouped by how recently they visited." onRefresh={onRefreshGrowth} loading={growthLoading} />
        {toolErrors.crm && customers.length === 0 ? <Status kind="error" title="Segments did not load" text={toolErrors.crm} action={onRefreshGrowth} actionLabel="Retry" /> : <>
          <div className="lt-tools-stats">{Object.entries(crm.segments || {}).map(([key, value]) => <div className="lt-tools-stat" key={key}><b>{value}</b><span>{key.replaceAll('_', ' ')}</span></div>)}</div>
          {growthLoaded && customers.length === 0 && <Status kind="clear" title="No members in these segments" text="Members appear here after they join a card." />}
          <div className="lt-tools-list">{customers.map(customer => (
            <article key={customer.public_id} className="lt-tools-row">
              <b>{customer.name || 'Customer'}</b>
              <p className="lt-tools-meta">{customer.crm?.segment?.replaceAll('_', ' ') || 'Unsorted'} · {customer.crm?.total_transactions || 0} visits · last visit {customer.crm?.days_since_last_activity ?? '—'} days ago</p>
            </article>
          ))}</div>
        </>}
      </section>
    )
  }

  if (tool === 'retention') {
    return (
      <section className="lt-tools">
        <Header businessName={businessName} programLabel={programLabel} title="Retention" text="These counts come from existing visits. Opening a row shows the suggested message. Nothing is sent from this page." onRefresh={onRefreshGrowth} loading={growthLoading} />
        {toolErrors.retention && retention.repeat_customer_rate == null && opportunities.length === 0 ? <Status kind="error" title="Retention did not load" text={toolErrors.retention} action={onRefreshGrowth} actionLabel="Retry" /> : <>
          <div className="lt-tools-stats">
            <div className="lt-tools-stat"><b>{retention.repeat_customer_rate || 0}%</b><span>Came back</span></div>
            <div className="lt-tools-stat"><b>{retention.retention_30_rate || 0}%</b><span>Active in 30 days</span></div>
            <div className="lt-tools-stat"><b>{retention.average_days_between_activity ?? '—'}</b><span>Days between visits</span></div>
            <div className="lt-tools-stat"><b>{opportunities.length}</b><span>To review</span></div>
          </div>
          {growthLoaded && groups.length === 0 && <Status kind="clear" title="No one to review" text="Win-back and one-stamp-away members will be listed here." />}
          {groups.map(group => (
            <section key={group.type} className="lt-tools-list">
              <h3>{group.title} · {group.count}</h3>
              {group.items.map((item, index) => (
                <details key={`${item.customer_public_id || item.customer_name}-${item.type}-${index}`} className="lt-tools-row">
                  <summary>{item.customer_name || 'Customer'}{item.days_inactive != null ? ` · ${item.days_inactive} days` : ''}</summary>
                  <p>{item.suggested_message}</p>
                </details>
              ))}
            </section>
          ))}
        </>}
      </section>
    )
  }

  const branchRows = operations.branches || []
  const cashierRows = operations.cashiers || []
  return (
    <section className="lt-tools">
      <Header businessName={businessName} programLabel={programLabel} title="Branch operations" text={`Transactions by branch and cashier over the last ${operations.days || 30} days.`} onRefresh={onRefreshGrowth} loading={growthLoading} />
      {toolErrors.operations && branchRows.length === 0 && cashierRows.length === 0 ? <Status kind="error" title="Branch activity did not load" text={toolErrors.operations} action={onRefreshGrowth} actionLabel="Retry" /> : <>
        <div className="lt-tools-stats">
          <div className="lt-tools-stat"><b>{operations.overall?.transactions || 0}</b><span>Transactions</span></div>
          <div className="lt-tools-stat"><b>{operations.overall?.failed || 0}</b><span>Failed</span></div>
        </div>
        <h3>Branches</h3>
        {growthLoaded && branchRows.length === 0 && <Status kind="clear" title="No branches to compare" text="Branch totals appear after a location is added." />}
        <div className="lt-tools-list">{branchRows.map(row => <article key={row.id} className="lt-tools-row"><b>{row.name}</b><p className="lt-tools-meta">{row.transactions} transactions · {row.adjustments} adjustments · {row.failed} failed</p></article>)}</div>
        <h3>Cashiers</h3>
        {growthLoaded && cashierRows.length === 0 && <Status kind="clear" title="No cashier activity" text={`No cashier transactions in the last ${operations.days || 30} days.`} />}
        <div className="lt-tools-list">{cashierRows.map(row => <article key={row.id} className="lt-tools-row"><b>{row.name}</b><p className="lt-tools-meta">{row.transactions} transactions · {row.adjustments} adjustments · {row.failed} failed</p></article>)}</div>
      </>}
    </section>
  )
}
