/**
 * apply-portal-shell.mjs
 *
 * Removes CSS already covered by portal-shell.css from each
 * portal page's individual CSS file, then adds the
 * portal-shell.css <link> to the HTML files.
 *
 * Run: node scripts/apply-portal-shell.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Portal pages ──────────────────────────────────────────────────────
// css: per-page CSS to de-dupe   html: HTML to get the <link> added
// shellHref: relative path from HTML file to portal-shell.css
const PORTALS = [
  {
    html:      'public/nexus.html',
    css:       'public/styles/nexus.css',
    shellHref: 'shared/styles/portal-shell.css',
  },
  {
    html:      'public/targets/hvc.html',
    css:       'public/targets/hvc.css',
    shellHref: '../shared/styles/portal-shell.css',
  },
  {
    html:      'public/budget/finance.html',
    css:       'public/budget/finance.css',
    shellHref: '../shared/styles/portal-shell.css',
  },
  {
    html:      'public/gangintel/gang.html',
    css:       'public/gangintel/gang.css',
    shellHref: '../shared/styles/portal-shell.css',
  },
  {
    html:      'public/informantregistry/informant.html',
    css:       'public/informantregistry/informant.css',
    shellHref: '../shared/styles/portal-shell.css',
  },
  {
    html:      'public/Page_Nexus.html',
    css:       'public/styles/page-nexus.css',
    shellHref: 'shared/styles/portal-shell.css',
  },
]

// ── Patterns that are now covered by portal-shell.css ─────────────────
// Each entry is a regex that matches a CSS block to remove.
// We use generous boundaries so we don't accidentally cut page-specific rules.
const PATTERNS_TO_REMOVE = [
  // Access gate
  /#access-gate\s*\{[^}]+\}/g,
  /#access-gate\.hidden\s*\{[^}]+\}/g,
  /\.gate-logo\s*\{[^}]+\}/g,
  /\.gate-logo\s+img\s*\{[^}]+\}/g,
  /\.gate-text\s*\{[^}]+\}/g,
  /\.gate-bar\s*\{[^}]+\}/g,
  /\.gate-progress\s*\{[^}]+\}/g,
  /@keyframes\s+gateLoad\s*\{[^}]+\}/g,

  // Topbar
  /\.topbar\s*\{[^}]+\}/g,
  /\.topbar-left\s*\{[^}]+\}/g,
  /\.topbar-logo\s*\{[^}]+\}/g,
  /\.topbar-brand\s*\{[^}]+\}/g,
  /\.topbar-divider\s*\{[^}]+\}/g,
  /\.topbar-sub\s*\{[^}]+\}/g,
  /\.topbar-right\s*\{[^}]+\}/g,
  /\.topbar-badge-display\s*\{[^}]+\}/g,
  /\.topbar-badge-display\s+span\s*\{[^}]+\}/g,
  /\.topbar-clock\s*\{[^}]+\}/g,

  // Back / Logout
  /\.back-btn\s*\{[^}]+\}/g,
  /\.back-btn:hover\s*\{[^}]+\}/g,
  /\.logout-btn\s*\{[^}]+\}/g,
  /\.logout-btn:hover\s*\{[^}]+\}/g,

  // Classification banner
  /\.class-banner\s*\{[^}]+\}/g,
  /\.class-banner-text\s*\{[^}]+\}/g,
  /\.class-dots\s*\{[^}]+\}/g,
  /\.class-dot\s*\{[^}]+\}/g,

  // Ticker
  /\.ticker\s*\{[^}]+\}/g,
  /\.ticker-label\s*\{[^}]+\}/g,
  /\.ticker-track\s*\{[^}]+\}/g,
  /\.ticker-track\s+span\s*\{[^}]+\}/g,
  /\.ticker-track\s+span\s+b\s*\{[^}]+\}/g,
  /@keyframes\s+ticker\s*\{[^}]+\}/g,

  // Shared keyframes
  /@keyframes\s+blink\s*\{[^}]+\}/g,
]

// Clean section-header comments left behind (e.g. "/* ── TOP BAR ── */")
// These are safe to remove only when they were portal-shell headings.
const COMMENT_PATTERNS = [
  /\/\*\s*──?\s*ACCESS\s+GATE\s*──?\s*\*\//gi,
  /\/\*\s*──?\s*TOP\s+BAR\s*──?\s*\*\//gi,
  /\/\*\s*──?\s*CLASSIFICATION\s+BANNER\s*──?\s*\*\//gi,
  /\/\*\s*──?\s*TICKER\s*──?\s*\*\//gi,
  /\/\*\s*──?\s*BACK\s*\/\s*LOGOUT\s*\*\//gi,
]

function dedupeCSS(cssPath) {
  let css = fs.readFileSync(path.join(ROOT, cssPath), 'utf8')
  const before = css.length

  for (const pat of PATTERNS_TO_REMOVE) {
    css = css.replace(pat, '')
  }
  for (const pat of COMMENT_PATTERNS) {
    css = css.replace(pat, '')
  }

  // Collapse 3+ consecutive blank lines → 1
  css = css.replace(/\n{3,}/g, '\n\n').trim()

  fs.writeFileSync(path.join(ROOT, cssPath), css, 'utf8')
  return before - css.length
}

function injectShellLink(htmlPath, shellHref) {
  const fullPath = path.join(ROOT, htmlPath)
  let html = fs.readFileSync(fullPath, 'utf8')

  // Don't add if already linked
  if (html.includes('portal-shell.css')) {
    console.log(`   ○  ${htmlPath} — portal-shell.css already linked`)
    return
  }

  // Insert before the per-page CSS link or before </head>
  const linkTag = `<link rel="stylesheet" href="${shellHref}"/>`
  // Try to insert just before the page-specific CSS <link>
  const pageCssMatch = html.match(/<link[^>]+href="[^"]*(?:hvc|finance|gang|informant|nexus|page-nexus)\.css[^"]*"[^>]*\/?>/)
  if (pageCssMatch) {
    html = html.replace(pageCssMatch[0], `${linkTag}\n${pageCssMatch[0]}`)
  } else if (html.includes('</head>')) {
    html = html.replace('</head>', `${linkTag}\n</head>`)
  }

  fs.writeFileSync(fullPath, html, 'utf8')
}

console.log('\n── Applying portal-shell.css ───────────────────────────────────\n')
for (const { html, css, shellHref } of PORTALS) {
  const removed = dedupeCSS(css)
  injectShellLink(html, shellHref)
  console.log(`   ✓  ${css} — removed ${removed} chars of duplicate CSS`)
}
console.log('\n── Done ────────────────────────────────────────────────────────\n')
