import test from 'node:test'
import assert from 'node:assert/strict'
import { filterAdminBusinesses, loadAdminResources, readAdminJson } from '../src/components/adminData.js'

test('fast resources become visible without waiting for a slow or failed section', async () => {
  let finishSlow
  const slow = new Promise(resolve => { finishSlow = resolve })
  const visible = [], errors = []
  const work = loadAdminResources(path => path === 'slow' ? slow : path === 'broken' ? Promise.reject(new Error('Unavailable')) : Promise.resolve(60), [
    ['fast', data => visible.push(data)], ['slow', data => visible.push(data)], ['broken', () => assert.fail()],
  ], error => errors.push(error.message))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(visible,[60])
  assert.deepEqual(errors,['Unavailable'])
  finishSlow(7)
  const results = await work
  assert.equal(results[2].status,'rejected')
  assert.deepEqual(visible,[60,7])
})

test('reads abort on a deadline instead of leaving the admin loader pending', async () => {
  let signal
  const fetch = (path, options) => new Promise((resolve,reject) => {
    signal = options.signal
    signal.addEventListener('abort', () => reject(new DOMException('Aborted','AbortError')), {once:true})
  })
  await assert.rejects(readAdminJson(fetch,'slow',{timeoutMs:5}),/taking too long/)
  assert.equal(signal.aborted,true)
})

test('HTTP errors do not replace good rows with a server error object', async () => {
  await assert.rejects(readAdminJson(async () => new Response(JSON.stringify({detail:'Storage unavailable'}),{status:503}),'/data'),/Storage unavailable/)
  assert.deepEqual(await readAdminJson(async () => Response.json([{public_id:'test'}]),'/data'),[{public_id:'test'}])
})

test('business filters run locally while the unfiltered pending list remains intact', () => {
  const rows = [
    {name:'Cafe',email:'c@example.invalid',address:'Manila',status:'ACTIVE',plan:'growth',business_type:'coffee'},
    {name:'Shop',address:'Cebu',status:'PENDING',plan:'starter',business_type:'retail'},
  ]
  assert.deepEqual(filterAdminBusinesses(rows,{search:'MANILA',status:'ACTIVE',plan:'growth',type:'coffee'}),[rows[0]])
  assert.deepEqual(filterAdminBusinesses(rows,{search:'example.invalid'}),[rows[0]])
  assert.deepEqual(filterAdminBusinesses(rows,{status:'SUSPENDED'}),[])
  assert.equal(rows.filter(row=>row.status==='PENDING').length,1)
})
