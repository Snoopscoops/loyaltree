import React, { useEffect, useState } from 'react'
import './motolite.css'
import motoliteLogo from '../assets/motolite-logo.webp'

const hotline = '0917-891-6686'

function go(path){ window.history.pushState({},'',path); window.dispatchEvent(new PopStateEvent('popstate')) }
function usePath(){ const [p,setP]=useState(window.location.pathname); useEffect(()=>{const f=()=>setP(window.location.pathname); addEventListener('popstate',f); return()=>removeEventListener('popstate',f)},[]); return p }

const sample = {
  member:'Juan Dela Cruz', memberNo:'MTL-2026-8A7D3F2B', battery:'Motolite Gold DIN66',
  serial:'MG66-829134', vehicle:'Mitsubishi Montero Sport', plate:'ABC 1234',
  installed:'Aug 8, 2026', expires:'Aug 8, 2028', branch:'Cauayan City Branch'
}

function Header(){return <>
  <div className="hotline">Official Hotlines · Globe {hotline} · Smart 0918-843-6686 · NCR (02) 8370-6686</div>
  <header><button className="brand" onClick={()=>go('/motolite')}><img src={motoliteLogo}/></button>
    <nav><a href="#batteries">Batteries</a><a href="#services">Service</a><a href="#advantage">Warranty</a><button onClick={()=>go('/motolite/warranty')}>My Warranty</button></nav>
    <button className="staff" onClick={()=>go('/motolite/login')}>Staff Login</button>
  </header>
</>}

function Home(){return <div><Header/>
  <section className="hero"><div className="heroInner"><div>
    <span className="kicker yellow">THE BATTERY YOU CAN RELY ON</span>
    <h1>Pangmatagalan.<br/>Now digitally protected.</h1>
    <p>One secure digital warranty network for battery registration, QR verification, Apple Wallet, Google Wallet, service history and nationwide Motolite support.</p>
    <div className="heroBtns"><button className="redBtn" onClick={()=>go('/motolite/warranty')}>View My Warranty</button><a href="#batteries" className="whiteBtn">Find a Battery</a></div>
  </div><div className="preview"><img src={motoliteLogo}/><span className="active">ACTIVE</span><h3>{sample.battery}</h3><p>{sample.vehicle}</p><div className="mini"><span>Member</span><b>{sample.member}</b><span>Valid until</span><b>{sample.expires}</b></div><button onClick={()=>go('/motolite/warranty')}>Open Warranty Card</button></div></div></section>

  <section className="quick"><Action icon="⚡" title="Find the Right Battery" text="Match your vehicle with the proper Motolite battery."/><Action icon="✓" title="Activate Warranty" text="Authorized Motolite staff can register the customer, vehicle and battery in one guided flow." click={()=>go('/motolite/login')}/><Action icon="▣" title="Check Warranty" text="See status, battery details and service history." click={()=>go('/motolite/warranty')}/><Action icon="☎" title="Emergency Assistance" text="Fast access to Motolite support." href={`tel:${hotline}`}/></section>

  <section id="batteries" className="section"><span className="kicker">MOTOLITE BATTERIES</span><h2>Built for every kind of drive.</h2><div className="cats">{['Automotive','Motorcycle','Heavy Commercial','Marine & Leisure','Industrial'].map(x=><div className="cat" key={x}><div className="battery"><i/></div><h3>{x}</h3><p>Reliable Motolite power for your application.</p><b>View more →</b></div>)}</div></section>

  <section id="services" className="section dark"><span className="kicker yellow">MOTOLITE SERVICES</span><h2>More than a battery.</h2><div className="services"><Service title="RES-Q" text="On-demand roadside assistance for motorists."/><Service title="Express Hatid" text="Battery delivery and installation support."/><Service title="Digital Warranty" text="Your warranty, battery details and service record in one place."/></div></section>

  <section id="advantage" className="section"><div className="center"><span className="kicker">THE DIGITAL MOTOLITE ADVANTAGE</span><h2>Your warranty follows you wherever you go.</h2><p>One national warranty record with localized branch access and a permanent digital member card.</p></div><div className="benefits"><Benefit icon="QR" title="Secure QR Warranty"/><Benefit icon="" title="Apple Wallet"/><Benefit icon="G" title="Google Wallet"/><Benefit icon="24/7" title="Emergency Call"/><Benefit icon="◎" title="Nearest Branch"/><Benefit icon="↻" title="Replacement Reminders"/></div></section>

  <section className="cta"><div><span className="kicker yellow">ONE NATIONAL WARRANTY NETWORK</span><h2>Purchased in one city. Serviced in another.</h2><p>National, regional and local dashboards share one warranty source of truth while access remains permission-based.</p></div><button onClick={()=>go('/motolite/login')}>Open Staff Portal</button></section>
  <footer><img src={motoliteLogo}/><p>Motolite Digital Warranty Network · Secure battery records, service history and wallet access.</p></footer>
</div>}

function Action({icon,title,text,click,href}){const c=<><span className="round">{icon}</span><div><h3>{title}</h3><p>{text}</p></div><b>→</b></>; return href?<a className="action" href={href}>{c}</a>:<button className="action" onClick={click}>{c}</button>}
function Service({title,text}){return <div className="service"><span>M</span><h3>{title}</h3><p>{text}</p><b>Learn more →</b></div>}
function Benefit({icon,title}){return <div className="benefit"><span>{icon}</span><h3>{title}</h3><p>Part of the all-in-one Motolite warranty and membership experience.</p></div>}

function Warranty(){return <div className="portal"><Header/><main className="section"><span className="kicker">MY MOTOLITE</span><h1 className="pageTitle">Digital Warranty</h1><div className="warrantyGrid"><div className="walletCard"><img src={motoliteLogo}/><small>DIGITAL WARRANTY MEMBER</small><h2>{sample.member}</h2><p>{sample.memberNo}</p><h3>{sample.battery}</h3><strong>● WARRANTY ACTIVE</strong><div className="qr">{Array.from({length:64}).map((_,i)=><i key={i} className={(i*7+i%5)%3?'on':''}/>)}</div><em>Scan at an authorized Motolite branch</em></div><div><div className="info"><div className="infoHead"><h3>Battery Details</h3><span>ACTIVE</span></div>{[['Battery',sample.battery],['Serial Number',sample.serial],['Vehicle',sample.vehicle],['Plate Number',sample.plate],['Installed',sample.installed],['Warranty Until',sample.expires],['Original Branch',sample.branch]].map(([a,b])=><div className="row" key={a}><span>{a}</span><b>{b}</b></div>)}</div><div className="walletBtns"><button> Add to Apple Wallet</button><button>G Add to Google Wallet</button></div><div className="tiles"><a href={`tel:${hotline}`}>☎<b>Emergency Assistance</b><span>{hotline}</span></a><button>◎<b>Find Nearest Branch</b><span>Use current location</span></button><button>▣<b>Service History</b><span>View warranty activity</span></button></div></div></div></main></div>}


