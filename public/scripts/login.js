SiteUi.initPageFadeTransitions({ transitionMs: 400 });

/* ── Helpers ───────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const LOCK_KEY = 'loginLockUntil';
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;
let failedAttempts = 0;

async function sha256(message) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Login form UI ─────────────────────────────────────── */
function showLoginError(msg) {
  const box = $('main-login-error');
  if (box) {
    box.style.display = 'block';
    box.style.animation = 'none';
    void box.offsetWidth;
    box.style.animation = 'shake 0.4s ease';
  }
  const txt = $('main-login-error-msg');
  if (txt) txt.textContent = msg;
  ['badge-main', 'password-main'].forEach(id => {
    const el = $(id);
    if (el) {
      el.style.borderColor = 'var(--red-alert)';
      setTimeout(() => { el.style.borderColor = ''; }, 1400);
    }
  });
}

function hideLoginError() {
  const box = $('main-login-error');
  if (box) box.style.display = 'none';
}

function setLoginLoading(on) {
  const btn = $('loginBtnMain');
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = on ? 'Verifying...' : 'Access Portal';
}

function updateAttemptsDisplay() {
  const el = $('main-attempts');
  if (!el) return;
  if (failedAttempts > 0) {
    const remaining = MAX_ATTEMPTS - failedAttempts;
    el.style.display = 'block';
    el.textContent = `Attempts remaining: ${remaining} / ${MAX_ATTEMPTS}`;
    el.style.color = remaining <= 2 ? 'var(--red-alert)' : 'var(--muted)';
  } else {
    el.style.display = 'none';
  }
}

function showLoginSuccess() {
  const btn = $('loginBtnMain');
  if (btn) {
    btn.textContent = 'Access Granted · Redirecting...';
    btn.style.background = '#27AE60';
    btn.style.color = '#fff';
  }
  setTimeout(() => { window.location.href = 'nexus.html'; }, 1200);
}

/* ── Login ─────────────────────────────────────────────── */
async function handleMainLogin() {
  hideLoginError();

  const lockUntil = parseInt(sessionStorage.getItem(LOCK_KEY) || '0', 10);
  if (Date.now() < lockUntil) {
    const remaining = Math.ceil((lockUntil - Date.now()) / 60000);
    showLoginError(`Account locked. Try again in ${remaining} minute(s).`);
    return;
  }

  const badge = $('badge-main').value.trim();
  const password = $('password-main').value;
  if (!badge || !password) { showLoginError('All fields are required.'); return; }

  setLoginLoading(true);

  try {
    const passwordHash = await sha256(password);
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ badge: badge, password: passwordHash })
    });
    const result = await response.json();

    if (response.ok && result.success) {
      failedAttempts = 0;
      sessionStorage.removeItem(LOCK_KEY);
      sessionStorage.setItem('cib_auth', 'true');
      sessionStorage.setItem('cib_token', result.token);
      sessionStorage.setItem('cib_badge', result.user.badge);
      sessionStorage.setItem('cib_name', result.user.name);
      sessionStorage.setItem('cib_rank', result.user.rank);
      sessionStorage.setItem('cib_division', result.user.division);
      sessionStorage.setItem('cib_classification', result.user.classification || '');
      sessionStorage.setItem('cib_expires', result.expiresAt);

      // Account flagged by admin: show the change-password popup instead of redirecting
      if (result.user.mustChangePassword) {
        setLoginLoading(false);
        openChangePasswordModal(result.token, result.user.badge);
        return;
      }

      showLoginSuccess();
    } else {
      failedAttempts++;
      setLoginLoading(false);
      updateAttemptsDisplay();

      if (failedAttempts >= MAX_ATTEMPTS) {
        sessionStorage.setItem(LOCK_KEY, String(Date.now() + LOCK_MS));
        showLoginError('Too many failed attempts. Try again in 5 minutes.');
        const btn = $('loginBtnMain');
        if (btn) { btn.disabled = true; btn.textContent = 'Locked — Try Later'; }
      } else {
        const remaining = MAX_ATTEMPTS - failedAttempts;
        showLoginError(`${result.error || 'Invalid credentials'}. ${remaining} attempt(s) remaining.`);
      }
    }
  } catch (err) {
    setLoginLoading(false);
    showLoginError('Connection error. Check your network and try again.');
    console.error('Login error:', err);
  }
}

