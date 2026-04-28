SiteUi.initPageFadeTransitions({ transitionMs: 400 });

let sealClicks = 0;
  let sealTimer  = null;

  function handleSealClick() {
    sealClicks++;
    clearTimeout(sealTimer);

    if (sealClicks >= 3) {
      sealClicks = 0;
      openSecretModal();
      return;
    }

    sealTimer = setTimeout(() => { sealClicks = 0; }, 4000);
  }

  function openSecretModal() {
    document.getElementById('secret-modal').classList.add('open');
    setTimeout(()=>document.getElementById('s-badge').focus(), 80);
  }

  function closeSecretModal() {
    const modal = document.getElementById('secret-modal');
    modal.classList.remove('open');
    document.getElementById('s-badge').value = '';
    document.getElementById('s-password').value = '';
    document.getElementById('s-loginError').style.display = 'none';
    document.getElementById('s-loginBtn').textContent = 'Access Portal';
    document.getElementById('s-loginBtn').disabled = false;
    document.getElementById('s-loginBtn').style.background = '';
    document.getElementById('s-loginBtn').style.color = '';
    document.getElementById('s-success-overlay').style.display = 'none';
  }

  document.getElementById('secret-modal').addEventListener('click', function(e) {
    if (e.target === this) closeSecretModal();
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSecretModal();
    if (e.key === 'Enter' && document.getElementById('secret-modal').classList.contains('open')) {
      handleSecretLogin();
    }
  });

  /* â”€â”€ Button ripple effect â”€â”€ */
  document.getElementById('s-loginBtn').addEventListener('click', function(e) {
    const ripple = document.createElement('span');
    ripple.classList.add('login-btn-ripple');
    const rect = this.getBoundingClientRect();
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top  = (e.clientY - rect.top)  + 'px';
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });

/* â”€â”€ SECRET LOGIN â€” 5 attempt lockout â”€â”€ */
  let secretFailedAttempts = 0;
  const SECRET_MAX_ATTEMPTS = 5;
  const SECRET_LOCKOUT_MS   = 5 * 60 * 1000;

  async function sha256(message) {
    const msgBuffer  = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
  }

  function sShowError(msg) {
    const box = document.getElementById('s-loginError');
    const txt = document.getElementById('s-loginErrorMsg');
    if (box) { box.style.display = 'block'; box.style.animation = 'none'; void box.offsetWidth; box.style.animation = 'shake 0.4s ease'; }
    if (txt) txt.textContent = msg;
    ['s-badge','s-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.style.borderColor = 'var(--red-alert)';
        setTimeout(() => el.style.borderColor = '', 1400);
      }
    });
    // shake the modal box
    const box2 = document.querySelector('.secret-modal-box');
    if (box2) { box2.style.animation='none'; void box2.offsetWidth; box2.style.animation='shake 0.4s ease'; }
  }

  function sHideError() {
    const box = document.getElementById('s-loginError');
    if (box) box.style.display = 'none';
  }

  function sSetLoading(on) {
    const btn = document.getElementById('s-loginBtn');
    if (!btn) return;
    btn.disabled    = on;
    btn.textContent = on ? 'Verifying...' : 'Access Portal';
  }

  function updateAttemptsDisplay() {
    const el = document.getElementById('s-attempts-display');
    if (!el) return;
    if (secretFailedAttempts > 0) {
      const remaining = SECRET_MAX_ATTEMPTS - secretFailedAttempts;
      el.style.display = 'block';
      el.textContent = `Attempts remaining: ${remaining} / ${SECRET_MAX_ATTEMPTS}`;
      el.style.color = remaining <= 2 ? 'var(--red-alert)' : 'var(--muted)';
    } else {
      el.style.display = 'none';
    }
  }

  async function handleSecretLogin() {
    sHideError();

    // Check lockout
    const lockUntil = parseInt(sessionStorage.getItem('secretLockUntil') || '0');
    if (Date.now() < lockUntil) {
      const remaining = Math.ceil((lockUntil - Date.now()) / 60000);
      sShowError(`Account locked. Try again in ${remaining} minute(s).`);
      return;
    }

    const badge    = document.getElementById('s-badge')?.value.trim();
    const password = document.getElementById('s-password')?.value;

    if (!badge || !password) { sShowError('All fields are required.'); return; }

    sSetLoading(true);

    try {
      const passwordHash = await sha256(password);

      const response = await fetch('/api/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ badge: badge, password: passwordHash })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        secretFailedAttempts = 0;
        sessionStorage.removeItem('secretLockUntil');

        // ── PASSWORD CHANGE REQUIRED CHECK ───────────────────
        // If the server flags must_change_password, intercept login
        // and show the change-password modal before granting access.
        if (result.user.must_change_password) {
          sSetLoading(false);
          // Store badge temporarily so the change-pw call knows who is changing
          _pendingChangePwBadge       = result.user.badge;
          _pendingChangePwToken       = result.token;         // temp token to auth the change call
          _pendingChangePwExpires     = result.expiresAt;
          _pendingChangePwUser        = result.user;
          closeSecretModal();
          openChangePwModal();
          return;
        }

        // Normal successful login — store session
        sessionStorage.setItem('cib_auth',           'true');
        sessionStorage.setItem('cib_token',          result.token);
        sessionStorage.setItem('cib_badge',          result.user.badge);
        sessionStorage.setItem('cib_name',           result.user.name);
        sessionStorage.setItem('cib_rank',           result.user.rank);
        sessionStorage.setItem('cib_division',       result.user.division);
        sessionStorage.setItem('cib_classification', result.user.classification || '');
        sessionStorage.setItem('cib_expires',        result.expiresAt);

        showSecretSuccess();

      } else {
        secretFailedAttempts++;
        sSetLoading(false);
        updateAttemptsDisplay();

        if (secretFailedAttempts >= SECRET_MAX_ATTEMPTS) {
          sessionStorage.setItem('secretLockUntil', String(Date.now() + SECRET_LOCKOUT_MS));
          sShowError('Too many failed attempts. Try again in 5 minutes.');
          const btn = document.getElementById('s-loginBtn');
          if (btn) { btn.disabled = true; btn.textContent = 'Locked â€” Try Later'; }
        } else {
          const remaining = SECRET_MAX_ATTEMPTS - secretFailedAttempts;
          sShowError(`${result.error || 'Invalid credentials'}. ${remaining} attempt(s) remaining.`);
        }
      }

    } catch (err) {
      sSetLoading(false);
      sShowError('Connection error. Check your network and try again.');
      console.error('Secret login error:', err);
    }
  }

  function showSecretSuccess() {
    const overlay = document.getElementById('s-success-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    // Trigger redirect bar fill
    setTimeout(() => {
      const bar = document.getElementById('s-redirect-bar');
      if (bar) bar.style.width = '100%';
    }, 50);
    setTimeout(() => { window.location.href = 'nexus.html'; }, 1400);
  }

/* ── CHANGE PASSWORD MODAL ─────────────────────────────────────
   Shown when the server returns must_change_password = true.
   Calls the unified /api/login?action=change-password endpoint.
───────────────────────────────────────────────────────────────── */
let _pendingChangePwBadge   = null
let _pendingChangePwToken   = null
let _pendingChangePwExpires = null
let _pendingChangePwUser    = null

function openChangePwModal() {
  const modal = document.getElementById('changepw-modal')
  if (modal) modal.classList.add('open')
  // Reset form state
  ;['cpw-current','cpw-new','cpw-confirm'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.value = ''
  })
  cpwHideAlert()
  const strengthBar   = document.getElementById('cpw-strength-bar')
  const strengthLabel = document.getElementById('cpw-strength-label')
  if (strengthBar)   strengthBar.style.width = '0%'
  if (strengthLabel) strengthLabel.textContent = ''
  setTimeout(() => {
    const cur = document.getElementById('cpw-current')
    if (cur) cur.focus()
  }, 80)
}

function cpwHideAlert() {
  const el = document.getElementById('cpw-alert')
  if (el) el.style.display = 'none'
}

