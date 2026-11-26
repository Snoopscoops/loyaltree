import React, { useEffect, useRef, useState } from 'react'
import './native-bookings.css'
import MenuCheckoutContact from './MenuCheckoutContact'
import { bookingCardName, readBookingCardToken } from './bookingContactModel'

const emptyResource = kind => ({kind,name:'',capacity:kind==='table'?4:30,duration_minutes:kind==='table'?90:240,price_centavos:0,active:true})
const php = cents => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(cents/100)
const manilaDay = (value=new Date()) => {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));const get=k=>parts.find(p=>p.type===k)?.value;return get('year')+'-'+get('month')+'-'+get('day')}
const dateText = value => new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))
const timeText = value => new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(new Date(value))
const displayReference = value => /^[0-9A-HJKMNP-TV-Z]{12}$/i.test(value||'') ? value.toUpperCase().match(/.{4}/g).join('-') : String(value||'')
const labels = {venue:'Book the entire place',table:'Reserve a table'}
async function json(url, options={}) {
  const response=await fetch(url,{cache:'no-store',...options,headers:{'Content-Type':'application/json',...options.headers}})
  const data=await response.json().catch(()=>null)
  if(!response.ok || !data) throw new Error(typeof data?.detail==='string'?data.detail:'Booking service unavailable. Try again.')
  return data
}
const query = values => new URLSearchParams(values).toString()