['badge-main', 'password-main'].forEach(id => {
  const el = $(id);
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') handleMainLogin(); });
});

/* ── Helpers for the side panels ───────────────────────── */
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function genSessionRef() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let r = 'SES-';
  for (let i = 0; i < 12; i++) { if (i === 4 || i === 8) r += '-'; r += c[rand(0, c.length - 1)]; }
  return r;
}

function startClock() {
  function tick() {
    const n = new Date(), p = v => String(v).padStart(2, '0');
    const s = `${n.getFullYear()}.${p(n.getMonth() + 1)}.${p(n.getDate())} · ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
    const el = $('surv-time-cell');
    if (el) el.textContent = s;
  }
  tick();
  setInterval(tick, 1000);
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

/* ── Device details the browser already exposes (shown only, not sent anywhere) ── */
function detectBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown browser';
}

function detectOS(ua) {
  if (/Windows NT/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

function fillDeviceInfo() {
  const ua = navigator.userAgent || '';
  setText('info-browser', detectBrowser(ua));
  setText('info-os', detectOS(ua));
  setText('info-screen', `${screen.width} × ${screen.height} @ ${window.devicePixelRatio || 1}x`);
  setText('info-viewport', `${window.innerWidth} × ${window.innerHeight}`);
  setText('info-cores', navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'Not reported');
  setText('info-memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB (approx.)` : 'Not reported');
  setText('info-touch', navigator.maxTouchPoints > 0 ? 'Yes' : 'No');
  const langs = (navigator.languages && navigator.languages.length) ? navigator.languages.join(', ') : navigator.language;
  setText('info-lang', langs || 'Not reported');
  setText('info-tz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Not reported');
  const conn = navigator.connection;
  setText('info-conn', conn && conn.effectiveType ? conn.effectiveType.toUpperCase() : 'Not reported');
  setText('info-ref', document.referrer || 'Direct visit');
}

/* ── IP + approximate location (looked up from the visitor's own IP) ── */
function fetchGeoData() {
  const apis = [
    {
      url: 'https://ipwho.is/',
      parse: d => ({ ok: !!d.success, ip: d.ip, city: d.city, country: d.country, region: d.region,
                     lat: d.latitude, lon: d.longitude,
                     isp: d.connection && (d.connection.isp || d.connection.org) })
    },
    {
      url: 'https://freeipapi.com/api/json',
      parse: d => ({ ok: true, ip: d.ipAddress, city: d.cityName, country: d.countryName,
                     region: d.regionName, lat: d.latitude, lon: d.longitude, isp: null })
    }
  ];

  function render(d) {
    setText('surv-ip', d.ip || 'Unavailable');
    const place = [d.city, d.country].filter(Boolean).join(', ') || 'Unavailable';
    const coords = (d.lat != null && d.lon != null)
      ? ` (${parseFloat(d.lat).toFixed(3)}, ${parseFloat(d.lon).toFixed(3)})` : '';
    setText('surv-location', place + coords);
    setText('surv-region', d.region || 'Unavailable');
    setText('surv-isp', d.isp || 'Unavailable');
  }

  let i = 0;
  function next() {
    if (i >= apis.length) {
      ['surv-ip', 'surv-location', 'surv-region', 'surv-isp'].forEach(id => setText(id, 'Unavailable'));
      return;
    }
    const api = apis[i++];
    fetch(api.url)
      .then(r => r.json())
      .then(raw => {
        const d = api.parse(raw);
        if (d.ok) render(d); else next();
      })
      .catch(next);
  }
  next();
}

/* ── Init ──────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  requestAnimationFrame(() => document.body.classList.add('page-visible'));
  setText('surv-session-ref', genSessionRef());
  startClock();
  fillDeviceInfo();
  fetchGeoData();
});

/* ── Page transitions ──────────────────────────────────── */
document.querySelectorAll('a[href]').forEach(link => {
  link.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || href.startsWith('mailto')) return;
    e.preventDefault();
    document.body.classList.remove('page-visible');
    setTimeout(() => { window.location.href = href; }, 400);
  });
});
