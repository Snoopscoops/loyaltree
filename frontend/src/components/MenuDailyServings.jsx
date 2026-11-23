import React, { useEffect, useMemo, useState } from 'react'
import { requestJsonResponse } from './requestTimeout'

/** Shared owner/cashier serving controls. The SQL RPC is the only writer.
 * A day begins at midnight Asia/Manila; the counter never trusts these numbers.
 */
export default function MenuDailyServings({ API_BASE, slug, request, active = true }) {
  const [data, setData] = useState(null)
  const [branch, setBranch] = useState('')
  const [item, setItem] = useState('')
  const [variant, setVariant] = useState('*')
  const [limit, setLimit] = useState('')
  const [repeat, setRepeat] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const base = `${API_BASE}/api/v1/business/${encodeURIComponent(slug || '')}/menu-inventory`
  const load = async signal => {
    if (!slug || !active) return
    setError('')
    try {
      const {response, payload} = await requestJsonResponse(request,base,{cache:'no-store',signal})
      if (!response.ok || !Array.isArray(payload?.rows)) throw new Error(payload?.detail || 'Inventory could not load.')
      setData(payload)
      setBranch(old=>payload.branches.some(b=>b.public_id===old)?old:(payload.branches[0]?.public_id||''))
      setItem(old=>payload.items.some(i=>i.public_id===old)?old:(payload.items[0]?.public_id||''))
    } catch (exc) {if (!signal?.aborted) setError(exc.message || 'Inventory could not load.')}
  }
  useEffect(()=>{if (!active) return undefined; const c=new AbortController();void load(c.signal);return ()=>c.abort()},[base,active,request])
  const selectedItem = data?.items?.find(value=>value.public_id===item)
  const rows = useMemo(()=>data?.rows?.filter(row=>row.branch_public_id===branch) || [],[data,branch])
  const current = rows.find(row=>row.item_public_id===item && row.variant_key===variant)
  const apply = async event => {
    event.preventDefault()
    const amount = Number(limit)
    if (!Number.isInteger(amount) || amount < 0 || amount > 100000) {setError('Enter a whole number of servings from 0 to 100000.');return}
    if (!branch || !item) {setError('Choose a branch and an item.');return}
    setSaving(true);setError('');setNotice('')
    try {
      const {response,payload} = await requestJsonResponse(request,base,{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({branch_public_id:branch,item_public_id:item,variant_key:variant,initial_servings:amount,repeat_daily:repeat})
      })
      if (!response.ok) throw new Error(payload?.detail || 'Could not update servings.')
      setNotice('Servings saved. The menu will block sold-out orders. Customers may need to refresh to see the latest count.')
      await load()
    } catch (exc) {setError(exc.message || 'Could not update servings.')} finally {setSaving(false)}
  }
  return <section className="lt-v18-stock" aria-label="Daily serving inventory">
    <header><div><strong>Daily servings</strong><p>Set opening servings per branch and optional variant. Remaining quantities are calculated from confirmed and reserved orders.</p></div><button type="button" disabled={saving} onClick={()=>void load()}>Refresh</button></header>
    {data && <p className="lt-v18-stock-day">Operating day: {data.service_day} (Philippine time)</p>}
    {error && <p role="alert" className="lt-v18-stock-error">{error}</p>}
    {notice && <p role="status" className="lt-v18-stock-success">{notice}</p>}
    {!data && !error && <p role="status">Loading daily inventory…</p>}
    {data && <>
      <form onSubmit={apply}>
        <label>Branch<select value={branch} onChange={e=>setBranch(e.target.value)}>{data.branches.map(b=><option key={b.public_id} value={b.public_id}>{b.name}</option>)}</select></label>
        <label>Item<select value={item} onChange={e=>{setItem(e.target.value);setVariant('*');setLimit('')}}>{data.items.map(i=><option key={i.public_id} value={i.public_id}>{i.name}</option>)}</select></label>
        <label>Stock pool<select value={variant} onChange={e=>{setVariant(e.target.value);setLimit('')}}>
          <option value="*">Shared item servings (all sizes)</option>
          {(selectedItem?.variants||[]).map(o=><option key={o.public_id} value={o.public_id}>{o.name}</option>)}
        </select></label>
        <label>Initial servings<input inputMode="numeric" type="number" min="0" max="100000" step="1" required value={limit} placeholder={current?String(current.initial_servings):'e.g. 30'} onChange={e=>setLimit(e.target.value)}/></label>
        <label className="lt-v18-stock-check"><input type="checkbox" checked={repeat} onChange={e=>setRepeat(e.target.checked)}/> Use this opening quantity every day</label>
        <button type="submit" disabled={saving}>{saving?'Saving…':'Save daily servings'}</button>
      </form>
      {current && <p className="lt-v18-stock-state">Today: <b>{current.initial_servings}</b> opening · <b>{current.reserved}</b> reserved · <b>{current.consumed}</b> consumed · <b>{current.remaining}</b> remaining</p>}
      <p className="lt-v18-stock-hint">Tip: Set shared item stock for a total daily limit. Set specific Size options separately when Small, Medium and Large have independent quantities. Other options such as sweetness do not need separate counts. A zero remaining limit automatically blocks that item/option.</p>
      <div className="lt-v18-stock-list">{rows.filter(r=>r.item_public_id===item).map(row=><div key={`${row.item_public_id}:${row.variant_key}`}><span>{row.variant_key==='*'?'All sizes':(selectedItem?.variants.find(v=>v.public_id===row.variant_key)?.name||row.variant_key)}</span><b>{row.remaining} left</b><small>{row.reserved} reserved · {row.consumed} consumed · {row.initial_servings} initial</small></div>)}</div>
    </>}
  </section>
}
