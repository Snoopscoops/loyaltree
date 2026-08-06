import React, { useEffect, useRef, useState } from 'react'

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

const money = value => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? `₱${n.toLocaleString('en-PH')}` : ''
}

const readableDate = value => {
  if (!value) return ''
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'})
}

const readableTime = value => {
  if (!value) return ''
  const [h,m] = String(value).split(':').map(Number)
  if (!Number.isFinite(h)) return value
  return new Date(2000,0,1,h,m||0).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit'})
}

const safeFileName = value => (value || 'VCSA-post').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').slice(0,80)

function roundRect(ctx,x,y,w,h,r){
  const rr=Math.min(r,w/2,h/2)
  ctx.beginPath();ctx.moveTo(x+rr,y);ctx.arcTo(x+w,y,x+w,y+h,rr);ctx.arcTo(x+w,y+h,x,y+h,rr);ctx.arcTo(x,y+h,x,y,rr);ctx.arcTo(x,y,x+w,y,rr);ctx.closePath()
}

function wrapLines(ctx,text,maxWidth,maxLines=8){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean)
  if(!words.length)return []
  const lines=[];let line=''
  for(const word of words){
    const test=line?`${line} ${word}`:word
    if(ctx.measureText(test).width<=maxWidth){line=test;continue}
    if(line)lines.push(line)
    line=word
    if(lines.length>=maxLines-1)break
  }
  if(line&&lines.length<maxLines)lines.push(line)
  if(lines.length===maxLines&&words.join(' ').length>lines.join(' ').length){
    let last=lines[maxLines-1]
    while(last.length>2&&ctx.measureText(`${last}…`).width>maxWidth)last=last.slice(0,-1)
    lines[maxLines-1]=`${last}…`
  }
  return lines
}

async function loadCanvasImage(url){
  if(!url)return null
  try{
    const res=await fetch(url,{mode:'cors'})
    if(!res.ok)throw new Error('image fetch failed')
    const blob=await res.blob()
    return await createImageBitmap(blob)
  }catch{
    return await new Promise(resolve=>{
      const img=new Image();img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=url
    })
  }
}

function drawCover(ctx,img,x,y,w,h){
  if(!img)return
  const iw=img.width||img.naturalWidth, ih=img.height||img.naturalHeight
  const scale=Math.max(w/iw,h/ih), sw=w/scale, sh=h/scale, sx=(iw-sw)/2, sy=(ih-sh)/2
  ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h)
}

function buildCaption(kind,item,settings,publicUrl,hashtags){
  const arena=settings?.arena_name||'VCSA Cockpit Arena'
  const phone=settings?.contact_phone||''
  const address=settings?.address||''
  const tags=(hashtags||'#VCSA #CockpitArena #Sabong #DerbySchedule').trim()
  if(kind==='event'){
    const lines=[`🐓 ${String(item.title||'UPCOMING DERBY').toUpperCase()}`]
    if(item.event_date)lines.push(`📅 ${readableDate(item.event_date)}`)
    if(item.start_time)lines.push(`🕕 ${readableTime(item.start_time)}`)
    if(address)lines.push(`📍 ${address}`);else lines.push(`📍 ${arena}`)
    if(item.category)lines.push(`🏷️ ${item.category}`)
    if(money(item.entry_fee))lines.push(`💰 Entry Fee: ${money(item.entry_fee)}`)
    if(item.prize_details)lines.push(`🏆 ${item.prize_details}`)
    if(item.description)lines.push('',item.description)
    lines.push('',item.status==='closed'?'Registration is closed.':'Registration and inquiries are now open.')
    if(phone)lines.push(`📞 ${phone}`)
    lines.push(`🌐 ${publicUrl}`,'',tags)
    return lines.join('\n')
  }
  const lines=[`📢 ${String(item.title||'IMPORTANT ANNOUNCEMENT').toUpperCase()}`,'',item.message||'Please check our official page and website for the latest update.']
  if(item.publish_date)lines.push('',`📅 ${readableDate(item.publish_date)}`)
  if(address)lines.push(`📍 ${address}`);else lines.push(`📍 ${arena}`)
  if(phone)lines.push(`📞 ${phone}`)
  lines.push(`🌐 ${publicUrl}`,'',tags)
  return lines.join('\n')
}

