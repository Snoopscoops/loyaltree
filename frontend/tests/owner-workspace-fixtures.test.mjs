import test from 'node:test'
import assert from 'node:assert/strict'
import {createFixtureTransport,fixtureSlug} from '../dev/owner-dashboard-fixtures.js'
import {manilaDay} from '../src/components/ownerWorkspaceModel.js'

const root='http://localhost/__owner-fixtures/api/v1/business/'+fixtureSlug
const read=async (transport,path)=>(await transport(root+path)).json()
test('fictional order summary distinguishes real-looking cash, outstanding, test and unverified',async()=>{
  const transport=createFixtureTransport()
  const data=await read(transport,'/menu-orders/summary?period=today')
  assert.equal(data.simulated,true)
  assert.equal(data.orders,5)
  assert.equal(data.sales,815)
  assert.equal(data.payments.settlement.cash_confirmed.sales,435)
  assert.equal(data.payments.settlement.outstanding.sales,110)
  assert.equal(data.payments.settlement.test.sales,160)
  assert.equal(data.payments.settlement.unverified.sales,110)
  assert.equal(data.cancelled,1)
})
test('branch and custom date reports stay scoped; export is fictional CSV',async()=>{
  const transport=createFixtureTransport()
  const today=manilaDay()
  const path='/menu-orders/report?start='+today+'&end='+today+'&branch=demo-branch-main'
  const data=await read(transport,path+'&format=json')
  assert.equal(data.sales,595)
  assert.equal(data.payments.settlement.cash_confirmed.sales,435)
  const csv=await transport(root+path+'&format=csv')
  assert.match(await csv.text(),/^Fictional report only/)
  assert.equal((await transport(root+'/menu-orders/report?start=2026-11-31&end='+today)).status,400)
})
test('status progression mutates only a fixture and blocks unpaid orders',async()=>{
  const transport=createFixtureTransport()
  const advance=id=>transport(root+'/menu-orders/'+id+'/status',{method:'PATCH',body:JSON.stringify({status:'preparing'})})
  assert.equal((await advance('demo-menu-order-2')).status,409)
  assert.equal((await advance('demo-menu-order-1')).status,200)
  assert.equal((await read(transport,'/menu-orders')).orders[0].status,'preparing')
  assert.equal((await read(createFixtureTransport(),'/menu-orders')).orders[0].status,'new')
})
test('customer history counts only completed confirmed cash, and small cohorts remain suppressed',async()=>{
  const transport=createFixtureTransport()
  const data=await read(transport,'/customers/demo-member-1/menu-order-history')
  assert.equal(data.summary.total_orders,3)
  assert.equal(data.summary.completed_paid_orders,2)
  assert.equal(data.summary.total_spent,435)
  const insights=await read(transport,'/menu-orders/insights?period=today')
  assert.equal(insights.top_items[0].name,'Iced Spanish Latte')
  assert.equal(insights.sections[0].groups[0].hidden,true)
})
test('booking fixture is read-only and merchant payments remain disabled',async()=>{
  const transport=createFixtureTransport()
  const booking=await read(transport,'/native-bookings?branch_id=demo-branch-riverside')
  assert.equal(booking.branch,'demo-branch-riverside')
  assert.equal(booking.settings.table_enabled,true)
  assert.equal((await transport(root+'/native-bookings/settings',{method:'PUT',body:'{}'})).status,501)
  const payments=await (await transport('http://localhost/__owner-fixtures/api/v1/business/demo-business-daylight/merchant-payments/status')).json()
  assert.equal(payments.state,'disabled')
  assert.equal(payments.portal_available,false)
})
