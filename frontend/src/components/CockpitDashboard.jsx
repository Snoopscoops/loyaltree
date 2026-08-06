import React, { useEffect, useState } from 'react'

const TABS = ['overview','events','announcements','results','gallery','sponsors','settings']
const empty = {
  events:{title:'',event_date:'',start_time:'',category:'',entry_fee:'',prize_details:'',description:'',poster_url:'',status:'upcoming'},
  announcements:{title:'',message:'',publish_date:'',is_pinned:false,is_active:true},
  results:{event_public_id:'',category:'',champion_name:'',runner_up_name:'',third_place_name:'',notes:'',photo_url:''},
  gallery:{event_public_id:'',title:'',album_name:'',image_url:''},
  sponsors:{name:'',logo_url:'',website_url:'',description:'',sort_order:0,is_active:true},
}

async function uploadImage(API_BASE, businessId, file, purpose) {
  const sigRes = await fetch(`${API_BASE}/api/v1/business/${businessId}/cloudinary-signature?purpose=${purpose}`, {method:'POST'})
  const sig = await sigRes.json()
  if (!sigRes.ok) throw new Error(sig.detail || 'Upload signature failed')
  const body = new FormData()
  body.append('file', file); body.append('api_key', sig.api_key); body.append('timestamp', sig.timestamp)
  body.append('signature', sig.signature); body.append('upload_preset', sig.upload_preset); body.append('folder', sig.folder)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {method:'POST', body})
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'Upload failed')
  return data.secure_url
}

