import test from 'node:test'
import assert from 'node:assert/strict'
import { BILLING_TERMS, normalizeBillingCycle, prepaidPrice, planPrice, billingSavings, billingSummary, PH_REFERENCE_DISCOUNTS } from '../src/components/billingPricing.js'

const discounts = PH_REFERENCE_DISCOUNTS
const starter = { price_month:350, price_tiers:{1:350,2:700,3:1000,5:1600}, billing_discounts:discounts }

test('monthly is a supported billing option and invalid terms fall back to monthly',()=>{
  assert.equal(BILLING_TERMS.monthly.months,1)
  assert.equal(normalizeBillingCycle('monthly'),'monthly')
  assert.equal(normalizeBillingCycle('invalid'),'monthly')
})
test('all PH plans show the confirmed totals, including the annual discount without stacking free months',()=>{
  for(const [monthly, totals] of [[350,[350,975,1800,3000]],[550,[550,1575,3000,5400]],[750,[750,2175,4200,7800]]]) {
    Object.keys(BILLING_TERMS).forEach((cycle,i)=>assert.equal(prepaidPrice(monthly,cycle,discounts),totals[i]))
  }
})
test('branch packages receive one monthly package discount, including extra branches',()=>{
  assert.equal(planPrice(starter,2,'3_months'),2025)
  assert.equal(planPrice(starter,4,'annual'),18000)
  assert.equal(planPrice(starter,6,'6_months'),11400)
})
test('USD pricing, custom quotes and old API payloads keep their existing multipliers',()=>{
  for(const [cycle,multiplier] of [['monthly',1],['3_months',3],['6_months',6],['annual',10]]) {
    assert.equal(prepaidPrice(15,cycle),15*multiplier)
    assert.equal(prepaidPrice(777,cycle,{}),777*multiplier)
  }
  assert.equal(planPrice({...starter,billing_discounts:undefined},1,'annual'),3500)
})
test('discount badges and billing summaries describe the actual pricing rule',()=>{
  assert.equal(billingSavings('3_months','PHP',discounts),'₱25/month off')
  assert.equal(billingSavings('annual','PHP',discounts),'₱100/month off')
  assert.equal(billingSavings('monthly','PHP',discounts),'')
  assert.equal(billingSavings('annual','USD',{}),'2 months free')
  assert.match(billingSummary('monthly'),/30 days/)
  assert.match(billingSummary('annual','PHP',discounts),/12 months.*₱100\/month off/)
})
