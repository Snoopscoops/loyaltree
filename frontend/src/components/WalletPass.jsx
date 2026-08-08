import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

const CARD_LABELS = {stamp:'STAMP CARD',points:'POINTS CARD',membership:'MEMBERSHIP CARD',multipass:'MULTIPASS',vip:'VIP CARD'}
const PLAN_ICONS = {stamp:'🎫',points:'⭐',multipass:'🎟️',membership:'👑',vip:'💎'}
const STAT_ICONS = {
  'Active until':'📅','Valid until':'📅','Member since':'🧑','Membership type':'🏋️',
  'Next benefit':'🎁','Reward':'🎁','Next tier':'🏆','Visits':'👣','About':'ℹ️','Business':'🏢',
}
const GOOD_STATUS = ['ACTIVE','LIFETIME']

function formatDate(value){
  if(!value)return '—'
  const d=new Date(value)
  return Number.isNaN(d.getTime())?String(value):d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})
}

function WalletPass({API_BASE}){
  const {customerId}=useParams()
  const [data,setData]=useState(null)
  const [error,setError]=useState('')
  useEffect(()=>{
    fetch(`${API_BASE}/api/v1/customer/${customerId}/wallet-pass`)
      .then(async r=>{const j=await r.json();if(!r.ok||!j.pass_data)throw new Error(j.detail||'Pass not found');setData(j)})
      .catch(e=>setError(e.message||'Failed to load pass'))
  },[API_BASE,customerId])

  const view=useMemo(()=>{
    const p=data?.pass_data
    if(!p)return null
    const type=p.card_type||'stamp'
    // metricLabel/metricValue double as the small STATUS pill next to the QR code
    let metricLabel='STAMPS',metricValue=`${p.stamps||0} / ${p.goal||8}`,metricSub=p.reward_name||'Reward'
    let planTitle=p.card_name||CARD_LABELS[type]||'Loyalty Card',planSub=p.description||''
    const details=[]
    if(type==='points'){
      metricLabel='POINTS BALANCE';metricValue=Number(p.points_balance||0).toLocaleString();metricSub='points'
      planSub=planSub||`${metricValue} points available`
      details.push(['Reward',p.reward_name||'Rewards'])
    }else if(type==='multipass'){
      metricLabel='SESSIONS LEFT';metricValue=`${p.sessions_remaining??0} / ${p.sessions_total||0}`;metricSub='sessions'
      planSub=planSub||p.multipass_description||'Session pass'
      details.push(['Valid until',formatDate(p.multipass_expires_at)],['Sessions left',metricValue])
    }else if(type==='membership'){
      const s=String(p.membership_effective_status||p.membership_status||'inactive').toUpperCase()
      metricLabel='STATUS';metricValue=s;metricSub='member'
      planSub=planSub||'Full Access'
      details.push(
        ['Active until',s==='LIFETIME'?'Lifetime':formatDate(p.membership_expires_at)],
        ['Member since',formatDate(p.membership_started_at)],
        ['Membership type',planTitle],
        ['Next benefit',(p.membership_services&&p.membership_services[0])||'Rewards'],
      )
    }else if(type==='vip'){
      metricLabel='VIP TIER';metricValue=String(p.vip_tier?.name||'VIP').toUpperCase();metricSub=`${Number(p.vip_points||0).toLocaleString()} VIP points`
      planSub=planSub||metricSub
      details.push(['Next tier',p.vip_next_tier?.name||'Top tier'])
    }else{
      const left=Math.max(Number(p.goal||8)-Number(p.stamps||0),0)
      metricSub=left?`${left} more to ${p.reward_name||'reward'}`:`${p.reward_name||'Reward'} ready`
      planSub=planSub||metricSub
      details.push(['Reward',p.reward_name||'Reward'])
    }
    if(details.length<4&&p.description)details.push(['About',p.description])
    if(details.length<4&&p.business_category?.label)details.push(['Business',`${p.business_category.icon||''} ${p.business_category.label}`])
    return {
      label:CARD_LABELS[type]||'LOYALTY CARD',
      metricLabel,metricValue,metricSub,
      planIcon:PLAN_ICONS[type]||'🎫',planTitle,planSub,
      details:details.slice(0,4),
    }
  },[data])

  if(error)return <div style={S.state}>{error}</div>
  if(!data||!view)return <div style={S.state}>Loading your card…</div>
  const p=data.pass_data
  const design=p.wallet_design||{}
  const bg=design.background||p.primary_color||'#0d9488'
  const secondary=design.secondary||'#14b8a6'
  const statusGood=GOOD_STATUS.includes(view.metricValue)
  const share=async()=>{const payload={title:p.business_name,text:'My LoyaltyTree card',url:location.href};if(navigator.share){try{await navigator.share(payload)}catch{}}else{await navigator.clipboard.writeText(location.href);alert('Card link copied')}}
  return <main style={S.page}>
    <div style={S.top}><b>🌳 LoyaltyTree</b></div>
    <section style={{...S.card,background:`linear-gradient(135deg,${bg},${secondary})`}}>
      {design.show_background!==false&&p.hero_image_url&&<img src={p.hero_image_url} alt="" style={S.hero}/>}
      <div style={S.overlay}/>
      <div style={S.inner}>
        <div className="ltheader" style={S.header}>
          <div style={S.brand}>
            {p.program_logo_url?<img src={p.program_logo_url} alt="" style={S.logo}/>:<div style={S.logoFallback}>{p.business_category?.icon||'🌳'}</div>}
            <div style={{minWidth:0}}>
              <div style={S.biz}>{p.business_name}</div>
              <div style={S.type}>{view.label}</div>
            </div>
          </div>
          <div style={S.headerRight}>
            <div style={S.qrbox}><img src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(p.qr_code)}`} alt="QR" style={S.qr}/></div>
            <div style={S.statusPill}>
              <span style={{...S.statusDot,background:statusGood?'#4ade80':'#f59e0b'}}/>
              <div>
                <div style={S.statusLabel}>{view.metricLabel}</div>
                <div style={{...S.statusValue,color:statusGood?'#4ade80':'#fff'}}>{view.metricValue}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={S.name}>{p.customer_name}</div>
        <div style={S.divider}/>

        <div style={S.planRow}>
          <div style={S.planIcon}>{view.planIcon}</div>
          <div style={{minWidth:0}}>
            <div style={S.eyebrow}>PLAN</div>
            <div style={S.planTitle}>{view.planTitle}</div>
            {view.planSub&&<div style={S.planSub}>{view.planSub}</div>}
          </div>
        </div>
      </div>
    </section>

    <section className="ltstats" style={S.details}>
      {view.details.map(([k,v])=>
        <div key={k} style={S.detail}>
          <div style={S.detailIcon}>{STAT_ICONS[k]||'📌'}</div>
          <div style={{minWidth:0}}>
            <span style={S.detailLabel}>{k}</span>
            <strong style={S.detailValue}>{v||'—'}</strong>
          </div>
        </div>
      )}
    </section>

    <section style={S.banner}>
      <span style={S.bannerIcon}>⭐</span>
      <span>Thank you for being a valued member! Keep coming back for more rewards.</span>
    </section>

    <section style={S.actions}>
      {data.save_url&&<button style={{...S.btn,...S.google}} onClick={()=>window.open(data.save_url,'_blank')}>Add to Google Wallet</button>}
      <a style={{...S.btn,...S.apple}} href={data.apple_pass_url||`${API_BASE}/api/v1/customer/${customerId}/apple-wallet-pass`}>Add to Apple Wallet</a>
      <button style={{...S.btn,...S.share}} onClick={share}>Share Card</button>
    </section>
    <style>{`
      @media(max-width:640px){
        .ltheader{flex-direction:column;align-items:flex-start!important;gap:16px!important}
        .ltstats{grid-template-columns:repeat(2,1fr)!important}
      }
    `}</style>
  </main>
}

const S={
  page:{minHeight:'100vh',background:'#080b12',color:'#fff',padding:'24px 16px 44px',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'},
  state:{minHeight:'100vh',display:'grid',placeItems:'center',background:'#080b12',color:'#fff',fontFamily:'sans-serif'},
  top:{maxWidth:1120,margin:'0 auto 14px',fontSize:12,color:'#8390a5'},

  card:{position:'relative',isolation:'isolate',overflow:'hidden',maxWidth:1120,margin:'0 auto',borderRadius:28,padding:'clamp(22px,4vw,40px)',border:'1px solid rgba(255,255,255,.14)',boxShadow:'0 28px 80px rgba(0,0,0,.46)'},
  hero:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',zIndex:-3,opacity:.35},
  overlay:{position:'absolute',inset:0,zIndex:-2,background:'linear-gradient(160deg,rgba(3,6,16,.18),rgba(3,6,16,.55))'},
  inner:{position:'relative',zIndex:2},

  header:{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:18,flexWrap:'wrap'},
  brand:{display:'flex',alignItems:'center',gap:14},
  logo:{width:58,height:58,borderRadius:'50%',objectFit:'cover',background:'#fff'},
  logoFallback:{width:58,height:58,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:27,background:'rgba(255,255,255,.16)'},
  biz:{fontSize:'clamp(19px,2.6vw,28px)',fontWeight:800,lineHeight:1.15},
  type:{fontSize:11,letterSpacing:1.4,fontWeight:800,color:'rgba(255,255,255,.65)',marginTop:6},

  headerRight:{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:12},
  qrbox:{width:110,padding:8,background:'#fff',borderRadius:16,boxShadow:'0 14px 35px rgba(0,0,0,.28)'},
  qr:{display:'block',width:'100%',aspectRatio:'1 / 1'},
  statusPill:{display:'flex',alignItems:'center',gap:8,background:'rgba(10,14,24,.45)',border:'1px solid rgba(255,255,255,.14)',borderRadius:12,padding:'8px 12px'},
  statusDot:{width:9,height:9,borderRadius:'50%',flexShrink:0},
  statusLabel:{fontSize:9,letterSpacing:1.1,fontWeight:800,color:'rgba(255,255,255,.6)'},
  statusValue:{fontSize:14,fontWeight:800,marginTop:1},

  name:{fontSize:'clamp(26px,4.5vw,44px)',fontWeight:750,lineHeight:1.08,margin:'26px 0 20px'},
  divider:{height:1,background:'rgba(255,255,255,.18)',margin:'0 0 20px'},

  planRow:{display:'flex',alignItems:'center',gap:14},
  planIcon:{width:46,height:46,flexShrink:0,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:21,background:'rgba(255,255,255,.14)'},
  eyebrow:{fontSize:9,letterSpacing:1.3,fontWeight:800,color:'rgba(255,255,255,.6)'},
  planTitle:{fontSize:'clamp(17px,2.4vw,22px)',fontWeight:800,marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
  planSub:{fontSize:12,color:'rgba(255,255,255,.7)',marginTop:2,fontWeight:600,letterSpacing:.4},

  details:{maxWidth:1120,margin:'14px auto 0',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10},
  detail:{display:'flex',alignItems:'center',gap:10,background:'#111827',border:'1px solid #202a3b',borderRadius:13,padding:'12px 13px',minWidth:0},
  detailIcon:{width:32,height:32,flexShrink:0,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:15,background:'rgba(148,163,184,.14)'},
  detailLabel:{display:'block',color:'#75839a',fontSize:9,textTransform:'uppercase',letterSpacing:.7,marginBottom:3},
  detailValue:{display:'block',fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},

  banner:{maxWidth:1120,margin:'10px auto 0',display:'flex',alignItems:'center',gap:12,background:'#111827',border:'1px solid #202a3b',borderRadius:13,padding:'14px 16px',fontSize:13,color:'#cbd5e1'},
  bannerIcon:{fontSize:18,flexShrink:0},

  actions:{maxWidth:1120,margin:'13px auto 0',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10},
  btn:{border:0,borderRadius:12,padding:14,textAlign:'center',textDecoration:'none',fontWeight:750,fontSize:13,cursor:'pointer'},
  google:{background:'#1a73e8',color:'#fff'},apple:{background:'#fff',color:'#050505'},share:{background:'#151b28',color:'#dbe4f1',border:'1px solid #273247'}
}
export default WalletPass
