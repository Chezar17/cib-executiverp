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
  const IDLE_MS      = 30 * 60 * 1000
  const GATE_DELAY   = 900

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

  function redirectToLogin (href) {
    sessionStorage.clear()
    var dest = href && String(href).length ? href : LOGIN_HREF
    window.location.assign(dest)
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
      _idleTimer = setTimeout(function () { PortalAuth.logout(loginHref) }, ms)
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
    if (!token) { redirectToLogin(href); return }
    if (isSessionExpired()) { redirectToLogin(href); return }

    await new Promise(function (r) { setTimeout(r, delay) })

    try {
      const res = await fetch('/api/verify-token', {
        method: 'GET',
        headers: { 'x-session-token': token }
      })

      if (!res.ok) { redirectToLogin(href); return }

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
      redirectToLogin(href)
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

  async function logout (loginHref) {
    const token = getToken()
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'x-session-token': token }
      })
    } catch (_) { }
    redirectToLogin(loginHref)
  }

  // ── Public API ─────────────────────────────────────────────

  var PortalAuth = {
    init: function (cfg) {
      cfg = cfg || {}
      window.addEventListener('DOMContentLoaded', function () { verifyAndInit(cfg) })
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
