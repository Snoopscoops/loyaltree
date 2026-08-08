import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

const CARD_LABELS = {stamp:'STAMP CARD',points:'POINTS CARD',membership:'MEMBERSHIP CARD',multipass:'MULTIPASS',vip:'VIP CARD'}

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
    let metricLabel='STAMPS',metricValue=`${p.stamps||0} / ${p.goal||8}`,metricSub=p.reward_name||'Reward'
    const details=[]
    if(type==='points'){metricLabel='POINTS BALANCE';metricValue=Number(p.points_balance||0).toLocaleString();metricSub='points';details.push(['Reward',p.reward_name||'Rewards'])}
    else if(type==='multipass'){metricLabel='SESSIONS LEFT';metricValue=`${p.sessions_remaining??0} / ${p.sessions_total||0}`;metricSub='sessions';details.push(['Valid until',formatDate(p.multipass_expires_at)])}
    else if(type==='membership'){
      const s=String(p.membership_effective_status||p.membership_status||'inactive').toUpperCase()
      metricLabel='STATUS';metricValue=s;metricSub='member'
      details.push(['Active until',s==='LIFETIME'?'Lifetime':formatDate(p.membership_expires_at)],['Member since',formatDate(p.membership_started_at)],['Visits',String(p.total_visits||0)])
    }else if(type==='vip'){metricLabel='VIP TIER';metricValue=String(p.vip_tier?.name||'VIP').toUpperCase();metricSub=`${Number(p.vip_points||0).toLocaleString()} VIP points`;details.push(['Next tier',p.vip_next_tier?.name||'Top tier'])}
    else{const left=Math.max(Number(p.goal||8)-Number(p.stamps||0),0);metricSub=left?`${left} more to ${p.reward_name||'reward'}`:`${p.reward_name||'Reward'} ready`;details.push(['Reward',p.reward_name||'Reward'])}
    if(p.description)details.push(['About',p.description])
    if(p.business_category?.label)details.push(['Business',`${p.business_category.icon||''} ${p.business_category.label}`])
    return {label:CARD_LABELS[type]||'LOYALTY CARD',metricLabel,metricValue,metricSub,details:details.slice(0,4)}
  },[data])

  if(error)return <div style={S.state}>{error}</div>
  if(!data||!view)return <div style={S.state}>Loading your card…</div>
  const p=data.pass_data
  const design=p.wallet_design||{}
  const bg=design.background||p.primary_color||'#0d9488'
  const secondary=design.secondary||'#14b8a6'
  const share=async()=>{const payload={title:p.business_name,text:'My LoyaltyTree card',url:location.href};if(navigator.share){try{await navigator.share(payload)}catch{}}else{await navigator.clipboard.writeText(location.href);alert('Card link copied')}}
  return <main style={S.page}>
    <div style={S.top}><b>🌳 LoyaltyTree</b><span>{view.label}</span></div>
    <section style={{...S.card,background:`linear-gradient(135deg,${bg},${secondary})`}}>
      {design.show_background!==false&&p.hero_image_url&&<img src={p.hero_image_url} alt="" style={S.hero}/>}
      <div style={S.overlay}/>
      <div className="ltgrid" style={S.grid}>
        <div style={S.left}>
          <div style={S.brand}>
            {p.program_logo_url?<img src={p.program_logo_url} alt="" style={S.logo}/>:<div style={S.logoFallback}>{p.business_category?.icon||'🌳'}</div>}
            <div style={{minWidth:0}}><div style={S.biz}>{p.business_name}</div><div style={S.type}>{view.label}</div></div>
          </div>
          <div style={S.member}>
            <div style={S.eyebrow}>MEMBER</div><div style={S.name}>{p.customer_name}</div>
            <div style={S.eyebrow}>{view.metricLabel}</div>
            <div style={{...S.metric,color:['ACTIVE','LIFETIME'].includes(view.metricValue)?'#4ade80':'#fff'}}>{view.metricValue}</div>
            <div style={S.sub}>{view.metricSub}</div>
          </div>
        </div>
        <div style={S.right}>
          <div style={S.qrbox}><img src={`https://api.qrserver.com/v1/create-qr-code/?size=420x420&data=${encodeURIComponent(p.qr_code)}`} alt="QR" style={S.qr}/></div>
          <div style={S.scan}>PRESENT TO CHECK IN</div>
        </div>
      </div>
    </section>
    <section style={S.details}>{view.details.map(([k,v])=><div key={k} style={S.detail}><span style={S.detailLabel}>{k}</span><strong style={S.detailValue}>{v||'—'}</strong></div>)}</section>
    <section style={S.actions}>
      {data.save_url&&<button style={{...S.btn,...S.google}} onClick={()=>window.open(data.save_url,'_blank')}>Add to Google Wallet</button>}
      <a style={{...S.btn,...S.apple}} href={data.apple_pass_url||`${API_BASE}/api/v1/customer/${customerId}/apple-wallet-pass`}>Add to Apple Wallet</a>
      <button style={{...S.btn,...S.share}} onClick={share}>Share Card</button>
    </section>
    <style>{`@media(max-width:680px){.ltgrid{grid-template-columns:minmax(0,1fr) 34%!important;gap:11px!important}}`}</style>
  </main>
}

