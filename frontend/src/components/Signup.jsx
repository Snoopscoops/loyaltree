import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import SubscriptionPayment from './SubscriptionPayment'
import logo128 from './logo-128.png'

// Mirrors the backend's branch_price_bracket(). Two branches stay on
// per-branch pricing; the 3-branch package starts only at exactly 3 branches.
function branchBracket(branchCount) {
  const n = Number(branchCount) || 1
  if (n <= 1) return '1'
  if (n === 2) return '2'
  if (n === 3) return '3'
  return '5'
}

function priceFor(planData, branchCount) {
  if (!planData) return null
  const bracket = branchBracket(branchCount)
  return planData.price_tiers?.[bracket] ?? planData.price_month
}

function planHighlights(planData) {
  if (!planData) return []
  const items = []
  if (planData.hybrid_cards) items.push('Hybrid Cards')
  if (planData.gift_cards) items.push('Gift Cards')
  return items
}

const BUSINESS_TYPES = [
  ['spa','🌿 Spa'],['salon','✂️ Salon / Barber'],['fitness','🏋️ Gym / Fitness'],
  ['restaurant','🍽️ Restaurant / Food'],['coffee','☕ Coffee Shop / Café'],
  ['retail','🛍️ Retail / Store'],['clinic','🩺 Clinic / Wellness'],
  ['laundry','🧺 Laundry Shop'],['gas_station','⛽ Gasoline Station'],
  ['car_wash','🚿 Car Wash'],['pharmacy','💊 Pharmacy'],['bakery','🥐 Bakery'],
  ['hotel','🏨 Hotel / Resort'],['other','🏪 Other Business'],
]

function SignaturePad({ value, onChange, onInkChange, captureRef }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const dirtyRef = useRef(false)
  const inkRef = useRef(Boolean(value))
  const lastCommittedRef = useRef(value || '')

  const commitSignature = () => {
    const canvas = canvasRef.current
    if (!canvas || !dirtyRef.current) return
    dirtyRef.current = false
    const dataUrl = canvas.toDataURL('image/png')
    lastCommittedRef.current = dataUrl
    onChange(dataUrl)
  }

  const point = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const start = (e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const p = point(e)
    drawingRef.current = true
    dirtyRef.current = false
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const move = (e) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()

    // If the pointer leaves the signature box while the button/finger is still
    // down, finish the stroke immediately. Do not leave the pad stuck in a
    // drawing state waiting for a pointerup that may happen elsewhere.
    const outside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom
    if (outside) {
      end(e)
      return
    }

    const ctx = canvas.getContext('2d')
    const p = point(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    dirtyRef.current = true
    // A signature is considered present as soon as the first real stroke is
    // drawn. Notify the parent on every drawn segment so React state can never
    // get stuck false even if the canvas survived an agreement reset/remount.
    if (!inkRef.current) inkRef.current = true
    onInkChange?.(true)
  }

  const end = (e) => {
    if (!drawingRef.current) return
    e?.preventDefault?.()
    drawingRef.current = false
    commitSignature()
  }

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    drawingRef.current = false
    dirtyRef.current = false
    inkRef.current = false
    lastCommittedRef.current = ''
    onInkChange?.(false)
    onChange('')
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  useEffect(() => {
    // Some browsers/trackpads can release the pointer outside the canvas.
    // Commit globally so a visible signature can never remain unsaved.
    const finish = () => {
      if (!drawingRef.current) return
      drawingRef.current = false
      commitSignature()
    }
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    window.addEventListener('blur', finish, true)
    return () => {
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      window.removeEventListener('blur', finish, true)
    }
  }, [])

  useEffect(() => {
    if (!captureRef) return
    captureRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas || !inkRef.current) return ''
      return canvas.toDataURL('image/png')
    }
    return () => { captureRef.current = null }
  }, [captureRef])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!value) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawingRef.current = false
      dirtyRef.current = false
      inkRef.current = false
      lastCommittedRef.current = ''
      onInkChange?.(false)
      return
    }

    inkRef.current = true
    onInkChange?.(true)

    // When this value is the snapshot we just emitted ourselves, the pixels
    // are already on this canvas. Skipping a redraw avoids an async image load
    // wiping out the beginning of the owner's next stroke.
    if (value === lastCommittedRef.current) return

    const img = new Image()
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      lastCommittedRef.current = value
    }
    img.src = value
  }, [value])

  return <div style={styles.signatureWrap}>
    <canvas
      ref={canvasRef}
      width={760}
      height={190}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      onPointerOut={end}
      style={styles.signatureCanvas}
      aria-label="Draw your signature"
    />
    <div style={styles.signatureHintRow}>
      <span style={styles.tip}>Start with one stroke to enable signing. You can keep adding as many strokes as you need using your mouse, trackpad, or finger.</span>
      <button type="button" onClick={clear} style={styles.clearSignature}>Clear signature</button>
    </div>
  </div>
}