function RegisterWarranty({API_BASE,session}){
  const branchId = session?.staff?.branch_public_id || ''
  const [step,setStep]=useState(1)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [result,setResult]=useState(null)
  const [form,setForm]=useState({
    name:'',phone:'',email:'',address:'',city:'Cauayan City',province:'Isabela',
    make:'',model:'',year:'',plate_number:'',color:'',
    product_name:'Motolite Gold DIN66',model_code:'DIN66',serial_number:'',
    purchase_date:new Date().toISOString().slice(0,10),
    installation_date:new Date().toISOString().slice(0,10),
    warranty_months:'24',purchase_price:'',receipt_number:'',notes:''
  })

  const set=(k,v)=>setForm(f=>({...f,[k]:v}))
  const headers={
    'Content-Type':'application/json',
    'Authorization':`Bearer ${session?.token||''}`
  }

  async function submit(){
    setBusy(true); setError('')
    try{
      const memberRes=await fetch(`${API_BASE}/api/v1/motolite/members`,{
        method:'POST',headers,
        body:JSON.stringify({
          name:form.name,phone:form.phone,email:form.email||null,
          address:form.address||null,city:form.city||null,province:form.province||null,
          preferred_branch_public_id:branchId
        })
      })
      const member=await memberRes.json()
      if(!memberRes.ok) throw new Error(member.detail||'Could not create member')

      const vehicleRes=await fetch(`${API_BASE}/api/v1/motolite/vehicles`,{
        method:'POST',headers,
        body:JSON.stringify({
          member_public_id:member.public_id,make:form.make,model:form.model,
          year:form.year?Number(form.year):null,
          plate_number:form.plate_number||null,color:form.color||null
        })
      })
      const vehicle=await vehicleRes.json()
      if(!vehicleRes.ok) throw new Error(vehicle.detail||'Could not create vehicle')

      const batteryRes=await fetch(`${API_BASE}/api/v1/motolite/batteries`,{
        method:'POST',headers,
        body:JSON.stringify({
          member_public_id:member.public_id,
          vehicle_public_id:vehicle.public_id,
          original_branch_public_id:branchId,
          product_name:form.product_name,model_code:form.model_code||null,
          serial_number:form.serial_number,purchase_date:form.purchase_date,
          installation_date:form.installation_date||form.purchase_date,
          warranty_months:Number(form.warranty_months||24),
          purchase_price:form.purchase_price?Number(form.purchase_price):null,
          receipt_number:form.receipt_number||null,notes:form.notes||null
        })
      })
      const battery=await batteryRes.json()
      if(!batteryRes.ok) throw new Error(battery.detail||'Could not register battery')

      setResult({member,vehicle,...battery})
      setStep(4)
    }catch(e){setError(e.message||String(e))}
    finally{setBusy(false)}
  }

  if(step===4 && result){
    const w=result.warranty
    return <div className="portal"><Header/><main className="section registerPage">
      <div className="registerSuccess">
        <span className="successCheck">✓</span>
        <span className="kicker">WARRANTY ACTIVATED</span>
        <h1>{result.member.name}</h1>
        <p className="memberNo">{result.member.member_number}</p>
        <div className="successDetails">
          <div><span>Battery</span><b>{result.battery.product_name}</b></div>
          <div><span>Serial Number</span><b>{result.battery.serial_number}</b></div>
          <div><span>Vehicle</span><b>{result.vehicle.make} {result.vehicle.model}</b></div>
          <div><span>Warranty Until</span><b>{w.expires_at}</b></div>
        </div>
        <div className="customerQrBox">
          <span className="qrLabel">CUSTOMER WALLET QR</span>
          <img
            src={result.wallet.qr_svg_url}
            alt="Scan to add Motolite warranty to Apple Wallet or Google Wallet"
            className="customerWalletQr"
          />
          <strong>Scan with the customer's phone</strong>
          <p>The QR opens a secure Motolite page where the customer can choose Apple Wallet or Google Wallet.</p>
        </div>
        <div className="walletBtns successWallets">
          <a className="walletApple" href={result.wallet.apple_url}> Add to Apple Wallet</a>
          <a className="walletGoogle" href={result.wallet.google_url} target="_blank" rel="noreferrer">G Add to Google Wallet</a>
        </div>
        <a className="verifyLink" href={result.qr_verification_url} target="_blank" rel="noreferrer">Open verified warranty record →</a>
        <button className="redBtn" onClick={()=>{setResult(null);setStep(1);setForm(f=>({...f,name:'',phone:'',email:'',address:'',make:'',model:'',year:'',plate_number:'',color:'',serial_number:'',purchase_price:'',receipt_number:'',notes:''}))}}>Register Another Customer</button>
      </div>
    </main></div>
  }

  return <div className="portal"><Header/><main className="section registerPage">
    <span className="kicker">{session?.staff?.role==='local'?'LOCAL BRANCH':session?.staff?.role==='regional'?'REGIONAL OFFICE':'NATIONAL OFFICE'}</span>
    <h1 className="pageTitle">Register Digital Warranty</h1>
    <p className="registerLead">Register the customer, vehicle and Motolite battery. The warranty is created automatically and can be added to Apple Wallet or Google Wallet.</p>

    <div className="stepper">
      {['Customer','Vehicle','Battery'].map((x,i)=><div key={x} className={step===i+1?'step activeStep':step>i+1?'step doneStep':'step'}><b>{step>i+1?'✓':i+1}</b><span>{x}</span></div>)}
    </div>

    {error&&<div className="formError">{error}</div>}

    <div className="registerBox">
      {step===1&&<>
        <h2>Customer Details</h2>
        <div className="formGrid">
          <Field label="Full Name" value={form.name} setValue={v=>set('name',v)} required/>
          <Field label="Mobile Number" value={form.phone} setValue={v=>set('phone',v)} required/>
          <Field label="Email" value={form.email} setValue={v=>set('email',v)}/>
          <Field label="Address" value={form.address} setValue={v=>set('address',v)}/>
          <Field label="City" value={form.city} setValue={v=>set('city',v)}/>
          <Field label="Province" value={form.province} setValue={v=>set('province',v)}/>
        </div>
        <div className="formActions"><span/><button className="redBtn" disabled={!form.name||!form.phone} onClick={()=>setStep(2)}>Continue →</button></div>
      </>}

      {step===2&&<>
        <h2>Vehicle Details</h2>
        <div className="formGrid">
          <Field label="Make" value={form.make} setValue={v=>set('make',v)} required/>
          <Field label="Model" value={form.model} setValue={v=>set('model',v)} required/>
          <Field label="Year" value={form.year} setValue={v=>set('year',v)} type="number"/>
          <Field label="Plate Number" value={form.plate_number} setValue={v=>set('plate_number',v)}/>
          <Field label="Color" value={form.color} setValue={v=>set('color',v)}/>
        </div>
        <div className="formActions"><button className="ghostBtn" onClick={()=>setStep(1)}>← Back</button><button className="redBtn" disabled={!form.make||!form.model} onClick={()=>setStep(3)}>Continue →</button></div>
      </>}

      {step===3&&<>
        <h2>Battery & Warranty</h2>
        <div className="formGrid">
          <Field label="Battery Product" value={form.product_name} setValue={v=>set('product_name',v)} required/>
          <Field label="Model Code" value={form.model_code} setValue={v=>set('model_code',v)}/>
          <Field label="Serial Number" value={form.serial_number} setValue={v=>set('serial_number',v)} required/>
          <Field label="Purchase Date" value={form.purchase_date} setValue={v=>set('purchase_date',v)} type="date" required/>
          <Field label="Installation Date" value={form.installation_date} setValue={v=>set('installation_date',v)} type="date"/>
          <Field label="Warranty Months" value={form.warranty_months} setValue={v=>set('warranty_months',v)} type="number" required/>
          <Field label="Purchase Price" value={form.purchase_price} setValue={v=>set('purchase_price',v)} type="number"/>
          <Field label="Receipt Number" value={form.receipt_number} setValue={v=>set('receipt_number',v)}/>
        </div>
        <label className="field fullField"><span>Notes</span><textarea value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Optional warranty or installation notes"/></label>
        <div className="formActions"><button className="ghostBtn" onClick={()=>setStep(2)}>← Back</button><button className="redBtn" disabled={busy||!form.serial_number||!form.product_name} onClick={submit}>{busy?'Registering...':'Register Battery & Warranty'}</button></div>
      </>}
    </div>
  </main></div>
}

