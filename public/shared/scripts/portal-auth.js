/**
 * portal-auth.js
 *
 * Shared authentication utilities for all CIB NEXUS portal pages.
 * Exposes window.PortalAuth with:
 *
 *   PortalAuth.init(config)   — verify token, show page, start clock + idle timer
 *   PortalAuth.logout()       — invalidate server session + redirect
 *   PortalAuth.showToast(msg, type, containerId) — toast helper
 *
 * Config options for init():
 *   loginHref    {string}   Path to login page (default '/Page_Login.html')
 *   badgeEls     {string[]} IDs of elements that should show the badge (default ['badgeDisplay'])
 *   clockEl      {string}   ID of live-clock element (default 'liveClock')
 *   idleMs       {number}   Idle timeout in ms (default 30 * 60 * 1000)
 *   gateDelay    {number}   Delay before token check in ms (default 900)
 *   onReady      {Function} Called after successful auth (receives badge string)
 */
;(function (global) {
  'use strict'

  const LOGIN_HREF   = '/Page_Login.html'
  const IDLE_MS      = 30 * 60 * 1000   // 30 minutes
  const GATE_DELAY   = 900              // ms before verify-token call

  // ── Internal helpers ────────────────────────────────────────────

  function getToken () {
    return sessionStorage.getItem('cib_token') || ''
  }

  function redirectToLogin (href) {
    sessionStorage.clear()
    window.location.href = href || LOGIN_HREF
  }

  function setTextById (id, value) {
    const el = document.getElementById(id)
    if (el) el.textContent = value
  }

  // ── Live Clock ──────────────────────────────────────────────────

  function startClock (clockElId) {
    const id = clockElId || 'liveClock'
    function tick () {
      const now = new Date()
      const pad = n => String(n).padStart(2, '0')
      const d   = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      setTextById(id, d + ' · ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()))
    }
    tick()
    setInterval(tick, 1000)
  }

  // ── Idle Session Timeout ────────────────────────────────────────

  let _idleTimer = null

  function startIdleTimer (idleMs, loginHref) {
    const ms = idleMs || IDLE_MS
    function reset () {
      clearTimeout(_idleTimer)
      _idleTimer = setTimeout(() => PortalAuth.logout(loginHref), ms)
    }
    ;['mousemove', 'keydown', 'click', 'scroll'].forEach(ev =>
      document.addEventListener(ev, reset, { passive: true })
    )
    reset()
  }

  // ── Auth Gate ───────────────────────────────────────────────────

  async function verifyAndInit (cfg) {
    const token    = getToken()
    const href     = cfg.loginHref || LOGIN_HREF
    const badgeEls = cfg.badgeEls  || ['badgeDisplay']
    const delay    = (cfg.gateDelay !== undefined) ? cfg.gateDelay : GATE_DELAY

    if (!token) { redirectToLogin(href); return }

    await new Promise(r => setTimeout(r, delay))

    try {
      const res = await fetch('/api/verify-token', {
        method: 'GET',
        headers: { 'x-session-token': token }
      })

      if (!res.ok) { redirectToLogin(href); return }

      // Token confirmed valid — reveal page
      const gate = document.getElementById('access-gate')
      if (gate) gate.classList.add('hidden')
      document.body.classList.add('page-visible')

      // Populate badge element(s)
      const badge = sessionStorage.getItem('cib_badge') || ''
      badgeEls.forEach(id => setTextById(id, badge))

      // Start supporting systems
      startClock(cfg.clockEl)
      startIdleTimer(cfg.idleMs, href)

      // Let the page run its own init
      if (typeof cfg.onReady === 'function') cfg.onReady(badge)

    } catch (_) {
      redirectToLogin(href)
    }
  }

  // ── Toast ───────────────────────────────────────────────────────

  function showToast (msg, type, containerId) {
    type        = type        || 'success'
    containerId = containerId || 'inf-toast'
    const c = document.getElementById(containerId)
    if (!c) return
    const t = document.createElement('div')
    t.className = 'inf-toast-item toast-' + type
    t.textContent = msg
    c.appendChild(t)
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')))
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350) }, 2800)
  }

  // ── Logout ──────────────────────────────────────────────────────

  async function logout (loginHref) {
    const token = getToken()
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'x-session-token': token }
      })
    } catch (_) { /* ignore — always clear locally */ }
    redirectToLogin(loginHref)
  }

  // ── Public API ──────────────────────────────────────────────────

  var PortalAuth = {
    /**
     * Verify the session token and initialise the portal page.
     * @param {object} cfg - Configuration (see module header).
     */
    init: function (cfg) {
      cfg = cfg || {}
      window.addEventListener('DOMContentLoaded', () => verifyAndInit(cfg))
    },

    /** Invalidate the server session and redirect to login. */
    logout: logout,

    /** Show a toast notification. */
    showToast: showToast,
  }

  global.PortalAuth = PortalAuth

})(window)
