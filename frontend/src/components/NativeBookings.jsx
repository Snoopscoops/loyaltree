import React, { useEffect, useRef, useState } from 'react'
import './native-bookings.css'

const emptyResource = kind => ({kind,name:'',capacity:kind==='table'?4:30,duration_minutes:kind==='table'?90:240,price_centavos:0,active:true})
const php = cents => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(cents/100)
const manilaDay = (value=new Date()) => {const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));const get=k=>parts.find(p=>p.type===k)?.value;return get('year')+'-'+get('month')+'-'+get('day')}
const dateText = value => new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value))
const timeText = value => new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(new Date(value))
const labels = {venue:'Book our place',table:'Reserve a table'}
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
      <div className="lt-nb-pair"><label>Opens<input type="time" value={settings.opens_at.slice(0,5)} onChange={e=>patch({opens_at:e.target.value})}/></label><label>Closes<input type="time" value={settings.closes_at.slice(0,5)} onChange={e=>patch({closes_at:e.target.value})}/></label></div>
      <p>Booking days (Manila time)</p><div className="lt-nb-chips">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i)=><label key={d}><input type="checkbox" checked={settings.weekdays.includes(i+1)} onChange={e=>patch({weekdays:e.target.checked?[...settings.weekdays,i+1]:settings.weekdays.filter(x=>x!==i+1)})}/>{d}</label>)}</div>
      <label>Blocked dates<input type="date" value={blockDay} onChange={e=>setBlockDay(e.target.value)}/></label>
      <button type="button" disabled={!blockDay||settings.blocked_dates.includes(blockDay)} onClick={()=>{patch({blocked_dates:[...settings.blocked_dates,blockDay]});setBlockDay('')}}>Block date</button>
      <div className="lt-nb-chips">{settings.blocked_dates.map(d=><button type="button" key={d} onClick={()=>patch({blocked_dates:settings.blocked_dates.filter(x=>x!==d)})}>{d} ×</button>)}</div>
      {['venue','table'].map(kind=><div className="lt-nb-section" key={kind}>
        <h3>{kind==='venue'?'4 · Book our place':'5 · Reserve a table'}</h3>
        <label className="lt-nb-check"><input type="checkbox" checked={settings[kind+'_enabled']} onChange={e=>patch({[kind+'_enabled']:e.target.checked})}/>Show native booking on customer page</label>
        <p>{kind==='venue'?'Exclusive use of this entire branch; blocks all table bookings.':'Each table has its own seating capacity and duration.'}</p>
        {data.resources.filter(r=>r.kind===kind).map(r=><div className="lt-nb-row" key={r.id}><span><b>{r.name}</b><small>{r.capacity} guests · {r.duration_minutes} min · {r.active?'Active':'Hidden'}{r.price_centavos?' · '+php(r.price_centavos):''}</small></span><button type="button" onClick={()=>setDraft({...r})}>Edit</button></div>)}
        <button type="button" onClick={()=>setDraft(emptyResource(kind))}>+ {kind==='venue'?'Add venue package':'Add table'}</button>
      </div>)}
      <button type="button" onClick={saveSettings}>Save branch settings</button>
    </fieldset>
    {draft&&<fieldset disabled={busy} className="lt-nb-section"><h3>{draft.id?'Edit':'Add'} {draft.kind==='table'?'table':'venue package'}</h3>
      <label>Name<input maxLength="100" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label>
      <div className="lt-nb-pair"><label>Capacity<input type="number" min="1" max="1000" value={draft.capacity} onChange={e=>setDraft({...draft,capacity:Number(e.target.value)})}/></label><label>Duration (minutes)<input type="number" min="30" max="720" step="30" value={draft.duration_minutes} onChange={e=>setDraft({...draft,duration_minutes:Number(e.target.value)})}/></label></div>
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
      {rows.map(b=><article className="lt-nb-section" key={b.id}><small>{dateText(b.starts_at)} – {timeText(b.ends_at)}</small><h3>{b.resource_name} · {b.guests} guests</h3><p>{b.customer_name} · {b.phone}</p>{b.note&&<p>{b.note}</p>}<p><b>{b.status}</b>{b.price_centavos?' · '+php(b.price_centavos):''}</p>
        <div className="lt-nb-chips">{(b.status==='pending'?['confirmed','declined']:b.status==='confirmed'?(new Date(b.ends_at)<=new Date()?['completed','cancelled']:['cancelled']):[]).map(s=><button type="button" key={s} disabled={busy} onClick={()=>{if(window.confirm('Change booking to '+s+'?'))write('/'+b.id+'/status','POST',{status:s},'Booking '+s+'.')}}>{s==='confirmed'?'Confirm':s==='declined'?'Decline':s==='completed'?'Complete':'Cancel'}</button>)}</div>
      </article>)}
    </section></>}
  </section>
}

