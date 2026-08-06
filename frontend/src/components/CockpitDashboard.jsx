import React, { useEffect, useRef, useState } from 'react'

const TABS = ['overview','events','announcements','results','gallery','sponsors','settings']
const empty = {
  events:{title:'',event_date:'',start_time:'',category:'',entry_fee:'',prize_details:'',description:'',special_note:'',poster_url:'',status:'upcoming'},
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


const EVENT_DETAILS_LABEL = 'EVENT DETAILS:'
const SPECIAL_NOTE_LABEL = 'SPECIAL NOTE:'

function splitEventDescription(value){
  const text=String(value||'').trim()
  if(!text)return {details:'',specialNote:''}
  const specialIndex=text.indexOf(SPECIAL_NOTE_LABEL)
  if(specialIndex<0)return {details:text.replace(/^EVENT DETAILS:\s*/i,'').trim(),specialNote:''}
  const details=text.slice(0,specialIndex).replace(/^EVENT DETAILS:\s*/i,'').trim()
  const specialNote=text.slice(specialIndex+SPECIAL_NOTE_LABEL.length).trim()
  return {details,specialNote}
}

function packEventDescription(details,specialNote){
  const parts=[]
  if(String(details||'').trim())parts.push(`${EVENT_DETAILS_LABEL}\n${String(details).trim()}`)
  if(String(specialNote||'').trim())parts.push(`${SPECIAL_NOTE_LABEL}\n${String(specialNote).trim()}`)
  return parts.join('\n\n')
}

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
  const address=settings?.address||''
  const tags=(hashtags||'#VCSA #CockpitArena #Sabong #DerbySchedule').trim()
  if(kind==='event'){
    const parsed=splitEventDescription(item.description)
    const details=item.event_details||parsed.details
    const specialNote=item.special_note||parsed.specialNote
    const minimumBet=item.minimum_bet_display||money(item.entry_fee)
    const lines=[`🐓 ${String(item.title||'UPCOMING DERBY').toUpperCase()}`]
    if(item.event_date)lines.push(`📅 ${readableDate(item.event_date)}`)
    if(item.start_time)lines.push(`🕕 ${readableTime(item.start_time)}`)
    if(address)lines.push(`📍 ${address}`);else lines.push(`📍 ${arena}`)
    if(item.category)lines.push(`🏷️ ${item.category}`)
    if(minimumBet)lines.push(`💵 Minimum Bet: ${minimumBet}`)
    if(item.prize_details)lines.push(`🏆 ${item.prize_details}`)
    if(details)lines.push('',details)
    if(specialNote)lines.push('',`📌 SPECIAL NOTE`,specialNote)
    lines.push('',item.status==='closed'?'Registration is closed.':'Registration and inquiries are now open.')
    lines.push(`🌐 ${publicUrl}`,'',tags)
    return lines.join('\n')
  }
  const lines=[`📢 ${String(item.title||'IMPORTANT ANNOUNCEMENT').toUpperCase()}`,'',item.message||'Please check our official page and website for the latest update.']
  if(item.publish_date)lines.push('',`📅 ${readableDate(item.publish_date)}`)
  if(address)lines.push(`📍 ${address}`);else lines.push(`📍 ${arena}`)
  lines.push(`🌐 ${publicUrl}`,'',tags)
  return lines.join('\n')
}

