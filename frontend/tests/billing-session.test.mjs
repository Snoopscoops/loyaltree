import test from 'node:test'
import assert from 'node:assert/strict'
import { requestBilling, requestBillingHistory, requestPaymentStatus, renewBillingSession,
  readOnboardingSession, saveOnboardingSession, clearOnboardingSession,
  readPendingPayment, savePendingPayment, clearPendingPayment,
  ONBOARDING_SESSION_KEY, PENDING_PAYMENT_KEY, paymentNeedsReview, readPaymentReturn,
  pendingPaymentForReturn, clearPaymentReturnUrl, canDiscardPaymentAttempt, preservePendingPayment } from '../src/components/billingSession.js'

const options = { API_BASE:'https://api.example.invalid', businessSlug:'test-cafe', sessionToken:'billing-fixture' }

test('issued or uncertain payment attempts cannot be discarded to create a second payment', () => {
  const card={payment_intent_id:'pi_existing',payment_method:'card'}
  assert.equal(canDiscardPaymentAttempt(card),true)
  assert.equal(canDiscardPaymentAttempt(card,{busy:true}),false)
  assert.equal(canDiscardPaymentAttempt({...card,confirming:true}),false)
  assert.equal(canDiscardPaymentAttempt({...card,review_required:true}),false)
  assert.equal(canDiscardPaymentAttempt(card,{pending:{payment_intent_id:'pi_existing'}}),false)
  assert.equal(canDiscardPaymentAttempt({...card,payment_method:'qrph'}),false)
  assert.equal(canDiscardPaymentAttempt(card,{pending:{payment_intent_id:'pi_another'}}),true)
})
function storage() {
  const values = new Map()
  return { getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key) }
}

test('pending payment uses tab storage without putting routing IDs into the URL when storage works', () => {
  const tab = storage()
  assert.equal(preservePendingPayment('test-cafe', {payment_intent_id:'pi_existing', payment_method:'qrph'}, {
    storage:tab, history:{replaceState(){throw Error('should not change the URL')}},
  }), true)
  assert.equal(readPendingPayment('test-cafe', tab).payment_intent_id, 'pi_existing')
})

test('blocked or full browser storage recovers the same QR/card intent from public URL context after reload', () => {
  for (const reason of ['SecurityError', 'QuotaExceededError']) {
    for (const method of ['qrph','card']) {
      const tab = { getItem(){throw Error(reason)}, setItem(){throw Error(reason)} }
      let current = 'https://example.invalid/signup?country=PH#billing'
      const browserHistory = { state:{tab:'billing'}, replaceState(state, unused, href){
        assert.deepEqual(state, {tab:'billing'}); current = href
      } }
      const payment = {payment_intent_id:'pi_existing', payment_method:method,
        client_key:'client-secret', paymongo_public_key:'provider-key', card_number:'private-card',
        billing_email:'private@example.invalid', billing_token:'capability-secret', qr_image_url:'private-image'}
      assert.equal(preservePendingPayment('test-cafe', payment, {storage:tab, href:current, history:browserHistory}), true)
      const url = new URL(current)
      assert.deepEqual([...url.searchParams.keys()].sort(), ['business_slug','country','payment_intent','paymongo_return'])
      assert.equal(url.hash, '#billing')
      for (const secret of ['client-secret','provider-key','private-card','private@example.invalid','capability-secret','private-image']) {
        assert.ok(!current.includes(secret))
      }
      const restored = pendingPaymentForReturn('test-cafe', url.search, tab)
      assert.equal(restored.payment_intent_id, 'pi_existing')
      assert.equal(restored.businessSlug, 'test-cafe')
      assert.equal(pendingPaymentForReturn('another-business', url.search, tab), null)
      const cleaned = new URL(clearPaymentReturnUrl(current, 'test-cafe'))
      assert.equal(cleaned.search, '?country=PH')
      assert.equal(cleaned.hash, '#billing')
    }
  }
})

test('payment cannot proceed when neither storage nor public URL recovery can be saved', () => {
  const blocked = {setItem(){throw Error('blocked')}}
  assert.equal(preservePendingPayment('test-cafe', {payment_intent_id:'pi_existing'}, {
    storage:blocked, href:'https://example.invalid/billing', history:{replaceState(){throw Error('blocked')}},
  }), false)
  assert.equal(preservePendingPayment('../other', {payment_intent_id:'pi_existing'}, {storage:storage()}), false)
  assert.equal(preservePendingPayment('test-cafe', {payment_intent_id:'https://untrusted.invalid'}, {storage:storage()}), false)
})

