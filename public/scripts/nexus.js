// ── PANEL DATA ──────────────────────────────────────────────
  const PANEL_META = {
    dashboard: {bc:'NEXUS · PORTAL',     title:'Dashboard',          sub:'Command overview · Active session',                              badge:''},
    guidebook: {bc:'NEXUS · DOCUMENTS',  title:'CIB Guidebook',      sub:'Standard operating procedures · Rules of engagement',           badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(201,168,76,0.1);color:var(--gold);border:1px solid rgba(201,168,76,0.3);">INTERNAL</span>'},
    penal:     {bc:'NEXUS · DOCUMENTS',  title:'Penal Codes',        sub:'Criminal statutes · Charge reference · Sentencing guidelines',  badge:''},
    directory: {bc:'NEXUS · DOCUMENTS',  title:'Main Directory',     sub:'Complete case files · Operation archives · Personnel records',  badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(192,57,43,0.1);color:var(--red-alert);border:1px solid rgba(192,57,43,0.3);">TOP SECRET</span>'},
    weapons:   {bc:'NEXUS · INTELLIGENCE',title:'Weapons Tracker',   sub:'Active arms networks · Seizure logs · Supply chain mapping',   badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(192,57,43,0.1);color:var(--red-alert);border:1px solid rgba(192,57,43,0.3);">CIB EYES ONLY</span>'},
    gang:      {bc:'NEXUS · INTELLIGENCE',title:'Gang Intelligence',  sub:'Active gang profiles · Territorial maps · Threat assessments', badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(224,90,40,0.1);color:#E05A28;border:1px solid rgba(224,90,40,0.3);">GRD DATABASE</span>'},
    informant: {bc:'NEXUS · INTELLIGENCE',title:'Informant Registry', sub:'Handler access only · Identities classified · 33 registered', badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(192,57,43,0.1);color:var(--red-alert);border:1px solid rgba(192,57,43,0.3);">HANDLER EYES ONLY</span>'},
    reports:   {bc:'NEXUS · CID OPERATIONS',title:'Investigation Reports', sub:'CID Form 0001 · Formal case documentation · PDF export', badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(79,195,247,0.1);color:#4fc3f7;border:1px solid rgba(79,195,247,0.3);">CID FORM 0001</span>'},
  };

  function showPanel(name, navEl) {
    document.querySelectorAll('.nx-panel').forEach(p => p.classList.remove('panel-active'));
    document.getElementById('panel-' + name).classList.add('panel-active');
    document.querySelectorAll('.nx-nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    const m = PANEL_META[name];
    document.getElementById('panelBreadcrumb').textContent = m.bc;
    document.getElementById('panelTitle').textContent = m.title;
    document.getElementById('panelSub').textContent = m.sub;
    document.getElementById('panelBadge').innerHTML = m.badge;
    document.querySelector('.nx-main').scrollTop = 0;
  }

  function showPanelByName(name) {
    const navEl = [...document.querySelectorAll('.nx-nav-item')].find(el =>
      el.getAttribute('onclick')?.includes("'" + name + "'")
    );
    showPanel(name, navEl);
  }

  // ── Auth + clock + idle timeout (via shared portal-auth.js) ──
  PortalAuth.init({
    loginHref: '/Page_Login.html',
    badgeEls:  [],
    nameEls:   ['dashWelcomeName', 'dashHeroOfficer', 'badgeDisplay', 'sidebarBadge'],
    rankEls:   ['dashSessionRank'],
    divisionEls: ['dashSessionDivision', 'dashDivisionLine'],
    classificationEls: ['dashSessionClearance', 'dashStripClassification'],
    clearanceTitleEls: ['dashClearanceAdjective'],
    clockEl:   'liveClock',
    onReady: function (badge, session) {
      const side = document.getElementById('sidebarSessionLabel')
      if (side && session) {
        var u = PortalAuth.formatClassificationUpper(session.classification)
        var d = session.division || 'CIB'
        side.textContent = u + ' \u00b7 ' + d + ' \u00b7 SECURE'
      }
    }
  });

  function logout() { PortalAuth.logout(); }

  function showToast(msg, type) {
    PortalAuth.showToast(msg, type, 'inf-toast');
  }

  SiteUi.initPageFadeTransitions({ transitionMs: 400, skipInitialFadeIn: true });
  SiteUi.initScrollReveal();
// ═══════════════════════════════════════════════════════════
//  GIU — SPECIAL ACCESS PROGRAM
//  Hidden mechanism: only users with is_giu=true can activate
//  Triggered by clicking the NEXUS brand text in the topbar
// ═══════════════════════════════════════════════════════════

;(function () {

  // DEFCON labels per level
  const DEFCON_LABELS = {
    1: 'MAXIMUM ALERT · ALL UNITS MOBILIZED',
    2: 'SEVERE · HEIGHTENED READINESS',
    3: 'HIGH · INCREASED SURVEILLANCE',
    4: 'ELEVATED · PRECAUTIONARY POSTURE',
    5: 'NORMAL OPERATIONS',
  }

  let _giuActive    = false
  let _giuCallsign  = null
  let _giuIsUnlocked = false
  let _giuClockTimer = null
  let _currentDefcon = 5

  // ── Check GIU eligibility after PortalAuth loads ──────────
  // We hook into verify-token response via sessionStorage.
  // PortalAuth already called /api/verify-token; we need to
  // re-read it once, then store is_giu in sessionStorage.
  // We call it once on load — no new API file needed.

  async function initGIU() {
    const token = sessionStorage.getItem('cib_token')
    if (!token) return

    try {
      const res  = await fetch('/api/verify-token', {
        headers: { 'x-session-token': token }
      })
      if (!res.ok) return
      const data = await res.json()

      if (!data.is_giu) return  // not a GIU member — stop here, no UI hint

      // User is GIU — store callsign and unlock the trigger
      _giuCallsign   = data.callsign || '—'
      _giuIsUnlocked = true
      sessionStorage.setItem('cib_is_giu',    'true')
      sessionStorage.setItem('cib_callsign',  _giuCallsign)

      // Activate the hidden trigger on the NEXUS brand text
      const trigger = document.getElementById('nexusBrandTrigger')
      if (trigger) {
        trigger.classList.add('giu-unlocked')
        trigger.title = ''  // no tooltip — stays hidden
        trigger.addEventListener('click', enterGIU)
      }

    } catch (e) {
      // Silently fail — don't expose GIU existence to non-members
    }
  }

  // ── Enter GIU SAP mode ────────────────────────────────────
  function enterGIU() {
    if (!_giuIsUnlocked || _giuActive) return
    _giuActive = true

    const overlay = document.getElementById('giu-overlay')
    const flash   = document.getElementById('giu-flash')
    if (!overlay) return

    // 1. Flash to black
    flash.classList.add('flashing')

    setTimeout(() => {
      // 2. Populate dynamic fields
      populateGIU()

      // 3. Show overlay (still behind flash)
      overlay.removeAttribute('aria-hidden')
      overlay.classList.add('giu-visible')

      // 4. Fade flash out
      flash.classList.remove('flashing')

    }, 200)

    // 5. Start GIU clock
    startGIUClock()
  }

  // ── Exit GIU SAP mode ─────────────────────────────────────
  window.exitGIU = function () {
    if (!_giuActive) return

    const overlay = document.getElementById('giu-overlay')
    const flash   = document.getElementById('giu-flash')
    if (!overlay) return

    flash.classList.add('flashing')

    setTimeout(() => {
      overlay.classList.remove('giu-visible')
      overlay.setAttribute('aria-hidden', 'true')
      _giuActive = false
      flash.classList.remove('flashing')
    }, 200)

    if (_giuClockTimer) { clearInterval(_giuClockTimer); _giuClockTimer = null }
  }

  // ── Populate callsign + status values ────────────────────
  function populateGIU() {
    const cs = _giuCallsign || '—'

    // Welcome line callsign
    const giuCs = document.getElementById('giu-callsign')
    if (giuCs) {
      giuCs.textContent = ''
      // Typewriter effect for callsign
      let i = 0
      const chars = cs.toUpperCase().split('')
      const timer = setInterval(() => {
        if (i < chars.length) { giuCs.textContent += chars[i++] }
        else clearInterval(timer)
      }, 60)
    }

    // Status panel callsign
    const sc = document.getElementById('giu-status-callsign')
    if (sc) sc.textContent = cs.toUpperCase()

    // Set DEFCON to stored value (default 5)
    setDefcon(_currentDefcon, false)
  }

  // ── DEFCON selector ───────────────────────────────────────
  function setDefcon(level, animate) {
    _currentDefcon = level

    document.querySelectorAll('.giu-defcon-level').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.level) === level)
    })

    const cur  = document.getElementById('giu-defcon-current')
    const desc = document.getElementById('giu-defcon-desc')
    if (cur)  cur.textContent  = level
    if (desc) desc.textContent = DEFCON_LABELS[level] || ''

    // Update defcon color on current number
    const colors = { 1:'#c0392b', 2:'#e74c3c', 3:'#e67e22', 4:'#f39c12', 5:'#27ae60' }
    if (cur) cur.style.color = colors[level] || '#fff'
  }

  // Make DEFCON levels clickable
  document.addEventListener('click', function (e) {
    const level = e.target.closest('.giu-defcon-level')
    if (level && _giuActive) {
      setDefcon(parseInt(level.dataset.level), true)
    }
  })

  // ── GIU Clock ─────────────────────────────────────────────
  function startGIUClock() {
    function tick() {
      const el = document.getElementById('giu-clock')
      if (!el) return
      const now = new Date()
      el.textContent = now.toLocaleTimeString('en-US', {
        hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit'
      })
    }
    tick()
    _giuClockTimer = setInterval(tick, 1000)
  }

  // ── Init on DOM ready ─────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGIU)
  } else {
    // PortalAuth may not have run yet — wait a beat
    setTimeout(initGIU, 800)
  }

})()
