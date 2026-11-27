import test from 'node:test'
import assert from 'node:assert/strict'
import {manilaDay,dateRange,validRange,paymentClass,filterOrders,nextStatus,money,validMerchantStatus} from '../src/components/ownerWorkspaceModel.js'
import {destinations,missingDestinations,sectionForTab} from '../src/components/ownerHomeNav.js'
import {ownerDashboardTab} from '../src/components/ownerDashboardDesign.js'

test('Manila day is not UTC day at midnight',()=>{
  assert.equal(manilaDay('2026-11-26T16:01:00Z'),'2026-11-27')
  assert.equal(manilaDay('not a date'),'')
})
test('calendar periods are week/month to date',()=>{
  assert.deepEqual(dateRange('today','2026-11-27'),{start:'2026-11-27',end:'2026-11-27'})
  assert.deepEqual(dateRange('week','2026-11-27'),{start:'2026-11-23',end:'2026-11-27'})
  assert.deepEqual(dateRange('month','2026-11-27'),{start:'2026-11-01',end:'2026-11-27'})
})
test('custom date range rejects future, impossible, reversed, and oversized periods',()=>{
  for(const [start,end] of [['2026-11-31','2026-11-27'],['2026-11-28','2026-11-28'],['2026-11-27','2026-11-20'],['2026-01-01','2026-11-27']])
    assert.equal(validRange(start,end,'2026-11-27'),false)
  assert.equal(validRange('2026-11-01','2026-11-27','2026-11-27'),true)
})
test('test, unverified, cancelled and unknown never become confirmed cash',()=>{
  const cash={status:'new',payment_method:'cash',payment_status:'paid'}
  assert.equal(paymentClass(cash),'cash_confirmed')
  for(const [row,key] of [[{...cash,payment_status:'paid_test'},'test'],[{...cash,payment_method:'qrph'},'unverified'],[{...cash,status:'cancelled'},'cancelled'],[{...cash,payment_status:'unpaid'},'outstanding'],[{...cash,payment_status:'unknown'},'unknown']]){
    assert.equal(paymentClass(row),key)
    assert.equal(nextStatus(row),null)
  }
})
test('only approved order progression is shown',()=>{
  const cash={payment_method:'cash',payment_status:'paid'}
  assert.equal(nextStatus({...cash,status:'new'}),'preparing')
  assert.equal(nextStatus({...cash,status:'preparing'}),'ready')
  assert.equal(nextStatus({...cash,status:'ready'}),'completed')
  assert.equal(nextStatus({...cash,status:'completed'}),null)
  assert.equal(nextStatus({...cash,status:'__proto__'}),null)
})
test('recent record filters combine branch, Manila dates, items and payment status',()=>{
  const row={order_number:'LT-1',created_at:'2026-11-26T16:01:00Z',branch:{public_id:'b'},items:[{item_name:'Latte'}],status:'new',payment_method:'cash',payment_status:'paid'}
  assert.deepEqual(filterOrders([row],{branch:'b',start:'2026-11-27',end:'2026-11-27',search:'latte',payment:'cash_confirmed'}),[row])
  assert.deepEqual(filterOrders([row],{branch:'other'}),[])
  assert.deepEqual(filterOrders([row],{end:'2026-11-26'}),[])
})
test('missing monetary data stays missing, not zero; unknown merchant contract rejected',()=>{
  for(const value of [null,undefined,'',false,'no'])assert.equal(money(value),'—')
  assert.notEqual(money(0),'—')
  assert.equal(validMerchantStatus({version:2,state:'active'}),false)
  assert.equal(validMerchantStatus({version:1,state:'disabled'}),true)
})
test('new owner sections preserve all original destinations and keep intelligence nested',()=>{
  assert.deepEqual(missingDestinations(),[])
  for(const tab of ['orders','transactions','reservations','payments']){
    assert.equal(ownerDashboardTab(tab),tab)
    assert.equal(sectionForTab(tab).id,'orders')
  }
  assert.ok(!destinations().includes('customer-intelligence')&&!destinations().includes('product-intelligence'))
  assert.equal(new Set(destinations()).size,destinations().length)
})
