import React, { useEffect, useState } from 'react'

import { isPendingPOS, mappedPendingBranches } from './pendingPOSPairing.js'

const panel = { border:'1px solid #cbd5e1', borderRadius:12, padding:16, display:'grid', gap:12, background:'#fff' }
const field = { display:'grid', gap:5, fontSize:13, fontWeight:600 }
const input = { padding:10, border:'1px solid #cbd5e1', borderRadius:8, width:'100%', boxSizing:'border-box' }
const button = { padding:'10px 14px', border:'1px solid #0f766e', borderRadius:8, background:'#f0fdfa', color:'#115e59', fontWeight:700 }
const note = { fontSize:12, color:'#475569', lineHeight:1.5 }

export default function PendingPOSPairing({ branches, mappings, locations, devices, request, refreshDevices }) {
  const mapped = mappedPendingBranches(branches, mappings, locations)
  const [branchId, setBranchId] = useState('')
  const branch = mapped.find(b => b.public_id === branchId) || mapped[0]
  const mapping = mappings[branch?.public_id]
  const [name, setName] = useState('')
  const [code, setCode] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = devices.filter(d => d.provider === 'storehub' && d.status === 'active' && !d.revoked_at &&
    d.branch_public_id === branch?.public_id && isPendingPOS(d))
  const [selectedDevice, setSelectedDevice] = useState('')
  const device = pending.find(d => String(d.id) === selectedDevice)
  const [evidence, setEvidence] = useState([])
  const [chosen, setChosen] = useState('')
  const [receipt, setReceipt] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const proof = evidence.find((row, i) => String(i) === chosen)
  const assignedElsewhere = proof && devices.some(d => d.status === 'active' && !d.revoked_at && d.provider === 'storehub' &&
    d.branch_public_id === branch?.public_id && String(d.id) !== String(device?.id) &&
    String(d.external_terminal_id || d.metadata?.external_terminal_id || '').trim() === proof.terminal_id)
  const clearEvidence = () => { setEvidence([]); setChosen(''); setReceipt(''); setConfirmed(false) }
  useEffect(() => { setCode(null); setSelectedDevice(''); clearEvidence(); setNotice(''); setError('') }, [branch?.public_id, mapping?.external_branch_id])
  useEffect(() => { clearEvidence(); setNotice(''); setError('') }, [selectedDevice])
  const run = async action => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (err) { setError(err.message || 'POS setup request failed.') }
    finally { setBusy(false) }
  }
  const generate = () => run(async () => {
    setCode(null)
    const result = await request('device-activation-code', { provider:'storehub', pending_verification:true,
      branch_public_id:branch.public_id, external_branch_id:String(mapping.external_branch_id),
      external_branch_name:mapping.external_branch_name || null, external_terminal_id:null,
      device_name:name.trim() || `${branch.name || 'Branch'} POS`, expires_in_minutes:15, max_uses:1 })
    if (!result.activation_code || result.pairing_status !== 'pending_verification') throw new Error('Backend did not issue a pending-only code. Do not activate; check deployment.')
    setCode(result)
  })
  const refreshEvidence = () => run(async () => {
    clearEvidence()
    const result = await request(`devices/${encodeURIComponent(device.id)}/pending-register-evidence`)
    if (result.pairing_status !== 'pending_verification' || !Array.isArray(result.transactions)) throw new Error('Pending device status changed. Refresh devices.')
    setEvidence(result.transactions)
    setNotice(result.transactions.length ? 'Compare a physical receipt from this POS before selecting a matching transaction.' : 'No eligible receipts since activation. Wait for a normal completed sale on this POS, then refresh.')
  })
  const verify = () => run(async () => {
    if (!device || !proof || !confirmed || receipt.trim() !== proof.provider_receipt_number || assignedElsewhere) return
    const result = await request(`devices/${encodeURIComponent(device.id)}/verify-register`, {
      external_transaction_id:proof.external_transaction_id, external_terminal_id:proof.terminal_id,
      receipt_number:receipt.trim(), physical_receipt_confirmed:true })
    if (result.pairing_status !== 'verified') throw new Error('Register verification did not complete.')
    clearEvidence(); setSelectedDevice(''); await refreshDevices()
    setNotice('Register verified. Go Live, transaction and redemption safeguards still apply.')
  })
  if (!mapped.length) return <section style={panel}><strong>Pair new POS (pending)</strong><div style={note}>Save an active branch mapping to an actual StoreHub outlet first.</div></section>
  return <section style={panel} aria-label="Pair new POS pending verification">
    <strong>Pair New POS · Verify Register Later</strong>
    <div style={note}>For a new or replacement StoreHub terminal. Initial activation needs no Register ID or transaction-read permission. Check POS is read-only until verification; loyalty actions stay locked.</div>
    <label style={field}>Mapped branch<select style={input} value={branch.public_id} disabled={busy} onChange={e => setBranchId(e.target.value)}>{mapped.map(b => <option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></label>
    <div style={note}>StoreHub outlet: {mapping.external_branch_name || mapping.external_branch_id}</div>
    <label style={field}>New device name<input style={input} value={name} maxLength={120} disabled={busy} onChange={e => { setName(e.target.value);setCode(null) }} placeholder={`${branch.name} POS`} /></label>
    <button type="button" style={button} disabled={busy} onClick={generate}>Generate pending activation code</button>
    {code && <div style={panel}><strong style={{fontSize:28, letterSpacing:4}}>{code.activation_code}</strong><div style={note}>Single use · expires {new Date(code.expires_at).toLocaleTimeString()} · Enter in updated Companion. Register ID is not assigned.</div></div>}
    <button type="button" style={button} disabled={busy} onClick={() => run(refreshDevices)}>Refresh activated devices</button>
    <label style={field}>Pending device<select style={input} value={selectedDevice} disabled={busy} onChange={e => setSelectedDevice(e.target.value)}><option value="">Choose pending device…</option>{pending.map(d => <option key={d.id} value={String(d.id)}>{d.display_name || d.id} — Pending verification</option>)}</select></label>
    {device && <>
      <div style={note}>Use the receipt from a normal completed sale made after activation on this exact POS. Do not select another terminal's receipt.</div>
      <button type="button" style={button} disabled={busy} onClick={refreshEvidence}>Check POS · Get recent receipts</button>
      {evidence.length > 0 && <>
        <label style={field}>Match receipt from this physical POS<select style={input} value={chosen} disabled={busy} onChange={e => {setChosen(e.target.value);setReceipt('');setConfirmed(false)}}><option value="">Choose matching receipt…</option>{evidence.map((r,i) => <option key={`${r.external_transaction_id}-${i}`} value={String(i)}>{r.provider_receipt_number} · {r.transacted_at} · {r.gross_amount} · Register {r.terminal_id}</option>)}</select></label>
        {proof && <>
          <label style={field}>Enter exact receipt number from POS<input style={input} value={receipt} disabled={busy} maxLength={200} onChange={e => {setReceipt(e.target.value);setConfirmed(false)}} /></label>
          <label style={note}><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /> I confirm this receipt was printed by the selected physical POS.</label>
          {assignedElsewhere && <div role="alert" style={{color:'#b91c1c'}}>This Register ID is assigned to another active device. Do not reuse it; review the old pairing.</div>}
          <button type="button" style={button} disabled={busy || !confirmed || receipt.trim() !== proof.provider_receipt_number || !!assignedElsewhere} onClick={verify}>Verify and bind Register ID</button>
        </>}
      </>}
    </>}
    {error && <div role="alert" style={{color:'#b91c1c',fontSize:13}}>{error}</div>}
    {notice && <div role="status" style={note}>{notice}</div>}
  </section>
}
