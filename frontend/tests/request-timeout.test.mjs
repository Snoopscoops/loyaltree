import test from 'node:test'
import assert from 'node:assert/strict'
import { requestJsonResponse, withRequestTimeout } from '../src/components/requestTimeout.js'

test('a hung fetch settles at its deadline even if transport ignores cancellation', async () => {
  let signal
  await assert.rejects(withRequestTimeout(value => {
    signal=value
    return new Promise(() => {})
  }, {timeoutMs:5,message:'Try again shortly.'}), error => error.name==='TimeoutError' && error.message==='Try again shortly.')
  assert.equal(signal.aborted,true)
})

test('the deadline includes a stalled JSON response body', async () => {
  await assert.rejects(requestJsonResponse(async()=>({json:()=>new Promise(()=>{})}), '/menu', {},
    {timeoutMs:5}), error=>error.name==='TimeoutError')
})

test('caller cancellation remains cancellation instead of a visible network failure', async () => {
  const controller=new AbortController()
  let signal
  const pending=withRequestTimeout(value=>{signal=value;return new Promise(()=>{})}, {signal:controller.signal,timeoutMs:100})
  await Promise.resolve()
  controller.abort()
  await assert.rejects(pending,error=>error.name==='AbortError')
  assert.equal(signal.aborted,true)
  let calls=0
  await assert.rejects(withRequestTimeout(()=>{calls++},{signal:controller.signal}),error=>error.name==='AbortError')
  assert.equal(calls,0)
})

test('success removes abort listeners and preserves the exact write without retry', async () => {
  let calls=0,signal
  const external=new AbortController()
  const body='{"receipt":"existing-attempt"}'
  const result=await requestJsonResponse(async(url,options)=>{
    calls++;signal=options.signal
    assert.equal(url,'/checkout');assert.equal(options.method,'POST');assert.equal(options.body,body)
    return Response.json({id:'existing-attempt'})
  }, '/checkout', {method:'POST',body,signal:external.signal},{timeoutMs:100})
  assert.deepEqual(result.payload,{id:'existing-attempt'})
  external.abort()
  assert.equal(signal.aborted,false)
  assert.equal(calls,1)
})

test('HTTP and malformed JSON responses remain available to the caller error UI', async () => {
  const denied=await requestJsonResponse(async()=>Response.json({detail:'Denied'},{status:403}),'/private')
  assert.equal(denied.response.status,403)
  assert.equal(denied.payload.detail,'Denied')
  const invalid=await requestJsonResponse(async()=>new Response('not-json'),'/menu')
  assert.equal(invalid.payload,null)
})
