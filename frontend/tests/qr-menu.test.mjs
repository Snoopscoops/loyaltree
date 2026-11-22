import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { menuItemAvailable, filterMenuItems, groupMenuCategories, menuItemPrice, toggleMenuOption, validMenuPayload, addCartItem, changeCartQuantity, cartSubtotal, buildMenuOrder, digitalMenuHref, menuOrderRequest, sendMenuOrder, MENU_ORDER_OFFLINE, pickupTimeLabel, resolveMenuBranch, paymentStatusFor, paymentReceiptLabel, CASH_NOTICE, payButtonLabel, receiptCopy } from '../src/components/qrMenuModel.js'
import { createFixtureTransport, fixtureSlug } from '../dev/owner-dashboard-fixtures.js'
const size={public_id:'size',selection_type:'single',max_selections:1,options:[{public_id:'small',price_delta:0},{public_id:'large',price_delta:25}]}
const extras={public_id:'extras',selection_type:'multiple',max_selections:1,options:[{public_id:'oat',price_delta:20},{public_id:'syrup',price_delta:10}]}
test('menu availability honors global and branch-specific sold-out state',()=>{
  assert.equal(menuItemAvailable({is_available:false},'main'),false)
  assert.equal(menuItemAvailable({unavailable_branch_public_ids:['main']},'main'),false)
  assert.equal(menuItemAvailable({unavailable_branch_public_ids:['main']},'second'),true)
})
test('search and categories combine without removing sold-out items from browsing',()=>{
  const items=[{name:'Latte',description:'Oat milk',category_public_id:'coffee',is_available:false},{name:'Croissant',category_public_id:'bakes'}]
  assert.deepEqual(filterMenuItems(items,'coffee',' OAT '),[items[0]])
  assert.deepEqual(filterMenuItems(items,'bakes','latte'),[])
  assert.deepEqual(filterMenuItems(items,'all',''),items)
})
test('category browsing keeps every item reachable and prefers an available cover photo at the chosen branch',()=>{
  const categories=[{public_id:'coffee',name:'Coffee'},{public_id:'bakes',name:'Bakes'},{public_id:'empty',name:'Empty'}]
  const items=[
    {public_id:'latte',category_public_id:'coffee',image_url:'/latte.jpg',unavailable_branch_public_ids:['main']},
    {public_id:'americano',category_public_id:'coffee',image_url:'/americano.jpg'},
    {public_id:'croissant',category_public_id:'bakes',image_url:'/croissant.jpg',is_available:false},
    {public_id:'special',category_public_id:null},
  ]
  const groups=groupMenuCategories(categories,items,'main')
  assert.deepEqual(groups.map(group=>group.name),['Coffee','Bakes','More'])
  assert.equal(groups[0].image_url,'/americano.jpg')
  assert.equal(groups[1].image_url,'/croissant.jpg')
  // Items not offered at the chosen branch are hidden there (current model behavior).
  assert.deepEqual(groups.flatMap(group=>group.items),items.filter(item=>item.public_id!=='latte'))
  assert.equal(groupMenuCategories(categories,items,'riverside')[0].image_url,'/latte.jpg')
  // With no categories, everything offered at the branch lands in one "Menu" group.
  const flat=groupMenuCategories([],items,'main')
  assert.deepEqual(flat.map(group=>[group.name,group.items.length]),[['Menu',3]])
  assert.deepEqual(groupMenuCategories([],[],'main'),[])
})
test('price preview replaces single choices and caps multiple options without mutating state',()=>{
  const initial={size:['small']}
  let selected=toggleMenuOption(initial,size,'large')
  assert.deepEqual(initial,{size:['small']})
  selected=toggleMenuOption(selected,extras,'oat')
  selected=toggleMenuOption(selected,extras,'syrup')
  assert.deepEqual(selected,{size:['large'],extras:['oat']})
  assert.equal(menuItemPrice({base_price:120,modifier_groups:[size,extras]},selected),165)
  assert.deepEqual(toggleMenuOption(selected,size,'unknown'),selected)
  assert.equal(menuItemPrice({base_price:120,modifier_groups:[size]}, {size:['unknown']}),120)
})
test('fixture supports browse-only publication, shared catalog edits and unpublishing with ordering disabled',async()=>{
  const base=`http://localhost/__owner-fixtures/api/v1/business/${fixtureSlug}`
  const publicUrl='http://localhost/__owner-fixtures/api/v1/public/menu/demo-daylight'
  const fetch=createFixtureTransport({menuPlan:'growth',orderAhead:false})
  assert.equal((await (await fetch(base)).json()).order_ahead_enabled,false)
  assert.equal((await fetch(publicUrl)).status,404)
  const setup=await (await fetch(base+'/qr-menu')).json()
  await fetch(base+'/qr-menu',{method:'PUT',body:JSON.stringify({is_published:true})})
  const menu=await (await fetch(publicUrl)).json()
  assert.equal(menu.items.length,5)
  const item=menu.items[0]
  await fetch(base+'/order-ahead/items/'+item.public_id,{method:'PATCH',body:JSON.stringify({base_price:155})})
  assert.equal((await (await fetch(publicUrl)).json()).items[0].base_price,155)
  await fetch(base+'/qr-menu',{method:'PUT',body:JSON.stringify({is_published:false})})
  assert.equal((await fetch(publicUrl)).status,404)
  assert.equal((await (await fetch(base+'/qr-menu')).json()).public_url,setup.public_url)
  assert.equal((await createFixtureTransport({menuPlan:'starter'})(base+'/qr-menu')).status,403)
})

