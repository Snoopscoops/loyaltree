import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import LoyaltyCardCustomizer from './LoyaltyCardCustomizer'

function money(v){return `₱${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}

function PartnerDashboard({API_BASE,user,onLogout}){
  const navigate=useNavigate()
  const [data,setData]=useState(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [showQr,setShowQr]=useState(false)
  const [showEditor,setShowEditor]=useState(false)
  const [demoAccess,setDemoAccess]=useState(null)
  const [working,setWorking]=useState(false)
  const [demoCustomers,setDemoCustomers]=useState([])
  const [customersLoading,setCustomersLoading]=useState(false)
  const [demoCashiers,setDemoCashiers]=useState([])
  const [cashiersLoading,setCashiersLoading]=useState(false)
  const [cashierForm,setCashierForm]=useState({name:'',email:'',pin:''})

  const authHeaders={Authorization:`Bearer ${user?.token}`}

  const load=async()=>{
    try{
      const r=await fetch(`${API_BASE}/api/v1/partner/dashboard`,{headers:authHeaders,cache:'no-store'})
      if(r.status===401||r.status===403){onLogout();return}
      const d=await r.json()
      if(!r.ok)throw new Error(d.detail||'Could not load partner dashboard')
      setData(d)
      setError('')
    }catch(e){setError(e.message)}
  }

  const loadDemoCashiers=async()=>{
    setCashiersLoading(true)
    try{
      const r=await fetch(`${API_BASE}/api/v1/partner/demo/cashiers`,{headers:authHeaders,cache:'no-store'})
      const d=await r.json().catch(()=>({}))
      if(r.ok)setDemoCashiers(d.cashiers||[])
    }catch(e){}
    setCashiersLoading(false)
  }

  const createDemoCashier=async(e)=>{
    e?.preventDefault?.()
    setWorking(true);setMessage('')
    try{
      const r=await fetch(`${API_BASE}/api/v1/partner/demo/cashiers`,{
        method:'POST',
        headers:{...authHeaders,'Content-Type':'application/json'},
        body:JSON.stringify(cashierForm),
      })
      const d=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(d.detail||'Could not create demo cashier')
      setMessage(`✅ Cashier ${d.cashier?.name||''} created. Use the Business ID, email and PIN below in the normal cashier login.`)
      setCashierForm({name:'',email:'',pin:''})
      loadDemoCashiers()
    }catch(e){setMessage(`❌ ${e.message}`)}
    setWorking(false)
  }

  const deleteDemoCashier=async(publicId)=>{
    if(!window.confirm('Remove this Agyaman Express demo cashier?'))return
    setWorking(true)
    try{
      const r=await fetch(`${API_BASE}/api/v1/partner/demo/cashiers/${publicId}`,{method:'DELETE',headers:authHeaders})
      const d=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(d.detail||'Could not remove cashier')
      setMessage('✅ Demo cashier removed.')
      loadDemoCashiers()
    }catch(e){setMessage(`❌ ${e.message}`)}
    setWorking(false)
  }

  const loadDemoCustomers=async()=>{
    setCustomersLoading(true)
    try{
      const r=await fetch(`${API_BASE}/api/v1/partner/demo/customers`,{headers:authHeaders,cache:'no-store'})
      const d=await r.json().catch(()=>({}))
      if(r.ok)setDemoCustomers(d.customers||[])
    }catch(e){}
    setCustomersLoading(false)
  }

  useEffect(()=>{load();loadDemoCustomers();loadDemoCashiers()},[user?.token])

  const getDemoAccess=async()=>{
    if(demoAccess?.owner_token)return demoAccess
    const r=await fetch(`${API_BASE}/api/v1/partner/demo-access`,{headers:authHeaders,cache:'no-store'})
    if(r.status===401||r.status===403){onLogout();throw new Error('Partner session expired')}
    const d=await r.json().catch(()=>({}))
    if(!r.ok)throw new Error(d.detail||'Could not open Agyaman Express demo')
    setDemoAccess(d)
    return d
  }

  const openEditor=async()=>{
    setWorking(true);setMessage('')
    try{await getDemoAccess();setShowEditor(true)}
    catch(e){setMessage(`❌ ${e.message}`)}
    setWorking(false)
  }

  const openNormalCashier=(cashier=null)=>{
    if(!demo?.business_slug)return
    navigate('/scanner',{state:{
      prefillBusinessSlug:demo.business_slug,
      prefillEmail:cashier?.email||'',
      demoMode:true,
      partnerReturn:'/partner',
    }})
  }

  const sendSampleNotification=async()=>{
    setWorking(true);setMessage('Sending sample Wallet notification…')
    try{
      const r=await fetch(`${API_BASE}/api/v1/partner/demo/notify-latest`,{
        method:'POST',headers:authHeaders
      })
      const d=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(d.detail||'Could not send sample notification')
      setMessage(`✅ Sample notification sent to ${d.customer?.name||'the latest demo customer'}.`)
      load();loadDemoCustomers()
    }catch(e){setMessage(`❌ ${e.message}`)}
    setWorking(false)
  }

  if(!data)return <div style={s.page}><div style={s.card}>{error||'Loading partner dashboard…'}</div></div>

  const {partner,stats,businesses,commissions,demo}=data
  const demoUser=demoAccess?{
    business_slug:demoAccess.business_slug,
    business_name:demoAccess.name||'Agyaman Express',
    name:'Agyaman Demo',
    role:'owner',
    token:demoAccess.owner_token,
  }:null

  return <div style={s.page}>
    <header style={s.header}>
      <div>
        <div style={s.kicker}>{partner.partner_type==='region'?'REGION PARTNER':'CITY PARTNER'}</div>
        <h1 style={s.h1}>{partner.name}</h1>
        <div style={s.sub}>{partner.city?`${partner.city}, `:''}{partner.region} · Code <b>{partner.partner_code}</b></div>
      </div>
      <button style={s.logout} onClick={onLogout}>Log out</button>
    </header>

    <main style={s.main}>
      {message&&<div style={message.startsWith('❌')?s.err:s.toast}>{message}</div>}

      <section style={s.demoCard}>
        <div style={s.demoTop}>
          <div>
            <div style={s.demoBadge}>LIVE SALES DEMO</div>
            <h2 style={{...s.h2,fontSize:24,marginTop:7}}>Agyaman Express</h2>
            <p style={s.note}>Use the real LoyaltyTree flow when presenting to a potential client. Their test card can be added to Apple Wallet or Google Wallet and used with the demo cashier.</p>
          </div>
          <div style={s.demoStats}>
            <b>{demo?.customer_count||0}</b>
            <span>demo customers</span>
          </div>
        </div>

        <div style={s.demoActions}>
          <button style={s.actionPrimary} onClick={()=>setShowQr(true)}>📱 Share Demo Join QR</button>
          <button style={s.action} onClick={openEditor} disabled={working}>🎨 Edit Agyaman Card</button>
          <button style={s.action} onClick={()=>openNormalCashier(demoCashiers[0]||null)} disabled={working}>📷 Open Normal Cashier</button>
          <button style={s.action} onClick={sendSampleNotification} disabled={working}>🔔 Send Sample Notification</button>
        </div>

        <div style={s.demoHint}>
          <b>Suggested presentation:</b> Scan QR → join Agyaman Express → add card to Wallet → see the customer appear below → create a cashier → open the normal camera cashier → log in with Business ID + email + PIN → scan the Wallet card → add a stamp → return here and refresh the activity → send the sample notification.
          {demo?.latest_customer?.name&&<span> Latest demo signup: <b>{demo.latest_customer.name}</b>.</span>}
        </div>
      </section>

      <section style={s.card}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
          <div>
            <h2 style={s.h2}>Agyaman Express Cashiers</h2>
            <p style={s.note}>Create a cashier exactly like a normal LoyaltyTree business. The cashier logs in with Business ID + email + PIN, then uses the normal phone camera scanner.</p>
          </div>
          <button style={s.action} onClick={loadDemoCashiers} disabled={cashiersLoading}>{cashiersLoading?'Refreshing…':'↻ Refresh Cashiers'}</button>
        </div>

        <div style={s.businessIdBox}><span>Business ID</span><b>{demo?.business_slug}</b></div>

        <form onSubmit={createDemoCashier} style={s.cashierForm}>
          <input style={s.input} placeholder="Cashier name" value={cashierForm.name} onChange={e=>setCashierForm({...cashierForm,name:e.target.value})} />
          <input style={s.input} placeholder="Cashier email" type="email" value={cashierForm.email} onChange={e=>setCashierForm({...cashierForm,email:e.target.value})} />
          <input style={s.input} placeholder="4–8 digit PIN" inputMode="numeric" maxLength={8} value={cashierForm.pin} onChange={e=>setCashierForm({...cashierForm,pin:e.target.value.replace(/\D/g,'')})} />
          <button style={s.actionPrimary} disabled={working||!cashierForm.name||!cashierForm.email||cashierForm.pin.length<4}>＋ Create Cashier</button>
        </form>

        <div style={s.grid}>
          {demoCashiers.map(c=><div style={s.customer} key={c.public_id}>
            <div style={s.customerTop}><b>{c.name}</b><span style={c.is_active!==false?s.activePill:s.inactivePill}>{c.is_active!==false?'ACTIVE':'INACTIVE'}</span></div>
            <span>📧 {c.email}</span>
            <span>Business ID: <b>{demo?.business_slug}</b></span>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
              <button style={s.smallBtn} onClick={()=>openNormalCashier(c)}>📷 Open Camera Cashier</button>
              <button style={s.smallDanger} onClick={()=>deleteDemoCashier(c.public_id)}>Remove</button>
            </div>
          </div>)}
          {!demoCashiers.length&&<div style={s.empty}>No demo cashier yet. Create one above, then open it and log in just like a real business cashier.</div>}
        </div>
      </section>

      <section style={s.card}>
        <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',flexWrap:'wrap'}}>
          <div>
            <h2 style={s.h2}>Demo Customers & Stamp Activity</h2>
            <p style={s.note}>These are Agyaman Express demo customers only. Use Set Up / Open Cashier to scan one of their Wallet cards and add stamps live.</p>
          </div>
          <button style={s.action} onClick={loadDemoCustomers} disabled={customersLoading}>{customersLoading?'Refreshing…':'↻ Refresh Activity'}</button>
        </div>
        <div style={s.grid}>
          {demoCustomers.map(c=><div style={s.customer} key={c.public_id}>
            <div style={s.customerTop}><b>{c.name||'Demo Customer'}</b><span style={s.stampPill}>⭐ {Number(c.stamp_count||0)} stamps</span></div>
            <span style={s.customerId}>Card ID: {c.public_id}</span>
            <span>Joined: {c.created_at?new Date(c.created_at).toLocaleString():'—'}</span>
            <span>Last activity: {c.updated_at?new Date(c.updated_at).toLocaleString():'—'}</span>
          </div>)}
          {!demoCustomers.length&&<div style={s.empty}>No demo customers yet. Share the Demo Join QR, let the prospect join Agyaman Express and add the card to Wallet. They will appear here.</div>}
        </div>
      </section>

      <div style={s.stats}>
        {[['Businesses',stats.businesses],['Active',stats.active_businesses],['Pending setup',stats.pending_businesses],['Commission earned',money(stats.commission_earned)],['Unpaid commission',money(stats.commission_unpaid)]].map(([a,b])=>
          <div style={s.stat} key={a}><div style={s.statLabel}>{a}</div><div style={s.statVal}>{b}</div></div>
        )}
      </div>

      <section style={s.card}>
        <h2 style={s.h2}>Assigned businesses</h2>
        <p style={s.note}>Operational setup view only. Customer personal data and sensitive transaction details are not available to partner accounts.</p>
        <div style={s.grid}>
          {businesses.map(b=><div style={s.biz} key={b.public_id}><b>{b.name}</b><span>{b.address||'Address not set'}</span><span>{b.plan} · {b.status}</span><span>QR kit: {b.setup_kit_status||'Not requested'}</span></div>)}
          {!businesses.length&&<div style={s.empty}>No businesses assigned yet.</div>}
        </div>
      </section>

      <section style={s.card}>
        <h2 style={s.h2}>Commission activity</h2>
        <div style={{overflowX:'auto'}}>
          <table style={s.table}><thead><tr><th>Business</th><th>Gross</th><th>Commission</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>{commissions.map(c=><tr key={c.public_id}><td>{c.business_name}</td><td>{money(c.gross_amount)}</td><td><b>{money(c.commission_amount)}</b></td><td>{c.status}</td><td>{c.earned_at?new Date(c.earned_at).toLocaleDateString():''}</td></tr>)}</tbody></table>
        </div>
        {!commissions.length&&<div style={s.empty}>No commission activity yet.</div>}
      </section>
    </main>

    {showQr&&<div style={s.overlay} onMouseDown={e=>{if(e.target===e.currentTarget)setShowQr(false)}}>
      <div style={s.modal}>
        <button style={s.close} onClick={()=>setShowQr(false)}>✕</button>
        <div style={s.demoBadge}>AGYAMAN EXPRESS</div>
        <h2 style={{...s.h2,fontSize:22}}>Scan to try LoyaltyTree</h2>
        <p style={s.note}>Join the live demo, then add your card to Apple Wallet or Google Wallet.</p>
        <div style={s.qrWrap}><QRCodeSVG value={demo.join_url} size={230} level="M" includeMargin /></div>
        <div style={s.urlBox}>{demo.join_url}</div>
        <button style={{...s.actionPrimary,width:'100%'}} onClick={async()=>{
          try{await navigator.clipboard.writeText(demo.join_url);setMessage('✅ Demo join link copied.')}catch{setMessage('Demo link ready to share.')}
        }}>Copy Demo Link</button>
      </div>
    </div>}

    {showEditor&&demoUser&&<div style={s.editorOverlay}>
      <div style={s.editorModal}>
        <div style={s.editorHead}>
          <div><div style={s.demoBadge}>DEMO CARD EDITOR</div><h2 style={{...s.h2,marginTop:5}}>Agyaman Express</h2></div>
          <button style={s.closeStatic} onClick={()=>{setShowEditor(false);load()}}>✕ Close</button>
        </div>
        <div style={s.editorBody}>
          <LoyaltyCardCustomizer API_BASE={API_BASE} user={demoUser} onSaved={()=>{setMessage('✅ Agyaman Express demo card updated.');load()}} />
        </div>
      </div>
    </div>}
  </div>
}

const s={
  page:{minHeight:'100vh',background:'#f8fafc',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',color:'#0f172a'},
  header:{background:'#0f766e',color:'white',padding:'22px clamp(18px,5vw,60px)',display:'flex',justifyContent:'space-between',gap:20,alignItems:'center'},
  kicker:{fontSize:11,fontWeight:800,letterSpacing:1.4,opacity:.8},h1:{margin:'4px 0',fontSize:28},sub:{fontSize:13,opacity:.9},
  logout:{border:'1px solid rgba(255,255,255,.5)',background:'transparent',color:'white',borderRadius:9,padding:'9px 14px',fontWeight:700,cursor:'pointer'},
  main:{maxWidth:1200,margin:'0 auto',padding:'24px clamp(14px,4vw,34px)'},
  stats:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18},
  stat:{background:'white',border:'1px solid #e2e8f0',borderRadius:14,padding:16},statLabel:{fontSize:12,color:'#64748b',fontWeight:700},statVal:{fontSize:24,fontWeight:850,marginTop:6},
  card:{background:'white',border:'1px solid #e2e8f0',borderRadius:16,padding:18,marginBottom:18},h2:{margin:'0 0 6px',fontSize:18},note:{margin:'0 0 15px',fontSize:12,color:'#64748b',lineHeight:1.55},
  grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10},biz:{display:'flex',flexDirection:'column',gap:5,padding:13,border:'1px solid #e2e8f0',borderRadius:11,fontSize:12,color:'#64748b'},
  empty:{padding:18,color:'#94a3b8',textAlign:'center'},customer:{display:'flex',flexDirection:'column',gap:6,padding:14,border:'1px solid #e2e8f0',borderRadius:12,fontSize:12,color:'#64748b'},customerTop:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,color:'#0f172a'},stampPill:{background:'#ecfdf5',color:'#047857',padding:'4px 8px',borderRadius:999,fontSize:11,fontWeight:800},customerId:{fontFamily:'monospace',fontSize:10,color:'#94a3b8',wordBreak:'break-all'},table:{width:'100%',borderCollapse:'collapse',fontSize:13},
  demoCard:{background:'linear-gradient(135deg,#ecfdf5,#f0fdfa)',border:'1px solid #99f6e4',borderRadius:18,padding:'clamp(16px,3vw,24px)',marginBottom:18},
  demoTop:{display:'flex',justifyContent:'space-between',gap:18,alignItems:'flex-start',flexWrap:'wrap'},demoBadge:{fontSize:10,fontWeight:900,letterSpacing:1.4,color:'#0f766e'},
  demoStats:{background:'white',border:'1px solid #ccfbf1',borderRadius:14,padding:'12px 16px',minWidth:120,textAlign:'center',display:'flex',flexDirection:'column',gap:2},
  demoActions:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10,marginTop:16},
  actionPrimary:{border:0,borderRadius:11,padding:'12px 14px',background:'#0f766e',color:'white',fontWeight:800,cursor:'pointer'},
  action:{border:'1px solid #99f6e4',borderRadius:11,padding:'12px 14px',background:'white',color:'#0f766e',fontWeight:800,cursor:'pointer'},
  demoHint:{marginTop:14,padding:12,borderRadius:10,background:'rgba(255,255,255,.7)',fontSize:12,color:'#475569',lineHeight:1.55},
  toast:{padding:'11px 14px',borderRadius:10,background:'#ecfdf5',border:'1px solid #a7f3d0',color:'#166534',marginBottom:14,fontSize:13,fontWeight:700},
  err:{padding:'11px 14px',borderRadius:10,background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',marginBottom:14,fontSize:13,fontWeight:700},
  overlay:{position:'fixed',inset:0,background:'rgba(15,23,42,.55)',display:'grid',placeItems:'center',zIndex:1000,padding:16},
  modal:{position:'relative',background:'white',borderRadius:18,padding:24,width:'min(420px,100%)',boxShadow:'0 24px 70px rgba(15,23,42,.28)',textAlign:'center'},
  close:{position:'absolute',right:12,top:12,border:0,background:'#f1f5f9',borderRadius:8,width:34,height:34,cursor:'pointer'},
  qrWrap:{display:'inline-flex',padding:10,border:'1px solid #e2e8f0',borderRadius:14,background:'white',margin:'6px auto 14px'},
  urlBox:{fontSize:11,color:'#64748b',background:'#f8fafc',borderRadius:9,padding:10,wordBreak:'break-all',marginBottom:12},
  editorOverlay:{position:'fixed',inset:0,background:'rgba(15,23,42,.6)',zIndex:1000,padding:'12px',overflow:'auto'},
  editorModal:{background:'#f8fafc',borderRadius:18,maxWidth:1100,margin:'0 auto',minHeight:'calc(100vh - 24px)',overflow:'hidden'},
  editorHead:{position:'sticky',top:0,zIndex:5,background:'white',borderBottom:'1px solid #e2e8f0',padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12},
  closeStatic:{border:'1px solid #cbd5e1',background:'white',borderRadius:9,padding:'9px 12px',fontWeight:800,cursor:'pointer'},
  editorBody:{padding:'14px'},
  businessIdBox:{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10,padding:'10px 12px',fontSize:12,marginBottom:12},
  cashierForm:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:9,marginBottom:14},
  input:{width:'100%',boxSizing:'border-box',border:'1px solid #cbd5e1',borderRadius:10,padding:'11px 12px',fontSize:13,outline:'none'},
  activePill:{background:'#ecfdf5',color:'#047857',borderRadius:999,padding:'3px 7px',fontSize:10,fontWeight:900},
  inactivePill:{background:'#f1f5f9',color:'#64748b',borderRadius:999,padding:'3px 7px',fontSize:10,fontWeight:900},
  smallBtn:{border:'1px solid #99f6e4',background:'#f0fdfa',color:'#0f766e',borderRadius:8,padding:'7px 9px',fontSize:11,fontWeight:800,cursor:'pointer'},
  smallDanger:{border:'1px solid #fecaca',background:'#fff1f2',color:'#be123c',borderRadius:8,padding:'7px 9px',fontSize:11,fontWeight:800,cursor:'pointer'},
}

export default PartnerDashboard
