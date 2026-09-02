import React, { useEffect, useState } from 'react'

const STATUSES = ['requested','design_confirmed','printing','ready_to_ship','shipped','completed','cancelled']
const pretty = v => String(v || '').replaceAll('_',' ').replace(/\b\w/g, m=>m.toUpperCase())
const money = v => `₱${Number(v || 0).toLocaleString('en-PH',{maximumFractionDigits:2})}`

function GiftCardPrintRequestsAdmin({ API_BASE, token }) {
  const [data,setData]=useState({requests:[],summary:{}})
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [saving,setSaving]=useState('')
  const headers = token ? { Authorization:`Bearer ${token}` } : {}

  const load=async()=>{
    setLoading(true);setError('')
    try{
      const r=await fetch(`${API_BASE}/api/v1/admin/gift-card-print-requests`,{headers})
      const j=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(j.detail||'Could not load Gift Card printing requests')
      setData(j)
    }catch(e){setError(e.message||'Could not load printing requests')}
    finally{setLoading(false)}
  }
  useEffect(()=>{load()},[API_BASE,token])

  const changeStatus=async(req,status)=>{
    setSaving(req.public_id);setError('')
    let admin_note=req.admin_note||''
    if(status==='cancelled') admin_note=window.prompt('Cancellation / admin note',admin_note)||admin_note
    try{
      const r=await fetch(`${API_BASE}/api/v1/admin/gift-card-print-requests/${req.public_id}`,{
        method:'PATCH',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({status,admin_note:admin_note||null})
      })
      const j=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(j.detail||'Update failed')
      await load()
    }catch(e){setError(e.message||'Update failed')}
    finally{setSaving('')}
  }

  const download=async req=>{
    const r=await fetch(`${API_BASE}/api/v1/admin/gift-card-batches/${req.batch_public_id}/print.pdf`,{headers})
    if(!r.ok){const j=await r.json().catch(()=>({}));return setError(j.detail||'Print PDF failed')}
    const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url;a.download=`${req.business_name||'business'}_${req.batch_public_id}_gift_cards.pdf`;a.click();URL.revokeObjectURL(url)
  }

  return <section style={S.section}>
    <div style={S.head}><div><div style={S.eyebrow}>LOYALTY TREE FULFILLMENT</div><h2 style={S.h2}>🎁 Gift Card Printing</h2><p style={S.muted}>Physical Gift Card requests are tied to the exact generated QR inventory. Cards remain unactivated until sold.</p></div><button style={S.refresh} onClick={load}>Refresh</button></div>
    {error&&<div style={S.error}>{error}</div>}
    <div style={S.stats}><Stat label="New requests" value={data.summary?.new||0}/><Stat label="In production" value={data.summary?.printing||0}/><Stat label="Ready to ship" value={data.summary?.ready_to_ship||0}/><Stat label="Completed" value={data.summary?.completed||0}/></div>
    {loading?<div style={S.empty}>Loading printing requests…</div>:<div style={S.list}>
      {(data.requests||[]).map(r=><article key={r.public_id} style={S.card}>
        <div style={S.cardTop}><div><b style={S.biz}>{r.business_name||'Business'}</b><div style={S.code}>{r.public_id} · Batch {r.batch_public_id}</div></div><span style={S.status}>{pretty(r.status)}</span></div>
        <div style={S.details}>
          <div><small>Gift Card</small><b>{r.batch_name||'Gift Card'}</b></div>
          <div><small>Quantity</small><b>{r.quantity||r.batch_quantity||0}</b></div>
          <div><small>Face value</small><b>{r.gift_type==='amount'?money(r.face_value):`${r.item_quantity||''} × ${r.item_name||'item'}`}</b></div>
          <div><small>Print format</small><b>{pretty(r.print_format||'business_card')}</b></div>
        </div>
        <div style={S.delivery}><b>Deliver to</b><div>{r.delivery_name||'—'} · {r.delivery_phone||'—'}</div><div>{r.delivery_address||'No address provided'}</div>{r.delivery_notes&&<div style={S.note}>Note: {r.delivery_notes}</div>}</div>
        <div style={S.actions}><button style={S.pdf} onClick={()=>download(r)}>Download Print PDF</button><select disabled={saving===r.public_id} style={S.select} value={r.status||'requested'} onChange={e=>changeStatus(r,e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{pretty(s)}</option>)}</select></div>
      </article>)}
      {!(data.requests||[]).length&&<div style={S.empty}>No Gift Card printing requests yet.</div>}
    </div>}
  </section>
}
function Stat({label,value}){return <div style={S.stat}><small>{label}</small><b>{value}</b></div>}
const S={section:{margin:'22px 24px',padding:20,background:'#fff',border:'1px solid #e2e8f0',borderRadius:16},head:{display:'flex',justifyContent:'space-between',gap:15,alignItems:'flex-start',flexWrap:'wrap'},eyebrow:{fontSize:10,fontWeight:900,letterSpacing:1.4,color:'#0d9488'},h2:{margin:'5px 0',color:'#0f172a'},muted:{margin:0,color:'#64748b',fontSize:13,maxWidth:720,lineHeight:1.5},refresh:{border:'1px solid #cbd5e1',background:'#fff',borderRadius:9,padding:'9px 12px',cursor:'pointer',fontWeight:700},error:{marginTop:12,padding:10,background:'#fef2f2',color:'#b91c1c',borderRadius:9},stats:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,margin:'16px 0'},stat:{border:'1px solid #e2e8f0',borderRadius:12,padding:13,display:'flex',flexDirection:'column',gap:5},list:{display:'grid',gap:12},card:{border:'1px solid #e2e8f0',borderRadius:14,padding:15},cardTop:{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start'},biz:{fontSize:15,color:'#0f172a'},code:{fontSize:10,color:'#94a3b8',marginTop:3,fontFamily:'monospace'},status:{fontSize:10,fontWeight:900,background:'#ecfdf5',color:'#047857',padding:'5px 8px',borderRadius:999},details:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:10,marginTop:13},delivery:{marginTop:13,padding:12,borderRadius:10,background:'#f8fafc',fontSize:12,color:'#475569',lineHeight:1.5},note:{marginTop:4,fontStyle:'italic'},actions:{display:'flex',gap:8,justifyContent:'flex-end',marginTop:13,flexWrap:'wrap'},pdf:{background:'#0f172a',color:'#fff',border:0,borderRadius:9,padding:'9px 11px',fontWeight:800,cursor:'pointer'},select:{padding:'9px 10px',border:'1px solid #cbd5e1',borderRadius:9,background:'#fff'},empty:{padding:24,textAlign:'center',color:'#94a3b8'}}
export default GiftCardPrintRequestsAdmin
