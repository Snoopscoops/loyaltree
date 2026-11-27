import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { adminCountLabel } from '../src/components/adminData.js'

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