export default function CockpitDashboard({ API_BASE, user, onLogout }) {
  const businessId = user?.business_slug
  const [tab,setTab] = useState('overview')
  const [data,setData] = useState({events:[],announcements:[],results:[],gallery:[],sponsors:[],settings:{}})
  const [forms,setForms] = useState(JSON.parse(JSON.stringify(empty)))
  const [settings,setSettings] = useState({})
  const [message,setMessage] = useState('')
  const request = async (path,opts={}) => {
    const res = await fetch(`${API_BASE}${path}`, {...opts, headers:{...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}})
    const out = await res.json().catch(()=>({}))
    if (!res.ok) throw new Error(out.detail || 'Request failed')
    return out
  }
  const load = async () => {
    try { const d=await request(`/api/v1/business/${businessId}/cockpit/dashboard`); setData(d); setSettings(d.settings||{}) }
    catch(e){ setMessage(e.message) }
  }
  useEffect(()=>{ if(businessId) load() },[businessId])
  const flash = m => { setMessage(m); setTimeout(()=>setMessage(''),2500) }
  const setForm = (kind,patch) => setForms(v=>({...v,[kind]:{...v[kind],...patch}}))
  const create = async kind => {
    try { await request(`/api/v1/business/${businessId}/cockpit/${kind}`,{method:'POST',body:JSON.stringify(forms[kind])}); setForms(v=>({...v,[kind]:JSON.parse(JSON.stringify(empty[kind]))})); await load(); flash('Saved') }
    catch(e){ flash(e.message) }
  }
  const remove = async (kind,id) => { if(!confirm('Delete this item?')) return; try{ await request(`/api/v1/business/${businessId}/cockpit/${kind}/${id}`,{method:'DELETE'}); await load(); flash('Deleted') }catch(e){flash(e.message)} }
  const upload = async (kind,field,file) => { try{ const url=await uploadImage(API_BASE,businessId,file,`cockpit_${kind}`); setForm(kind,{[field]:url}); flash('Image uploaded') }catch(e){flash(e.message)} }
  const publicUrl = `${API_BASE}/cockpit/${businessId}`

  return <div style={S.page}>
    <header style={S.header}><div><h1 style={{margin:0}}>{user?.business_name || 'Cockpit Arena'}</h1><small>LoyaltyTree Cockpit Admin</small></div><div><a style={S.view} href={publicUrl} target="_blank" rel="noreferrer">View website</a><button style={S.logout} onClick={onLogout}>Log out</button></div></header>
    {message && <div style={S.toast}>{message}</div>}
    <nav style={S.nav}>{TABS.map(x=><button key={x} style={{...S.tab,...(tab===x?S.active:{})}} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</nav>
    <main style={S.main}>
      {tab==='overview' && <><div style={S.cards}>{[['Events',data.events.length],['Announcements',data.announcements.length],['Results',data.results.length],['Gallery',data.gallery.length],['Sponsors',data.sponsors.length]].map(([a,b])=><div style={S.card} key={a}><b style={{fontSize:30}}>{b}</b><div>{a}</div></div>)}</div><Panel title="Public website"><input style={S.input} readOnly value={publicUrl}/></Panel></>}
      {tab==='events' && <Crud title="Events" form={<><Input label="Title" value={forms.events.title} onChange={v=>setForm('events',{title:v})}/><Input label="Date" type="date" value={forms.events.event_date} onChange={v=>setForm('events',{event_date:v})}/><Input label="Time" type="time" value={forms.events.start_time} onChange={v=>setForm('events',{start_time:v})}/><Input label="Category" value={forms.events.category} onChange={v=>setForm('events',{category:v})}/><Input label="Entry fee" type="number" value={forms.events.entry_fee} onChange={v=>setForm('events',{entry_fee:v})}/><Input label="Prize details" value={forms.events.prize_details} onChange={v=>setForm('events',{prize_details:v})}/><Input label="Description" value={forms.events.description} onChange={v=>setForm('events',{description:v})}/><Select label="Status" value={forms.events.status} onChange={v=>setForm('events',{status:v})} options={['upcoming','open','closed','finished','cancelled']}/><File label="Poster" onChange={f=>upload('events','poster_url',f)}/></>} onSave={()=>create('events')} items={data.events} onDelete={id=>remove('events',id)}/>} 
      {tab==='announcements' && <Crud title="Announcements" form={<><Input label="Title" value={forms.announcements.title} onChange={v=>setForm('announcements',{title:v})}/><Input label="Publish date" type="date" value={forms.announcements.publish_date} onChange={v=>setForm('announcements',{publish_date:v})}/><Input label="Message" value={forms.announcements.message} onChange={v=>setForm('announcements',{message:v})}/></>} onSave={()=>create('announcements')} items={data.announcements} onDelete={id=>remove('announcements',id)}/>} 
      {tab==='results' && <Crud title="Results" form={<><Select label="Event" value={forms.results.event_public_id} onChange={v=>setForm('results',{event_public_id:v})} options={data.events.map(e=>({value:e.public_id,label:e.title}))}/><Input label="Category" value={forms.results.category} onChange={v=>setForm('results',{category:v})}/><Input label="Champion" value={forms.results.champion_name} onChange={v=>setForm('results',{champion_name:v})}/><Input label="Runner-up" value={forms.results.runner_up_name} onChange={v=>setForm('results',{runner_up_name:v})}/><Input label="Third place" value={forms.results.third_place_name} onChange={v=>setForm('results',{third_place_name:v})}/><Input label="Notes" value={forms.results.notes} onChange={v=>setForm('results',{notes:v})}/><File label="Photo" onChange={f=>upload('results','photo_url',f)}/></>} onSave={()=>create('results')} items={data.results} onDelete={id=>remove('results',id)}/>} 
      {tab==='gallery' && <Crud title="Gallery" form={<><Input label="Title" value={forms.gallery.title} onChange={v=>setForm('gallery',{title:v})}/><Input label="Album" value={forms.gallery.album_name} onChange={v=>setForm('gallery',{album_name:v})}/><File label="Image" onChange={f=>upload('gallery','image_url',f)}/></>} onSave={()=>create('gallery')} items={data.gallery} onDelete={id=>remove('gallery',id)}/>} 
      {tab==='sponsors' && <Crud title="Sponsors" form={<><Input label="Name" value={forms.sponsors.name} onChange={v=>setForm('sponsors',{name:v})}/><Input label="Website" value={forms.sponsors.website_url} onChange={v=>setForm('sponsors',{website_url:v})}/><Input label="Description" value={forms.sponsors.description} onChange={v=>setForm('sponsors',{description:v})}/><File label="Logo" onChange={f=>upload('sponsors','logo_url',f)}/></>} onSave={()=>create('sponsors')} items={data.sponsors} onDelete={id=>remove('sponsors',id)}/>} 
      {tab==='settings' && <Panel title="Website Settings"><div style={S.grid}>{['arena_name','tagline','about_text','contact_phone','contact_email','address','facebook_url','map_embed_url'].map(k=><Input key={k} label={k.replaceAll('_',' ')} value={settings[k]||''} onChange={v=>setSettings({...settings,[k]:v})}/>)}</div><div style={S.grid}><File label="Hero image" onChange={async f=>setSettings({...settings,hero_image_url:await uploadImage(API_BASE,businessId,f,'cockpit_settings')})}/><File label="Logo" onChange={async f=>setSettings({...settings,logo_url:await uploadImage(API_BASE,businessId,f,'cockpit_settings')})}/></div><button style={S.primary} onClick={async()=>{try{await request(`/api/v1/business/${businessId}/cockpit/settings`,{method:'PUT',body:JSON.stringify(settings)});await load();flash('Settings saved')}catch(e){flash(e.message)}}}>Save settings</button></Panel>}
    </main>
  </div>
}

const Panel=({title,children})=><section style={S.panel}><h2>{title}</h2>{children}</section>
const Input=({label,value,onChange,type='text'})=><label style={S.field}><span>{label}</span><input style={S.input} type={type} value={value||''} onChange={e=>onChange(e.target.value)}/></label>
const File=({label,onChange})=><label style={S.field}><span>{label}</span><input style={S.input} type="file" accept="image/*" onChange={e=>onChange(e.target.files?.[0])}/></label>
const Select=({label,value,onChange,options})=><label style={S.field}><span>{label}</span><select style={S.input} value={value||''} onChange={e=>onChange(e.target.value)}><option value="">Select</option>{options.map(o=>typeof o==='string'?<option key={o} value={o}>{o}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
function Crud({title,form,onSave,items,onDelete}){return <><Panel title={`Add ${title.slice(0,-1)}`}><div style={S.grid}>{form}</div><button style={S.primary} onClick={onSave}>Save</button></Panel><Panel title={title}>{items.length?items.map(x=><div key={x.public_id} style={S.row}><div><b>{x.title||x.name||x.category||'Record'}</b><div style={{fontSize:13,color:'#766'}}>{x.event_date||x.message||x.description||x.champion_name||''}</div></div><button style={S.delete} onClick={()=>onDelete(x.public_id)}>Delete</button></div>):<p>No records yet.</p>}</Panel></>}

const S={page:{minHeight:'100vh',background:'#f4efe8',fontFamily:'Arial,sans-serif'},header:{background:'#211813',color:'#fff',padding:'20px 28px',display:'flex',justifyContent:'space-between',alignItems:'center'},view:{color:'#fff',background:'#a67734',padding:'10px 14px',borderRadius:8,textDecoration:'none',marginRight:8},logout:{padding:'10px 14px',borderRadius:8,border:'1px solid #776',background:'transparent',color:'#fff'},nav:{display:'flex',gap:6,overflowX:'auto',padding:12,background:'#fff'},tab:{border:0,background:'transparent',padding:'10px 13px',borderRadius:8,textTransform:'capitalize'},active:{background:'#211813',color:'#fff'},main:{maxWidth:1150,margin:'auto',padding:24},panel:{background:'#fff',padding:20,borderRadius:14,marginBottom:18,boxShadow:'0 5px 18px #0000000d'},cards:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18},card:{background:'#fff',padding:18,borderRadius:12},grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:14},field:{display:'flex',flexDirection:'column',gap:5,textTransform:'capitalize',fontSize:13,fontWeight:700},input:{padding:11,border:'1px solid #d6cabf',borderRadius:8,font:'inherit',width:'100%',boxSizing:'border-box'},primary:{background:'#8a6129',color:'#fff',border:0,borderRadius:8,padding:'11px 16px',fontWeight:700},row:{display:'flex',justifyContent:'space-between',gap:12,padding:'12px 0',borderBottom:'1px solid #eee'},delete:{border:'1px solid #f4b4b4',color:'#b42318',background:'#fff3f3',borderRadius:7,padding:'7px 10px'},toast:{position:'fixed',top:80,right:20,zIndex:5,background:'#211813',color:'#fff',padding:'12px 15px',borderRadius:8}}