function Field({label,value,setValue,type='text',required=false}){
  return <label className="field"><span>{label}{required?' *':''}</span><input type={type} value={value} onChange={e=>setValue(e.target.value)}/></label>
}

function Login({API_BASE,onLogin}){
  const [username,setUsername]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function login(){
    setBusy(true);setError('')
    try{
      const r=await fetch(`${API_BASE}/api/v1/motolite/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})})
      const data=await r.json()
      if(!r.ok)throw new Error(data.detail||'Login failed')
      onLogin(data)
      go(`/motolite/${data.staff.role}`)
    }catch(e){setError(e.message||String(e))}finally{setBusy(false)}
  }
  return <div className="login"><div className="loginBrand"><img src={motoliteLogo}/><h1>Digital Warranty Operations</h1><p>Secure National · Regional · Local access</p></div><div className="loginBox"><span className="kicker">AUTHORIZED ACCESS</span><h2>Welcome back</h2><p>Sign in with your Motolite staff account. Your assigned role and service area are applied automatically.</p>{error&&<div className="formError">{error}</div>}<label>Username</label><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="cauayan.admin"/><label>Password</label><input value={password} onChange={e=>setPassword(e.target.value)} type="password" placeholder="••••••••" onKeyDown={e=>e.key==='Enter'&&login()}/><button className="redBtn full" disabled={busy||!username||!password} onClick={login}>{busy?'Signing in...':'Login'}</button><button className="back" onClick={()=>go('/motolite')}>← Back to website</button></div></div>
}

function StaffManagement({API_BASE,session}){
  const [staff,setStaff]=useState([]),[regions,setRegions]=useState([]),[branches,setBranches]=useState([]),[error,setError]=useState(''),[show,setShow]=useState(false)
  const [f,setF]=useState({full_name:'',username:'',password:'',email:'',role:session.staff.role==='regional'?'local':'regional',region_public_id:session.staff.region_public_id||'',branch_public_id:''})
  const auth={'Authorization':`Bearer ${session.token}`,'Content-Type':'application/json'}
  async function load(){try{const [a,r,b]=await Promise.all([fetch(`${API_BASE}/api/v1/motolite/staff`,{headers:auth}),fetch(`${API_BASE}/api/v1/motolite/regions`),fetch(`${API_BASE}/api/v1/motolite/branches`)]);const ad=await a.json();if(!a.ok)throw new Error(ad.detail||'Could not load staff');setStaff(ad);setRegions(await r.json());setBranches(await b.json())}catch(e){setError(e.message)}}
  React.useEffect(()=>{load()},[])
  const set=(k,v)=>setF(x=>({...x,[k]:v}))
  async function create(){setError('');const body={...f,region_public_id:f.role==='national'?null:(f.region_public_id||null),branch_public_id:f.role==='local'?(f.branch_public_id||null):null};const r=await fetch(`${API_BASE}/api/v1/motolite/staff`,{method:'POST',headers:auth,body:JSON.stringify(body)});const d=await r.json();if(!r.ok){setError(d.detail||'Could not create account');return}setShow(false);setF(x=>({...x,full_name:'',username:'',password:'',email:'',branch_public_id:''}));load()}
  async function toggle(x){await fetch(`${API_BASE}/api/v1/motolite/staff/${x.public_id}/status`,{method:'PATCH',headers:auth,body:JSON.stringify({is_active:!x.is_active})});load()}
  const allowedBranches=branches.filter(b=>!f.region_public_id||b.region_public_id===f.region_public_id)
  return <section className="staffPanel"><div className="staffHead"><div><h2>Staff Accounts</h2><p>{session.staff.role==='national'?'Create National, Regional and Local accounts.':'Create and manage Local accounts in your region.'}</p></div><button className="redBtn" onClick={()=>setShow(!show)}>+ Create Account</button></div>{error&&<div className="formError">{error}</div>}{show&&<div className="staffCreate"><div className="formGrid"><Field label="Full Name" value={f.full_name} setValue={v=>set('full_name',v)} required/><Field label="Username" value={f.username} setValue={v=>set('username',v)} required/><Field label="Temporary Password" value={f.password} setValue={v=>set('password',v)} required/><Field label="Email" value={f.email} setValue={v=>set('email',v)}/><label className="field"><span>Role *</span><select value={f.role} onChange={e=>set('role',e.target.value)}>{session.staff.role==='national'&&<option value="national">National</option>}{session.staff.role==='national'&&<option value="regional">Regional</option>}<option value="local">Local</option></select></label>{f.role!=='national'&&<label className="field"><span>Region *</span><select value={f.region_public_id} onChange={e=>set('region_public_id',e.target.value)} disabled={session.staff.role==='regional'}><option value="">Select region</option>{regions.map(r=><option key={r.public_id} value={r.public_id}>{r.name}</option>)}</select></label>}{f.role==='local'&&<label className="field"><span>Branch *</span><select value={f.branch_public_id} onChange={e=>set('branch_public_id',e.target.value)}><option value="">Select branch</option>{allowedBranches.map(b=><option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></label>}</div><div className="formActions"><span/><button className="redBtn" onClick={create}>Create Staff Account</button></div></div>}<div className="staffTable"><div className="staffRow staffHeader"><b>Name</b><b>Username</b><b>Role</b><b>Status</b><b>Action</b></div>{staff.map(x=><div className="staffRow" key={x.public_id}><span>{x.full_name||'—'}</span><span>{x.username}</span><span className="rolePill">{x.role}</span><span>{x.is_active?'Active':'Disabled'}</span><button onClick={()=>toggle(x)}>{x.is_active?'Disable':'Enable'}</button></div>)}</div></section>
}


function CardManagement({API_BASE,session}){
  const auth={'Authorization':`Bearer ${session.token}`,'Content-Type':'application/json'}
  const [card,setCard]=useState({
    logo_url:'',
    background_color:'#d71920',
    foreground_color:'#ffffff',
    label_color:'#ffd400',
    card_title:'Motolite Digital Warranty',
    card_subtitle:'Digital Battery Warranty',
    warranty_label:'Warranty',
    expiry_label:'Warranty Valid Until',
    show_member_name:true,
    show_battery:true,
    show_serial:true,
    show_vehicle:true,
    show_plate:true,
    show_branch:true,
    show_replacement:true,
  })
  const [emergency,setEmergency]=useState({
    phone_number:'',
    button_label:'Call Emergency Help',
    help_text:'Need emergency battery help? Call Motolite assistance directly from your phone.'
  })
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')

  useEffect(()=>{
    let active=true
    async function load(){
      try{
        const [cr,er]=await Promise.all([
          fetch(`${API_BASE}/api/v1/motolite/settings/card`,{headers:auth}),
          fetch(`${API_BASE}/api/v1/motolite/settings/emergency-help`,{headers:auth})
        ])
        const c=await cr.json(),e=await er.json()
        if(!cr.ok)throw new Error(c.detail||'Could not load card settings')
        if(!er.ok)throw new Error(e.detail||'Could not load emergency settings')
        if(active){setCard(x=>({...x,...c}));setEmergency(x=>({...x,...e}))}
      }catch(err){if(active)setError(err.message)}
      finally{if(active)setLoading(false)}
    }
    load()
    return()=>{active=false}
  },[API_BASE,session.token])

  const setC=(k,v)=>setCard(x=>({...x,[k]:v}))
  const setE=(k,v)=>setEmergency(x=>({...x,[k]:v}))

  async function save(){
    setSaving(true);setError('');setMessage('')
    try{
      const [cr,er]=await Promise.all([
        fetch(`${API_BASE}/api/v1/motolite/settings/card`,{
          method:'PUT',headers:auth,
          body:JSON.stringify({
            logo_url:card.logo_url||'',
            background_color:card.background_color,
            foreground_color:card.foreground_color,
            label_color:card.label_color,
            card_title:card.card_title,
            card_subtitle:card.card_subtitle,
            warranty_label:card.warranty_label,
            expiry_label:card.expiry_label,
            show_member_name:!!card.show_member_name,
            show_battery:!!card.show_battery,
            show_serial:!!card.show_serial,
            show_vehicle:!!card.show_vehicle,
            show_plate:!!card.show_plate,
            show_branch:!!card.show_branch,
            show_replacement:!!card.show_replacement,
          })
        }),
        fetch(`${API_BASE}/api/v1/motolite/settings/emergency-help`,{
          method:'PUT',headers:auth,
          body:JSON.stringify({
            phone_number:emergency.phone_number,
            button_label:emergency.button_label,
            help_text:emergency.help_text,
          })
        })
      ])
      const c=await cr.json(),e=await er.json()
      if(!cr.ok)throw new Error(c.detail||'Could not save card settings')
      if(!er.ok)throw new Error(e.detail||'Could not save emergency settings')
      setMessage('Card settings saved. New and refreshed Wallet cards will use these settings.')
    }catch(err){setError(err.message)}
    finally{setSaving(false)}
  }

  if(loading)return <section className="cardManagementPanel"><div className="recordState">Loading card settings…</div></section>

  const visible=[
    ['show_member_name','Member name'],
    ['show_battery','Battery'],
    ['show_serial','Serial number'],
    ['show_vehicle','Vehicle'],
    ['show_plate','Plate number'],
    ['show_branch','Installation branch'],
    ['show_replacement','Recommended replacement'],
  ]

  return <div className="cardManagement">
    <section className="cardManagementPanel">
      <div className="cardManagementHead">
        <div><span className="kicker">NATIONAL ONLY</span><h2>Wallet Card Management</h2><p>Control the Motolite card branding and customer-facing details for Apple Wallet and Google Wallet nationwide.</p></div>
        <button className="redBtn" disabled={saving} onClick={save}>{saving?'Saving…':'Save & Publish'}</button>
      </div>

      {error&&<div className="formError">{error}</div>}
      {message&&<div className="notifySuccess">{message}</div>}

      <div className="cardEditorGrid">
        <div className="cardEditorForm">
          <div className="settingsGroup">
            <h3>Branding</h3>
            <label className="field"><span>Logo URL</span><input value={card.logo_url||''} onChange={e=>setC('logo_url',e.target.value)} placeholder="https://.../motolite-logo.png"/></label>
            <small className="settingHint">Leave blank to use the built-in Motolite logo. Custom logos must use a public HTTPS image URL.</small>
            <div className="colorGrid">
              <label className="field"><span>Card Color</span><div className="colorInput"><input type="color" value={card.background_color} onChange={e=>setC('background_color',e.target.value)}/><input value={card.background_color} onChange={e=>setC('background_color',e.target.value)}/></div></label>
              <label className="field"><span>Text Color</span><div className="colorInput"><input type="color" value={card.foreground_color} onChange={e=>setC('foreground_color',e.target.value)}/><input value={card.foreground_color} onChange={e=>setC('foreground_color',e.target.value)}/></div></label>
              <label className="field"><span>Label Color</span><div className="colorInput"><input type="color" value={card.label_color} onChange={e=>setC('label_color',e.target.value)}/><input value={card.label_color} onChange={e=>setC('label_color',e.target.value)}/></div></label>
            </div>
          </div>

          <div className="settingsGroup">
            <h3>Card Text</h3>
            <div className="formGrid">
              <label className="field"><span>Card Title</span><input value={card.card_title} onChange={e=>setC('card_title',e.target.value)}/></label>
              <label className="field"><span>Card Subtitle</span><input value={card.card_subtitle} onChange={e=>setC('card_subtitle',e.target.value)}/></label>
              <label className="field"><span>Warranty Label</span><input value={card.warranty_label} onChange={e=>setC('warranty_label',e.target.value)}/></label>
              <label className="field"><span>Expiry Label</span><input value={card.expiry_label} onChange={e=>setC('expiry_label',e.target.value)}/></label>
            </div>
          </div>

          <div className="settingsGroup">
            <h3>Visible Card Details</h3>
            <div className="toggleGrid">
              {visible.map(([key,label])=><label className="settingToggle" key={key}><input type="checkbox" checked={!!card[key]} onChange={e=>setC(key,e.target.checked)}/><span><b>{label}</b><small>{card[key]?'Shown on card':'Hidden from card'}</small></span></label>)}
            </div>
          </div>

          <div className="settingsGroup emergencySettings">
            <h3>Emergency Help</h3>
            <div className="formGrid">
              <label className="field"><span>Emergency Number</span><input value={emergency.phone_number||''} onChange={e=>setE('phone_number',e.target.value)} placeholder="0917 891 6686"/></label>
              <label className="field"><span>Button Label</span><input value={emergency.button_label} onChange={e=>setE('button_label',e.target.value)}/></label>
            </div>
            <label className="field fullField"><span>Help Text</span><textarea value={emergency.help_text} onChange={e=>setE('help_text',e.target.value)}/></label>
            <small className="settingHint">This number is used by Google Wallet, Apple Wallet details, the verified warranty page and the Warranty & Activity page.</small>
          </div>
        </div>

        <aside className="cardPreviewWrap">
          <span className="kicker">LIVE PREVIEW</span>
          <div className="managedCardPreview" style={{background:card.background_color,color:card.foreground_color}}>
            <div className="managedLogo">
              <img src={card.logo_url||motoliteLogo} onError={e=>{e.currentTarget.src=motoliteLogo}}/>
            </div>
            <small style={{color:card.label_color}}>{card.card_subtitle}</small>
            <h3>{card.card_title}</h3>
            <div className="previewStatus"><span style={{color:card.label_color}}>{card.warranty_label}</span><b>ACTIVE</b></div>
            <div className="previewExpiry"><span style={{color:card.label_color}}>{card.expiry_label}</span><b>AUG 8, 2028</b></div>
            <div className="previewDetails">
              {card.show_member_name&&<div><span>MEMBER</span><b>Juan Dela Cruz</b></div>}
              {card.show_battery&&<div><span>BATTERY</span><b>Motolite Gold DIN66</b></div>}
              {card.show_serial&&<div><span>SERIAL</span><b>MG66-829134</b></div>}
              {card.show_vehicle&&<div><span>VEHICLE</span><b>Montero Sport</b></div>}
              {card.show_plate&&<div><span>PLATE</span><b>ABC 1234</b></div>}
              {card.show_branch&&<div><span>BRANCH</span><b>Cauayan City</b></div>}
              {card.show_replacement&&<div><span>REPLACEMENT</span><b>AUG 8, 2028</b></div>}
            </div>
            <div className="previewQr">QR</div>
            {emergency.phone_number&&<div className="previewEmergency">☎ {emergency.button_label}<small>{emergency.phone_number}</small></div>}
          </div>
          <p className="previewDisclaimer">Apple and Google control their native Wallet layouts, so the exact spacing can differ. The preview reflects the branding, labels and data visibility National controls.</p>
        </aside>
      </div>
    </section>
  </div>
}


const dash={national:['National Dashboard','Philippines',['1,284,493','982,403','8,241','4,382']],regional:['Regional Dashboard','Region II',['82,103','64,280','42','531']],local:['Local Dashboard','Cauayan City Branch',['2,842','2,191','184','12']]}
function Dashboard({level,API_BASE,session,onLogout}){
  const [view,setView]=useState('overview')
  const [data,setData]=useState(null)
  const [rows,setRows]=useState([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [search,setSearch]=useState('')
  const [page,setPage]=useState(1)
  const [total,setTotal]=useState(0)
  const [expiryBucket,setExpiryBucket]=useState('')
  const [expirySummary,setExpirySummary]=useState({})
  const [memberDetail,setMemberDetail]=useState(null)
  const [detailLoading,setDetailLoading]=useState(false)
  const [showQr,setShowQr]=useState(null)
  const [notifyTarget,setNotifyTarget]=useState(null)
  const [notifyTitle,setNotifyTitle]=useState('')
  const [notifyMessage,setNotifyMessage]=useState('')
  const [notifyBusy,setNotifyBusy]=useState(false)
  const [notifyResult,setNotifyResult]=useState('')
  const [campaigns,setCampaigns]=useState([])
  const pageSize=50
  const auth={'Authorization':`Bearer ${session.token}`}

  useEffect(()=>{
    fetch(`${API_BASE}/api/v1/motolite/dashboard`,{headers:auth})
      .then(r=>r.json()).then(setData).catch(()=>{})
    fetch(`${API_BASE}/api/v1/motolite/warranty-expiry-summary`,{headers:auth})
      .then(r=>r.json()).then(setExpirySummary).catch(()=>{})
  },[API_BASE,session.token])

  useEffect(()=>{
    setPage(1)
    setSearch('')
    setExpiryBucket('')
    setError('')
  },[view])

  useEffect(()=>{
    if(!['members','warranties','batteries','claims','notifications'].includes(view))return
    const t=setTimeout(()=>loadRecords(),300)
    return()=>clearTimeout(t)
  },[view,page,search,expiryBucket,API_BASE,session.token])

  async function loadRecords(){
    setLoading(true);setError('')
    try{
      if(view==='members'){
        const p=new URLSearchParams({page:String(page),page_size:String(pageSize)})
        if(search.trim())p.set('q',search.trim())
        const r=await fetch(`${API_BASE}/api/v1/motolite/members?${p}`,{headers:auth})
        const b=await r.json();if(!r.ok)throw new Error(b.detail||'Could not load members')
        setRows(b.items||[]);setTotal(b.total||0)
      }else if(view==='warranties'){
        const p=new URLSearchParams({page:String(page),page_size:String(pageSize)})
        if(search.trim())p.set('q',search.trim())
        if(expiryBucket)p.set('expiry_bucket',expiryBucket)
        const r=await fetch(`${API_BASE}/api/v1/motolite/warranties?${p}`,{headers:auth})
        const b=await r.json();if(!r.ok)throw new Error(b.detail||'Could not load warranties')
        setRows(b.items||[]);setTotal(b.total||0)
      }else if(view==='notifications'){
        const r=await fetch(`${API_BASE}/api/v1/motolite/notification-campaigns?page=1&page_size=25`,{headers:auth})
        const b=await r.json();if(!r.ok)throw new Error(b.detail||'Could not load notification history')
        setCampaigns(b.items||[]);setRows([]);setTotal(b.total||0)
        const ex=await fetch(`${API_BASE}/api/v1/motolite/warranty-expiry-summary`,{headers:auth})
        if(ex.ok)setExpirySummary(await ex.json())
      }else{
        const endpoint={batteries:'batteries',claims:'warranty-actions'}[view]
        const r=await fetch(`${API_BASE}/api/v1/motolite/${endpoint}`,{headers:auth})
        const b=await r.json();if(!r.ok)throw new Error(b.detail||'Could not load records')
        setRows(Array.isArray(b)?b:[]);setTotal(Array.isArray(b)?b.length:0)
      }
    }catch(e){setRows([]);setError(e.message)}
    finally{setLoading(false)}
  }

  const title=level==='national'?'National Dashboard':level==='regional'?'Regional Dashboard':'Local Dashboard'
  const scopeName=level==='national'?'Nationwide':level==='regional'?'Assigned Region':data?.city||'Assigned City'
  const stats=data?[
    ["Members",data.members],
    ["Active Warranties",data.active_warranties],
    [level==='national'||level==='regional'?"Branches":"Warranties",level==='local'?data.warranties:data.branches],
    ["Claims",data.claims]
  ]:[["Members","—"],["Active Warranties","—"],["Warranties","—"],["Claims","—"]]

  const expiryCards=[
    ['3m','3 Months',expirySummary.three_months||0,'61–90 days'],
    ['2m','2 Months',expirySummary.two_months||0,'31–60 days'],
    ['1m','1 Month',expirySummary.one_month||0,'8–30 days'],
    ['1w','1 Week',expirySummary.one_week||0,'0–7 days']
  ]

  async function openMemberDetail(memberId){
    setDetailLoading(true);setError('')
    try{
      const r=await fetch(`${API_BASE}/api/v1/motolite/members/${memberId}`,{headers:auth})
      const body=await r.json();if(!r.ok)throw new Error(body.detail||'Could not load member')
      setMemberDetail(body)
    }catch(e){setError(e.message)}
    finally{setDetailLoading(false)}
  }

  async function openMemberQr(memberId){
    setDetailLoading(true);setError('')
    try{
      const r=await fetch(`${API_BASE}/api/v1/motolite/members/${memberId}`,{headers:auth})
      const body=await r.json();if(!r.ok)throw new Error(body.detail||'Could not load member wallet')
      if(!body.wallet?.qr_svg_url)throw new Error('This member does not have a wallet-ready warranty yet.')
      setShowQr({member:body.member,wallet:body.wallet})
    }catch(e){setError(e.message)}
    finally{setDetailLoading(false)}
  }

  function beginNotify(member=null){
    setNotifyTarget(member)
    setNotifyTitle('')
    setNotifyMessage('')
    setNotifyResult('')
  }

  async function sendNotification(){
    if(!notifyTitle.trim()||!notifyMessage.trim())return
    setNotifyBusy(true);setNotifyResult('')
    try{
      const r=await fetch(`${API_BASE}/api/v1/motolite/notifications/push`,{
        method:'POST',
        headers:{...auth,'Content-Type':'application/json'},
        body:JSON.stringify({
          title:notifyTitle.trim(),
          message:notifyMessage.trim(),
          member_public_id:notifyTarget?.public_id||null
        })
      })
      const b=await r.json()
      if(!r.ok)throw new Error(b.detail||'Could not queue notification')
      setNotifyResult(`Queued successfully · ${b.campaign_public_id}`)
      setTimeout(()=>{setNotifyTarget(null);setNotifyResult('');if(view==='notifications')loadRecords()},1100)
    }catch(e){setNotifyResult(e.message)}
    finally{setNotifyBusy(false)}
  }

  function openExpiry(bucket){
    setView('warranties')
    setExpiryBucket(bucket)
    setSearch('')
    setPage(1)
  }

  function SearchTools(){
    if(!['members','warranties'].includes(view))return null
    return <div className="recordsToolbar">
      <div className="searchBox">
        <span>⌕</span>
        <input
          value={search}
          onChange={e=>{setSearch(e.target.value);setPage(1)}}
          placeholder={view==='members'
            ?'Search name, member no., phone or email…'
            :'Search member, warranty, serial, battery or plate…'}
        />
        {search&&<button onClick={()=>setSearch('')}>×</button>}
      </div>
      <div className="recordCount">{total.toLocaleString()} record{total===1?'':'s'}</div>
    </div>
  }

  function ExpiryStrip(){
    return <div className="expiryStrip">
      {expiryCards.map(([key,label,count,range])=><button
        key={key}
        className={expiryBucket===key?'expiryCard activeExpiry':'expiryCard'}
        onClick={()=>openExpiry(key)}
      >
        <span>{label}</span><b>{Number(count).toLocaleString()}</b><small>{range} remaining</small>
      </button>)}
    </div>
  }

  function Pagination(){
    if(!['members','warranties'].includes(view)||total<=pageSize)return null
    const pages=Math.max(1,Math.ceil(total/pageSize))
    return <div className="pagination">
      <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>← Previous</button>
      <span>Page <b>{page}</b> of {pages}</span>
      <button disabled={page>=pages} onClick={()=>setPage(p=>Math.min(pages,p+1))}>Next →</button>
    </div>
  }

  function RecordTable(){
    if(view==='notifications')return <div className="notificationCenter">
      <div className="notificationHero">
        <div>
          <span className="kicker">WALLET NOTIFICATIONS</span>
          <h2>Notify customers in your authorized scope</h2>
          <p>Send to one member from the Members page, or send to everyone inside your {level==='national'?'national':level==='regional'?'regional':'city'} scope.</p>
        </div>
        <button className="redBtn" onClick={()=>beginNotify({scope:true})}>Push to All in {scopeName}</button>
      </div>
      <ExpiryStrip/>
      <div className="campaignSection">
        <h3>Recent notification campaigns</h3>
        {!campaigns.length?<div className="recordState">No notification campaigns yet.</div>:
        <div className="campaignList">{campaigns.map(c=><div className="campaignRow" key={c.public_id}>
          <div><b>{c.title}</b><small>{c.message}</small></div>
          <span className={`campaignStatus ${c.status}`}>{c.status}</span>
          <div className="campaignCounts">
            <span>Recipients <b>{c.recipient_count??'—'}</b></span>
            <span>Google <b>{c.google_sent_count??'—'}</b></span>
            <span>Apple <b>{c.apple_sent_count??'—'}</b></span>
          </div>
          <small>{c.created_at?new Date(c.created_at).toLocaleString():'—'}</small>
        </div>)}</div>}
      </div>
    </div>

    if(loading)return <div className="recordState">Loading records…</div>
    if(error)return <div className="formError">{error}</div>
    if(!rows.length)return <div className="recordState">No records found in your authorized scope.</div>

    if(view==='members')return <div className="recordsTable memberRecords">
      <div className="recordsHead"><span>Member</span><span>Contact</span><span>Location</span><span>Actions</span></div>
      {rows.map(r=><div className="recordsRow" key={r.public_id}>
        <span><b>{r.name}</b><small>{r.member_number||r.public_id}</small></span>
        <span>{r.phone||'—'}<small>{r.email||''}</small></span>
        <span>{[r.city,r.province].filter(Boolean).join(', ')||'—'}</span>
        <span className="memberRowActions">
          <button className="miniBtn" onClick={()=>openMemberDetail(r.public_id)}>View Details</button>
          <button className="miniBtn" onClick={()=>beginNotify(r)}>Notify</button>
          <button className="miniBtn qrMiniBtn" onClick={()=>openMemberQr(r.public_id)}>Wallet QR</button>
        </span>
      </div>)}
    </div>

    if(view==='warranties')return <div className="recordsTable">
      <div className="recordsHead"><span>Member / Warranty</span><span>Battery</span><span>Status</span><span>Expires</span></div>
      {rows.map(r=><div className="recordsRow" key={r.warranty_public_id||r.public_id}>
        <span><b>{r.member_name||'Member'}</b><small>{r.member_number||r.warranty_public_id}</small></span>
        <span>{r.battery_product||'—'}<small>{r.serial_number||'—'}</small></span>
        <span><b className="statusText">{(r.status||'').toUpperCase()}</b></span>
        <span><b>{r.expires_at||'—'}</b><small>{r.branch_name||''}</small></span>
      </div>)}
    </div>

    if(view==='batteries')return <div className="recordsTable">
      <div className="recordsHead"><span>Battery</span><span>Serial</span><span>Installed</span><span>Status</span></div>
      {rows.map(r=><div className="recordsRow" key={r.public_id}>
        <span><b>{r.product_name}</b><small>{r.model_code||''}</small></span>
        <span>{r.serial_number}</span><span>{r.installation_date||r.purchase_date||'—'}</span>
        <span>{r.status||'—'}</span>
      </div>)}
    </div>

    return <div className="recordsTable">
      <div className="recordsHead"><span>Action</span><span>Warranty</span><span>Result</span><span>Date</span></div>
      {rows.map(r=><div className="recordsRow" key={r.public_id}>
        <span><b>{(r.service_type||'').replaceAll('_',' ')}</b></span>
        <span>{r.warranty_public_id||'—'}</span><span>{r.result||r.notes||'—'}</span>
        <span>{r.created_at?new Date(r.created_at).toLocaleDateString():'—'}</span>
      </div>)}
    </div>
  }

  return <div className="dash">
    <aside>
      <img src={motoliteLogo}/>
      <small>{level.toUpperCase()} ACCESS</small>
      <button className={view==='overview'?'current':''} onClick={()=>setView('overview')}>Overview</button>
      {level!=='local'&&<button className={view==='staff'?'current':''} onClick={()=>setView('staff')}>Staff Management</button>}
      {level==='national'&&<button className={view==='card'?'current':''} onClick={()=>setView('card')}>Card Management</button>}
      <button className={view==='members'?'current':''} onClick={()=>setView('members')}>Members</button>
      <button className={view==='warranties'?'current':''} onClick={()=>setView('warranties')}>Warranties</button>
      <button className={view==='batteries'?'current':''} onClick={()=>setView('batteries')}>Batteries</button>
      <button className={view==='claims'?'current':''} onClick={()=>setView('claims')}>Claims & Replacements</button>
      <button className={view==='notifications'?'current':''} onClick={()=>setView('notifications')}>Notifications</button>
      <button className="bottom" onClick={()=>go('/motolite')}>Public Website</button>
      <button onClick={onLogout}>Sign Out</button>
    </aside>

    <main>
      <span className="kicker">
        {session.staff.full_name||level.toUpperCase()}
        {level==='local'&&data?.city?` · ${data.city}`:''}
      </span>

      <div className="dashTitleRow">
        <div>
          <h1>{
            view==='overview'?title:
            view==='staff'?'Staff Management':
            view==='card'?'Card Management':
            view==='members'?'Members':
            view==='warranties'?'Warranties':
            view==='batteries'?'Batteries':
            view==='notifications'?'Notifications':'Claims & Replacements'
          }</h1>
          {['members','warranties','notifications'].includes(view)&&<p className="viewSubtitle">Scope: {scopeName}</p>}
        </div>
        {view!=='card'&&<button className="redBtn" onClick={()=>go('/motolite/register')}>+ Register Warranty</button>}
      </div>

      {view==='staff'
        ? <StaffManagement API_BASE={API_BASE} session={session}/>
        : view==='card' && level==='national'
          ? <CardManagement API_BASE={API_BASE} session={session}/>
        : view!=='overview'
          ? <>
              {view==='warranties'&&<ExpiryStrip/>}
              <SearchTools/>
              <section className="recordPanel"><RecordTable/></section>
              <Pagination/>
            </>
          : <>
              <div className="stats">{stats.map(([a,b])=><div key={a}><span>{a}</span><b>{b}</b><small>Current database</small></div>)}</div>
              <div className="opsSection">
                <div className="opsHeading"><div><span className="kicker">EXPIRY WATCH</span><h3>Upcoming warranty expirations</h3></div><button className="miniBtn" onClick={()=>setView('warranties')}>View all warranties →</button></div>
                <ExpiryStrip/>
              </div>
              <div className="dashPanels">
                <section><h3>Access Scope</h3><p>{
                  level==='national'
                    ?'You can search and manage all Motolite member, battery, warranty and service records nationwide.'
                    :level==='regional'
                      ?'You can search and manage all Motolite records from branches inside your assigned region.'
                      :`You can search and manage Motolite records from all branches within ${data?.city||'your assigned city'}. Registrations remain credited to your home branch.`
                }</p></section>
                <section><h3>Warranty Health</h3><strong className="health">{data?.warranties?Math.round((data.active_warranties/data.warranties)*100):0}%</strong><p>active warranties in your authorized scope.</p><div className="bar"><i style={{width:`${data?.warranties?Math.round((data.active_warranties/data.warranties)*100):0}%`}}/></div></section>
              </div>
            </>
      }

      {detailLoading&&<div className="modalShade"><div className="memberModal smallModal">Loading…</div></div>}

      {memberDetail&&<div className="modalShade" onMouseDown={()=>setMemberDetail(null)}>
        <div className="memberModal" onMouseDown={e=>e.stopPropagation()}>
          <div className="modalHead"><div><span className="kicker">MEMBER DETAILS</span><h2>{memberDetail.member.name}</h2><small>{memberDetail.member.member_number}</small></div><button onClick={()=>setMemberDetail(null)}>×</button></div>
          {memberDetail.reminders?.length>0&&<div className="alertStack">{memberDetail.reminders.map((r,i)=><div className={`memberAlert ${r.severity}`} key={i}><b>{r.title}</b><span>{r.message}</span></div>)}</div>}
          <div className="detailGrid">
            <div><span>Phone</span><b>{memberDetail.member.phone||'—'}</b></div>
            <div><span>Email</span><b>{memberDetail.member.email||'—'}</b></div>
            <div><span>City</span><b>{memberDetail.member.city||'—'}</b></div>
            <div><span>Branch</span><b>{memberDetail.branch?.name||'—'}</b></div>
          </div>
          <div className="memberModalActions">
            <button className="miniBtn" onClick={()=>beginNotify(memberDetail.member)}>Send Notification</button>
            {memberDetail.wallet&&<button className="redBtn" onClick={()=>setShowQr({member:memberDetail.member,wallet:memberDetail.wallet})}>Show Customer Wallet QR</button>}
          </div>
          <h3>Vehicles</h3>
          <div className="miniList">{memberDetail.vehicles.map(v=><div key={v.public_id}><b>{v.make} {v.model}</b><span>{v.year||''} · {v.plate_number||'No plate'}</span></div>)}</div>
          <h3>Batteries</h3>
          <div className="miniList">{memberDetail.batteries.map(b=><div key={b.public_id}><b>{b.product_name}</b><span>{b.serial_number} · Installed {b.installation_date||b.purchase_date}</span><span>Recommended replacement: {b.recommended_replacement_date||'Not set'}</span></div>)}</div>
          <h3>Motolite Activity</h3>
          <div className="timeline">{memberDetail.activity.map((a,i)=><div className="timelineItem" key={i}><i/><div><b>{a.title}</b><span>{a.description}</span><small>{a.date?new Date(a.date).toLocaleString():'—'}</small></div></div>)}</div>
        </div>
      </div>}

      {showQr&&<div className="modalShade" onMouseDown={()=>setShowQr(null)}>
        <div className="memberModal qrModal" onMouseDown={e=>e.stopPropagation()}>
          <div className="modalHead"><div><span className="kicker">CUSTOMER WALLET QR</span><h2>{showQr.member.name}</h2></div><button onClick={()=>setShowQr(null)}>×</button></div>
          <img className="bigWalletQr" src={showQr.wallet.qr_svg_url} alt="Customer wallet QR"/>
          <p>Ask the customer to scan this QR using their phone camera. It opens the Motolite page with Apple Wallet and Google Wallet options.</p>
          <div className="walletBtns"><a className="walletApple" href={showQr.wallet.apple_url}> Add to Apple Wallet</a><a className="walletGoogle" href={showQr.wallet.google_url} target="_blank" rel="noreferrer">G Add to Google Wallet</a></div>
        </div>
      </div>}

      {notifyTarget&&<div className="modalShade" onMouseDown={()=>!notifyBusy&&setNotifyTarget(null)}>
        <div className="memberModal notifyModal" onMouseDown={e=>e.stopPropagation()}>
          <div className="modalHead">
            <div><span className="kicker">PUSH NOTIFICATION</span><h2>{notifyTarget.scope?`Everyone in ${scopeName}`:notifyTarget.name}</h2><small>{notifyTarget.scope?'All wallet-enabled members in your authorized scope':notifyTarget.member_number}</small></div>
            <button disabled={notifyBusy} onClick={()=>setNotifyTarget(null)}>×</button>
          </div>
          <label className="field"><span>Notification Title</span><input value={notifyTitle} maxLength={150} onChange={e=>setNotifyTitle(e.target.value)} placeholder="e.g. Warranty expiring soon"/></label>
          <label className="field fullField"><span>Message</span><textarea value={notifyMessage} maxLength={500} onChange={e=>setNotifyMessage(e.target.value)} placeholder="Write the customer notification…"/></label>
          {notifyResult&&<div className={notifyResult.startsWith('Queued')?'notifySuccess':'formError'}>{notifyResult}</div>}
          <div className="formActions"><button className="ghostBtn" disabled={notifyBusy} onClick={()=>setNotifyTarget(null)}>Cancel</button><button className="redBtn" disabled={notifyBusy||!notifyTitle.trim()||!notifyMessage.trim()} onClick={sendNotification}>{notifyBusy?'Queuing…':notifyTarget.scope?'Push to All':'Push to Member'}</button></div>
        </div>
      </div>}
    </main>
  </div>
}

export default function MotoliteApp({API_BASE=''}){
  const p=usePath()
  const [session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem('motolite_staff_session'))}catch{return null}})
  const save=s=>{setSession(s);localStorage.setItem('motolite_staff_session',JSON.stringify(s))}
  const logout=()=>{setSession(null);localStorage.removeItem('motolite_staff_session');go('/motolite/login')}
  if(p==='/motolite/login')return <Login API_BASE={API_BASE} onLogin={save}/>
  if(p==='/motolite/warranty')return <Warranty/>
  if(p==='/motolite/register')return session?<RegisterWarranty API_BASE={API_BASE} session={session}/>:<Login API_BASE={API_BASE} onLogin={save}/>
  if(p.startsWith('/motolite/national')||p.startsWith('/motolite/regional')||p.startsWith('/motolite/local')){
    if(!session)return <Login API_BASE={API_BASE} onLogin={save}/>
    const required=p.split('/')[2]
    if(required!==session.staff.role){go(`/motolite/${session.staff.role}`);return null}
    return <Dashboard level={session.staff.role} API_BASE={API_BASE} session={session} onLogout={logout}/>
  }
  return <Home/>
}
