import React, { useState, useEffect } from 'react'

// Car Lending / Showroom dashboard build, step by step:
//   - Step 1 (done): Header + tab nav
//   - Step 2 (done): Customers tab - cl_customers CRUD
//   - Step 3 (done): Inventory tab - vehicles CRUD. Add/Edit vehicle
//     captures "Price to sell" (shown on the public showroom) separately
//     from "Total cost to buy" (what the business paid to acquire the
//     unit - internal only, never sent to the showroom) plus which Agent
//     is handling the unit.
//   - Step 4 (done): Contracts tab - link customer + vehicle. No
//     markup/interest - for financed deals the owner enters the monthly
//     payment and term directly, and vehicle price auto-computes from those
//     (down payment + monthly payment x term). Also supports
//     transferring an already-in-progress loan (an existing customer/car
//     already mid-payment before this dashboard existed) via the "existing
//     loan" toggle, which reveals manual overrides for balance remaining,
//     last paid date, next due date, and status.
//   - Step 5 (done): Payment tracking - log a payment against a contract
//     (auto-updates balance/last paid/next due, clears overdue, closes the
//     loan out at zero). No payment portal - the owner logs payments from
//     this dashboard, either by picking a contract directly or scanning a
//     buyer's QR code (camera, via the BarcodeDetector API where supported)
//     to jump straight to their contract. Buyers now DO get their own
//     wallet pass (a "Loan Card" showing balance + next due date, 0/0 if
//     they have no active loan) - share the link from the customer edit
//     modal's "Copy wallet link" button, or let them scan the same printed
//     QR from their phone once they've added it. 7-day / 3-day / due-date /
//     overdue reminders push straight to that Wallet card server-side via
//     the /api/v1/cron/loan-payment-reminders cron job - wallet push only,
//     no email. Owner -> buyer messages (one buyer, or broadcast to
//     everyone, "Message all" under the Customers tab) also push to the
//     Wallet card the same way - dealership-wide broadcasts reach every
//     buyer's card at once, including ones with no active loan, so the
//     whole membership can be reached regardless of loan status. This is
//     the dashboard's one messaging surface - the Overview tab used to
//     have its own separate "Announcements" panel (generic loyalty
//     endpoints) but it was removed as redundant with Message all.
//   - Step 6 (done): Per-customer payment history/receipts - a "History"
//     button on each customer card pulls every payment across ALL of their
//     contracts (not just the currently-open one), each with a printable
//     receipt (business, buyer, vehicle, amount, method, balance after,
//     receipt #). Overview stat cards are live (not placeholders).
//   - Buyer self-signup: a dealership-wide "Join QR" (Customers tab) opens
//     /cl-join/{business_public_id} - a buyer scans it, registers
//     themselves (name/phone/email/address), and adds their Loan Card to
//     Google/Apple Wallet on the spot, no owner data entry required.
//   - Payment editing: the owner can edit a logged payment's method/notes
//     at any time; amount/date are editable only on the contract's most
//     recent payment (older ones must be undone-and-relogged, so
//     balance_remaining never silently drifts).
//   - Net income + top agent (Overview tab): each contract's profit is its
//     sale price minus the vehicle's total_cost. Summed into This week /
//     month / quarter / year cards, and rolled up per agent (via the
//     vehicle's agent_name) into a ranked list with a top-agent badge.


// Buyers' wallet-pass QR encodes a full /cl-wallet/{public_id} URL, so
// scanning it with any ordinary camera app opens their "check your card"
// page (balance, next due date, Browse Showroom). Their printed/lookup QR
// (get_cl_customer_qr_code) still encodes the bare public_id. Either one
// read back by this same owner's "Scan QR" button below jumps straight to
// their contract - handleScanResult accepts both formats, pulling the id
// out of the URL when it's a URL.
function useBarcodeScanner(onResult) {
  const videoRef = React.useRef(null)
  const streamRef = React.useRef(null)
  const rafRef = React.useRef(null)

  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const stop = React.useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  const start = React.useCallback(async () => {
    if (!supported) return
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      const tick = async () => {
        if (!videoRef.current) return
        try {
          const codes = await detector.detect(videoRef.current)
          if (codes.length > 0) {
            onResult(codes[0].rawValue)
            stop()
            return
          }
        } catch (err) {
          // transient decode error - keep scanning
        }
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      console.error('Camera/scanner error:', err)
    }
  }, [supported, onResult, stop])

  React.useEffect(() => () => stop(), [stop])

  return { videoRef, supported, start, stop }
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'customers', label: 'Customers' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'payments', label: 'Payments' },
  { key: 'applications', label: 'Applications' },
]

const APPLICATION_ROLES = [
  { key: 'agent', label: 'Agents Application' },
  { key: 'buyer', label: 'Buyers Application' },
  { key: 'seller', label: 'Sellers Application' },
]

// Renders backend-generated QR SVGs as an <img> (data URI) instead of
// injecting the raw markup into the DOM via dangerouslySetInnerHTML. Inline
// SVG injected that way is part of the page's own DOM and inherits the
// page's CSS cascade, so a global style rule elsewhere (fill/color resets
// etc.) can silently blank out the QR modules while the white background
// still shows through. An <img> renders the SVG in an isolated document
// context that the page's CSS can't reach, and if the SVG were ever
// malformed you'd see an honest broken-image icon instead of a blank box.
function svgToDataUri(svg) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Add/Edit vehicle modal. Owns its own form + photo-upload state so it can
// be dropped in anywhere without the parent wiring up a vehicleForm object.
// Photo upload goes through Cloudinary's SIGNED upload flow (preset
// "LoyaltyTree_Images" is signed, not unsigned) - the browser can't sign
// the request itself, so it first asks our backend for a short-lived
// signature (POST /cloudinary-signature, the only place holding the API
// secret), then uploads straight to Cloudinary using that signature.
// Saving the vehicle (POST/PATCH .../vehicles) is what makes it show up
// on (or drop off) the public showroom - see backend comments.
// Shared Cloudinary signed-upload helper - used by AddVehicleModal (vehicle
// photos) and the Showroom settings panel (hero banner). Preset
// "LoyaltyTree_Images" is signed, so this always goes through our own
// backend first to get a short-lived signature (POST .../cloudinary-signature)
// before uploading straight to Cloudinary. Throws on any failure; caller
// decides how to surface it.
async function uploadImageToCloudinary(apiBase, businessId, file, purpose) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image file')
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Image must be smaller than 10MB')
  }
  const sigUrl = `${apiBase}/api/v1/business/${businessId}/cloudinary-signature${purpose ? `?purpose=${purpose}` : ''}`
  const sigRes = await fetch(sigUrl, { method: 'POST' })
  const sig = await sigRes.json().catch(() => ({}))
  if (!sigRes.ok) throw new Error(sig.detail || 'Could not get upload signature')

  // Must match exactly what the backend signed: folder, timestamp,
  // upload_preset - plus file/api_key/signature, which are never part of
  // the signed string itself.
  const uploadData = new FormData()
  uploadData.append('file', file)
  uploadData.append('api_key', sig.api_key)
  uploadData.append('timestamp', sig.timestamp)
  uploadData.append('signature', sig.signature)
  uploadData.append('upload_preset', sig.upload_preset)
  uploadData.append('folder', sig.folder)

  const cloudRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
    method: 'POST',
    body: uploadData,
  })
  const cloudData = await cloudRes.json().catch(() => ({}))
  if (!cloudRes.ok) throw new Error((cloudData.error && cloudData.error.message) || 'Image upload failed')
  return cloudData.secure_url
}

const VEHICLE_MAX_PHOTOS = 10
const CONTRACT_MAX_IMAGES = 5