function SocialPostStudio({kind,item,settings,publicUrl,onClose}){
  const canvasRef=useRef(null)
  const [format,setFormat]=useState('portrait')
  const [theme,setTheme]=useState('red')
  const [hashtags,setHashtags]=useState('#VCSA #CockpitArena #Sabong #DerbySchedule')
  const [customHeadline,setCustomHeadline]=useState('')
  const [backgroundUrl,setBackgroundUrl]=useState(kind==='event'?(item.poster_url||settings?.hero_image_url||''):(settings?.hero_image_url||''))
  const [showFee,setShowFee]=useState(true)
  const [showPrize,setShowPrize]=useState(true)
  const [busy,setBusy]=useState(false)
  const caption=buildCaption(kind,item,settings,publicUrl,hashtags)

  useEffect(()=>{
    let cancelled=false
    const draw=async()=>{
      const canvas=canvasRef.current;if(!canvas)return
      const W=1080,H=format==='square'?1080:1350
      canvas.width=W;canvas.height=H
      const ctx=canvas.getContext('2d')
      const bg=await loadCanvasImage(backgroundUrl)
      const logo=await loadCanvasImage(settings?.logo_url)
      if(cancelled)return
      const red=theme==='red'?'#8f0f18':'#151515', gold='#d4a84f'
      ctx.fillStyle='#100d0d';ctx.fillRect(0,0,W,H)
      if(bg){drawCover(ctx,bg,0,0,W,H);ctx.fillStyle='rgba(8,5,5,.60)';ctx.fillRect(0,0,W,H)}
      const grad=ctx.createLinearGradient(0,0,0,H);grad.addColorStop(0,'rgba(0,0,0,.10)');grad.addColorStop(.64,'rgba(0,0,0,.52)');grad.addColorStop(1,'rgba(0,0,0,.96)');ctx.fillStyle=grad;ctx.fillRect(0,0,W,H)
      ctx.fillStyle=red;ctx.fillRect(0,0,24,H)
      ctx.fillStyle=gold;ctx.fillRect(24,0,8,H)
      ctx.fillStyle='rgba(143,15,24,.95)';ctx.fillRect(0,0,W,128)
      ctx.fillStyle=gold;ctx.fillRect(0,128,W,6)
      if(logo){ctx.save();ctx.beginPath();ctx.arc(88,64,46,0,Math.PI*2);ctx.clip();drawCover(ctx,logo,42,18,92,92);ctx.restore();ctx.strokeStyle=gold;ctx.lineWidth=4;ctx.beginPath();ctx.arc(88,64,47,0,Math.PI*2);ctx.stroke()}
      ctx.fillStyle='#fff';ctx.font='800 34px Arial';ctx.fillText(settings?.arena_name||'VCSA COCKPIT ARENA',logo?156:58,58)
      ctx.fillStyle='#ffe6a5';ctx.font='600 20px Arial';ctx.fillText(settings?.tagline||'THE OFFICIAL ARENA UPDATE',logo?156:90,90)
      const headline=(customHeadline||item.title||(kind==='event'?'UPCOMING DERBY':'IMPORTANT ANNOUNCEMENT')).toUpperCase()
      ctx.font=`900 ${kind==='event'?72:66}px Arial`;ctx.fillStyle='#fff'
      const headlineLines=wrapLines(ctx,headline,W-130,3)
      let y=H*(format==='square'?.30:.32)
      headlineLines.forEach(line=>{ctx.fillText(line,72,y);y+=82})
      ctx.fillStyle=gold;ctx.fillRect(72,y+8,180,8);y+=58
      if(kind==='event'){
        ctx.font='700 34px Arial';ctx.fillStyle='#fff'
        const details=[]
        if(item.event_date)details.push(`DATE  •  ${readableDate(item.event_date)}`)
        if(item.start_time)details.push(`TIME  •  ${readableTime(item.start_time)}`)
        if(item.category)details.push(`CATEGORY  •  ${item.category}`)
        details.forEach(line=>{ctx.fillText(line,72,y);y+=50})
        if((showFee&&money(item.entry_fee))||(showPrize&&item.prize_details)){
          y+=14;roundRect(ctx,62,y,W-124,144,18);ctx.fillStyle='rgba(143,15,24,.92)';ctx.fill()
          ctx.fillStyle='#fff';ctx.font='800 28px Arial'
          if(showFee&&money(item.entry_fee))ctx.fillText(`ENTRY FEE: ${money(item.entry_fee)}`,88,y+49)
          if(showPrize&&item.prize_details){ctx.font='800 30px Arial';const pl=wrapLines(ctx,item.prize_details,W-180,2);pl.forEach((line,i)=>ctx.fillText(line,88,y+93+i*34))}
          y+=174
        }
        if(item.description){ctx.fillStyle='#f6eee9';ctx.font='500 27px Arial';wrapLines(ctx,item.description,W-145,4).forEach(line=>{ctx.fillText(line,72,y);y+=38})}
      }else{
        roundRect(ctx,62,y,W-124,Math.min(390,H-y-260),20);ctx.fillStyle='rgba(255,255,255,.94)';ctx.fill()
        ctx.fillStyle='#2b1717';ctx.font='700 31px Arial';let ty=y+54
        wrapLines(ctx,item.message||'Please check our official channels for the latest update.',W-190,8).forEach(line=>{ctx.fillText(line,92,ty);ty+=43})
      }
      const bottomY=H-160
      ctx.fillStyle='rgba(0,0,0,.78)';ctx.fillRect(32,bottomY,W-32,160)
      ctx.fillStyle=gold;ctx.font='800 24px Arial';ctx.fillText(settings?.address||settings?.arena_name||'VCSA Cockpit Arena',72,bottomY+48)
      ctx.fillStyle='#fff';ctx.font='600 22px Arial'
      const contact=[settings?.contact_phone,publicUrl].filter(Boolean).join('   •   ')
      ctx.fillText(contact.slice(0,82),72,bottomY+86)
      ctx.fillStyle='#ddd';ctx.font='600 19px Arial';ctx.fillText(hashtags.slice(0,95),72,bottomY+124)
    }
    draw()
    return()=>{cancelled=true}
  },[kind,item,settings,publicUrl,format,theme,hashtags,customHeadline,backgroundUrl,showFee,showPrize])

  const download=()=>{
    const canvas=canvasRef.current;if(!canvas)return
    setBusy(true)
    canvas.toBlob(blob=>{
      if(!blob){setBusy(false);return}
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${safeFileName(item.title)}-${format}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);setBusy(false)
    },'image/png',1)
  }
  const copyCaption=async()=>{
    try{await navigator.clipboard.writeText(caption);alert('Facebook caption copied.')}
    catch{const t=document.createElement('textarea');t.value=caption;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();alert('Facebook caption copied.')}
  }

  return <div style={S.modalOverlay} onClick={onClose}>
    <div style={S.studioModal} onClick={e=>e.stopPropagation()}>
      <div style={S.studioHead}><div><h2 style={{margin:0}}>Facebook Post Studio</h2><div style={S.muted}>Generate a branded image and ready-to-paste caption.</div></div><button style={S.close} onClick={onClose}>×</button></div>
      <div style={S.studioGrid}>
        <div>
          <canvas ref={canvasRef} style={{...S.canvas,aspectRatio:format==='square'?'1 / 1':'4 / 5'}}/>
          <div style={S.actionRow}><button style={S.primary} onClick={download} disabled={busy}>{busy?'Preparing…':'Download PNG'}</button><button style={S.secondary} onClick={copyCaption}>Copy Facebook Caption</button></div>
        </div>
        <div style={S.controls}>
          <Select label="Format" value={format} onChange={setFormat} options={[{value:'portrait',label:'Facebook portrait — 1080 × 1350'},{value:'square',label:'Facebook square — 1080 × 1080'}]}/>
          <Select label="Template" value={theme} onChange={setTheme} options={[{value:'red',label:'VCSA red and gold'},{value:'black',label:'Black and gold'}]}/>
          <Input label="Custom headline (optional)" value={customHeadline} onChange={setCustomHeadline}/>
          <Input label="Background image URL" value={backgroundUrl} onChange={setBackgroundUrl}/>
          {kind==='event'&&<div style={S.checkRow}><label><input type="checkbox" checked={showFee} onChange={e=>setShowFee(e.target.checked)}/> Show entry fee</label><label><input type="checkbox" checked={showPrize} onChange={e=>setShowPrize(e.target.checked)}/> Show prize</label></div>}
          <Input label="Hashtags" value={hashtags} onChange={setHashtags}/>
          <label style={S.field}><span>Generated Facebook caption</span><textarea style={{...S.input,minHeight:240,resize:'vertical'}} readOnly value={caption}/></label>
        </div>
      </div>
    </div>
  </div>
}

