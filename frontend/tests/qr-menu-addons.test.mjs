import test from 'node:test'
import assert from 'node:assert/strict'
import { canAddToOrder, addonRequest, tableBill } from '../src/components/qrMenuAddons.js'
import { saveRecentOrder, readRecentOrder } from '../src/components/qrMenuRecentOrder.js'
const id = 'a'.repeat(32)
const order = {server_order_id:id, addon_token:'receipt.signature', order_number:'001', status:'ready', payment_method:'cash', payment_status:'paid', service:'dine-in'}
const family = {can_add:true, branch_public_id:'b1', parent:{public_id:id,status:'ready'},children:[]}
test('only verified open same-branch parent can add',()=>{
  assert.equal(canAddToOrder(order,family,'b1'),true)
  assert.equal(canAddToOrder(order,family,'b2'),false)
  assert.equal(canAddToOrder({...order,status:'completed'},family,'b1'),false)
  assert.equal(canAddToOrder({...order,addon_token:''},family,'b1'),false)
  assert.equal(canAddToOrder(order,{...family,can_add:false},'b1'),false)
})
test('post uses scoped receipt header and keeps request ID for retries',async()=>{
  const payload={request_id:'same-id',items:[{item_id:'latte',quantity:1}]}
  let calls=[]
  const fetchImpl=async(url,opts)=>{calls.push([url,opts]);return {ok:true,json:async()=>({order:{public_id:'b'.repeat(32),payment_status:'unpaid',order_number:'001A'}})}}
  for(let i=0;i<2;i++)await addonRequest({fetchImpl,apiBase:'https://example.test',businessId:'shop',order,payload})
  assert.equal(calls[0][0],`https://example.test/api/v1/public/menu/shop/orders/${id}/sub-orders`)
  assert.equal(calls[0][1].headers.Authorization,'Bearer receipt.signature')
  assert.equal(calls[0][1].body,calls[1][1].body)
})
test('receipt persists only scoped addon token, not card token',()=>{
  const data=new Map(), storage={setItem:(k,v)=>data.set(k,v),getItem:k=>data.get(k),removeItem:k=>data.delete(k)}
  assert.equal(saveRecentOrder(storage,'shop',{...order,card_token:'private',buyer_name:'private'}),true)
  const saved=readRecentOrder(storage,'shop')
  assert.equal(saved.addon_token,order.addon_token)
  assert.equal(saved.card_token,undefined)
  assert.equal(saved.buyer_name,undefined)
})

test('combined table bill accumulates main and add-ons, excludes cancelled and counts only confirmed payments',()=>{
  const f={...family,parent:{...family.parent,total:150,payment_status:'unpaid'},children:[{public_id:'child-a',status:'new',total:1000,payment_status:'unpaid'}]}
  assert.deepEqual(tableBill(order,f),{total:1150,paid:0,balance:1150})
  f.parent.payment_status='paid'
  assert.deepEqual(tableBill(order,f),{total:1150,paid:150,balance:1000})
  f.children[0].total=750
  assert.deepEqual(tableBill(order,f),{total:900,paid:150,balance:750})
  f.children[0].status='cancelled'
  assert.deepEqual(tableBill(order,f),{total:150,paid:150,balance:0})
})
test('combined table bill rejects a stale parent or invalid amount and deduplicates child IDs',()=>{
  const child={public_id:'a1',status:'new',total:0.1,payment_status:'unpaid'}
  const f={...family,parent:{...family.parent,total:0.2,payment_status:'paid'},children:[child,child]}
  assert.deepEqual(tableBill(order,f),{total:0.3,paid:0.2,balance:0.1})
  assert.equal(tableBill({...order,server_order_id:'different'},f),null)
  assert.equal(tableBill(order,{...f,children:[{...child,total:'bad'}]}),null)
})
