import React, { useEffect, useMemo, useState } from 'react'

const money = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const STATUS_LABELS = {
  unactivated: 'Unactivated', active_unclaimed: 'Active · Unclaimed', active_claimed: 'Active · Claimed',
  partially_redeemed: 'Partially redeemed', redeemed: 'Redeemed', expired: 'Expired', voided: 'Voided'
}

function GiftCards({ API_BASE, user, enabled = true, plan = '' }) {
  const [overview, setOverview] = useState(null)
  const [cards, setCards] = useState([])
  const [batches, setBatches] = useState([])
  const [printRequests, setPrintRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState('all')
  const [form, setForm] = useState({
    name: 'Gift Card', gift_type: 'amount', face_value: 500, item_name: '', item_quantity: 1,
    quantity: 1, expires_at: '', print_option: 'digital', print_format: 'business_card',
    activation_mode: 'active', purchaser_name: '', purchaser_email: '', recipient_name: '', recipient_phone: '',
    gift_message: '', delivery_name: '', delivery_phone: '', delivery_address: '', delivery_notes: ''
  })

  const headers = { ...(user?.token ? { Authorization: `Bearer ${user.token}` } : {}) }
  const api = async (path, options = {}) => fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } })

  const load = async () => {
    if (!user?.business_slug) return
    setLoading(true); setError('')
    try {
      const base = `/api/v1/business/${user.business_slug}`
      const [oRes, cRes, bRes] = await Promise.all([
        api(`${base}/gift-cards/overview`), api(`${base}/gift-cards`), api(`${base}/gift-card-batches`)
      ])
      const o = await oRes.json().catch(() => ({}))
      const c = await cRes.json().catch(() => ({}))
      const b = await bRes.json().catch(() => ({}))
      if (!oRes.ok) throw new Error(o.detail || 'Gift Cards database is not ready')
      setOverview(o)
      setCards(Array.isArray(c.cards) ? c.cards : [])
      setBatches(Array.isArray(b.batches) ? b.batches : [])
      setPrintRequests(Array.isArray(b.print_requests) ? b.print_requests : [])
    } catch (e) { setError(e.message || 'Could not load Gift Cards') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [user?.business_slug])

  const filtered = useMemo(() => cards.filter(c => filter === 'all' || c.status === filter), [cards, filter])
  const canCreate = enabled && overview?.feature_enabled !== false

  const createBatch = async (e) => {
    e.preventDefault(); if (!canCreate) return
    setSaving(true); setError(''); setMessage('')
    const payload = {
      name: form.name.trim() || 'Gift Card', gift_type: form.gift_type,
      face_value: form.gift_type === 'amount' ? Number(form.face_value || 0) : null,
      item_name: form.gift_type === 'item' ? form.item_name.trim() : null,
      item_quantity: form.gift_type === 'item' ? Number(form.item_quantity || 1) : null,
      quantity: Math.max(1, Number(form.quantity || 1)), expires_at: form.expires_at || null,
      print_option: form.print_option, print_format: form.print_format,
      activation_mode: form.print_option === 'digital' ? form.activation_mode : 'unactivated',
      purchaser_name: form.purchaser_name || null, purchaser_email: form.purchaser_email || null,
      recipient_name: form.recipient_name || null, recipient_phone: form.recipient_phone || null,
      gift_message: form.gift_message || null,
      delivery_recipient_name: form.print_option === 'loyaltytree' ? form.delivery_name || null : null,
      delivery_contact_number: form.print_option === 'loyaltytree' ? form.delivery_phone || null : null,
      delivery_address: form.print_option === 'loyaltytree' ? form.delivery_address || null : null,
      delivery_instructions: form.print_option === 'loyaltytree' ? form.delivery_notes || null : null,
    }
    try {
      const res = await api(`/api/v1/business/${user.business_slug}/gift-card-batches`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Could not create Gift Cards')
      setMessage(`${data.cards_created || payload.quantity} Gift Card${payload.quantity === 1 ? '' : 's'} generated.`)
      setShowCreate(false); await load()
    } catch (e) { setError(e.message || 'Could not create Gift Cards') }
    finally { setSaving(false) }
  }

  const activate = async card => {
    if (!window.confirm(`Activate ${card.code}? Once activated, its value can be redeemed.`)) return
    const res = await api(`/api/v1/business/${user.business_slug}/gift-cards/${card.public_id}/activate`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.detail || 'Activation failed')
    setMessage(`${card.code} activated.`); load()
  }

  const voidCard = async card => {
    if (!window.confirm(`Void ${card.code}? This prevents any future redemption.`)) return
    const res = await api(`/api/v1/business/${user.business_slug}/gift-cards/${card.public_id}/void`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return setError(data.detail || 'Could not void Gift Card')
    setMessage(`${card.code} voided.`); load()
  }

  const copyLink = async card => {
    const url = `${API_BASE}/gift/${card.public_id}`
    await navigator.clipboard.writeText(url)
    setMessage('Gift Card link copied.')
  }

  const download = async (batch, kind = 'print') => {
    const suffix = kind === 'manifest' ? 'manifest' : 'print.pdf'
    const res = await api(`/api/v1/business/${user.business_slug}/gift-card-batches/${batch.public_id}/${suffix}`)
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.detail || 'Download failed') }
    if (kind === 'manifest') {
      const d = await res.json(); const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${batch.public_id}_manifest.json`; a.click(); URL.revokeObjectURL(url)
      return
    }
    const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${batch.public_id}_gift_cards.pdf`; a.click(); URL.revokeObjectURL(url)
  }

  if (loading) return <div style={S.state}>Loading Gift Cards…</div>

  if (!enabled && !cards.length) return <section style={S.locked}>
    <div style={{fontSize:42}}>🎁</div><h2 style={S.h2}>Gift Cards</h2>
    <p style={S.muted}>Digital and printable Gift Cards are available on Growth and Pro plans.</p>
    <div style={S.growthBadge}>GROWTH FEATURE</div>
  </section>

  return <div style={S.page}>
    <div style={S.header}>
      <div><div style={S.eyebrow}>GIFT CARDS</div><h2 style={S.h2}>Sell value now. Redeem it later.</h2><p style={S.muted}>Issue peso-value or item/service Gift Cards, print physical inventory, and track every redemption.</p></div>
      <button style={canCreate ? S.primary : S.disabled} disabled={!canCreate} onClick={() => setShowCreate(v => !v)}>+ Create Gift Cards</button>
    </div>

    {!canCreate && cards.length > 0 && <div style={S.warning}>Your existing Gift Cards remain usable, but creating new cards is locked until this business is on Growth or Pro.</div>}
    {error && <div style={S.error}>{error}</div>}{message && <div style={S.success}>{message}</div>}

    <div style={S.stats}>
      <Stat label="Available / Active" value={overview?.available_cards ?? 0} sub="Usable Gift Cards" />
      <Stat label="Outstanding Value" value={money(overview?.outstanding_value)} sub="Unused peso balance" />
      <Stat label="Redeemed Value" value={money(overview?.redeemed_value)} sub="Peso value already used" />
      <Stat label="Fully Redeemed" value={overview?.fully_redeemed ?? 0} sub="Cards with nothing left" />
      <Stat label="Printed Stock" value={overview?.unactivated_stock ?? 0} sub="Unactivated physical inventory" />
    </div>

    {showCreate && canCreate && <form onSubmit={createBatch} style={S.form}>
      <div style={S.formTitle}>Create Gift Card batch</div>
      <div style={S.grid2}>
        <Field label="Gift Card name"><input style={S.input} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} /></Field>
        <Field label="Type"><select style={S.input} value={form.gift_type} onChange={e=>setForm({...form,gift_type:e.target.value})}><option value="amount">Peso value</option><option value="item">Item / service</option></select></Field>
        {form.gift_type === 'amount' ? <Field label="Value per card"><div style={S.moneyInput}><span>₱</span><input style={{...S.input,border:0}} type="number" min="1" step="0.01" value={form.face_value} onChange={e=>setForm({...form,face_value:e.target.value})}/></div></Field> : <>
          <Field label="Item / service"><input style={S.input} placeholder="e.g. Large Brewed Coffee" value={form.item_name} onChange={e=>setForm({...form,item_name:e.target.value})} required /></Field>
          <Field label="Uses per card"><input style={S.input} type="number" min="1" value={form.item_quantity} onChange={e=>setForm({...form,item_quantity:e.target.value})}/></Field>
        </>}
        <Field label="How many cards"><input style={S.input} type="number" min="1" max="500" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></Field>
        <Field label="Expiration (optional)"><input style={S.input} type="date" value={form.expires_at} onChange={e=>setForm({...form,expires_at:e.target.value})}/></Field>
        <Field label="Delivery / print option"><select style={S.input} value={form.print_option} onChange={e=>setForm({...form,print_option:e.target.value})}><option value="digital">Digital only</option><option value="self">I will print them myself</option><option value="loyaltytree">Request Loyalty Tree printing</option></select></Field>
        {form.print_option !== 'digital' && <Field label="Print format"><select style={S.input} value={form.print_format} onChange={e=>setForm({...form,print_format:e.target.value})}><option value="business_card">Business-card size</option><option value="a4">A4 sheet</option><option value="letter">Letter sheet</option></select></Field>}
        {form.print_option === 'digital' && <Field label="Initial status"><select style={S.input} value={form.activation_mode} onChange={e=>setForm({...form,activation_mode:e.target.value})}><option value="active">Active immediately</option><option value="unactivated">Activate later at cashier</option></select></Field>}
      </div>
      {Number(form.quantity) === 1 && <div style={S.grid2}>
        <Field label="Purchaser name (optional)"><input style={S.input} value={form.purchaser_name} onChange={e=>setForm({...form,purchaser_name:e.target.value})}/></Field>
        <Field label="Recipient name (optional)"><input style={S.input} value={form.recipient_name} onChange={e=>setForm({...form,recipient_name:e.target.value})}/></Field>
        <Field label="Gift message (optional)"><input style={S.input} value={form.gift_message} onChange={e=>setForm({...form,gift_message:e.target.value})}/></Field>
      </div>}
      {form.print_option === 'loyaltytree' && <div style={S.delivery}>
        <strong>Printing & delivery request</strong><div style={S.grid2}>
          <Field label="Recipient / business"><input required style={S.input} value={form.delivery_name} onChange={e=>setForm({...form,delivery_name:e.target.value})}/></Field>
          <Field label="Contact number"><input required style={S.input} value={form.delivery_phone} onChange={e=>setForm({...form,delivery_phone:e.target.value})}/></Field>
          <Field label="Delivery address"><textarea required style={{...S.input,minHeight:82}} value={form.delivery_address} onChange={e=>setForm({...form,delivery_address:e.target.value})}/></Field>
          <Field label="Instructions (optional)"><textarea style={{...S.input,minHeight:82}} value={form.delivery_notes} onChange={e=>setForm({...form,delivery_notes:e.target.value})}/></Field>
        </div><p style={S.small}>These cards are generated as <b>UNACTIVATED</b> inventory. They carry no usable value until the cashier activates the exact serial after sale.</p>
      </div>}
      <div style={S.actions}><button type="button" style={S.secondary} onClick={()=>setShowCreate(false)}>Cancel</button><button disabled={saving} style={S.primary}>{saving?'Generating…':'Generate Gift Cards'}</button></div>
    </form>}

    <section style={S.section}>
      <div style={S.sectionHead}><div><h3 style={S.h3}>Gift Card inventory</h3><p style={S.muted}>Every QR maps to one server-side balance or item quantity.</p></div><select style={S.filter} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
      <div style={S.tableWrap}><table style={S.table}><thead><tr><th>Gift Card</th><th>Status</th><th>Original</th><th>Remaining</th><th>Actions</th></tr></thead><tbody>
        {filtered.map(c => <tr key={c.public_id}><td><b>{c.name}</b><div style={S.code}>{c.code}</div></td><td><span style={S.status}>{STATUS_LABELS[c.status] || c.status}</span></td><td>{c.gift_type==='amount'?money(c.original_amount):`${c.original_quantity} × ${c.item_name}`}</td><td><b>{c.gift_type==='amount'?money(c.remaining_amount):`${c.remaining_quantity} / ${c.original_quantity}`}</b></td><td><div style={S.rowActions}><button onClick={()=>window.open(`${API_BASE}/gift/${c.public_id}`,'_blank')} style={S.tiny}>Open</button><button onClick={()=>copyLink(c)} style={S.tiny}>Copy link</button>{c.status==='unactivated'&&<button onClick={()=>activate(c)} style={S.tinyPrimary}>Activate</button>}{!['redeemed','voided','expired'].includes(c.status)&&<button onClick={()=>voidCard(c)} style={S.tinyDanger}>Void</button>}</div></td></tr>)}
        {!filtered.length && <tr><td colSpan="5" style={S.empty}>No Gift Cards in this view.</td></tr>}
      </tbody></table></div>
    </section>

    <section style={S.section}>
      <h3 style={S.h3}>Batches & printing</h3><p style={S.muted}>Printed batches use the exact QR inventory stored in LoyaltyTree.</p>
      <div style={S.batchGrid}>{batches.map(b => <div key={b.public_id} style={S.batchCard}><div style={S.batchTop}><b>{b.name}</b><span style={S.badge}>{b.quantity} cards</span></div><div style={S.small}>{b.gift_type === 'amount' ? `${money(b.face_value)} each` : `${b.item_quantity} × ${b.item_name}`}</div><div style={S.small}>Print: {b.print_option === 'loyaltytree' ? 'Loyalty Tree requested' : b.print_option === 'self' ? 'Self print' : 'Digital'}</div><div style={S.rowActions}><button style={S.tiny} onClick={()=>download(b,'manifest')}>Manifest</button>{b.print_option !== 'digital'&&<button style={S.tinyPrimary} onClick={()=>download(b,'print')}>Print PDF</button>}</div></div>)}</div>
      {!!printRequests.length && <div style={{marginTop:18}}><b>Printing requests</b>{printRequests.map(r=><div key={r.public_id} style={S.requestRow}><span>{r.public_id}</span><span>{String(r.status||'requested').replaceAll('_',' ')}</span></div>)}</div>}
    </section>
  </div>
}