test('subscription reads and checkout carry the capability only to LT billing paths', async () => {
  const calls = []
  const fetch = async (url, init) => { calls.push([url,init]); return Response.json({status:'pending'}) }
  await requestBilling(fetch,options)
  await requestBilling(fetch,{...options,path:'/checkout',method:'POST',body:JSON.stringify({billing_cycle:'monthly'})})
  assert.deepEqual(calls.map(call=>call[0]),[
    'https://api.example.invalid/api/v1/business/test-cafe/subscription',
    'https://api.example.invalid/api/v1/business/test-cafe/subscription/checkout',
  ])
  for (const [,init] of calls) {
    assert.equal(init.headers.Authorization,'Bearer billing-fixture')
    assert.equal(init.redirect,'error')
    assert.equal(init.credentials,'omit')
    assert.ok(init.signal instanceof AbortSignal)
  }
  await assert.rejects(requestBilling(fetch,{...options,path:'https://api.paymongo.com/v1/payment_methods'}),/Invalid billing request/)
  assert.equal(calls.length,2)
})

test('onboarding skips full payment history while owners can load it', async () => {
  const calls=[]
  const fetch=async(url,init)=>{calls.push([url,init]);return Response.json([{status:'paid'}])}
  assert.deepEqual(await requestBillingHistory(fetch,options,true),[])
  assert.equal(calls.length,0)
  assert.deepEqual(await requestBillingHistory(fetch,{...options,sessionToken:'owner-fixture'}),[{status:'paid'}])
  assert.match(calls[0][0],/\/subscription\/payments$/)
  assert.equal(calls[0][1].headers.Authorization,'Bearer owner-fixture')
})

test('payment polling reads one intent with auth instead of enumerating billing history', async () => {
  let call
  const fetch=async(...args)=>{call=args;return Response.json({status:'paid'})}
  assert.equal((await requestPaymentStatus(fetch,options,'pi_fixture')).status,'paid')
  assert.match(call[0],/\/subscription\/payments\/pi_fixture$/)
  assert.equal(call[1].headers.Authorization,'Bearer billing-fixture')
})

test('missing and expired capabilities return explicit auth errors without fallback to anonymous billing', async () => {
  let calls=0
  const fetch=async()=>{calls++;return Response.json({detail:'Expired'},{status:401})}
  await assert.rejects(requestBilling(fetch,{...options,sessionToken:''}),error=>error.status===401)
  assert.equal(calls,0)
  await assert.rejects(requestBilling(fetch,options),error=>error.status===401&&/session has expired/.test(error.message))
  assert.equal(calls,1)
})

test('network deadlines and non-JSON responses do not silently leave checkout loading', async () => {
  const fetch=async(url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})
  })
  await assert.rejects(requestBilling(fetch,{...options,timeoutMs:5}),/taking too long/)
  await assert.rejects(requestBilling(async()=>new Response('unavailable',{status:503}),options),/temporarily unavailable/)
  await assert.rejects(requestBilling(async()=>new Response('invalid',{status:200}),options),/invalid response/)
})

test('3DS onboarding context stores only a billing capability and safe payment metadata in tab storage', () => {
  const tab=storage()
  saveOnboardingSession({business_slug:'test-cafe',billing_token:'billing-fixture',password:'do-not-store',
    email:'private@example.invalid',token:'owner-fixture',billing_cycle:'monthly',pricing_region:'PH'},tab)
  const saved=tab.getItem(ONBOARDING_SESSION_KEY)
  assert.ok(saved.includes('billing-fixture'))
  for(const secret of ['do-not-store','private@example.invalid','owner-fixture'])assert.ok(!saved.includes(secret))
  savePendingPayment('test-cafe',{payment_intent_id:'pi_fixture',payment_method:'card',
    client_key:'client-secret',card_number:'private-card',billing_email:'private@example.invalid',
    display_amount:350,display_currency:'PHP'},tab)
  const pending=tab.getItem(PENDING_PAYMENT_KEY)
  for(const secret of ['client-secret','private-card','private@example.invalid'])assert.ok(!pending.includes(secret))
  assert.equal(readPendingPayment('test-cafe',tab).payment_intent_id,'pi_fixture')
  assert.equal(readPendingPayment('another-business',tab),null)
  clearPendingPayment(tab);clearOnboardingSession(tab)
  assert.equal(readOnboardingSession(tab),null)
})

test('expired onboarding recovers the existing attempt after credential verification, without registration or checkout', async () => {
  const tab=storage(),calls=[]
  saveOnboardingSession({business_slug:'test-cafe',billing_token:'expired-fixture'},tab)
  savePendingPayment('test-cafe',{payment_intent_id:'pi_existing',payment_method:'card'},tab)
  const fetch=async(url,init)=>{
    calls.push([url,init])
    return Response.json(url.endsWith('/auth/billing-session')
      ? {business_slug:'test-cafe',billing_token:'renewed-fixture'} : {status:'paid'})
  }
  const renewed=await renewBillingSession(fetch,options.API_BASE,{email:'owner@example.invalid',password:'credential-fixture',
    payment_intent_id:readPendingPayment('test-cafe',tab).payment_intent_id})
  saveOnboardingSession({...readOnboardingSession(tab),...renewed},tab)
  const payment=await requestPaymentStatus(fetch,{...options,sessionToken:readOnboardingSession(tab).billing_token},'pi_existing')
  assert.equal(payment.status,'paid')
  assert.deepEqual(JSON.parse(calls[0][1].body),{email:'owner@example.invalid',password:'credential-fixture',payment_intent_id:'pi_existing'})
  assert.equal(calls[0][1].headers.Authorization,undefined)
  assert.equal(calls[1][1].headers.Authorization,'Bearer renewed-fixture')
  assert.equal(calls.length,2)
  assert.ok(calls.every(([url])=>!url.endsWith('/register')&&!url.endsWith('/checkout')))
  assert.ok(!tab.getItem(ONBOARDING_SESSION_KEY).includes('credential-fixture'))
})

