import test from 'node:test'
import assert from 'node:assert/strict'
import { RECENT_ORDER_TTL_MS, recentOrderKey, readRecentOrder, saveRecentOrder, forgetRecentOrder, buildReorderDraft } from '../src/components/qrMenuRecentOrder.js'
import { addCartItem, menuItemAvailable } from '../src/components/qrMenuModel.js'
function storage() { const m = new Map(); return { setItem:(k,v)=>m.set(k,v), getItem:k=>m.get(k)||null, removeItem:k=>m.delete(k), m } }
const src = {server_order_id:'a'.repeat(32),order_number:'LT-1ABCD',status:'new',payment_status:'paid',payment_method:'cash',service:'pickup',subtotal:175, buyer_name:'Sensitive name',card_token:'VERY_SECRET', payment_reference:'REF_SECRET', lines:[{item_id:'latte',name:'Latte',quantity:1,unit_price:175,options:[]}], branch_name:'Main'}
test('save and resume last order only for its business, never save customer or payment secrets',()=>{
 const s=storage(); assert.equal(saveRecentOrder(s,'cafe-a',src,1000),true)
 const raw=s.getItem(recentOrderKey('cafe-a'))
 for(const secret of ['Sensitive name','VERY_SECRET','REF_SECRET']) assert.equal(raw.includes(secret),false)
 assert.equal(readRecentOrder(s,'cafe-b',1100),null)
 const restored=readRecentOrder(s,'cafe-a',1100)
 assert.equal(restored.order_number,'LT-1ABCD'); assert.equal(restored.lines[0].name,'Latte')
 assert.equal(restored.buyer_name,undefined)
 forgetRecentOrder(s,'cafe-a'); assert.equal(readRecentOrder(s,'cafe-a',1100),null)
})
test('expired/malformed/token-only orders never restore',()=>{
 const s=storage(); assert.equal(saveRecentOrder(s,'cafe-a',src,1000),true)
 assert.equal(readRecentOrder(s,'cafe-a',1000+RECENT_ORDER_TTL_MS+1),null)
 assert.equal(saveRecentOrder(s,'cafe-a',{...src,server_order_id:'LT-GUESS'},1000),false)
 s.setItem(recentOrderKey('cafe-a'),'{bad json'); assert.equal(readRecentOrder(s,'cafe-a'),null)
})
test('blocked storage remains optional and never stops checkout',()=>{
 const s={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}}
 assert.equal(saveRecentOrder(s,'cafe-a',src),false)
 assert.equal(readRecentOrder(s,'cafe-a'),null)
 forgetRecentOrder(s,'cafe-a')
})
test('reorder draft uses fresh catalog pricing and removes sold-out/unavailable items',()=>{
 const items=[{public_id:'latte',name:'Latte',base_price:220, modifier_groups:[],is_available:true},{public_id:'bun',name:'Bun',base_price:50,is_available:false}]
 const lines=[{item_id:'latte',name:'old',quantity:2,unit_price:175,options:[]},{item_id:'bun',name:'Bun',quantity:1,options:[]}]
 const result=buildReorderDraft(lines,items,'main',menuItemAvailable,addCartItem)
 assert.equal(result.cart[0].unit_price,220)
 assert.equal(result.cart[0].quantity,2)
 assert.equal(result.skipped,1)
})
test('reorder rejects disappeared modifiers rather than silently changing a selected item',()=>{
 const items=[{public_id:'latte',name:'Latte',base_price:220,modifier_groups:[{public_id:'size',selection_type:'single',min_selections:1,options:[{public_id:'large',name:'Large',price_delta:40}]}]}]
 assert.equal(buildReorderDraft([{item_id:'latte',quantity:1,options:[{public_id:'old-size'}]}],items,'main',menuItemAvailable,addCartItem).skipped,1)
 assert.equal(buildReorderDraft([{item_id:'latte',quantity:1,options:[{public_id:'large'}]}],items,'main',menuItemAvailable,addCartItem).cart[0].unit_price,260)
})
