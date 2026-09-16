import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import LoyaltyCardCustomizer from './LoyaltyCardCustomizer'

function money(v){return `₱${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}
function dateLabel(v){
  if(!v)return '—'
  const d=new Date(v)
  return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})
}
function statusLabel(v){return String(v||'').replaceAll('_',' ').trim()||'Not available'}

function PartnerDashboard({API_BASE,user,onLogout}){
  const navigate=useNavigate()
  const [data,setData]=useState(null)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [activeTab,setActiveTab]=useState('partner')
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
      setMessage(`✅ Cashier ${d.cashier?.name||''} created.`)
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

  useEffect(()=>{load()},[user?.token])
  useEffect(()=>{
    if(activeTab==='demo'){
      loadDemoCustomers()
      loadDemoCashiers()
    }
  },[activeTab])

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
      const r=await fetch(`${API_BASE}/api/v1/partner/demo/notify-latest`,{method:'POST',headers:authHeaders})
      const d=await r.json().catch(()=>({}))
      if(!r.ok)throw new Error(d.detail||'Could not send sample notification')
      setMessage(`✅ Sample notification sent to ${d.customer?.name||'the latest demo customer'}.`)
      load();loadDemoCustomers()
    }catch(e){setMessage(`❌ ${e.message}`)}
    setWorking(false)
  }

  if(!data)return <div style={s.page}><div style={s.loadingCard}>{error||'Loading partner dashboard…'}</div></div>

  const {partner={},stats={},businesses=[],commissions=[],demo={}}=data
  const payouts=data.payouts||data.payout_history||[]
  const rawCommissionRate=Number(partner.commission_value??partner.commission_rate??0)
  const normalizedCommissionRate=partner.commission_value==null&&rawCommissionRate>0&&rawCommissionRate<1?rawCommissionRate*100:rawCommissionRate
  const commissionRate=partner.commission_type==='fixed'
    ? `${money(partner.commission_value)} fixed`
    : `${normalizedCommissionRate.toLocaleString()}%`

  const hasPaymentFields=businesses.some(b=>
    b.has_paid!==undefined || b.payment_status!==undefined || b.last_payment_at || b.last_paid_at || b.subscription_payment_status!==undefined
  )

  const payingBusinesses=!hasPaymentFields?businesses:businesses.filter(b=>{
    if(b.has_paid===true)return true
    if(b.last_payment_at||b.last_paid_at)return true
    const ps=String(b.payment_status||b.subscription_payment_status||'').toUpperCase()
    return ['PAID','ACTIVE','DUE','OVERDUE','PAST_DUE'].includes(ps)
  })

  const payoutMethod=partner.payout_method||partner.payment_method||'Not configured'
  const payoutSchedule=partner.payout_schedule||partner.payout_frequency||'Not configured'
  const nextPayout=partner.next_payout_at||partner.next_payout_date
  const lastPayout=payouts[0]||data.last_payout||null
  const amountDue=stats.commission_unpaid??stats.pending_commission??partner.commission_unpaid??0

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

    <div style={s.tabBarWrap}>
      <div style={s.tabBar}>
        <button onClick={()=>setActiveTab('partner')} style={activeTab==='partner'?s.tabActive:s.tab}>Partner Overview</button>
        <button onClick={()=>setActiveTab('demo')} style={activeTab==='demo'?s.tabActive:s.tab}>Sales Demo</button>
      </div>
    </div>

    <main style={s.main}>
      {message&&<div style={message.startsWith('❌')?s.err:s.toast}>{message}</div>}

      {activeTab==='partner'&&<>
        <section style={s.heroGrid}>
          <div style={s.heroCard}>
            <div style={s.eyebrow}>AMOUNT DUE</div>
            <div style={s.heroValue}>{money(amountDue)}</div>
            <div style={s.heroMeta}>Commission waiting for payout</div>
          </div>
          <div style={s.heroCard}>
            <div style={s.eyebrow}>COMMISSION RATE</div>
            <div style={s.heroValue}>{commissionRate}</div>
            <div style={s.heroMeta}>Set by LoyaltyTree Super Admin</div>
          </div>
          <div style={s.heroCard}>
            <div style={s.eyebrow}>NEXT PAYOUT</div>
            <div style={{...s.heroValue,fontSize:24}}>{nextPayout?dateLabel(nextPayout):payoutSchedule}</div>
            <div style={s.heroMeta}>{nextPayout?`Schedule: ${payoutSchedule}`:'Payout date not yet configured'}</div>
          </div>
          <div style={s.heroCard}>
            <div style={s.eyebrow}>LAST PAYOUT</div>
            <div style={s.heroValue}>{lastPayout?money(lastPayout.amount||lastPayout.total_amount):money(0)}</div>
            <div style={s.heroMeta}>{lastPayout?dateLabel(lastPayout.paid_at||lastPayout.created_at):'No payout recorded yet'}</div>
          </div>
        </section>

        <section style={s.twoCol}>
          <div style={s.card}>
            <div style={s.sectionHead}>
              <div>
                <div style={s.eyebrow}>PAYOUT SETTINGS</div>
                <h2 style={s.h2}>Where your commission is sent</h2>
              </div>
              <span style={s.infoPill}>Managed by Admin</span>
            </div>
            <div style={s.detailRows}>
              <DetailRow label="Schedule" value={payoutSchedule}/>
              <DetailRow label="Method" value={payoutMethod}/>
              <DetailRow label="Account name" value={partner.payout_account_name||partner.account_name||'Not configured'}/>
              <DetailRow label="Bank / wallet" value={partner.payout_bank_name||partner.bank_name||partner.wallet_name||'Not configured'}/>
              <DetailRow label="Account / mobile" value={partner.payout_account_masked||partner.account_number_masked||partner.payout_mobile||partner.mobile_number||'Not configured'}/>
            </div>
            {(partner.qrph_image_url||partner.payout_qr_url)&&<a href={partner.qrph_image_url||partner.payout_qr_url} target="_blank" rel="noreferrer" style={s.receiptLink}>View QRPH payout QR ↗</a>}
          </div>

          <div style={s.card}>
            <div style={s.eyebrow}>PARTNER SUMMARY</div>
            <h2 style={s.h2}>Current account</h2>
            <div style={s.summaryGrid}>
              <MiniStat label="Paying businesses" value={payingBusinesses.length}/>
              <MiniStat label="Commission earned" value={money(stats.commission_earned)}/>
              <MiniStat label="Unpaid" value={money(amountDue)}/>
              <MiniStat label="Partner code" value={partner.partner_code||'—'}/>
            </div>
          </div>
        </section>

        <section style={s.card}>
          <div style={s.sectionHead}>
            <div>
              <div style={s.eyebrow}>CLIENT ACCOUNTS</div>
              <h2 style={s.h2}>Paying businesses</h2>
              <p style={s.note}>Only businesses that have paid should be kept in this operational list. No customer personal data is exposed.</p>
            </div>
            <button style={s.refreshBtn} onClick={load}>↻ Refresh</button>
          </div>
          {!hasPaymentFields&&businesses.length>0&&<div style={s.backendNote}>Payment fields are not yet included in the partner API, so assigned businesses are temporarily shown here until the backend payment filter is connected.</div>}
          <div style={{overflowX:'auto'}}>
            <table style={s.table}>
              <thead><tr><th>Business</th><th>Contact</th><th>Plan</th><th>Payment</th><th>Last paid</th><th>Next due</th></tr></thead>
              <tbody>{payingBusinesses.map(b=>{
                const paymentStatus=b.payment_status||b.subscription_payment_status||(hasPaymentFields?'Not available':'Backend not connected')
                return <tr key={b.public_id}>
                  <td><b>{b.name}</b><small style={s.cellSub}>{b.address||''}</small></td>
                  <td>{b.contact_person||b.owner_name||b.owner_full_name||'—'}<small style={s.cellSub}>{b.phone||b.contact_number||b.mobile||'No contact number'}</small></td>
                  <td>{b.plan||'—'}</td>
                  <td><StatusPill value={paymentStatus}/></td>
                  <td>{dateLabel(b.last_payment_at||b.last_paid_at)}</td>
                  <td>{dateLabel(b.next_due_at||b.next_billing_at||b.subscription_ends_at)}</td>
                </tr>
              })}</tbody>
            </table>
          </div>
          {!payingBusinesses.length&&<div style={s.empty}>No paying businesses recorded yet.</div>}
        </section>

        <section style={s.card}>
          <div style={s.sectionHead}>
            <div>
              <div style={s.eyebrow}>EARNINGS</div>
              <h2 style={s.h2}>Commission activity</h2>
              <p style={s.note}>This view intentionally shows the partner commission instead of LoyaltyTree's gross revenue.</p>
            </div>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={s.table}>
              <thead><tr><th>Business</th><th>Your commission</th><th>Status</th><th>Date earned</th></tr></thead>
              <tbody>{commissions.map(c=><tr key={c.public_id}>
                <td><b>{c.business_name}</b></td>
                <td><b>{money(c.commission_amount)}</b></td>
                <td><StatusPill value={c.status}/></td>
                <td>{dateLabel(c.earned_at)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!commissions.length&&<div style={s.empty}>No commission activity yet.</div>}
        </section>

        <section style={s.card}>
          <div style={s.sectionHead}>
            <div>
              <div style={s.eyebrow}>PAYOUT RECORDS</div>
              <h2 style={s.h2}>Payout history & receipts</h2>
              <p style={s.note}>Every completed payout should have a date, amount, method and receipt uploaded by Super Admin.</p>
            </div>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={s.table}>
              <thead><tr><th>Payout date</th><th>Amount</th><th>Method</th><th>Status</th><th>Receipt</th></tr></thead>
              <tbody>{payouts.map((p,i)=><tr key={p.public_id||p.id||i}>
                <td>{dateLabel(p.paid_at||p.payout_date||p.created_at)}</td>
                <td><b>{money(p.amount||p.total_amount)}</b></td>
                <td>{p.method||p.payout_method||'—'}</td>
                <td><StatusPill value={p.status||'PAID'}/></td>
                <td>{p.receipt_url?<a href={p.receipt_url} target="_blank" rel="noreferrer" style={s.receiptLink}>View receipt ↗</a>:'—'}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!payouts.length&&<div style={s.empty}>No payout history yet. This section will populate once the backend payout ledger is added.</div>}
        </section>
      </>}

      {activeTab==='demo'&&<>
        <section style={s.demoCard}>
          <div style={s.demoTop}>
            <div>
              <div style={s.demoBadge}>LIVE SALES DEMO</div>
              <h2 style={{...s.h2,fontSize:24,marginTop:7}}>Agyaman Express</h2>
              <p style={s.note}>Use the real LoyaltyTree flow when presenting to a potential client. Their test card can be added to Apple Wallet or Google Wallet and used with the demo cashier.</p>
            </div>
            <div style={s.demoStats}><b>{demo?.customer_count||0}</b><span>demo customers</span></div>
          </div>

          <div style={s.demoActions}>
            <button style={s.actionPrimary} onClick={()=>setShowQr(true)}>📱 Share Demo Join QR</button>
            <button style={s.action} onClick={openEditor} disabled={working}>🎨 Edit Agyaman Card</button>
            <button style={s.action} onClick={()=>openNormalCashier(demoCashiers[0]||null)} disabled={working}>📷 Open Normal Cashier</button>
            <button style={s.action} onClick={sendSampleNotification} disabled={working}>🔔 Send Sample Notification</button>
          </div>

          <div style={s.demoHint}>
            <b>Suggested presentation:</b> Scan QR → join Agyaman Express → add card to Wallet → create/open cashier → scan Wallet card → add a stamp → refresh activity → send sample notification.
            {demo?.latest_customer?.name&&<span> Latest demo signup: <b>{demo.latest_customer.name}</b>.</span>}
          </div>
        </section>

        <section style={s.card}>
          <div style={s.sectionHead}>
            <div><h2 style={s.h2}>Agyaman Express Cashiers</h2><p style={s.note}>Create demo cashiers for live presentations.</p></div>
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
              <span>📧 {c.email}</span><span>Business ID: <b>{demo?.business_slug}</b></span>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:4}}>
                <button style={s.smallBtn} onClick={()=>openNormalCashier(c)}>📷 Open Camera Cashier</button>
                <button style={s.smallDanger} onClick={()=>deleteDemoCashier(c.public_id)}>Remove</button>
              </div>
            </div>)}
            {!demoCashiers.length&&<div style={s.empty}>No demo cashier yet.</div>}
          </div>
        </section>

        <section style={s.card}>
          <div style={s.sectionHead}>
            <div><h2 style={s.h2}>Demo Customers & Stamp Activity</h2><p style={s.note}>Demo-only customer activity for sales presentations.</p></div>
            <button style={s.action} onClick={loadDemoCustomers} disabled={customersLoading}>{customersLoading?'Refreshing…':'↻ Refresh Activity'}</button>
          </div>
          <div style={s.grid}>
            {demoCustomers.map(c=><div style={s.customer} key={c.public_id}>
              <div style={s.customerTop}><b>{c.name||'Demo Customer'}</b><span style={s.stampPill}>⭐ {Number(c.stamp_count||0)} stamps</span></div>
              <span style={s.customerId}>Card ID: {c.public_id}</span>
              <span>Joined: {c.created_at?new Date(c.created_at).toLocaleString():'—'}</span>
              <span>Last activity: {c.updated_at?new Date(c.updated_at).toLocaleString():'—'}</span>
            </div>)}
            {!demoCustomers.length&&<div style={s.empty}>No demo customers yet.</div>}
          </div>
        </section>
      </>}
    </main>

    {showQr&&demo?.join_url&&<div style={s.overlay} onMouseDown={e=>{if(e.target===e.currentTarget)setShowQr(false)}}>
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

function DetailRow({label,value}){
  return <div style={s.detailRow}><span>{label}</span><b>{value||'—'}</b></div>
}

function MiniStat({label,value}){
  return <div style={s.miniStat}><span>{label}</span><b>{value}</b></div>
}

function StatusPill({value}){
  const raw=String(value||'').toUpperCase()
  const positive=['PAID','ACTIVE','PAYABLE','COMPLETED'].some(x=>raw.includes(x))
  const warning=['DUE','PENDING','PROCESSING'].some(x=>raw.includes(x))
  const style=positive?s.statusGood:warning?s.statusWarn:s.statusNeutral
  return <span style={style}>{statusLabel(value)}</span>
}

const s={
  page:{minHeight:'100vh',background:'#f8fafc',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',color:'#0f172a'},
  loadingCard:{maxWidth:560,margin:'80px auto',background:'white',border:'1px solid #e2e8f0',borderRadius:16,padding:24,textAlign:'center'},
  header:{background:'#0f766e',color:'white',padding:'22px clamp(18px,5vw,60px)',display:'flex',justifyContent:'space-between',gap:20,alignItems:'center'},
  kicker:{fontSize:11,fontWeight:800,letterSpacing:1.4,opacity:.8},h1:{margin:'4px 0',fontSize:28},sub:{fontSize:13,opacity:.9},
  logout:{border:'1px solid rgba(255,255,255,.5)',background:'transparent',color:'white',borderRadius:9,padding:'9px 14px',fontWeight:700,cursor:'pointer'},
  tabBarWrap:{background:'white',borderBottom:'1px solid #e2e8f0'},tabBar:{maxWidth:1200,margin:'0 auto',padding:'0 clamp(14px,4vw,34px)',display:'flex',gap:6},
  tab:{border:0,background:'transparent',padding:'14px 16px',fontWeight:800,color:'#64748b',cursor:'pointer',borderBottom:'3px solid transparent'},
  tabActive:{border:0,background:'transparent',padding:'14px 16px',fontWeight:900,color:'#0f766e',cursor:'pointer',borderBottom:'3px solid #0f766e'},
  main:{maxWidth:1200,margin:'0 auto',padding:'24px clamp(14px,4vw,34px)'},
  heroGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,marginBottom:18},
  heroCard:{background:'white',border:'1px solid #e2e8f0',borderRadius:16,padding:18},eyebrow:{fontSize:10,fontWeight:900,letterSpacing:1.2,color:'#64748b'},heroValue:{fontSize:30,fontWeight:900,marginTop:8},heroMeta:{fontSize:11,color:'#64748b',marginTop:6},
  twoCol:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:18},
  card:{background:'white',border:'1px solid #e2e8f0',borderRadius:16,padding:18,marginBottom:18},h2:{margin:'5px 0 6px',fontSize:18},note:{margin:'0 0 15px',fontSize:12,color:'#64748b',lineHeight:1.55},
  sectionHead:{display:'flex',justifyContent:'space-between',gap:14,alignItems:'flex-start',flexWrap:'wrap'},
  infoPill:{background:'#f1f5f9',color:'#475569',borderRadius:999,padding:'5px 9px',fontSize:10,fontWeight:900},
  detailRows:{display:'grid',gap:0,marginTop:10},detailRow:{display:'flex',justifyContent:'space-between',gap:18,padding:'10px 0',borderBottom:'1px solid #f1f5f9',fontSize:12,color:'#64748b'},
  summaryGrid:{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:10,marginTop:14},miniStat:{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:12,padding:13,display:'flex',flexDirection:'column',gap:5,fontSize:11,color:'#64748b'},
  refreshBtn:{border:'1px solid #cbd5e1',background:'white',color:'#475569',borderRadius:9,padding:'8px 11px',fontWeight:800,cursor:'pointer'},
  backendNote:{background:'#fff7ed',border:'1px solid #fed7aa',color:'#9a3412',borderRadius:10,padding:'10px 12px',fontSize:11,lineHeight:1.5,marginBottom:12},
  table:{width:'100%',borderCollapse:'collapse',fontSize:12},cellSub:{display:'block',color:'#94a3b8',fontWeight:400,marginTop:4,maxWidth:260},
  receiptLink:{color:'#0f766e',fontWeight:800,textDecoration:'none',fontSize:12},
  statusGood:{display:'inline-flex',background:'#ecfdf5',color:'#047857',padding:'4px 8px',borderRadius:999,fontSize:10,fontWeight:900,textTransform:'capitalize'},
  statusWarn:{display:'inline-flex',background:'#fff7ed',color:'#9a3412',padding:'4px 8px',borderRadius:999,fontSize:10,fontWeight:900,textTransform:'capitalize'},
  statusNeutral:{display:'inline-flex',background:'#f1f5f9',color:'#64748b',padding:'4px 8px',borderRadius:999,fontSize:10,fontWeight:900,textTransform:'capitalize'},
  empty:{padding:18,color:'#94a3b8',textAlign:'center'},
  grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:10},customer:{display:'flex',flexDirection:'column',gap:6,padding:14,border:'1px solid #e2e8f0',borderRadius:12,fontSize:12,color:'#64748b'},customerTop:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,color:'#0f172a'},stampPill:{background:'#ecfdf5',color:'#047857',padding:'4px 8px',borderRadius:999,fontSize:11,fontWeight:800},customerId:{fontFamily:'monospace',fontSize:10,color:'#94a3b8',wordBreak:'break-all'},
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
  closeStatic:{border:'1px solid #cbd5e1',background:'white',borderRadius:9,padding:'9px 12px',fontWeight:800,cursor:'pointer'},editorBody:{padding:'14px'},
  businessIdBox:{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:10,padding:'10px 12px',fontSize:12,marginBottom:12},
  cashierForm:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:9,marginBottom:14},input:{width:'100%',boxSizing:'border-box',border:'1px solid #cbd5e1',borderRadius:10,padding:'11px 12px',fontSize:13,outline:'none'},
  activePill:{background:'#ecfdf5',color:'#047857',borderRadius:999,padding:'3px 7px',fontSize:10,fontWeight:900},inactivePill:{background:'#f1f5f9',color:'#64748b',borderRadius:999,padding:'3px 7px',fontSize:10,fontWeight:900},
  smallBtn:{border:'1px solid #99f6e4',background:'#f0fdfa',color:'#0f766e',borderRadius:8,padding:'7px 9px',fontSize:11,fontWeight:800,cursor:'pointer'},smallDanger:{border:'1px solid #fecaca',background:'#fff1f2',color:'#be123c',borderRadius:8,padding:'7px 9px',fontSize:11,fontWeight:800,cursor:'pointer'},
}

export default PartnerDashboard
