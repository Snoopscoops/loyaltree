import { prepareTrialImage } from './trialImage'
import { formatMoney } from './currency'

export function initializeHomepage(root, API_BASE, navigate) {
const apiBase=(API_BASE||'https://api.theloyaltytree.com').replace(/\/$/,'');
// Keep all effects local to this mounted homepage and release them on routing.
const disposers = [];
let active = true;
const on = (target,type,handler,options) => {
  target.addEventListener(type,handler,options);
  disposers.push(() => target.removeEventListener(type,handler,options));
};
const nativeDocument = window.document;
const document = {
  body: root,
  get hidden(){ return nativeDocument.hidden; },
  getElementById: id => root.querySelector(`[id="${id}"]`),
  querySelector: selector => root.querySelector(selector),
  querySelectorAll: selector => root.querySelectorAll(selector),
  createElement: tag => nativeDocument.createElement(tag),
  createTextNode: text => nativeDocument.createTextNode(text),
  addEventListener(type,handler,options){
    if(type === 'DOMContentLoaded') handler();
    else on(nativeDocument,type,handler,options);
  }
};
const addEventListener = (type,handler,options) => on(window,type,handler,options);
const timers = new Set(), intervals = new Set(), frames = new Set();
const setTimeout = (fn,ms) => { const id=window.setTimeout(()=>{timers.delete(id);if(active)fn()},ms);timers.add(id);return id; };
const clearTimeout = id => {window.clearTimeout(id);timers.delete(id)};
const setInterval = (fn,ms) => {const id=window.setInterval(()=>{if(active)fn()},ms);intervals.add(id);return id};
const clearInterval = id => {window.clearInterval(id);intervals.delete(id)};
const requestAnimationFrame = fn => {const id=window.requestAnimationFrame(time=>{frames.delete(id);if(active)fn(time)});frames.add(id);return id};
const scopedWindow = {
  matchMedia(query){const media=window.matchMedia(query);return {
    get matches(){return media.matches},
    addEventListener(type,handler){on(media,type,handler)}
  }}
};
class IntersectionObserver {
  constructor(handler,options){const observer=new window.IntersectionObserver(entries=>{if(active)handler(entries)},options);disposers.push(()=>observer.disconnect());return observer}
}
const fetch = (url,options={}) => {
  const controller=new AbortController();
  const abort=()=>controller.abort();
  if(options.signal){if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true})}
  disposers.push(abort);
  return window.fetch(url,{...options,signal:controller.signal}).finally(()=>{
    const i=disposers.indexOf(abort);if(i>=0)disposers.splice(i,1);
    options.signal?.removeEventListener('abort',abort);
  });
};
const cleanup = () => {
  if(!active)return;active=false;
  // Local upload handlers release their current object URLs.
  onUnmountImages?.();
  disposers.splice(0).reverse().forEach(dispose=>dispose());
  timers.forEach(window.clearTimeout);intervals.forEach(window.clearInterval);frames.forEach(window.cancelAnimationFrame);
  root.querySelectorAll('[data-lt-clone]').forEach(node=>node.remove());
  root.querySelectorAll('button,input,select,form').forEach(node=>{node.onclick=node.onchange=node.onsubmit=null});
  root.querySelectorAll('dialog[open]').forEach(node=>node.close());
  root.classList.remove('motion');
};
let onUnmountImages;


