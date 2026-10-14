import React, { useEffect, useState } from 'react'

const blank = () => ({ code:'', title:'Free business trial', trial_days:7, starts_on:new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}), ends_on:new Date(Date.now()+30*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}), max_redemptions:'', country_code:'PH', eligible_email:'', is_public:false, show_popup:false, is_active:true })
const input = {padding:10,border:'1px solid #cbd5e1',borderRadius:8,width:'100%',boxSizing:'border-box'}
const date = value => value ? new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila'}) : '—'
export default function TrialCouponsAdmin({API_BASE,token}) {
  const [rows,setRows]=useState([]), [form,setForm]=useState(blank), [editing,setEditing]=useState(null)
  const [error,setError]=useState(''), [busy,setBusy]=useState(false), [query,setQuery]=useState('')
  const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
  async function load() {
    try { const r=await fetch(`${API_BASE}/api/v1/admin/trial-coupons`,{headers}); const d=await r.json(); if(!r.ok)throw Error(d.detail||'Could not load coupons. Apply trial_coupons.sql first.'); setRows(d) }
    catch(e){setError(e.message)}
  }
  useEffect(()=>{load()},[API_BASE,token])
  async function save(e) {
    e.preventDefault();setBusy(true);setError('')
    try {
      const payload={...form,trial_days:Number(form.trial_days),max_redemptions:form.max_redemptions?Number(form.max_redemptions):null,country_code:form.country_code||null,eligible_email:form.eligible_email||null}
      const r=await fetch(`${API_BASE}/api/v1/admin/trial-coupons${editing?`/${editing}`:''}`,{method:editing?'PUT':'POST',headers,body:JSON.stringify(payload)})
      const d=await r.json();if(!r.ok)throw Error(typeof d.detail==='string'?d.detail:'Check the coupon fields.');setEditing(null);setForm(blank());await load()
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  const field=(key,label,type='text')=><label style={{display:'grid',gap:6}}>{label}<input style={input} type={type} value={form[key]??''} required={['code','title','starts_on','ends_on','trial_days'].includes(key)} min={type==='number'?1:undefined} max={key==='trial_days'?90:undefined} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}/></label>
  return <section className="trial-coupons-admin" style={{background:'white',padding:24,borderRadius:16,fontFamily:'system-ui, sans-serif',color:'#0f172a'}}>
    <style>{`.trial-coupons-admin button{padding:10px 16px;border:1px solid #cbd5e1;border-radius:8px;background:#f0fdf4;color:#166534;font-weight:700;cursor:pointer;margin-right:8px}.trial-coupons-admin button:disabled{opacity:.6;cursor:wait}.trial-coupons-admin th,.trial-coupons-admin td{padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap}.trial-coupons-admin th{background:#f8fafc}`}</style>
    <h2>Business trial coupons</h2><p>One trial per new business. Redemption dates use Philippine time; trials start at signup. Private codes are shared manually.</p>
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    <form onSubmit={save} style={{display:'grid',gap:16}}>
      <h3>{editing?'Edit coupon':'Create coupon'}</h3>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>
        {field('code','Coupon code')}{field('title','Promotion title')}{field('trial_days','Free trial days','number')}{field('starts_on','Redeem from','date')}{field('ends_on','Redeem through (inclusive)','date')}{field('max_redemptions','Maximum uses (blank = unlimited)','number')}{field('eligible_email','Specific business email (optional)')}
        <label>Country<select style={input} value={form.country_code||''} onChange={e=>setForm(f=>({...f,country_code:e.target.value}))}><option value="PH">Philippines</option><option value="">All countries</option></select></label>
      </div>
      {['is_active','is_public','show_popup'].map((key,i)=><label key={key}><input type="checkbox" checked={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.checked}))}/> {['Enabled for new redemptions','Public promotion','Show scheduled homepage popup'][i]}</label>)}
      <div><button disabled={busy} type="submit">{busy?'Saving…':editing?'Save changes':'Create coupon'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setForm(blank())}}>Cancel</button>}</div>
    </form>
    <hr style={{margin:'24px 0'}}/><label>Search codes or businesses<input style={input} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Code, business name or email"/></label>
    {rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query.toLowerCase())).map(row=><article key={row.id} style={{padding:'20px 0',borderBottom:'1px solid #e2e8f0'}}>
      <h3>{row.code} · {row.trial_days} days free</h3><p>{row.title} · {row.starts_on} to {row.ends_on} · {row.is_active?'Enabled':'Disabled'} · {row.is_public?'Public':'Private'} · {row.redemptions.length}{row.max_redemptions?` / ${row.max_redemptions}`:''} uses · {row.redemptions.filter(r=>r.businesses?.last_paid_at).length} paid businesses</p>
      <button onClick={()=>{setEditing(row.id);setForm({...row,max_redemptions:row.max_redemptions??'',eligible_email:row.eligible_email??''});window.scrollTo({top:0,behavior:'smooth'})}}>Edit / disable</button>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left',marginTop:12}}><thead><tr>{['Business','Email','Redeemed (PH)','Trial ends (PH)','Converted to paid'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{row.redemptions.map(r=><tr key={r.id}><td>{r.businesses?.name||'—'}</td><td>{r.businesses?.email||'—'}</td><td>{date(r.redeemed_at)}</td><td>{date(r.trial_ends_at)}</td><td>{r.businesses?.last_paid_at?'Yes':'No'}</td></tr>)}</tbody></table></div>
    </article>)}
  </section>
}
