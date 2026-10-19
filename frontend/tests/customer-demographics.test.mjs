import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { validCustomerDemographics } from '../src/components/customerDemographicsModel.js'

const reports = JSON.parse(readFileSync(new URL('../dev/customer-demographics-sample.json', import.meta.url)))
test('complete, privacy-limited and stale customer reports are renderable without treating hidden groups as zero', () => {
  for (const report of Object.values(reports)) assert.equal(validCustomerDemographics(report), true)
  assert.equal(reports.small.age.available, false)
  assert.equal(reports.small.age.rows.every(row => row.count === null), true)
  assert.equal(reports.stale.stale, true)
})
test('partial, malformed and invalid numeric reports are rejected before they can blank the admin page', () => {
  for (const body of [null, {}, { summary: {} }, { ...reports.complete, age: {} }, { ...reports.complete, summary: { ...reports.complete.summary, customers: -1 } }, { ...reports.complete, generated_at: 'invalid date' }]) assert.equal(validCustomerDemographics(body), false)
  const invalid = structuredClone(reports.complete)
  invalid.gender.rows[0].percent = 500
  assert.equal(validCustomerDemographics(invalid), false)
  const invalidRow = structuredClone(reports.complete)
  invalidRow.age.rows[0] = null
  assert.equal(validCustomerDemographics(invalidRow), false)
})