test('incorrect recovery credentials and unavailable browser storage have usable outcomes', async () => {
  await assert.rejects(renewBillingSession(async()=>Response.json({detail:'Invalid credentials'},{status:401}),options.API_BASE,
    {email:'owner@example.invalid',password:'bad'}),/Check your business email and password/)
  const unavailable={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}}
  assert.equal(readOnboardingSession(unavailable),null)
  assert.equal(saveOnboardingSession({business_slug:'test'},unavailable),false)
  assert.doesNotThrow(()=>clearOnboardingSession(unavailable))
})

test('legacy or unfulfilled paid receipts remain a review hold across reload, without discarding the existing attempt', () => {
  const tab=storage()
  for (const payment of [{status:'paid',fulfillment_status:'legacy_review'}, {status:'review_required'}]) {
    assert.equal(paymentNeedsReview(payment),true)
    savePendingPayment('test-cafe',{payment_intent_id:'pi_existing',review_required:paymentNeedsReview(payment)},tab)
    const restored=readPendingPayment('test-cafe',tab)
    assert.equal(restored.payment_intent_id,'pi_existing')
    assert.equal(restored.review_required,true)
  }
  assert.equal(paymentNeedsReview({status:'paid',fulfillment_status:'applied'}),false)
  assert.equal(paymentNeedsReview({status:'pending'}),false)
})

test('storage-less bank return restores only public routing context and requires verified account access before polling', async () => {
  const tab=storage(),calls=[]
  const query='?paymongo_return=1&business_slug=test-cafe&payment_intent=pi_returned'
  assert.equal(readOnboardingSession(tab),null)
  const returned=readPaymentReturn(query)
  assert.deepEqual(returned,{business_slug:'test-cafe',payment_intent_id:'pi_returned'})
  assert.equal(returned.billing_token,undefined)
  const pending=pendingPaymentForReturn('test-cafe',query,tab)
  assert.equal(pending.payment_intent_id,'pi_returned')
  const fetch=async(url,init)=>{
    calls.push([url,init])
    return Response.json(url.endsWith('/auth/billing-session')
      ? {business_slug:'test-cafe',billing_token:'verified-fixture'} : {status:'paid'})
  }
  await assert.rejects(requestPaymentStatus(fetch,{...options,sessionToken:''},pending.payment_intent_id),error=>error.status===401)
  assert.equal(calls.length,0)
  const renewed=await renewBillingSession(fetch,options.API_BASE,{email:'owner@example.invalid',password:'credential-fixture',
    payment_intent_id:pending.payment_intent_id})
  const paid=await requestPaymentStatus(fetch,{...options,sessionToken:renewed.billing_token},pending.payment_intent_id)
  assert.equal(paid.status,'paid')
  assert.equal(calls.length,2)
  assert.equal(calls[1][1].headers.Authorization,'Bearer verified-fixture')
  assert.equal(JSON.parse(calls[0][1].body).payment_intent_id,'pi_returned')
})

test('bank return queries cannot switch an authenticated business or supply capabilities', () => {
  const tab=storage()
  savePendingPayment('test-cafe',{payment_intent_id:'pi_original'},tab)
  const other='?paymongo_return=1&business_slug=other&payment_intent=pi_other&billing_token=untrusted'
  assert.equal(readPaymentReturn(other,'test-cafe'),null)
  assert.equal(pendingPaymentForReturn('test-cafe',other,tab).payment_intent_id,'pi_original')
  assert.equal(pendingPaymentForReturn('test-cafe',other,storage()),null)
  for (const query of ['?business_slug=test-cafe&payment_intent=pi_returned',
    '?paymongo_return=1&business_slug=../other&payment_intent=pi_returned',
    '?paymongo_return=1&business_slug=test-cafe&payment_intent=https://evil.invalid']) {
    assert.equal(readPaymentReturn(query),null)
  }
})

test('completed return cleanup consumes only matching payment routing fields and preserves unrelated URL state', () => {
  const url='https://example.invalid/signup?country=PH&paymongo_return=1&business_slug=test-cafe&payment_intent=pi_returned#billing'
  const cleaned=new URL(clearPaymentReturnUrl(url,'test-cafe'))
  assert.equal(cleaned.search,'?country=PH')
  assert.equal(cleaned.hash,'#billing')
  assert.equal(clearPaymentReturnUrl(url,'another-business'),url)
})
