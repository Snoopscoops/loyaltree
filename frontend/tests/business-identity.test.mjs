import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read = path=>readFileSync(new URL(path,import.meta.url),'utf8')
test('public business identity agrees with the server legal operator and versioned documents',()=>{
  const front=JSON.parse(read('../src/legal-content.json'))
  const back=JSON.parse(read('../../backend/legal-content.json'))
  assert.deepEqual(front,back)
  assert.equal(front.operator.name,'LoyaltyTree Information Technology Solutions')
  assert.equal(front.operator.location,'Marilao, Bulacan, Philippines')
  assert.equal(front.operator.entity_type,'Sole proprietorship')
  assert.equal(front.documents.privacy.version,front.versions.privacy)
  assert.equal(front.documents['business-agreement'].version,front.versions.business_agreement)
  assert.ok(!JSON.stringify(front).includes('Isabela, Philippines'))
  assert.ok(read('../../backend/main.py').includes("LOYALTYTREE_LEGAL_LOCATION = 'Marilao, Bulacan, Philippines'"))
  const about=read('../src/components/PublicInfoPage.jsx')
  assert.ok(about.includes('Isabela is part of our founding story, not our current registered business address.'))
  assert.ok(about.includes('policy.operator.location'))
  assert.ok(read('../src/components/HomePage.jsx').includes('policy.operator.location'))
  assert.ok(!about.includes('Isabela, Philippines'))
})