export default function CockpitDashboard({ API_BASE, user, onLogout }) {
  const businessId = user?.business_slug
  const [tab,setTab] = useState('overview')
  const [data,setData] = useState({events:[],announcements:[],results:[],gallery:[],sponsors:[],settings:{}})
  const [forms,setForms] = useState(JSON.parse(JSON.stringify(empty)))
  const [settings,setSettings] = useState({})
  const [message,setMessage] = useState('')
  const [share,setShare] = useState(null)
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
  const upload = async (kind,field,file) => { if(!file)return;try{ const url=await uploadImage(API_BASE,businessId,file,`cockpit_${kind}`); setForm(kind,{[field]:url}); flash('Image uploaded') }catch(e){flash(e.message)} }
  const publicUrl = `${API_BASE}/cockpit/${businessId}`

  return <div style={S.page}>
    <header style={S.header}><div><h1 style={{margin:0}}>{user?.business_name || 'Cockpit Arena'}</h1><small>LoyaltyTree Cockpit Admin</small></div><div><a style={S.view} href={publicUrl} target="_blank" rel="noreferrer">View website</a><button style={S.logout} onClick={onLogout}>Log out</button></div></header>
    {message && <div style={S.toast}>{message}</div>}
    <nav style={S.nav}>{TABS.map(x=><button key={x} style={{...S.tab,...(tab===x?S.active:{})}} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</nav>
    <main style={S.main}>
      {tab==='overview' && <><div style={S.cards}>{[['Events',data.events.length],['Announcements',data.announcements.length],['Results',data.results.length],['Gallery',data.gallery.length],['Sponsors',data.sponsors.length]].map(([a,b])=><div style={S.card} key={a}><b style={{fontSize:30}}>{b}</b><div>{a}</div></div>)}</div><Panel title="Public website"><input style={S.input} readOnly value={publicUrl}/></Panel></>}
      {tab==='events' && <Crud title="Events" form={<><Input label="Title" value={forms.events.title} onChange={v=>setForm('events',{title:v})}/><Input label="Date" type="date" value={forms.events.event_date} onChange={v=>setForm('events',{event_date:v})}/><Input label="Time" type="time" value={forms.events.start_time} onChange={v=>setForm('events',{start_time:v})}/><Input label="Category" value={forms.events.category} onChange={v=>setForm('events',{category:v})}/><Input label="Entry fee" type="number" value={forms.events.entry_fee} onChange={v=>setForm('events',{entry_fee:v})}/><Input label="Prize details" value={forms.events.prize_details} onChange={v=>setForm('events',{prize_details:v})}/><Input label="Description" value={forms.events.description} onChange={v=>setForm('events',{description:v})}/><Select label="Status" value={forms.events.status} onChange={v=>setForm('events',{status:v})} options={['upcoming','open','closed','finished','cancelled']}/><File label="Poster/background" onChange={f=>upload('events','poster_url',f)}/></>} onSave={()=>create('events')} onPreview={()=>setShare({kind:'event',item:forms.events})} items={data.events} onDelete={id=>remove('events',id)} onShare={item=>setShare({kind:'event',item})}/>} 
      {tab==='announcements' && <Crud title="Announcements" form={<><Input label="Title" value={forms.announcements.title} onChange={v=>setForm('announcements',{title:v})}/><Input label="Publish date" type="date" value={forms.announcements.publish_date} onChange={v=>setForm('announcements',{publish_date:v})}/><Input label="Message" value={forms.announcements.message} onChange={v=>setForm('announcements',{message:v})}/></>} onSave={()=>create('announcements')} onPreview={()=>setShare({kind:'announcement',item:forms.announcements})} items={data.announcements} onDelete={id=>remove('announcements',id)} onShare={item=>setShare({kind:'announcement',item})}/>} 
      {tab==='results' && <Crud title="Results" form={<><Select label="Event" value={forms.results.event_public_id} onChange={v=>setForm('results',{event_public_id:v})} options={data.events.map(e=>({value:e.public_id,label:e.title}))}/><Input label="Category" value={forms.results.category} onChange={v=>setForm('results',{category:v})}/><Input label="Champion" value={forms.results.champion_name} onChange={v=>setForm('results',{champion_name:v})}/><Input label="Runner-up" value={forms.results.runner_up_name} onChange={v=>setForm('results',{runner_up_name:v})}/><Input label="Third place" value={forms.results.third_place_name} onChange={v=>setForm('results',{third_place_name:v})}/><Input label="Notes" value={forms.results.notes} onChange={v=>setForm('results',{notes:v})}/><File label="Photo" onChange={f=>upload('results','photo_url',f)}/></>} onSave={()=>create('results')} items={data.results} onDelete={id=>remove('results',id)}/>} 
      {tab==='gallery' && <Crud title="Gallery" form={<><Input label="Title" value={forms.gallery.title} onChange={v=>setForm('gallery',{title:v})}/><Input label="Album" value={forms.gallery.album_name} onChange={v=>setForm('gallery',{album_name:v})}/><File label="Image" onChange={f=>upload('gallery','image_url',f)}/></>} onSave={()=>create('gallery')} items={data.gallery} onDelete={id=>remove('gallery',id)}/>} 
      {tab==='sponsors' && <Crud title="Sponsors" form={<><Input label="Name" value={forms.sponsors.name} onChange={v=>setForm('sponsors',{name:v})}/><Input label="Website" value={forms.sponsors.website_url} onChange={v=>setForm('sponsors',{website_url:v})}/><Input label="Description" value={forms.sponsors.description} onChange={v=>setForm('sponsors',{description:v})}/><File label="Logo" onChange={f=>upload('sponsors','logo_url',f)}/></>} onSave={()=>create('sponsors')} items={data.sponsors} onDelete={id=>remove('sponsors',id)}/>} 
      {tab==='settings' && <Panel title="Website Settings"><div style={S.grid}>{['arena_name','tagline','about_text','contact_phone','contact_email','address','facebook_url','map_embed_url'].map(k=><Input key={k} label={k.replaceAll('_',' ')} value={settings[k]||''} onChange={v=>setSettings({...settings,[k]:v})}/>)}</div><div style={S.grid}><File label="Hero image" onChange={async f=>{if(f)setSettings({...settings,hero_image_url:await uploadImage(API_BASE,businessId,f,'cockpit_settings')})}}/><File label="Logo" onChange={async f=>{if(f)setSettings({...settings,logo_url:await uploadImage(API_BASE,businessId,f,'cockpit_settings')})}}/></div><button style={S.primary} onClick={async()=>{try{await request(`/api/v1/business/${businessId}/cockpit/settings`,{method:'PUT',body:JSON.stringify(settings)});await load();flash('Settings saved')}catch(e){flash(e.message)}}}>Save settings</button></Panel>}
    </main>
    {share&&<SocialPostStudio kind={share.kind} item={share.item} settings={settings} publicUrl={publicUrl} onClose={()=>setShare(null)}/>} 
  </div>
}

const Panel=({title,children})=><section style={S.panel}><h2>{title}</h2>{children}</section>
const Input=({label,value,onChange,type='text'})=><label style={S.field}><span>{label}</span><input style={S.input} type={type} value={value||''} onChange={e=>onChange(e.target.value)}/></label>
const File=({label,onChange})=><label style={S.field}><span>{label}</span><input style={S.input} type="file" accept="image/*" onChange={e=>onChange(e.target.files?.[0])}/></label>
const Select=({label,value,onChange,options})=><label style={S.field}><span>{label}</span><select style={S.input} value={value||''} onChange={e=>onChange(e.target.value)}><option value="">Select</option>{options.map(o=>typeof o==='string'?<option key={o} value={o}>{o}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
function Crud({title,form,onSave,onPreview,items,onDelete,onShare}){return <><Panel title={`Add ${title.slice(0,-1)}`}><div style={S.grid}>{form}</div><div style={S.actionRow}><button style={S.primary} onClick={onSave}>Save</button>{onPreview&&<button style={S.secondary} onClick={onPreview}>Preview Facebook Post</button>}</div></Panel><Panel title={title}>{items.length?items.map(x=><div key={x.public_id} style={S.row}><div><b>{x.title||x.name||x.category||'Record'}</b><div style={{fontSize:13,color:'#766'}}>{x.event_date||x.message||x.description||x.champion_name||''}</div></div><div style={S.actionRow}>{onShare&&<button style={S.shareBtn} onClick={()=>onShare(x)}>Facebook Post</button>}<button style={S.delete} onClick={()=>onDelete(x.public_id)}>Delete</button></div></div>):<p>No records yet.</p>}</Panel></>}

const S={page:{minHeight:'100vh',background:'#f4efe8',fontFamily:'Arial,sans-serif'},header:{background:'#211813',color:'#fff',padding:'20px 28px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'},view:{color:'#fff',background:'#a67734',padding:'10px 14px',borderRadius:8,textDecoration:'none',marginRight:8},logout:{padding:'10px 14px',borderRadius:8,border:'1px solid #776',background:'transparent',color:'#fff'},nav:{display:'flex',gap:6,overflowX:'auto',padding:12,background:'#fff'},tab:{border:0,background:'transparent',padding:'10px 13px',borderRadius:8,textTransform:'capitalize'},active:{background:'#211813',color:'#fff'},main:{maxWidth:1150,margin:'auto',padding:24},panel:{background:'#fff',padding:20,borderRadius:14,marginBottom:18,boxShadow:'0 5px 18px #0000000d'},cards:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18},card:{background:'#fff',padding:18,borderRadius:12},grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:14},field:{display:'flex',flexDirection:'column',gap:5,textTransform:'capitalize',fontSize:13,fontWeight:700},input:{padding:11,border:'1px solid #d6cabf',borderRadius:8,font:'inherit',width:'100%',boxSizing:'border-box'},primary:{background:'#8a6129',color:'#fff',border:0,borderRadius:8,padding:'11px 16px',fontWeight:700,cursor:'pointer'},secondary:{background:'#fff',color:'#6b431b',border:'1px solid #b99261',borderRadius:8,padding:'10px 15px',fontWeight:700,cursor:'pointer'},shareBtn:{background:'#1877f2',color:'#fff',border:0,borderRadius:7,padding:'8px 11px',fontWeight:700,cursor:'pointer'},row:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid #eee'},delete:{border:'1px solid #f4b4b4',color:'#b42318',background:'#fff3f3',borderRadius:7,padding:'7px 10px',cursor:'pointer'},toast:{position:'fixed',top:80,right:20,zIndex:20,background:'#211813',color:'#fff',padding:'12px 15px',borderRadius:8},actionRow:{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap'},modalOverlay:{position:'fixed',inset:0,zIndex:50,background:'rgba(0,0,0,.72)',padding:20,overflowY:'auto',display:'flex',justifyContent:'center',alignItems:'flex-start'},studioModal:{width:'min(1180px,100%)',background:'#f7f2ec',borderRadius:18,margin:'20px auto',padding:22,boxShadow:'0 24px 80px rgba(0,0,0,.35)'},studioHead:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,marginBottom:18},close:{border:0,background:'#2b1b17',color:'#fff',width:40,height:40,borderRadius:10,fontSize:26,cursor:'pointer'},studioGrid:{display:'grid',gridTemplateColumns:'minmax(340px,1.05fr) minmax(300px,.95fr)',gap:24},canvas:{width:'100%',display:'block',background:'#111',borderRadius:12,boxShadow:'0 12px 30px rgba(0,0,0,.22)'},controls:{display:'flex',flexDirection:'column',gap:12},checkRow:{display:'flex',gap:18,flexWrap:'wrap',fontSize:14,fontWeight:700},muted:{color:'#765f54',fontSize:14,marginTop:5}}
