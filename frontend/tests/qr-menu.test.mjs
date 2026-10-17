import test from 'node:test'
import assert from 'node:assert/strict'
import { menuItemAvailable, filterMenuItems, menuItemPrice, toggleMenuOption, validMenuPayload } from '../src/components/qrMenuModel.js'
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