// Display-only pattern: finder squares, deliberately invalid payload and timing.
function paintMockQR(node){node.replaceChildren();const size=25;for(let y=0;y<size;y++){for(let x=0;x<size;x++){let on=((x*19+y*13+x*y)%11)<5;for(const [fx,fy] of [[0,0],[18,0],[0,18]]){if(x>=fx-1&&x<=fx+7&&y>=fy-1&&y<=fy+7){const dx=x-fx,dy=y-fy;on=dx>=0&&dy>=0&&dx<7&&dy<7&&(dx===0||dy===0||dx===6||dy===6||(dx>=2&&dx<=4&&dy>=2&&dy<=4));}}if(y===8||x===8)on=false;const bit=document.createElement('span');if(on)bit.className='on';node.append(bit);}}}
function safeText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeImage(value){return typeof value==='string'&&(/^(?:\/homepage-assets\/|assets\/)[a-zA-Z0-9_.-]+$/.test(value)||/^blob:https?:\/\/[a-zA-Z0-9.:[\]-]+\/[a-f0-9-]+$/i.test(value))?value:''}
function safeColor(value,fallback){return /^#[a-f0-9]{6}$/i.test(value)?value:fallback}
function walletCardMarkup(c,platform){const name=safeText(String(c.name).slice(0,100)),reward=safeText(String(c.reward).slice(0,150)),logo=safeText(safeImage(c.logo)),color=safeColor(c.color,'#073f36'),accent=safeColor(c.accent,'#ab8c56');const cover=safeImage(c.cover);const kind=['stamp','points','membership'].includes(c.kind)?c.kind:'stamp',count=Math.max(0,Math.min(8,Number(c.stamps)||0));const progress=kind==='stamp'?`${count}/8`:kind==='points'?`${Math.max(0,Math.min(999999,Number(c.points)||0))} points`:'Member';const status=kind==='stamp'&&count>=8?'Sample reward unlocked':kind==='points'?'Sample points balance':'Sample loyalty card';const stampHTML=Array.from({length:8},(_,i)=>`<span class="sample-stamp ${i<count?'filled':''}">${i<count?'✓':''}</span>`).join('');const qr='<div class="pass-qr"><div class="mockqr" aria-hidden="true"></div><small>Sample QR</small></div>';
 if(platform==='apple')return `<div class="sample-pass apple-pass" style="--pass-color:${color};--stamp-color:${accent}"><div class="apple-pass-head"><img class="apple-pass-logo" src="${logo}" alt="${name} logo"><div class="apple-pass-title"><small>CARD</small>${name} Rewards</div></div><div class="apple-banner" ${cover?`style="background-image:linear-gradient(#0005,#0005),url('${safeText(cover)}')"`:''}>${kind==='stamp'?`<div class="sample-stamps">${stampHTML}</div>`:'<div style="height:50px;text-align:center">'+(kind==='points'?'POINTS CLUB':'MEMBERSHIP')+'</div>'}</div><div class="apple-pass-metrics"><div><small>${kind==='membership'?'MEMBER BENEFIT':'NEXT REWARD'}</small><strong>${reward}${kind==='stamp'?' · 8 stamps':''}</strong></div><div><small>${kind==='stamp'?'STAMPS':kind==='points'?'POINTS':'STATUS'}</small><strong>${progress}</strong></div></div>${qr}<div class="card-meta" style="color:#fff9;text-align:center;margin-top:7px" aria-live="polite">${status}</div></div>`;
 return `<div class="sample-pass google-pass" style="--pass-color:${color}"><img class="google-pass-logo" src="${logo}" alt="${name} logo"><div class="google-merchant">${name}</div><h3>${name} Rewards</h3>${qr}<div class="sample-progress" aria-live="polite"><small>${kind==='stamp'?'STAMPS':kind==='points'?'POINTS':'STATUS'}</small><strong>${progress}</strong></div><div class="card-meta" style="color:#ffffffa0">${reward} · ${status}</div></div><div class="google-cover" ${cover?`style="background-image:url('${safeText(cover)}')"`:''}>${cover?'':'Business cover preview'}</div>`;
}


function walletStatusMarkup(platform){return `<span>${platform==='apple'?'9:41':'10:42'}</span><span class="status-icons">${platform==='google'?'<small>5G</small>':''}<svg viewBox="0 0 16 12" aria-hidden="true"><rect x="0" y="8" width="2.5" height="4" rx=".5"/><rect x="4" y="6" width="2.5" height="6" rx=".5"/><rect x="8" y="3" width="2.5" height="9" rx=".5"/><rect x="12" y="0" width="2.5" height="12" rx=".5"/></svg><svg viewBox="0 0 16 12" aria-hidden="true"><path d="M1 3Q8-2 15 3M4 6Q8 2.7 12 6M6.5 9Q8 7.8 9.5 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11" r="1"/></svg><svg viewBox="0 0 22 11" aria-hidden="true"><rect x=".5" y=".5" width="18" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width=".8"/><rect x="2" y="2" width="15" height="7" rx="1"/><rect x="19.5" y="3.3" width="1.5" height="4.4" rx=".5"/></svg></span>`;}

// The environment and device remain still; only the paper card follows scroll progress.
document.addEventListener('DOMContentLoaded',()=>{
 const hero=document.querySelector('.hero'),art=document.querySelector('.hero-art'),paper=document.getElementById('paper'),phone=document.getElementById('heroPhone');
 document.getElementById('heroWalletCard').innerHTML=walletCardMarkup({name:'LoyaltyTree',logo:'/homepage-assets/loyaltytree-logo.png',color:'#073f36',accent:'#ab8c56',reward:'A little reward for coming back',kind:'stamp',stamps:3},'apple');
 document.querySelectorAll('#heroWalletCard .mockqr').forEach(paintMockQR);phone.querySelector('.device-status').innerHTML=walletStatusMarkup('apple');phone.setAttribute('aria-label','LoyaltyTree sample card in an iPhone 17-style Apple Wallet preview');
 const reduced=scopedWindow.matchMedia('(prefers-reduced-motion: reduce)');let queued=false;
 function update(){const mobile=innerWidth<=720,start=mobile?art.getBoundingClientRect().top+scrollY-innerHeight*.55:hero.offsetTop,p=reduced.matches?1:Math.max(0,Math.min((scrollY-start)/(mobile?180:300),1)),travel=innerWidth<=1000?55:115;
 paper.style.transform=`translate(${-travel*(1-p)}px,${p*12}px) rotate(${-12*(1-p)}deg) scale(${1-p*.28})`;paper.style.opacity=String(1-Math.pow(p,2));paper.style.zIndex=p>.78?'1':'3';hero.dataset.cardEntered=String(p>=.95);queued=false;}
 addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(update)}},{passive:true});addEventListener('resize',update);reduced.addEventListener('change',update);update();
});

