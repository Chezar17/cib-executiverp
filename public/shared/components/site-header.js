import { LOGIN_ROUTE, PRIMARY_NAV_ROUTES, TICKER_ITEMS } from '../routes/site-routes.js'

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') return 'index.html'
  const clean = pathname.split('?')[0].split('#')[0]
  const parts = clean.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : 'index.html'
}

function buildNavHtml(currentPage) {
  const navLinks = PRIMARY_NAV_ROUTES
    .map((route) => {
      const active = route.href === currentPage ? ' class="active"' : ''
      return `<li><a href="${route.href}"${active}>${route.label}</a></li>`
    })
    .join('')

  return `
<nav>
  <a href="index.html" class="nav-logo">
    <img src="images/cib-logo.png" alt="CIB" onerror="this.style.display='none'"/>
    <span class="nav-brand">Central Investigation Bureau</span>
  </a>
  <ul class="nav-links">${navLinks}</ul>
  <a href="${LOGIN_ROUTE.href}" class="nav-badge">${LOGIN_ROUTE.label}</a>
</nav>`
}

function buildTickerHtml() {
  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS]
    .map((item) => `<span>${item}</span>`)
    .join('')

  return `
<div class="ticker">
  <div class="ticker-label">LIVE ALERT</div>
  <div style="overflow:hidden;flex:1;">
    <div class="ticker-track">${doubled}</div>
  </div>
</div>`
}

function mountSharedHeader() {
  const mountPoint = document.querySelector('[data-shared-site-header]')
  if (!mountPoint) return

  const currentPage = normalizePathname(window.location.pathname)
  mountPoint.innerHTML = `${buildNavHtml(currentPage)}${buildTickerHtml()}`
}

mountSharedHeader()
