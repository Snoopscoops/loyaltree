import React, { useEffect, useId, useState } from 'react'

export const posRegisterId = device => String(device?.external_terminal_id || device?.metadata?.external_terminal_id || '').trim()
export const isActivePosDevice = device => !device?.revoked_at && String(device?.status || 'active').toLowerCase() === 'active'

export function registerConflict(devices, value, excludedDeviceId = '') {
  const registerId = String(value || '').trim()
  if (!registerId) return null
  return (devices || []).find(device => isActivePosDevice(device)
    && String(device.id || device.public_id || '') !== String(excludedDeviceId)
    && posRegisterId(device) === registerId) || null
}

export function seenRegisterIds(devices, discovered = []) {
  return [...new Set([
    ...discovered,
    ...(devices || []).flatMap(device => [...(device.seen_register_ids || []), posRegisterId(device)]),
  ].map(value => String(value || '').trim()).filter(Boolean))].sort()
}

export function RegisterIdField({ value, onChange, devices = [], suggestions = [], required = false, disabled = false, detecting = false, onDetect, excludedDeviceId = '' }) {
  const inputId = useId()
  const listId = `${inputId}-registers`
  const conflict = registerConflict(devices, value, excludedDeviceId)
  const choices = seenRegisterIds(devices, suggestions)
  return (
    <div style={{display:'grid',gap:6,minWidth:0}}>
      <label htmlFor={inputId} style={{fontSize:12,fontWeight:800,color:'#334155'}}>StoreHub Register ID{required ? ' *' : ''}</label>
      <div style={{display:'flex',gap:7,flexWrap:'wrap',alignItems:'center'}}>
        <input id={inputId} list={listId} value={value} onChange={event => onChange(event.target.value)} disabled={disabled || detecting}
          maxLength={120} required={required} autoComplete="off" placeholder="Enter this POS machine's registerId"
          style={{flex:'1 1 220px',minWidth:0,width:'100%',boxSizing:'border-box',padding:'10px 11px',border:`1px solid ${conflict ? '#fca5a5' : '#cbd5e1'}`,borderRadius:9,background:'#fff',fontSize:12}} />
        {onDetect && <button type="button" onClick={onDetect} disabled={disabled || detecting}
          style={{border:'1px solid #cbd5e1',background:'#fff',borderRadius:9,padding:'10px 11px',fontWeight:800,fontSize:11,cursor:'pointer'}}>{detecting ? 'Detecting…' : 'Detect registers'}</button>}
      </div>
      <datalist id={listId}>{choices.map(id => {
        const assigned = registerConflict(devices, id, excludedDeviceId)
        return <option key={id} value={id}>{assigned ? `Assigned to ${assigned.display_name || assigned.device_name || 'another POS'}` : 'Seen at this outlet'}</option>
      })}</datalist>
      <div style={{fontSize:11,color:conflict ? '#b91c1c' : '#64748b',lineHeight:1.5}} role={conflict ? 'alert' : undefined}>
        {conflict
          ? `This Register ID is already assigned to ${conflict.display_name || conflict.device_name || 'another active POS'} in this branch.`
          : 'Use the registerId shown in Check POS for this machine. StoreHub outlet ID identifies the branch; Register ID identifies the POS machine. Detection suggests IDs and never assigns one automatically.'}
      </div>
      {!!choices.length && <div style={{fontSize:10.5,color:'#64748b',lineHeight:1.5,overflowWrap:'anywhere'}}>
        Seen / saved IDs: {choices.map(id => {
          const assigned = registerConflict(devices, id, excludedDeviceId)
          return `${id}${assigned ? ` (assigned to ${assigned.display_name || assigned.device_name || 'another POS'})` : ''}`
        }).join(' · ')}
      </div>}
    </div>
  )
}

export function DeviceRegisterEditor({ device, devices, suggestions, disabled, detecting, onDetect, onSave }) {
  const savedId = posRegisterId(device)
  const [value, setValue] = useState(savedId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { setValue(savedId); setError(''); setSaved(false) }, [device?.id, savedId])
  const conflict = registerConflict(devices, value, device.id || device.public_id)
  const save = async () => {
    if (!value.trim() || conflict) return
    setSaving(true); setError(''); setSaved(false)
    try { await onSave(device, value.trim()); setSaved(true) }
    catch (err) { setError(err.message || 'Could not save Register ID.') }
    finally { setSaving(false) }
  }
  return (
    <div style={{display:'grid',gap:8,marginTop:10}}>
      <div style={{fontSize:11,color:savedId ? '#047857' : '#b45309',overflowWrap:'anywhere'}}>Assigned Register ID: <strong>{savedId || 'Not assigned'}</strong></div>
      <RegisterIdField value={value} onChange={next => {setValue(next);setSaved(false)}} devices={devices} suggestions={suggestions}
        disabled={disabled || saving} detecting={detecting} onDetect={onDetect} excludedDeviceId={device.id || device.public_id} />
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <button type="button" onClick={save} disabled={disabled || saving || detecting || !value.trim() || !!conflict || value.trim() === savedId}
          style={{border:'1px solid #0f766e',background:'#f0fdfa',color:'#0f766e',borderRadius:9,padding:'8px 11px',fontWeight:800,fontSize:11,cursor:'pointer'}}>{saving ? 'Saving…' : 'Save Register ID'}</button>
        {saved && <span style={{fontSize:11,color:'#047857'}} role="status">Register ID saved.</span>}
      </div>
      {error && <div style={{fontSize:11,color:'#b91c1c'}} role="alert">{error}</div>}
    </div>
  )
}