export function NativeBookingCustomer({apiBase='',slug,preferredBranch=''}) {
  const root=apiBase+'/api/v1/public/bookings/'+encodeURIComponent(slug)
  const [catalog,setCatalog]=useState([]),[kind,setKind]=useState(''),[branch,setBranch]=useState(''),[resource,setResource]=useState('')
  const [day,setDay]=useState(''),[guests,setGuests]=useState(2),[slots,setSlots]=useState([]),[slot,setSlot]=useState('')
  const [name,setName]=useState(''),[phone,setPhone]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [receipt,setReceipt]=useState(null),[lookup,setLookup]=useState(''),[looking,setLooking]=useState(false),[slotLoading,setSlotLoading]=useState(false)
  const retry=useRef(null), posting=useRef(false)
  useEffect(()=>{if(!slug)return;const ctrl=new AbortController();setCatalog([]);setKind('');setBranch('');setResource('');setReceipt(null);json(root,{signal:ctrl.signal}).then(x=>{if(!ctrl.signal.aborted)setCatalog(x.branches||[])}).catch(()=>{});return()=>ctrl.abort()},[root])
  const places=catalog.filter(b=>b.resources.some(r=>r.kind===kind))
  const items=places.find(b=>b.public_id===branch)?.resources.filter(r=>r.kind===kind)||[]
  const chosen=items.find(r=>r.id===resource)
  function open(k) {const p=catalog.filter(b=>b.resources.some(r=>r.kind===k));const b=p.find(x=>x.public_id===preferredBranch)||p[0];setKind(k);setBranch(b?.public_id||'');setResource('');setSlot('');setReceipt(null);setError('')}
  useEffect(()=>{setSlots([]);setSlot('');setSlotLoading(false);setError('');if(!kind||!branch||!resource||!day||guests<1)return;const ctrl=new AbortController();setSlotLoading(true);json(root+'/slots?'+query({branch_id:branch,resource_id:resource,day,guests}),{signal:ctrl.signal}).then(x=>{if(!ctrl.signal.aborted)setSlots(x.slots||[])}).catch(e=>{if(!ctrl.signal.aborted)setError(e.message)}).finally(()=>{if(!ctrl.signal.aborted)setSlotLoading(false)});return()=>ctrl.abort()},[root,kind,branch,resource,day,guests])
  async function submit(e) {
    e.preventDefault();if(posting.current||!slot||!chosen)return
    posting.current=true;setBusy(true);setError('')
    const body={resource_id:resource,branch,starts_at:slot,guests,name:name.trim(),phone:phone.trim(),note:note.trim()}
    const signature=JSON.stringify(body)
    try{
      if(retry.current?.signature!==signature) retry.current={signature,id:crypto.randomUUID()}
      const result=await json(root+'/request',{method:'POST',body:JSON.stringify({...body,request_id:retry.current.id})})
      setReceipt(result);setLookup(result.reference);setName('');setPhone('');setNote('');retry.current=null
    }catch(e){setError(e.message)}finally{posting.current=false;setBusy(false)}
  }
  async function track(){setLooking(true);setError('');try{const x=await json(root+'/status/'+encodeURIComponent(lookup.trim()));setReceipt({reference:lookup.trim(),status:x.status})}catch(e){setError(e.message)}finally{setLooking(false)}}
  if(!catalog.length)return null
  return <section className="lt-nb lt-nb-public"><h2>Make a reservation</h2><p>Your next visit starts here.</p>
    <div className="lt-nb-pair">{['venue','table'].filter(k=>catalog.some(b=>b.resources.some(r=>r.kind===k))).map(k=><button type="button" key={k} disabled={busy} aria-pressed={kind===k} onClick={()=>open(k)}>{labels[k]}</button>)}</div>
    {error&&<p role="alert" className="lt-nb-error">{error}</p>}
    {receipt?<div role="status" className="lt-nb-section"><h3>{receipt.status==='pending'?'Request received':receipt.status}</h3><p>{receipt.status==='pending'?'Your booking is not confirmed. The business must approve your request.':'Check the latest status below.'}</p><label>Booking reference<input readOnly value={receipt.reference}/></label><p>Save your reference. No payment was collected.</p></div>:kind&&<form onSubmit={submit}><fieldset disabled={busy}>
      <label>Branch<select value={branch} onChange={e=>{setBranch(e.target.value);setResource('')}}>{places.map(b=><option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></label>
      <label>{kind==='venue'?'Venue package':'Table'}<select required value={resource} onChange={e=>setResource(e.target.value)}><option value="">Choose</option>{items.map(r=><option key={r.id} value={r.id}>{r.name} · up to {r.capacity} · {r.duration_minutes} min{r.price_centavos?' · '+php(r.price_centavos):''}</option>)}</select></label>
      <div className="lt-nb-pair"><label>Date<input required type="date" min={manilaDay()} value={day} onChange={e=>setDay(e.target.value)}/></label><label>Guests<input required type="number" min="1" max={chosen?.capacity||1000} value={guests} onChange={e=>setGuests(Number(e.target.value))}/></label></div>
      <p>Available times · Asia/Manila</p>{slotLoading?<p>Checking availability…</p>:<div className="lt-nb-chips">{slots.map(t=><button type="button" key={t} aria-pressed={slot===t} onClick={()=>setSlot(t)}>{timeText(t)}</button>)}</div>}
      {resource&&day&&!slotLoading&&!slots.length&&!error&&<p>No available times. Choose another date or resource.</p>}
      <label>Name<input required maxLength="100" autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Contact number<input required type="tel" autoComplete="tel" minLength="7" maxLength="30" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
      <label>Note (optional)<textarea maxLength="500" value={note} onChange={e=>setNote(e.target.value)}/></label>
      <small>Your contact details are shared with the business to arrange this booking. Requests are subject to confirmation; no deposit is collected here.</small>
      <button disabled={!slot||busy} type="submit">{busy?'Submitting…':'Request reservation'}</button>
    </fieldset></form>}
    <details><summary>Check booking status</summary><label>Booking reference<input value={lookup} onChange={e=>setLookup(e.target.value)}/></label><button type="button" disabled={looking||!lookup.trim()} onClick={track}>Check status</button></details>
  </section>
}
