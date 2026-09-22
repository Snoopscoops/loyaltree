import React, { useEffect, useMemo, useState } from 'react'

const peso = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const prettyDate = value => {
  if (!value) return '—'
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })
}
const today = () => { const d = new Date(); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 10) }

const statusTone = status => ({
  active: ['#eff6ff', '#1d4ed8'],
  overdue: ['#fef2f2', '#b91c1c'],
  fully_paid: ['#ecfdf5', '#047857'],
  defaulted: ['#fff7ed', '#c2410c'],
  cancelled: ['#f1f5f9', '#475569'],
  on_time: ['#ecfdf5', '#047857'],
  delayed: ['#fff7ed', '#c2410c'],
  partial: ['#fefce8', '#a16207'],
  pending: ['#f8fafc', '#64748b'],
  paid: ['#ecfdf5', '#047857'],
  blocked: ['#fef2f2', '#b91c1c'],
  inactive: ['#f1f5f9', '#475569'],
}[status] || ['#f1f5f9', '#475569'])

function Pill({ value, label }) {
  const [background, color] = statusTone(value)
  return <span style={{ ...S.pill, background, color }}>{label || String(value || '').replaceAll('_', ' ')}</span>
}

function Modal({ title, children, onClose, width = 640 }) {
  return <div style={S.overlay} onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
    <div style={{ ...S.modal, width }}>
      <div style={S.modalHeader}>
        <h2 style={S.modalTitle}>{title}</h2>
        <button type="button" onClick={onClose} style={S.iconBtn}>×</button>
      </div>
      {children}
    </div>
  </div>
}

function Field({ label, children, hint }) {
  return <label style={S.field}>
    <span style={S.label}>{label}</span>
    {children}
    {hint && <span style={S.hint}>{hint}</span>}
  </label>
}

function Empty({ children }) {
  return <div style={S.empty}>{children}</div>
}