test('malformed public responses are rejected before rendering customer content',()=>{
  for(const body of [null,{}, {business:{public_id:'test',name:'Cafe'}}]) assert.equal(validMenuPayload(body),false)
  assert.equal(validMenuPayload({business:{public_id:'test',name:'Cafe'},items:[],categories:[],branches:[]}),true)
})

test('join page hides the menu until it is published, then points at the existing menu',()=>{
  assert.equal(digitalMenuHref(null,'nfc9277'),'')
  assert.equal(digitalMenuHref({digital_menu_published:false,public_id:'nfc9277'},'nfc9277'),'')
  assert.equal(digitalMenuHref({public_id:'nfc9277'},'nfc9277'),'')
  assert.equal(digitalMenuHref({digital_menu_published:true,public_id:'nfc9277'},'old-slug'),'/menu/nfc9277')
})

test('cart keeps quantities, refuses sold-out items, and builds a pending order',()=>{
  const latte={public_id:'latte',name:'Latte',base_price:120,modifier_groups:[]}
  const sold={public_id:'bun',name:'Bun',base_price:50,is_available:false}
  let cart=addCartItem([],latte)
  cart=addCartItem(cart,latte)
  cart=addCartItem(cart,sold)
  assert.equal(cart.length,1)
  assert.equal(cart[0].quantity,2)
  assert.equal(cartSubtotal(cart),240)
  cart=changeCartQuantity(cart,cart[0].key,0)
  assert.deepEqual(cart,[])
  cart=addCartItem([],latte,{},3)
  const order=buildMenuOrder({merchantId:'nfc9277',cart,orderId:'ord_test'})
  assert.equal(order.order_id,'ord_test')
  assert.equal(order.merchant_id,'nfc9277')
  assert.equal(order.status,'pending_payment')
  assert.equal(order.subtotal,360)
  assert.equal(order.items[0].line_total,360)
})