document.addEventListener('DOMContentLoaded',()=>{
 document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{const hash=link.getAttribute('href'),target=hash==='#'?document.querySelector('main'):document.getElementById(hash.slice(1));if(!target)return;event.preventDefault();target.scrollIntoView({behavior:scopedWindow.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});history.replaceState(null,'',hash)}));
});

// Duplicate a single set for a seamless rightward (clockwise) logo loop.
document.addEventListener('DOMContentLoaded',()=>{
 const track=document.getElementById('partnerTrack'),control=document.getElementById('partnerMotion'),region=document.querySelector('.partner-carousel');if(!track)return;
 const cards=[...track.children];for(const card of cards){const clone=card.cloneNode(true);clone.setAttribute('aria-hidden','true');clone.dataset.ltClone='true';clone.querySelector('img').loading='eager';track.append(clone)}
 let paused=false,hovered=false,focused=false,visible=false;const reduced=scopedWindow.matchMedia('(prefers-reduced-motion: reduce)');
 function measure(){track.style.setProperty('--loop-distance',`${track.children[cards.length].offsetLeft-track.children[0].offsetLeft}px`)}
 function sync(){track.style.animationPlayState=paused||hovered||focused||!visible||document.hidden||reduced.matches?'paused':'running';control.setAttribute('aria-label',paused?'Play partner carousel':'Pause partner carousel');control.setAttribute('aria-pressed',String(paused));control.textContent=paused?'▷':'Ⅱ'}
 control.addEventListener('click',()=>{paused=!paused;sync()});region.addEventListener('mouseenter',()=>{hovered=true;sync()});region.addEventListener('mouseleave',()=>{hovered=false;sync()});region.addEventListener('focusin',()=>{focused=true;sync()});region.addEventListener('focusout',event=>{if(!region.contains(event.relatedTarget)){focused=false;sync()}});
 new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync()},{threshold:.01}).observe(region);addEventListener('resize',measure);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',()=>{measure();sync()});requestAnimationFrame(measure);sync();
});