export default function LendingDashboard({ API_BASE, user, onLogout }) {
  const businessId = user?.business_slug
  const token = user?.token
  const [activeTab, setActiveTab] = useState('dashboard')
  const [dashboard, setDashboard] = useState(null)
  const [borrowers, setBorrowers] = useState([])
  const [loans, setLoans] = useState([])
  const [payments, setPayments] = useState([])
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [loanStatus, setLoanStatus] = useState('')
  const [borrowerModal, setBorrowerModal] = useState(null)
  const [loanModal, setLoanModal] = useState(false)
  const [paymentLoan, setPaymentLoan] = useState(null)
  const [loanDetail, setLoanDetail] = useState(null)
  const [documentLoan, setDocumentLoan] = useState(null)

  const headers = useMemo(() => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token])

  const api = async (path, options = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.detail || data?.message || `Request failed (${res.status})`)
    return data
  }

  const flash = text => {
    setMessage(text)
    window.clearTimeout(flash._t)
    flash._t = window.setTimeout(() => setMessage(''), 3500)
  }

  const load = async () => {
    if (!businessId) return
    setLoading(true)
    try {
      const [d, b, l, p, br] = await Promise.all([
        api(`/api/v1/business/${businessId}/lending/dashboard`),
        api(`/api/v1/business/${businessId}/lending/borrowers`),
        api(`/api/v1/business/${businessId}/lending/loans`),
        api(`/api/v1/business/${businessId}/lending/payments`),
        api(`/api/v1/business/${businessId}/branches`),
      ])
      setDashboard(d)
      setBorrowers(Array.isArray(b) ? b : [])
      setLoans(Array.isArray(l) ? l : [])
      setPayments(Array.isArray(p) ? p : [])
      setBranches(Array.isArray(br) ? br : [])
    } catch (e) {
      flash(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [businessId]) // eslint-disable-line react-hooks/exhaustive-deps

  const openLoan = async loan => {
    try {
      const detail = await api(`/api/v1/business/${businessId}/lending/loans/${loan.public_id}`)
      setLoanDetail(detail)
    } catch (e) { flash(e.message) }
  }


  const openDocument = async doc => {
    if (doc?.legacy_file_url && !doc?.has_private_file) {
      window.open(doc.legacy_file_url, '_blank', 'noopener,noreferrer')
      return
    }
    const popup = window.open('', '_blank')
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/lending/documents/${doc.public_id}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.detail || `Could not open document (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      if (popup) popup.location.href = url
      else {
        const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click()
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) {
      if (popup) popup.close()
      flash(e.message)
    }
  }

  const filteredBorrowers = borrowers.filter(b => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [b.name, b.phone, b.email, b.address, b.id_number].some(v => String(v || '').toLowerCase().includes(q))
  })
  const filteredLoans = loans.filter(l => !loanStatus || l.status === loanStatus)

  const tabs = [
    ['dashboard', 'Overview'], ['borrowers', 'Borrowers'], ['loans', 'Loans'], ['collections', 'Collections'],
  ]

  return <div style={S.page}>
    <header style={S.header}>
      <div>
        <div style={S.eyebrow}>LOYALTY TREE · LENDING</div>
        <h1 style={S.title}>{user?.business_name || dashboard?.business_name || 'Lending Management'}</h1>
        <div style={S.subtitle}>Borrowers, contracts, installments and collections</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={S.secondaryBtn} onClick={load}>Refresh</button>
        <button style={S.secondaryBtn} onClick={onLogout}>Log out</button>
      </div>
    </header>

    <nav style={S.nav}>
      {tabs.map(([key, label]) => <button key={key} onClick={() => setActiveTab(key)} style={{ ...S.navBtn, ...(activeTab === key ? S.navBtnActive : {}) }}>{label}</button>)}
    </nav>

    {message && <div style={S.toast}>{message}</div>}

    <main style={S.main}>
      {loading ? <div style={S.loading}>Loading lending records…</div> : <>
        {activeTab === 'dashboard' && <DashboardView dashboard={dashboard} loans={loans} borrowers={borrowers} onOpenLoan={openLoan} />}
        {activeTab === 'borrowers' && <BorrowersView borrowers={filteredBorrowers} search={search} setSearch={setSearch} onNew={() => setBorrowerModal({})} onEdit={setBorrowerModal} onCreateLoan={b => { setLoanModal(b); }} />}
        {activeTab === 'loans' && <LoansView loans={filteredLoans} filter={loanStatus} setFilter={setLoanStatus} onNew={() => setLoanModal(true)} onOpen={openLoan} onPayment={setPaymentLoan} />}
        {activeTab === 'collections' && <CollectionsView payments={payments} />}
      </>}
    </main>

    {borrowerModal !== null && <BorrowerForm
      borrower={borrowerModal?.public_id ? borrowerModal : null}
      onClose={() => setBorrowerModal(null)}
      onSave={async payload => {
        try {
          if (borrowerModal?.public_id) {
            await api(`/api/v1/business/${businessId}/lending/borrowers/${borrowerModal.public_id}`, { method: 'PATCH', body: JSON.stringify(payload) })
            flash('Borrower updated')
          } else {
            await api(`/api/v1/business/${businessId}/lending/borrowers`, { method: 'POST', body: JSON.stringify(payload) })
            flash('Borrower created')
          }
          setBorrowerModal(null); await load()
        } catch (e) { throw e }
      }}
    />}

    {loanModal && <LoanForm
      borrowers={borrowers}
      branches={branches}
      preselectedBorrower={loanModal?.public_id ? loanModal.public_id : ''}
      onClose={() => setLoanModal(false)}
      onSave={async payload => {
        const result = await api(`/api/v1/business/${businessId}/lending/loans`, { method: 'POST', body: JSON.stringify(payload) })
        setLoanModal(false); flash('Loan and installment schedule created'); await load(); setLoanDetail(result)
      }}
    />}

    {paymentLoan && <PaymentForm
      loan={paymentLoan}
      onClose={() => setPaymentLoan(null)}
      onSave={async payload => {
        const result = await api(`/api/v1/business/${businessId}/lending/loans/${paymentLoan.public_id}/payments`, { method: 'POST', body: JSON.stringify(payload) })
        setPaymentLoan(null); flash(`Payment recorded · ${result?.payment?.receipt_number || 'receipt created'}`); await load(); setLoanDetail(result.loan)
      }}
    />}

    {loanDetail && <LoanDetail
      loan={loanDetail}
      onClose={() => setLoanDetail(null)}
      onPayment={() => { setPaymentLoan(loanDetail); setLoanDetail(null) }}
      onDocument={() => { setDocumentLoan(loanDetail); setLoanDetail(null) }}
      onOpenDocument={openDocument}
    />}

    {documentLoan && <DocumentForm
      loan={documentLoan}
      API_BASE={API_BASE}
      businessId={businessId}
      token={token}
      onClose={() => setDocumentLoan(null)}
      onUploaded={async () => {
        setDocumentLoan(null); flash('Private document attached'); await load(); await openLoan(documentLoan)
      }}
    />}
  </div>
}

function DashboardView({ dashboard, loans, borrowers, onOpenLoan }) {
  const cards = [
    ['Outstanding', peso(dashboard?.outstanding_balance)],
    ['Collections today', peso(dashboard?.collections_today)],
    ['Collections this month', peso(dashboard?.collections_month)],
    ['Total released', peso(dashboard?.total_released)],
    ['Active loans', dashboard?.active_loans || 0],
    ['Overdue loans', dashboard?.overdue_loans || 0],
    ['Borrowers', dashboard?.borrowers || 0],
    ['On-time rate', `${Number(dashboard?.on_time_rate || 0).toFixed(1)}%`],
  ]
  const urgent = loans.filter(l => l.status === 'overdue').slice(0, 8)
  return <>
    <section style={S.statsGrid}>{cards.map(([label, value]) => <div key={label} style={S.statCard}><span style={S.statLabel}>{label}</span><strong style={S.statValue}>{value}</strong></div>)}</section>
    <section style={S.twoCol}>
      <div style={S.panel}>
        <div style={S.panelHead}><div><h3 style={S.panelTitle}>Needs attention</h3><p style={S.panelSub}>Loans currently past due</p></div><Pill value="overdue" label={`${dashboard?.overdue_loans || 0} overdue`} /></div>
        {urgent.length ? urgent.map(l => <button key={l.public_id} onClick={() => onOpenLoan(l)} style={S.rowButton}>
          <div><strong>{l.borrower?.name || 'Borrower'}</strong><div style={S.rowSub}>{l.contract_number}{l.branch?.name ? ` · ${l.branch.name}` : ''} · Due {prettyDate(l.next_due_date)}</div></div>
          <div style={{ textAlign: 'right' }}><strong>{peso(l.balance_remaining)}</strong><div style={{ ...S.rowSub, color: '#b91c1c' }}>{l.days_past_due || 0} days late</div></div>
        </button>) : <Empty>No overdue loans.</Empty>}
      </div>
      <div style={S.panel}>
        <div style={S.panelHead}><div><h3 style={S.panelTitle}>Payment behavior</h3><p style={S.panelSub}>Completed and open installments</p></div></div>
        <div style={S.behaviorGrid}>
          <Behavior label="On time" value={dashboard?.on_time_installments || 0} tone="on_time" />
          <Behavior label="Delayed" value={dashboard?.delayed_installments || 0} tone="delayed" />
          <Behavior label="Overdue" value={dashboard?.overdue_installments || 0} tone="overdue" />
          <Behavior label="Partial" value={dashboard?.partial_installments || 0} tone="partial" />
        </div>
        <div style={S.noteBox}>A borrower’s record stays historical: a late installment becomes <strong>Delayed</strong> after it is eventually paid, instead of being erased by the payment.</div>
      </div>
    </section>
  </>
}

function Behavior({ label, value, tone }) {
  const [background, color] = statusTone(tone)
  return <div style={{ ...S.behavior, background }}><strong style={{ color, fontSize: 24 }}>{value}</strong><span style={{ color }}>{label}</span></div>
}

function BorrowersView({ borrowers, search, setSearch, onNew, onEdit, onCreateLoan }) {
  return <section style={S.panel}>
    <div style={S.panelHead}>
      <div><h3 style={S.panelTitle}>Borrowers</h3><p style={S.panelSub}>Identity, loan history and payment performance</p></div>
      <button style={S.primaryBtn} onClick={onNew}>+ Add borrower</button>
    </div>
    <input style={{ ...S.input, maxWidth: 420, marginBottom: 16 }} placeholder="Search name, phone, email, address or ID…" value={search} onChange={e => setSearch(e.target.value)} />
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th>Borrower</th><th>Active loans</th><th>Outstanding</th><th>Payment record</th><th>Status</th><th></th></tr></thead><tbody>
      {borrowers.map(b => <tr key={b.public_id}>
        <td><strong>{b.name}</strong><div style={S.rowSub}>{b.phone || b.email || 'No contact saved'}</div></td>
        <td>{b.active_loans || 0}</td><td>{peso(b.outstanding_balance)}</td>
        <td><span style={{ color: '#047857' }}>{b.payment_performance?.on_time || 0} on time</span> · <span style={{ color: '#c2410c' }}>{b.payment_performance?.delayed || 0} delayed</span>{b.payment_performance?.overdue ? <> · <span style={{ color: '#b91c1c' }}>{b.payment_performance.overdue} overdue</span></> : null}</td>
        <td><Pill value={b.status || 'active'} /></td>
        <td><div style={S.actionRow}><button style={S.textBtn} onClick={() => onCreateLoan(b)}>New loan</button><button style={S.textBtn} onClick={() => onEdit(b)}>Edit</button></div></td>
      </tr>)}
    </tbody></table>{!borrowers.length && <Empty>No borrowers yet.</Empty>}</div>
  </section>
}

function LoansView({ loans, filter, setFilter, onNew, onOpen, onPayment }) {
  return <section style={S.panel}>
    <div style={S.panelHead}><div><h3 style={S.panelTitle}>Loans & contracts</h3><p style={S.panelSub}>Current balances, schedules and contract status</p></div><button style={S.primaryBtn} onClick={onNew}>+ Create loan</button></div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      {['', 'active', 'overdue', 'fully_paid', 'defaulted', 'cancelled'].map(v => <button key={v || 'all'} style={{ ...S.filterBtn, ...(filter === v ? S.filterBtnActive : {}) }} onClick={() => setFilter(v)}>{v ? v.replaceAll('_', ' ') : 'All'}</button>)}
    </div>
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th>Contract</th><th>Borrower</th><th>Balance</th><th>Next due</th><th>Record</th><th>Status</th><th></th></tr></thead><tbody>
      {loans.map(l => <tr key={l.public_id}>
        <td><strong>{l.contract_number}</strong><div style={S.rowSub}>{peso(l.principal_amount)} principal</div></td>
        <td>{l.borrower?.name || '—'}</td><td><strong>{peso(l.balance_remaining)}</strong></td>
        <td>{prettyDate(l.next_due_date)}{l.days_past_due > 0 && <div style={{ ...S.rowSub, color: '#b91c1c' }}>{l.days_past_due} days late</div>}</td>
        <td><span style={{ color: '#047857' }}>{l.payment_performance?.on_time || 0} on time</span> · <span style={{ color: '#c2410c' }}>{l.payment_performance?.delayed || 0} delayed</span></td>
        <td><Pill value={l.status} /></td>
        <td><div style={S.actionRow}><button style={S.textBtn} onClick={() => onOpen(l)}>View</button>{!['fully_paid','cancelled'].includes(l.status) && <button style={S.textBtn} onClick={() => onPayment(l)}>Pay</button>}</div></td>
      </tr>)}
    </tbody></table>{!loans.length && <Empty>No loans match this filter.</Empty>}</div>
  </section>
}

function CollectionsView({ payments }) {
  return <section style={S.panel}>
    <div style={S.panelHead}><div><h3 style={S.panelTitle}>Collections</h3><p style={S.panelSub}>Recorded payments and receipt trail</p></div></div>
    <div style={S.tableWrap}><table style={S.table}><thead><tr><th>Date</th><th>Receipt</th><th>Borrower</th><th>Contract</th><th>Amount</th><th>Timing</th><th>Method</th></tr></thead><tbody>
      {payments.map(p => <tr key={p.public_id}><td>{prettyDate(p.payment_date)}</td><td><strong>{p.receipt_number}</strong></td><td>{p.borrower?.name || '—'}</td><td>{p.loan?.contract_number || '—'}</td><td><strong>{peso(p.amount)}</strong></td><td><Pill value={p.timeliness} /></td><td>{p.method || '—'}</td></tr>)}
    </tbody></table>{!payments.length && <Empty>No collections recorded yet.</Empty>}</div>
  </section>
}

function BorrowerForm({ borrower, onClose, onSave }) {
  const [form, setForm] = useState({
    name: borrower?.name || '', phone: borrower?.phone || '', email: borrower?.email || '', address: borrower?.address || '', id_number: borrower?.id_number || '', emergency_contact_name: borrower?.emergency_contact_name || '', emergency_contact_phone: borrower?.emergency_contact_phone || '', notes: borrower?.notes || '', status: borrower?.status || 'active',
  })
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const submit = async e => { e.preventDefault(); setSaving(true); setError(''); try { await onSave(form) } catch (x) { setError(x.message); setSaving(false) } }
  return <Modal title={borrower ? 'Edit borrower' : 'Add borrower'} onClose={onClose}>
    <form onSubmit={submit}>
      {error && <div style={S.error}>{error}</div>}
      <div style={S.formGrid2}>
        <Field label="Full name"><input required style={S.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Mobile number"><input style={S.input} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Email"><input type="email" style={S.input} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="ID number"><input style={S.input} value={form.id_number} onChange={e => setForm({ ...form, id_number: e.target.value })} /></Field>
        <Field label="Emergency contact"><input style={S.input} value={form.emergency_contact_name} onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} /></Field>
        <Field label="Emergency contact phone"><input style={S.input} value={form.emergency_contact_phone} onChange={e => setForm({ ...form, emergency_contact_phone: e.target.value })} /></Field>
      </div>
      <Field label="Address"><textarea style={S.textarea} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field>
      <Field label="Internal notes"><textarea style={S.textarea} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      {borrower && <Field label="Borrower status"><select style={S.input} value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option></select></Field>}
      <div style={S.modalActions}><button type="button" style={S.secondaryBtn} onClick={onClose}>Cancel</button><button disabled={saving} style={S.primaryBtn}>{saving ? 'Saving…' : 'Save borrower'}</button></div>
    </form>
  </Modal>
}

function LoanForm({ borrowers, branches, preselectedBorrower, onClose, onSave }) {
  const [form, setForm] = useState({ borrower_public_id: preselectedBorrower || '', branch_public_id: '', contract_number: '', principal_amount: '', interest_rate: '0', total_payable: '', installment_amount: '', installment_count: '12', payment_frequency: 'monthly', release_date: today(), first_due_date: '', notes: '' })
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const submit = async e => {
    e.preventDefault(); setSaving(true); setError('')
    const payload = { ...form, principal_amount: Number(form.principal_amount), interest_rate: Number(form.interest_rate || 0), installment_count: Number(form.installment_count), total_payable: form.total_payable ? Number(form.total_payable) : null, installment_amount: form.installment_amount ? Number(form.installment_amount) : null, first_due_date: form.first_due_date || null, contract_number: form.contract_number || null }
    try { await onSave(payload) } catch (x) { setError(x.message); setSaving(false) }
  }
  return <Modal title="Create loan" onClose={onClose} width={720}>
    <form onSubmit={submit}>
      {error && <div style={S.error}>{error}</div>}
      <div style={S.noteBox}>Enter either <strong>Total payable</strong> or <strong>Installment amount</strong>. If both are blank, Loyalty Tree computes total payable from principal + interest rate.</div>
      <div style={S.formGrid2}>
        <Field label="Borrower"><select required style={S.input} value={form.borrower_public_id} onChange={e => setForm({ ...form, borrower_public_id: e.target.value })}><option value="">Select borrower</option>{borrowers.filter(b => b.status !== 'blocked').map(b => <option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></Field>
        <Field label="Branch"><select style={S.input} value={form.branch_public_id} onChange={e => setForm({ ...form, branch_public_id: e.target.value })}><option value="">Main / unassigned</option>{(branches || []).filter(b => b.is_active !== false).map(b => <option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></Field>
        <Field label="Contract number" hint="Optional; generated automatically if blank"><input style={S.input} value={form.contract_number} onChange={e => setForm({ ...form, contract_number: e.target.value })} /></Field>
        <Field label="Principal amount"><input required min="0.01" step="0.01" type="number" style={S.input} value={form.principal_amount} onChange={e => setForm({ ...form, principal_amount: e.target.value })} /></Field>
        <Field label="Interest rate (%)" hint="Flat rate over the whole loan when Total payable is left blank"><input min="0" step="0.01" type="number" style={S.input} value={form.interest_rate} onChange={e => setForm({ ...form, interest_rate: e.target.value })} /></Field>
        <Field label="Total payable"><input min="0.01" step="0.01" type="number" style={S.input} value={form.total_payable} onChange={e => setForm({ ...form, total_payable: e.target.value })} /></Field>
        <Field label="Payment per installment"><input min="0.01" step="0.01" type="number" style={S.input} value={form.installment_amount} onChange={e => setForm({ ...form, installment_amount: e.target.value })} /></Field>
        <Field label="Number of payments"><input required min="1" max="1000" type="number" style={S.input} value={form.installment_count} onChange={e => setForm({ ...form, installment_count: e.target.value })} /></Field>
        <Field label="Payment frequency"><select style={S.input} value={form.payment_frequency} onChange={e => setForm({ ...form, payment_frequency: e.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Every 2 weeks</option><option value="semimonthly">Every 15 days</option><option value="monthly">Monthly</option></select></Field>
        <Field label="Release date"><input required type="date" style={S.input} value={form.release_date} onChange={e => setForm({ ...form, release_date: e.target.value })} /></Field>
        <Field label="First due date" hint="Optional; system derives it from frequency"><input type="date" style={S.input} value={form.first_due_date} onChange={e => setForm({ ...form, first_due_date: e.target.value })} /></Field>
      </div>
      <Field label="Loan notes"><textarea style={S.textarea} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      <div style={S.modalActions}><button type="button" style={S.secondaryBtn} onClick={onClose}>Cancel</button><button disabled={saving} style={S.primaryBtn}>{saving ? 'Creating…' : 'Create loan & schedule'}</button></div>
    </form>
  </Modal>
}

function PaymentForm({ loan, onClose, onSave }) {
  const [form, setForm] = useState({ amount: '', payment_date: today(), method: 'cash', reference_number: '', notes: '' })
  const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const submit = async e => { e.preventDefault(); setSaving(true); setError(''); try { await onSave({ ...form, amount: Number(form.amount) }) } catch (x) { setError(x.message); setSaving(false) } }
  return <Modal title={`Record payment · ${loan.contract_number}`} onClose={onClose}>
    <form onSubmit={submit}>
      {error && <div style={S.error}>{error}</div>}
      <div style={S.summaryStrip}><div><span>Borrower</span><strong>{loan.borrower?.name || '—'}</strong></div><div><span>Balance</span><strong>{peso(loan.balance_remaining)}</strong></div><div><span>Next due</span><strong>{prettyDate(loan.next_due_date)}</strong></div></div>
      <div style={S.formGrid2}>
        <Field label="Amount"><input required min="0.01" max={Number(loan.balance_remaining || 0)} step="0.01" type="number" style={S.input} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
        <Field label="Payment date"><input required type="date" style={S.input} value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} /></Field>
        <Field label="Method"><select style={S.input} value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="gcash">GCash</option><option value="maya">Maya</option><option value="check">Check</option><option value="other">Other</option></select></Field>
        <Field label="Reference number"><input style={S.input} value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><textarea style={S.textarea} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      <div style={S.modalActions}><button type="button" style={S.secondaryBtn} onClick={onClose}>Cancel</button><button disabled={saving} style={S.primaryBtn}>{saving ? 'Recording…' : 'Record payment'}</button></div>
    </form>
  </Modal>
}

function LoanDetail({ loan, onClose, onPayment, onDocument, onOpenDocument }) {
  return <Modal title={`Loan · ${loan.contract_number}`} onClose={onClose} width={900}>
    <div style={S.summaryStrip}><div><span>Borrower</span><strong>{loan.borrower?.name || '—'}</strong></div><div><span>Branch</span><strong>{loan.branch?.name || 'Main / unassigned'}</strong></div><div><span>Principal</span><strong>{peso(loan.principal_amount)}</strong></div><div><span>Remaining</span><strong>{peso(loan.balance_remaining)}</strong></div><div><span>Status</span><Pill value={loan.status} /></div></div>
    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}><button style={S.primaryBtn} onClick={onPayment} disabled={['fully_paid','cancelled'].includes(loan.status)}>Record payment</button><button style={S.secondaryBtn} onClick={onDocument}>Attach contract / image</button></div>
    <h3 style={S.sectionTitle}>Installment schedule</h3>
    <div style={{ ...S.tableWrap, maxHeight: 310 }}><table style={S.table}><thead><tr><th>#</th><th>Due</th><th>Expected</th><th>Paid</th><th>Status</th><th>Performance</th></tr></thead><tbody>{(loan.installments || []).map(i => <tr key={i.public_id}><td>{i.installment_number}</td><td>{prettyDate(i.due_date)}</td><td>{peso(i.amount_due)}</td><td>{peso(i.amount_paid)}</td><td><Pill value={i.status} /></td><td><Pill value={i.performance} /></td></tr>)}</tbody></table></div>
    <h3 style={S.sectionTitle}>Payments</h3>
    {(loan.payments || []).length ? <div style={S.tableWrap}><table style={S.table}><thead><tr><th>Date</th><th>Receipt</th><th>Amount</th><th>Timing</th><th>Balance after</th></tr></thead><tbody>{loan.payments.map(p => <tr key={p.public_id}><td>{prettyDate(p.payment_date)}</td><td>{p.receipt_number}</td><td>{peso(p.amount)}</td><td><Pill value={p.timeliness} /></td><td>{peso(p.balance_after)}</td></tr>)}</tbody></table></div> : <Empty>No payments yet.</Empty>}
    <h3 style={S.sectionTitle}>Contracts & documents</h3>
    {(loan.documents || []).length ? <div style={S.docGrid}>{loan.documents.map(d => <button type="button" key={d.public_id} onClick={() => onOpenDocument?.(d)} style={{...S.docCard,background:'#fff',cursor:'pointer',textAlign:'left'}}><strong>{d.title || d.document_type.replaceAll('_', ' ')}</strong><span>{d.file_name || d.mime_type || 'Open private file'}</span><small style={{color:'#64748b'}}>{d.has_private_file ? 'Private · owner access' : 'External document'}</small></button>)}</div> : <Empty>No documents attached yet.</Empty>}
  </Modal>
}

function DocumentForm({ loan, API_BASE, businessId, token, onClose, onUploaded }) {
  const [file, setFile] = useState(null); const [type, setType] = useState('signed_contract'); const [title, setTitle] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('')
  const submit = async e => {
    e.preventDefault(); if (!file) return
    setSaving(true); setError('')
    try {
      const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
      if (!allowed.includes(file.type)) throw new Error('Use a PDF, JPG, PNG, or WEBP file.')
      if (file.size > 10 * 1024 * 1024) throw new Error('Maximum document size is 10 MB.')
      const q = new URLSearchParams({ document_type: type, file_name: file.name, mime_type: file.type })
      if (title.trim()) q.set('title', title.trim())
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/lending/loans/${loan.public_id}/documents/upload?${q.toString()}`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': file.type },
        body: file,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail || `Document upload failed (${res.status})`)
      await onUploaded?.(data)
    } catch (x) {
      setError(x.message); setSaving(false)
    }
  }
  return <Modal title={`Attach private document · ${loan.contract_number}`} onClose={onClose}>
    <form onSubmit={submit}>{error && <div style={S.error}>{error}</div>}
      <div style={S.noteBox}>Contracts, IDs and receipts are stored in a private Lending bucket and opened only through an authenticated owner session.</div>
      <Field label="Document type"><select style={S.input} value={type} onChange={e => setType(e.target.value)}><option value="signed_contract">Signed contract</option><option value="promissory_note">Promissory note</option><option value="borrower_id">Borrower ID</option><option value="proof_of_address">Proof of address</option><option value="proof_of_release">Proof of release</option><option value="collateral">Collateral image</option><option value="payment_receipt">Payment receipt</option><option value="other">Other</option></select></Field>
      <Field label="Title"><input style={S.input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional label" /></Field>
      <Field label="PDF or image" hint="PDF, JPG, PNG or WEBP · maximum 10 MB"><input required type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} style={S.input} /></Field>
      <div style={S.modalActions}><button type="button" style={S.secondaryBtn} onClick={onClose}>Cancel</button><button disabled={saving || !file} style={S.primaryBtn}>{saving ? 'Uploading privately…' : 'Upload & attach'}</button></div>
    </form>
  </Modal>
}