function AddVehicleModal({ open, vehicle, apiBase, businessId, onClose, onSaved }) {
  const emptyForm = { make: '', model: '', year: '', plate_number: '', plate_end_in: '', color: '', mileage: '', transmission: '', fuel_type: '', price: '', total_cost: '', agent_name: '', status: 'available' }
  const [form, setForm] = useState(emptyForm)
  const [imageUrls, setImageUrls] = useState([]) // up to VEHICLE_MAX_PHOTOS Cloudinary URLs, shown as a gallery on the showroom card
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = React.useRef(null)

  useEffect(() => {
    if (!open) return
    if (vehicle) {
      setForm({
        make: vehicle.make || '',
        model: vehicle.model || '',
        year: vehicle.year ?? '',
        plate_number: vehicle.plate_number || '',
        plate_end_in: vehicle.plate_end_in || '',
        color: vehicle.color || '',
        mileage: vehicle.mileage ?? '',
        transmission: vehicle.transmission || '',
        fuel_type: vehicle.fuel_type || '',
        price: vehicle.price ?? '',
        total_cost: vehicle.total_cost ?? '',
        agent_name: vehicle.agent_name || '',
        status: vehicle.status || 'available',
      })
      setImageUrls(vehicle.image_urls && vehicle.image_urls.length ? vehicle.image_urls : (vehicle.image_url ? [vehicle.image_url] : []))
    } else {
      setForm(emptyForm)
      setImageUrls([])
    }
    setError('')
    setUploading(false)
  }, [open, vehicle])

  if (!open) return null

  const slotsLeft = VEHICLE_MAX_PHOTOS - imageUrls.length

  // Uploads as many of the given files as fit within the 5-photo cap, one at
  // a time (Cloudinary signatures are single-use-ish and this keeps upload
  // order == display order). Stops early and reports how many were skipped
  // if the batch would go over the cap.
  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    setError('')
    const toUpload = files.slice(0, slotsLeft)
    const skipped = files.length - toUpload.length
    setUploading(true)
    const uploaded = []
    try {
      for (const file of toUpload) {
        const url = await uploadImageToCloudinary(apiBase, businessId, file)
        uploaded.push(url)
      }
      if (uploaded.length) setImageUrls(prev => [...prev, ...uploaded])
      if (skipped > 0) setError(`Only added ${uploaded.length} photo${uploaded.length === 1 ? '' : 's'} - limit is ${VEHICLE_MAX_PHOTOS} per vehicle`)
    } catch (err) {
      if (uploaded.length) setImageUrls(prev => [...prev, ...uploaded])
      setError(err.message)
    }
    setUploading(false)
  }

  const removeImage = (idx) => {
    setImageUrls(prev => prev.filter((_, i) => i !== idx))
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragActive(false)
    if (slotsLeft <= 0) { setError(`You can add up to ${VEHICLE_MAX_PHOTOS} photos per vehicle`); return }
    uploadFiles(e.dataTransfer.files)
  }

  const handleSave = async () => {
    if (!form.make.trim() || !form.model.trim()) {
      setError('Make and model are required')
      return
    }
    if (uploading) {
      setError('Please wait for photos to finish uploading')
      return
    }
    setSaving(true)
    setError('')
    try {
      const url = vehicle
        ? `${apiBase}/api/v1/business/${businessId}/vehicles/${vehicle.public_id}`
        : `${apiBase}/api/v1/business/${businessId}/vehicles`
      const res = await fetch(url, {
        method: vehicle ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          make: form.make,
          model: form.model,
          year: form.year !== '' ? Number(form.year) : null,
          plate_number: form.plate_number || null,
          plate_end_in: form.plate_end_in || null,
          color: form.color || null,
          mileage: form.mileage !== '' ? Number(form.mileage) : null,
          transmission: form.transmission || null,
          fuel_type: form.fuel_type || null,
          price: form.price !== '' ? Number(form.price) : 0,
          total_cost: form.total_cost !== '' ? Number(form.total_cost) : 0,
          agent_name: form.agent_name || null,
          status: form.status,
          image_urls: imageUrls,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Save failed')
      onSaved(vehicle ? 'Vehicle updated' : 'Vehicle added')
      onClose()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <h3 style={styles.modalTitle}>{vehicle ? 'Edit vehicle' : 'Add vehicle'}</h3>

        <div style={styles.photoGrid}>
          {imageUrls.map((url, idx) => (
            <div key={url + idx} style={styles.photoThumbWrap}>
              <img src={url} alt={`Vehicle ${idx + 1}`} style={styles.photoThumb} />
              {idx === 0 && <span style={styles.photoMainBadge}>Main</span>}
              <button
                type="button"
                onClick={() => removeImage(idx)}
                style={styles.photoRemoveBtn}
                aria-label="Remove photo"
              >×</button>
            </div>
          ))}
          {slotsLeft > 0 && (
            <div
              style={{ ...styles.photoAddTile, ...(dragActive ? styles.uploadZoneActive : {}) }}
              onClick={() => !uploading && fileInputRef.current && fileInputRef.current.click()}
              onDragOver={e => { e.preventDefault(); setDragActive(true) }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={e => uploadFiles(e.target.files)}
              />
              {uploading ? (
                <div style={styles.uploadHint}>Uploading…</div>
              ) : (
                <div style={styles.uploadHint}>📷 Add photo</div>
              )}
            </div>
          )}
        </div>
        <div style={styles.photoCountHint}>{imageUrls.length}/{VEHICLE_MAX_PHOTOS} photos {imageUrls.length > 1 ? '· first photo is the cover shown on the showroom' : ''}</div>

        <div style={styles.formGrid}>
          <label style={styles.label}>Make</label>
          <input
            style={styles.input}
            value={form.make}
            onChange={e => setForm({ ...form, make: e.target.value })}
            placeholder="e.g. Toyota"
          />
          <label style={styles.label}>Model</label>
          <input
            style={styles.input}
            value={form.model}
            onChange={e => setForm({ ...form, model: e.target.value })}
            placeholder="e.g. Vios"
          />
          <label style={styles.label}>Year</label>
          <input
            type="number"
            style={styles.input}
            value={form.year}
            onChange={e => setForm({ ...form, year: e.target.value })}
            placeholder="e.g. 2021"
          />
          <label style={styles.label}>Plate number</label>
          <input
            style={styles.input}
            value={form.plate_number}
            onChange={e => setForm({ ...form, plate_number: e.target.value })}
            placeholder="e.g. ABC 1234"
          />
          <label style={styles.label}>Plate ends in</label>
          <input
            style={styles.input}
            value={form.plate_end_in}
            onChange={e => setForm({ ...form, plate_end_in: e.target.value })}
            placeholder="e.g. 4 - for number coding"
            maxLength={4}
          />
          <label style={styles.label}>Color</label>
          <input
            style={styles.input}
            value={form.color}
            onChange={e => setForm({ ...form, color: e.target.value })}
          />
          <label style={styles.label}>Mileage (km)</label>
          <input
            type="number"
            style={styles.input}
            value={form.mileage}
            onChange={e => setForm({ ...form, mileage: e.target.value })}
          />
          <label style={styles.label}>Transmission</label>
          <select
            style={styles.select}
            value={form.transmission}
            onChange={e => setForm({ ...form, transmission: e.target.value })}
          >
            <option value="">Select…</option>
            <option value="automatic">Automatic</option>
            <option value="manual">Manual</option>
          </select>
          <label style={styles.label}>Fuel type</label>
          <select
            style={styles.select}
            value={form.fuel_type}
            onChange={e => setForm({ ...form, fuel_type: e.target.value })}
          >
            <option value="">Select…</option>
            <option value="gasoline">Gasoline</option>
            <option value="diesel">Diesel</option>
            <option value="hybrid">Hybrid</option>
            <option value="electric">Electric</option>
          </select>
          <label style={styles.label}>Price to sell (₱)</label>
          <input
            type="number"
            style={styles.input}
            value={form.price}
            onChange={e => setForm({ ...form, price: e.target.value })}
          />
          <label style={styles.label}>Total cost to buy (₱)</label>
          <input
            type="number"
            style={styles.input}
            value={form.total_cost}
            onChange={e => setForm({ ...form, total_cost: e.target.value })}
            placeholder="Acquisition cost - not shown on the showroom"
          />
          <label style={styles.label}>Agent</label>
          <input
            style={styles.input}
            value={form.agent_name}
            onChange={e => setForm({ ...form, agent_name: e.target.value })}
            placeholder="e.g. Juan Dela Cruz"
          />
          <label style={styles.label}>Status</label>
          <select
            style={styles.select}
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value })}
          >
            <option value="available">Available</option>
            <option value="reserved">Reserved</option>
            <option value="financed">Financed</option>
            <option value="sold">Sold</option>
          </select>
        </div>

        {error && <div style={styles.uploadError}>{error}</div>}

        <div style={styles.modalActions}>
          <button onClick={onClose} style={styles.closeBtn}>Cancel</button>
          <button onClick={handleSave} disabled={saving || uploading} style={styles.saveBtn}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CarLendingDashboard({ API_BASE, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('overview')
  const [incomePeriod, setIncomePeriod] = useState('week') // which bucket the Overview net-income card shows
  const [business, setBusiness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  // ---------- Customers (buyers) state ----------
  const [customers, setCustomers] = useState([])
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerForm, setShowCustomerForm] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null) // customer being edited, or null for "new"
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '', address: '', id_number: '', notes: '' })
  const [savingCustomer, setSavingCustomer] = useState(false)

  // ---------- Vehicle inventory state ----------
  const [vehicles, setVehicles] = useState([])
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState('')
  const [showVehicleForm, setShowVehicleForm] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState(null) // vehicle being edited, or null for "new" - AddVehicleModal reads its form straight off this

  // ---------- Showroom settings (hero banner + logo + payment methods
  // link shown on the public /showroom page) ----------
  const [showroomForm, setShowroomForm] = useState({ hero_image_url: '', contact_text: '', logo_url: '' })
  const [uploadingHero, setUploadingHero] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [savingShowroom, setSavingShowroom] = useState(false)
  const [showroomQR, setShowroomQR] = useState(null) // { svg, showroom_url }, or null
  const heroFileInputRef = React.useRef(null)
  const logoFileInputRef = React.useRef(null)

  // ---------- Contracts (deals) state ----------
  const emptyContractForm = {
    customer_public_id: '', vehicle_public_id: '', sale_type: 'financed',
    vehicle_price: '', down_payment: '', installment_amount: '', term_months: '12',
    payment_frequency: 'monthly', start_date: new Date().toISOString().slice(0, 10),
    is_existing_loan: false, balance_remaining: '', terms_remaining: '', last_paid_date: '', next_due_date: '', status: 'active',
    image_urls: [], // up to CONTRACT_MAX_IMAGES - signed contract pages, buyer ID, etc
  }
  const [contracts, setContracts] = useState([])
  const [contractStatusFilter, setContractStatusFilter] = useState('')
  const [showContractForm, setShowContractForm] = useState(false)
  const [editingContract, setEditingContract] = useState(null) // contract being edited, or null for "new"
  const [contractForm, setContractForm] = useState(emptyContractForm)
  const [savingContract, setSavingContract] = useState(false)
  const [uploadingContractFile, setUploadingContractFile] = useState(false)
  const [contractFileError, setContractFileError] = useState('')
  const contractFileInputRef = React.useRef(null)

  // ---------- Payments (Step 5) state ----------
  const [payingContract, setPayingContract] = useState(null) // contract currently open in the "Log payment" modal
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_date: new Date().toISOString().slice(0, 10), method: 'cash', notes: '' })
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentHistory, setPaymentHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [showScanModal, setShowScanModal] = useState(false)
  const [scanManualInput, setScanManualInput] = useState('')
  const [scanPickList, setScanPickList] = useState(null) // when a scan matches >1 open contract for the same buyer

  // ---------- Per-customer payment history / receipts (Step 6) state ----------
  const [historyCustomer, setHistoryCustomer] = useState(null) // cl_customer currently open in the history modal, or null
  const [customerHistory, setCustomerHistory] = useState([])
  const [loadingCustomerHistory, setLoadingCustomerHistory] = useState(false)
  const [viewingReceipt, setViewingReceipt] = useState(null) // a single payment row, shown in the printable receipt modal

  // ---------- Editing a logged payment (owner correction) state ----------
  const [editingPayment, setEditingPayment] = useState(null) // { payment, contract } currently open in the edit modal, or null
  const [editPaymentForm, setEditPaymentForm] = useState({ amount: '', payment_date: '', method: 'cash', notes: '' })
  const [savingEditPayment, setSavingEditPayment] = useState(false)

  // ---------- Dealership self-signup "Join" QR (Step: buyer self-join) state ----------
  const [joinQR, setJoinQR] = useState(null) // { svg, join_url }, or null

  // ---------- Share a specific buyer's wallet-add link/QR (for buyers
  // imported with an already-in-progress loan, who never went through
  // /cl-join themselves) state ----------
  const [walletShare, setWalletShare] = useState(null) // { svg, wallet_url, customer_name }, or null

  // ---------- Wallet setup / publish (Payments tab) state ----------
  const [walletClassInfo, setWalletClassInfo] = useState(null) // GET /cl-wallet-class response, or null while loading
  const [loadingWalletInfo, setLoadingWalletInfo] = useState(false)
  const [publishingWallet, setPublishingWallet] = useState(false)

  // ---------- Agent / Buyer / Seller applications state ----------
  const [applications, setApplications] = useState([])
  const [loadingApplications, setLoadingApplications] = useState(false)
  const [applicationRoleTab, setApplicationRoleTab] = useState('agent') // 'agent' | 'buyer' | 'seller'
  const [applicationStatusFilter, setApplicationStatusFilter] = useState('')
  const [showApplicationForm, setShowApplicationForm] = useState(false)
  const [editingApplication, setEditingApplication] = useState(null) // application being edited, or null for "new"
  const emptyApplicationForm = { name: '', phone: '', email: '', notes: '' }
  const [applicationForm, setApplicationForm] = useState(emptyApplicationForm)
  const [savingApplication, setSavingApplication] = useState(false)

  // ---------- Owner -> buyer messages (Step 5) state ----------
  const [clAnnouncements, setClAnnouncements] = useState([])
  const [showMessageForm, setShowMessageForm] = useState(false)
  const [messageTarget, setMessageTarget] = useState(null) // a cl_customer, or null = broadcast to everyone
  const [messageForm, setMessageForm] = useState({ title: '', message: '' })
  const [savingMessage, setSavingMessage] = useState(false)
  const [showMessageHistory, setShowMessageHistory] = useState(false)

  const businessId = user?.business_slug

  const loadData = async () => {
    try {
      const [bizRes, custRes, vehRes, conRes, msgRes, showroomRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/business/${businessId}`),
        fetch(`${API_BASE}/api/v1/business/${businessId}/cl-customers`),
        fetch(`${API_BASE}/api/v1/business/${businessId}/vehicles`),
        fetch(`${API_BASE}/api/v1/business/${businessId}/contracts`),
        fetch(`${API_BASE}/api/v1/business/${businessId}/cl-announcements`),
        fetch(`${API_BASE}/api/v1/business/${businessId}/showroom-config`),
      ])
      setBusiness(await bizRes.json().catch(() => null))
      setCustomers(await custRes.json().catch(() => []))
      setVehicles(await vehRes.json().catch(() => []))
      setContracts(await conRes.json().catch(() => []))
      setClAnnouncements(await msgRes.json().catch(() => []))
      const showroomData = await showroomRes.json().catch(() => null)
      if (showroomData) {
        setShowroomForm({
          hero_image_url: showroomData.hero_image_url || '',
          contact_text: showroomData.contact_text || '',
          logo_url: showroomData.logo_url || '',
        })
      }
    } catch (err) {
      console.error('Car lending dashboard load error:', err)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (!businessId) return
    loadData()
  }, [businessId])

  // Debounce customer search so we're not firing a request per keystroke
  useEffect(() => {
    if (!businessId) return
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (customerSearch) params.set('search', customerSearch)
        const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-customers?${params.toString()}`)
        setCustomers(await res.json().catch(() => []))
      } catch (err) {
        console.error('Customer search error:', err)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [customerSearch])

  // Re-fetch vehicles whenever the status filter changes
  useEffect(() => {
    if (!businessId) return
    (async () => {
      try {
        const params = new URLSearchParams()
        if (vehicleStatusFilter) params.set('status', vehicleStatusFilter)
        const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/vehicles?${params.toString()}`)
        setVehicles(await res.json().catch(() => []))
      } catch (err) {
        console.error('Vehicle filter error:', err)
      }
    })()
  }, [vehicleStatusFilter])

  // Re-fetch contracts whenever the status filter changes
  useEffect(() => {
    if (!businessId) return
    (async () => {
      try {
        const params = new URLSearchParams()
        if (contractStatusFilter) params.set('status', contractStatusFilter)
        const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/contracts?${params.toString()}`)
        setContracts(await res.json().catch(() => []))
      } catch (err) {
        console.error('Contract filter error:', err)
      }
    })()
  }, [contractStatusFilter])

  // Re-fetch applications whenever the Applications tab is open and its
  // role sub-tab or status filter changes (mirrors the contracts pattern
  // above - server-side filtered rather than fetched once and sliced
  // client-side).
  useEffect(() => {
    if (!businessId || activeTab !== 'applications') return
    (async () => {
      setLoadingApplications(true)
      try {
        const params = new URLSearchParams()
        params.set('role', applicationRoleTab)
        if (applicationStatusFilter) params.set('status', applicationStatusFilter)
        const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/applications?${params.toString()}`)
        const data = await res.json().catch(() => [])
        // A non-2xx response's body is {detail: "..."} - not an array - so
        // this must be checked before setApplications, or the list below
        // crashes calling .map() on an object and blanks the whole tab.
        if (!res.ok) {
          console.error('Application list error:', data.detail || res.status)
          setApplications([])
        } else {
          setApplications(Array.isArray(data) ? data : [])
        }
      } catch (err) {
        console.error('Application filter error:', err)
        setApplications([])
      }
      setLoadingApplications(false)
    })()
  }, [activeTab, applicationRoleTab, applicationStatusFilter, businessId])

  const flash = (text) => {
    setMessage(text)
    setTimeout(() => setMessage(''), 3000)
  }

  // ---------- Wallet setup / publish (Payments tab) ----------
  // Loads current Google/Apple Wallet status the first time the Payments
  // tab is opened. Both wallets ride on this platform's own Wallet
  // developer accounts (env vars on the server) - there's no per-business
  // credential to collect. Google needs an explicit "publish" step because
  // each business gets its own loyaltyClass on Google's side; Apple has no
  // equivalent step - .pkpass files just generate on demand once the
  // platform certificate is set up.
  const loadWalletClassInfo = async () => {
    if (!businessId) return
    setLoadingWalletInfo(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-wallet-class`)
      setWalletClassInfo(await res.json().catch(() => null))
    } catch (err) {
      console.error('Wallet class info error:', err)
      setWalletClassInfo(null)
    }
    setLoadingWalletInfo(false)
  }

  useEffect(() => {
    if (activeTab === 'payments' && businessId && !walletClassInfo) {
      loadWalletClassInfo()
    }
  }, [activeTab, businessId])

  const publishGoogleWallet = async () => {
    if (!businessId) return
    setPublishingWallet(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-wallet-class`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        flash('Published to Google Wallet')
      } else {
        flash(data.detail || 'Could not publish to Google Wallet')
      }
    } catch (err) {
      console.error('Publish wallet error:', err)
      flash('Network error publishing wallet')
    }
    await loadWalletClassInfo()
    setPublishingWallet(false)
  }

  // ---------- Customers CRUD ----------
  const openNewCustomer = () => {
    setEditingCustomer(null)
    setCustomerForm({ name: '', phone: '', email: '', address: '', id_number: '', notes: '' })
    setShowCustomerForm(true)
  }

  const openEditCustomer = (c) => {
    setEditingCustomer(c)
    setCustomerForm({
      name: c.name || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      id_number: c.id_number || '',
      notes: c.notes || '',
    })
    setShowCustomerForm(true)
  }

  const saveCustomer = async () => {
    if (!customerForm.name.trim()) {
      flash('Name is required')
      return
    }
    setSavingCustomer(true)
    try {
      const url = editingCustomer
        ? `${API_BASE}/api/v1/business/${businessId}/cl-customers/${editingCustomer.public_id}`
        : `${API_BASE}/api/v1/business/${businessId}/cl-customers`
      const res = await fetch(url, {
        method: editingCustomer ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customerForm.name,
          phone: customerForm.phone || null,
          email: customerForm.email || null,
          address: customerForm.address || null,
          id_number: customerForm.id_number || null,
          notes: customerForm.notes || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Save failed')
      flash(editingCustomer ? 'Customer updated' : 'Customer added')
      setShowCustomerForm(false)
      loadData()
    } catch (err) {
      flash(err.message)
    }
    setSavingCustomer(false)
  }

  const deleteCustomer = async (c) => {
    if (!window.confirm(`Remove ${c.name} from your customer list?`)) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-customers/${c.public_id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Delete failed')
      flash('Customer removed')
      loadData()
    } catch (err) {
      flash(err.message)
    }
  }

  // ---------- Agent / Buyer / Seller applications CRUD ----------
  const reloadApplications = async () => {
    try {
      const params = new URLSearchParams()
      params.set('role', applicationRoleTab)
      if (applicationStatusFilter) params.set('status', applicationStatusFilter)
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/applications?${params.toString()}`)
      const data = await res.json().catch(() => [])
      if (!res.ok) {
        console.error('Application reload error:', data.detail || res.status)
        setApplications([])
      } else {
        setApplications(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Application reload error:', err)
    }
  }

  const openNewApplication = () => {
    setEditingApplication(null)
    setApplicationForm(emptyApplicationForm)
    setShowApplicationForm(true)
  }

  const openEditApplication = (a) => {
    setEditingApplication(a)
    setApplicationForm({
      name: a.name || '',
      phone: a.phone || '',
      email: a.email || '',
      notes: a.notes || '',
    })
    setShowApplicationForm(true)
  }

  const saveApplication = async () => {
    if (!applicationForm.name.trim()) {
      flash('Name is required')
      return
    }
    setSavingApplication(true)
    try {
      const url = editingApplication
        ? `${API_BASE}/api/v1/business/${businessId}/applications/${editingApplication.public_id}`
        : `${API_BASE}/api/v1/business/${businessId}/applications`
      const body = {
        name: applicationForm.name,
        phone: applicationForm.phone || null,
        email: applicationForm.email || null,
        notes: applicationForm.notes || null,
      }
      // role is fixed by whichever sub-tab (Agents/Buyers/Sellers) the
      // owner had open when they clicked "New" - only sent on create,
      // since it can't be changed on an existing application.
      if (!editingApplication) body.role = applicationRoleTab
      const res = await fetch(url, {
        method: editingApplication ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Save failed')
      flash(editingApplication ? 'Application updated' : 'Application added')
      setShowApplicationForm(false)
      reloadApplications()
    } catch (err) {
      flash(err.message)
    }
    setSavingApplication(false)
  }

  // Approve/reject - the only way status ever changes; there's no
  // applicant-facing endpoint that can set it, so this dashboard button
  // is the sole path to either state.
  const decideApplication = async (a, status) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/applications/${a.public_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Update failed')
      flash(status === 'approved' ? 'Application approved' : 'Application rejected')
      reloadApplications()
    } catch (err) {
      flash(err.message)
    }
  }

  const deleteApplication = async (a) => {
    if (!window.confirm(`Remove ${a.name}'s application?`)) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/applications/${a.public_id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Delete failed')
      flash('Application removed')
      reloadApplications()
    } catch (err) {
      flash(err.message)
    }
  }

  // ---------- Vehicles CRUD ----------
  // Add/edit form + Cloudinary photo upload now live inside AddVehicleModal
  // - this just opens it with the right vehicle (or null for "new").
  const openNewVehicle = () => {
    setEditingVehicle(null)
    setShowVehicleForm(true)
  }

  const openEditVehicle = (v) => {
    setEditingVehicle(v)
    setShowVehicleForm(true)
  }

  const deleteVehicle = async (v) => {
    if (!window.confirm(`Remove ${v.year ? v.year + ' ' : ''}${v.make} ${v.model} from inventory?`)) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/vehicles/${v.public_id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Delete failed')
      flash('Vehicle removed')
      loadData()
    } catch (err) {
      flash(err.message)
    }
  }

  // ---------- Showroom settings (hero banner + logo + payment methods link) ----------
  const uploadShowroomHero = async (file) => {
    if (!file) return
    setUploadingHero(true)
    try {
      const url = await uploadImageToCloudinary(API_BASE, businessId, file)
      setShowroomForm({ ...showroomForm, hero_image_url: url })
    } catch (err) {
      flash(err.message)
    }
    setUploadingHero(false)
  }

  const uploadShowroomLogo = async (file) => {
    if (!file) return
    setUploadingLogo(true)
    try {
      const url = await uploadImageToCloudinary(API_BASE, businessId, file)
      setShowroomForm({ ...showroomForm, logo_url: url })
    } catch (err) {
      flash(err.message)
    }
    setUploadingLogo(false)
  }

  const saveShowroomConfig = async () => {
    setSavingShowroom(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/showroom-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hero_image_url: showroomForm.hero_image_url || null,
          contact_text: showroomForm.contact_text,
          logo_url: showroomForm.logo_url || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Save failed')
      flash('Showroom settings saved')
    } catch (err) {
      flash(err.message)
    }
    setSavingShowroom(false)
  }

  // Public showroom QR - print/display it, or it's the same link surfaced
  // on a buyer's Wallet loan card ("Browse Showroom").
  const showShowroomQR = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/showroom-qr-code`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.svg) throw new Error(data.detail || 'Could not load showroom QR code')
      setShowroomQR(data)
    } catch (err) {
      flash(err.message)
    }
  }

  // ---------- Contracts CRUD ----------
  const openNewContract = () => {
    setEditingContract(null)
    setContractForm(emptyContractForm)
    setContractFileError('')
    setShowContractForm(true)
  }

  const openEditContract = (c) => {
    setEditingContract(c)
    setContractForm({
      customer_public_id: c.customer?.public_id || '',
      vehicle_public_id: c.vehicle?.public_id || '',
      sale_type: c.sale_type || 'financed',
      vehicle_price: c.vehicle_price ?? '',
      down_payment: c.down_payment ?? '',
      installment_amount: c.installment_amount ?? '',
      term_months: c.term_months ?? '',
      payment_frequency: c.payment_frequency || 'monthly',
      start_date: c.start_date || '',
      is_existing_loan: true, // editing always shows the current-state fields
      balance_remaining: c.balance_remaining ?? '',
      terms_remaining: contractTermsRemaining(c.balance_remaining, c.installment_amount) ?? '',
      last_paid_date: c.last_paid_date || '',
      next_due_date: c.next_due_date || '',
      status: c.status || 'active',
      image_urls: c.image_urls && c.image_urls.length ? c.image_urls : [],
    })
    setContractFileError('')
    setShowContractForm(true)
  }

  // Terms remaining isn't stored on the contract itself - only balance_remaining
  // is. This derives a starting "terms remaining" value (from balance ÷ monthly
  // payment) to seed the editable field below; from then on the two fields sync
  // to each other as the owner edits either one.
  const contractTermsRemaining = (balanceRemaining, installmentAmount) => {
    const balance = Number(balanceRemaining) || 0
    const installment = Number(installmentAmount) || 0
    if (!installment || balance <= 0) return null
    return Math.ceil(balance / installment)
  }

  // Selecting a vehicle auto-fills its listed price as a starting point for
  // vehicle_price (still editable - the contract snapshots its own price
  // independently of whatever the vehicle's listing later changes to).
  const onSelectContractVehicle = (vehiclePublicId) => {
    const v = vehicles.find(v => v.public_id === vehiclePublicId)
    setContractForm(f => ({
      ...f,
      vehicle_public_id: vehiclePublicId,
      vehicle_price: f.vehicle_price || (v ? String(v.price) : f.vehicle_price),
    }))
  }

  // Uploads as many of the given files as fit within the CONTRACT_MAX_IMAGES
  // cap, one at a time (keeps upload order == display order).
  const uploadContractFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter(Boolean)
    if (!files.length) return
    const slotsLeft = CONTRACT_MAX_IMAGES - contractForm.image_urls.length
    if (slotsLeft <= 0) {
      setContractFileError(`You can add up to ${CONTRACT_MAX_IMAGES} files per contract`)
      return
    }
    setContractFileError('')
    const toUpload = files.slice(0, slotsLeft)
    const skipped = files.length - toUpload.length
    setUploadingContractFile(true)
    const uploaded = []
    try {
      for (const file of toUpload) {
        const url = await uploadImageToCloudinary(API_BASE, businessId, file, 'contract')
        uploaded.push(url)
      }
      if (uploaded.length) setContractForm(f => ({ ...f, image_urls: [...f.image_urls, ...uploaded] }))
      if (skipped > 0) setContractFileError(`Only added ${uploaded.length} file${uploaded.length === 1 ? '' : 's'} - limit is ${CONTRACT_MAX_IMAGES} per contract`)
    } catch (err) {
      if (uploaded.length) setContractForm(f => ({ ...f, image_urls: [...f.image_urls, ...uploaded] }))
      setContractFileError(err.message)
    }
    setUploadingContractFile(false)
  }

  const removeContractFile = (idx) => {
    setContractForm(f => ({ ...f, image_urls: f.image_urls.filter((_, i) => i !== idx) }))
  }

  const saveContract = async () => {
    if (!editingContract && (!contractForm.customer_public_id || !contractForm.vehicle_public_id)) {
      flash('Pick a customer and a vehicle')
      return
    }
    if (contractForm.sale_type === 'financed') {
      if (!contractForm.installment_amount || Number(contractForm.installment_amount) <= 0) {
        flash('Monthly payment is required')
        return
      }
      if (!contractForm.term_months || Number(contractForm.term_months) <= 0) {
        flash('Term (months) is required')
        return
      }
    } else if (!contractForm.vehicle_price || Number(contractForm.vehicle_price) <= 0) {
      flash('Vehicle price is required')
      return
    }
    if (uploadingContractFile) {
      flash('Please wait for files to finish uploading')
      return
    }
    setSavingContract(true)
    try {
      const body = {
        sale_type: contractForm.sale_type,
        down_payment: contractForm.down_payment !== '' ? Number(contractForm.down_payment) : 0,
        payment_frequency: contractForm.payment_frequency,
        start_date: contractForm.start_date || null,
        image_urls: contractForm.image_urls,
      }
      if (contractForm.sale_type === 'financed') {
        // Vehicle price is left out on purpose - the server derives it from
        // down payment + monthly payment x term.
        body.installment_amount = Number(contractForm.installment_amount)
        body.term_months = Number(contractForm.term_months)
      } else {
        body.vehicle_price = Number(contractForm.vehicle_price)
        body.term_months = 0
      }
      // Only send the "current state" overrides when transferring an
      // existing loan (new deals compute these automatically) or when
      // editing an existing contract (always allowed to correct).
      if (contractForm.is_existing_loan || editingContract) {
        if (contractForm.balance_remaining !== '') body.balance_remaining = Number(contractForm.balance_remaining)
        if (contractForm.last_paid_date) body.last_paid_date = contractForm.last_paid_date
        if (contractForm.next_due_date) body.next_due_date = contractForm.next_due_date
        if (contractForm.status) body.status = contractForm.status
      }

      const url = editingContract
        ? `${API_BASE}/api/v1/business/${businessId}/contracts/${editingContract.public_id}`
        : `${API_BASE}/api/v1/business/${businessId}/contracts`
      if (!editingContract) {
        body.customer_public_id = contractForm.customer_public_id
        body.vehicle_public_id = contractForm.vehicle_public_id
      }
      const res = await fetch(url, {
        method: editingContract ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Save failed')
      flash(editingContract ? 'Contract updated' : 'Contract created')
      setShowContractForm(false)
      loadData()
    } catch (err) {
      flash(err.message)
    }
    setSavingContract(false)
  }

  const deleteContract = async (c) => {
    if (!window.confirm(`Delete this contract for ${c.customer?.name || 'this customer'}? The vehicle will be freed back up as available.`)) return
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/contracts/${c.public_id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Delete failed')
      flash('Contract removed')
      loadData()
    } catch (err) {
      flash(err.message)
    }
  }

  // ---------- Payments (Step 5) ----------
  const openLogPayment = (contract) => {
    setPayingContract(contract)
    setPaymentForm({
      amount: contract.installment_amount ?? '',
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'cash',
      notes: '',
    })
    setPaymentHistory([])
    loadPaymentHistory(contract)
  }

  const loadPaymentHistory = async (contract) => {
    setLoadingHistory(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/contracts/${contract.public_id}/payments`)
      setPaymentHistory(await res.json().catch(() => []))
    } catch (err) {
      console.error('Payment history error:', err)
    }
    setLoadingHistory(false)
  }

  const savePayment = async () => {
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) {
      flash('Enter a payment amount')
      return
    }
    setSavingPayment(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/contracts/${payingContract.public_id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(paymentForm.amount),
          payment_date: paymentForm.payment_date || null,
          method: paymentForm.method || null,
          notes: paymentForm.notes || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Save failed')
      flash(data.contract?.status === 'completed' ? 'Payment logged — loan paid off! 🎉' : 'Payment logged')
      setPayingContract(null)
      loadData()
    } catch (err) {
      flash(err.message)
    }
    setSavingPayment(false)
  }

  const undoPayment = async (payment) => {
    if (!window.confirm(`Undo this ₱${Number(payment.amount).toLocaleString()} payment? The balance will be restored.`)) return
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/business/${businessId}/contracts/${payingContract.public_id}/payments/${payment.public_id}`,
        { method: 'DELETE' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Undo failed')
      flash('Payment undone')
      loadPaymentHistory(payingContract)
      loadData()
    } catch (err) {
      flash(err.message)
    }
  }

  // ---------- Per-customer payment history / receipts (Step 6) ----------
  // Unlike loadPaymentHistory (Step 5, scoped to one open contract), this
  // pulls every payment across ALL of the buyer's contracts - including
  // completed/repossessed/cancelled ones, which never show up in the
  // Payments tab's open-loans list.
  const openCustomerHistory = (customer) => {
    setHistoryCustomer(customer)
    setCustomerHistory([])
    loadCustomerHistory(customer)
  }

  const loadCustomerHistory = async (customer) => {
    setLoadingCustomerHistory(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-customers/${customer.public_id}/payments`)
      setCustomerHistory(await res.json().catch(() => []))
    } catch (err) {
      console.error('Customer payment history error:', err)
    }
    setLoadingCustomerHistory(false)
  }

  // Scan a buyer's QR code (their public_id) and jump to the matching
  // contract's "Log payment" modal. If they have more than one open
  // contract, show a small picker instead of guessing which one.
  // The buyer's wallet-pass barcode now encodes a full /cl-wallet/{id} URL
  // (so scanning it with an ordinary camera app opens their "check your
  // card" page) instead of a bare public_id - so this pulls the id back out
  // of the last path segment when the scan is a URL, and still accepts a
  // bare public_id as-is (e.g. from an older printed lookup card).
  const extractCustomerPublicId = (rawValue) => {
    const trimmed = rawValue.trim()
    const match = trimmed.match(/\/cl-wallet\/([^/?#]+)/)
    return match ? match[1] : trimmed
  }

  const handleScanResult = (rawValue) => {
    setShowScanModal(false)
    const customer = customers.find(c => c.public_id === extractCustomerPublicId(rawValue))
    if (!customer) {
      flash('No customer matches that code')
      return
    }
    const openContracts = contracts.filter(c => c.customer?.public_id === customer.public_id && c.status !== 'completed' && c.status !== 'cancelled')
    if (openContracts.length === 0) {
      flash(`${customer.name} has no open contract to pay`)
    } else if (openContracts.length === 1) {
      openLogPayment(openContracts[0])
    } else {
      setScanPickList({ customer, contracts: openContracts })
    }
  }

  const { videoRef: scanVideoRef, supported: scanSupported, start: startScan, stop: stopScan } = useBarcodeScanner(handleScanResult)

  const openScanModal = () => {
    setScanPickList(null)
    setScanManualInput('')
    setShowScanModal(true)
    if (scanSupported) setTimeout(startScan, 50)
  }

  const closeScanModal = () => {
    stopScan()
    setShowScanModal(false)
  }

  const [customerQR, setCustomerQR] = useState(null) // { svg, customer_name } for the "Show QR" modal
  const showCustomerQR = async (customer) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-customers/${customer.public_id}/qr-code`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.svg) throw new Error(data.detail || 'Could not load QR code')
      setCustomerQR(data)
    } catch (err) {
      flash(err.message)
    }
  }

  // Dealership's own self-signup QR - one per business, print/display it so
  // new buyers can register themselves and add the Loan Card to their own
  // wallet without any dashboard data entry.
  const showJoinQR = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-join-qr-code`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.svg) throw new Error(data.detail || 'Could not load join QR code — make sure the backend has been redeployed with the /cl-join-qr-code endpoint.')
      setJoinQR(data)
    } catch (err) {
      flash(err.message)
    }
  }

  // For a buyer already on the books (imported with an existing loan, or
  // just added by the owner directly) who never went through the Join QR
  // themselves - show/share the same "Add to Wallet" page as a QR they can
  // scan with their own phone, or a link the owner can copy/text/share.
  const showWalletShare = async (customer) => {
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-customers/${customer.public_id}/wallet-qr-code`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.svg) throw new Error(data.detail || 'Could not load wallet share code')
      setWalletShare(data)
    } catch (err) {
      flash(err.message)
    }
  }

  const shareWalletLink = () => {
    if (!walletShare) return
    if (navigator.share) {
      navigator.share({ title: `${walletShare.customer_name}'s card`, url: walletShare.wallet_url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(walletShare.wallet_url)
      flash('Wallet link copied')
    }
  }

  // ---------- Editing a logged payment (owner correction) ----------
  // method/notes are always editable; amount/payment_date only take effect
  // on the contract's most recent payment (the backend enforces this and
  // returns a clear error otherwise - see CLPaymentUpdate).
  const openEditPayment = (payment, contract) => {
    setEditingPayment({ payment, contract })
    setEditPaymentForm({
      amount: payment.amount ?? '',
      payment_date: payment.payment_date || '',
      method: payment.method || 'cash',
      notes: payment.notes || '',
    })
  }

  const saveEditPayment = async () => {
    if (!editPaymentForm.amount || Number(editPaymentForm.amount) <= 0) {
      flash('Enter a payment amount')
      return
    }
    setSavingEditPayment(true)
    try {
      const { payment, contract } = editingPayment
      const res = await fetch(
        `${API_BASE}/api/v1/business/${businessId}/contracts/${contract.public_id}/payments/${payment.public_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: Number(editPaymentForm.amount),
            payment_date: editPaymentForm.payment_date || null,
            method: editPaymentForm.method || null,
            notes: editPaymentForm.notes || null,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Update failed')
      flash('Payment updated')
      setEditingPayment(null)
      // Refresh whichever history view(s) might be showing this payment.
      if (payingContract?.public_id === contract.public_id) loadPaymentHistory(payingContract)
      if (historyCustomer) loadCustomerHistory(historyCustomer)
      loadData()
    } catch (err) {
      flash(err.message)
    }
    setSavingEditPayment(false)
  }

  // ---------- Owner -> buyer messages (Step 5) ----------
  const openMessageForm = (customer) => {
    setMessageTarget(customer || null)
    setMessageForm({ title: '', message: '' })
    setShowMessageForm(true)
  }

  const sendMessage = async () => {
    if (!messageForm.title.trim() || !messageForm.message.trim()) {
      flash('Title and message are required')
      return
    }
    if (!messageTarget && !window.confirm('Send this to every customer with an email on file?')) return
    setSavingMessage(true)
    try {
      const res = await fetch(`${API_BASE}/api/v1/business/${businessId}/cl-announcements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: messageForm.title,
          message: messageForm.message,
          customer_public_id: messageTarget?.public_id || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Send failed')
      flash(`Sent to ${data.sent_count} of ${data.recipient_count} recipient${data.recipient_count === 1 ? '' : 's'}`)
      setShowMessageForm(false)
      loadData()
    } catch (err) {
      flash(err.message)
    }
    setSavingMessage(false)
  }

  if (loading) {
    return <div style={styles.loadingScreen}>Loading dashboard…</div>
  }

  // ---------- Profit/loss (net income) + top agent, computed from
  // vehicles + contracts already loaded above. Each contract's profit is
  // its sale price minus the vehicle's total_cost (what it cost to buy) -
  // total_cost is never sent to the showroom, it only feeds this
  // computation. A deal counts on its start_date (falling back to when the
  // contract record was created for older/transferred loans). ----------
  const deals = computeDealProfits(vehicles, contracts)
  const netIncome = netIncomeByPeriod(deals)
  const agentRanking = rankAgents(deals)

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.brand}>
          <span style={{ fontSize: 26 }}>🚗</span>
          <div>
            <h1 style={styles.brandName}>{business?.name || 'Dealer Dashboard'}</h1>
            <p style={styles.brandTagline}>Car Lending & Showroom</p>
          </div>
        </div>
        <button onClick={onLogout} style={styles.logoutBtn}>Log out</button>
      </header>

      {message && <div style={styles.toast}>{message}</div>}

      <nav style={styles.tabBar}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{ ...styles.tabBtn, ...(activeTab === t.key ? styles.tabBtnActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div style={styles.body}>
        {activeTab === 'overview' && (
          <>
            <div style={styles.statsGrid}>
              <StatCard label="Active contracts" value={contracts.filter(c => c.status === 'active').length} />
              <StatCard label="Vehicles in stock" value={vehicles.filter(v => v.status === 'available').length} />
              <StatCard label="Vehicles sold" value={vehicles.filter(v => v.status === 'sold' || v.status === 'financed').length} />
              <StatCard
                label="Overdue payments"
                value={contracts.filter(c => c.status === 'overdue').length}
                accent="#dc2626"
              />
              <StatCard label="Customers" value={customers.length} />
            </div>

            <div style={styles.sectionHeaderRow}>
              <h2 style={styles.sectionTitle}>Net income</h2>
            </div>
            <p style={styles.sectionSubtitle}>
              Price to sell minus total cost to buy, counted on each deal's start date. Total cost never shows on the showroom — it's for this computation only.
            </p>
            <div style={{ maxWidth: 220, marginBottom: 24 }}>
              <NetIncomeCard period={incomePeriod} onPeriodChange={setIncomePeriod} stats={netIncome} />
            </div>

            <div style={styles.announcementsSection}>
              <div style={styles.sectionHeaderRow}>
                <h2 style={styles.sectionTitle}>Agents</h2>
              </div>
              <p style={styles.sectionSubtitle}>Ranked by total net income from the deals on cars they're assigned to.</p>

              {agentRanking.length === 0 ? (
                <div style={styles.emptyState}>No deals with an assigned agent yet.</div>
              ) : (
                <div style={styles.announcementsList}>
                  {agentRanking.map((a, idx) => (
                    <div key={a.agent} style={styles.announcementCard}>
                      <div style={styles.announcementInfo}>
                        <div style={styles.announcementTitleRow}>
                          <span style={styles.announcementTitle}>{idx === 0 ? '🏆 ' : ''}{a.agent}</span>
                          {idx === 0 && <span style={styles.inactiveBadge}>Top agent</span>}
                        </div>
                        <div style={styles.announcementMessage}>{a.deals} deal{a.deals === 1 ? '' : 's'} · {formatPeso(a.profit)} net income</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'customers' && (
          <div style={styles.panelSection}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={styles.sectionTitle}>Customers</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowMessageHistory(true)} style={styles.cancelBtnSmall}>Message history</button>
                <button onClick={() => openMessageForm(null)} style={styles.newBtnAlt}>✉️ Message all</button>
                <button onClick={showJoinQR} style={styles.cancelBtnSmall}>📱 Join QR</button>
                <button onClick={openNewCustomer} style={styles.newBtn}>+ New customer</button>
              </div>
            </div>
            <p style={styles.sectionSubtitle}>Buyers on file — used for contracts and payment history.</p>

            <input
              style={{ ...styles.input, marginBottom: 16 }}
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
              placeholder="Search by name, phone, or email…"
            />

            {customers.length === 0 ? (
              <div style={styles.emptyState}>
                {customerSearch ? 'No customers match your search.' : 'No customers yet — add your first buyer.'}
              </div>
            ) : (
              <div style={styles.cardList}>
                {customers.map(c => (
                  <div key={c.public_id} style={styles.recordCard}>
                    <div style={styles.recordInfo}>
                      <div style={styles.recordTitle}>{c.name}</div>
                      <div style={styles.recordMeta}>
                        {[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact info on file'}
                      </div>
                      {c.address && <div style={styles.recordMetaSub}>{c.address}</div>}
                      {c.id_number && <div style={styles.recordMetaSub}>ID: {c.id_number}</div>}
                      {c.notes && <div style={styles.recordMetaSub}>{c.notes}</div>}
                    </div>
                    <div style={styles.recordActions}>
                      <button onClick={() => showCustomerQR(c)} style={styles.editBtn}>QR</button>
                      <button onClick={() => showWalletShare(c)} style={styles.editBtn}>Share</button>
                      <button onClick={() => openCustomerHistory(c)} style={styles.editBtn}>History</button>
                      <button onClick={() => openMessageForm(c)} style={styles.editBtn}>Message</button>
                      <button onClick={() => openEditCustomer(c)} style={styles.editBtn}>Edit</button>
                      <button onClick={() => deleteCustomer(c)} style={styles.deleteBtn}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'inventory' && (
          <div style={styles.panelSection}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={styles.sectionTitle}>Vehicle inventory</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={showShowroomQR} style={styles.cancelBtnSmall}>🔗 Showroom QR</button>
                <button onClick={openNewVehicle} style={styles.newBtn}>+ Add vehicle</button>
              </div>
            </div>
            <p style={styles.sectionSubtitle}>Showroom stock — status updates automatically once contracts land.</p>

            <div style={styles.walletSetupCard}>
              <h3 style={styles.walletSetupTitle}>Showroom settings</h3>
              <p style={styles.walletSetupSubtitle}>
                The logo, hero banner, and contact note shown at the top of your public showroom page.
              </p>

              <label style={styles.label}>Logo</label>
              <div
                style={{ ...styles.uploadZone, marginBottom: 12, minHeight: 90 }}
                onClick={() => !uploadingLogo && logoFileInputRef.current && logoFileInputRef.current.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files && e.dataTransfer.files[0]
                  if (file) uploadShowroomLogo(file)
                }}
              >
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => uploadShowroomLogo(e.target.files && e.target.files[0])}
                />
                {uploadingLogo ? (
                  <div style={styles.uploadHint}>Uploading…</div>
                ) : showroomForm.logo_url ? (
                  <>
                    <img src={showroomForm.logo_url} alt="Business logo" style={{ ...styles.uploadPreview, width: 72, height: 72, objectFit: 'cover', borderRadius: 16 }} />
                    <div style={styles.uploadHint}>Click or drop to replace logo</div>
                  </>
                ) : (
                  <div style={styles.uploadHint}>🏷️ Click or drag a logo image here</div>
                )}
              </div>
              <div style={styles.photoCountHint}>Shown inside the hero banner on the showroom page (and anywhere else your logo appears, e.g. loyalty/wallet cards).</div>

              <label style={{ ...styles.label, marginTop: 14 }}>Hero banner</label>
              <div
                style={{ ...styles.uploadZone, marginBottom: 12 }}
                onClick={() => !uploadingHero && heroFileInputRef.current && heroFileInputRef.current.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files && e.dataTransfer.files[0]
                  if (file) uploadShowroomHero(file)
                }}
              >
                <input
                  ref={heroFileInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={e => uploadShowroomHero(e.target.files && e.target.files[0])}
                />
                {uploadingHero ? (
                  <div style={styles.uploadHint}>Uploading…</div>
                ) : showroomForm.hero_image_url ? (
                  <>
                    <img src={showroomForm.hero_image_url} alt="Showroom hero" style={styles.uploadPreview} />
                    <div style={styles.uploadHint}>Click or drop to replace banner</div>
                  </>
                ) : (
                  <div style={styles.uploadHint}>🖼️ Click or drag a hero banner image here</div>
                )}
              </div>

              <div style={styles.photoCountHint}>The showroom page now shows a fixed "Connect with us?" section (Facebook message button + phone numbers) below the hero banner — no owner editing needed.</div>

              <div style={{ ...styles.modalActions, marginTop: 14, justifyContent: 'flex-start' }}>
                <button onClick={saveShowroomConfig} disabled={savingShowroom || uploadingHero || uploadingLogo} style={styles.newBtnAlt}>
                  {savingShowroom ? 'Saving…' : 'Save showroom settings'}
                </button>
              </div>
            </div>

            <select
              style={{ ...styles.select, marginBottom: 16 }}
              value={vehicleStatusFilter}
              onChange={e => setVehicleStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="financed">Financed</option>
              <option value="sold">Sold</option>
            </select>

            {vehicles.length === 0 ? (
              <div style={styles.emptyState}>
                {vehicleStatusFilter ? `No vehicles with status "${vehicleStatusFilter}".` : 'No vehicles yet — add your first unit.'}
              </div>
            ) : (
              <div style={styles.cardList}>
                {vehicles.map(v => {
                  const photos = v.image_urls && v.image_urls.length ? v.image_urls : (v.image_url ? [v.image_url] : [])
                  return (
                  <div key={v.public_id} style={styles.recordCard}>
                    {photos.length > 0 && (
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <img src={photos[0]} alt="" style={styles.vehicleThumb} />
                        {photos.length > 1 && <span style={styles.photoMainBadge}>+{photos.length - 1}</span>}
                      </div>
                    )}
                    <div style={styles.recordInfo}>
                      <div style={styles.recordTitleRow}>
                        <span style={styles.recordTitle}>{v.year ? `${v.year} ` : ''}{v.make} {v.model}</span>
                        <span style={{ ...styles.statusBadge, ...(STATUS_BADGE_STYLES[v.status] || {}) }}>
                          {v.status}
                        </span>
                      </div>
                      <div style={styles.recordMeta}>
                        {[
                          v.color,
                          v.plate_number ? `Plate ${v.plate_number}` : null,
                          v.plate_end_in ? `Ends in ${v.plate_end_in}` : null,
                          v.mileage != null ? `${v.mileage.toLocaleString()} km` : null,
                          v.transmission ? (v.transmission === 'automatic' ? 'Automatic' : 'Manual') : null,
                          v.fuel_type ? v.fuel_type.charAt(0).toUpperCase() + v.fuel_type.slice(1) : null,
                        ].filter(Boolean).join(' · ')}
                      </div>
                      <div style={styles.recordMetaSub}>₱{Number(v.price || 0).toLocaleString()}</div>
                    </div>
                    <div style={styles.recordActions}>
                      <button onClick={() => openEditVehicle(v)} style={styles.editBtn}>Edit</button>
                      <button onClick={() => deleteVehicle(v)} style={styles.deleteBtn}>Delete</button>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
        {activeTab === 'contracts' && (
          <div style={styles.panelSection}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={styles.sectionTitle}>Contracts</h2>
              <button onClick={openNewContract} style={styles.newBtn}>+ New contract</button>
            </div>
            <p style={styles.sectionSubtitle}>
              Cash sales and financed deals. Use "existing loan" when creating one to transfer a car already mid-payment from before this dashboard existed.
            </p>

            <select
              style={{ ...styles.select, marginBottom: 16 }}
              value={contractStatusFilter}
              onChange={e => setContractStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="overdue">Overdue</option>
              <option value="completed">Completed</option>
              <option value="repossessed">Repossessed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            {contracts.length === 0 ? (
              <div style={styles.emptyState}>
                {contractStatusFilter ? `No contracts with status "${contractStatusFilter}".` : 'No contracts yet — create your first deal.'}
              </div>
            ) : (
              <div style={styles.cardList}>
                {contracts.map(c => (
                  <div key={c.public_id} style={styles.recordCard}>
                    <div style={styles.recordInfo}>
                      <div style={styles.recordTitleRow}>
                        <span style={styles.recordTitle}>
                          {c.customer?.name || 'Unknown customer'} — {c.vehicle ? `${c.vehicle.year ? c.vehicle.year + ' ' : ''}${c.vehicle.make} ${c.vehicle.model}` : 'Unknown vehicle'}
                        </span>
                        <span style={{ ...styles.statusBadge, ...(CONTRACT_STATUS_BADGE_STYLES[c.status] || {}) }}>
                          {c.status}
                        </span>
                      </div>
                      <div style={styles.recordMeta}>
                        {c.sale_type === 'cash' ? 'Cash sale' : `Financed · ${c.term_months}mo · ${c.payment_frequency}`}
                        {' · '}₱{Number(c.total_payable || 0).toLocaleString()} total
                      </div>
                      {c.sale_type === 'financed' ? (
                        <>
                          <div style={styles.recordMetaSub}>
                            Balance: ₱{Number(c.balance_remaining || 0).toLocaleString()}
                            {' · '}₱{Number(c.installment_amount || 0).toLocaleString()}/{c.payment_frequency === 'monthly' ? 'mo' : c.payment_frequency}
                            {(() => {
                              const left = contractTermsRemaining(c.balance_remaining, c.installment_amount)
                              return left != null ? ` · ${left} payment${left === 1 ? '' : 's'} left` : ''
                            })()}
                          </div>
                          <div style={styles.recordMetaSub}>
                            {c.last_paid_date ? `Last paid ${c.last_paid_date}` : 'No payments logged yet'}
                            {c.next_due_date && ` · Next due ${c.next_due_date}`}
                          </div>
                        </>
                      ) : (
                        <div style={styles.recordMetaSub}>
                          Balance: ₱{Number(c.balance_remaining || 0).toLocaleString()}
                          {c.next_due_date && ` · Next due ${c.next_due_date}`}
                        </div>
                      )}
                      {c.vehicle?.plate_number && <div style={styles.recordMetaSub}>Plate: {c.vehicle.plate_number}</div>}
                    </div>
                    <div style={styles.recordActions}>
                      <button onClick={() => openEditContract(c)} style={styles.editBtn}>Edit</button>
                      <button onClick={() => deleteContract(c)} style={styles.deleteBtn}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {activeTab === 'payments' && (
          <div style={styles.panelSection}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={styles.sectionTitle}>Payments</h2>
              <button onClick={openScanModal} style={styles.newBtn}>📷 Scan QR</button>
            </div>
            <p style={styles.sectionSubtitle}>
              Open loans, soonest due first. Log a payment directly, or scan a buyer's QR code (Customers tab → QR) to jump to theirs.
            </p>

            <div style={styles.walletSetupCard}>
              <div style={styles.sectionHeaderRow}>
                <h3 style={styles.walletSetupTitle}>Wallet setup</h3>
                {loadingWalletInfo && <span style={styles.walletSetupHint}>Checking status…</span>}
              </div>
              <p style={styles.walletSetupSubtitle}>
                Controls whether buyers can add their loan card to Google Wallet and Apple Wallet.
              </p>

              <div style={styles.walletRow}>
                <div style={styles.walletRowInfo}>
                  <span style={styles.walletRowLabel}>Google Wallet</span>
                  <span style={{
                    ...styles.statusBadge,
                    ...(walletClassInfo?.google_class_exists
                      ? { background: '#dcfce7', color: '#15803d' }
                      : { background: '#fef3c7', color: '#b45309' }),
                  }}>
                    {walletClassInfo?.google_class_exists ? 'Published' : 'Not published'}
                  </span>
                </div>
                <button
                  onClick={publishGoogleWallet}
                  disabled={publishingWallet || !walletClassInfo?.google_wallet_configured}
                  style={styles.newBtnAlt}
                  title={!walletClassInfo?.google_wallet_configured ? 'Google Wallet is not configured on the server yet' : undefined}
                >
                  {publishingWallet ? 'Publishing…' : walletClassInfo?.google_class_exists ? 'Republish' : 'Publish to Google Wallet'}
                </button>
              </div>
              {walletClassInfo && !walletClassInfo.google_wallet_configured && (
                <p style={styles.walletSetupNote}>Google Wallet isn't set up on the server yet — contact support.</p>
              )}

              <div style={{ ...styles.walletRow, marginTop: 10 }}>
                <div style={styles.walletRowInfo}>
                  <span style={styles.walletRowLabel}>Apple Wallet</span>
                  <span style={{
                    ...styles.statusBadge,
                    ...(walletClassInfo?.apple_wallet_configured
                      ? { background: '#dcfce7', color: '#15803d' }
                      : { background: '#fef3c7', color: '#b45309' }),
                  }}>
                    {walletClassInfo?.apple_wallet_configured ? 'Ready' : 'Not configured'}
                  </span>
                </div>
              </div>
              <p style={styles.walletSetupNote}>
                {walletClassInfo?.apple_wallet_configured
                  ? "No action needed — buyers' Apple Wallet cards generate automatically."
                  : "Apple Wallet isn't set up on the server yet — contact support."}
              </p>
            </div>

            {(() => {
              const openLoans = contracts
                .filter(c => c.status === 'active' || c.status === 'overdue')
                .slice()
                .sort((a, b) => (a.next_due_date || '9999').localeCompare(b.next_due_date || '9999'))
              if (openLoans.length === 0) {
                return <div style={styles.emptyState}>No open loans right now.</div>
              }
              const today = new Date().toISOString().slice(0, 10)
              return (
                <div style={styles.cardList}>
                  {openLoans.map(c => {
                    const daysUntil = c.next_due_date
                      ? Math.round((new Date(c.next_due_date) - new Date(today)) / 86400000)
                      : null
                    return (
                      <div key={c.public_id} style={styles.recordCard}>
                        <div style={styles.recordInfo}>
                          <div style={styles.recordTitleRow}>
                            <span style={styles.recordTitle}>
                              {c.customer?.name || 'Unknown customer'} — {c.vehicle ? `${c.vehicle.year ? c.vehicle.year + ' ' : ''}${c.vehicle.make} ${c.vehicle.model}` : 'Unknown vehicle'}
                            </span>
                            <span style={{ ...styles.statusBadge, ...(CONTRACT_STATUS_BADGE_STYLES[c.status] || {}) }}>
                              {c.status === 'overdue' && daysUntil != null ? `${Math.abs(daysUntil)}d overdue` : c.status}
                            </span>
                          </div>
                          <div style={styles.recordMeta}>
                            ₱{Number(c.installment_amount || 0).toLocaleString()} due
                            {c.next_due_date && ` on ${c.next_due_date}`}
                            {c.status === 'active' && daysUntil != null && daysUntil >= 0 && ` (in ${daysUntil}d)`}
                          </div>
                          <div style={styles.recordMetaSub}>
                            Balance remaining: ₱{Number(c.balance_remaining || 0).toLocaleString()}
                            {(() => {
                              const left = contractTermsRemaining(c.balance_remaining, c.installment_amount)
                              return left != null ? ` · ${left} payment${left === 1 ? '' : 's'} left` : ''
                            })()}
                            {c.last_paid_date && ` · Last paid ${c.last_paid_date}`}
                          </div>
                        </div>
                        <div style={styles.recordActions}>
                          <button onClick={() => openLogPayment(c)} style={styles.newBtn}>Log payment</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )}

        {activeTab === 'applications' && (
          <div style={styles.panelSection}>
            <div style={styles.sectionHeaderRow}>
              <h2 style={styles.sectionTitle}>
                {APPLICATION_ROLES.find(r => r.key === applicationRoleTab)?.label}
              </h2>
              <button onClick={openNewApplication} style={styles.newBtn}>+ New application</button>
            </div>
            <p style={styles.sectionSubtitle}>
              Only you can approve or reject an application here — there's no self-approval path for applicants.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {APPLICATION_ROLES.map(r => (
                <button
                  key={r.key}
                  onClick={() => setApplicationRoleTab(r.key)}
                  style={{ ...styles.tabBtn, ...(applicationRoleTab === r.key ? styles.tabBtnActive : {}) }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <select
              style={{ ...styles.select, marginBottom: 16 }}
              value={applicationStatusFilter}
              onChange={e => setApplicationStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>

            {loadingApplications ? (
              <div style={styles.emptyState}>Loading…</div>
            ) : applications.length === 0 ? (
              <div style={styles.emptyState}>
                {applicationStatusFilter ? `No ${applicationStatusFilter} applications.` : 'No applications yet.'}
              </div>
            ) : (
              <div style={styles.cardList}>
                {applications.map(a => (
                  <div key={a.public_id} style={styles.recordCard}>
                    <div style={styles.recordInfo}>
                      <div style={styles.recordTitleRow}>
                        <span style={styles.recordTitle}>{a.name}</span>
                        <span style={{ ...styles.statusBadge, ...(APPLICATION_STATUS_BADGE_STYLES[a.status] || {}) }}>
                          {a.status}
                        </span>
                      </div>
                      <div style={styles.recordMeta}>
                        {[a.phone, a.email].filter(Boolean).join(' · ') || 'No contact info on file'}
                      </div>
                      {a.notes && <div style={styles.recordMetaSub}>{a.notes}</div>}
                    </div>
                    <div style={styles.recordActions}>
                      {a.status === 'pending' ? (
                        <>
                          <button onClick={() => decideApplication(a, 'approved')} style={styles.newBtnAlt}>Approve</button>
                          <button onClick={() => decideApplication(a, 'rejected')} style={styles.deleteBtn}>Reject</button>
                        </>
                      ) : (
                        <button onClick={() => decideApplication(a, 'pending')} style={styles.cancelBtnSmall}>Reopen</button>
                      )}
                      <button onClick={() => openEditApplication(a)} style={styles.editBtn}>Edit</button>
                      <button onClick={() => deleteApplication(a)} style={styles.deleteBtn}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>


      {showCustomerForm && (
        <div style={styles.modalOverlay} onClick={() => setShowCustomerForm(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{editingCustomer ? 'Edit customer' : 'New customer'}</h3>
            <div style={styles.formGrid}>
              <label style={styles.label}>Name</label>
              <input
                style={styles.input}
                value={customerForm.name}
                onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })}
                placeholder="e.g. Juan Dela Cruz"
              />
              <label style={styles.label}>Phone</label>
              <input
                style={styles.input}
                value={customerForm.phone}
                onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })}
                placeholder="e.g. 09171234567"
              />
              <label style={styles.label}>Email</label>
              <input
                style={styles.input}
                value={customerForm.email}
                onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })}
                placeholder="e.g. juan@email.com"
              />
              <label style={styles.label}>Address</label>
              <input
                style={styles.input}
                value={customerForm.address}
                onChange={e => setCustomerForm({ ...customerForm, address: e.target.value })}
                placeholder="Home or work address"
              />
              <label style={styles.label}>ID number</label>
              <input
                style={styles.input}
                value={customerForm.id_number}
                onChange={e => setCustomerForm({ ...customerForm, id_number: e.target.value })}
                placeholder="Driver's license / gov ID — for the contract"
              />
              <label style={styles.label}>Notes</label>
              <textarea
                style={{ ...styles.input, minHeight: 70, resize: 'vertical' }}
                value={customerForm.notes}
                onChange={e => setCustomerForm({ ...customerForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
            {editingCustomer && (
              <div style={{ marginTop: 4, marginBottom: 12, padding: 12, background: '#f8fafc', borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                  Wallet card
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                  Share this link so they can add their loan card to Google/Apple Wallet — that's how
                  they'll get payment reminders and your announcements. No login, no payment portal.
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(`${API_BASE.replace(/\/api$/, '')}/cl-wallet/${editingCustomer.public_id}`)
                    flash('Wallet link copied')
                  }}
                  style={{ ...styles.closeBtn, fontSize: 13 }}
                >
                  🔗 Copy wallet link
                </button>
              </div>
            )}
            <div style={styles.modalActions}>
              <button onClick={() => setShowCustomerForm(false)} style={styles.closeBtn}>Cancel</button>
              <button onClick={saveCustomer} disabled={savingCustomer} style={styles.saveBtn}>
                {savingCustomer ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showApplicationForm && (
        <div style={styles.modalOverlay} onClick={() => setShowApplicationForm(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>
              {editingApplication
                ? `Edit application`
                : `New ${APPLICATION_ROLES.find(r => r.key === applicationRoleTab)?.label.replace(' Application', '')} application`}
            </h3>
            <div style={styles.formGrid}>
              <label style={styles.label}>Name</label>
              <input
                style={styles.input}
                value={applicationForm.name}
                onChange={e => setApplicationForm({ ...applicationForm, name: e.target.value })}
                placeholder="e.g. Juan Dela Cruz"
              />
              <label style={styles.label}>Phone</label>
              <input
                style={styles.input}
                value={applicationForm.phone}
                onChange={e => setApplicationForm({ ...applicationForm, phone: e.target.value })}
                placeholder="e.g. 09171234567"
              />
              <label style={styles.label}>Email</label>
              <input
                style={styles.input}
                value={applicationForm.email}
                onChange={e => setApplicationForm({ ...applicationForm, email: e.target.value })}
                placeholder="e.g. juan@email.com"
              />
              <label style={styles.label}>Notes</label>
              <textarea
                style={{ ...styles.input, minHeight: 70, resize: 'vertical' }}
                value={applicationForm.notes}
                onChange={e => setApplicationForm({ ...applicationForm, notes: e.target.value })}
                placeholder={
                  applicationRoleTab === 'agent' ? 'Coverage area, experience, etc.'
                  : applicationRoleTab === 'buyer' ? 'Budget, preferred vehicle, etc.'
                  : 'Vehicle they want to list (make/model/year/asking price), etc.'
                }
              />
            </div>
            <div style={styles.modalActions}>
              <button onClick={() => setShowApplicationForm(false)} style={styles.closeBtn}>Cancel</button>
              <button onClick={saveApplication} disabled={savingApplication} style={styles.saveBtn}>
                {savingApplication ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddVehicleModal
        open={showVehicleForm}
        vehicle={editingVehicle}
        apiBase={API_BASE}
        businessId={businessId}
        onClose={() => setShowVehicleForm(false)}
        onSaved={(msg) => { flash(msg); loadData() }}
      />

      {showContractForm && (
        <div style={styles.modalOverlay} onClick={() => setShowContractForm(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{editingContract ? 'Edit contract' : 'New contract'}</h3>

            <div style={styles.photoGrid}>
              {contractForm.image_urls.map((url, idx) => (
                <div key={url + idx} style={styles.photoThumbWrap}>
                  <img src={url} alt={`Contract file ${idx + 1}`} style={styles.photoThumb} />
                  <button
                    type="button"
                    onClick={() => removeContractFile(idx)}
                    style={styles.photoRemoveBtn}
                    aria-label="Remove file"
                  >×</button>
                </div>
              ))}
              {contractForm.image_urls.length < CONTRACT_MAX_IMAGES && (
                <div
                  style={styles.photoAddTile}
                  onClick={() => !uploadingContractFile && contractFileInputRef.current && contractFileInputRef.current.click()}
                >
                  <input
                    ref={contractFileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => uploadContractFiles(e.target.files)}
                  />
                  {uploadingContractFile ? (
                    <div style={styles.uploadHint}>Uploading…</div>
                  ) : (
                    <div style={styles.uploadHint}>📎 Add file</div>
                  )}
                </div>
              )}
            </div>
            <div style={styles.photoCountHint}>{contractForm.image_urls.length}/{CONTRACT_MAX_IMAGES} files · signed contract, ID, receipts, etc</div>
            {contractFileError && <div style={styles.uploadError}>{contractFileError}</div>}

            <div style={styles.formGrid}>
              <label style={styles.label}>Customer</label>
              {editingContract ? (
                <div style={styles.readOnlyValue}>{editingContract.customer?.name || '—'}</div>
              ) : (
                <select
                  style={styles.select}
                  value={contractForm.customer_public_id}
                  onChange={e => setContractForm({ ...contractForm, customer_public_id: e.target.value })}
                >
                  <option value="">Select a customer…</option>
                  {customers.map(c => (
                    <option key={c.public_id} value={c.public_id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>
                  ))}
                </select>
              )}

              <label style={styles.label}>Vehicle</label>
              {editingContract ? (
                <div style={styles.readOnlyValue}>
                  {editingContract.vehicle ? `${editingContract.vehicle.year ? editingContract.vehicle.year + ' ' : ''}${editingContract.vehicle.make} ${editingContract.vehicle.model}` : '—'}
                </div>
              ) : (
                <select
                  style={styles.select}
                  value={contractForm.vehicle_public_id}
                  onChange={e => onSelectContractVehicle(e.target.value)}
                >
                  <option value="">Select a vehicle…</option>
                  {vehicles.filter(v => v.status !== 'sold').map(v => (
                    <option key={v.public_id} value={v.public_id}>
                      {v.year ? `${v.year} ` : ''}{v.make} {v.model}{v.plate_number ? ` — ${v.plate_number}` : ''} ({v.status})
                    </option>
                  ))}
                </select>
              )}

              <label style={styles.label}>Sale type</label>
              <select
                style={styles.select}
                value={contractForm.sale_type}
                onChange={e => setContractForm({ ...contractForm, sale_type: e.target.value })}
              >
                <option value="financed">Financed</option>
                <option value="cash">Cash</option>
              </select>

              <label style={styles.label}>Down payment (₱)</label>
              <input
                type="number"
                style={styles.input}
                value={contractForm.down_payment}
                onChange={e => setContractForm({ ...contractForm, down_payment: e.target.value })}
              />

              {contractForm.sale_type === 'financed' ? (
                <>
                  <label style={styles.label}>Monthly payment (₱)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={contractForm.installment_amount}
                    onChange={e => setContractForm({ ...contractForm, installment_amount: e.target.value })}
                  />

                  <label style={styles.label}>Term (months, 1–120)</label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    style={styles.input}
                    value={contractForm.term_months}
                    onChange={e => setContractForm({ ...contractForm, term_months: e.target.value })}
                  />

                  <label style={styles.label}>Payment frequency</label>
                  <select
                    style={styles.select}
                    value={contractForm.payment_frequency}
                    onChange={e => setContractForm({ ...contractForm, payment_frequency: e.target.value })}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="weekly">Weekly</option>
                  </select>

                  <label style={styles.label}>Vehicle price (₱)</label>
                  <div style={styles.readOnlyValue}>
                    ₱{(
                      (Number(contractForm.down_payment) || 0) +
                      (Number(contractForm.installment_amount) || 0) * (Number(contractForm.term_months) || 0)
                    ).toLocaleString()}
                    <span style={{ opacity: 0.6, fontWeight: 400 }}> (down payment + monthly payment × term)</span>
                  </div>
                </>
              ) : (
                <>
                  <label style={styles.label}>Vehicle price (₱)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={contractForm.vehicle_price}
                    onChange={e => setContractForm({ ...contractForm, vehicle_price: e.target.value })}
                  />
                </>
              )}

              <label style={styles.label}>Start date</label>
              <input
                type="date"
                style={styles.input}
                value={contractForm.start_date}
                onChange={e => setContractForm({ ...contractForm, start_date: e.target.value })}
              />

              {!editingContract && (
                <label style={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={contractForm.is_existing_loan}
                    onChange={e => setContractForm({ ...contractForm, is_existing_loan: e.target.checked })}
                  />
                  This is an existing loan already in progress (transferring from before)
                </label>
              )}

              {(contractForm.is_existing_loan || editingContract) && (
                <>
                  <div style={styles.formDivider}>Current loan status</div>
                  <label style={styles.label}>Balance remaining (₱)</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={contractForm.balance_remaining}
                    onChange={e => {
                      const balance_remaining = e.target.value
                      // Keep "terms remaining" in sync so it doesn't go stale
                      // when the balance is edited directly.
                      const terms_remaining = contractTermsRemaining(balance_remaining, contractForm.installment_amount)
                      setContractForm({ ...contractForm, balance_remaining, terms_remaining: terms_remaining ?? '' })
                    }}
                    placeholder="Leave blank to auto-calculate"
                  />
                  {contractForm.sale_type === 'financed' && (
                    <>
                      <label style={styles.label}>Monthly payment (₱)</label>
                      <div style={styles.readOnlyValue}>
                        ₱{(Number(contractForm.installment_amount) || 0).toLocaleString()}
                      </div>
                      <label style={styles.label}>Terms remaining</label>
                      <input
                        type="number"
                        min="0"
                        style={styles.input}
                        value={contractForm.terms_remaining}
                        onChange={e => {
                          const terms_remaining = e.target.value
                          const installment = Number(contractForm.installment_amount) || 0
                          // Auto-calculate the remaining balance from the
                          // number of payments left x the monthly payment.
                          const balance_remaining = terms_remaining !== ''
                            ? String(Math.max(Math.round(Number(terms_remaining) * installment * 100) / 100, 0))
                            : contractForm.balance_remaining
                          setContractForm({ ...contractForm, terms_remaining, balance_remaining })
                        }}
                        placeholder="e.g. 8"
                      />
                    </>
                  )}
                  <label style={styles.label}>Last paid date</label>
                  <input
                    type="date"
                    style={styles.input}
                    value={contractForm.last_paid_date}
                    onChange={e => setContractForm({ ...contractForm, last_paid_date: e.target.value })}
                  />
                  <label style={styles.label}>Next due date</label>
                  <input
                    type="date"
                    style={styles.input}
                    value={contractForm.next_due_date}
                    onChange={e => setContractForm({ ...contractForm, next_due_date: e.target.value })}
                  />
                  <label style={styles.label}>Status</label>
                  <select
                    style={styles.select}
                    value={contractForm.status}
                    onChange={e => setContractForm({ ...contractForm, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="overdue">Overdue</option>
                    <option value="completed">Completed</option>
                    <option value="repossessed">Repossessed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </>
              )}
            </div>
            <div style={styles.modalActions}>
              <button onClick={() => setShowContractForm(false)} style={styles.closeBtn}>Cancel</button>
              <button onClick={saveContract} disabled={savingContract} style={styles.saveBtn}>
                {savingContract ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {payingContract && (
        <div style={styles.modalOverlay} onClick={() => setPayingContract(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Log payment</h3>
            <div style={styles.readOnlyValue}>
              {payingContract.customer?.name || 'Unknown customer'} — {payingContract.vehicle ? `${payingContract.vehicle.year ? payingContract.vehicle.year + ' ' : ''}${payingContract.vehicle.make} ${payingContract.vehicle.model}` : 'Unknown vehicle'}
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                Balance remaining: ₱{Number(payingContract.balance_remaining || 0).toLocaleString()}
                {payingContract.next_due_date && ` · Next due ${payingContract.next_due_date}`}
              </div>
            </div>

            <div style={styles.formGrid}>
              <label style={styles.label}>Amount (₱)</label>
              <input
                type="number"
                style={styles.input}
                value={paymentForm.amount}
                onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              />
              <label style={styles.label}>Payment date</label>
              <input
                type="date"
                style={styles.input}
                value={paymentForm.payment_date}
                onChange={e => setPaymentForm({ ...paymentForm, payment_date: e.target.value })}
              />
              <label style={styles.label}>Method</label>
              <select
                style={styles.select}
                value={paymentForm.method}
                onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value })}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="gcash">GCash</option>
                <option value="other">Other</option>
              </select>
              <label style={styles.label}>Notes (optional)</label>
              <input
                style={styles.input}
                value={paymentForm.notes}
                onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })}
              />
            </div>

            <div style={styles.formDivider}>Payment history</div>
            {loadingHistory ? (
              <p style={styles.hint}>Loading…</p>
            ) : paymentHistory.length === 0 ? (
              <p style={styles.hint}>No payments logged yet.</p>
            ) : (
              <div style={{ ...styles.cardList, marginTop: 10, marginBottom: 10 }}>
                {paymentHistory.map((p, i) => (
                  <div key={p.public_id} style={{ ...styles.recordCard, padding: '8px 12px' }}>
                    <div style={styles.recordInfo}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>₱{Number(p.amount).toLocaleString()} · {p.payment_date}</div>
                      <div style={styles.recordMetaSub}>
                        {p.method || 'no method noted'}{p.notes ? ` — ${p.notes}` : ''}
                        {p.balance_after != null && ` · Balance after: ₱${Number(p.balance_after).toLocaleString()}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => setViewingReceipt({ ...p, customer: payingContract.customer, vehicle: payingContract.vehicle })} style={styles.editBtn}>Receipt</button>
                      <button onClick={() => openEditPayment(p, payingContract)} style={styles.editBtn}>Edit</button>
                      {i === 0 && (
                        <button onClick={() => undoPayment(p)} style={styles.deleteBtn}>Undo</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.modalActions}>
              <button onClick={() => setPayingContract(null)} style={styles.closeBtn}>Cancel</button>
              <button onClick={savePayment} disabled={savingPayment} style={styles.saveBtn}>
                {savingPayment ? 'Saving…' : 'Log payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showScanModal && (
        <div style={styles.modalOverlay} onClick={closeScanModal}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Scan buyer QR</h3>
            {scanSupported ? (
              <video ref={scanVideoRef} style={styles.scanVideo} muted playsInline />
            ) : (
              <p style={styles.hint}>Live camera scanning isn't supported on this browser/device. Type or paste the code from the buyer's QR instead:</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                value={scanManualInput}
                onChange={e => setScanManualInput(e.target.value)}
                placeholder="Buyer code"
              />
              <button onClick={() => scanManualInput.trim() && handleScanResult(scanManualInput.trim())} style={styles.saveBtn}>Find</button>
            </div>
            <div style={styles.modalActions}>
              <button onClick={closeScanModal} style={styles.closeBtn}>Close</button>
            </div>
          </div>
        </div>
      )}

      {scanPickList && (
        <div style={styles.modalOverlay} onClick={() => setScanPickList(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{scanPickList.customer.name} has more than one open loan</h3>
            <div style={styles.cardList}>
              {scanPickList.contracts.map(c => (
                <div key={c.public_id} style={styles.recordCard}>
                  <div style={styles.recordInfo}>
                    <div style={styles.recordTitle}>
                      {c.vehicle ? `${c.vehicle.year ? c.vehicle.year + ' ' : ''}${c.vehicle.make} ${c.vehicle.model}` : 'Unknown vehicle'}
                    </div>
                    <div style={styles.recordMetaSub}>Balance: ₱{Number(c.balance_remaining || 0).toLocaleString()}</div>
                  </div>
                  <button onClick={() => { setScanPickList(null); openLogPayment(c) }} style={styles.newBtn}>Select</button>
                </div>
              ))}
            </div>
            <div style={styles.modalActions}>
              <button onClick={() => setScanPickList(null)} style={styles.closeBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {historyCustomer && (
        <div style={styles.modalOverlay} onClick={() => setHistoryCustomer(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{historyCustomer.name} — payment history</h3>
            <p style={styles.hint}>Every payment logged across all of this buyer's contracts, newest first.</p>

            {loadingCustomerHistory ? (
              <p style={styles.hint}>Loading…</p>
            ) : customerHistory.length === 0 ? (
              <div style={styles.emptyState}>No payments logged for this buyer yet.</div>
            ) : (
              <div style={{ ...styles.cardList, marginTop: 10 }}>
                {customerHistory.map(p => (
                  <div key={p.public_id} style={{ ...styles.recordCard, padding: '8px 12px' }}>
                    <div style={styles.recordInfo}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>
                        ₱{Number(p.amount).toLocaleString()} · {p.payment_date}
                      </div>
                      <div style={styles.recordMetaSub}>
                        {p.vehicle ? `${p.vehicle.year ? p.vehicle.year + ' ' : ''}${p.vehicle.make} ${p.vehicle.model}` : 'Unknown vehicle'}
                        {' · '}{p.method || 'no method noted'}
                        {p.balance_after != null && ` · Balance after: ₱${Number(p.balance_after).toLocaleString()}`}
                      </div>
                      {p.receipt_number && <div style={styles.recordMetaSub}>{p.receipt_number}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => setViewingReceipt({ ...p, customer: historyCustomer })} style={styles.editBtn}>Receipt</button>
                      <button onClick={() => openEditPayment(p, { public_id: p.contract?.public_id })} style={styles.editBtn}>Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.modalActions}>
              <button onClick={() => setHistoryCustomer(null)} style={styles.closeBtn}>Close</button>
            </div>
          </div>
        </div>
      )}

      {viewingReceipt && (
        <div style={styles.modalOverlay} onClick={() => setViewingReceipt(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div className="cl-receipt-print">
              <h3 style={styles.modalTitle}>Payment receipt</h3>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{business?.name || 'Dealer'}</div>
              <div style={styles.formGrid}>
                <span style={styles.label}>Receipt #</span>
                <span style={styles.readOnlyValue}>{viewingReceipt.receipt_number || viewingReceipt.public_id}</span>
                <span style={styles.label}>Buyer</span>
                <span style={styles.readOnlyValue}>{viewingReceipt.customer?.name || 'Unknown customer'}</span>
                {viewingReceipt.vehicle && (
                  <>
                    <span style={styles.label}>Vehicle</span>
                    <span style={styles.readOnlyValue}>
                      {viewingReceipt.vehicle.year ? `${viewingReceipt.vehicle.year} ` : ''}{viewingReceipt.vehicle.make} {viewingReceipt.vehicle.model}
                    </span>
                  </>
                )}
                <span style={styles.label}>Date</span>
                <span style={styles.readOnlyValue}>{viewingReceipt.payment_date}</span>
                <span style={styles.label}>Amount</span>
                <span style={styles.readOnlyValue}>₱{Number(viewingReceipt.amount).toLocaleString()}</span>
                <span style={styles.label}>Method</span>
                <span style={styles.readOnlyValue}>{viewingReceipt.method || '—'}</span>
                {viewingReceipt.balance_after != null && (
                  <>
                    <span style={styles.label}>Balance after</span>
                    <span style={styles.readOnlyValue}>₱{Number(viewingReceipt.balance_after).toLocaleString()}</span>
                  </>
                )}
                {viewingReceipt.notes && (
                  <>
                    <span style={styles.label}>Notes</span>
                    <span style={styles.readOnlyValue}>{viewingReceipt.notes}</span>
                  </>
                )}
              </div>
            </div>
            <div style={styles.modalActions}>
              <button onClick={() => setViewingReceipt(null)} style={styles.closeBtn}>Close</button>
              <button onClick={() => window.print()} style={styles.saveBtn}>Print</button>
            </div>
          </div>
        </div>
      )}

      {customerQR && (
        <div style={styles.modalOverlay} onClick={() => setCustomerQR(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{customerQR.customer_name}'s QR code</h3>
            <p style={styles.hint}>Show this on the buyer's phone (or print it) — scan it from the Payments tab to log their payment.</p>
            <div style={styles.qrWrap}>
              <img src={svgToDataUri(customerQR.svg)} alt={`${customerQR.customer_name}'s QR code`} style={styles.qrImg} />
            </div>
            <div style={styles.modalActions}>
              <button onClick={() => setCustomerQR(null)} style={styles.closeBtn}>Close</button>
            </div>
          </div>
        </div>
      )}

      {walletShare && (
        <div style={styles.modalOverlay} onClick={() => setWalletShare(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Share {walletShare.customer_name}'s wallet card</h3>
            <p style={styles.hint}>For buyers already on the books who never scanned the Join QR themselves — let them scan this (or send the link) to add their card to their own phone's wallet.</p>
            <div style={styles.qrWrap}>
              <img src={svgToDataUri(walletShare.svg)} alt={`${walletShare.customer_name}'s wallet QR code`} style={styles.qrImg} />
            </div>
            <div style={{ ...styles.readOnlyValue, wordBreak: 'break-all', fontSize: 12 }}>{walletShare.wallet_url}</div>
            <div style={styles.modalActions}>
              <button onClick={() => setWalletShare(null)} style={styles.closeBtn}>Close</button>
              <button onClick={shareWalletLink} style={styles.saveBtn}>🔗 Share link</button>
            </div>
          </div>
        </div>
      )}

      {joinQR && (
        <div style={styles.modalOverlay} onClick={() => setJoinQR(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Buyer self-signup QR</h3>
            <p style={styles.hint}>Print or display this in the showroom. Scanning it lets a new buyer register themselves and add their card straight to Google/Apple Wallet — no dashboard data entry needed.</p>
            <div style={styles.qrWrap}>
              <img src={svgToDataUri(joinQR.svg)} alt="Buyer self-signup QR code" style={styles.qrImg} />
            </div>
            <div style={{ ...styles.readOnlyValue, wordBreak: 'break-all', fontSize: 12 }}>{joinQR.join_url}</div>
            <div style={styles.modalActions}>
              <button onClick={() => setJoinQR(null)} style={styles.closeBtn}>Close</button>
              <button onClick={() => window.print()} style={styles.saveBtn}>Print</button>
            </div>
          </div>
        </div>
      )}

      {showroomQR && (
        <div style={styles.modalOverlay} onClick={() => setShowroomQR(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Showroom QR</h3>
            <p style={styles.hint}>Print or display this so buyers can scan straight into your public showroom. It's also the "Browse Showroom" link on every buyer's Wallet loan card.</p>
            <div style={styles.qrWrap}>
              <img src={svgToDataUri(showroomQR.svg)} alt="Showroom QR code" style={styles.qrImg} />
            </div>
            <div style={{ ...styles.readOnlyValue, wordBreak: 'break-all', fontSize: 12 }}>{showroomQR.showroom_url}</div>
            <div style={styles.modalActions}>
              <button onClick={() => setShowroomQR(null)} style={styles.closeBtn}>Close</button>
              <button onClick={() => window.open(showroomQR.showroom_url, '_blank')} style={styles.cancelBtnSmall}>Open</button>
              <button onClick={() => window.print()} style={styles.saveBtn}>Print</button>
            </div>
          </div>
        </div>
      )}


      {editingPayment && (
        <div style={styles.modalOverlay} onClick={() => setEditingPayment(null)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Edit payment</h3>
            <p style={styles.hint}>Amount and date can only be changed on the contract's most recent payment — the backend will reject it otherwise. Method and notes can always be edited.</p>
            <div style={styles.formGrid}>
              <label style={styles.label}>Amount (₱)</label>
              <input
                type="number"
                style={styles.input}
                value={editPaymentForm.amount}
                onChange={e => setEditPaymentForm({ ...editPaymentForm, amount: e.target.value })}
              />
              <label style={styles.label}>Payment date</label>
              <input
                type="date"
                style={styles.input}
                value={editPaymentForm.payment_date}
                onChange={e => setEditPaymentForm({ ...editPaymentForm, payment_date: e.target.value })}
              />
              <label style={styles.label}>Method</label>
              <select
                style={styles.select}
                value={editPaymentForm.method}
                onChange={e => setEditPaymentForm({ ...editPaymentForm, method: e.target.value })}
              >
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="gcash">GCash</option>
                <option value="other">Other</option>
              </select>
              <label style={styles.label}>Notes (optional)</label>
              <input
                style={styles.input}
                value={editPaymentForm.notes}
                onChange={e => setEditPaymentForm({ ...editPaymentForm, notes: e.target.value })}
              />
            </div>
            <div style={styles.modalActions}>
              <button onClick={() => setEditingPayment(null)} style={styles.closeBtn}>Cancel</button>
              <button onClick={saveEditPayment} disabled={savingEditPayment} style={styles.saveBtn}>
                {savingEditPayment ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMessageForm && (
        <div style={styles.modalOverlay} onClick={() => setShowMessageForm(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{messageTarget ? `Message ${messageTarget.name}` : 'Message all customers'}</h3>
            <p style={styles.hint}>{messageTarget ? 'Pushed to this buyer\'s wallet card. They only get it if they\'ve added it.' : 'Pushed to every buyer\'s wallet card at once — including buyers with no active loan.'}</p>
            <div style={styles.formGrid}>
              <label style={styles.label}>Title</label>
              <input
                style={styles.input}
                value={messageForm.title}
                onChange={e => setMessageForm({ ...messageForm, title: e.target.value })}
                placeholder="e.g. Payment reminder"
              />
              <label style={styles.label}>Message</label>
              <textarea
                style={{ ...styles.input, minHeight: 90, resize: 'vertical' }}
                value={messageForm.message}
                onChange={e => setMessageForm({ ...messageForm, message: e.target.value })}
              />
            </div>
            <div style={styles.modalActions}>
              <button onClick={() => setShowMessageForm(false)} style={styles.closeBtn}>Cancel</button>
              <button onClick={sendMessage} disabled={savingMessage} style={styles.saveBtn}>
                {savingMessage ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMessageHistory && (
        <div style={styles.modalOverlay} onClick={() => setShowMessageHistory(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Message history</h3>
            {clAnnouncements.length === 0 ? (
              <p style={styles.hint}>No messages sent yet.</p>
            ) : (
              <div style={styles.cardList}>
                {clAnnouncements.map(m => (
                  <div key={m.id} style={{ ...styles.recordCard, flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={styles.recordTitle}>{m.title}</div>
                    <div style={styles.recordMetaSub}>{m.customer ? `To ${m.customer.name}` : 'Broadcast to all'} · sent to {m.sent_count}/{m.recipient_count}</div>
                    <div style={styles.recordMeta}>{m.message}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={styles.modalActions}>
              <button onClick={() => setShowMessageHistory(false)} style={styles.closeBtn}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS_BADGE_STYLES = {
  available: { background: '#dcfce7', color: '#15803d' },
  reserved: { background: '#fef9c3', color: '#a16207' },
  financed: { background: '#dbeafe', color: '#1d4ed8' },
  sold: { background: '#f1f5f9', color: '#64748b' },
}

const CONTRACT_STATUS_BADGE_STYLES = {
  active: { background: '#dbeafe', color: '#1d4ed8' },
  overdue: { background: '#fee2e2', color: '#dc2626' },
  completed: { background: '#dcfce7', color: '#15803d' },
  repossessed: { background: '#fef3c7', color: '#b45309' },
  cancelled: { background: '#f1f5f9', color: '#64748b' },
}

const APPLICATION_STATUS_BADGE_STYLES = {
  pending: { background: '#fef9c3', color: '#a16207' },
  approved: { background: '#dcfce7', color: '#15803d' },
  rejected: { background: '#fee2e2', color: '#dc2626' },
}

// ---------- Net income / top agent helpers (Overview tab) ----------
// price - total_cost per deal is the definition of profit used here; the
// buyer's actual price on a given deal (contract.vehicle_price) is used
// over the vehicle's current listed price since the two can drift (owner
// negotiated, or edited the listing after the sale).
function formatPeso(n) {
  const v = Number(n || 0)
  const sign = v < 0 ? '-' : ''
  return `${sign}₱${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function startOfWeek(d) {
  const date = new Date(d)
  date.setHours(0, 0, 0, 0)
  const day = date.getDay() // 0 = Sun
  const diffToMonday = (day + 6) % 7
  date.setDate(date.getDate() - diffToMonday)
  return date
}
function startOfMonth(d) { const date = new Date(d); return new Date(date.getFullYear(), date.getMonth(), 1) }
function startOfQuarter(d) { const date = new Date(d); const q = Math.floor(date.getMonth() / 3); return new Date(date.getFullYear(), q * 3, 1) }
function startOfYear(d) { const date = new Date(d); return new Date(date.getFullYear(), 0, 1) }

// Builds one { profit, dealDate, agent } entry per contract, matching each
// contract back to its full vehicle record (for total_cost/agent_name) by
// public_id since the contracts list only embeds a lightweight vehicle
// summary.
function computeDealProfits(vehicles, contracts) {
  const vehicleByPublicId = {}
  vehicles.forEach(v => { vehicleByPublicId[v.public_id] = v })
  return (contracts || [])
    .map(c => {
      const linked = (c.vehicle && c.vehicle.public_id && vehicleByPublicId[c.vehicle.public_id]) || c.vehicle || {}
      const totalCost = Number(linked.total_cost || 0)
      const sellPrice = Number(c.vehicle_price != null ? c.vehicle_price : (linked.price || 0))
      const dealDate = c.start_date || c.created_at
      return {
        profit: sellPrice - totalCost,
        dealDate,
        agent: (linked.agent_name && linked.agent_name.trim()) || 'Unassigned',
      }
    })
    .filter(d => d.dealDate)
}

// Returns { profit, count } for each period bucket - count is the number
// of deals (vehicles sold/financed) whose date falls in that bucket, so
// the Overview card can show both net income and units sold for whichever
// period the owner has selected.
function netIncomeByPeriod(deals) {
  const now = new Date()
  const bucket = (start) => {
    const inRange = deals.filter(d => new Date(d.dealDate) >= start)
    return { profit: inRange.reduce((sum, d) => sum + d.profit, 0), count: inRange.length }
  }
  return {
    week: bucket(startOfWeek(now)),
    month: bucket(startOfMonth(now)),
    quarter: bucket(startOfQuarter(now)),
    year: bucket(startOfYear(now)),
  }
}

function rankAgents(deals) {
  const byAgent = {}
  deals.forEach(d => {
    if (!byAgent[d.agent]) byAgent[d.agent] = { agent: d.agent, profit: 0, deals: 0 }
    byAgent[d.agent].profit += d.profit
    byAgent[d.agent].deals += 1
  })
  return Object.values(byAgent).sort((a, b) => b.profit - a.profit)
}

const INCOME_PERIOD_LABELS = { week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year' }

// Single net-income card with a period dropdown (week/month/quarter/year)
// instead of 4 separate cards - swaps the figure + units-sold count shown
// underneath based on the selected period.
function NetIncomeCard({ period, onPeriodChange, stats }) {
  const val = stats[period] || { profit: 0, count: 0 }
  return (
    <div style={styles.statCard}>
      <select
        value={period}
        onChange={e => onPeriodChange(e.target.value)}
        style={styles.periodSelect}
      >
        {Object.entries(INCOME_PERIOD_LABELS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <div style={{ ...styles.statValue, color: val.profit < 0 ? '#dc2626' : '#16a34a' }}>{formatPeso(val.profit)}</div>
      <div style={styles.statLabel}>Net income</div>
      <div style={styles.statHint}>{val.count} vehicle{val.count === 1 ? '' : 's'} sold</div>
    </div>
  )
}

function StatCard({ label, value, accent, hint }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color: accent || '#0f172a' }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
      {hint && <div style={styles.statHint}>{hint}</div>}
    </div>
  )
}

const styles = {
  loadingScreen: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#64748b', fontSize: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  container: {
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 24px', background: '#0f172a', color: 'white',
    position: 'sticky', top: 0, zIndex: 100,
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12 },
  brandName: { margin: 0, fontSize: 18, fontWeight: 700, color: 'white' },
  brandTagline: { margin: 0, fontSize: 12, color: '#94a3b8' },
  logoutBtn: {
    padding: '8px 16px', background: 'transparent', color: '#cbd5e1',
    border: '1px solid #334155', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  toast: {
    position: 'fixed', top: 80, right: 24, padding: '12px 20px', background: '#0d9488',
    color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 500,
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 200,
  },
  tabBar: {
    display: 'flex', gap: 4, padding: '0 24px', background: 'white',
    borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 57, zIndex: 90, overflowX: 'auto',
  },
  tabBtn: {
    padding: '14px 16px', background: 'transparent', border: 'none', borderBottom: '2px solid transparent',
    color: '#64748b', fontSize: 14, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  tabBtnActive: { color: '#0f172a', borderBottom: '2px solid #0f172a' },
  body: { padding: '24px', maxWidth: 1200, margin: '0 auto' },
  statsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 12, marginBottom: 24,
  },
  statCard: { background: 'white', borderRadius: 12, padding: '16px 18px', border: '1px solid #e2e8f0' },
  statValue: { fontSize: 24, fontWeight: 700 },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  statHint: { fontSize: 11, color: '#cbd5e1', marginTop: 6 },
  placeholder: {
    background: 'white', border: '1px dashed #cbd5e1', borderRadius: 12,
    padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14,
  },
  panelSection: { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '18px 20px' },
  select: {
    padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 13, background: 'white', cursor: 'pointer',
  },
  periodSelect: {
    padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6,
    fontSize: 11, background: '#f8fafc', cursor: 'pointer', color: '#64748b',
    marginBottom: 8, fontWeight: 600,
  },
  cardList: { display: 'flex', flexDirection: 'column', gap: 10 },
  recordCard: {
    display: 'flex', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between',
    border: '1px solid #f1f5f9', borderRadius: 10, padding: '12px 14px', flexWrap: 'wrap',
  },
  recordInfo: { flex: 1, minWidth: 200 },
  recordTitleRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  recordTitle: { fontWeight: 600, fontSize: 14, color: '#0f172a' },
  recordMeta: { fontSize: 13, color: '#475569', marginTop: 4 },
  recordMetaSub: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  recordActions: { display: 'flex', gap: 8, flexShrink: 0 },
  vehicleThumb: { width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 },
  statusBadge: {
    fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '3px 9px',
    textTransform: 'uppercase', letterSpacing: 0.3,
  },
  announcementsSection: { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '18px 20px' },
  sectionHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' },
  sectionSubtitle: { margin: '4px 0 16px', fontSize: 13, color: '#64748b' },
  newBtn: {
    padding: '8px 14px', background: '#0f172a', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  newBtnAlt: {
    padding: '8px 14px', background: '#0d9488', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  cancelBtnSmall: {
    padding: '8px 14px', background: 'white', color: '#475569',
    border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  scanVideo: {
    width: '100%', borderRadius: 12, background: '#0f172a', maxHeight: 320, objectFit: 'cover',
  },
  qrWrap: {
    display: 'flex', justifyContent: 'center', padding: 16, background: 'white',
  },
  qrImg: {
    width: 220, height: 220, imageRendering: 'pixelated',
  },
  emptyState: { color: '#94a3b8', fontSize: 13, padding: '20px 0', textAlign: 'center' },
  walletSetupCard: {
    background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10,
    padding: '14px 16px', marginBottom: 18,
  },
  walletSetupTitle: { margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' },
  walletSetupHint: { fontSize: 12, color: '#94a3b8' },
  walletSetupSubtitle: { margin: '4px 0 14px', fontSize: 12.5, color: '#64748b' },
  walletRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  walletRowInfo: { display: 'flex', alignItems: 'center', gap: 10 },
  walletRowLabel: { fontSize: 13.5, fontWeight: 600, color: '#0f172a' },
  walletSetupNote: { margin: '8px 0 0', fontSize: 12, color: '#94a3b8' },
  announcementsList: { display: 'flex', flexDirection: 'column', gap: 10 },
  announcementCard: {
    display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start',
    border: '1px solid #f1f5f9', borderRadius: 10, padding: '12px 14px', flexWrap: 'wrap',
  },
  announcementInfo: { flex: 1, minWidth: 200 },
  announcementTitleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  announcementTitle: { fontWeight: 600, fontSize: 14, color: '#0f172a' },
  inactiveBadge: {
    fontSize: 10, fontWeight: 700, color: '#94a3b8', background: '#f1f5f9',
    borderRadius: 999, padding: '2px 8px',
  },
  announcementMessage: { fontSize: 13, color: '#475569', marginTop: 4 },
  announcementMeta: { fontSize: 11, color: '#94a3b8', marginTop: 6 },
  announcementActions: { display: 'flex', gap: 8, flexShrink: 0 },
  editBtn: {
    padding: '6px 12px', background: 'transparent', color: '#0d9488',
    border: '1px solid #a7f3d0', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },
  deleteBtn: {
    padding: '6px 12px', background: 'transparent', color: '#dc2626',
    border: '1px solid #fecaca', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 16,
  },
  modal: {
    background: 'white', borderRadius: 16, padding: 28, width: 440,
    maxHeight: '85vh', overflow: 'auto',
  },
  modalTitle: { margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: '#0f172a' },
  uploadZone: {
    border: '2px dashed #cbd5e1', borderRadius: 12, padding: '18px 12px', textAlign: 'center',
    cursor: 'pointer', marginBottom: 16, background: '#f8fafc', transition: 'border-color 0.15s, background 0.15s',
  },
  uploadZoneActive: { borderColor: '#0d9488', background: '#f0fdfa' },
  uploadPreview: { width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8, marginBottom: 8 },
  uploadHint: { fontSize: 13, color: '#64748b' },
  photoGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 6,
  },
  photoThumbWrap: {
    position: 'relative', borderRadius: 10, overflow: 'hidden', aspectRatio: '1 / 1', background: '#f1f5f9',
  },
  photoThumb: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  photoMainBadge: {
    position: 'absolute', bottom: 4, left: 4, background: 'rgba(15,23,42,0.75)', color: 'white',
    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, letterSpacing: 0.3,
  },
  photoRemoveBtn: {
    position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', border: 'none',
    background: 'rgba(15,23,42,0.75)', color: 'white', fontSize: 14, lineHeight: '20px', cursor: 'pointer', padding: 0,
  },
  photoAddTile: {
    aspectRatio: '1 / 1', border: '2px dashed #cbd5e1', borderRadius: 10, display: 'flex',
    alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer',
    background: '#f8fafc', transition: 'border-color 0.15s, background 0.15s', padding: 4,
  },
  photoCountHint: { fontSize: 11.5, color: '#94a3b8', marginBottom: 16 },
  uploadError: {
    background: '#fef2f2', color: '#dc2626', fontSize: 12.5, padding: '8px 12px',
    borderRadius: 8, marginBottom: 12,
  },
  formGrid: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 },
  label: { fontSize: 12, fontWeight: 600, color: '#64748b', marginTop: 8 },
  input: {
    padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  readOnlyValue: {
    padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8,
    fontSize: 14, color: '#334155',
  },
  checkboxRow: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155',
    marginTop: 10, cursor: 'pointer',
  },
  formDivider: {
    fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
    letterSpacing: 0.5, marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12,
  },
  closeBtn: {
    padding: '10px 16px', background: '#f1f5f9', color: '#334155',
    border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  saveBtn: {
    padding: '10px 16px', background: '#0f172a', color: 'white',
    border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
}

export default CarLendingDashboard
