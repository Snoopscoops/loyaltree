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

  useEffect(()=>{load()},[user?.token])

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

  const openCashier=async()=>{
    setWorking(true);setMessage('')
    try{
      const d=await getDemoAccess()
      navigate('/scanner',{state:{
        ownerMode:true,
        businessSlug:d.business_slug,
        ownerName:d.owner_name||'Agyaman Demo Cashier',
        ownerToken:d.owner_token,
        demoMode:true,
        partnerReturn:'/partner',
      }})
    }catch(e){setMessage(`❌ ${e.message}`)}
    setWorking(false)
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
      load()
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
          <button style={s.action} onClick={openCashier} disabled={working}>📷 Open Demo Cashier</button>
          <button style={s.action} onClick={sendSampleNotification} disabled={working}>🔔 Send Sample Notification</button>
        </div>

        <div style={s.demoHint}>
          <b>Suggested presentation:</b> Scan QR → join Agyaman Express → add card to Wallet → open Demo Cashier → scan the customer card → add a stamp → send the sample notification.
          {demo?.latest_customer?.name&&<span> Latest demo signup: <b>{demo.latest_customer.name}</b>.</span>}
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
  empty:{padding:18,color:'#94a3b8',textAlign:'center'},table:{width:'100%',borderCollapse:'collapse',fontSize:13},
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
}

export default PartnerDashboard