function SocialPostStudio({kind,item,settings,publicUrl,onClose,initialConfig={}}){
  const canvasRef=useRef(null)
  const [format,setFormat]=useState(initialConfig.format||'portrait')
  const [template,setTemplate]=useState(initialConfig.template||(kind==='event'?'vcsaClassic':'advisory'))
  const [hashtags,setHashtags]=useState(initialConfig.hashtags||'#VCSA #CockpitArena #Sabong #DerbySchedule')
  const [customHeadline,setCustomHeadline]=useState(initialConfig.customHeadline||'')
  const [backgroundUrl,setBackgroundUrl]=useState(initialConfig.backgroundUrl||(kind==='event'?(item.poster_url||settings?.hero_image_url||''):(settings?.hero_image_url||'')))
  const [payout,setPayout]=useState(initialConfig.payout??item.prize_details??'')
  const [minimumBet,setMinimumBet]=useState(initialConfig.minimumBet??(item.entry_fee?money(item.entry_fee):''))
  const [specialNote,setSpecialNote]=useState(initialConfig.specialNote??item.special_note??splitEventDescription(item.description).specialNote??'')
  const [contactName1,setContactName1]=useState(initialConfig.contactName1||'')
  const [contactNumber1,setContactNumber1]=useState(initialConfig.contactNumber1||'')
  const [contactName2,setContactName2]=useState(initialConfig.contactName2||'')
  const [contactNumber2,setContactNumber2]=useState(initialConfig.contactNumber2||'')
  const [busy,setBusy]=useState(false)

  const posterItem={...item,prize_details:payout,minimum_bet_display:minimumBet,special_note:specialNote}
  const contactEntries=[
    [contactName1,contactNumber1],
    [contactName2,contactNumber2],
  ].filter(([,number])=>String(number||'').trim())
  const contactCaption=contactEntries.length
    ? `\n☎ Reservations:\n${contactEntries.map(([name,number])=>`• ${name?`${name} — `:''}${number}`).join('\n')}`
    : ''
  const contactPosterText=contactEntries.map(([name,number])=>`${name?`${name}: `:''}${number}`)
  const caption=buildCaption(kind,posterItem,settings,publicUrl,hashtags)+contactCaption

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

      const gold='#f4b400', red='#c8102e', blue='#163a8a', ink='#171214'
      ctx.fillStyle=template==='vcsaClassic'?'#fff':ink;ctx.fillRect(0,0,W,H)

      if(template!=='vcsaClassic'){
        if(bg){drawCover(ctx,bg,0,0,W,H);ctx.fillStyle='rgba(0,0,0,.62)';ctx.fillRect(0,0,W,H)}
        const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'rgba(0,0,0,.08)');g.addColorStop(1,'rgba(0,0,0,.96)');ctx.fillStyle=g;ctx.fillRect(0,0,W,H)
      }

      const drawCircularLogo=(cx,cy,r)=>{
        ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip()
        if(logo)drawCover(ctx,logo,cx-r,cy-r,r*2,r*2)
        else{ctx.fillStyle=red;ctx.fillRect(cx-r,cy-r,r*2,r*2)}
        ctx.restore();ctx.strokeStyle=gold;ctx.lineWidth=Math.max(5,r*.08);ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke()
      }

      if(template==='vcsaClassic'){
        drawCircularLogo(106,90,64)
        ctx.font='900 54px Arial';ctx.fillStyle=blue;ctx.fillText('VCSA',195,76)
        ctx.fillStyle=red;ctx.fillText('COCKPIT ARENA',365,76)
        ctx.font='700 28px Arial';ctx.fillStyle='#111';ctx.textAlign='center'
        ctx.fillText(settings?.address||'665 Mc Arthur Hi-way, Malanday, Valenzuela City',W/2,126)
        const headerPhones=contactEntries.map(([,number])=>number).join(' / ')
        ctx.font='700 24px Arial';ctx.fillText(headerPhones?`CP #: ${headerPhones}`:'OFFICIAL VCSA ANNOUNCEMENT',W/2,160)
        ctx.fillStyle='#111';ctx.fillRect(54,188,W-108,5)

        const title=(customHeadline||item.title||(kind==='event'?'UPCOMING EVENT':'IMPORTANT ANNOUNCEMENT')).toUpperCase()
        ctx.font='900 55px Arial';ctx.textAlign='center';ctx.fillStyle='#111'
        let y=255
        wrapLines(ctx,title,W-120,2).forEach(line=>{ctx.fillText(line,W/2,y);y+=66})

        if(kind==='event'){
          if(item.event_date){ctx.font='900 44px Arial';ctx.fillStyle='#111';ctx.fillText(readableDate(item.event_date).toUpperCase(),W/2,y+12);y+=64}
          if(payout){ctx.font='900 76px Arial';ctx.fillStyle=red;wrapLines(ctx,payout.toUpperCase(),W-100,2).forEach(line=>{ctx.fillText(line,W/2,y+38);y+=88})}
          ctx.font='900 54px Arial';ctx.fillStyle='#111';ctx.fillText('PER WIN',W/2,y+20);y+=82
          if(item.start_time){ctx.font='900 48px Arial';ctx.fillStyle=red;ctx.fillText(`${readableTime(item.start_time)} START`,W/2,y);y+=70}

          roundRect(ctx,115,y,W-230,310,22);ctx.fillStyle='#20171a';ctx.fill();ctx.strokeStyle=red;ctx.lineWidth=12;ctx.stroke()
          const big=(customHeadline||item.title||'EVENT').replace(/[^0-9]/g,'')||String(item.title||'DERBY').toUpperCase()
          ctx.font=`900 ${big.length>5?96:190}px Arial`;ctx.fillStyle=gold;ctx.shadowColor='rgba(153,33,33,.75)';ctx.shadowOffsetX=16;ctx.shadowOffsetY=16;ctx.textAlign='center';ctx.fillText(big,W/2,y+195);ctx.shadowColor='transparent'
          if(!/^\d+$/.test(big)){ctx.font='900 68px Arial';ctx.fillStyle='#fff';ctx.fillText('FIGHTS',W/2,y+276)}
          y+=350
          if(minimumBet){ctx.font='900 42px Arial';ctx.fillStyle=red;ctx.fillText(`MINIMUM BET ${minimumBet.toUpperCase()}`,W/2,y);y+=58}
          if(contactPosterText.length){ctx.font='700 28px Arial';ctx.fillStyle='#111';ctx.fillText('FOR RESERVATION',W/2,y);y+=42;ctx.font='900 29px Arial';ctx.fillStyle=red;contactPosterText.slice(0,2).forEach(line=>{ctx.fillText(line.toUpperCase(),W/2,y);y+=39});y+=8}
          if(specialNote&&y<H-115){ctx.font='800 24px Arial';ctx.fillStyle='#111';ctx.fillText('SPECIAL NOTE',W/2,y);y+=33;ctx.font='700 22px Arial';wrapLines(ctx,specialNote,W-150,3).forEach(line=>{ctx.fillText(line,W/2,y);y+=29})}
        }else{
          roundRect(ctx,80,y,W-160,H-y-230,24);ctx.fillStyle='#f7f7f7';ctx.fill();ctx.strokeStyle=red;ctx.lineWidth=8;ctx.stroke()
          ctx.font='800 38px Arial';ctx.fillStyle='#111';let ty=y+70
          wrapLines(ctx,item.message||'Please check our official page and website for the latest update.',W-240,10).forEach(line=>{ctx.fillText(line,W/2,ty);ty+=52})
          if(item.publish_date){ctx.font='900 34px Arial';ctx.fillStyle=red;ctx.fillText(readableDate(item.publish_date).toUpperCase(),W/2,ty+32)}
        }
        ctx.fillStyle=red;ctx.fillRect(0,H-78,W,78);ctx.fillStyle=gold;ctx.font='900 30px Arial';ctx.textAlign='center';ctx.fillText((settings?.tagline||'MALINIS AT MAGINOONG SABONG ANG AMING TRADISYON').toUpperCase(),W/2,H-29)
      }else{
        drawCircularLogo(W/2,116,76)
        ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='900 43px Arial';ctx.fillText((settings?.arena_name||'VCSA COCKPIT ARENA').toUpperCase(),W/2,225)
        ctx.fillStyle=gold;ctx.font='800 26px Arial';ctx.fillText((settings?.tagline||'OFFICIAL ARENA UPDATE').toUpperCase(),W/2,264)
        const title=(customHeadline||item.title||(kind==='event'?'UPCOMING DERBY':'IMPORTANT ANNOUNCEMENT')).toUpperCase()
        ctx.font='900 72px Arial';ctx.fillStyle='#fff';let y=395
        wrapLines(ctx,title,W-140,3).forEach(line=>{ctx.fillText(line,W/2,y);y+=84})
        ctx.fillStyle=gold;ctx.fillRect(W/2-120,y-30,240,8);y+=35
        if(kind==='event'){
          ctx.font='800 35px Arial';ctx.fillStyle='#fff'
          if(item.event_date){ctx.fillText(readableDate(item.event_date).toUpperCase(),W/2,y);y+=52}
          if(item.start_time){ctx.fillText(`${readableTime(item.start_time)} START`,W/2,y);y+=52}
          if(payout){ctx.font='900 54px Arial';ctx.fillStyle=gold;wrapLines(ctx,payout.toUpperCase(),W-160,3).forEach(line=>{ctx.fillText(line,W/2,y);y+=62})}
          if(minimumBet){ctx.font='900 38px Arial';ctx.fillStyle='#fff';ctx.fillText(`MINIMUM BET ${minimumBet.toUpperCase()}`,W/2,y+18);y+=62}
          if(specialNote&&y<H-250){ctx.font='800 27px Arial';ctx.fillStyle=gold;ctx.fillText('SPECIAL NOTE',W/2,y+12);y+=45;ctx.font='700 23px Arial';ctx.fillStyle='#fff';wrapLines(ctx,specialNote,W-180,4).forEach(line=>{ctx.fillText(line,W/2,y);y+=31})}
        }else{
          roundRect(ctx,80,y,W-160,360,22);ctx.fillStyle='rgba(255,255,255,.94)';ctx.fill();ctx.fillStyle='#211';ctx.font='800 32px Arial';let ty=y+60
          wrapLines(ctx,item.message||'Please check our official channels for the latest update.',W-240,8).forEach(line=>{ctx.fillText(line,W/2,ty);ty+=46})
        }
        ctx.fillStyle='rgba(0,0,0,.82)';ctx.fillRect(0,H-185,W,185)
        ctx.fillStyle=gold;ctx.font='800 25px Arial';ctx.fillText(settings?.address||settings?.arena_name||'VCSA Cockpit Arena',W/2,H-125)
        ctx.fillStyle='#fff';ctx.font='700 22px Arial';ctx.fillText([contactPosterText.join('  •  '),publicUrl].filter(Boolean).join('  •  ').slice(0,110),W/2,H-84)
        ctx.fillStyle='#ddd';ctx.font='700 19px Arial';ctx.fillText(hashtags.slice(0,100),W/2,H-45)
      }
      ctx.textAlign='left';ctx.shadowColor='transparent'
    }
    draw();return()=>{cancelled=true}
  },[kind,item,settings,publicUrl,format,template,hashtags,customHeadline,backgroundUrl,payout,minimumBet,specialNote,contactName1,contactNumber1,contactName2,contactNumber2])

  const download=()=>{const canvas=canvasRef.current;if(!canvas)return;setBusy(true);canvas.toBlob(blob=>{if(!blob){setBusy(false);return}const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${safeFileName(item.title)}-${format}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);setBusy(false)},'image/png',1)}
  const copyCaption=async()=>{try{await navigator.clipboard.writeText(caption);alert('Facebook caption copied.')}catch{const t=document.createElement('textarea');t.value=caption;document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();alert('Facebook caption copied.')}}

  return <div style={S.modalOverlay} onClick={onClose}><div style={S.studioModal} onClick={e=>e.stopPropagation()}>
    <div style={S.studioHead}><div><h2 style={{margin:0}}>Cockpit Facebook Post Studio</h2><div style={S.muted}>Generate a VCSA-style poster, download the PNG, then copy the caption.</div></div><button style={S.close} onClick={onClose}>×</button></div>
    <div style={S.studioGrid}><div><canvas ref={canvasRef} style={{...S.canvas,aspectRatio:format==='square'?'1 / 1':'4 / 5'}}/><div style={S.actionRow}><button style={S.primary} onClick={download} disabled={busy}>{busy?'Preparing…':'Download PNG'}</button><button style={S.secondary} onClick={copyCaption}>Copy Facebook Caption</button></div></div>
    <div style={S.controls}>
      <Select label="Format" value={format} onChange={setFormat} options={[{value:'portrait',label:'Facebook portrait — 1080 × 1350'},{value:'square',label:'Facebook square — 1080 × 1080'}]}/>
      <Select label="Poster template" value={template} onChange={setTemplate} options={[{value:'vcsaClassic',label:'VCSA classic announcement'},{value:'premium',label:'Premium black and gold'},{value:'advisory',label:'Dark advisory'}]}/>
      <Input label="Custom headline (optional)" value={customHeadline} onChange={setCustomHeadline}/>
      {kind==='event'&&<><Input label="Payout / prize line" value={payout} onChange={setPayout}/><Input label="Minimum bet" value={minimumBet} onChange={setMinimumBet}/><TextArea label="Special note (optional)" value={specialNote} onChange={setSpecialNote} rows={4}/></>}
      <div style={S.grid}>
        <Input label="Reservation name 1" value={contactName1} onChange={setContactName1}/>
        <Input label="Reservation number 1" value={contactNumber1} onChange={setContactNumber1}/>
        <Input label="Reservation name 2" value={contactName2} onChange={setContactName2}/>
        <Input label="Reservation number 2" value={contactNumber2} onChange={setContactNumber2}/>
      </div>
      <Input label="Background image URL" value={backgroundUrl} onChange={setBackgroundUrl}/>
      <Input label="Hashtags" value={hashtags} onChange={setHashtags}/>
      <label style={S.field}><span>Generated Facebook caption</span><textarea style={{...S.input,minHeight:220,resize:'vertical'}} readOnly value={caption}/></label>
    </div></div>
  </div></div>
}

