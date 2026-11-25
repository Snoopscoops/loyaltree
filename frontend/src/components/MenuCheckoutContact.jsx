import React, { useEffect, useRef, useState } from 'react'

export function validContactPhone(value) {
  const phone=String(value || '').trim()
  return /^\+?[0-9 ()-]{7,32}$/.test(phone) && phone.replace(/\D/g,'').length >= 7 && phone.replace(/\D/g,'').length <= 15
}

// A verified contact token is tab-scoped; never persist actual phone/address in browser storage.
function contactGrant(key, legacyToken) {
  try {
    const saved=JSON.parse(sessionStorage.getItem(key)||'null')
    return saved?.card===legacyToken ? saved.token || '' : ''
  } catch { return '' }
}
function rememberGrant(key, card, token) {
  try { if(token) sessionStorage.setItem(key,JSON.stringify({card,token}));else sessionStorage.removeItem(key) } catch {}
}

export default function MenuCheckoutContact({apiBase,businessId,cardToken,service,phone,setPhone,address,setAddress,onName}) {
  const key='lt-menu-contact-grant:'+businessId
  const url=apiBase ? apiBase+'/api/v1/public/menu/'+encodeURIComponent(businessId)+'/card/contact' : ''
  const [grant,setGrant]=useState('')
  const [profile,setProfile]=useState(null)
  const [selected,setSelected]=useState('')
  const [label,setLabel]=useState('Home')
  const [challenge,setChallenge]=useState('')
  const [code,setCode]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const active=useRef(true)
  const action=useRef(0)

  async function call(path,token,method='GET',body,signal) {
    const result=await fetch(url+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal})
    const payload=await result.json().catch(()=>({}))
    if(!result.ok) {
      const error=new Error(result.status===404?'Secure saving is not connected to this preview backend yet.':typeof payload.detail==='string'?payload.detail:'Contact details are temporarily unavailable.')
      error.status=result.status
      throw error
    }
    return payload
  }
  function applyProfile(value,replace=false) {
    setProfile(value)
    onName(value.name || '')
    setPhone(current=>replace || !current.trim() ? value.phone || '' : current)
    const chosen=(value.addresses||[]).find(a=>a.id===value.default_address_id)
    if(chosen) {setSelected(chosen.id);setLabel(chosen.label);setAddress(current=>replace || !current.trim()?chosen.address:current)}
  }
  useEffect(()=>{
    active.current=true
    const seq=++action.current
    const abort=new AbortController()
    setGrant('');setProfile(null);setChallenge('');setCode('');setMessage('')
    const token=cardToken && url ? contactGrant(key,cardToken):''
    if(token) {
      setBusy(true)
      call('',token,'GET',undefined,abort.signal).then(value=>{
        if(seq!==action.current)return
        setGrant(token);applyProfile(value)
      }).catch(error=>{
        if(seq!==action.current)return
        if(error.status===401)rememberGrant(key,'','')
        else setMessage(error.message)
      }).finally(()=>{if(seq===action.current)setBusy(false)})
    } else setBusy(false)
    return ()=>{active.current=false;++action.current;abort.abort()}
  },[url,cardToken,key])
  async function perform(work) {
    if(busy || !url || !cardToken)return
    const seq=++action.current
    const current=()=>active.current && seq===action.current
    setBusy(true);setMessage('')
    try {await work(current)} catch(error){if(current())setMessage(error.message||'Please try again.')}
    finally {if(current())setBusy(false)}
  }
  const request=()=>perform(async current=>{
    const value=await call('/request',cardToken,'POST')
    if(current()){setChallenge(value.challenge_id);setCode('');setMessage('Enter the code sent to your loyalty card email.')}
  })
  const verify=()=>perform(async current=>{
    const value=await call('/verify',cardToken,'POST',{challenge_id:challenge,code})
    if(current()){rememberGrant(key,cardToken,value.token);setGrant(value.token);setChallenge('');setCode('');applyProfile(value.profile,true);setMessage('Contact details unlocked.')}
  })
  const choose=id=>{
    setSelected(id)
    const saved=(profile?.addresses||[]).find(a=>a.id===id)
    setAddress(saved?.address||'')
    setLabel(saved?.label||'Home')
  }
  const save=(remove=false)=>perform(async current=>{
    if(!grant || !profile)throw new Error('Verify your loyalty card before saving.')
    if(!validContactPhone(phone))throw new Error('Enter a valid mobile number.')
    let addresses=[...(profile.addresses||[])]
    let defaultId=profile.default_address_id||''
    if(service==='delivery') {
      if(remove) {
        addresses=addresses.filter(a=>a.id!==selected)
        if(defaultId===selected)defaultId=addresses[0]?.id||''
      } else {
        if(address.trim().length<5 || !label.trim())throw new Error('Complete the address and its label.')
        const id=selected||crypto.randomUUID()
        const next={id,label:label.trim(),address:address.trim()}
        addresses=addresses.some(a=>a.id===id)?addresses.map(a=>a.id===id?next:a):[...addresses,next]
        if(addresses.length>10)throw new Error('Remove an old address before saving a new one.')
        defaultId=id
      }
    }
    const value=await call('',grant,'PUT',{phone:phone.trim(),addresses,default_address_id:defaultId})
    if(current()){
      setProfile(value);setMessage(remove?'Saved address removed.':'Phone and contact details saved for your next order.')
      if(service==='delivery'){const chosen=value.addresses.find(a=>a.id===value.default_address_id);setSelected(chosen?.id||'');setLabel(chosen?.label||'Home');setAddress(chosen?.address||'')}
    }
  })
  return <section className="lt-v20-contact">
    <h3>Contact details</h3>
    {cardToken && !grant && <div className="lt-v20-private">
      <strong>Use your saved loyalty card details</strong>
      <small>Verify your email to securely load your registered phone and addresses.</small>
      {challenge ? <><label className="lt-qr-field"><span>6-digit verification code</span><input autoComplete="one-time-code" inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/></label><button type="button" className="lt-v20-outline" disabled={busy||code.length!==6} onClick={verify}>Verify code</button><button type="button" className="lt-qr-text-button" disabled={busy} onClick={request}>Request another code</button></> : <button type="button" className="lt-v20-outline" disabled={busy||!url} onClick={request}>{busy?'Loading…':'Unlock saved details'}</button>}
    </div>}
    {grant && <small className="lt-v20-verified">✓ Verified loyalty contact</small>}
    <label className="lt-qr-field"><span>Mobile number <b className="lt-qr-required">*</b></span><input type="tel" autoComplete="tel" required maxLength={32} placeholder="09XXXXXXXXX" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
    {service==='delivery' && <>
      {!!profile?.addresses?.length && <label className="lt-qr-field"><span>Choose a saved address</span><select value={selected} onChange={e=>choose(e.target.value)}>{profile.addresses.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}<option value="">Add another address</option></select></label>}
      <label className="lt-qr-field lt-qr-note-field"><span>Delivery address <b className="lt-qr-required">*</b></span><textarea autoComplete="street-address" rows={3} maxLength={500} required placeholder="House / unit, street, barangay, city, province, landmark" value={address} onChange={e=>setAddress(e.target.value)}/></label>
      {grant && <label className="lt-qr-field"><span>Address label</span><input value={label} maxLength={40} placeholder="Home / Office" onChange={e=>setLabel(e.target.value)}/></label>}
    </>}
    {grant ? <><button type="button" className="lt-v20-outline" disabled={busy||!validContactPhone(phone)||(service==='delivery'&&address.trim().length<5)} onClick={()=>save()}>{busy?'Saving…':service==='delivery'?'Save phone & set address as default':'Save phone number'}</button>{service==='delivery'&&selected && <button type="button" className="lt-qr-text-button" disabled={busy} onClick={()=>save(true)}>Remove selected saved address</button>}<small>Changes apply to this checkout only unless you save them. Your loyalty identity stays unchanged.</small></> : <small>Connect and verify your loyalty card to save details for future orders. Unsaved details are only kept in this checkout.</small>}
    {message && <p role="status" className="lt-v20-contact-message">{message}</p>}
  </section>
}
