import React, { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import loyaltyTreeLogo from './logo-64.png'
import './wallet-pass-preview.css'

function passTextColor(color) {
  const hex = String(color || '').replace('#', '')
  const expanded = /^[a-f\d]{3}$/i.test(hex) ? hex.split('').map(char => char + char).join('') : hex
  if (!/^[a-f\d]{6}$/i.test(expanded)) return '#fff'
  const rgb = [0, 2, 4].map(index => parseInt(expanded.slice(index, index + 2), 16))
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 170 ? '#0f172a' : '#fff'
}

export default function WalletPassPreview({ provider, form, model, primaryColor, bannerBackground, progressBanner }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const apple = provider === 'apple'
  const color = passTextColor(primaryColor)
  const showBanner = !!progressBanner || form.wallet_show_background !== false
  const initials = model.businessName.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase()
  const detailScale = Math.max(.7, Math.min(1.3, Number(form.wallet_detail_font_scale) || 1))
  const fields = (items, extraClass = '') => <div className={`lt-wallet-fields ${extraClass}`}>
    {items.filter(Boolean).map((item, index) => <div key={`${item.label}-${index}`}><small>{item.label}</small><strong>{item.value}</strong></div>)}
  </div>
  const logo = form.program_logo_url
    ? <img className="lt-wallet-business-logo" src={form.program_logo_url} alt="Business logo"/>
    : <span className="lt-wallet-business-logo lt-wallet-initials">{initials || 'LT'}</span>

  return <div className={`lt-wallet-preview ${apple ? 'lt-wallet-apple' : 'lt-wallet-google'}`}>
    <div className="lt-wallet-device-header"><span>{apple ? 'Wallet' : 'Google Wallet'}</span><span className="lt-wallet-live">Live preview</span></div>
    <div className="lt-wallet-toolbar"><span>{apple ? 'Done' : '‹'}</span><button type="button" onClick={() => setDetailsOpen(value => !value)} aria-expanded={detailsOpen} aria-label={`${detailsOpen ? 'Close' : 'Open'} ${apple ? 'Apple Pass Details' : 'Google pass details'}`}>{detailsOpen ? '×' : '•••'}</button></div>
    {detailsOpen ? <div className="lt-wallet-details">
      <h4>{apple ? 'Pass Details' : 'Pass details'}</h4>
      <p className="lt-wallet-details-title">{model.title}</p>
      <div className="lt-wallet-action-list">
        {model.actions.map(action => <div key={action.id} className="lt-wallet-action-detail"><strong>{action.primary ? '★ ' : '↗ '}{action.label}</strong><span>{action.url}</span></div>)}
        <div className="lt-wallet-action-detail"><strong>View Rewards / Account ›</strong><span>Member card and history</span></div>
        <div className="lt-wallet-action-detail"><strong>Rate Your Experience ›</strong><span>Member feedback</span></div>
      </div>
      {fields(model.details, 'lt-wallet-detail-fields')}
      <button type="button" className="lt-wallet-back" onClick={() => setDetailsOpen(false)}>Back to card</button>
    </div> : <>
      <div className="lt-wallet-native-card" style={{ backgroundColor: primaryColor, color, '--lt-wallet-detail-scale': detailScale }}>
        <div className="lt-wallet-card-header">
          {logo}
          <div className="lt-wallet-card-heading">{apple ? <><small>CARD</small><strong>{model.title}</strong></> : <><small>{model.businessName}</small><strong>{model.title}</strong></>}</div>
        </div>
        {showBanner && <div className="lt-wallet-banner" style={{ background: bannerBackground }}>
          {form.hero_image_url && <img src={form.hero_image_url} alt="Card artwork"/>}
          {progressBanner ? <div className="lt-wallet-banner-progress">{progressBanner}</div> : !form.hero_image_url && <div className="lt-wallet-generated-art"><span>{model.businessName}</span><strong>{model.title}</strong><span>{model.metric.label} · {model.metric.value}</span></div>}
        </div>}
        <div className="lt-wallet-card-information">
          {apple ? <>
            {fields(model.appleFields, form.card_type === 'stamp' ? 'lt-wallet-stamp-fields' : '')}
            {fields(model.auxiliaryFields, 'lt-wallet-auxiliary-fields')}
          </> : <>
            {fields([{ label: 'MEMBER', value: 'Sample Member' }, model.metric])}
            {model.secondaryMetric && fields([model.secondaryMetric], 'lt-wallet-auxiliary-fields')}
          </>}
        </div>
        <div className="lt-wallet-barcode"><div><QRCodeSVG value="https://theloyaltytree.com/preview/sample-member" size={116} level="M" includeMargin/></div><span>Sample Member</span></div>
        {!apple && model.primaryAction && <button type="button" className="lt-wallet-primary-action" onClick={() => setDetailsOpen(true)}>{model.primaryAction.label}<span>↗</span></button>}
      </div>
      {!apple && <div className="lt-wallet-google-details">{fields(model.details.slice(0, 2), 'lt-wallet-detail-fields')}<button type="button" className="lt-wallet-back" onClick={() => setDetailsOpen(true)}>Show details &amp; links</button></div>}
      {apple && <button type="button" className="lt-wallet-pass-details" onClick={() => setDetailsOpen(true)}>Pass Details <span>›</span></button>}
    </>}
    <div className="lt-wallet-preview-footer"><img src={loyaltyTreeLogo} alt=""/><span>Powered by Loyalty Tree</span></div>
    <p className="lt-wallet-preview-note">Sample member. Edits appear here instantly; publish to update customer cards. Wallet apps may adjust spacing and text size.</p>
  </div>
}
