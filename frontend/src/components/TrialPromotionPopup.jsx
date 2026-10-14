import React, {useEffect,useState} from 'react'
import {Link,useLocation} from 'react-router-dom'
export default function TrialPromotionPopup({API_BASE}) {
  const {pathname}=useLocation(), [promo,setPromo]=useState(null)
  useEffect(()=>{
    if(pathname!=='/')return
    let cancelled=false
    async function load(){
      try{
        const pricing=await fetch(`${API_BASE}/api/v1/public/pricing-context`).then(r=>r.json())
        const rows=await fetch(`${API_BASE}/api/v1/public/trial-promotions?country=${encodeURIComponent(pricing.country_code||'PH')}`).then(r=>r.json())
        const candidate=Array.isArray(rows)?rows.find(p=>!sessionStorage.getItem(`trial-promo:${p.code}:${p.ends_on}`)):null
        if(!cancelled)setPromo(candidate||null)
      }catch(_){/* Optional promotion. */}
    }
    load();return()=>{cancelled=true}
  },[API_BASE,pathname])
  const formatDate=value=>new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Manila'})
  const close=()=>{try{sessionStorage.setItem(`trial-promo:${promo.code}:${promo.ends_on}`,'1')}catch(_){}setPromo(null)}
  useEffect(()=>{if(!promo)return;const key=e=>{if(e.key==='Escape')close()};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[promo])
  if(!promo||pathname!=='/')return null
  return <div style={{position:'fixed',inset:0,background:'#0f172aaa',zIndex:10000,display:'grid',placeItems:'center',padding:20}} onClick={close}>
    <section role="dialog" aria-modal="true" aria-labelledby="trial-promo-title" onClick={e=>e.stopPropagation()} style={{position:'relative',background:'white',padding:32,borderRadius:24,maxWidth:440,width:'100%',boxSizing:'border-box',textAlign:'center',fontFamily:'system-ui, sans-serif',color:'#0f172a'}}>
      <button autoFocus aria-label="Close promotion" onClick={close} style={{position:'absolute',right:12,top:12}}>×</button>
      <p style={{color:'#c2410c',fontWeight:800}}>{promo.title}</p><h2 id="trial-promo-title">Try Loyalty Tree free for {promo.trial_days} days</h2>
      <p>Give your customers more reasons to return. Enter <strong>{promo.code}</strong> at the final step of business signup.</p>
      <p>Redeem {formatDate(promo.starts_on)}–{formatDate(promo.ends_on)} (Philippine time). One trial per business.</p>
      <Link onClick={close} to={`/signup?coupon=${encodeURIComponent(promo.code)}`} style={{display:'inline-block',background:'#15803d',color:'white',padding:'14px 22px',borderRadius:12,textDecoration:'none',fontWeight:700}}>Claim your free trial</Link>
    </section>
  </div>
}