export default function CockpitDashboard({ API_BASE, user, onLogout }) {
  const businessId = user?.business_slug
  const [tab,setTab] = useState('overview')
  const [data,setData] = useState({events:[],announcements:[],results:[],gallery:[],sponsors:[],settings:{}})
  const [forms,setForms] = useState(JSON.parse(JSON.stringify(empty)))
  const [settings,setSettings] = useState({})
  const [message,setMessage] = useState('')
  const [share,setShare] = useState(null)
  const [eventPostSettings,setEventPostSettings] = useState({
    format:'portrait', template:'vcsaClassic', customHeadline:'', backgroundUrl:'',
    hashtags:'#VCSA #CockpitArena #Sabong #DerbySchedule',
    contactName1:'', contactNumber1:'', contactName2:'', contactNumber2:'',
  })
  const [announcementPostSettings,setAnnouncementPostSettings] = useState({
    format:'portrait', template:'advisory', customHeadline:'', backgroundUrl:'',
    hashtags:'#VCSA #CockpitArena #Announcement',
    contactName1:'', contactNumber1:'', contactName2:'', contactNumber2:'',
  })
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
  const cleanOptionalText = value => {
    const text = String(value ?? '').trim()
    return text || null
  }

  const create = async kind => {
    try {
      let payload={...forms[kind]}

      if(kind==='events'){
        if(!String(forms.events.title||'').trim()) throw new Error('Event title is required')
        payload = {
          title: String(forms.events.title).trim(),
          event_date: cleanOptionalText(forms.events.event_date),
          start_time: cleanOptionalText(forms.events.start_time),
          category: cleanOptionalText(forms.events.category),
          entry_fee: forms.events.entry_fee === '' ? 0 : Number(forms.events.entry_fee),
          prize_details: cleanOptionalText(forms.events.prize_details),
          description: cleanOptionalText(packEventDescription(forms.events.description,forms.events.special_note)),
          poster_url: cleanOptionalText(forms.events.poster_url),
          status: forms.events.status || 'upcoming',
          is_featured: Boolean(forms.events.is_featured),
        }
        if(!Number.isFinite(payload.entry_fee) || payload.entry_fee < 0) throw new Error('Minimum bet must be a valid amount')
      } else if(kind==='announcements') {
        if(!String(forms.announcements.title||'').trim()) throw new Error('Announcement title is required')
        if(!String(forms.announcements.message||'').trim()) throw new Error('Announcement message is required')
        payload = {
          title: String(forms.announcements.title).trim(),
          message: String(forms.announcements.message).trim(),
          publish_date: cleanOptionalText(forms.announcements.publish_date),
          is_pinned: Boolean(forms.announcements.is_pinned),
          is_active: forms.announcements.is_active !== false,
        }
      } else {
        payload = Object.fromEntries(Object.entries(payload).map(([key,value]) => [
          key,
          typeof value === 'string' ? (value.trim() || null) : value,
        ]))
      }

      await request(`/api/v1/business/${businessId}/cockpit/${kind}`,{method:'POST',body:JSON.stringify(payload)})
      if(!['events','announcements'].includes(kind)){
        setForms(v=>({...v,[kind]:JSON.parse(JSON.stringify(empty[kind]))}))
      }
      await load()
      flash('Saved')
    }
    catch(e){ flash(e?.message || 'Save failed') }
  }
  const remove = async (kind,id) => { if(!confirm('Delete this item?')) return; try{ await request(`/api/v1/business/${businessId}/cockpit/${kind}/${id}`,{method:'DELETE'}); await load(); flash('Deleted') }catch(e){flash(e.message)} }
  const upload = async (kind,field,file) => { if(!file)return;try{ const url=await uploadImage(API_BASE,businessId,file,`cockpit_${kind}`); setForm(kind,{[field]:url}); flash('Image uploaded') }catch(e){flash(e.message)} }
  const publicUrl = `${API_BASE}/cockpit/${businessId}`

  return <div style={S.page}>
    <header style={S.header}><div style={S.brandWrap}>{settings?.logo_url&&<img src={settings.logo_url} alt="Cockpit logo" style={S.brandLogo}/>}<div><h1 style={{margin:0}}>{user?.business_name || 'Cockpit Arena'}</h1><small>LoyaltyTree Cockpit Admin</small></div></div><div><a style={S.view} href={publicUrl} target="_blank" rel="noreferrer">View website</a><button style={S.logout} onClick={onLogout}>Log out</button></div></header>
    {message && <div style={S.toast}>{message}</div>}
    <nav style={S.nav}>{TABS.map(x=><button key={x} style={{...S.tab,...(tab===x?S.active:{})}} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</nav>
    <main style={S.main}>
      {tab==='overview' && <><div style={S.cards}>{[['Events',data.events.length],['Announcements',data.announcements.length],['Results',data.results.length],['Gallery',data.gallery.length],['Sponsors',data.sponsors.length]].map(([a,b])=><div style={S.card} key={a}><b style={{fontSize:30}}>{b}</b><div>{a}</div></div>)}</div><Panel title="Public website"><input style={S.input} readOnly value={publicUrl}/></Panel></>}
      {tab==='events' && <Crud title="Events" form={<><Input label="Title" value={forms.events.title} onChange={v=>setForm('events',{title:v})}/><Input label="Date" type="date" value={forms.events.event_date} onChange={v=>setForm('events',{event_date:v})}/><Input label="Time" type="time" value={forms.events.start_time} onChange={v=>setForm('events',{start_time:v})}/><Input label="Category" value={forms.events.category} onChange={v=>setForm('events',{category:v})}/><Input label="Minimum bet" type="number" value={forms.events.entry_fee} onChange={v=>setForm('events',{entry_fee:v})}/><Input label="Prize details" value={forms.events.prize_details} onChange={v=>setForm('events',{prize_details:v})}/><TextArea label="Event details" value={forms.events.description} onChange={v=>setForm('events',{description:v})} rows={4}/><TextArea label="Special note (optional)" value={forms.events.special_note} onChange={v=>setForm('events',{special_note:v})} rows={4}/><Select label="Status" value={forms.events.status} onChange={v=>setForm('events',{status:v})} options={['upcoming','open','closed','finished','cancelled']}/><File label="Poster/background" onChange={f=>upload('events','poster_url',f)}/><PostSettingsPanel kind="event" value={eventPostSettings} onChange={setEventPostSettings}/></>} onSave={()=>create('events')} onPreview={()=>setShare({kind:'event',item:{...forms.events,minimum_bet_display:forms.events.entry_fee?money(forms.events.entry_fee):'',special_note:forms.events.special_note},config:{...eventPostSettings,payout:forms.events.prize_details,minimumBet:forms.events.entry_fee?money(forms.events.entry_fee):'',specialNote:forms.events.special_note,backgroundUrl:eventPostSettings.backgroundUrl||forms.events.poster_url||settings?.hero_image_url||''}})} items={data.events} onDelete={id=>remove('events',id)} onShare={item=>setShare({kind:'event',item,config:{...eventPostSettings,payout:item.prize_details||'',minimumBet:item.entry_fee?money(item.entry_fee):'',specialNote:item.special_note||splitEventDescription(item.description).specialNote||'',backgroundUrl:eventPostSettings.backgroundUrl||item.poster_url||settings?.hero_image_url||''}})}/>} 
      {tab==='announcements' && <Crud title="Announcements" form={<><Input label="Title" value={forms.announcements.title} onChange={v=>setForm('announcements',{title:v})}/><Input label="Publish date" type="date" value={forms.announcements.publish_date} onChange={v=>setForm('announcements',{publish_date:v})}/><TextArea label="Message" value={forms.announcements.message} onChange={v=>setForm('announcements',{message:v})} rows={5}/><PostSettingsPanel kind="announcement" value={announcementPostSettings} onChange={setAnnouncementPostSettings}/></>} onSave={()=>create('announcements')} onPreview={()=>setShare({kind:'announcement',item:forms.announcements,config:{...announcementPostSettings,backgroundUrl:announcementPostSettings.backgroundUrl||settings?.hero_image_url||''}})} items={data.announcements} onDelete={id=>remove('announcements',id)} onShare={item=>setShare({kind:'announcement',item,config:{...announcementPostSettings,backgroundUrl:announcementPostSettings.backgroundUrl||settings?.hero_image_url||''}})}/>} 
      {tab==='results' && <Crud title="Results" form={<><Select label="Event" value={forms.results.event_public_id} onChange={v=>setForm('results',{event_public_id:v})} options={data.events.map(e=>({value:e.public_id,label:e.title}))}/><Input label="Category" value={forms.results.category} onChange={v=>setForm('results',{category:v})}/><Input label="Champion" value={forms.results.champion_name} onChange={v=>setForm('results',{champion_name:v})}/><Input label="Runner-up" value={forms.results.runner_up_name} onChange={v=>setForm('results',{runner_up_name:v})}/><Input label="Third place" value={forms.results.third_place_name} onChange={v=>setForm('results',{third_place_name:v})}/><Input label="Notes" value={forms.results.notes} onChange={v=>setForm('results',{notes:v})}/><File label="Photo" onChange={f=>upload('results','photo_url',f)}/></>} onSave={()=>create('results')} items={data.results} onDelete={id=>remove('results',id)}/>} 
      {tab==='gallery' && <Crud title="Gallery" form={<><Input label="Title" value={forms.gallery.title} onChange={v=>setForm('gallery',{title:v})}/><Input label="Album" value={forms.gallery.album_name} onChange={v=>setForm('gallery',{album_name:v})}/><File label="Image" onChange={f=>upload('gallery','image_url',f)}/></>} onSave={()=>create('gallery')} items={data.gallery} onDelete={id=>remove('gallery',id)}/>} 
      {tab==='sponsors' && <Crud title="Sponsors" form={<><Input label="Name" value={forms.sponsors.name} onChange={v=>setForm('sponsors',{name:v})}/><Input label="Website" value={forms.sponsors.website_url} onChange={v=>setForm('sponsors',{website_url:v})}/><Input label="Description" value={forms.sponsors.description} onChange={v=>setForm('sponsors',{description:v})}/><File label="Logo" onChange={f=>upload('sponsors','logo_url',f)}/></>} onSave={()=>create('sponsors')} items={data.sponsors} onDelete={id=>remove('sponsors',id)}/>} 
      {tab==='settings' && <Panel title="Website Settings"><div style={S.grid}>{['arena_name','tagline','about_text','contact_phone','contact_email','address','facebook_url','map_embed_url'].map(k=><Input key={k} label={k.replaceAll('_',' ')} value={settings[k]||''} onChange={v=>setSettings({...settings,[k]:v})}/>)}</div><div style={S.grid}><File label="Hero image" onChange={async f=>{if(f)setSettings({...settings,hero_image_url:await uploadImage(API_BASE,businessId,f,'cockpit_settings')})}}/><File label="Logo" onChange={async f=>{if(f)setSettings({...settings,logo_url:await uploadImage(API_BASE,businessId,f,'cockpit_settings')})}}/></div><button style={S.primary} onClick={async()=>{try{await request(`/api/v1/business/${businessId}/cockpit/settings`,{method:'PUT',body:JSON.stringify(settings)});await load();flash('Settings saved')}catch(e){flash(e.message)}}}>Save settings</button></Panel>}
    </main>
    {share&&<SocialPostStudio kind={share.kind} item={share.item} settings={settings} publicUrl={publicUrl} initialConfig={share.config||{}} onClose={()=>setShare(null)}/>} 
  </div>
}

const Panel=({title,children})=><section style={S.panel}><h2>{title}</h2>{children}</section>
const Input=({label,value,onChange,type='text'})=><label style={S.field}><span>{label}</span><input style={S.input} type={type} value={value||''} onChange={e=>onChange(e.target.value)}/></label>
const TextArea=({label,value,onChange,rows=4})=><label style={S.field}><span>{label}</span><textarea style={{...S.input,minHeight:rows*26,resize:'vertical'}} rows={rows} value={value||''} onChange={e=>onChange(e.target.value)}/></label>
const File=({label,onChange})=><label style={S.field}><span>{label}</span><input style={S.input} type="file" accept="image/*" onChange={e=>onChange(e.target.files?.[0])}/></label>
const Select=({label,value,onChange,options})=><label style={S.field}><span>{label}</span><select style={S.input} value={value||''} onChange={e=>onChange(e.target.value)}><option value="">Select</option>{options.map(o=>typeof o==='string'?<option key={o} value={o}>{o}</option>:<option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
function PostSettingsPanel({kind,value,onChange}){
  const patch = next => onChange({...value,...next})
  return <div style={S.postSettingsBox}>
    <div style={S.postSettingsTitle}>Facebook post settings</div>
    <div style={S.postSettingsHint}>Edit these settings first, then click Preview Facebook Post below.</div>
    <div style={S.grid}>
      <Select label="Poster template" value={value.template} onChange={v=>patch({template:v})} options={kind==='event'?[{value:'vcsaClassic',label:'VCSA classic announcement'},{value:'premium',label:'Premium black and gold'}]:[{value:'advisory',label:'Dark advisory'},{value:'vcsaClassic',label:'VCSA classic announcement'}]}/>
      <Select label="Poster format" value={value.format} onChange={v=>patch({format:v})} options={[{value:'portrait',label:'Facebook portrait — 1080 × 1350'},{value:'square',label:'Facebook square — 1080 × 1080'}]}/>
      <Input label="Custom poster headline (optional)" value={value.customHeadline} onChange={v=>patch({customHeadline:v})}/>
      <Input label="Custom background image URL (optional)" value={value.backgroundUrl} onChange={v=>patch({backgroundUrl:v})}/>
      <Input label="Reservation name 1" value={value.contactName1} onChange={v=>patch({contactName1:v})}/>
      <Input label="Reservation number 1" value={value.contactNumber1} onChange={v=>patch({contactNumber1:v})}/>
      <Input label="Reservation name 2" value={value.contactName2} onChange={v=>patch({contactName2:v})}/>
      <Input label="Reservation number 2" value={value.contactNumber2} onChange={v=>patch({contactNumber2:v})}/>
    </div>
    <TextArea label="Facebook hashtags" value={value.hashtags} onChange={v=>patch({hashtags:v})} rows={2}/>
  </div>
}

function Crud({title,form,onSave,onPreview,items,onDelete,onShare}){return <><Panel title={`Add ${title.slice(0,-1)}`}><div style={S.grid}>{form}</div><div style={S.actionRow}><button style={S.primary} onClick={onSave}>Save</button>{onPreview&&<button style={S.secondary} onClick={onPreview}>Preview Facebook Post</button>}</div></Panel><Panel title={title}>{items.length?items.map(x=><div key={x.public_id} style={S.row}><div><b>{x.title||x.name||x.category||'Record'}</b><div style={{fontSize:13,color:'#766'}}>{x.event_date||x.message||x.description||x.champion_name||''}</div></div><div style={S.actionRow}>{onShare&&<button style={S.shareBtn} onClick={()=>onShare(x)}>Facebook Post</button>}<button style={S.delete} onClick={()=>onDelete(x.public_id)}>Delete</button></div></div>):<p>No records yet.</p>}</Panel></>}

const S={page:{minHeight:'100vh',background:'#f4efe8',fontFamily:'Arial,sans-serif'},brandWrap:{display:'flex',alignItems:'center',gap:12},brandLogo:{width:64,height:64,borderRadius:'50%',objectFit:'cover',border:'3px solid #d4a84f',background:'#fff'},header:{background:'#211813',color:'#fff',padding:'20px 28px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'},view:{color:'#fff',background:'#a67734',padding:'10px 14px',borderRadius:8,textDecoration:'none',marginRight:8},logout:{padding:'10px 14px',borderRadius:8,border:'1px solid #776',background:'transparent',color:'#fff'},nav:{display:'flex',gap:6,overflowX:'auto',padding:12,background:'#fff'},tab:{border:0,background:'transparent',padding:'10px 13px',borderRadius:8,textTransform:'capitalize'},active:{background:'#211813',color:'#fff'},main:{maxWidth:1150,margin:'auto',padding:24},panel:{background:'#fff',padding:20,borderRadius:14,marginBottom:18,boxShadow:'0 5px 18px #0000000d'},cards:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18},card:{background:'#fff',padding:18,borderRadius:12},grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:14},field:{display:'flex',flexDirection:'column',gap:5,textTransform:'capitalize',fontSize:13,fontWeight:700},input:{padding:11,border:'1px solid #d6cabf',borderRadius:8,font:'inherit',width:'100%',boxSizing:'border-box'},primary:{background:'#8a6129',color:'#fff',border:0,borderRadius:8,padding:'11px 16px',fontWeight:700,cursor:'pointer'},secondary:{background:'#fff',color:'#6b431b',border:'1px solid #b99261',borderRadius:8,padding:'10px 15px',fontWeight:700,cursor:'pointer'},shareBtn:{background:'#1877f2',color:'#fff',border:0,borderRadius:7,padding:'8px 11px',fontWeight:700,cursor:'pointer'},row:{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,padding:'12px 0',borderBottom:'1px solid #eee'},delete:{border:'1px solid #f4b4b4',color:'#b42318',background:'#fff3f3',borderRadius:7,padding:'7px 10px',cursor:'pointer'},toast:{position:'fixed',top:80,right:20,zIndex:20,background:'#211813',color:'#fff',padding:'12px 15px',borderRadius:8},actionRow:{display:'flex',gap:9,alignItems:'center',flexWrap:'wrap'},modalOverlay:{position:'fixed',inset:0,zIndex:50,background:'rgba(0,0,0,.72)',padding:20,overflowY:'auto',display:'flex',justifyContent:'center',alignItems:'flex-start'},studioModal:{width:'min(1180px,100%)',background:'#f7f2ec',borderRadius:18,margin:'20px auto',padding:22,boxShadow:'0 24px 80px rgba(0,0,0,.35)'},studioHead:{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,marginBottom:18},close:{border:0,background:'#2b1b17',color:'#fff',width:40,height:40,borderRadius:10,fontSize:26,cursor:'pointer'},studioGrid:{display:'grid',gridTemplateColumns:'minmax(340px,1.05fr) minmax(300px,.95fr)',gap:24},canvas:{width:'100%',display:'block',background:'#111',borderRadius:12,boxShadow:'0 12px 30px rgba(0,0,0,.22)'},controls:{display:'flex',flexDirection:'column',gap:12},checkRow:{display:'flex',gap:18,flexWrap:'wrap',fontSize:14,fontWeight:700},muted:{color:'#765f54',fontSize:14,marginTop:5},postSettingsBox:{gridColumn:'1 / -1',background:'#fff8ee',border:'1px solid #dec39b',borderRadius:12,padding:16,marginTop:6},postSettingsTitle:{fontSize:17,fontWeight:800,color:'#5c3616',marginBottom:4},postSettingsHint:{fontSize:13,color:'#80664f',marginBottom:14}}