test('cart lines keep the item photo for thumbnails, but the order never sends it',()=>{
  const mocha={public_id:'mocha',name:'Mocha Matcha',base_price:250,image_url:'https://cdn.example/mocha.jpg',modifier_groups:[size]}
  const plain={public_id:'bun',name:'Bun',base_price:50}
  let cart=addCartItem([],mocha,{size:['large']},2)
  cart=addCartItem(cart,plain)
  assert.equal(cart[0].image_url,'https://cdn.example/mocha.jpg')
  assert.equal(cart[1].image_url,'')
  cart=addCartItem(cart,mocha,{size:['large']})
  assert.equal(cart[0].quantity,3)
  assert.equal(cart[0].image_url,'https://cdn.example/mocha.jpg')
  const order=buildMenuOrder({merchantId:'nfc9277',cart,orderId:'LT-1'})
  for(const line of order.items){
    assert.equal('image_url' in line,false)
    for(const key of ['name','quantity','line_total','options']) assert.ok(key in line)
  }
  assert.equal(order.items[0].line_total,825)
  // Old carts saved before image_url existed still build an order.
  assert.equal(buildMenuOrder({cart:[{key:'x',name:'Old',unit_price:10,quantity:1,options:[]}],orderId:'LT-2'}).items[0].line_total,10)
})

const placed={order_id:'LT-ABC',payment_reference:'REF-ABC',buyer_name:'John',service:'dine-in',table_no:'5',pickup_label:'3:30 PM',
  items:[{item_id:'mocha',name:'Mocha',quantity:2,unit_price:150,line_total:300,options:[{public_id:'oat',name:'Oat',price_delta:20}],image_url:'x.jpg'}]}

test('order request body matches the server contract exactly',()=>{
  const body=menuOrderRequest(placed)
  assert.deepEqual(Object.keys(body).sort(),['branch_public_id','buyer_name','card_token','items','order_number','payment_method','payment_reference','payment_status','pickup_label','service','table_no'])
  assert.equal(body.branch_public_id,'')
  assert.equal(body.card_token,'')
  assert.equal(body.order_number,'LT-ABC')
  assert.equal(body.payment_reference,'REF-ABC')
  assert.equal(body.service,'dine-in')
  assert.equal(body.table_no,'5')
  assert.equal(body.pickup_label,'')
  assert.deepEqual(body.items,[{name:'Mocha',quantity:2,line_total:300,options:[{public_id:'oat',name:'Oat',price_delta:20}]}])
  const pickup=menuOrderRequest({...placed,service:'pickup'})
  assert.equal(pickup.service,'pickup'); assert.equal(pickup.table_no,''); assert.equal(pickup.pickup_label,'3:30 PM')
})

const url='https://api.example/api/v1/public/menu/nfc9277/orders'
test('sendMenuOrder posts once and reports ok only for a 2xx save',async()=>{
  const calls=[]
  const fetchImpl=async(input,init)=>{ calls.push({input,init}); return new Response(JSON.stringify({success:true,order:{public_id:'abc',order_number:'LT-ABC',status:'new'}}),{status:200,headers:{'Content-Type':'application/json'}}) }
  const result=await sendMenuOrder({fetchImpl,url,order:placed})
  assert.equal(result.ok,true)
  assert.equal(result.order.order_number,'LT-ABC')
  assert.equal(calls.length,1)
  assert.equal(calls[0].input,url)
  assert.equal(calls[0].init.method,'POST')
  assert.equal(calls[0].init.headers['Content-Type'],'application/json')
  assert.deepEqual(JSON.parse(calls[0].init.body),menuOrderRequest(placed))
})

test('sendMenuOrder never reports a save for server errors, offline, timeouts or preview',async()=>{
  const failed=await sendMenuOrder({fetchImpl:async()=>new Response(JSON.stringify({detail:'Menu orders are not ready yet'}),{status:503}),url,order:placed})
  assert.deepEqual([failed.ok,failed.status,failed.error],[false,503,'Menu orders are not ready yet'])
  const bare=await sendMenuOrder({fetchImpl:async()=>new Response('oops',{status:500}),url,order:placed})
  assert.equal(bare.ok,false); assert.match(bare.error,/error 500/)
  const validation=await sendMenuOrder({fetchImpl:async()=>new Response(JSON.stringify({detail:[{msg:'bad'}]}),{status:422}),url,order:placed})
  assert.equal(validation.ok,false); assert.match(validation.error,/error 422/)
  const offline=await sendMenuOrder({fetchImpl:async()=>{ throw new TypeError('Failed to fetch') },url,order:placed})
  assert.deepEqual([offline.ok,offline.error],[false,MENU_ORDER_OFFLINE])
  const hang=await sendMenuOrder({fetchImpl:()=>new Promise(()=>{}),url,order:placed,timeoutMs:20})
  assert.deepEqual([hang.ok,hang.error],[false,MENU_ORDER_OFFLINE])
  let called=false
  const previewMode=await sendMenuOrder({fetchImpl:async()=>{ called=true },url:'',order:placed})
  assert.equal(previewMode.ok,false); assert.equal(called,false)
  const empty=await sendMenuOrder({fetchImpl:async()=>{ called=true },url,order:{...placed,items:[]}})
  assert.equal(empty.ok,false); assert.equal(called,false)
})

