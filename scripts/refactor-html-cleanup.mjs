/**
 * Second-pass cleanup for HTML pages after initial refactor.
 * Removes residual duplicate CSS fragments and leftover comments.
 * Also processes sub-directory pages and nexus.html.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PUBLIC = join(ROOT, 'public')

// ── Fragments left from partial regex removal ─────────────────
const CLEANUP_PATTERNS = [
  // Leftover ticker @keyframes tail (from partial match)
  /\/\*[^\n]*(PAGE TRANS?ITION|TICKER)[^\n]*\*\/\s*\n\s*to\{transform:translateX\(-50%\)\}\}\s*/g,
  // Orphaned ticker keyframes tails
  /\s*to\{transform:translateX\(-50%\)\}\}\s*\n/g,
  // Leftover empty /* comment */ lines
  /\/\*[^\n]*PAGE TRANS?ITION[^\n]*\*\/\s*\n/g,
  // Leftover page-hero styles (now in sections.css)
  /\/\*[^\n]*PAGE HERO[^\n]*\*\/[\s\S]*?\.page-hero-desc\s*\{[^}]*\}\s*/g,
  // Breadcrumb styles (now in sections.css)
  /\/\*[^\n]*BREADCRUMB[^\n]*\*\/[\s\S]*?\.breadcrumb-current\s*\{[^}]*\}\s*/g,
  // Alert banner (now in sections.css)
  /\/\*[^\n]*ALERT[^\n]*BANNER[^\n]*\*\/[\s\S]*?\.alert-stamp\s*\{[^}]*\}\s*/g,
  // Section shared styles (now in sections.css)
  /\/\*[^\n]*SECTION[^\n]*SHARED[^\n]*\*\/[\s\S]*?\.section-line[^\n]*\n\s*\{[^}]*\}\s*/g,
  // .section + .section-header + .section-eyebrow blocks
  /\.section\s*\{[^}]*padding[^}]*\}\s*\.section-header\s*\{[^}]*\}\s*\.section-eyebrow\s*\{[^}]*\}\s*\.section-title\s*\{[^}]*\}\s*\.section-line\s*\{[^}]*\}\s*/gs,
  // alt-section
  /\.alt-section\s*\{[^}]*background[^}]*\}\s*/g,
  // Orphaned scroll-reveal helpers (now in base.css)
  /\/\*[^\n]*SCROLL REVEAL[^\n]*\*\/[\s\S]*?\.reveal-delay-5\s*\{[^}]*\}\s*/g,
  // Standalone reveal rules
  /\.reveal\s*\{[^}]*opacity\s*:\s*0[^}]*\}\s*\.reveal-left\s*\{[^}]*\}\s*\.reveal-right\s*\{[^}]*\}\s*/gs,
  /\.reveal\.visible[\s\S]*?\.reveal-delay-5\s*\{[^}]*\}\s*/gs,
  // btn-primary / btn-outline (now in base.css)
  /\.btn-primary\s*\{[^}]*\}\s*\.btn-primary:hover\s*\{[^}]*\}\s*\.btn-outline\s*\{[^}]*\}\s*\.btn-outline:hover\s*\{[^}]*\}\s*/gs,
  // scrollbar rules (now in base.css)
  /::?-webkit-scrollbar[^\{]*\{[^}]*\}\s*/g,
]

// ── Shared scripts line ───────────────────────────────────────
const SHARED_SCRIPTS_ROOT  = `<script src="shared/scripts/site-ui.js"></script>\n<script>\n  SiteUi.initPageFadeTransitions({ transitionMs: 400 });\n  SiteUi.initScrollReveal();\n</script>`
const SHARED_SCRIPTS_SUB   = `<script src="../shared/scripts/site-ui.js"></script>\n<script>\n  SiteUi.initPageFadeTransitions({ transitionMs: 400 });\n  SiteUi.initScrollReveal();\n</script>`

// ── Inline page-transition JS to remove ───────────────────────
const INLINE_TRANS_JS = [
  // DOMContentLoaded fade-in block
  /\/\/[^\n]*(PAGE FADE|Fade IN)[^\n]*\n\s*window\.addEventListener\('DOMContentLoaded'[\s\S]*?\}\);\s*/g,
  // triggerReveal function block
  /\/\/[^\n]*(SCROLL REVEAL|triggerReveal)[^\n]*\n\s*function triggerReveal[\s\S]*?\}\s*triggerReveal\(\);\s*/g,
  // Page fade out on navigate block
  /\/\/[^\n]*(PAGE FADE OUT|NAVIGATE)[^\n]*\n\s*document\.querySelectorAll\('a\[href\]'\)[\s\S]*?\}\);\s*/g,
]

function processFile(filePath, prefix = '') {
  if (!existsSync(filePath)) { console.warn('SKIP (not found):', filePath); return }

  let html = readFileSync(filePath, 'utf8')

  // Strip duplicate CSS fragments inside <style>
  let styleStart = html.indexOf('<style>')
  let styleEnd   = html.indexOf('</style>')
  if (styleStart !== -1 && styleEnd !== -1) {
    let css = html.slice(styleStart + 7, styleEnd)
    for (const pat of CLEANUP_PATTERNS) {
      pat.lastIndex = 0
      css = css.replace(pat, '\n')
    }
    css = css.replace(/\n{3,}/g, '\n\n').trim()
    if (!css) {
      html = html.slice(0, styleStart) + html.slice(styleEnd + 8)
    } else {
      html = html.slice(0, styleStart + 7) + '\n' + css + '\n' + html.slice(styleEnd)
    }
  }

  // Strip inline page-transition JS
  for (const pat of INLINE_TRANS_JS) {
    pat.lastIndex = 0
    html = html.replace(pat, '')
  }

  // Ensure site-ui.js is linked (only once)
  const uiScript = prefix === '../' ? SHARED_SCRIPTS_SUB : SHARED_SCRIPTS_ROOT
  if (!html.includes('site-ui.js')) {
    html = html.replace('</body>', uiScript + '\n</body>')
  } else if (!html.includes('SiteUi.initPageFadeTransitions')) {
    // Already has site-ui.js from earlier pass but missing init call
    html = html.replace(/(<script src="[^"]*site-ui\.js[^"]*"><\/script>)/,
      '$1\n<script>\n  SiteUi.initPageFadeTransitions({ transitionMs: 400 });\n  SiteUi.initScrollReveal();\n</script>')
  }

  writeFileSync(filePath, html, 'utf8')
  console.log('Cleaned:', filePath.replace(ROOT, '').replace(/\\/g, '/'))
}

// ── Root-level pages ──────────────────────────────────────────
const ROOT_PAGES = [
  'index.html', 'Page_Login.html', 'Page_About.html',
  'Page_OurMission.html', 'Page_Divisions.html', 'Page_OurLeaders.html',
  'Page_Wanted.html', 'Page_Press.html', 'Page_Recruitment.html',
]
ROOT_PAGES.forEach(p => processFile(join(PUBLIC, p)))

// ── Sub-directory pages (use ../ prefix for paths) ────────────
// These already have their own shared CSS with ../ prefix links,
// so we just clean up duplicate CSS and JS.
const SUB_PAGES = [
  'gangintel/gang.html',
  'informantregistry/informant.html',
  'targets/hvc.html',
  'budget/finance.html',
]
SUB_PAGES.forEach(p => processFile(join(PUBLIC, p), '../'))

console.log('\nCleanup done!')
