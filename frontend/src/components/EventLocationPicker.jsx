import React, { useEffect, useId, useRef, useState } from 'react'
import { NearbyPinMap } from './OwnerAutomations'
import { locationErrorMessage } from './eventNotificationSettings'
import './event-notifications.css'

export default function EventLocationPicker({ message, onMessageChange, latitude, longitude, radius, onChange, onRadiusChange, disabled = false }) {
  const id = useId()
  const [locating, setLocating] = useState(false)
  const [status, setStatus] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (latitude === '' && longitude === '') setStatus('') }, [latitude, longitude])
  const useLocation = () => {
    if (!navigator.geolocation) { setStatus('This browser does not support location access. Place the pin on the map instead.'); return }
    setLocating(true)
    setStatus('Finding your current location…')
    navigator.geolocation.getCurrentPosition(position => {
      if (!mounted.current) return
      onChange({ latitude: Number(position.coords.latitude.toFixed(6)), longitude: Number(position.coords.longitude.toFixed(6)) })
      setLocating(false)
      setStatus('Pin placed at your current location. Save the event to keep it.')
    }, error => {
      if (!mounted.current) return
      setLocating(false)
      setStatus(locationErrorMessage(error))
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
  }
  const updatePin = point => {
    setStatus('Venue pin updated. Save the event to keep it.')
    onChange(point)
  }
  const previewRadius = Math.max(50, Math.min(1000, Number(radius) || 200))
  return <section className="lt-event-location" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}>📍 Nearby notification</h3>
    <p>Use your phone’s current location, click the map, or drag the pin to the event venue.</p>
    <label htmlFor={`${id}-message`}>Nearby message</label>
    <textarea id={`${id}-message`} value={message} onChange={e => onMessageChange(e.target.value)} maxLength={120} rows={3} disabled={disabled} placeholder="You’re near the venue! Show your ticket." />
    <div className="lt-event-message-actions"><span>{message.length}/120 characters</span><button type="button" onClick={useLocation} disabled={disabled || locating}>{locating ? 'Finding location…' : 'Use my current location'}</button></div>
    {status && <p role="status" className="lt-event-location-status">{status}</p>}
    <NearbyPinMap latitude={latitude} longitude={longitude} radius={previewRadius} onMove={(lat, lng) => updatePin({ latitude: lat, longitude: lng })} />
    <div className="lt-event-coordinate-fields">
      <label>Latitude<input aria-label="Event latitude" inputMode="decimal" value={latitude} onChange={e => updatePin({ latitude: e.target.value, longitude })} disabled={disabled} placeholder="14.5995" /></label>
      <label>Longitude<input aria-label="Event longitude" inputMode="decimal" value={longitude} onChange={e => updatePin({ latitude, longitude: e.target.value })} disabled={disabled} placeholder="120.9842" /></label>
    </div>
    <label htmlFor={`${id}-radius`}>Notification radius: {previewRadius} m</label>
    <div className="lt-event-radius-controls">
      <input id={`${id}-radius`} aria-label="Event notification radius" type="range" min="50" max="1000" step="10" value={previewRadius} onChange={e => onRadiusChange(e.target.value)} disabled={disabled} />
      <input aria-label="Event radius in meters" type="number" min="50" max="1000" step="10" value={radius} onChange={e => onRadiusChange(e.target.value)} disabled={disabled} /><span>m</span>
    </div>
    <p className="lt-event-delivery-note">The circle previews your selected radius. Apple applies it within system limits; Google Wallet chooses its own nearby distance and notification timing.</p>
    <p className="lt-event-delivery-note">Location and message are saved when you save or publish this event.</p>
  </section>
}