export function NativeBookingOwner({API_BASE,user}) {
  const root=API_BASE+'/api/v1/business/'+encodeURIComponent(user.business_slug)+'/native-bookings'
  const auth={Authorization:'Bearer '+user.token}
  const [data,setData]=useState(null), [branch,setBranch]=useState(''), [settings,setSettings]=useState(null)
  const [draft,setDraft]=useState(null), [day,setDay]=useState(''), [blockDay,setBlockDay]=useState(''), [filter,setFilter]=useState('all')
  const [month,setMonth]=useState(manilaDay().slice(0,7))
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('')
  const serial=useRef(0)
  async function load(chosen=branch,chosenMonth=month) {
    const request=++serial.current
    setBusy(true);setError('');setDraft(null)
    try {
      const result=await json(root+'?'+query({branch_id:chosen,month:chosenMonth}),{headers:auth})
      if(request!==serial.current)return
      setData(result);setBranch(result.branch);setSettings(result.settings);setMonth(result.month||chosenMonth)
    } catch(e){if(request===serial.current){setError(e.message);setData(null);setSettings(null)}}
    finally{if(request===serial.current)setBusy(false)}
  }
  useEffect(()=>{setBranch('');setData(null);setSettings(null);load('');return()=>{serial.current++}},[root,user.token])
  const patch=next=>setSettings(s=>({...s,...next}))
  async function write(path,method,body,message) {
    setBusy(true);setError('');setNotice('')
    try{
      await json(root+path,{method,headers:auth,body:JSON.stringify(body)})
      setNotice(message);await load(branch)
    }catch(e){setError(e.message);setBusy(false)}
  }
  function saveSettings() {
    const {venue_enabled,table_enabled,opens_at,closes_at,weekdays,blocked_dates}=settings
    return write('/settings?'+query({branch_id:branch}),'PUT',{venue_enabled,table_enabled,opens_at,closes_at,weekdays,blocked_dates},'Booking settings saved.')
  }
  const rows=(data?.bookings||[]).filter(b=>(filter==='all'||b.status===filter)&&(!day||manilaDay(b.starts_at)===day))
  const [year,monthNumber]=month.split('-').map(Number)
  const firstDay=(new Date(Date.UTC(year,monthNumber-1,1)).getUTCDay()+6)%7
  const days=new Date(Date.UTC(year,monthNumber,0)).getUTCDate()
  const dayCounts=(data?.bookings||[]).reduce((a,b)=>{const d=manilaDay(b.starts_at);if(b.status==='confirmed'||b.status==='pending')a[d]=(a[d]||0)+1;return a},{})
  return <section className="lt-nb" aria-label="Native booking management">
    <header><small>LOYALTYTREE BOOKINGS · BETA</small><h2>Booking settings</h2><p>Manage bookings by branch. Requests are not confirmed until you approve them.</p></header>
    {error&&<p role="alert" className="lt-nb-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!data?<button disabled={busy} onClick={()=>load()}>{busy?'Loading…':'Retry booking settings'}</button>:!data.branches.length?<p>Add an active branch first.</p>:<>
    <label>Branch<select value={branch} disabled={busy} onChange={e=>{setNotice('');load(e.target.value)}}>{data.branches.map(b=><option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></label>
    <fieldset disabled={busy}>
      <label className="lt-nb-check"><input type="checkbox" checked={settings.venue_enabled||settings.table_enabled} onChange={e=>patch({venue_enabled:e.target.checked,table_enabled:e.target.checked})}/>Enable “Reserve our place”</label>
      <p>One customer button. Choose which reservation types this branch offers below, then save branch settings.</p>
      <div className="lt-nb-pair"><label>Opens<input type="time" value={settings.opens_at.slice(0,5)} onChange={e=>patch({opens_at:e.target.value})}/></label><label>Closes<input type="time" value={settings.closes_at.slice(0,5)} onChange={e=>patch({closes_at:e.target.value})}/></label></div>
      <p>Booking days (Manila time)</p><div className="lt-nb-chips">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=><label key={d}><input type="checkbox" checked={settings.weekdays.includes(i+1)} onChange={e=>patch({weekdays:e.target.checked?[...settings.weekdays,i+1]:settings.weekdays.filter(x=>x!==i+1)})}/>{d}</label>)}</div>
      <label>Blocked dates<input type="date" value={blockDay} onChange={e=>setBlockDay(e.target.value)}/></label>
      <button type="button" disabled={!blockDay||settings.blocked_dates.includes(blockDay)} onClick={()=>{patch({blocked_dates:[...settings.blocked_dates,blockDay]});setBlockDay('')}}>Block date</button>
      <div className="lt-nb-chips">{settings.blocked_dates.map(d=><button type="button" key={d} onClick={()=>patch({blocked_dates:settings.blocked_dates.filter(x=>x!==d)})}>{d} ×</button>)}</div>
      {['venue','table'].map(kind=><div className="lt-nb-section" key={kind}>
        <h3>{labels[kind]}</h3>
        <label className="lt-nb-check"><input type="checkbox" checked={settings[kind+'_enabled']} onChange={e=>patch({[kind+'_enabled']:e.target.checked})}/>Offer this reservation type</label>
        <p>{kind==='venue'?'Exclusive use of this entire branch; blocks all table bookings.':'Each table has its own seating capacity and duration.'}</p>
        {data.resources.filter(r=>r.kind===kind).map(r=><div className="lt-nb-row" key={r.id}><span><b>{r.name}</b><small>{r.capacity} guests · {r.kind==='venue'?r.duration_minutes+' min · ':''}{r.active?'Active':'Hidden'}{r.price_centavos?' · '+php(r.price_centavos):''}</small></span><button type="button" onClick={()=>setDraft({...r})}>Edit</button></div>)}
        <button type="button" onClick={()=>setDraft(emptyResource(kind))}>+ {kind==='venue'?'Add venue package':'Add table'}</button>
      </div>)}
      <button type="button" onClick={saveSettings}>Save branch settings</button>
    </fieldset>
    {draft&&<fieldset disabled={busy} className="lt-nb-section"><h3>{draft.id?'Edit':'Add'} {draft.kind==='table'?'table':'venue package'}</h3>
      <label>Name<input maxLength="100" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <label>Seating capacity<input type="number" min="1" max="1000" value={draft.capacity} onChange={e=>setDraft({...draft,capacity:Number(e.target.value)})}/></label>{draft.kind==='venue'&&<label>Package duration (minutes)<input type="number" min="30" max="720" step="30" value={draft.duration_minutes} onChange={e=>setDraft({...draft,duration_minutes:Number(e.target.value)})}/></label>}
      {draft.kind==='venue'&&<label>Package price (PHP; quote only)<input type="number" min="0" max="1000000" step="0.01" value={draft.price_centavos/100} onChange={e=>setDraft({...draft,price_centavos:Math.round(Number(e.target.value)*100)})}/></label>}
      <label className="lt-nb-check"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>Active</label>
      <p>Save branch settings first when adding the first resource. No online deposits in this beta.</p>
      <div className="lt-nb-pair"><button type="button" onClick={()=>write('/resources?'+query({branch_id:branch}),'POST',draft,'Resource saved.')}>Save</button><button type="button" onClick={()=>setDraft(null)}>Cancel</button></div>
    </fieldset>}
    <section className="lt-nb-section"><h3>Booking calendar & requests</h3><p>Pending requests do not hold space. {data.truncated?'Showing first 500 records; use the date filter cautiously.':'Choose a day or show the whole month.'}</p>
      <label>Calendar month<input type="month" value={month} disabled={busy} onChange={e=>{if(e.target.value){setDay('');load(branch,e.target.value)}}}/></label>
      <div className="lt-nb-calendar">{['M','T','W','T','F','S','S'].map((d,i)=><small key={'w'+i}>{d}</small>)}{Array.from({length:firstDay},(_,i)=><span key={'gap'+i}/>)}{Array.from({length:days},(_,i)=>{const d=month+'-'+String(i+1).padStart(2,'0');return <button type="button" key={d} aria-pressed={day===d} onClick={()=>setDay(day===d?'':d)}>{i+1}{dayCounts[d]?<small>{dayCounts[d]} booking{dayCounts[d]===1?'':'s'}</small>:null}</button>})}</div>
      <div className="lt-nb-pair"><label>Filter date<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label><label>Status<select value={filter} onChange={e=>setFilter(e.target.value)}>{['all','pending','confirmed','declined','cancelled','completed'].map(s=><option key={s}>{s}</option>)}</select></label></div>
      <button type="button" disabled={busy} onClick={()=>load()}>Refresh bookings</button>
      {!rows.length&&<p>No bookings in this view.</p>}
      {rows.map(b=><article className="lt-nb-section" key={b.id}><small>Arrival: {dateText(b.starts_at)}{b.kind==='venue'?' – '+timeText(b.ends_at):''}</small><h3>{b.resource_name} · {b.guests} guests</h3><p>{b.customer_name} · {b.phone}</p>{b.booking_code&&<small>Booking code: {displayReference(b.booking_code)}</small>}{b.note&&<p>{b.note}</p>}<p><b>{b.status}</b>{b.price_centavos?' · '+php(b.price_centavos):''}</p>
        <div className="lt-nb-chips">{(b.status==='pending'?['confirmed','declined']:b.status==='confirmed'?(new Date(b.ends_at)<=new Date()?['completed','cancelled']:['cancelled']):[]).map(s=><button type="button" key={s} disabled={busy} onClick={()=>{if(window.confirm('Change booking to '+s+'?'))write('/'+b.id+'/status','POST',{status:s},'Booking '+s+'.')}}>{s==='confirmed'?'Confirm':s==='declined'?'Decline':s==='completed'?'Complete':'Cancel'}</button>)}</div>
      </article>)}
    </section></>}
  </section>
}

