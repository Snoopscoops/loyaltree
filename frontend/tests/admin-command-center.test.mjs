import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { adminCountLabel, specialInvoiceSnapshot } from '../src/components/adminData.js'

test('unknown or invalid counts are not represented as measured zero', () => {
  for (const value of [undefined,null,NaN,Infinity,-1,'0',{},false]) assert.equal(adminCountLabel(value),'—')
  assert.equal(adminCountLabel(0),'0')
  assert.equal(adminCountLabel(1000),'1,000')
})
test('every existing admin destination remains reachable in exactly one group', () => {
  const source = readFileSync(new URL('../src/components/AdminDashboard.jsx',import.meta.url),'utf8')
  const tabs = source.split('const adminTabs = [')[1].split('const activeAdminTabMeta')[0]
  const groups = source.split('const adminGroups = [')[1].split('const activeGroup')[0]
  const keys = [...tabs.matchAll(/key:'([^']+)'/g)].map(m=>m[1]).sort()
  const grouped = [...groups.matchAll(/tabs:\[([^\]]+)\]/g)].flatMap(m=>[...m[1].matchAll(/'([^']+)'/g)].map(k=>k[1])).sort()
  assert.equal(keys.length,13)
  assert.deepEqual(grouped,keys)
})

test('invoice status counts exclude voids and reject duplicate or absent identities', () => {
  const rows = ['paid','overdue','sent','void'].map((status,i)=>({public_id:String(i),status}))
  assert.deepEqual(specialInvoiceSnapshot(rows),{issued:3,paid:1,overdue:1,review:1,voided:1})
  assert.equal(specialInvoiceSnapshot([...rows,rows[0]]),null)
  assert.equal(specialInvoiceSnapshot(null),null)
  assert.equal(specialInvoiceSnapshot([{status:'paid'}]),null)
})
