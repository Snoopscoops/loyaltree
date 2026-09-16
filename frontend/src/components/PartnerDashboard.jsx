import React, { useEffect, useState } from 'react'

function money(v){return `₱${Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}
function dateLabel(v){
  if(!v)return '—'
  const d=new Date(v)
  return Number.isNaN(d.getTime())?'—':d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})
}
function statusLabel(v){return String(v||'').replaceAll('_',' ').trim()||'Not available'}

function PartnerDashboard({API_BASE,user,onLogout}){
  const [data,setData]=useState(null)
  const [error,setError]=useState('')

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

  if(!data)return <div style={s.page}><div style={s.loadingCard}>{error||'Loading partner dashboard…'}</div></div>

  const {partner={},stats={},businesses=[],commissions=[]}=data
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
            <p style={s.note}>Only businesses that have paid are intended to appear here. No customer personal data is exposed.</p>
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
            <p style={s.note}>This view shows the partner commission only, not LoyaltyTree's gross revenue.</p>
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
            <p style={s.note}>Completed payouts can include the date, amount, payout method and receipt uploaded by Super Admin.</p>
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
    </main>
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
  const warning=['DUE','PENDING','PROCESSING','OVERDUE','PAST_DUE'].some(x=>raw.includes(x))
  const style=positive?s.statusGood:warning?s.statusWarn:s.statusNeutral
  return <span style={style}>{statusLabel(value)}</span>
}

const s={
  page:{minHeight:'100vh',background:'#f8fafc',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',color:'#0f172a'},
  loadingCard:{maxWidth:560,margin:'80px auto',background:'white',border:'1px solid #e2e8f0',borderRadius:16,padding:24,textAlign:'center'},
  header:{background:'#0f766e',color:'white',padding:'22px clamp(18px,5vw,60px)',display:'flex',justifyContent:'space-between',gap:20,alignItems:'center'},
  kicker:{fontSize:11,fontWeight:800,letterSpacing:1.4,opacity:.8},h1:{margin:'4px 0',fontSize:28},sub:{fontSize:13,opacity:.9},
  logout:{border:'1px solid rgba(255,255,255,.5)',background:'transparent',color:'white',borderRadius:9,padding:'9px 14px',fontWeight:700,cursor:'pointer'},
  main:{maxWidth:1200,margin:'0 auto',padding:'24px clamp(14px,4vw,34px)'},
  heroGrid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:12,marginBottom:18},
  heroCard:{background:'white',border:'1px solid #e2e8f0',borderRadius:16,padding:18},
  eyebrow:{fontSize:10,fontWeight:900,letterSpacing:1.2,color:'#64748b'},heroValue:{fontSize:30,fontWeight:900,marginTop:8},heroMeta:{fontSize:11,color:'#64748b',marginTop:6},
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
}

export default PartnerDashboard
