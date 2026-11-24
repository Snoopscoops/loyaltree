import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isPendingPOS, mappedPendingBranches } from '../src/components/pendingPOSPairing.js'

test('pending is not a ready POS, but existing legacy and verified devices are', () => {
  assert.equal(isPendingPOS({pairing_status:'pending_verification'}), true)
  assert.equal(isPendingPOS({metadata:{pairing_verification:'pending'},external_terminal_id:'r'}),true)
  assert.equal(isPendingPOS({metadata:{pairing_verification:'verified'}}),true)
  assert.equal(isPendingPOS({metadata:{pairing_verification:'verified'},external_terminal_id:'r'}),false)
  assert.equal(isPendingPOS({provider:'loyverse'}),false)
  assert.equal(isPendingPOS({provider:'storehub',external_terminal_id:'r'}),false)
})
test('only active saved mappings belonging to detected outlets may issue pending codes', () => {
  const branches=[{public_id:'a'},{public_id:'b'},{public_id:'c',is_active:false},{public_id:'d'},{public_id:'e'}]
  const mappings={a:{saved_mapping:true,external_branch_id:'one'},b:{saved_mapping:true,is_active:false,external_branch_id:'one'},c:{saved_mapping:true,external_branch_id:'one'},d:{saved_mapping:true,external_branch_id:'other'},e:{saved_mapping:false,external_branch_id:'one'}}
  assert.deepEqual(mappedPendingBranches(branches,mappings,[{id:'one'}]),[branches[0]])
  assert.deepEqual(mappedPendingBranches(branches,mappings,[]),[])
})
test('dashboard uses explicit pending-only code independent of legacy transaction gate', () => {
  const page=readFileSync(new URL('../src/components/POSIntegration.jsx',import.meta.url),'utf8')
  const panel=readFileSync(new URL('../src/components/PendingPOSPairing.jsx',import.meta.url),'utf8')
  assert.match(page,/provider === 'storehub' && apiAvailable && isConnected && storeHubAccountLinked && !simulatorReady/)
  assert.match(page,/activeDeviceCount: activeDevicesForQuickBranch\.filter\(device => !isPendingPOS\(device\)\)\.length/)
  assert.match(panel,/pending_verification:true/)
  assert.match(panel,/external_terminal_id:null/)
  assert.match(panel,/result\.pairing_status !== 'pending_verification'/)
  assert.match(panel,/physical_receipt_confirmed:true/)
  assert.match(panel,/receipt\.trim\(\) !== proof\.provider_receipt_number/)
})
