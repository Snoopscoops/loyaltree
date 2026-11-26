import test from 'node:test'
import assert from 'node:assert/strict'
import {readBookingCardToken,bookingCardName} from '../src/components/bookingContactModel.js'
test('booking reads only the exact business card token and handles blocked storage',()=>{
 const storage={getItem:key=>({'lt-menu-card:one':'token-one','lt-menu-card:two':'token-two'}[key]||null)}
 assert.equal(readBookingCardToken(storage,'one'),'token-one')
 assert.equal(readBookingCardToken(storage,'two'),'token-two')
 assert.equal(readBookingCardToken(storage,'other'),'')
 assert.equal(readBookingCardToken({getItem(){throw Error('blocked')}},'one'),'')
})
test('booking only prefills meaningful customer names',()=>{
 assert.equal(bookingCardName('  Maria Santos  '),'Maria Santos')
 assert.equal(bookingCardName('Loyalty card'),'')
 assert.equal(bookingCardName('Customer'),'')
 assert.equal(bookingCardName(null),'')
 assert.equal(bookingCardName('x'.repeat(150)).length,100)
})
