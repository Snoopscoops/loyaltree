import test from 'node:test'
import assert from 'node:assert/strict'
import { eventLocationPayload, locationErrorMessage } from '../src/components/eventNotificationSettings.js'

test('events without a pin keep location optional and retain the chosen radius', () => {
  assert.deepEqual(eventLocationPayload(), { geo_latitude:null,geo_longitude:null,geo_radius_meters:200 })
  assert.deepEqual(eventLocationPayload({radius:'500'}), { geo_latitude:null,geo_longitude:null,geo_radius_meters:500 })
})
test('phone and map coordinates serialize without losing zero coordinates', () => {
  assert.deepEqual(eventLocationPayload({latitude:'0',longitude:120.9842,radius:'350'}), {geo_latitude:0,geo_longitude:120.9842,geo_radius_meters:350})
  assert.equal(eventLocationPayload({latitude:14.5995,longitude:0,radius:50}).geo_longitude, 0)
})
test('partial and invalid pins cannot silently become a different venue', () => {
  for (const pin of [{latitude:'14.5'},{longitude:120},{latitude:' ',longitude:120},{latitude:91,longitude:120},{latitude:14,longitude:-181},{latitude:'NaN',longitude:120}]) {
    assert.throws(() => eventLocationPayload(pin))
  }
})
test('radius must be a whole number within the supported 50–1000 meter range', () => {
  for (const radius of ['', 'bad', 49,1001,99.5,Infinity]) assert.throws(() => eventLocationPayload({radius}))
  assert.equal(eventLocationPayload({radius:1000}).geo_radius_meters,1000)
})
test('location permission and timeout failures keep manual pin placement available', () => {
  assert.match(locationErrorMessage({code:1}), /denied.*pin on the map/)
  assert.match(locationErrorMessage({code:3}), /timed out/)
  assert.match(locationErrorMessage({code:2}), /unavailable/)
})