// Scroll scrubs the scan, then carries a gold stamp into the customer phone.
document.addEventListener('DOMContentLoaded',()=>{
 const scene=document.getElementById('rewardScene'),source=document.getElementById('stampSource'),ball=document.getElementById('flyingStamp'),qr=document.getElementById('customerScanQR'),line=qr.querySelector('.reward-scan-line'),connection=scene.querySelector('.scan-connection'),slots=[...document.querySelectorAll('#rewardSlots .stamp')],progress=document.getElementById('rewardProgress'),status=document.getElementById('rewardStatus');const reduced=scopedWindow.matchMedia('(prefers-reduced-motion: reduce)');let queued=false,last=-1;
 function update(){const rect=scene.getBoundingClientRect(),p=reduced.matches?1:Math.max(0,Math.min((innerHeight*.84-rect.top)/(innerHeight*.46),1));const complete=p>=.94;slots.forEach((slot,i)=>{const filled=i<3||i===3&&complete;slot.classList.toggle('earned',filled);slot.textContent=filled?'✓':''});progress.textContent=`${complete?4:3}/8`;scene.dataset.progress=p.toFixed(3);scene.dataset.phase=complete?'stamped':p>.15?'scanning':'ready';
 const phase=complete?2:p>.15?1:0;if(phase!==last){status.textContent=phase===2?'Stamp added. One visit closer.':phase===1?'Scanning the QR on the customer’s phone.':'The customer presents their card.';last=phase}
 line.style.opacity=p>.05&&p<.55?'1':'0';line.style.top=`${Math.min(1,p/.5)*90}%`;connection.classList.toggle('is-scanning',p>.05&&p<.55);source.style.opacity=p<.36?'1':'0';
 const t=Math.max(0,Math.min((p-.35)/.59,1));ball.hidden=t<=0||t>=1;if(!ball.hidden){const from=source.getBoundingClientRect(),to=slots[3].getBoundingClientRect(),x=from.left-rect.left,y=from.top-rect.top,tx=to.left-rect.left+(to.width-22)/2,ty=to.top-rect.top+(to.height-22)/2;ball.style.transform=`translate(${x+(tx-x)*t}px,${y+(ty-y)*t-Math.sin(t*Math.PI)*36}px) scale(${1-.5*t})`}
 queued=false;}
 addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(update)}},{passive:true});addEventListener('resize',update);reduced.addEventListener('change',update);update();
});

// A notification appears over the analytics phone as its scene enters view.
document.addEventListener('DOMContentLoaded',()=>{
 const scene=document.getElementById('connectScene'),notice=document.getElementById('connectNotification');
 const reduced=scopedWindow.matchMedia('(prefers-reduced-motion: reduce)');let queued=false;
 function update(){const p=reduced.matches?1:Math.max(0,Math.min((innerHeight*.82-scene.getBoundingClientRect().top)/(innerHeight*.34),1));const visible=p>=.35;notice.classList.toggle('is-visible',visible);scene.dataset.notificationVisible=String(visible);queued=false}
 addEventListener('scroll',()=>{if(!queued){queued=true;requestAnimationFrame(update)}},{passive:true});addEventListener('resize',update);reduced.addEventListener('change',update);update();
});

document.addEventListener('DOMContentLoaded',()=>{document.getElementById('rewardDeviceStatus').innerHTML=walletStatusMarkup('apple');document.getElementById('connectDeviceStatus').innerHTML=walletStatusMarkup('apple');});

// Cached aggregate totals. Visibility changes and repeated mounts do not
// bypass the five-minute refresh window. No uploads share this API path.
document.addEventListener('DOMContentLoaded',()=>{
 const businesses=document.getElementById('communityBusinesses'),members=document.getElementById('communityMembers'),status=document.getElementById('communityStatus');
 const formatter=new Intl.NumberFormat('en-PH'),ttl=300000,key=`lt-public-totals-v2:${apiBase}`;let loading=false,nextAttempt=0,failures=0;
 function valid(data){return data&&['businesses','members'].every(k=>Number.isSafeInteger(data[k])&&data[k]>=0)}
 function read(){try{const cached=JSON.parse(localStorage.getItem(key));if(valid(cached?.data)&&Number.isFinite(cached.savedAt)&&Date.now()-cached.savedAt>=0&&Date.now()-cached.savedAt<1800000)return cached}catch{}return null}
 function show(data,cached=false){businesses.textContent=formatter.format(data.businesses);members.textContent=formatter.format(data.members);status.textContent=cached?'Latest available platform totals':'Platform totals · refreshed every 5 minutes';status.dataset.state='live';const timestamp=typeof data.updated_at==='string'?data.updated_at:'';const date=new Date(timestamp?(/[Zz]$|[+-]\d{2}:\d{2}$/.test(timestamp)?timestamp:timestamp+'Z'):'');status.title=Number.isNaN(date.getTime())?'':'Updated '+date.toLocaleString('en-PH')}
 async function load(){if(loading||document.hidden)return;const cached=read();if(cached&&Date.now()-cached.savedAt<ttl){show(cached.data,true);return}if(Date.now()<nextAttempt)return;loading=true;nextAttempt=Date.now()+ttl;const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{const response=await fetch(`${apiBase}/api/v1/public/community-stats`,{signal:controller.signal,credentials:'omit'});if(!response.ok){if(response.status===429){const seconds=Number(response.headers.get('Retry-After'));nextAttempt=Date.now()+Math.min(900,Math.max(60,Number.isFinite(seconds)?seconds:300))*1000}throw new Error('Totals unavailable')}const data=await response.json();if(!valid(data))throw new Error('Invalid totals');show(data);failures=0;try{localStorage.setItem(key,JSON.stringify({data:{businesses:data.businesses,members:data.members,updated_at:data.updated_at},savedAt:Date.now()}))}catch{}}
  catch{failures++;nextAttempt=Math.max(nextAttempt,Date.now()+Math.min(ttl,60000*2**Math.min(failures-1,3)));status.textContent=status.dataset.state==='live'?'Showing the latest available totals.':'Totals temporarily unavailable.'}
  finally{clearTimeout(timeout);loading=false}
 }
 const cached=read();if(cached)show(cached.data,true);load();const interval=setInterval(load,60000);document.addEventListener('visibilitychange',load);addEventListener('pagehide',()=>clearInterval(interval),{once:true});
});