test('a retry resends the same order number and payment reference',async()=>{
  const bodies=[]
  let attempt=0
  const fetchImpl=async(input,init)=>{ bodies.push(JSON.parse(init.body)); attempt+=1; return attempt===1?new Response('{}',{status:503}):new Response(JSON.stringify({order:{order_number:'LT-ABC'}}),{status:200}) }
  assert.equal((await sendMenuOrder({fetchImpl,url,order:placed})).ok,false)
  assert.equal((await sendMenuOrder({fetchImpl,url,order:placed})).ok,true)
  assert.equal(bodies[0].order_number,bodies[1].order_number)
  assert.equal(bodies[0].payment_reference,bodies[1].payment_reference)
})

test('menu page posts to apiBase with business.public_id and only shows the receipt after a save',async()=>{
  const {readFile}=await import('node:fs/promises')
  const source=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  const browser=source.slice(source.indexOf('export function QRMenuBrowser'),source.indexOf('export default function QRMenuPage'))
  assert.ok(browser.includes('`${apiBase}/api/v1/public/menu/${encodeURIComponent(business.public_id)}/orders`'))
  assert.equal(browser.includes('API_BASE'),false)
  assert.equal(browser.includes('merchant_id ||'),false)
  assert.equal(/\.catch\(\(\) => \{\s*\}\)/.test(source),false)
  const submit=browser.slice(browser.indexOf('async function submitOrder'),browser.indexOf('const copyOrderNumber'))
  const failure=submit.indexOf("if (!result.ok) { setSubmitError(result.error); return }")
  assert.ok(failure>0)
  assert.equal(submit.indexOf("setPayStep('done')")>failure,true)
  assert.equal(submit.split("setPayStep('done')").length,2)
})

test('pickup times always show AM or PM, and that label is what the server gets',()=>{
  assert.equal(pickupTimeLabel(new Date(2026,10,21,13,30)),'1:30 PM')
  assert.equal(pickupTimeLabel(new Date(2026,10,21,0,5)),'12:05 AM')
  assert.equal(pickupTimeLabel(new Date(2026,10,21,12,0)),'12:00 PM')
  assert.equal(pickupTimeLabel(new Date(2026,10,21,9,45)),'9:45 AM')
  assert.equal(pickupTimeLabel('not a date'),'')
  assert.equal(menuOrderRequest({...placed,service:'pickup',pickup_label:pickupTimeLabel(new Date(2026,10,21,15,30))}).pickup_label,'3:30 PM')
})

test('details step requires a name without a card and offers Connect card for rewards',async()=>{
  const {readFile}=await import('node:fs/promises')
  const source=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  assert.ok(source.includes('const nameRequired = !cardName'))
  assert.ok(source.includes("!(nameRequired && !buyerName.trim())"))
  assert.ok(source.includes('disabled={!detailsReady}'))
  assert.ok(source.includes('So the shop can call your order.'))
  assert.ok(source.includes('Connect it to earn rewards on this order.'))
  assert.equal(/download our app/i.test(source),false)
  assert.ok(source.includes('label: pickupTimeLabel(slot)'))
})