function Stat({label,value,sub}) { return <div style={S.stat}><div style={S.statLabel}>{label}</div><div style={S.statValue}>{value}</div><div style={S.statSub}>{sub}</div></div> }
function Field({label,children}) { return <label style={S.field}><span style={S.label}>{label}</span>{children}</label> }

const S = {
  page:{padding:'4px 0 40px'}, state:{padding:40,textAlign:'center',color:'#64748b'}, locked:{padding:40,textAlign:'center',background:'#fff',border:'1px solid #e2e8f0',borderRadius:20},
  header:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:18,flexWrap:'wrap',marginBottom:18}, eyebrow:{fontSize:11,fontWeight:900,letterSpacing:1.5,color:'#0f766e'}, h2:{margin:'5px 0 6px',fontSize:28,color:'#0f172a'}, h3:{margin:'0 0 5px',fontSize:19,color:'#0f172a'}, muted:{margin:0,color:'#64748b',fontSize:14,lineHeight:1.55},
  primary:{border:0,borderRadius:12,padding:'12px 17px',background:'#0d9488',color:'#fff',fontWeight:800,cursor:'pointer'}, secondary:{border:'1px solid #d8e1e8',borderRadius:12,padding:'12px 17px',background:'#fff',color:'#334155',fontWeight:750,cursor:'pointer'}, disabled:{border:0,borderRadius:12,padding:'12px 17px',background:'#cbd5e1',color:'#64748b',fontWeight:800,cursor:'not-allowed'},
  growthBadge:{display:'inline-block',marginTop:10,padding:'7px 10px',borderRadius:999,background:'#ecfdf5',color:'#047857',fontSize:11,fontWeight:900,letterSpacing:1}, warning:{padding:13,borderRadius:12,background:'#fff7ed',border:'1px solid #fed7aa',color:'#9a3412',marginBottom:14}, error:{padding:12,borderRadius:10,background:'#fef2f2',color:'#b91c1c',marginBottom:12}, success:{padding:12,borderRadius:10,background:'#ecfdf5',color:'#047857',marginBottom:12},
  stats:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:12,marginBottom:20}, stat:{background:'#fff',border:'1px solid #dce8e6',borderRadius:16,padding:17,boxShadow:'0 8px 22px rgba(15,23,42,.04)'}, statLabel:{fontSize:12,fontWeight:800,color:'#64748b'}, statValue:{fontSize:27,fontWeight:900,color:'#0f766e',margin:'6px 0 2px'}, statSub:{fontSize:11,color:'#94a3b8'},
  form:{background:'#fff',border:'1px solid #cfe8e3',borderRadius:18,padding:20,marginBottom:20}, formTitle:{fontSize:18,fontWeight:900,color:'#0f172a',marginBottom:16}, grid2:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:13}, field:{display:'flex',flexDirection:'column',gap:6}, label:{fontSize:12,fontWeight:800,color:'#334155'}, input:{boxSizing:'border-box',width:'100%',padding:'11px 12px',border:'1px solid #d7e0e7',borderRadius:10,fontSize:14,fontFamily:'inherit',background:'#fff'}, moneyInput:{display:'flex',alignItems:'center',border:'1px solid #d7e0e7',borderRadius:10,paddingLeft:12}, delivery:{marginTop:16,padding:15,borderRadius:14,background:'#f0fdfa',border:'1px solid #99f6e4'}, small:{fontSize:12,color:'#64748b',lineHeight:1.5,marginTop:5}, actions:{display:'flex',justifyContent:'flex-end',gap:9,marginTop:17},
  section:{background:'#fff',border:'1px solid #dce8e6',borderRadius:18,padding:18,marginTop:16}, sectionHead:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'flex-end',flexWrap:'wrap'}, filter:{padding:'9px 11px',border:'1px solid #d7e0e7',borderRadius:10,background:'#fff'}, tableWrap:{overflowX:'auto',marginTop:13}, table:{width:'100%',borderCollapse:'collapse',fontSize:13}, code:{fontFamily:'monospace',fontSize:11,color:'#94a3b8',marginTop:3}, status:{display:'inline-block',padding:'5px 8px',borderRadius:999,background:'#f1f5f9',fontSize:11,fontWeight:800,color:'#475569'}, rowActions:{display:'flex',gap:6,flexWrap:'wrap'}, tiny:{border:'1px solid #d8e1e8',background:'#fff',color:'#334155',borderRadius:8,padding:'7px 9px',fontSize:11,fontWeight:750,cursor:'pointer'}, tinyPrimary:{border:0,background:'#0d9488',color:'#fff',borderRadius:8,padding:'7px 9px',fontSize:11,fontWeight:800,cursor:'pointer'}, tinyDanger:{border:'1px solid #fecaca',background:'#fff',color:'#b91c1c',borderRadius:8,padding:'7px 9px',fontSize:11,fontWeight:750,cursor:'pointer'}, empty:{padding:24,textAlign:'center',color:'#94a3b8'},
  batchGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10,marginTop:13}, batchCard:{border:'1px solid #e2e8f0',borderRadius:13,padding:13}, batchTop:{display:'flex',justifyContent:'space-between',gap:8}, badge:{fontSize:10,fontWeight:850,background:'#ecfdf5',color:'#047857',borderRadius:999,padding:'4px 7px'}, requestRow:{display:'flex',justifyContent:'space-between',gap:12,padding:'10px 0',borderBottom:'1px solid #eef2f7',fontSize:12}
}

export default GiftCards