function cpwShowAlert(msg) {
  const box = document.getElementById('cpw-alert')
  const txt = document.getElementById('cpw-alert-msg')
  if (box) box.style.display = 'block'
  if (txt) txt.textContent   = msg
}

/* Password strength meter */
function cpwCheckStrength() {
  const pw  = document.getElementById('cpw-new')?.value || ''
  const bar = document.getElementById('cpw-strength-bar')
  const lbl = document.getElementById('cpw-strength-label')
  if (!bar || !lbl) return

  let score = 0
  if (pw.length >= 8)                    score++
  if (pw.length >= 12)                   score++
  if (/[A-Z]/.test(pw))                  score++
  if (/[0-9]/.test(pw))                  score++
  if (/[^A-Za-z0-9]/.test(pw))           score++

  const levels = [
    { w:'0%',    c:'transparent',    t:'' },
    { w:'25%',   c:'var(--red-alert)', t:'WEAK' },
    { w:'50%',   c:'#E05A28',        t:'FAIR' },
    { w:'75%',   c:'var(--gold)',     t:'GOOD' },
    { w:'100%',  c:'#27AE60',        t:'STRONG' },
  ]
  const lvl = levels[Math.min(score, 4)]
  bar.style.width      = lvl.w
  bar.style.background = lvl.c
  lbl.textContent      = lvl.t
  lbl.style.color      = lvl.c
}

async function submitPasswordChange() {
  cpwHideAlert()

  const currentPw = document.getElementById('cpw-current')?.value || ''
  const newPw     = document.getElementById('cpw-new')?.value     || ''
  const confirmPw = document.getElementById('cpw-confirm')?.value || ''

  if (!currentPw || !newPw || !confirmPw) {
    cpwShowAlert('All fields are required.')
    return
  }
  if (newPw !== confirmPw) {
    cpwShowAlert('New passwords do not match.')
    return
  }
  if (newPw.length < 8) {
    cpwShowAlert('New password must be at least 8 characters.')
    return
  }
  if (newPw === currentPw) {
    cpwShowAlert('New password must be different from your current password.')
    return
  }

  const btn = document.getElementById('cpw-submit-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...' }

  try {
    // Hash both passwords with SHA-256 before sending
    const currentHash = await sha256(currentPw)
    const newHash     = await sha256(newPw)

    // ── Call the UNIFIED endpoint with ?action=change-password ──
    const response = await fetch('/api/login?action=change-password', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-session-token': _pendingChangePwToken || '',  // temp token from login
      },
      body: JSON.stringify({
        badge:        _pendingChangePwBadge,
        current_hash: currentHash,
        new_hash:     newHash,
      })
    })

    const result = await response.json()

    if (response.ok && result.success) {
      // Show success state, then re-prompt login
      const formStep    = document.getElementById('cpw-form-step')
      const successStep = document.getElementById('cpw-success-step')
      if (formStep)    formStep.style.display    = 'none'
      if (successStep) successStep.style.display = 'block'

      // Trigger redirect bar
      setTimeout(() => {
        const bar = document.getElementById('cpw-redirect-bar')
        if (bar) bar.style.width = '100%'
      }, 50)

      // Clear pending state
      _pendingChangePwBadge = _pendingChangePwToken = null

      // Re-open login modal after 1.8s so user logs in fresh
      setTimeout(() => {
        const modal = document.getElementById('changepw-modal')
        if (modal) modal.classList.remove('open')
        // Reset success step for next time
        if (formStep)    formStep.style.display    = 'block'
        if (successStep) successStep.style.display = 'none'
        openSecretModal()
      }, 1800)

    } else {
      cpwShowAlert(result.error || 'Failed to change password. Please try again.')
      if (btn) { btn.disabled = false; btn.textContent = 'Save New Password' }
    }

  } catch (err) {
    cpwShowAlert('Connection error. Check your network and try again.')
    console.error('Change password error:', err)
    if (btn) { btn.disabled = false; btn.textContent = 'Save New Password' }
  }
}

