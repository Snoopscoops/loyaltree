import React,{useCallback,useEffect,useState} from 'react'
import {useLocation} from 'react-router-dom'
import SubscriptionPayment from './SubscriptionPayment'
import { requestJsonResponse } from './requestTimeout'
import { startVisibilityPolling } from './visibilityPolling'
export default function BusinessAccessGate({API_BASE,user,onLogout,children}) {
  const {pathname}=useLocation()
  const guarded=['/dashboard','/scanner','/cashier','/analytics'].includes(pathname.replace(/\/+$/, '')||'/')
  const [access,setAccess]=useState({businessSlug:null,status:null,error:''})
  const check=useCallback(async(signal)=>{
    try{
      const {response:r,payload:status}=await requestJsonResponse(fetch,`${API_BASE}/api/v1/business/${encodeURIComponent(user.business_slug)}/subscription/access`,{headers:{Authorization:`Bearer ${user.token}`},cache:'no-store',signal},{message:'Checking business access is taking too long. Please try again.'})
      if(!status||typeof status!=='object')throw Error('Could not check account access. Please try again.')
      if(!r.ok)throw Error(status.detail||'Could not check account access')
      return {businessSlug:user.business_slug,status,error:''}
    }catch(e){return {businessSlug:user.business_slug,error:e.message}}
  },[API_BASE,user.business_slug,user.token])
  useEffect(()=>{
    if(!guarded)return
    let cancelled=false
    const controller=new AbortController()
    async function refresh(){
      const result=await check(controller.signal)
      if(!cancelled)setAccess(previous=>result.status?result:{...result,status:previous.businessSlug===result.businessSlug?previous.status:null})
    }
    const stop=startVisibilityPolling(refresh,{intervalMs:60000})
    return()=>{cancelled=true;stop();controller.abort()}
  },[check,guarded])
  const status=access.businessSlug===user.business_slug?access.status:null
  const error=access.businessSlug===user.business_slug?access.error:''
  const retry=async()=>{
    const result=await check()
    setAccess(previous=>result.status?result:{...result,status:previous.businessSlug===result.businessSlug?previous.status:null})
  }
  if(!guarded)return children
  if(error&&!status)return <div style={{padding:32}} role="alert">{error} <button onClick={retry}>Retry</button> <button onClick={onLogout}>Sign out</button></div>
  if(!status)return <p role="status" style={{padding:32}}>Checking business access…</p>
  // Keep the same child position on successful and failed refreshes. Forms and
  // scanner state must survive a temporary network error after initial access.
  return <>
    {error&&<div role="status" style={{padding:12,background:'#fffbeb'}}>Billing check is temporarily unavailable. <button onClick={retry}>Retry</button></div>}
    {!status.billing_hold?children:<main style={{maxWidth:800,margin:'40px auto',padding:24}}><h1>Business access is on hold</h1><p>{status.trial_ends_at&&!status.last_paid_at?'Your free trial has ended.':'Your subscription payment is more than 14 days overdue.'} Renew to restore business access.</p>
      {user.role==='owner'?<><SubscriptionPayment API_BASE={API_BASE} businessSlug={user.business_slug} sessionToken={user.token} onSessionExpired={onLogout} title="Renew your subscription" onPaid={()=>window.location.reload()}/><p>Need help? <a href="/contact">Contact support</a>.</p></>:<p>Please ask the business owner to settle the subscription.</p>}
      <button onClick={onLogout}>Sign out</button>
    </main>}
  </>
}