export function NativeBookingCustomer({apiBase='',slug,preferredBranch='',externalActions=[]}) {
  const root=apiBase+'/api/v1/public/bookings/'+encodeURIComponent(slug)
  const [expanded,setExpanded]=useState(false),[noteOpen,setNoteOpen]=useState(false)
  const [catalog,setCatalog]=useState([]),[kind,setKind]=useState(''),[branch,setBranch]=useState(''),[resource,setResource]=useState('')
  const [day,setDay]=useState(''),[guests,setGuests]=useState(2),[slots,setSlots]=useState([]),[slot,setSlot]=useState('')
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [receipt,setReceipt]=useState(null),[lookup,setLookup]=useState(''),[looking,setLooking]=useState(false),[slotLoading,setSlotLoading]=useState(false)
  const retry=useRef(null), posting=useRef(false)
  const [copyNotice,setCopyNotice]=useState('')
  async function copyReference(){const value=displayReference(receipt?.booking_code||receipt?.reference);try{await navigator.clipboard.writeText(value);setCopyNotice('Copied')}catch{setCopyNotice('Select and copy the code manually.')}}
  const [cardToken,setCardToken]=useState(''),[verifiedCard,setVerifiedCard]=useState('')
  const cardIdentity=useRef('')
  const [,setUnusedAddress]=useState('')
  useEffect(()=>{
    const sync=event=>{
      if(event?.type==='lt-menu-card-change'&&event.detail?.business!==slug)return
      if(event?.type==='storage'&&event.key!==null&&event.key!=='lt-menu-card:'+slug)return
      let token='';try{token=readBookingCardToken(window.localStorage,slug)}catch{}
      if(cardIdentity.current!==token){if(cardIdentity.current){setName('');setPhone('')}cardIdentity.current=token;setVerifiedCard('');setCardToken(token)}
    }
    sync();window.addEventListener('lt-menu-card-change',sync);window.addEventListener('storage',sync);window.addEventListener('focus',sync)
    return()=>{window.removeEventListener('lt-menu-card-change',sync);window.removeEventListener('storage',sync);window.removeEventListener('focus',sync)}
  },[slug,expanded])
  useEffect(()=>{
    setVerifiedCard('');if(!kind||!cardToken)return
    const ctrl=new AbortController()
    json(apiBase+'/api/v1/public/menu/'+encodeURIComponent(slug)+'/card',{headers:{Authorization:'Bearer '+cardToken},signal:ctrl.signal}).then(value=>{
      if(ctrl.signal.aborted||cardIdentity.current!==cardToken)return
      setVerifiedCard(cardToken);const saved=bookingCardName(value?.name);if(saved)setName(current=>current.trim()?current:saved)
    }).catch(()=>{})
    return()=>ctrl.abort()
  },[apiBase,slug,kind,cardToken])
  useEffect(()=>{if(!slug)return;const ctrl=new AbortController();setCatalog([]);setExpanded(false);setNoteOpen(false);setKind('');setBranch('');setResource('');setReceipt(null);json(root,{signal:ctrl.signal}).then(x=>{if(!ctrl.signal.aborted)setCatalog(x.branches||[])}).catch(()=>{});return()=>ctrl.abort()},[root])
  const places=catalog.filter(b=>b.resources.some(r=>r.kind===kind))
  const items=places.find(b=>b.public_id===branch)?.resources.filter(r=>r.kind===kind)||[]
  const chosen=items.find(r=>r.id===resource)
  function open(k) {if(kind===k&&!receipt)return;const p=catalog.filter(b=>b.resources.some(r=>r.kind===k));const b=p.find(x=>x.public_id===preferredBranch)||p[0];setKind(k);setBranch(b?.public_id||'');setResource('');setSlot('');setReceipt(null);setError('')}
  useEffect(()=>{setSlots([]);setSlot('');setSlotLoading(false);setError('');if(!kind||!branch||!resource||!day||guests<1)return;const ctrl=new AbortController();setSlotLoading(true);json(root+'/slots?'+query({branch_id:branch,resource_id:resource,day,guests}),{signal:ctrl.signal}).then(x=>{if(!ctrl.signal.aborted)setSlots(x.slots||[])}).catch(e=>{if(!ctrl.signal.aborted)setError(e.message)}).finally(()=>{if(!ctrl.signal.aborted)setSlotLoading(false)});return()=>ctrl.abort()},[root,kind,branch,resource,day,guests])
  async function submit(e) {
    e.preventDefault();if(posting.current||!slot||!chosen)return
    posting.current=true;setBusy(true);setError('')
    const body={resource_id:resource,branch,starts_at:slot,guests,name:name.trim(),phone:phone.trim(),note:note.trim()}
    const signature=JSON.stringify(body)
    try{
      if(retry.current?.signature!==signature) retry.current={signature,id:crypto.randomUUID()}
      const result=await json(root+'/request',{method:'POST',body:JSON.stringify({...body,request_id:retry.current.id})})
      setReceipt({...result,starts_at:body.starts_at});setLookup(displayReference(result.booking_code||result.reference));setCopyNotice('');setName('');setPhone('');setNote('');setNoteOpen(false);setExpanded(false);retry.current=null
    }catch(e){setError(e.message)}finally{posting.current=false;setBusy(false)}
  }
  async function track(){setLooking(true);setError('');try{const x=await json(root+'/status/'+encodeURIComponent(lookup.trim()));setReceipt(current=>({...((current&&(displayReference(current.booking_code||current.reference)===lookup.trim()||current.reference===lookup.trim()))?current:{}),reference:lookup.trim(),status:x.status}))}catch(e){setError(e.message)}finally{setLooking(false)}}
  if(!catalog.length&&!externalActions.length)return null
  return <section className="lt-nb lt-nb-public lt-nb-reservation">
    <button className="lt-nb-entry" type="button" aria-expanded={expanded} disabled={busy} onClick={()=>setExpanded(v=>!v)}>
      <span className="lt-nb-entry-copy"><small>Reservations</small><strong>Reserve our place</strong><span>Book a table or plan a private event.</span></span>
      <span className="lt-nb-chevron" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
    </button>
    {!expanded&&receipt&&<div className="lt-nb-receipt-summary" role="status"><strong>{receipt.status==='pending'?'Reservation requested':receipt.status}</strong><small>Booking code</small><strong className="lt-nb-reference">{displayReference(receipt.booking_code||receipt.reference)}</strong><button type="button" className="lt-nb-copy" onClick={copyReference}>Copy code</button>{copyNotice&&<small role="status">{copyNotice}</small>}<button type="button" onClick={()=>setExpanded(true)}>View booking status</button></div>}
    <div className="lt-nb-expanded" hidden={!expanded}>
    <h3 className="lt-nb-step-title">What would you like to reserve?</h3>
    <div className="lt-nb-pair lt-nb-types">{['table','venue'].map(k=>{
      const native=catalog.some(b=>b.resources.some(r=>r.kind===k))
      const external=externalActions.find(a=>a.id===(k==='venue'?'book':'reserve'))
      return native?<button type="button" key={k} disabled={busy} aria-pressed={kind===k} onClick={()=>open(k)}>{labels[k]}</button>:external?<a key={k} className="lt-nb-external" href={external.url} target="_blank" rel="noreferrer">{labels[k]}</a>:null
    })}</div>
    {externalActions.some(a=>catalog.some(b=>b.resources.some(r=>r.kind===(a.id==='book'?'venue':'table'))))&&<details><summary>Other reservation options</summary>{externalActions.filter(a=>catalog.some(b=>b.resources.some(r=>r.kind===(a.id==='book'?'venue':'table')))).map(a=><a key={a.id} className="lt-nb-external" href={a.url} target="_blank" rel="noreferrer">{a.label}{a.note?' · '+a.note:''}</a>)}</details>}
    {error&&<p role="alert" className="lt-nb-error">{error}</p>}
    {receipt?<div role="status" className="lt-nb-section"><h3>{receipt.status==='pending'?'Request received':receipt.status}</h3>{receipt.starts_at&&<p>Arrival: {dateText(receipt.starts_at)}</p>}<p>{receipt.status==='pending'?'Your booking is not confirmed. The business must approve your request.':'Check the latest status below.'}</p><label>Booking code<input className="lt-nb-reference" readOnly value={displayReference(receipt.booking_code||receipt.reference)} onFocus={e=>e.target.select()}/></label><button type="button" className="lt-nb-copy" onClick={copyReference}>Copy code</button>{copyNotice&&<small role="status">{copyNotice}</small>}<p>Save your reference. No payment was collected.</p></div>:kind&&<form onSubmit={submit}><fieldset disabled={busy}>
      <div className="lt-nb-form-group"><h3 className="lt-nb-step-title">Booking details</h3>
      <label>Branch<select value={branch} onChange={e=>{setBranch(e.target.value);setResource('')}}>{places.map(b=><option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></label>
      <label>{kind==='venue'?'Venue package':'Table'}<select required value={resource} onChange={e=>setResource(e.target.value)}><option value="">Choose</option>{items.map(r=><option key={r.id} value={r.id}>{r.name} · up to {r.capacity} guests{r.price_centavos?' · '+php(r.price_centavos):''}</option>)}</select></label>
      <div className="lt-nb-pair"><label>Date<input required type="date" min={manilaDay()} value={day} onChange={e=>setDay(e.target.value)}/></label><label>Guests<input required type="number" min="1" max={chosen?.capacity||1000} value={guests} onChange={e=>setGuests(Number(e.target.value))}/></label></div>
      {resource&&day&&<><p className="lt-nb-time-label">What time will you arrive?</p>{slotLoading?<p>Checking availability…</p>:<div className="lt-nb-chips lt-nb-times">{slots.map(t=><button type="button" key={t} aria-pressed={slot===t} onClick={()=>setSlot(t)}>{timeText(t)}</button>)}</div>}
      {!slotLoading&&!slots.length&&!error&&<p>No available times. Choose another date or resource.</p>}</>}
      </div>
      <div className="lt-nb-form-group"><h3 className="lt-nb-step-title">Your details</h3>
      {verifiedCard&&verifiedCard===cardToken&&<small>Connected loyalty card · Review your name and contact number before submitting.</small>}
      <label>Name<input required maxLength="100" autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>
      {verifiedCard&&verifiedCard===cardToken?<MenuCheckoutContact key={slug+":"+verifiedCard} apiBase={apiBase} businessId={slug} cardToken={verifiedCard} service="reservation" phone={phone} setPhone={setPhone} address="" setAddress={setUnusedAddress} onName={value=>{const saved=bookingCardName(value);if(saved)setName(current=>current.trim()?current:saved)}}/>:<label>Contact number<input required type="tel" autoComplete="tel" minLength="7" maxLength="30" value={phone} onChange={e=>setPhone(e.target.value)}/></label>}
      </div>
      <button className="lt-nb-note-toggle" type="button" aria-expanded={noteOpen} onClick={()=>setNoteOpen(v=>!v)}>{noteOpen?'− Hide note':note?'＋ Edit note':'＋ Add note (optional)'}</button>
      {noteOpen&&<label>Note (optional)<textarea rows={2} maxLength="500" placeholder="Any special requests?" value={note} onChange={e=>setNote(e.target.value)}/></label>}
      <div className="lt-nb-submit"><small>Your contact details are shared with the business. Requests require confirmation. No deposit is collected here.</small>
      <button disabled={!slot||busy} type="submit">{busy?'Submitting…':'Request reservation'}</button></div>
    </fieldset></form>}
    {catalog.length>0&&<details><summary>Check booking status</summary><label>Booking code<input autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={64} placeholder="7KM4-P9TX-2C8A" value={lookup} onChange={e=>{setLookup(e.target.value);setCopyNotice('')}}/></label><small>Enter your code. Spaces and hyphens are optional.</small><button type="button" disabled={looking||!lookup.trim()} onClick={track}>Check status</button></details>}
    </div>
  </section>
}
