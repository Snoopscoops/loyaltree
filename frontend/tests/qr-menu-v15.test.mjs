import test from 'node:test'
import assert from 'node:assert/strict'
import { loyaltyProgress, historyEvents, quickReorderItems, canQuickAdd } from '../src/components/qrMenuV15.js'
import { buildReorderDraft } from '../src/components/qrMenuRecentOrder.js'
import { menuItemAvailable, addCartItem } from '../src/components/qrMenuModel.js'

test('merchant-specific card state never invents stamps, points or a goal',()=>{
  assert.equal(loyaltyProgress(null).type,'unknown')
  assert.deepEqual(loyaltyProgress({stamps_enabled:true,stamp_count:2,stamp_goal:8}),{type:'stamps',label:'2 of 8 stamps',filled:2,goal:8})
  assert.equal(loyaltyProgress({points_enabled:true,points_balance:440}).label,'440 points')
  assert.equal(loyaltyProgress({stamps_enabled:true,stamp_count:3}).label,'3 stamps')
  assert.equal(loyaltyProgress({stamps_enabled:false,stamp_count:9,points_enabled:false}).type,'other')
  assert.equal(loyaltyProgress({stamps_enabled:true,stamp_count:-1,stamp_goal:8}).goal,0)
})
test('card history filters only actual typed recorded events',()=>{
  const input=[{id:'a',type:'earned'},{id:'b',type:'redeemed'},{id:'c',type:'fake'},{id:'d',type:'earned'}]
  assert.deepEqual(historyEvents(input,'redeemed').map(x=>x.id),['b'])
  assert.deepEqual(historyEvents(input,'earned').map(x=>x.id),['a','d'])
  assert.deepEqual(historyEvents(input,'all').map(x=>x.id),['a','b','d'])
  assert.deepEqual(historyEvents(null),[])
})
test('quick reorder suggestions respect live catalog prices, availability and modifier compatibility',()=>{
  const items=[{public_id:'coffee',name:'Coffee',base_price:150,modifier_groups:[],is_available:true},{public_id:'sold',name:'Sold',base_price:250,modifier_groups:[],is_available:false}]
  const lines=[{item_id:'coffee',name:'Coffee',quantity:2,options:[]},{item_id:'sold',name:'Sold',quantity:1,options:[]}]
  const result=quickReorderItems(lines,items,'main',menuItemAvailable,buildReorderDraft,addCartItem)
  assert.deepEqual(result.map(x=>x.item.public_id),['coffee'])
  assert.equal(result[0].draft[0].unit_price,150)
  assert.equal(result[0].draft[0].quantity,2)
})
test('quick options cannot bypass required modifier groups',()=>{
  const group={public_id:'size',selection_type:'single',min_selections:1,options:[{public_id:'s',name:'Small'},{public_id:'l',name:'Large'}]}
  assert.equal(canQuickAdd([group],{}),false)
  assert.equal(canQuickAdd([group],{size:['s']}),true)
  assert.equal(canQuickAdd([group],{size:['s','l']}),false)
  assert.equal(canQuickAdd([group],{size:['unknown']}),false)
  assert.equal(canQuickAdd([{...group,options:Array.from({length:7},(_,i)=>({public_id:String(i)}))}],{size:['0']}),false)
})
test('v15 offers optional QRPh test UI but never adds card details or simulated processing',async()=>{
  const { readFile }=await import('node:fs/promises')
  const page=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  const model=await readFile(new URL('../src/components/qrMenuModel.js',import.meta.url),'utf8')
  assert.match(page,/CardHistorySheet/)
  assert.match(page,/FastConfigureCard/)
  assert.match(page,/lt-v15-bottom-nav/)
  assert.match(page,/lt-v15-qrph-brands/)
  assert.match(model,/qrph: \{ label: 'QRPh'/)
  assert.doesNotMatch(page,/Payment processing|Enter card details|Seeds|Sprouts|Silver Perks/)
})