const S = {
  page: { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  header: { padding: '24px clamp(18px,4vw,52px)', display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'center', background: '#fff', borderBottom: '1px solid #e2e8f0' },
  eyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: 800, color: '#2563eb' }, title: { margin: '4px 0', fontSize: 27 }, subtitle: { color: '#64748b', fontSize: 13 },
  nav: { padding: '0 clamp(18px,4vw,52px)', display: 'flex', gap: 4, background: '#fff', borderBottom: '1px solid #e2e8f0', overflowX: 'auto' },
  navBtn: { padding: '14px 16px', border: 0, borderBottom: '2px solid transparent', background: 'transparent', cursor: 'pointer', color: '#64748b', fontWeight: 700 }, navBtnActive: { color: '#1d4ed8', borderBottomColor: '#2563eb' },
  main: { padding: '24px clamp(18px,4vw,52px) 60px', maxWidth: 1500, margin: '0 auto' }, loading: { padding: 60, textAlign: 'center', color: '#64748b' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }, statCard: { padding: 18, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14 }, statLabel: { color: '#64748b', fontSize: 12, display: 'block', marginBottom: 8 }, statValue: { fontSize: 24 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 18 }, panel: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 20 }, panelHead: { display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 16 }, panelTitle: { margin: 0, fontSize: 18 }, panelSub: { margin: '4px 0 0', color: '#64748b', fontSize: 12 },
  primaryBtn: { border: 0, background: '#1d4ed8', color: '#fff', padding: '10px 14px', borderRadius: 9, cursor: 'pointer', fontWeight: 700 }, secondaryBtn: { border: '1px solid #cbd5e1', background: '#fff', color: '#334155', padding: '9px 13px', borderRadius: 9, cursor: 'pointer', fontWeight: 650 }, textBtn: { border: 0, background: 'transparent', color: '#1d4ed8', cursor: 'pointer', fontWeight: 700, padding: 4 }, actionRow: { display: 'flex', gap: 7, justifyContent: 'flex-end' },
  tableWrap: { overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 12 }, table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 }, rowSub: { color: '#64748b', fontSize: 11, marginTop: 4 },
  rowButton: { width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, textAlign: 'left', padding: '13px 0', border: 0, borderBottom: '1px solid #f1f5f9', background: 'transparent', cursor: 'pointer' },
  pill: { display: 'inline-flex', alignItems: 'center', padding: '4px 8px', borderRadius: 99, fontSize: 11, fontWeight: 800, textTransform: 'capitalize' }, behaviorGrid: { display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 10 }, behavior: { padding: 14, borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 3 },
  noteBox: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, color: '#475569', fontSize: 12, lineHeight: 1.5, margin: '14px 0' },
  filterBtn: { border: '1px solid #e2e8f0', background: '#fff', borderRadius: 99, padding: '7px 11px', cursor: 'pointer', textTransform: 'capitalize', color: '#64748b' }, filterBtnActive: { borderColor: '#93c5fd', background: '#eff6ff', color: '#1d4ed8' },
  overlay: { position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.55)', padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }, modal: { maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', background: '#fff', borderRadius: 16, padding: 22, boxShadow: '0 24px 80px rgba(15,23,42,.25)' }, modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }, modalTitle: { margin: 0, fontSize: 20 }, iconBtn: { width: 34, height: 34, borderRadius: 50, border: '1px solid #e2e8f0', background: '#fff', fontSize: 22, cursor: 'pointer' },
  formGrid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }, field: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }, label: { fontSize: 12, color: '#475569', fontWeight: 700 }, hint: { color: '#94a3b8', fontSize: 10 }, input: { padding: '10px 11px', border: '1px solid #cbd5e1', borderRadius: 8, font: 'inherit', boxSizing: 'border-box', width: '100%', background: '#fff' }, textarea: { padding: '10px 11px', border: '1px solid #cbd5e1', borderRadius: 8, minHeight: 80, resize: 'vertical', font: 'inherit' }, modalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
  error: { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 9, padding: 10, marginBottom: 12, fontSize: 12 }, toast: { position: 'fixed', zIndex: 1200, top: 18, right: 18, background: '#0f172a', color: '#fff', padding: '11px 14px', borderRadius: 10, boxShadow: '0 12px 30px rgba(15,23,42,.2)', fontSize: 13 },
  summaryStrip: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10, background: '#f8fafc', borderRadius: 12, padding: 14, marginBottom: 16 }, sectionTitle: { fontSize: 14, margin: '22px 0 10px' }, docGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }, docCard: { border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, textDecoration: 'none', color: '#0f172a', display: 'flex', flexDirection: 'column', gap: 5 }, empty: { padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 },
}

// Table cell styling without a CSS dependency.
if (typeof document !== 'undefined' && !document.getElementById('lt-lending-table-style')) {
  const el = document.createElement('style'); el.id = 'lt-lending-table-style'; el.textContent = `table th,table td{padding:11px 12px;border-bottom:1px solid #eef2f7;text-align:left;vertical-align:middle}table th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;background:#f8fafc;position:sticky;top:0}table tbody tr:last-child td{border-bottom:0}@media(max-width:720px){table{min-width:760px}}`; document.head.appendChild(el)
}
