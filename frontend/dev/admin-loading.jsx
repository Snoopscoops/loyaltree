import React from 'react'
import { createRoot } from 'react-dom/client'
import AdminDashboard from '../src/components/AdminDashboard'

// Provider-free UI fixture. No production account or network access.
const requests = []
const scenario = new URLSearchParams(location.search).get('scenario')
const businesses = [
  {public_id:'fixture-cafe',name:'Fixture Cafe',status:'ACTIVE',plan:'growth',business_type:'coffee',customer_count:8,staff_count:2},
  {public_id:'fixture-shop',name:'Fixture Shop',status:'PENDING',plan:'starter',business_type:'retail',customer_count:0,staff_count:0},
]
window.fetch = async (url, options = {}) => {
  const path = new URL(url,location.origin).pathname
  requests.push(path)
  document.getElementById('requests').textContent = `${requests.length} requests\n${requests.join('\n')}`
  if (scenario === 'slow-partners' && path.includes('partners')) {
    return new Promise((resolve,reject) => options.signal?.addEventListener('abort',() => reject(new DOMException('Aborted','AbortError')),{once:true}))
  }
  if (scenario === 'error' && path.endsWith('/overview')) return Response.json({detail:'Overview temporarily unavailable'},{status:503})
  const data = path.endsWith('/overview') ? {total_businesses:2,total_customers:8,status_breakdown:{ACTIVE:1,PENDING:1},plan_breakdown:{growth:1,starter:1}}
    : path.endsWith('/plans') ? {starter:{label:'Starter'},growth:{label:'Growth'}}
    : path.endsWith('/businesses') ? businesses : []
  return Response.json(data)
}
createRoot(document.getElementById('root')).render(<AdminDashboard API_BASE="" user={{token:'fixture-only'}} onLogout={() => {}} />)