/* â”€â”€ helpers â”€â”€ */
function rand(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

/* â”€â”€ Session ref â”€â”€ */
function genSessionRef(){
  const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r='SES-';
  for(let i=0;i<12;i++){if(i===4||i===8)r+='-';r+=c[rand(0,c.length-1)];}
  return r;
}

/* â”€â”€ Live clock (topbar + timestamp cell) â”€â”€ */
function startClock(){
  function tick(){
    const n=new Date(),p=v=>String(v).padStart(2,'0');
    const s=`${n.getFullYear()}.${p(n.getMonth()+1)}.${p(n.getDate())} Â· ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())} HRS`;
    const t1=document.getElementById('surv-time');
    const t2=document.getElementById('surv-time-cell');
    if(t1)t1.textContent=s;
    if(t2)t2.textContent=s;
  }
  tick();setInterval(tick,1000);
}

/* â”€â”€ CHANNEL ENCRYPTION animated fill â”€â”€ */
async function animateEncryption(){
  const lbl=document.getElementById('surv-threat-label');
  const bars=['tb1','tb2','tb3','tb4','tb5','tb6','tb7','tb8','tb9','tb10'];
  const phases=[
    {text:'INITIALIZING...',  color:'#3498DB', count:0,  delay:400},
    {text:'HANDSHAKING...',   color:'#3498DB', count:3,  delay:350},
    {text:'ENCRYPTING...',    color:'#1ABC9C', count:6,  delay:350},
    {text:'VERIFYING...',     color:'#1ABC9C', count:8,  delay:400},
    {text:'SECURED',          color:'#27AE60', count:10, delay:0},
  ];
  for(const phase of phases){
    if(lbl){lbl.textContent=phase.text;lbl.style.color=phase.color;}
    for(let i=0;i<bars.length;i++){
      const el=document.getElementById(bars[i]);
      if(!el)continue;
      if(i<phase.count){
        el.classList.add('active');
        if(phase.count===10) el.classList.add('secured');
        else if(phase.count>=6) el.classList.add('teal');
      } else {
        el.classList.remove('active','teal','secured');
      }
    }
    if(phase.delay>0) await sleep(phase.delay);
  }
  if(lbl){lbl.classList.add('secured');}
}

/* â”€â”€ PACKET STREAM log â”€â”€ */
const PKT_LINES=[
  'SYN > 192.168.0.1:443','ACK received','TLS 1.3 handshake OK',
  'Fingerprint hash: 0xA4F2...','Sending visitor token','Extracting canvas data',
  'UA string captured','WebGL vendor read','CPU cores: '+navigator.hardwareConcurrency,
  'Timezone: '+Intl.DateTimeFormat().resolvedOptions().timeZone,
  'Lang: '+navigator.language,'Screen: '+screen.width+'Ã—'+screen.height,
  'Cookie policy scan','Storage probe OK','Beacon sent to CIB-INTEL',
  'Plugin enum complete','Font fingerprint logged','Net RTT measured',
];
let pktIdx=0;
async function runPacketStream(){
  const log=document.getElementById('packet-log');
  if(!log)return;
  while(pktIdx<PKT_LINES.length){
    const div=document.createElement('div');
    div.textContent='['+new Date().toLocaleTimeString('en-GB',{hour12:false})+'] '+PKT_LINES[pktIdx];
    log.appendChild(div);
    // keep only last 6 lines visible
    while(log.children.length>6)log.removeChild(log.firstChild);
    pktIdx++;
    await sleep(rand(180,420));
  }
  // loop short random lines after
  const extras=['Heartbeat OK','Polling CIB server...','Token refreshed','Data persisted'];
  let ei=0;
  setInterval(()=>{
    const div=document.createElement('div');
    div.textContent='['+new Date().toLocaleTimeString('en-GB',{hour12:false})+'] '+extras[ei%extras.length];
    log.appendChild(div);
    while(log.children.length>6)log.removeChild(log.firstChild);
    ei++;
  },2200);
}

/* â”€â”€ PER-ITEM FAKE DOWNLOADS â”€â”€ */
const DL_ITEMS=[
  {label:'Hardware Data',    subs:['CPU model detected','GPU vendor read','RAM size probed']},
  {label:'Browser Profile',  subs:['UA string captured','Plugin list extracted','Locale logged']},
  {label:'Keystroke Pattern',subs:['Timing buffer started','Biometric hash built','Pattern archived']},
  {label:'Session Metadata', subs:['Cookie IDs scanned','Storage fingerprinted','Session token sent']},
];

async function runDownloads(){
  // Assign random target KB for each item
  const targets=DL_ITEMS.map(()=>rand(120,980));

  const overallBar=document.getElementById('surv-overall-bar');
  const overallPct=document.getElementById('surv-overall-pct');
  const overallLbl=document.getElementById('surv-overall-label');
  let completedCount=0;

  for(let i=0;i<DL_ITEMS.length;i++){
    const totalKB=targets[i];
    const sizeEl=document.getElementById('dl-size-'+i);
    const statusEl=document.getElementById('dl-status-'+i);
    const barEl=document.getElementById('dl-bar-'+i);
    const subEl=document.getElementById('dl-sub-'+i);

    // Show total, mark LOADING
    if(sizeEl) sizeEl.textContent=`0 KB / ${totalKB} KB`;
    if(statusEl){statusEl.textContent='LOADING';statusEl.classList.remove('done');}
    if(barEl){barEl.classList.add('active');}

    // Animate fill
    const steps=rand(18,28);
    const stepDelay=rand(60,110);
    for(let s=1;s<=steps;s++){
      await sleep(stepDelay);
      const pct=Math.min(100,Math.round((s/steps)*100));
      const kb=Math.round((pct/100)*totalKB);
      if(barEl) barEl.style.width=pct+'%';
      if(sizeEl) sizeEl.textContent=`${kb} KB / ${totalKB} KB`;
      // Show sub-label at 50%
      if(s===Math.floor(steps/2) && subEl){
        subEl.textContent=DL_ITEMS[i].subs[rand(0,DL_ITEMS[i].subs.length-1)];
      }
    }

    // Mark DONE
    if(barEl){barEl.style.width='100%';barEl.classList.remove('active');barEl.classList.add('done');}
    if(statusEl){statusEl.textContent='DONE';statusEl.classList.add('done');}
    if(sizeEl) sizeEl.textContent=`${totalKB} KB / ${totalKB} KB`;
    if(subEl) subEl.textContent=DL_ITEMS[i].subs[DL_ITEMS[i].subs.length-1]+' âœ“';

    completedCount++;
    const overall=Math.round((completedCount/DL_ITEMS.length)*100);
    if(overallBar) overallBar.style.width=overall+'%';
    if(overallPct) overallPct.textContent=overall+'%';

    if(completedCount===DL_ITEMS.length){
      if(overallBar) overallBar.classList.add('done');
      if(overallLbl) overallLbl.textContent='DATA ACQUISITION COMPLETE';
      if(overallPct) overallPct.style.color='#27AE60';
    }

    // Small gap before next item
    await sleep(rand(200,500));
  }
}

/* â”€â”€ GEO DATA via JSONP + fallback fetch â”€â”€ */
function fetchGeoData(){
  function setIp(ip){
    const el=document.getElementById('surv-ip');
    if(!el)return;
    el.innerHTML=`<strong style="color:#F0EDE4;font-size:13px;letter-spacing:2px;">${ip}</strong>`
      +`<span class="surv-tag">LIVE</span>`
      +`<span class="surv-tag" style="background:rgba(192,57,43,0.25);border-color:rgba(192,57,43,0.6);">LOGGED</span>`;
  }
  function setField(id,html){
    const el=document.getElementById(id);if(!el)return;
    el.classList.remove('loading');el.innerHTML=html;
  }
  function bold(v){return`<strong style="color:#F0EDE4;">${v||'â€”'}</strong>`;}
  function render(d){
    if(d.query)setIp(d.query);
    const city=d.city||'â€”',country=d.country||'â€”';
    const lat=d.lat!=null?parseFloat(d.lat).toFixed(4):'â€”';
    const lon=d.lon!=null?parseFloat(d.lon).toFixed(4):'â€”';
    setField('surv-location',`${bold(city+', '+country)}&nbsp;<span style="color:var(--muted);font-size:9px;">[${lat}, ${lon}]</span>`);
    setField('surv-region',`${bold(d.regionName)}<span style="color:var(--muted);"> Â· ${country}</span>`);
    setField('surv-isp',bold(d.isp||d.org||d.as));
  }

  let done=false;
  const cb='_cibGeo'+Date.now();
  const timer=setTimeout(()=>{if(!done){done=true;fallback();}},7000);

  window[cb]=function(d){
    clearTimeout(timer);if(done)return;done=true;
    delete window[cb];
    const s=document.getElementById('_geoScript');if(s)s.remove();
    if(d&&d.status==='success')render(d);else fallback();
  };

  const script=document.createElement('script');
  script.id='_geoScript';
  script.src=`http://ip-api.com/json/?fields=status,query,country,regionName,city,lat,lon,isp,org,as&callback=${cb}`;
  script.onerror=()=>{clearTimeout(timer);if(!done){done=true;delete window[cb];fallback();}};
  document.head.appendChild(script);

  function fallback(){
    const apis=[
      {url:'https://ipwho.is/',parse:d=>({status:d.success?'success':'fail',query:d.ip,city:d.city,country:d.country,regionName:d.region,lat:d.latitude,lon:d.longitude,isp:d.connection&&d.connection.isp,org:d.connection&&d.connection.org})},
      {url:'https://freeipapi.com/api/json',parse:d=>({status:'success',query:d.ipAddress,city:d.cityName,country:d.countryName,regionName:d.regionName,lat:d.latitude,lon:d.longitude,isp:null})}
    ];
    let t=0;
    function next(){
      if(t>=apis.length){
        setField('surv-location','<span style="color:#8A95AA;">Unavailable</span>');
        setField('surv-region','<span style="color:#8A95AA;">Unavailable</span>');
        setField('surv-isp','<span style="color:#8A95AA;">Unavailable</span>');
        return;
      }
      const api=apis[t++];
      fetch(api.url).then(r=>r.json()).then(raw=>{const d=api.parse(raw);if(d.status==='success')render(d);else next();}).catch(next);
    }
    next();
  }
}

/* â”€â”€ CHECKBOX gate â”€â”€ */
function survCheckChange(){
  const cb=document.getElementById('surv-check');
  const btn=document.getElementById('surv-btn');
  if(!cb||!btn)return;
  if(cb.checked){btn.disabled=false;btn.classList.add('enabled');}
  else{btn.disabled=true;btn.classList.remove('enabled');}
}

/* â”€â”€ DISMISS overlay â”€â”€ */
function survDismiss(){
  const o=document.getElementById('surv-overlay');if(!o)return;
  o.style.opacity='0';o.style.transition='opacity 0.5s ease';
  setTimeout(()=>{o.classList.add('surv-dismissed');o.style.opacity='';o.style.transition='';},500);
}

/* â”€â”€ INIT â”€â”€ */
window.addEventListener('DOMContentLoaded',()=>{
  requestAnimationFrame(()=>document.body.classList.add('page-visible'));

  const refEl=document.getElementById('surv-session-ref');
  if(refEl)refEl.textContent='SESSION: '+genSessionRef();

  startClock();

  // Stagger the animations so they feel sequential
  animateEncryption();               // starts immediately
  setTimeout(runPacketStream, 600);  // packet log shortly after
  setTimeout(runDownloads, 800);     // downloads start a bit later
  setTimeout(fetchGeoData, 1000);    // geo last

  // Block Escape closing the popup
  document.addEventListener('keydown',e=>{if(e.key==='Escape')e.preventDefault();});
});

/* â”€â”€ PAGE TRANSITIONS â”€â”€ */
document.querySelectorAll('a[href]').forEach(link=>{
  link.addEventListener('click',function(e){
    const href=this.getAttribute('href');
    if(!href||href.startsWith('http')||href.startsWith('#')||href.startsWith('mailto'))return;
    e.preventDefault();
    document.body.classList.remove('page-visible');
    setTimeout(()=>{window.location.href=href;},400);
  });
});