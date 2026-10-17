// Fictional data only. No native fetch, credentials, charges, or wallet sends.
export const fixtureSlug = 'demo-daylight'
export const fixtureUser = { role: 'owner', token: 'local-fixture-not-a-signed-token', name: 'Alex Morgan', business_slug: fixtureSlug, business_public_id: 'demo-business-daylight', business_name: 'Daylight Coffee', business_type: 'coffee' }
export const scenarios = ['stamp', 'points', 'membership', 'multipass', 'vip', 'hybrid', 'employee']
const date = (days = 0) => new Date(Date.now() + days * 86400000).toISOString()
const clone = x => JSON.parse(JSON.stringify(x))
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><rect width="220" height="220" fill="white"/><g fill="#173f35"><path d="M20 20h50v50H20zm130 0h50v50h-50zM20 150h50v50H20zM90 20h20v30H90zm0 60h30v30H90zm50 10h20v40h-20zM90 140h30v60H90zm50 10h60v20h-60zm40-50h20v30h-20z"/></g><text x="110" y="215" font-size="9" text-anchor="middle" fill="#173f35">LOCAL PREVIEW · NOT SCANNABLE</text></svg>'
export const qrImage = `data:image/svg+xml,${encodeURIComponent(svg)}`
function makeConfig(card_type, public_id = 'demo-program-main') {
  return { public_id, program_public_id: public_id, is_default: public_id === 'demo-program-main', is_active: true,
    member_count: public_id === 'demo-program-main' ? 8 : 0, program_name: public_id === 'demo-program-main' ? 'Daylight Rewards' : 'Weekend Rewards', card_name: 'Your daily little reward', card_type,
    primary_color: '#173f35', secondary_color: '#e5eddb', stamp_goal: 8, reward_name: 'A coffee on us', stamp_display_style: 'icon', stamp_icon: 'coffee',
    google_wallet_class_id: 'local-preview-class', is_configured: true, stamp_rewards: [{ id: 'reward-coffee', stamps: 8, reward_name: 'A coffee on us' }],
    stamp_once_per_day: true, stamp_reset_after_final: true, reward_expiry_days: 30, points_per_peso: 1, points_per_currency: 1,
    points_rewards: [{ id: 'points-coffee', points: 100, reward_name: 'A coffee on us' }],
    membership_duration_days: 30, membership_price: 550, membership_services: ['Coffee club visit', 'Member discount'], membership_terms: 'Fictional preview benefits.', membership_visit_logging_enabled: true,
    multipass_total_sessions: 10, multipass_sessions: 10, multipass_validity_days: 90, vip_progression_type: 'points',
    vip_tiers: [{ id: 'tier-0', name: 'Member', threshold: 0, color: '#173f35', benefits: [], active: true }, { id: 'tier-gold', name: 'Gold', threshold: 100, color: '#b58c46', discount_percent: 10, benefits: ['Priority pickup'], active: true }],
    hybrid_loyalty_type: 'points', hybrid_points_enabled: true, hybrid_stamps_enabled: false, hybrid_tier_enabled: true, hybrid_tier_progression_type: 'points',
    employee_time_tracking_enabled: false, employee_benefits: [{ id:'demo-staff-benefit',name:'Staff coffee',benefit_type:'free_item',usage_limit:1,reset_period:'daily',active:true }], membership_employee_mode: false, program_logo_url: '', logo_url: '', hero_image_url: '' }
}
export function createFixtureTransport({ scenario = 'stamp', onRequest = () => {} } = {}) {
  const cardType = scenarios.includes(scenario) ? scenario : 'stamp'
  const configs = [makeConfig(cardType), makeConfig(cardType, 'demo-program-weekend')]
  const business = { public_id: 'demo-business-daylight', business_slug: fixtureSlug, business_name: 'Daylight Coffee', business_type: 'coffee', status: 'active', plan: 'pro', display_currency: 'PHP', country_code: 'PH', logo_url: '', onboarding_completed: true, onboarding_step: 9, order_ahead_enabled: true, owner_name: 'Alex Morgan', created_at: date(-180) }
  const branches = [{ id: 1, public_id: 'demo-branch-main', name: 'Main Café', is_active: true, address: 'Fictional location' }, { id: 2, public_id: 'demo-branch-riverside', name: 'Riverside', is_active: true, address: 'Fictional location' }]
  const customers = ['Jamie Cruz', 'Mika Santos', 'Sam Reyes', 'Avery Tan', 'Riley Lim', 'Casey Lee', 'Jordan Flores', 'Taylor Diaz'].map((name, i) => ({ id: i + 1, public_id: `demo-member-${i + 1}`, identity_id: `demo-person-${i + 1}`, name, email: '', phone: '', stamp_count: [8,6,3,7,1,4,2,8][i], points_balance: [125,80,55,140,20,65,30,100][i], reward_unlocked: i === 0 || i === 7, created_at: date(-50 + i * 3), last_stamped_at: date(-i), last_visit_at: date(-i), program_public_id: 'demo-program-main', branch_public_id: branches[i % 2].public_id,
    membership_status: i === 6 ? 'expired' : 'active', membership_effective_status: i === 6 ? 'expired' : 'active', membership_starts_at: date(-20), membership_expires_at: date(i === 6 ? -2 : i === 2 ? 3 : 25), multipass_total_sessions: 10, multipass_sessions_remaining: Math.max(0,9-i*2), vip_points: 100+i*20, vip_tier: { id:'tier-gold',name:'Gold',color:'#b58c46',discount_percent:10,benefits:['Priority pickup'] }, tier_stamp_count:10+i, employee_id_number:`D-${100+i}`, employee_position:'Team member', city:'Fictional City', is_active:true }))
  const staff = [{ public_id:'demo-staff-cashier',name:'Morgan Quinn',role:'cashier',is_active:true,branch_public_id:branches[0].public_id,branch_name:branches[0].name },{ public_id:'demo-staff-manager',name:'Alex Rivera',role:'manager',is_active:true,branch_public_id:branches[1].public_id,branch_name:branches[1].name }]
  const notices = [{ id:501,title:'Updates from LoyaltyTree',message:'Your platform announcements stay visible here. This local preview uses fictional data only.' }]
  let announcements = [{ id:101,title:'A little weekend treat',message:'Drop by for your favorite coffee this weekend.',type:'promo',is_active:true,target_scope:'business',created_at:date(-2),notification_count:1,last_notified_at:date(-2),program_public_id:'',branch_public_id:'' }]
  const subscription = { plan:'pro',plan_label:'Pro',subscription_status:'active',billing_hold:false,subscription_expires_at:date(65),days_left:65,billing_cycle:'3_months',pricing_region:'PH',currency:'PHP',display_currency:'PHP',monthly_price:750,price_per_month:750,pricing:{monthly:750,'3_months':2250,'6_months':4500,annual:7500},branch_count:2,billable_branches:2,last_paid_at:date(-25),features:{gift_cards:true,pos_integration:true,max_programs:3} }
  const plan = () => ({ plan:'pro',plan_label:'Pro',usage:{announcements_limit:10,announcements_used_this_cycle:announcements.length,announcements_used_this_month:announcements.length},features:subscription.features })
  const settings = { birthday_enabled:true,birthday_message:'Happy birthday, {first_name}!',win_back_message:'We miss you at {business_name}.',churn_days:30 }
  const analytics = { overview:{card_type:cardType,total_customers:8,new_customers:2,total_stamps:48,total_rewards:2,active_members:7,customer_growth:12,stamp_growth:8,reward_growth:2},trends:{daily_customers:[1,0,2,1,0,2,1].map((value,i)=>({label:`Day ${i+1}`,value})),daily_stamps:[4,5,8,6,7,12,6].map((value,i)=>({label:`Day ${i+1}`,value})),peak_hours:[{label:'9 AM',value:18},{label:'12 PM',value:12},{label:'4 PM',value:7}]},customers:{retention_rate:68,churn_risk:1,active:7,inactive:1,new:2,returning:6},demographics:{age:{'18_24':3,'25_34':5},gender:{},privacy:{age_available:true,gender_available:false}},stamps:{total:48,average:6,daily_average:6.9,by_staff:[],by_branch:[]},rewards:{total:2,redemption_rate:25,pending:2,top_rewards:[]},revenue:{stamp_revenue:0,reward_cost:0,net_value:0,avg_transaction:0},branches,branch_performance:[],scope:{},time_analytics:{hours:[],weekdays:[]},pos_integrated:false }
  return async function fixtureFetch(input, options = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, 'http://localhost')
    const method = String(options.method || input?.method || 'GET').toUpperCase()
    let body = {}; try { body = JSON.parse(options.body || '{}') } catch { /* Binary writes unsupported. */ }
    const done = (value,status=200) => { onRequest({ts:new Date().toISOString(),method,path:`${url.pathname}${url.search}`,status,simulated:true});return new Response(JSON.stringify(clone(value)),{status,headers:{'Content-Type':'application/json'}}) }
    if(url.hostname==='api.qrserver.com'&&method==='GET'){onRequest({ts:date(),method,path:'/local-placeholder-qr',status:200,simulated:true});return new Response(svg,{headers:{'Content-Type':'image/svg+xml'}})}
    const prefix = `/__owner-fixtures/api/v1/business/${fixtureSlug}`
    if(!url.pathname.startsWith(prefix))return done({detail:'Blocked by local fixture transport. No external request was sent.'},501)
    const path = url.pathname.slice(prefix.length)||'/'
    const config = configs.find(c=>c.public_id===url.searchParams.get('program_id'))||configs[0]
    if(method==='GET'){
      const reads = {
        '/':business,'/programs':{programs:configs,max_programs:3,can_create:true},'/customers':customers,'/staff':staff,'/stats':{total_customers:8,total_stamps:48,total_rewards:2,customers_this_month:2},'/loyalty-config':config,
        '/staff/stamp-counts':staff.map((s,i)=>({staff_public_id:s.public_id,stamp_count:20+i*8})),'/branches':branches,'/subscription':subscription,'/subscription/payments':[{id:1,status:'paid',amount:2250,currency:'PHP',billing_cycle:'3_months',paid_at:date(-25),created_at:date(-25),payment_method:'qrph'}],'/plan':plan(),'/setup-kit':null,'/cashier-devices':[],
        '/platform-announcements':notices,'/announcements':announcements,'/order-ahead/setup':{enabled:true,settings:{pickup_mode:'both',min_prep_minutes:15,slot_interval_minutes:15,max_advance_days:7},branch_pickup_hours:[],payment:{enabled:false}},'/order-ahead/orders':{orders:[],branches,operator_scope:{role:'owner'}},'/order-ahead/menu':{categories:[],items:[],modifier_groups:[],branches},'/order-ahead/payment-config':{enabled:false},
        '/feedback':{summary:{total:12,average_rating:4.8,positive:11},feedback:[]},'/campaigns':{campaigns:[],branches},'/gift-cards':{cards:[]},'/gift-cards/overview':{feature_enabled:true,total_cards:0,active_cards:0,total_balance:0},'/gift-card-batches':{batches:[],print_requests:[]},'/customer-agreement':{program_exists:true,mode:'off',draft_title:'Customer Terms & Conditions',draft_body:'',versions:[]},
        '/wallet-queue':{jobs:[],pending:0,failed:0},'/crm':{customers,total_customers:8,segments:{active:7,at_risk:1}},'/retention-analytics':{retention_rate:68,cohorts:[],at_risk_customers:[]},'/retention-opportunities':{opportunities:[]},'/operations-analytics':{branches:[],cashiers:[],overall:{}},'/transaction-audit':{transactions:[],total:0},'/fraud-alerts':{alerts:[]},'/retention-settings':settings,'/automation-stats':{tracking:'log',birthday:{},win_back:{},recent:[]},'/birthday-celebrants':{as_of:date(),counts:{today:0,this_month:0,next_7_days:0,next_30_days:0,all:0},customers:[]},'/geofence':{feature_enabled:false,enabled:false,pins:[],branches:[],access_message:'Maps disabled in local fixture preview.',limits:{}},'/analytics':analytics,'/analytics/redemptions':{redemptions:[],total:0},
        '/referrals':{copy_code:'DAYLIGHT-DEMO',referral_code:'DAYLIGHT-DEMO',copy_link:'https://example.invalid/signup?ref=DAYLIGHT-DEMO',referrals:[],total_referrals:0,free_months_earned:0},'/pos/status':{connected:false,is_connected:false,provider:'storehub',branch_mappings:[],devices:[]},
      }
      if(Object.hasOwn(reads,path))return done(reads[path])
      if(/^\/customers\/demo-member-\d+$/.test(path))return done(customers.find(c=>c.public_id===path.split('/')[2])||{})
      if(/^\/customers\/demo-member-\d+\/agreements$/.test(path))return done({agreements:[],legacy_signature:null})
      if(/^\/customers\/demo-member-\d+\/(stamp-history|points-history|multipass-history|leaves|membership-benefit-history|vip-history|coupons|redeemables)$/.test(path))return done([])
      if(/^\/customers\/demo-member-\d+\/membership-benefits$/.test(path))return done({benefits:[]})
    }
    if(path==='/onboarding-progress'&&method==='PATCH'){Object.assign(business,body);return done(business)}
    if(/^\/platform-announcements\/\d+\/dismiss$/.test(path)&&method==='POST'){const i=notices.findIndex(n=>n.id===Number(path.split('/')[2]));if(i>=0)notices.splice(i,1);return done({ok:true})}
    if(path==='/announcements'&&method==='POST'){
      const ann={...body,id:102+announcements.length,created_at:date(),notification_count:1,last_notified_at:date(),program_name:configs.find(c=>c.public_id===body.program_public_id)?.program_name,branch_name:branches.find(b=>b.public_id===body.branch_public_id)?.name};announcements.unshift(ann)
      return done({...ann,_push_sent:true,_push_scope:body.target_scope,_push_target_count:8,_push_google_attempted:2,_push_google_sent:2,_push_google_failed:0,_push_google_mode:'classes',_push_apple_sent:3,simulated:true})
    }
    if(/^\/announcements\/\d+\/notify$/.test(path)&&method==='POST')return done({sent:true,google_attempted:2,google_sent:2,google_failed:0,google_missing:0,google_mode:'classes',apple_sent:3,partial:false,scope:'business',target_count:8,simulated:true})
    if(/^\/announcements\/\d+$/.test(path)){const id=Number(path.split('/')[2]);const ann=announcements.find(a=>a.id===id);if(method==='PUT'&&ann){Object.assign(ann,body);return done(ann)}if(method==='DELETE'){announcements=announcements.filter(a=>a.id!==id);return done({ok:true})}}
    if(path==='/loyalty-config'&&['PATCH','PUT','POST'].includes(method)){Object.assign(config,body);return done(config)}
    if(path==='/wallet-class'&&method==='POST')return done({...config,google_wallet_class_id:'local-preview-class',simulated:true})
    if(path==='/retention-settings'&&method==='PUT'){Object.assign(settings,body);return done(settings)}
    if(path==='/help/question-event'&&method==='POST')return done({ok:true,simulated:true})
    if(path==='/subscription/checkout')return done({detail:'Payments are disabled in this local test workspace. No charge was created.'},403)
    if(/^\/customers\/demo-member-\d+$/.test(path)&&['PATCH','PUT'].includes(method)){const customer=customers.find(c=>c.public_id===path.split('/')[2]);Object.assign(customer,body);return done(customer)}
    if(/^\/staff\/demo-staff-/.test(path)&&['PATCH','PUT'].includes(method)){const member=staff.find(s=>s.public_id===path.split('/')[2]);if(member){Object.assign(member,body);return done(member)}}
    return done({detail:`No local fixture for ${method} ${path}. No network request was sent.`},501)
  }
}