function Signup({ API_BASE }) {
  const navigate = useNavigate()
  const [wizardStep, setWizardStep] = useState(1)
  const [form, setForm] = useState({
    name:'', email:'', password:'', phone:'', address:'', contact_person:'',
    logo_url:'', business_type:'spa', branch_count:1, plan:'starter',
    setup_kit_requested:false, kit_recipient_name:'', kit_contact_number:'',
    kit_delivery_address:'', kit_delivery_instructions:'', partner_code:''
  })
  const [agreement, setAgreement] = useState({
    signer_name:'', signer_title:'', signature_data_url:'',
    authority_confirmed:false, agreement_confirmed:false, policies_acknowledged:false,
  })
  const [agreementDoc, setAgreementDoc] = useState(null)
  const [agreementLoading, setAgreementLoading] = useState(false)
  const [agreementRead, setAgreementRead] = useState(false)
  const [signatureHasInk, setSignatureHasInk] = useState(false)
  const signatureCaptureRef = useRef(null)
  const [plans,setPlans]=useState(null)
  const [logoUpload,setLogoUpload]=useState({uploading:false,error:''})
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const [businessSlug,setBusinessSlug]=useState('')
  const [registered,setRegistered]=useState(false)

  useEffect(()=>{ fetch(`${API_BASE}/api/v1/plans`).then(r=>r.json()).then(setPlans).catch(()=>{}) },[API_BASE])
  const handleChange=e=>setForm(f=>({...f,[e.target.name]:e.target.value}))
  const branchCount=Number(form.branch_count)||1
  const selectedPlanData=plans?.[form.plan]
  const selectedExceedsCap=selectedPlanData?.max_branches!=null && branchCount>selectedPlanData.max_branches
  const selectedPrice=priceFor(selectedPlanData,branchCount)
  const kitTotal=form.setup_kit_requested ? 150 * branchCount : 0

  const handleLogoUpload=async(file)=>{
    if(!file)return
    if(!file.type.startsWith('image/'))return setLogoUpload({uploading:false,error:'Please choose an image file.'})
    if(file.size>8*1024*1024)return setLogoUpload({uploading:false,error:'Logo must be under 8MB.'})
    setLogoUpload({uploading:true,error:''})
    try{
      const sigRes=await fetch(`${API_BASE}/api/v1/signup/cloudinary-signature`,{method:'POST'}); const sig=await sigRes.json()
      if(!sigRes.ok)throw new Error(sig.detail||'Could not start logo upload')
      const body=new FormData(); body.append('file',file); body.append('api_key',sig.api_key); body.append('timestamp',sig.timestamp); body.append('signature',sig.signature); body.append('upload_preset',sig.upload_preset); body.append('folder',sig.folder)
      const upRes=await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`,{method:'POST',body}); const uploaded=await upRes.json()
      if(!upRes.ok||!uploaded.secure_url)throw new Error(uploaded?.error?.message||'Logo upload failed')
      setForm(f=>({...f,logo_url:uploaded.secure_url})); setLogoUpload({uploading:false,error:''})
    }catch(err){setLogoUpload({uploading:false,error:err.message||'Logo upload failed'})}
  }

  const validateStep=()=>{
    setError('')
    if(wizardStep===1 && (!form.email.trim()||form.password.length<8)) return setError('Enter a valid email and a password with at least 8 characters.'),false
    if(wizardStep===2 && (!form.name.trim()||!form.contact_person.trim()||!form.phone.trim()||!form.address.trim())) return setError('Complete the required business profile details.'),false
    if(wizardStep===3 && !form.logo_url) return setError('Please upload your business logo to continue.'),false
    if(wizardStep===4){
      if(selectedExceedsCap)return setError('Your selected plan does not support this number of branches.'),false
      if(form.setup_kit_requested && (!form.kit_recipient_name.trim()||!form.kit_contact_number.trim()||!form.kit_delivery_address.trim())) return setError('Complete the PR Kit delivery information.'),false
    }
    return true
  }

  const loadAgreement=async()=>{
    setAgreementLoading(true); setAgreementDoc(null); setAgreementRead(false); setSignatureHasInk(false); setError('')
    // A changed/reloaded document must be signed again; never carry a signature
    // or confirmations forward onto a newly generated agreement hash.
    setAgreement(a=>({
      ...a, signer_name:a.signer_name||form.contact_person||'', signature_data_url:'',
      authority_confirmed:false, agreement_confirmed:false, policies_acknowledged:false,
    }))
    try{
      const res=await fetch(`${API_BASE}/api/v1/legal/signup-agreement/preview`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          name:form.name,email:form.email,phone:form.phone,address:form.address,
          contact_person:form.contact_person,plan:form.plan,branch_count:branchCount,
          setup_kit_requested:Boolean(form.setup_kit_requested),
        })
      })
      const data=await res.json()
      if(!res.ok)throw new Error(data.detail||'Could not load the agreement')
      setAgreementDoc(data)
    }catch(err){setError(err.message||'Could not load the agreement')}
    finally{setAgreementLoading(false)}
  }

  useEffect(()=>{ if(wizardStep===5) loadAgreement() },[wizardStep])

  const next=()=>{
    if(!validateStep())return
    setWizardStep(s=>Math.min(6,s+1))
  }
  const back=()=>{setError('');setWizardStep(s=>Math.max(1,s-1))}

  const agreementMissing = [
    !agreementDoc && 'Agreement document is still loading',
    !agreementRead && 'Review the agreement to the end',
    !agreement.signer_name.trim() && 'Enter the signer’s full legal name',
    !agreement.signer_title.trim() && 'Enter the signer’s position / title',
    !signatureHasInk && 'Draw your signature',
    !agreement.authority_confirmed && 'Confirm signing authority',
    !agreement.agreement_confirmed && 'Accept the Business Agreement + DPA',
    !agreement.policies_acknowledged && 'Acknowledge the Terms + Privacy Policy',
  ].filter(Boolean)
  const agreementReady = agreementMissing.length === 0

  const createAccount=async()=>{
    if(registered)return true
    if(!agreementReady){setError(`Complete before signing: ${agreementMissing.join(' · ')}`);return false}
    const capturedSignature = signatureCaptureRef.current?.() || agreement.signature_data_url
    if(!capturedSignature){
      setSignatureHasInk(false)
      setError('Please draw your signature again before continuing.')
      return false
    }
    setAgreement(a=>({...a,signature_data_url:capturedSignature}))
    setLoading(true);setError('')
    try{
      const res=await fetch(`${API_BASE}/api/v1/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        ...form,branch_count:branchCount,setup_kit_requested:Boolean(form.setup_kit_requested),
        agreement:{
          ...agreement,
          signature_data_url:capturedSignature,
          agreement_version:agreementDoc.agreement_version,
          terms_version:agreementDoc.terms_version,
          privacy_version:agreementDoc.privacy_version,
          dpa_version:agreementDoc.dpa_version,
          agreement_sha256:agreementDoc.agreement_sha256,
        }
      })})
      const data=await res.json()
      if(!res.ok)throw new Error(data.detail||'Signup failed')
      setBusinessSlug(data.business_slug); setRegistered(true)
      localStorage.setItem('loyaltree_pending_onboarding',JSON.stringify({business_slug:data.business_slug,contact_person:form.contact_person,started_at:new Date().toISOString()}))
      setWizardStep(6)
      return true
    }catch(err){
      const msg=err.message||'Network error'
      setError(msg)
      if(msg.toLowerCase().includes('agreement details changed')) loadAgreement()
      return false
    }finally{setLoading(false)}
  }

  const steps=['Apply','Business Profile','Logo','Plan + PR Kit','Review + Sign','Pay']
  return <div style={styles.page}><style>{`@media(max-width:720px){.lt-signup-shell{grid-template-columns:1fr!important}.lt-signup-side{display:none!important}.lt-signup-main{padding:28px 20px!important}.lt-signup-two{grid-template-columns:1fr!important}.lt-signup-plans{grid-template-columns:1fr!important}.lt-agreement-summary{grid-template-columns:1fr!important}}`}</style><div className="lt-signup-shell" style={styles.shell}>
    <aside className="lt-signup-side" style={styles.sidebar}>
      <img src={logo128} alt="LoyaltyTree" style={styles.logo}/><div style={styles.brand}>LoyaltyTree</div>
      <h2 style={styles.sideTitle}>Set up your business</h2><p style={styles.sideCopy}>A guided setup that gets your loyalty program ready and records your business agreement before payment.</p>
      <div style={styles.stepList}>{steps.map((label,i)=>{const n=i+1,active=n===wizardStep,done=n<wizardStep;return <div key={label} style={{...styles.stepItem,...(active?styles.stepActive:{})}}><span style={{...styles.stepDot,...(done?styles.stepDone:{}),...(active?styles.stepDotActive:{})}}>{done?'✓':n}</span><span>{label}</span></div>})}</div>
    </aside>
    <main className="lt-signup-main" style={styles.main}>
      <div style={styles.mobileProgress}>Step {wizardStep} of 6 · {steps[wizardStep-1]}</div>
      {wizardStep===1&&<section><p style={styles.eyebrow}>1 · APPLY</p><h1 style={styles.title}>Start your LoyaltyTree</h1><p style={styles.subtitle}>Create the account you’ll use to manage your business.</p>
        <Field label="Business email"><input name="email" type="email" value={form.email} onChange={handleChange} style={styles.input} placeholder="you@business.com"/></Field>
        <Field label="Password"><input name="password" type="password" minLength={8} value={form.password} onChange={handleChange} style={styles.input} placeholder="Minimum 8 characters"/></Field>
        <Field label="LoyaltyTree Partner Code (optional)"><input name="partner_code" value={form.partner_code} onChange={e=>setForm({...form,partner_code:e.target.value.toUpperCase()})} style={styles.input} placeholder="e.g. LT-CAUAYAN"/></Field>
      </section>}
      {wizardStep===2&&<section><p style={styles.eyebrow}>2 · BUSINESS PROFILE</p><h1 style={styles.title}>Tell us about your business</h1><p style={styles.subtitle}>These details become your business profile and will also appear in the agreement you review before registration.</p>
        <div className="lt-signup-two" style={styles.twoCol}><Field label="Business name"><input name="name" value={form.name} onChange={handleChange} style={styles.input}/></Field><Field label="Primary contact person"><input name="contact_person" value={form.contact_person} onChange={handleChange} style={styles.input} placeholder="Owner / manager name"/></Field></div>
        <div className="lt-signup-two" style={styles.twoCol}><Field label="Mobile number"><input name="phone" value={form.phone} onChange={handleChange} style={styles.input} placeholder="09XXXXXXXXX"/></Field><Field label="Industry"><select name="business_type" value={form.business_type} onChange={handleChange} style={styles.input}>{BUSINESS_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field></div>
        <Field label="Business address"><textarea name="address" value={form.address} onChange={handleChange} style={{...styles.input,minHeight:82,resize:'vertical'}} placeholder="Complete business address"/></Field>
        <Field label="Number of branches"><input name="branch_count" type="number" min="1" max="5" value={form.branch_count} onChange={handleChange} style={styles.input}/><small style={styles.tip}>Self-serve onboarding supports up to 5 branches.</small></Field>
      </section>}
      {wizardStep===3&&<section><p style={styles.eyebrow}>3 · BRAND</p><h1 style={styles.title}>Upload your logo</h1><p style={styles.subtitle}>Your logo will appear throughout your LoyaltyTree experience and helps us prepare your PR Kit.</p>
        <label style={styles.uploadBox}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>handleLogoUpload(e.target.files?.[0])} style={{display:'none'}}/>{form.logo_url?<><img src={form.logo_url} alt="Business logo" style={styles.logoPreview}/><strong>Logo uploaded</strong><span>Click to replace</span></>:<><div style={{fontSize:42}}>🖼️</div><strong>Choose your business logo</strong><span>PNG, JPG or WebP · maximum 8MB</span></>}</label>{logoUpload.uploading&&<p style={styles.tip}>Uploading…</p>}{logoUpload.error&&<div style={styles.error}>{logoUpload.error}</div>}
      </section>}
      {wizardStep===4&&<section><p style={styles.eyebrow}>4 · PLAN + PR KIT</p><h1 style={styles.title}>Choose how you’ll launch</h1><p style={styles.subtitle}>Select your monthly plan. The exact plan, branch count, subscription price, and optional PR Kit total will appear in the agreement you sign next.</p>
        <div className="lt-signup-plans" style={styles.planGrid}>{plans&&Object.entries(plans).map(([key,p])=>{const price=priceFor(p,branchCount),selected=form.plan===key,cap=p.max_branches!=null&&branchCount>p.max_branches,highlights=planHighlights(p);return <button type="button" key={key} onClick={()=>setForm({...form,plan:key})} style={{...styles.planCard,...(selected?styles.planSelected:{})}}><b>{p.label}</b><strong>₱{price?.toLocaleString()}<small>/mo</small></strong>{highlights.length>0&&<span style={styles.planIncludes}>Includes {highlights.join(' + ')}</span>}{key==='growth'&&<span style={styles.planBadge}>MOST POPULAR</span>}{cap&&<span style={styles.warning}>Up to {p.max_branches} branch(es)</span>}</button>})}</div>
        <label style={{...styles.kitCard,...(form.setup_kit_requested?styles.kitSelected:{})}}><input type="checkbox" checked={form.setup_kit_requested} onChange={e=>setForm({...form,setup_kit_requested:e.target.checked})}/><div><strong>Add Physical QR / PR Kit · ₱150 per branch one-time</strong><p>{form.setup_kit_requested ? `For ${branchCount} branch${branchCount===1?'':'es'}: ₱${kitTotal.toLocaleString()} total.` : 'Sintra board QR display prepared per branch and delivered after payment confirmation.'}</p></div></label>
        {form.setup_kit_requested&&<div style={styles.delivery}><div className="lt-signup-two" style={styles.twoCol}><Field label="Recipient"><input name="kit_recipient_name" value={form.kit_recipient_name} onChange={handleChange} style={styles.input}/></Field><Field label="Contact number"><input name="kit_contact_number" value={form.kit_contact_number} onChange={handleChange} style={styles.input}/></Field></div><Field label="Delivery address"><textarea name="kit_delivery_address" value={form.kit_delivery_address} onChange={handleChange} style={{...styles.input,minHeight:70}}/></Field><Field label="Instructions (optional)"><input name="kit_delivery_instructions" value={form.kit_delivery_instructions} onChange={handleChange} style={styles.input}/></Field></div>}
        <div style={styles.priceDisclosure}><strong>Agreement preview</strong><span>Subscription: ₱{Number(selectedPrice||0).toLocaleString()}/30-day subscription period</span>{kitTotal>0&&<span>PR Kit: ₱{kitTotal.toLocaleString()} one-time</span>}</div>
      </section>}
      {wizardStep===5&&<section><p style={styles.eyebrow}>5 · REVIEW + SIGN</p><h1 style={styles.title}>Review your LoyaltyTree agreement</h1><p style={styles.subtitle}>Review the Business Subscription & Data Processing Agreement below. The account will not be created until an authorized representative signs it.</p>
        <div style={styles.paymentNextNotice}><strong>Signing does not charge you.</strong><span>Payment is the next step. After the agreement is signed and recorded, you’ll continue to Pay & Activate.</span></div>
        {agreementLoading&&<div style={styles.loadingBox}>Preparing your agreement…</div>}
        {!agreementLoading&&agreementDoc&&<>
          <div className="lt-agreement-summary" style={styles.agreementSummary}>
            <Summary label="Business" value={form.name}/><Summary label="Plan" value={agreementDoc.plan_label}/><Summary label="Branches" value={String(branchCount)}/><Summary label="Subscription" value={`₱${Number(agreementDoc.price_month||0).toLocaleString()} / 30 days`}/>{agreementDoc.setup_kit_amount>0&&<Summary label="PR Kit" value={`₱${Number(agreementDoc.setup_kit_amount).toLocaleString()} one-time`}/>}<Summary label="Agreement version" value={agreementDoc.agreement_version}/>
          </div>
          <div style={styles.paperHeader}><strong>{agreementDoc.title}</strong><span>{agreementDoc.operator?.name}</span><small>{agreementDoc.operator?.location} · {agreementDoc.operator?.phone} · {agreementDoc.operator?.email}</small></div>
          <div style={styles.paper} onScroll={e=>{const el=e.currentTarget;if(el.scrollTop+el.clientHeight>=el.scrollHeight-32)setAgreementRead(true)}}>
            <div style={styles.contractIntro}>{agreementDoc.intro}</div>
            {agreementDoc.sections?.map((section,i)=><article key={section.title} style={styles.contractSection}><h3>{i+1}. {section.title}</h3>{section.paragraphs?.map((p,j)=><p key={j}>{p}</p>)}</article>)}
            <div style={styles.annexTitle}>ANNEX A — DATA PROCESSING ADDENDUM</div>
            {agreementDoc.dpa_sections?.map((section,i)=><article key={section.title} style={styles.contractSection}><h3>A{i+1}. {section.title}</h3>{section.paragraphs?.map((p,j)=><p key={j}>{p}</p>)}</article>)}
            <div style={styles.contractEnd}>END OF AGREEMENT · Document hash: {agreementDoc.agreement_sha256}</div>
          </div>
          <div style={{...styles.readStatus,...(agreementRead?styles.readStatusDone:{})}}>{agreementRead?'✓ Agreement reviewed to the end':'Scroll through the agreement to the end before signing.'}</div>
          <div style={styles.signerBox}>
            <h2 style={styles.signerTitle}>Electronic Signature</h2>
            <p style={styles.signerCopy}>The person signing confirms that they are authorized to enter into this agreement for the business.</p>
            <div className="lt-signup-two" style={styles.twoCol}><Field label="Authorized representative · full legal name"><input value={agreement.signer_name} onChange={e=>setAgreement(a=>({...a,signer_name:e.target.value}))} style={styles.input} placeholder="Full legal name"/></Field><Field label="Position / title"><input value={agreement.signer_title} onChange={e=>setAgreement(a=>({...a,signer_title:e.target.value}))} style={styles.input} placeholder="Owner, President, Manager, etc."/></Field></div>
            <Field label="Draw signature"><SignaturePad value={agreement.signature_data_url} onChange={v=>setAgreement(a=>({...a,signature_data_url:v}))} onInkChange={setSignatureHasInk} captureRef={signatureCaptureRef}/>{signatureHasInk&&<small style={styles.signatureCaptured}>✓ Signature detected and ready to capture</small>}</Field>
            <div style={styles.checks}>
              <Check checked={agreement.authority_confirmed} onChange={v=>setAgreement(a=>({...a,authority_confirmed:v}))}>I represent that I am authorized to enter into this agreement on behalf of the business.</Check>
              <Check checked={agreement.agreement_confirmed} onChange={v=>setAgreement(a=>({...a,agreement_confirmed:v}))}>I have reviewed and agree to the Business Subscription Agreement and Data Processing Addendum above.</Check>
              <Check checked={agreement.policies_acknowledged} onChange={v=>setAgreement(a=>({...a,policies_acknowledged:v}))}>I acknowledge the <a href="/terms" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</Check>
            </div>
            <div style={{...styles.signingStatus,...(agreementReady?styles.signingStatusReady:{})}}>
              {agreementReady ? <><strong>✓ Ready to sign</strong><span>Your agreement is complete. Clicking below records the agreement and continues to payment. You will not be charged yet.</span></> : <><strong>Complete before signing</strong><span>{agreementMissing.join(' · ')}</span></>}
            </div>
            <button type="button" onClick={createAccount} disabled={!agreementReady||loading} style={{...styles.primary,...((!agreementReady||loading)?styles.disabled:{})}}>{loading?'Recording signed agreement…':'Sign Agreement & Continue to Payment →'}</button>
          </div>
        </>}
      </section>}
      {wizardStep===6&&<section><p style={styles.eyebrow}>6 · PAYMENT</p><h1 style={styles.title}>Activate your business</h1><p style={styles.subtitle}>Your signed agreement has been recorded. Complete your payment to activate the business, then sign in and continue the LoyaltyTree onboarding guide.</p>
        {loading?<div style={styles.loadingBox}>Creating your business account…</div>:businessSlug?<SubscriptionPayment API_BASE={API_BASE} businessSlug={businessSlug} title="Pay & Activate" subtitle={form.setup_kit_requested?`Your total includes your selected plan plus ₱${kitTotal.toLocaleString()} for the PR Kit (${branchCount} × ₱150).`:'Pay your selected monthly plan to activate your business.'} successMessage="🎉 Payment received — your business is active!" onPaid={()=>{localStorage.setItem('loyaltree_continue_onboarding','1');navigate('/login?onboarding=1')}}/>:<div style={styles.error}>The account was not created. Go back to Review + Sign and try again.</div>}
      </section>}
      {error&&<div style={styles.error}>{error}</div>}
      {wizardStep<5&&<div style={styles.actions}>{wizardStep>1?<button type="button" onClick={back} style={styles.secondary}>← Back</button>:<span/>}<button type="button" onClick={next} disabled={logoUpload.uploading} style={styles.primary}>Continue →</button></div>}
      {wizardStep===5&&<div style={styles.actions}><button type="button" onClick={back} disabled={loading} style={styles.secondary}>← Back</button><span/></div>}
      <p style={styles.footer}>Already have an account? <Link to="/login" style={{color:'#0f766e',fontWeight:800}}>Sign in</Link></p>
    </main>
  </div></div>
}

