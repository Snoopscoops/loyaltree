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
test('public checkout defaults to cash and shows disabled Card and QRPH test options',async()=>{
  const { readFile }=await import('node:fs/promises')
  const page=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  assert.match(page,/CardHistorySheet/)
  assert.match(page,/FastConfigureCard/)
  assert.match(page,/lt-v15-bottom-nav/)
  assert.match(page,/\[paymentMethod, setPaymentMethod\] = useState\('cash'\)/)
  assert.match(page,/label: 'Card · TEST'/)
  assert.match(page,/label: 'QRPH · TEST'/)
  assert.ok(page.includes("disabled={submitting || (!isOnlinePreview && value !== 'cash')}"))
  assert.doesNotMatch(page,/lt-v15-qrph-brands|GCash|Maya|Payment processing|Enter card details|Seeds|Sprouts|Silver Perks/i)
})

test('public checkout uses the native top layer and follows the visible viewport, while owner preview stays inline',async()=>{
  const {readFile}=await import('node:fs/promises')
  const page=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  const css=await readFile(new URL('../src/components/qr-menu.css',import.meta.url),'utf8')
  assert.ok(page.includes("const CartOverlay = preview ? 'div' : 'dialog'"))
  assert.ok(page.includes('overlay?.showModal()'))
  assert.ok(page.includes('if (overlay?.open) overlay.close()'))
  for (const event of ['resize','scroll']) {
    assert.ok(page.includes("viewport?.addEventListener('"+event+"', syncViewport)"))
    assert.ok(page.includes("viewport?.removeEventListener('"+event+"', syncViewport)"))
  }
  for (const [variable,property] of [['top','offsetTop'],['left','offsetLeft'],['width','width'],['height','height']]) {
    assert.ok(page.includes("'--lt-cart-viewport-"+variable+"', \`${viewport."+property+"}px\`".replaceAll('\\','')))
  }
  assert.match(css,/dialog\.lt-qr-cart\s*\{[^}]*align-items:flex-end/)
  assert.match(css,/height:var\(--lt-cart-viewport-height,100dvh\)/)
  assert.match(css,/\.lt-qr-cart-card\s*\{\s*margin:0; max-height:calc\(100% - 16px\)/)
  assert.match(css,/\.lt-qr-sheet-foot\s*\{flex-shrink:0; padding-bottom:calc\(14px \+ env\(safe-area-inset-bottom,0px\)\)/)
})

test('pickup and delivery are selectable previews with no cash or order submission',async()=>{
  const {readFile}=await import('node:fs/promises')
  const page=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  const contact=await readFile(new URL('../src/components/MenuCheckoutContact.jsx',import.meta.url),'utf8')
  assert.ok(!page.includes('className="lt-v15-service-row"'))
  assert.ok(page.includes("chooseService('pickup')"))
  assert.ok(page.includes("chooseService('delivery')"))
  assert.ok(page.includes("if (service !== 'dine-in') { setSubmitError"))
  assert.ok(page.includes("...(!isOnlinePreview ? {cash: PAYMENT_METHODS.cash} : {})"))
  assert.ok(page.includes('disabled>Online payment coming soon'))
  assert.ok(page.includes('validContactPhone(contactPhone)'))
  assert.ok(page.includes("deliveryAddress.trim().length >= 5"))
  assert.ok(contact.includes("call('',grant,'PUT'"))
  assert.ok(contact.includes('Save phone & set address as default'))
  assert.doesNotMatch(contact,/localStorage/)
})

test('checkout action has an explicit visible label and high-contrast footer text',async()=>{
  const {readFile}=await import('node:fs/promises')
  const page=await readFile(new URL('../src/components/QRMenuPage.jsx',import.meta.url),'utf8')
  const css=await readFile(new URL('../src/components/qr-menu-v15.css',import.meta.url),'utf8')
  assert.ok(page.includes('className="lt-v19-checkout-label"'))
  assert.ok(page.includes("checkingCard ? 'One moment…' : 'Continue to details'"))
  assert.ok(page.includes('disabled={checkingCard || needsBranch} onClick={startCheckout}'))
  assert.match(css,/\.lt-qr-sheet-foot button\.lt-qr-primary\.lt-qr-wide\s*\{[^}]*color:#fff; -webkit-text-fill-color:#fff/)
  assert.match(css,/\.lt-v19-checkout-cta > span\s*\{[^}]*visibility:visible; opacity:1/)
})
