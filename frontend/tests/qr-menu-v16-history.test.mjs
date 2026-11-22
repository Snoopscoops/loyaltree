import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const page = readFileSync(new URL('../src/components/QRMenuPage.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/components/qr-menu-v15.css', import.meta.url), 'utf8')
test('card history has independent activity, orders and rewards sections', () => {
  assert.match(page, /\['activity','Activity'\]/)
  assert.match(page, /\['orders','Orders'\]/)
  assert.match(page, /\['rewards','Rewards'\]/)
  assert.match(page, /\/card\/\$\{path\}/)
  assert.match(page, /total_spent/)
  assert.match(page, /linked digital-menu orders/)
  assert.match(page, /No linked menu orders yet/)
  assert.match(css, /lt-v16-order-totals/)
})
