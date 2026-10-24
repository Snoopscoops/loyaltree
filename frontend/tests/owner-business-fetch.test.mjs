import test from 'node:test'
import assert from 'node:assert/strict'
import { createOwnerBusinessFetch } from '../src/components/ownerBusinessFetch.js'

const config={API_BASE:'https://api.example.invalid',businessId:'test-cafe',ownerToken:'owner-fixture'}

test('owner dashboard reads, writes and upload signatures authenticate the exact business API', async () => {
  const calls=[]
  const request=createOwnerBusinessFetch(async(...args)=>{calls.push(args);return Response.json({})},config)
  const init={method:'POST',headers:{'Content-Type':'application/json'},body:'{"amount":100}'}
  for(const suffix of ['', '/cl-customers?search=sample', '/contracts', '/cloudinary-signature?purpose=contract']) {
    await request(`${config.API_BASE}/api/v1/business/test-cafe${suffix}`,init)
  }
  assert.equal(calls.length,4)
  for(const [,options] of calls) {
    assert.equal(options.headers.get('Authorization'),'Bearer owner-fixture')
    assert.equal(options.headers.get('Content-Type'),'application/json')
    assert.equal(options.body,init.body)
    assert.equal(options.method,'POST')
    assert.equal(options.redirect,'error')
  }
  assert.equal(init.headers.Authorization,undefined)
})

test('Cloudinary, another business and lookalike paths or origins never receive the owner capability', async () => {
  const calls=[]
  const request=createOwnerBusinessFetch(async(...args)=>{calls.push(args);return Response.json({})},config)
  const cloudBody=new FormData();cloudBody.set('file','image-fixture')
  const upload={method:'POST',body:cloudBody}
  for(const url of ['https://api.cloudinary.com/v1_1/example/image/upload',
    'https://api.example.invalid.evil/api/v1/business/test-cafe/contracts',
    'https://api.example.invalid/api/v1/business/test-cafe-other/contracts',
    'https://api.example.invalid/api/v1/business/test-cafe/../other/contracts',
    'https://api.example.invalid/api/v1/business/other/contracts']) await request(url,upload)
  assert.equal(calls.length,5)
  for(const [,options] of calls) {
    assert.equal(options.headers,undefined)
    assert.equal(options.body,cloudBody)
  }
})

test('a missing owner session blocks private API calls without blocking direct uploads', async () => {
  const calls=[],expired=[]
  const request=createOwnerBusinessFetch(async(...args)=>{calls.push(args);return Response.json({})},
    {...config,ownerToken:'',onAuthError:error=>expired.push(error)})
  await assert.rejects(request(`${config.API_BASE}/api/v1/business/test-cafe/cl-customers`),error=>error.status===401)
  assert.equal(calls.length,0)
  assert.equal(expired.length,1)
  await request('https://api.cloudinary.com/v1_1/example/image/upload',{method:'POST'})
  assert.equal(calls.length,1)
})

test('auth failures throw before protected list error objects can reach dashboard arrays', async () => {
  for(const status of [401,403]) {
    const errors=[]
    const request=createOwnerBusinessFetch(async()=>Response.json({detail:'Denied'},{status}),
      {...config,onAuthError:error=>errors.push(error)})
    await assert.rejects(request(`${config.API_BASE}/api/v1/business/test-cafe/contracts`),
      error=>error.status===status&&/sign in/.test(error.message))
    assert.equal(errors.length,1)
  }
})

test('same-origin development API URLs remain authenticated', async () => {
  let options
  const request=createOwnerBusinessFetch(async(url,init)=>{options=init;return Response.json([])},
    {...config,API_BASE:''})
  await request('/api/v1/business/test-cafe/contracts')
  assert.equal(options.headers.get('Authorization'),'Bearer owner-fixture')
})
