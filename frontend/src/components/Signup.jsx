import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import SubscriptionPayment from './SubscriptionPayment'
import logo128 from './logo-128.png'

// Mirrors the backend's branch_price_bracket() - price scales with branch
// count independently of which plan (feature tier) is chosen.
function branchBracket(branchCount) {
  const n = Number(branchCount) || 1
  if (n <= 1) return '1'
  if (n <= 3) return '2-3'
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

const BUSINESS_RECOMMENDATIONS = {
  laundry:'Great with Stamps or Points for repeat wash-and-fold customers.',
  gas_station:'Points and VIP work well for frequent motorists and fleet customers.',
  fitness:'Membership or Multipass is usually the best fit for gyms.',
  coffee:'Stamps are ideal for frequent café visits; Points work well for spend-based rewards.',
  salon:'VIP, Stamps and Points work well for repeat appointments.',
  restaurant:'Stamps or Points are strong choices for repeat diners.',
  clinic:'Membership and Multipass work well for recurring wellness services.',
  car_wash:'Stamps and Multipass work well for repeat washes.',
  retail:'Points is usually the strongest choice for spend-based retail rewards.',
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
  const next=()=>{ if(validateStep())setWizardStep(s=>Math.min(5,s+1)) }
  const back=()=>{setError('');setWizardStep(s=>Math.max(1,s-1))}

  const createAccount=async()=>{
    if(registered)return true
    setLoading(true);setError('')
    try{
      const res=await fetch(`${API_BASE}/api/v1/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,branch_count:branchCount,setup_kit_requested:Boolean(form.setup_kit_requested)})})
      const data=await res.json()
      if(!res.ok)throw new Error(data.detail||'Signup failed')
      setBusinessSlug(data.business_slug); setRegistered(true)
      localStorage.setItem('loyaltree_pending_onboarding',JSON.stringify({business_slug:data.business_slug,contact_person:form.contact_person,started_at:new Date().toISOString()}))
      return true
    }catch(err){setError(err.message||'Network error');return false}finally{setLoading(false)}
  }
  useEffect(()=>{ if(wizardStep===5 && !registered) createAccount() },[wizardStep])

  const steps=['Apply','Business Profile','Logo','Plan + PR Kit','Pay']
  return <div style={styles.page}><style>{`@media(max-width:720px){.lt-signup-shell{grid-template-columns:1fr!important}.lt-signup-side{display:none!important}.lt-signup-main{padding:28px 20px!important}.lt-signup-two{grid-template-columns:1fr!important}.lt-signup-plans{grid-template-columns:1fr!important}}`}</style><div className="lt-signup-shell" style={styles.shell}>
    <aside className="lt-signup-side" style={styles.sidebar}>
      <img src={logo128} alt="LoyaltyTree" style={styles.logo}/><div style={styles.brand}>LoyaltyTree</div>
      <h2 style={styles.sideTitle}>Set up your business</h2><p style={styles.sideCopy}>A guided setup that gets your loyalty program ready without a long signup form.</p>
      <div style={styles.stepList}>{steps.map((label,i)=>{const n=i+1,active=n===wizardStep,done=n<wizardStep;return <div key={label} style={{...styles.stepItem,...(active?styles.stepActive:{})}}><span style={{...styles.stepDot,...(done?styles.stepDone:{}),...(active?styles.stepDotActive:{})}}>{done?'✓':n}</span><span>{label}</span></div>})}</div>
    </aside>
    <main className="lt-signup-main" style={styles.main}>
      <div style={styles.mobileProgress}>Step {wizardStep} of 5 · {steps[wizardStep-1]}</div>
      {wizardStep===1&&<section><p style={styles.eyebrow}>1 · APPLY</p><h1 style={styles.title}>Start your LoyaltyTree</h1><p style={styles.subtitle}>Create the account you’ll use to manage your business.</p>
        <Field label="Business email"><input name="email" type="email" value={form.email} onChange={handleChange} style={styles.input} placeholder="you@business.com"/></Field>
        <Field label="Password"><input name="password" type="password" minLength={8} value={form.password} onChange={handleChange} style={styles.input} placeholder="Minimum 8 characters"/></Field>
        <Field label="LoyaltyTree Partner Code (optional)"><input name="partner_code" value={form.partner_code} onChange={e=>setForm({...form,partner_code:e.target.value.toUpperCase()})} style={styles.input} placeholder="e.g. LT-CAUAYAN"/></Field>
      </section>}
      {wizardStep===2&&<section><p style={styles.eyebrow}>2 · BUSINESS PROFILE</p><h1 style={styles.title}>Tell us about your business</h1><p style={styles.subtitle}>These details become your business profile and help LoyaltyTree support your account.</p>
        <div className="lt-signup-two" style={styles.twoCol}><Field label="Business name"><input name="name" value={form.name} onChange={handleChange} style={styles.input}/></Field><Field label="Contact person"><input name="contact_person" value={form.contact_person} onChange={handleChange} style={styles.input} placeholder="Owner / manager name"/></Field></div>
        <div className="lt-signup-two" style={styles.twoCol}><Field label="Mobile number"><input name="phone" value={form.phone} onChange={handleChange} style={styles.input} placeholder="09XXXXXXXXX"/></Field><Field label="Industry"><select name="business_type" value={form.business_type} onChange={handleChange} style={styles.input}>{BUSINESS_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field></div>
        <Field label="Business address"><textarea name="address" value={form.address} onChange={handleChange} style={{...styles.input,minHeight:82,resize:'vertical'}} placeholder="Complete business address"/></Field>
        <Field label="Number of branches"><input name="branch_count" type="number" min="1" max="5" value={form.branch_count} onChange={handleChange} style={styles.input}/><small style={styles.tip}>Self-serve onboarding supports up to 5 branches.</small></Field>
      </section>}
      {wizardStep===3&&<section><p style={styles.eyebrow}>3 · BRAND</p><h1 style={styles.title}>Upload your logo</h1><p style={styles.subtitle}>Your logo will appear throughout your LoyaltyTree experience and helps us prepare your PR Kit.</p>
        <label style={styles.uploadBox}><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>handleLogoUpload(e.target.files?.[0])} style={{display:'none'}}/>{form.logo_url?<><img src={form.logo_url} style={styles.logoPreview}/><strong>Logo uploaded</strong><span>Click to replace</span></>:<><div style={{fontSize:42}}>🖼️</div><strong>Choose your business logo</strong><span>PNG, JPG or WebP · maximum 8MB</span></>}</label>{logoUpload.uploading&&<p style={styles.tip}>Uploading…</p>}{logoUpload.error&&<div style={styles.error}>{logoUpload.error}</div>}
      </section>}
      {wizardStep===4&&<section><p style={styles.eyebrow}>4 · PLAN + PR KIT</p><h1 style={styles.title}>Choose how you’ll launch</h1><p style={styles.subtitle}>Select your monthly plan. Growth starts at ₱550/month for 1 branch and includes Hybrid Cards + Gift Cards. You can also add a physical LoyaltyTree QR / PR Kit.</p>
        <div className="lt-signup-plans" style={styles.planGrid}>{plans&&Object.entries(plans).map(([key,p])=>{const price=priceFor(p,branchCount),selected=form.plan===key,cap=p.max_branches!=null&&branchCount>p.max_branches,highlights=planHighlights(p);return <button type="button" key={key} onClick={()=>setForm({...form,plan:key})} style={{...styles.planCard,...(selected?styles.planSelected:{})}}><b>{p.label}</b><strong>₱{price?.toLocaleString()}<small>/mo</small></strong>{highlights.length>0&&<span style={styles.planIncludes}>Includes {highlights.join(' + ')}</span>}{key==='growth'&&<span style={styles.planBadge}>MOST POPULAR</span>}{cap&&<span style={styles.warning}>Up to {p.max_branches} branch(es)</span>}</button>})}</div>
        <label style={{...styles.kitCard,...(form.setup_kit_requested?styles.kitSelected:{})}}><input type="checkbox" checked={form.setup_kit_requested} onChange={e=>setForm({...form,setup_kit_requested:e.target.checked})}/><div><strong>Add Physical QR / PR Kit · ₱150 one-time</strong><p>Sintra board QR display delivered after payment confirmation.</p></div></label>
        {form.setup_kit_requested&&<div style={styles.delivery}><div className="lt-signup-two" style={styles.twoCol}><Field label="Recipient"><input name="kit_recipient_name" value={form.kit_recipient_name} onChange={handleChange} style={styles.input}/></Field><Field label="Contact number"><input name="kit_contact_number" value={form.kit_contact_number} onChange={handleChange} style={styles.input}/></Field></div><Field label="Delivery address"><textarea name="kit_delivery_address" value={form.kit_delivery_address} onChange={handleChange} style={{...styles.input,minHeight:70}}/></Field><Field label="Instructions (optional)"><input name="kit_delivery_instructions" value={form.kit_delivery_instructions} onChange={handleChange} style={styles.input}/></Field></div>}
      </section>}
      {wizardStep===5&&<section><p style={styles.eyebrow}>5 · PAYMENT</p><h1 style={styles.title}>Activate your business</h1><p style={styles.subtitle}>Complete your payment. After payment, sign in and LoyaltyTree will guide you through card configuration, cashier setup, dashboard and Join QR.</p>
        {loading?<div style={styles.loadingBox}>Creating your business account…</div>:businessSlug?<SubscriptionPayment API_BASE={API_BASE} businessSlug={businessSlug} title="Pay & Activate" subtitle={form.setup_kit_requested?'Your total includes your selected plan plus the ₱150 PR Kit.':'Pay your selected monthly plan to activate your business.'} successMessage="🎉 Payment received — your business is active!" onPaid={()=>{localStorage.setItem('loyaltree_continue_onboarding','1');navigate('/login?onboarding=1')}}/>:<button style={styles.primary} onClick={createAccount}>Retry account creation</button>}
      </section>}
      {error&&<div style={styles.error}>{error}</div>}
      {wizardStep<5&&<div style={styles.actions}>{wizardStep>1?<button type="button" onClick={back} style={styles.secondary}>← Back</button>:<span/>}<button type="button" onClick={next} disabled={logoUpload.uploading} style={styles.primary}>Continue →</button></div>}
      <p style={styles.footer}>Already have an account? <Link to="/login" style={{color:'#0f766e',fontWeight:800}}>Sign in</Link></p>
    </main>
  </div></div>
}

function Field({label,children}){return <label style={styles.field}><span style={styles.label}>{label}</span>{children}</label>}

const styles={
 page:{minHeight:'100vh',background:'#f1f5f9',padding:24,boxSizing:'border-box',fontFamily:'Inter,system-ui,sans-serif'},shell:{maxWidth:1050,margin:'0 auto',background:'#fff',borderRadius:24,boxShadow:'0 24px 70px rgba(15,23,42,.12)',display:'grid',gridTemplateColumns:'300px minmax(0,1fr)',overflow:'hidden'},sidebar:{background:'linear-gradient(160deg,#0f766e,#134e4a)',color:'#fff',padding:'38px 30px'},logo:{width:56,height:56,borderRadius:'50%'},brand:{fontWeight:900,fontSize:18,marginTop:10},sideTitle:{fontSize:28,lineHeight:1.1,margin:'34px 0 10px'},sideCopy:{fontSize:14,lineHeight:1.6,opacity:.82},stepList:{display:'grid',gap:10,marginTop:30},stepItem:{display:'flex',alignItems:'center',gap:11,padding:'10px 12px',borderRadius:12,fontSize:14,fontWeight:700,opacity:.72},stepActive:{background:'rgba(255,255,255,.13)',opacity:1},stepDot:{width:27,height:27,borderRadius:'50%',border:'1px solid rgba(255,255,255,.45)',display:'grid',placeItems:'center',fontSize:12},stepDone:{background:'#fff',color:'#0f766e'},stepDotActive:{border:'2px solid #fff'},main:{padding:'44px 48px',minWidth:0},mobileProgress:{fontSize:12,fontWeight:900,color:'#0f766e',textTransform:'uppercase',letterSpacing:.5,marginBottom:18},eyebrow:{fontSize:12,fontWeight:900,color:'#0d9488',letterSpacing:.8,margin:'0 0 7px'},title:{fontSize:31,color:'#0f172a',margin:'0 0 8px',letterSpacing:'-.7px'},subtitle:{color:'#64748b',fontSize:15,lineHeight:1.55,margin:'0 0 26px'},field:{display:'flex',flexDirection:'column',gap:7,marginBottom:16},label:{fontSize:13,fontWeight:750,color:'#334155'},input:{width:'100%',boxSizing:'border-box',padding:'13px 14px',border:'1.5px solid #dbe3ec',borderRadius:11,fontSize:15,fontFamily:'inherit',background:'#fff'},twoCol:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14},tip:{color:'#64748b',fontSize:11.5,lineHeight:1.4},uploadBox:{minHeight:260,border:'2px dashed #99f6e4',background:'#f0fdfa',borderRadius:18,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,cursor:'pointer',color:'#0f766e',textAlign:'center',padding:24},logoPreview:{width:120,height:120,objectFit:'contain',borderRadius:18,background:'#fff',border:'1px solid #dbe3ec',padding:8},planGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:18},planCard:{border:'1.5px solid #e2e8f0',background:'#fff',borderRadius:14,padding:16,display:'flex',flexDirection:'column',gap:7,cursor:'pointer',color:'#334155'},planSelected:{border:'2px solid #0d9488',background:'#f0fdfa'},planIncludes:{fontSize:10.5,lineHeight:1.35,color:'#0f766e',fontWeight:800},planBadge:{alignSelf:'flex-start',fontSize:9,fontWeight:900,letterSpacing:'.06em',color:'#047857',background:'#d1fae5',padding:'4px 7px',borderRadius:999},warning:{fontSize:10,color:'#d97706'},kitCard:{display:'flex',gap:12,alignItems:'flex-start',border:'1.5px solid #e2e8f0',borderRadius:14,padding:16,cursor:'pointer'},kitSelected:{borderColor:'#0d9488',background:'#f0fdfa'},delivery:{marginTop:16,padding:16,borderRadius:14,background:'#f8fafc',border:'1px solid #e2e8f0'},actions:{display:'flex',justifyContent:'space-between',gap:12,marginTop:24},primary:{border:0,borderRadius:11,padding:'13px 20px',background:'linear-gradient(135deg,#0d9488,#0f766e)',color:'#fff',fontWeight:800,fontSize:15,cursor:'pointer'},secondary:{border:'1.5px solid #dbe3ec',borderRadius:11,padding:'13px 20px',background:'#fff',color:'#475569',fontWeight:800,fontSize:15,cursor:'pointer'},error:{marginTop:16,padding:'12px 14px',background:'#fef2f2',color:'#dc2626',borderRadius:10,fontSize:13},loadingBox:{padding:30,textAlign:'center',borderRadius:14,background:'#f8fafc',color:'#64748b'},footer:{textAlign:'center',fontSize:13,color:'#64748b',margin:'28px 0 0'}
}

export default Signup
