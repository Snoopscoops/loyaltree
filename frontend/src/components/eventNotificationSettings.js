export function eventLocationPayload({ latitude = '', longitude = '', radius = 200 } = {}) {
  const empty = value => value == null || String(value).trim() === ''
  const distance = Number(radius)
  if (empty(radius) || !Number.isInteger(distance) || distance < 50 || distance > 1000) {
    throw new Error('Choose a notification radius from 50 to 1,000 meters.')
  }
  if (empty(latitude) && empty(longitude)) return { geo_latitude: null, geo_longitude: null, geo_radius_meters: distance }
  if (empty(latitude) || empty(longitude)) throw new Error('Place a venue pin or enter both latitude and longitude.')
  const lat = Number(latitude), lng = Number(longitude)
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new Error('Enter a valid latitude (−90 to 90) and longitude (−180 to 180).')
  }
  return { geo_latitude: lat, geo_longitude: lng, geo_radius_meters: distance }
}

export function locationErrorMessage(error) {
  if (error?.code === 1) return 'Location access was denied. You can allow it in browser settings, or place the pin on the map.'
  if (error?.code === 3) return 'Finding your location timed out. Try again or place the pin on the map.'
  return 'Your current location is unavailable. Place the venue pin on the map or enter coordinates.'
}