test('customers must pick a branch when there are several, one branch is automatic',()=>{
  const two=[{public_id:'main',name:'Main'},{public_id:'bgc',name:'BGC'}]
  assert.deepEqual(resolveMenuBranch(two,''),{branchId:'',needsBranch:true,showSelector:true,invalidBranch:false})
  assert.deepEqual(resolveMenuBranch(two,'bgc'),{branchId:'bgc',needsBranch:false,showSelector:true,invalidBranch:false})
  assert.deepEqual(resolveMenuBranch(two,'closed'),{branchId:'',needsBranch:true,showSelector:true,invalidBranch:true})
  assert.deepEqual(resolveMenuBranch([{public_id:'only',name:'Only'}],''),{branchId:'only',needsBranch:false,showSelector:false,invalidBranch:false})
  assert.deepEqual(resolveMenuBranch([{public_id:'only',name:'Only'}],'old'),{branchId:'only',needsBranch:false,showSelector:false,invalidBranch:false})
  assert.equal(resolveMenuBranch([],'x').needsBranch,false)
})

test('menu page has no All branches option and blocks ordering until a branch is chosen',async()=>{
  const {readFile}=await import('node:fs/promises')
  const source=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  assert.equal(source.includes('All branches'),false)
  assert.ok(source.includes('Choose your branch'))
  assert.ok(source.includes('if (needsBranch || !menuItemAvailable(value, branchId)) return'))
  assert.ok(source.includes('disabled={checkingCard || needsBranch}'))
  assert.ok(source.includes("!cartOpen && !needsBranch"))
  assert.equal(source.includes('Location unavailable'),false)
})

test('order request carries the chosen branch and the connected card token',()=>{
  const body=menuOrderRequest({...placed,branch_public_id:'bgc',card_token:'tok.sig',branch_name:'BGC',lines:[{image_url:'x'}]})
  assert.equal(body.branch_public_id,'bgc')
  assert.equal(body.card_token,'tok.sig')
  assert.equal('branch_name' in body,false)
  assert.equal('lines' in body,false)
})

test('payment method: cash is unpaid at the counter, QR Ph and card are test payments',()=>{
  assert.equal(paymentStatusFor('cash'),'unpaid')
  assert.equal(paymentStatusFor('qrph'),'paid_test')
  assert.equal(paymentStatusFor('card'),'paid_test')
  assert.equal(paymentStatusFor(''),'')
  const cash=menuOrderRequest({...placed,payment_method:'cash'})
  assert.deepEqual([cash.payment_method,cash.payment_status],['cash','unpaid'])
  const bad=menuOrderRequest({...placed,payment_method:'crypto'})
  assert.deepEqual([bad.payment_method,bad.payment_status],['',''])
  assert.equal(paymentReceiptLabel('cash'),'Cash · Pay at the counter')
  assert.match(paymentReceiptLabel('qrph'),/QRPh/)
  assert.match(paymentReceiptLabel('card'),/test/)
})

test('cash orders wait for the cashier: notice, button and receipt', () => {
  assert.equal(CASH_NOTICE, 'Pay at the counter first. Your order will be prepared only after the cashier confirms your payment.')
  assert.equal(payButtonLabel('cash', '₱180.00'), 'Place order · pay at counter')
  assert.equal(payButtonLabel('qrph', '₱180.00'), 'Pay ₱180.00 (test)')
  assert.equal(payButtonLabel('', '₱180.00'), 'Choose how you’ll pay')
  const cash = receiptCopy('cash', '₱180.00', 'Kape')
  assert.equal(cash.waiting, true)
  assert.equal(cash.title, 'Waiting for payment')
  assert.equal(cash.sub, 'Show this order number at the counter and pay ₱180.00. The shop will start preparing once the cashier confirms.')
  const card = receiptCopy('card', '₱180.00', 'Kape')
  assert.equal(card.waiting, false)
  assert.equal(card.badge, 'Order sent')
  assert.equal(card.title, 'Order sent to Kape')
})

test('the menu page shows the amber cash notice instead of a green check', () => {
  const page = readFileSync(new URL('../src/components/QRMenuPage.jsx', import.meta.url), 'utf8')
  assert.match(page, /lt-qr-cash-notice/)
  assert.match(page, /phase\?\.awaitingPayment/)
  assert.match(page, /is-payment-waiting/)
  assert.match(page, /lt-qr-track-badge/)
})