const S={
  page:{minHeight:'100vh',background:'#080b12',color:'#fff',padding:'24px 16px 44px',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif'},
  state:{minHeight:'100vh',display:'grid',placeItems:'center',background:'#080b12',color:'#fff',fontFamily:'sans-serif'},
  top:{maxWidth:1120,margin:'0 auto 14px',display:'flex',justifyContent:'space-between',fontSize:12,color:'#8390a5'},
  card:{position:'relative',isolation:'isolate',overflow:'hidden',maxWidth:1120,margin:'0 auto',aspectRatio:'1.72 / 1',minHeight:320,borderRadius:28,padding:'clamp(22px,4vw,44px)',border:'1px solid rgba(255,255,255,.14)',boxShadow:'0 28px 80px rgba(0,0,0,.46)'},
  hero:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',zIndex:-3},overlay:{position:'absolute',inset:0,zIndex:-2,background:'linear-gradient(90deg,rgba(3,6,16,.86),rgba(3,6,16,.63) 52%,rgba(3,6,16,.26))'},
  grid:{height:'100%',display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(170px,29%)',gap:'clamp(18px,4vw,48px)',position:'relative',zIndex:2},
  left:{display:'flex',flexDirection:'column',minWidth:0},brand:{display:'flex',alignItems:'center',gap:13},logo:{width:58,height:58,borderRadius:16,objectFit:'cover',background:'#fff'},logoFallback:{width:58,height:58,borderRadius:16,display:'grid',placeItems:'center',fontSize:27,background:'rgba(255,255,255,.12)'},
  biz:{fontSize:'clamp(20px,3vw,34px)',fontWeight:850,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},type:{fontSize:10,letterSpacing:1.4,fontWeight:800,color:'rgba(255,255,255,.62)',marginTop:6},
  member:{marginTop:'auto'},eyebrow:{fontSize:9,letterSpacing:1.3,fontWeight:800,color:'rgba(255,255,255,.58)'},name:{fontSize:'clamp(25px,4.5vw,48px)',fontWeight:720,lineHeight:1.06,margin:'7px 0 20px'},metric:{fontSize:'clamp(30px,5vw,54px)',fontWeight:850,lineHeight:.95,marginTop:6},sub:{fontSize:11,color:'rgba(255,255,255,.72)',marginTop:7},
  right:{display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'flex-end'},qrbox:{width:'min(100%,260px)',padding:11,background:'#fff',borderRadius:19,boxShadow:'0 14px 35px rgba(0,0,0,.28)'},qr:{display:'block',width:'100%',aspectRatio:'1 / 1'},scan:{fontSize:9,letterSpacing:1.2,fontWeight:800,color:'rgba(255,255,255,.62)',margin:'10px auto 0'},
  details:{maxWidth:1120,margin:'14px auto 0',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10},detail:{background:'#111827',border:'1px solid #202a3b',borderRadius:13,padding:'12px 13px',minWidth:0},detailLabel:{display:'block',color:'#75839a',fontSize:9,textTransform:'uppercase',letterSpacing:.7,marginBottom:5},detailValue:{display:'block',fontSize:12,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},
  actions:{maxWidth:1120,margin:'13px auto 0',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10},btn:{border:0,borderRadius:12,padding:14,textAlign:'center',textDecoration:'none',fontWeight:750,fontSize:13,cursor:'pointer'},google:{background:'#1a73e8',color:'#fff'},apple:{background:'#fff',color:'#050505'},share:{background:'#151b28',color:'#dbe4f1',border:'1px solid #273247'}
}
export default WalletPass
