import React, { useEffect, useMemo, useState } from 'react'
import { formatMoney } from './currency'

const todayISO = () => new Date().toISOString().slice(0,10)
const plusDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0,10)
}

const emptyCampaign = () => {
  const today = todayISO()
  return {
    name:'',
    description:'',
    scope:'nationwide',
    branch_public_ids:[],
    qualifying_start_date:today,
    qualifying_end_date:today,
    qualification_type:'any_purchase',
    minimum_spend:'',
    reward_type:'percent_discount',
    reward_value:'10',
    reward_label:'',
    reward_description:'',
    coupon_start_date:today,
    coupon_end_date:plusDays(today,7),
    min_redemption_spend:'',
    max_per_member:1,
    applicable_product_text:'',
    status:'scheduled',
  }
}

export default function Campaigns({ API_BASE, user, business, authFetch }) {
  const slug = user?.business_slug || business?.public_id
  const currency = business?.display_currency || 'PHP'
  const [campaigns,setCampaigns]=useState([])
  const [branches,setBranches]=useState([])
  const [form,setForm]=useState(emptyCampaign())
  const [selected,setSelected]=useState(null)
  const [report,setReport]=useState(null)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [showBuilder,setShowBuilder]=useState(false)

  const card={background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,padding:18,boxShadow:'0 2px 10px rgba(15,23,42,.04)'}
  const input={width:'100%',padding:'10px 11px',border:'1px solid #cbd5e1',borderRadius:10,boxSizing:'border-box',fontSize:13,background:'#fff'}
  const label={fontSize:11,fontWeight:850,color:'#475569',display:'block',margin:'10px 0 5px'}
  const primary={border:'none',borderRadius:10,background:'#0f766e',color:'#fff',fontWeight:850,padding:'10px 14px',cursor:'pointer'}
  const secondary={border:'1px solid #cbd5e1',borderRadius:10,background:'#fff',color:'#334155',fontWeight:800,padding:'9px 12px',cursor:'pointer'}

  const load=async()=>{
    if(!slug||!authFetch)return
    setLoading(true);setError('')
    try{
      const res=await authFetch(`${API_BASE}/api/v1/business/${slug}/campaigns`,{cache:'no-store'})
      const body=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(body.detail||'Could not load campaigns')
      setCampaigns(body.campaigns||[])
      setBranches(body.branches||[])
      if(selected){
        const fresh=(body.campaigns||[]).find(c=>c.public_id===selected.public_id)
        if(fresh)setSelected(fresh)
      }
    }catch(e){setError(e.message||'Could not load campaigns')}
    finally{setLoading(false)}
  }

  useEffect(()=>{load()},[slug])

  const branchByPublicId=useMemo(()=>Object.fromEntries(branches.map(b=>[b.public_id,b])),[branches])
  const statusLabel=c=>String(c?.effective_status||c?.status||'scheduled').replaceAll('_',' ')
  const rewardLabel=c=>{
    if(c?.reward_label)return c.reward_label
    if(c?.reward_type==='percent_discount')return `${Number(c.reward_value||0)}% OFF`
    if(c?.reward_type==='fixed_discount')return `${formatMoney(Number(c.reward_value||0),currency)} OFF`
    return 'BUY 1 TAKE 1'
  }

  const selectCampaign=async(c)=>{
    setSelected(c);setReport(null);setError('')
    try{
      const res=await authFetch(`${API_BASE}/api/v1/business/${slug}/campaigns/${c.public_id}/report`,{cache:'no-store'})
      const body=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(body.detail||'Could not load campaign report')
      setReport(body.report||null)
    }catch(e){setError(e.message||'Could not load campaign report')}
  }

  const toggleBranch=(id)=>setForm(f=>({...f,branch_public_ids:(f.branch_public_ids||[]).includes(id)?f.branch_public_ids.filter(x=>x!==id):[...(f.branch_public_ids||[]),id]}))

  const save=async()=>{
    if(!form.name.trim()){setError('Campaign name is required.');return}
    if(form.scope==='single_branch'&&form.branch_public_ids.length!==1){setError('Choose exactly one branch.');return}
    if(form.scope==='selected_branches'&&!form.branch_public_ids.length){setError('Choose at least one branch.');return}
    setSaving(true);setError('');setMessage('')
    try{
      const payload={
        ...form,
        name:form.name.trim(),
        description:form.description.trim()||null,
        branch_public_ids:form.scope==='nationwide'?[]:form.branch_public_ids,
        minimum_spend:Number(form.minimum_spend||0),
        reward_value:form.reward_type==='buy_one_take_one'?null:Number(form.reward_value||0),
        reward_label:form.reward_label.trim()||null,
        reward_description:form.reward_description.trim()||null,
        min_redemption_spend:Number(form.min_redemption_spend||0),
        max_per_member:Number(form.max_per_member||1),
        applicable_product_text:form.applicable_product_text.trim()||null,
      }
      const res=await authFetch(`${API_BASE}/api/v1/business/${slug}/campaigns`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
      const body=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(body.detail||'Could not create campaign')
      setMessage('Campaign scheduled. Qualifying purchases will issue the seasonal coupon automatically.')
      setForm(emptyCampaign());setShowBuilder(false)
      await load()
    }catch(e){setError(e.message||'Could not create campaign')}
    finally{setSaving(false)}
  }

  const setStatus=async(c,status)=>{
    setSaving(true);setError('');setMessage('')
    try{
      const res=await authFetch(`${API_BASE}/api/v1/business/${slug}/campaigns/${c.public_id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})})
      const body=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(body.detail||'Could not update campaign')
      setMessage(`Campaign ${status}.`)
      await load()
      if(selected?.public_id===c.public_id)await selectCampaign({...c,status,effective_status:status})
    }catch(e){setError(e.message||'Could not update campaign')}
    finally{setSaving(false)}
  }

  if(loading)return <div style={card}>Loading campaigns…</div>

  return <div style={{display:'grid',gap:14}}>
    <div style={{...card,background:'linear-gradient(135deg,#ecfdf5,#f8fafc)'}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:11,fontWeight:900,color:'#0f766e'}}>CAMPAIGNS</div>
          <h2 style={{margin:'4px 0 4px'}}>Seasonal coupons across your branches</h2>
          <p style={{margin:0,color:'#64748b',fontSize:12,maxWidth:720}}>Your normal points/stamps stay unchanged. Campaigns temporarily issue coupons after qualifying purchases, then track issuance, redemption and branch movement separately.</p>
        </div>
        <button style={primary} onClick={()=>setShowBuilder(v=>!v)}>{showBuilder?'Close builder':'+ New campaign'}</button>
      </div>
      {message&&<div style={{marginTop:12,padding:'10px 12px',background:'#ecfdf5',border:'1px solid #a7f3d0',borderRadius:10,color:'#047857',fontSize:12}}>{message}</div>}
      {error&&<div style={{marginTop:12,padding:'10px 12px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,color:'#b91c1c',fontSize:12}}>{error}</div>}
    </div>

    {showBuilder&&<div style={card}>
      <div style={{fontSize:11,fontWeight:900,color:'#0f766e'}}>CREATE CAMPAIGN</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12,marginTop:8}}>
        <div style={{gridColumn:'1/-1'}}><label style={label}>Campaign name</label><input style={input} value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Halloween Special"/></div>
        <div style={{gridColumn:'1/-1'}}><label style={label}>Description</label><textarea style={{...input,minHeight:72}} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Seasonal offer shown to members and managers"/></div>

        <div><label style={label}>Scope</label><select style={input} value={form.scope} onChange={e=>setForm({...form,scope:e.target.value,branch_public_ids:e.target.value==='nationwide'?[]:form.branch_public_ids})}><option value="nationwide">Nationwide · all branches</option><option value="selected_branches">Selected branches</option><option value="single_branch">Single branch</option></select></div>
        <div><label style={label}>Qualification</label><select style={input} value={form.qualification_type} onChange={e=>setForm({...form,qualification_type:e.target.value})}><option value="any_purchase">Any purchase</option><option value="minimum_spend">Minimum spend</option></select></div>
        {form.qualification_type==='minimum_spend'&&<div><label style={label}>Minimum qualifying spend</label><input style={input} type="number" min="0" step="0.01" value={form.minimum_spend} onChange={e=>setForm({...form,minimum_spend:e.target.value})}/></div>}

        {form.scope!=='nationwide'&&<div style={{gridColumn:'1/-1'}}><label style={label}>Participating branches</label><div style={{display:'flex',gap:7,flexWrap:'wrap'}}>{branches.filter(b=>b.is_active!==false).map(b=><label key={b.public_id} style={{border:'1px solid #cbd5e1',borderRadius:999,padding:'7px 10px',fontSize:11,fontWeight:750,background:(form.branch_public_ids||[]).includes(b.public_id)?'#ccfbf1':'#fff'}}><input type="checkbox" checked={(form.branch_public_ids||[]).includes(b.public_id)} onChange={()=>{if(form.scope==='single_branch')setForm({...form,branch_public_ids:[b.public_id]});else toggleBranch(b.public_id)}} style={{marginRight:5}}/>{b.name}</label>)}</div></div>}

        <div><label style={label}>Qualifying start</label><input style={input} type="date" value={form.qualifying_start_date} onChange={e=>setForm({...form,qualifying_start_date:e.target.value})}/></div>
        <div><label style={label}>Qualifying end</label><input style={input} type="date" value={form.qualifying_end_date} onChange={e=>setForm({...form,qualifying_end_date:e.target.value})}/></div>
        <div><label style={label}>Coupon usable from</label><input style={input} type="date" value={form.coupon_start_date} onChange={e=>setForm({...form,coupon_start_date:e.target.value})}/></div>
        <div><label style={label}>Coupon expires</label><input style={input} type="date" value={form.coupon_end_date} onChange={e=>setForm({...form,coupon_end_date:e.target.value})}/></div>

        <div><label style={label}>Reward</label><select style={input} value={form.reward_type} onChange={e=>setForm({...form,reward_type:e.target.value,reward_value:e.target.value==='percent_discount'?'10':e.target.value==='fixed_discount'?'100':''})}><option value="percent_discount">% discount coupon</option><option value="fixed_discount">Fixed discount coupon</option><option value="buy_one_take_one">Buy 1 Take 1</option></select></div>
        {form.reward_type!=='buy_one_take_one'&&<div><label style={label}>{form.reward_type==='percent_discount'?'Discount %':'Discount amount'}</label><input style={input} type="number" min="0" step="0.01" value={form.reward_value} onChange={e=>setForm({...form,reward_value:e.target.value})}/></div>}
        <div><label style={label}>Maximum coupons per member</label><input style={input} type="number" min="1" max="20" value={form.max_per_member} onChange={e=>setForm({...form,max_per_member:e.target.value})}/></div>
        <div><label style={label}>Minimum spend when redeeming</label><input style={input} type="number" min="0" step="0.01" value={form.min_redemption_spend} onChange={e=>setForm({...form,min_redemption_spend:e.target.value})} placeholder="Optional"/></div>
        <div style={{gridColumn:'1/-1'}}><label style={label}>Coupon label (optional)</label><input style={input} value={form.reward_label} onChange={e=>setForm({...form,reward_label:e.target.value})} placeholder="Halloween 10% OFF"/></div>
        {form.reward_type==='buy_one_take_one'&&<div style={{gridColumn:'1/-1'}}><label style={label}>Applicable product / condition</label><input style={input} value={form.applicable_product_text} onChange={e=>setForm({...form,applicable_product_text:e.target.value})} placeholder="Buy 1 Halloween Drink, get 1 free"/></div>}
        <div style={{gridColumn:'1/-1'}}><label style={label}>Reward details (optional)</label><textarea style={{...input,minHeight:60}} value={form.reward_description} onChange={e=>setForm({...form,reward_description:e.target.value})} placeholder="Terms shown to the team/customer"/></div>
      </div>
      <div style={{marginTop:14,padding:12,borderRadius:12,background:'#f8fafc',fontSize:12,color:'#475569'}}><b>Flow:</b> purchase during <b>{form.qualifying_start_date}</b>–<b>{form.qualifying_end_date}</b> → issue <b>{form.reward_label||rewardLabel(form)}</b> → usable <b>{form.coupon_start_date}</b>–<b>{form.coupon_end_date}</b>.</div>
      <button disabled={saving} onClick={save} style={{...primary,marginTop:12}}>{saving?'Saving…':'Schedule campaign'}</button>
    </div>}

    <div style={{display:'grid',gridTemplateColumns:'minmax(300px,.85fr) minmax(0,1.35fr)',gap:14}} className="lt-campaign-grid">
      <div style={card}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div style={{fontSize:11,fontWeight:900,color:'#0f766e'}}>CAMPAIGN LIST</div><h3 style={{margin:'3px 0'}}>All promotions</h3></div><button style={secondary} onClick={load}>↻</button></div>
        <div style={{display:'grid',gap:8,marginTop:12}}>{campaigns.map(c=><button key={c.public_id} onClick={()=>selectCampaign(c)} style={{textAlign:'left',padding:12,border:selected?.public_id===c.public_id?'2px solid #0f766e':'1px solid #e2e8f0',borderRadius:12,background:'#fff',cursor:'pointer'}}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><strong>{c.name}</strong><span style={{fontSize:10,fontWeight:900,textTransform:'uppercase',color:statusLabel(c)==='active'?'#047857':statusLabel(c)==='paused'?'#b45309':'#64748b'}}>{statusLabel(c)}</span></div><div style={{fontSize:11,color:'#475569',marginTop:4}}>{rewardLabel(c)} · {c.scope==='nationwide'?'Nationwide':(c.branch_names||[]).join(', ')||c.scope}</div><div style={{display:'flex',gap:10,marginTop:7,fontSize:10.5,color:'#64748b'}}><span>{c.summary?.issued||0} issued</span><span>{c.summary?.redeemed||0} redeemed</span><span>{Number(c.summary?.redemption_rate||0).toFixed(1)}%</span></div></button>)}</div>
        {!campaigns.length&&<div style={{padding:'24px 0',textAlign:'center',color:'#94a3b8'}}>No campaigns yet.</div>}
      </div>

      <div style={card}>
        {!selected?<div style={{padding:30,textAlign:'center',color:'#94a3b8'}}>Select a campaign to view movements and reports.</div>:<>
          <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'flex-start',flexWrap:'wrap'}}><div><div style={{fontSize:11,fontWeight:900,color:'#0f766e'}}>CAMPAIGN REPORT</div><h2 style={{margin:'3px 0'}}>{selected.name}</h2><div style={{fontSize:12,color:'#64748b'}}>{rewardLabel(selected)} · {selected.qualifying_start_date} → {selected.qualifying_end_date}</div></div><div style={{display:'flex',gap:6}}>{statusLabel(selected)!=='paused'&&statusLabel(selected)!=='ended'&&<button style={secondary} disabled={saving} onClick={()=>setStatus(selected,'paused')}>Pause</button>}{statusLabel(selected)==='paused'&&<button style={secondary} disabled={saving} onClick={()=>setStatus(selected,'scheduled')}>Resume</button>}<button style={secondary} disabled={saving||statusLabel(selected)==='ended'} onClick={()=>setStatus(selected,'ended')}>End</button></div></div>
          {!report?<div style={{padding:30,textAlign:'center',color:'#94a3b8'}}>Loading report…</div>:<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(125px,1fr))',gap:8,marginTop:14}}>{[
              ['Coupons issued',report.issued||0],['Redeemed',report.redeemed||0],['Redemption rate',`${Number(report.redemption_rate||0).toFixed(1)}%`],['Gross revenue',formatMoney(report.gross_revenue_from_redemptions||0,currency)],['Discount given',formatMoney(report.discount_given||0,currency)]
            ].map(([k,v])=><div key={k} style={{padding:11,background:'#f8fafc',borderRadius:11,border:'1px solid #e2e8f0'}}><div style={{fontSize:9.5,fontWeight:900,color:'#64748b'}}>{k.toUpperCase()}</div><strong style={{display:'block',fontSize:18,marginTop:4}}>{v}</strong></div>)}</div>

            <div style={{marginTop:16}}><div style={{fontSize:11,fontWeight:900,color:'#475569'}}>BY BRANCH</div>{(report.branches||[]).length?<div style={{overflowX:'auto',marginTop:7}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}><thead><tr>{['Branch','Issued','Redeemed','Gross revenue','Discount'].map(h=><th key={h} style={{textAlign:'left',padding:'8px 6px',borderBottom:'1px solid #e2e8f0',color:'#64748b'}}>{h}</th>)}</tr></thead><tbody>{report.branches.map((b,i)=><tr key={b.branch_id||i}><td style={{padding:'8px 6px',borderBottom:'1px solid #f1f5f9',fontWeight:750}}>{b.branch_name}</td><td style={{padding:'8px 6px',borderBottom:'1px solid #f1f5f9'}}>{b.issued}</td><td style={{padding:'8px 6px',borderBottom:'1px solid #f1f5f9'}}>{b.redeemed}</td><td style={{padding:'8px 6px',borderBottom:'1px solid #f1f5f9'}}>{formatMoney(b.gross_revenue||0,currency)}</td><td style={{padding:'8px 6px',borderBottom:'1px solid #f1f5f9'}}>{formatMoney(b.discount_given||0,currency)}</td></tr>)}</tbody></table></div>:<div style={{fontSize:11,color:'#94a3b8',marginTop:6}}>No campaign movements yet.</div>}</div>

            <div style={{marginTop:16}}><div style={{fontSize:11,fontWeight:900,color:'#475569'}}>RECORDED MOVEMENTS</div><div style={{display:'grid',gap:0,marginTop:6}}>{(report.activity||[]).slice(0,40).map(row=><div key={row.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,padding:'9px 0',borderBottom:'1px solid #f1f5f9'}}><div><strong style={{fontSize:12}}>{row.customer_name}</strong><div style={{fontSize:10.5,color:'#64748b'}}>{String(row.activity_type||'').replaceAll('_',' ')} · {row.branch_name}{row.gross_amount!=null?` · ${formatMoney(row.gross_amount,currency)}`:''}</div></div><time style={{fontSize:10,color:'#94a3b8'}}>{row.created_at?new Date(row.created_at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}</time></div>)}</div>{!(report.activity||[]).length&&<div style={{fontSize:11,color:'#94a3b8',marginTop:6}}>No recorded movements yet.</div>}</div>
          </>}
        </>}
      </div>
    </div>

    <style>{`@media(max-width:850px){.lt-campaign-grid{grid-template-columns:1fr!important}}`}</style>
  </div>
}