function Field({label,children}){return <label style={styles.field}><span style={styles.label}>{label}</span>{children}</label>}
function Summary({label,value}){return <div style={styles.summaryItem}><span>{label}</span><strong>{value}</strong></div>}
function Check({checked,onChange,children}){return <label style={styles.checkRow}><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span>{children}</span></label>}

const styles={
 page:{minHeight:'100vh',background:'#f1f5f9',padding:24,boxSizing:'border-box',fontFamily:'Inter,system-ui,sans-serif'},shell:{maxWidth:1120,margin:'0 auto',background:'#fff',borderRadius:24,boxShadow:'0 24px 70px rgba(15,23,42,.12)',display:'grid',gridTemplateColumns:'300px minmax(0,1fr)',overflow:'hidden'},sidebar:{background:'linear-gradient(160deg,#0f766e,#134e4a)',color:'#fff',padding:'38px 30px'},logo:{width:56,height:56,borderRadius:'50%'},brand:{fontWeight:900,fontSize:18,marginTop:10},sideTitle:{fontSize:28,lineHeight:1.1,margin:'34px 0 10px'},sideCopy:{fontSize:14,lineHeight:1.6,opacity:.82},stepList:{display:'grid',gap:8,marginTop:26},stepItem:{display:'flex',alignItems:'center',gap:11,padding:'9px 11px',borderRadius:12,fontSize:13.5,fontWeight:700,opacity:.72},stepActive:{background:'rgba(255,255,255,.13)',opacity:1},stepDot:{width:27,height:27,borderRadius:'50%',border:'1px solid rgba(255,255,255,.45)',display:'grid',placeItems:'center',fontSize:12,flexShrink:0},stepDone:{background:'#fff',color:'#0f766e'},stepDotActive:{border:'2px solid #fff'},main:{padding:'44px 48px',minWidth:0},mobileProgress:{fontSize:12,fontWeight:900,color:'#0f766e',textTransform:'uppercase',letterSpacing:.5,marginBottom:18},eyebrow:{fontSize:12,fontWeight:900,color:'#0d9488',letterSpacing:.8,margin:'0 0 7px'},title:{fontSize:31,color:'#0f172a',margin:'0 0 8px',letterSpacing:'-.7px'},subtitle:{color:'#64748b',fontSize:15,lineHeight:1.55,margin:'0 0 26px'},field:{display:'flex',flexDirection:'column',gap:7,marginBottom:16},label:{fontSize:13,fontWeight:750,color:'#334155'},input:{width:'100%',boxSizing:'border-box',padding:'13px 14px',border:'1.5px solid #dbe3ec',borderRadius:11,fontSize:15,fontFamily:'inherit',background:'#fff'},twoCol:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14},tip:{color:'#64748b',fontSize:11.5,lineHeight:1.4},uploadBox:{minHeight:260,border:'2px dashed #99f6e4',background:'#f0fdfa',borderRadius:18,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,cursor:'pointer',color:'#0f766e',textAlign:'center',padding:24},logoPreview:{width:120,height:120,objectFit:'contain',borderRadius:18,background:'#fff',border:'1px solid #dbe3ec',padding:8},planGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:18},planCard:{border:'1.5px solid #e2e8f0',background:'#fff',borderRadius:14,padding:16,display:'flex',flexDirection:'column',gap:7,cursor:'pointer',color:'#334155'},planSelected:{border:'2px solid #0d9488',background:'#f0fdfa'},planIncludes:{fontSize:10.5,lineHeight:1.35,color:'#0f766e',fontWeight:800},planBadge:{alignSelf:'flex-start',fontSize:9,fontWeight:900,letterSpacing:'.06em',color:'#047857',background:'#d1fae5',padding:'4px 7px',borderRadius:999},warning:{fontSize:10,color:'#d97706'},kitCard:{display:'flex',gap:12,alignItems:'flex-start',border:'1.5px solid #e2e8f0',borderRadius:14,padding:16,cursor:'pointer'},kitSelected:{borderColor:'#0d9488',background:'#f0fdfa'},delivery:{marginTop:16,padding:16,borderRadius:14,background:'#f8fafc',border:'1px solid #e2e8f0'},priceDisclosure:{display:'flex',flexWrap:'wrap',gap:'8px 16px',marginTop:16,padding:'13px 15px',borderRadius:12,background:'#f8fafc',border:'1px solid #e2e8f0',fontSize:12.5,color:'#475569'},actions:{display:'flex',justifyContent:'space-between',gap:12,marginTop:24},primary:{border:0,borderRadius:11,padding:'13px 20px',background:'linear-gradient(135deg,#0d9488,#0f766e)',color:'#fff',fontWeight:800,fontSize:15,cursor:'pointer'},disabled:{opacity:.45,cursor:'not-allowed'},secondary:{border:'1.5px solid #dbe3ec',borderRadius:11,padding:'13px 20px',background:'#fff',color:'#475569',fontWeight:800,fontSize:15,cursor:'pointer'},error:{marginTop:16,padding:'12px 14px',background:'#fef2f2',color:'#dc2626',borderRadius:10,fontSize:13},loadingBox:{padding:30,textAlign:'center',borderRadius:14,background:'#f8fafc',color:'#64748b'},footer:{textAlign:'center',fontSize:13,color:'#64748b',margin:'28px 0 0'},
 agreementSummary:{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,marginBottom:16},paymentNextNotice:{display:'flex',flexDirection:'column',gap:4,padding:'12px 14px',margin:'-10px 0 18px',border:'1px solid #99f6e4',borderRadius:12,background:'#f0fdfa',color:'#115e59',fontSize:12.5,lineHeight:1.5},summaryItem:{border:'1px solid #e2e8f0',borderRadius:12,padding:'11px 12px',background:'#f8fafc',display:'flex',flexDirection:'column',gap:4,fontSize:11,color:'#64748b'},paperHeader:{display:'flex',flexDirection:'column',gap:3,padding:'18px 20px',border:'1px solid #cbd5e1',borderBottom:0,borderRadius:'14px 14px 0 0',background:'#fff',textAlign:'center',color:'#0f172a'},paper:{height:480,overflowY:'auto',border:'1px solid #cbd5e1',background:'#fff',padding:'32px clamp(20px,5vw,46px)',boxShadow:'inset 0 1px 0 #fff',fontFamily:'Georgia,Times New Roman,serif',color:'#1e293b',lineHeight:1.7},contractIntro:{fontSize:15,marginBottom:24,fontWeight:600},contractSection:{marginBottom:26},contractSectionH3:{fontSize:16},annexTitle:{margin:'34px 0 22px',paddingTop:26,borderTop:'2px solid #0f172a',fontWeight:900,letterSpacing:'.04em',fontFamily:'Inter,system-ui,sans-serif'},contractEnd:{marginTop:30,paddingTop:18,borderTop:'1px solid #cbd5e1',fontSize:10,color:'#64748b',wordBreak:'break-all'},readStatus:{padding:'10px 12px',border:'1px solid #fcd34d',borderTop:0,borderRadius:'0 0 12px 12px',background:'#fffbeb',color:'#92400e',fontSize:12.5,fontWeight:700},readStatusDone:{background:'#ecfdf5',borderColor:'#a7f3d0',color:'#047857'},signerBox:{marginTop:22,padding:20,border:'1px solid #dbe3ec',borderRadius:16,background:'#f8fafc'},signingStatus:{display:'flex',flexDirection:'column',gap:3,margin:'4px 0 14px',padding:'10px 12px',border:'1px solid #fecaca',borderRadius:10,background:'#fff7f7',color:'#991b1b',fontSize:11.5,lineHeight:1.45},signingStatusReady:{borderColor:'#a7f3d0',background:'#ecfdf5',color:'#047857'},signatureCaptured:{display:'block',marginTop:6,color:'#047857',fontWeight:800,fontSize:11.5},signerTitle:{fontSize:19,margin:'0 0 5px'},signerCopy:{fontSize:13,color:'#64748b',margin:'0 0 18px'},signatureWrap:{width:'100%'},signatureCanvas:{display:'block',width:'100%',height:170,border:'1.5px dashed #94a3b8',borderRadius:12,background:'#fff',touchAction:'none',cursor:'crosshair'},signatureHintRow:{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center',marginTop:7},clearSignature:{border:0,background:'transparent',color:'#0f766e',fontSize:11.5,fontWeight:800,cursor:'pointer'},checks:{display:'grid',gap:10,margin:'16px 0'},checkRow:{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 11px',borderRadius:10,background:'#fff',border:'1px solid #e2e8f0',fontSize:12.5,lineHeight:1.5,color:'#334155'},
}

export default Signup