const $=id=>document.getElementById(id);let pricingContext={country_code:'PH',country_name:'Philippines',currency:'PHP'},pricingReady=false;let stamps=3,points=30,wallet='google',cycle=3,coverUrl='',logoUrl='';const money=n=>formatMoney(n,pricingContext.currency);let tiers={starter:{1:350,2:700,3:1000,5:1600},growth:{1:550,2:1100,3:1600,5:2600},pro:{1:750,2:1500,3:2100,5:3600}};const names={stamp:'STAMP CARD',points:'POINTS CARD',membership:'MEMBERSHIP CARD'};
document.querySelectorAll('.mockqr').forEach(paintMockQR);
function renderCard(){const type=$('cardType').value,name=$('businessName').value.trim()||'Your business',reward=$('reward').value.trim()||'Your reward';$('demoWalletCard').innerHTML=walletCardMarkup({name,reward,kind:type,stamps,points,color:$('cardColor').value,accent:$('stampColor').value,logo:logoUrl||'/homepage-assets/loyaltytree-logo.png',cover:coverUrl},wallet);$('demoWalletCard').querySelectorAll('.mockqr').forEach(paintMockQR);$('previewPhone').className='phone '+(wallet==='apple'?'iphone iphone17':'android');$('previewPhone').setAttribute('aria-label',wallet==='apple'?'iPhone 17-style Apple Wallet sample':'Android Google Wallet sample');$('previewScreen').querySelector('.device-status').innerHTML=walletStatusMarkup(wallet);$('previewScreen').className='screen '+(wallet==='apple'?'iphone-wallet':'google-screen');$('previewScreen').style.setProperty('--google-color',$('cardColor').value);$('demoToolbar').innerHTML=wallet==='apple'?'<span>Done</span><span>↑　•••</span>':'<span>←</span><span>✓　◷</span>';$('deviceCaption').textContent=wallet==='apple'?'iPhone 17 · Apple Wallet preview':'Android · Google Wallet preview';$('addStamp').textContent=type==='points'?'Add 10 sample points':'Add sample stamp';$('addStamp').hidden=type==='membership';$('addStamp').disabled=type==='stamp'&&stamps>=8;}
['businessName','reward','cardType','cardColor','stampColor'].forEach(id=>$(id).addEventListener('input',renderCard));$('addStamp').onclick=()=>{if($('cardType').value==='points')points=Math.min(points+10,999999);else stamps=Math.min(stamps+1,8);renderCard()};$('resetDemo').onclick=()=>{stamps=3;points=30;renderCard()};document.querySelectorAll('[data-wallet]').forEach(b=>b.onclick=()=>{wallet=b.dataset.wallet;document.querySelectorAll('[data-wallet]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderCard()});
let disposed=false;
function upload(id,kind){const input=$(id);let busy=false;input.addEventListener('change',async()=>{const file=input.files[0];if(!file||busy)return;busy=true;input.disabled=true;$('uploadStatus').textContent='Preparing your image…';try{const url=await prepareTrialImage(file,kind);if(disposed){URL.revokeObjectURL(url);return}if(kind==='logo'){if(logoUrl)URL.revokeObjectURL(logoUrl);logoUrl=url}else{if(coverUrl)URL.revokeObjectURL(coverUrl);coverUrl=url}renderCard();$('uploadStatus').textContent='Preview updated. Your image stays on your device.'}catch(error){if(!disposed)$('uploadStatus').textContent=error.message||'Choose another image.'}finally{busy=false;input.disabled=false;input.value=''}})}upload('logoUpload','logo');upload('coverUpload','cover');
onUnmountImages=()=>{disposed=true;if(logoUrl)URL.revokeObjectURL(logoUrl);if(coverUrl)URL.revokeObjectURL(coverUrl)};addEventListener('pagehide',onUnmountImages);
addEventListener('pageshow',event=>{if(event.persisted){disposed=false;logoUrl=coverUrl='';renderCard()}});
function monthly(plan,branches){const t=tiers[plan];return branches>5?t[5]+(branches-5)*t[1]:t[branches===4?5:branches]}
function renderPricing(){if(!pricingReady){document.querySelectorAll('[data-price]').forEach(node=>node.textContent='Checking…');document.querySelectorAll('[data-equivalent]').forEach(node=>node.textContent='Prices for your market');return}const n=Number($('branches').value);Object.keys(tiers).forEach(plan=>{const base=monthly(plan,n),price=base*cycle;const el=document.querySelector(`[data-price="${plan}"]`);el.replaceChildren(document.createTextNode(money(price)));const unit=document.createElement('span');unit.className='plan-unit';unit.textContent=cycle===10?'per year · 12 months access':cycle===1?'per month':`per ${cycle} months`;el.append(unit);document.querySelector(`[data-equivalent="${plan}"]`).textContent=`${money(base)} monthly rate · ${n} ${n===1?'branch':'branches'}${cycle===10?' · 2 months free':''}`})}
$('branches').onchange=renderPricing;document.querySelectorAll('[data-cycle]').forEach(b=>b.onclick=()=>{cycle=Number(b.dataset.cycle);document.querySelectorAll('[data-cycle]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderPricing()});
let intent='Get started for your business';
function showChoices(){$('inquiryChoices').hidden=false;$('inquiryForm').hidden=true;$('inquiryIntro').textContent='Choose how you’d like to get started.';}
document.querySelectorAll('[data-inquiry]').forEach(b=>b.onclick=()=>{if(b.closest('#pricing')&&!pricingReady)return;intent=b.dataset.inquiry;const match=intent.match(/^(Starter|Growth|Pro) plan/),tier=match?match[1]:'';const n=Number($('branches').value),term=cycle===10?'year':cycle===1?'month':cycle+' months';$('inquiryTitle').textContent=tier?'Get started with '+tier:intent;$('choiceSummary').textContent=tier?`${tier} · ${n} ${n===1?'branch':'branches'} · ${money(monthly(tier.toLowerCase(),n)*cycle)} per ${term}`:'';$('choiceSummary').hidden=!tier;$('registerDescription').textContent=tier?`Create your business account and choose ${tier} during setup.`:'Create your business account and set up your loyalty program.';const url=new URL('/signup',window.location.origin);url.searchParams.set('country',pricingContext.country_code);url.searchParams.set('billing_cycle',cycle===10?'annual':cycle===1?'monthly':cycle+'_months');$('registerNow').href=url.pathname+url.search;showChoices();if(!tier&&intent!=='Get started for your business'){ $('inquiryChoices').hidden=true;$('inquiryForm').hidden=false;$('inquiryIntro').textContent='Tell us about your business. We’ll prepare an email for the LoyaltyTree team.';$('backToChoices').hidden=true;}else{$('backToChoices').hidden=false;}$('contactBusiness').value=$('businessName').value==='Your Café'?'':$('businessName').value;$('emailStatus').textContent='';$('inquiryDialog').showModal()});
$('chooseEmail').onclick=()=>{$('inquiryChoices').hidden=true;$('inquiryForm').hidden=false;$('inquiryIntro').textContent='Tell us about your business. We’ll prepare an email for the LoyaltyTree team.';};$('backToChoices').onclick=showChoices;
$('closeDialog').onclick=()=>$('inquiryDialog').close();$('inquiryDialog').addEventListener('click',e=>{if(e.target===$('inquiryDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
$('inquiryForm').onsubmit=e=>{e.preventDefault();const body=`Hello LoyaltyTree,\n\n${intent}\nName: ${$('contactName').value}\nBusiness: ${$('contactBusiness').value}\nEmail: ${$('contactEmail').value}\nLocation: ${$('contactLocation').value}\n\nCard preview\nBusiness name: ${$('businessName').value}\nCard type: ${$('cardType').value}\nReward / benefit: ${$('reward').value}\nCard colour: ${$('cardColor').value}\nStamp colour: ${$('stampColor').value}\nWallet preview: ${wallet==='apple'?'Apple Wallet':'Google Wallet'}\nBranches: ${$('branches').value}\nBilling period: ${cycle===10?'Annual':cycle+' months'}\n\n${$('contactMessage').value}\n\nPlease advise on setup and next steps.`;window.location.href='mailto:theloyaltytree@gmail.com?subject='+encodeURIComponent('LoyaltyTree — '+intent)+'&body='+encodeURIComponent(body);$('emailStatus').textContent='Email prepared. Send it in your email app, or contact theloyaltytree@gmail.com directly.'};
if(!scopedWindow.matchMedia('(prefers-reduced-motion: reduce)').matches&&'IntersectionObserver' in window){document.body.classList.add('motion');const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}}),{threshold:.1});document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));}renderCard();renderPricing();
// Use the existing server-resolved market, rather than hard-coding PHP.
const priceButtons=[...document.querySelectorAll('#pricing [data-inquiry]')];
priceButtons.forEach(button=>button.disabled=true);
(async()=>{
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
 try {
  const response=await fetch(`${apiBase}/api/v1/public/pricing-context`,{signal:controller.signal,credentials:'omit'});
  if(!response.ok)throw new Error('Pricing unavailable');
  const data=await response.json();
  if(!data||!/^(?:[A-Z]{2}|INT)$/.test(data.country_code)||!/^[A-Z]{3}$/.test(data.currency))throw new Error('Invalid pricing');
  const next={};
  for(const plan of ['starter','growth','pro']){
   const tier=data.plans?.[plan]?.price_tiers;
   if(!tier||![1,2,3,5].every(n=>Number.isFinite(tier[n])&&tier[n]>0))throw new Error('Invalid pricing');
   next[plan]=tier;
  }
  if(!active)return;
  pricingContext=data;tiers=next;pricingReady=true;
  const geoFeature=document.querySelector('[data-uae-pro-geofence]');
  geoFeature.hidden=!(data.country_code==='AE'&&data.plans.pro.geofence_notifications===true);
  geoFeature.style.display=geoFeature.hidden?'none':'';
  const giftFeature=document.querySelector('[data-feature="gift_cards"]');
  giftFeature.hidden=data.plans.growth.gift_cards!==true;
  giftFeature.style.display=giftFeature.hidden?'none':'';
  $('pricingRegionLabel').textContent=data.country_code==='PH'?'Philippines pricing · PHP':'International pricing · USD';
  document.querySelector('[data-cycle="1"]').hidden=data.country_code==='PH';
  $('pricingStatus').textContent=data.country_code==='PH'?'Minimum 3 months. Prices are confirmed during signup.':'Standard USD pricing outside the Philippines. Prices are confirmed during signup.';
  // Physical kit is currently offered in the Philippines only.
  const note=document.querySelector('#pricing .price-note');
  if(note&&data.country_code!=='PH')note.textContent='Standard plans outside the Philippines are billed in USD. Annual billing gives 12 months for the price of 10. Gift cards and physical setup kits are Philippines-only.';
  renderPricing();priceButtons.forEach(button=>button.disabled=false);
 }catch{
  if(!active)return;
  pricingReady=true;
  $('pricingRegionLabel').textContent='Philippines reference pricing · PHP';
  $('pricingStatus').textContent='Your market and final price are confirmed during signup. Contact us for international pricing.';
  renderPricing();priceButtons.forEach(button=>button.disabled=false);
 }finally{clearTimeout(timeout)}
})();

// Keep signup/login/legal navigation in the existing router.
on(root,'click',event=>{
 const link=event.target.closest('a[href]');
 if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||link.target==='_blank')return;
 const href=link.getAttribute('href');
 if(href?.startsWith('/')&&!href.startsWith('//')){event.preventDefault();navigate(href)}
});

return cleanup;
}
