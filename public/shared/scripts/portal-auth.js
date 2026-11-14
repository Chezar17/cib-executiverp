/**
 * portal-auth.js
 *
 * Session keys (sessionStorage, set by /api/login via login page):
 *   cib_auth, cib_token, cib_badge, cib_name, cib_rank, cib_division,
 *   cib_classification, cib_expires
 *
 *   PortalAuth.init(config)   — verify token, show page, start clock + idle timer
 *   PortalAuth.logout()       — invalidate server session + redirect
 *   PortalAuth.showToast(msg, type, containerId) — toast helper
 *   PortalAuth.getSession()   — read structured session from sessionStorage
 *   PortalAuth.formatClassificationTitle(s)  — e.g. "Secret", "Top Secret"
 *   PortalAuth.formatClassificationUpper(s)   — e.g. "SECRET", "TOP SECRET"
 *
 * Config for init (optional lists of element IDs to fill from session):
 *   loginHref, badgeEls, nameEls, rankEls, divisionEls,
 *   classificationEls, clearanceEls
 *   (clearanceEls and classificationEls both receive formatted UPPER label)
 *   clockEl, idleMs, gateDelay, onReady
 */
;(function (global) {
  'use strict'

  /** Default redirect target — root-relative so it works from /portal/… and subfolders. */
  const LOGIN_HREF   = '/Page_Login.html'
  const IDLE_MS      = 2 * 60 * 60 * 1000  // 2 h of no activity → logout (server session also slides to 2 h)
  const PING_MS      = 5 * 60 * 1000       // while active, refresh the server session at most every 5 min
  const GATE_DELAY   = 900

  // ── Keep the login when a new tab is opened ──────────────────
  // sessionStorage is per tab, so the session is also mirrored to localStorage
  // and copied back into a tab that has no session yet.
  const PERSIST_KEY  = 'cib_persist'
  const SESSION_KEYS = ['cib_auth', 'cib_token', 'cib_badge', 'cib_name', 'cib_rank', 'cib_division', 'cib_classification', 'cib_expires']

  function persistSessionLocally () {
    try {
      const data = {}
      SESSION_KEYS.forEach(function (k) { const v = sessionStorage.getItem(k); if (v !== null) data[k] = v })
      localStorage.setItem(PERSIST_KEY, JSON.stringify(data))
    } catch (e) {}
  }

  function clearPersistedSession () {
    try { localStorage.removeItem(PERSIST_KEY) } catch (e) {}
  }

  function restorePersistedSession () {
    try {
      if (sessionStorage.getItem('cib_token')) return
      const raw = localStorage.getItem(PERSIST_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      const expires = parseInt(data.cib_expires, 10)
      if (!data.cib_token || isNaN(expires) || Date.now() > expires) { clearPersistedSession(); return }
      SESSION_KEYS.forEach(function (k) { if (data[k] !== undefined) sessionStorage.setItem(k, data[k]) })
    } catch (e) {}
  }

  restorePersistedSession()
  global.CIBSession = { persist: persistSessionLocally, clear: clearPersistedSession }

  // ── Session keys ─────────────────────────────────────────────

  function getToken () {
    return sessionStorage.getItem('cib_token') || ''
  }

  function readSessionFromStorage () {
    const ex = sessionStorage.getItem('cib_expires')
    let expires = null
    if (ex != null && ex !== '') {
      const n = parseInt(ex, 10)
      if (!isNaN(n)) expires = n
    }
    return {
      auth:            sessionStorage.getItem('cib_auth') === 'true',
      token:           getToken(),
      badge:           sessionStorage.getItem('cib_badge') || '',
      name:            sessionStorage.getItem('cib_name') || '',
      rank:            sessionStorage.getItem('cib_rank') || '',
      division:        sessionStorage.getItem('cib_division') || '',
      classification:  sessionStorage.getItem('cib_classification') || '',
      expires:         expires
    }
  }

  function isSessionExpired () {
    const s = readSessionFromStorage()
    if (s.expires == null) return false
    return Date.now() > s.expires
  }

  function normalizeClass (s) {
    if (s == null || s === '') return ''
    return String(s).toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  }

  function formatClassificationTitle (raw) {
    const n = normalizeClass(raw)
    const map = {
      'unclassified': 'Unclassified',
      'confidential': 'Confidential',
      'cui': 'CUI',
      'secret': 'Secret',
      'top secret': 'Top Secret',
      'ts': 'Top Secret',
      'topsecret': 'Top Secret',
    }
    if (map[n]) return map[n]
    if (!n) return 'Confidential'
    return String(raw)
      .trim()
      .split(/[\s_]+/)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() })
      .join(' ')
  }

  function formatClassificationUpper (raw) {
    return formatClassificationTitle(raw).toUpperCase()
  }

  /** Current page (path + query) so login can send the user straight back. */
  function currentPlace () {
    var p = window.location.pathname + window.location.search
    if (!p || p === '/' || /Page_Login/i.test(p)) return ''
    return p
  }

  function redirectToLogin (href, keepPlace) {
    sessionStorage.clear()
    clearPersistedSession()
    var dest = href && String(href).length ? href : LOGIN_HREF
    var place = keepPlace ? currentPlace() : ''
    if (place) dest += (dest.indexOf('?') === -1 ? '?' : '&') + 'next=' + encodeURIComponent(place)
    window.location.assign(dest)
  }

  /** Save a new expiry time that the server sent back. */
  function storeExpiry (ms) {
    var n = parseInt(ms, 10)
    if (!n || isNaN(n)) return
    sessionStorage.setItem('cib_expires', String(n))
    persistSessionLocally()
  }

  // ── Keep the server session alive while the user is active ──
  let _lastPing = Date.now()
  function keepAlive () {
    if (Date.now() - _lastPing < PING_MS) return
    _lastPing = Date.now()
    const token = getToken()
    if (!token) return
    fetch('/api/verify-token', { method: 'GET', headers: { 'x-session-token': token } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) { if (j && j.expiresAt) storeExpiry(j.expiresAt) })
      .catch(function () {})
  }

  function setTextById (id, value) {
    const el = document.getElementById(id)
    if (el) el.textContent = value
  }

  function fillEls (ids, value) {
    if (ids == null) return
    const list = Array.isArray(ids) ? ids : [ids]
    const v = value == null ? '' : String(value)
    list.forEach(function (id) { setTextById(id, v) })
  }

  function applySessionToDom (cfg) {
    const s = readSessionFromStorage()
    const clsU = formatClassificationUpper(s.classification)
    const clsT = formatClassificationTitle(s.classification)

    fillEls(cfg.badgeEls, s.badge)
    fillEls(cfg.nameEls, s.name)
    fillEls(cfg.rankEls, s.rank)
    fillEls(cfg.divisionEls, s.division)
    fillEls(cfg.classificationEls, clsU)
    fillEls(cfg.clearanceEls, clsU)
    if (cfg.clearanceTitleEls) fillEls(cfg.clearanceTitleEls, clsT)
  }

  // ── Live Clock ──────────────────────────────────────────────

  function startClock (clockElId) {
    const id = clockElId || 'liveClock'
    function tick () {
      const now = new Date()
      const pad = function (n) { return String(n).padStart(2, '0') }
      const d   = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      setTextById(id, d + ' · ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()))
    }
    tick()
    setInterval(tick, 1000)
  }

  // ── Idle Session Timeout ────────────────────────────────────

  let _idleTimer = null

  function startIdleTimer (idleMs, loginHref) {
    const ms = idleMs || IDLE_MS
    function reset () {
      clearTimeout(_idleTimer)
      _idleTimer = setTimeout(function () { PortalAuth.logout(loginHref, true) }, ms)
      keepAlive()
    }
    ;['mousemove', 'keydown', 'click', 'scroll'].forEach(function (ev) {
      document.addEventListener(ev, reset, { passive: true })
    })
    reset()
  }

  // ── Auth Gate ───────────────────────────────────────────────

  async function verifyAndInit (cfg) {
    const href     = cfg.loginHref || LOGIN_HREF
    const badgeEls = cfg.badgeEls  || ['badgeDisplay']
    const delay    = (cfg.gateDelay !== undefined) ? cfg.gateDelay : GATE_DELAY

    const token = getToken()
    if (!token) { redirectToLogin(href, true); return }
    if (isSessionExpired()) { redirectToLogin(href, true); return }

    await new Promise(function (r) { setTimeout(r, delay) })

    try {
      const res = await fetch('/api/verify-token', {
        method: 'GET',
        headers: { 'x-session-token': token }
      })

      if (!res.ok) { redirectToLogin(href, true); return }
      try { const vj = await res.clone().json(); if (vj && vj.expiresAt) storeExpiry(vj.expiresAt) } catch (_) {}
      _lastPing = Date.now()

      const gate = document.getElementById('access-gate')
      if (gate) gate.classList.add('hidden')
      document.body.classList.add('page-visible')

      const merged = Object.assign({}, cfg, { badgeEls: badgeEls })
      applySessionToDom(merged)

      startClock(cfg.clockEl)
      startIdleTimer(cfg.idleMs, href)

      const s = readSessionFromStorage()
      if (typeof cfg.onReady === 'function') cfg.onReady(s.badge, s)
    } catch (_) {
      redirectToLogin(href, true)
    }
  }

  // ── Toast ───────────────────────────────────────────────────

  function showToast (msg, type, containerId) {
    type        = type        || 'success'
    containerId = containerId || 'inf-toast'
    const c = document.getElementById(containerId)
    if (!c) return
    const t = document.createElement('div')
    t.className = 'inf-toast-item toast-' + type
    t.textContent = msg
    c.appendChild(t)
    requestAnimationFrame(function () { requestAnimationFrame(function () { t.classList.add('show') }) })
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove() }, 350) }, 2800)
  }

  // ── Logout ──────────────────────────────────────────────────

  /** keepPlace = true → after logging in again, come back to this page (used by the idle timeout). */
  async function logout (loginHref, keepPlace) {
    const token = getToken()
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'x-session-token': token }
      })
    } catch (_) { }
    redirectToLogin(loginHref, keepPlace === true)
  }

  // ── Public API ─────────────────────────────────────────────

  var PortalAuth = {
    init: function (cfg) {
      cfg = cfg || {}
      // Normally init() is called once, synchronously, while the document is
      // still parsing — so waiting for DOMContentLoaded is correct. But a
      // page may legitimately need to call init() a second time later on
      // (e.g. right after an in-page login gate obtains a fresh token,
      // well after the page has finished loading). DOMContentLoaded only
      // ever fires once, so a listener added after that point would never
      // run — check readyState and, if the document is already loaded,
      // verify immediately instead of waiting on an event that already happened.
      if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', function () { verifyAndInit(cfg) })
      } else {
        verifyAndInit(cfg)
      }
    },
    logout: logout,
    showToast: showToast,
    getSession: readSessionFromStorage,
    formatClassificationTitle: formatClassificationTitle,
    formatClassificationUpper: formatClassificationUpper,
    /**
     * Manually re-apply session fields to the DOM (same keys as init).
     */
    applySession: applySessionToDom
  }

  global.PortalAuth = PortalAuth
})(window)
