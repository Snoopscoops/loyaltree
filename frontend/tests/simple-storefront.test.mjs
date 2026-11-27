import test from 'node:test'
import assert from 'node:assert/strict'
import {optionLimits,optionsComplete,storefrontShareUrl,storefrontAccent} from '../src/components/simpleStorefront.js'
import {addCartItem,cartSubtotal,menuSelectionAvailable} from '../src/components/qrMenuModel.js'

const size={public_id:'size',selection_type:'single',is_required:true,min_selections:1,max_selections:1,options:[{public_id:'regular',name:'Regular',price_delta:0},{public_id:'large',name:'Large',price_delta:25}]}
const extras={public_id:'extras',selection_type:'multiple',is_required:false,min_selections:0,max_selections:2,options:[{public_id:'shot',name:'Extra shot',price_delta:35},{public_id:'milk',name:'Oat milk',price_delta:40},{public_id:'syrup',name:'Syrup',price_delta:20}]}
const item={public_id:'latte',name:'Latte',base_price:145,modifier_groups:[size,extras]}
test('required and optional selections honor group bounds',()=>{
  assert.deepEqual(optionLimits(size),{minimum:1,maximum:1})
  assert.equal(optionsComplete(item,{}),false)
  assert.equal(optionsComplete(item,{size:['large']}),true)
  assert.equal(optionsComplete(item,{size:['large','regular']}),false)
  assert.equal(optionsComplete(item,{size:['large'],extras:['shot','milk']}),true)
  assert.equal(optionsComplete(item,{size:['large'],extras:['shot','milk','syrup']}),false)
})
test('malformed, duplicate, inactive and unknown options cannot be added',()=>{
  assert.equal(optionsComplete(item,{size:['bogus']}),false)
  assert.equal(optionsComplete(item,{size:['large'],extras:['shot','shot']}),false)
  assert.equal(optionsComplete(item,{size:['large'],unknown:['id']}),false)
  assert.equal(optionsComplete(item,{size:'large'}),false)
  assert.equal(optionsComplete({...item,modifier_groups:[{...size,options:[{...size.options[0],is_active:false}]}]},{size:['regular']}),false)
  assert.equal(optionsComplete({modifier_groups:[]},{}),true)
})
test('sold-out modifier remains blocked by existing stock guard',()=>{
  const stocked={...item,branch_stock:{main:[{variant_key:'large',remaining:0}]}}
  assert.equal(menuSelectionAvailable(stocked,'main',{size:['large']}),false)
  assert.equal(menuSelectionAvailable(stocked,'main',{size:['regular']}),true)
})
test('different customizations retain separate cart lines and totals',()=>{
  let cart=addCartItem([],item,{size:['regular']},1)
  cart=addCartItem(cart,item,{size:['large'],extras:['milk']},2)
  assert.equal(cart.length,2)
  assert.equal(cartSubtotal(cart),565)
  assert.equal(cart[1].options.length,2)
})
test('share links carry only public menu and branch identifiers',()=>{
  assert.equal(storefrontShareUrl('demo','branch 1'),'https://theloyaltytree.com/menu/demo?branch=branch%201')
  assert.equal(storefrontShareUrl('demo?token=secret'),'https://theloyaltytree.com/menu/demo%3Ftoken%3Dsecret')
  assert.equal(storefrontShareUrl('demo'),'https://theloyaltytree.com/menu/demo')
})
test('white text retains contrast on merchant accent',()=>{
  assert.equal(storefrontAccent('#235447'),'#235447')
  assert.equal(storefrontAccent('#ffffff'),'#234c39')
  assert.equal(storefrontAccent('url(example)'),'#234c39')
})
