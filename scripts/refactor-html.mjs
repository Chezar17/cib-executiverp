/**
 * Automated HTML refactor script.
 *
 * For each public page it:
 *  1. Replaces the old <head> boilerplate with shared CSS links
 *  2. Strips duplicate CSS rules already in shared files
 *  3. Replaces inline footer HTML with <div data-shared-footer></div>
 *  4. Replaces inline page-transition JS with SiteUi helper calls
 *  5. Adds shared component script tags if missing
 */

import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const PUBLIC = new URL('../public', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

// ── Shared <head> replacement ─────────────────────────────────
function sharedHead(title, extraCss = []) {
  const extra = extraCss.map(href => `<link rel="stylesheet" href="${href}"/>`).join('\n')
  return `<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title}</title>
<link rel="icon" href="images/cib-logo.png" type="image/png"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Roboto:wght@300;400;500&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="shared/styles/tokens.css"/>
<link rel="stylesheet" href="shared/styles/base.css"/>
<link rel="stylesheet" href="shared/styles/sections.css"/>
<link rel="stylesheet" href="shared/styles/footer.css"/>
<link rel="stylesheet" href="shared/styles/site-header.css"/>
${extra}`.trim()
}

// ── CSS blocks to strip from inline <style> ───────────────────
// Matches duplicated rule groups that are now in shared CSS files.
const DUPLICATE_CSS = [
  // Reset
  /\*\s*\{\s*margin\s*:\s*0[^}]*\}\s*/g,
  // :root token block
  /:root\s*\{[^}]*--gold[^}]*\}\s*/gs,
  // body base (has font-family or overflow-x)
  /body\s*\{[^}]*(font-family|overflow-x)[^}]*\}\s*/g,
  // page-transition on body (opacity: 0 transition)
  /body\s*\{\s*opacity\s*:\s*0[^}]*\}\s*body\.page-visible\s*\{[^}]*\}\s*/gs,
  // nav block
  /\/\*[^\n]*NAV[^\n]*\*\/[\s\S]*?\.nav-badge\{[^}]*\}\s*/g,
  // ticker block
  /\/\*[^\n]*TICKER[^\n]*\*\/[\s\S]*?@keyframes ticker\{[^}]*\}\s*/g,
  // footer styles block
  /\/\*[^\n]*FOOTER[^\n]*\*\/[\s\S]*?\.classified-stamp\{[^}]*\}\s*/g,
  // standalone footer rule (without comment header)
  /footer\s*\{[^}]*border-top[^}]*\}\s*/g,
  /\.footer-top\s*\{[^}]*\}\s*/g,
  /\.footer-brand [^\s{]+\s*\{[^}]*\}\s*/g,
  /\.footer-col [^\s{]+\s*\{[^}]*\}\s*/g,
  /\.footer-bottom\s*\{[^}]*\}\s*/g,
  /\.footer-bottom p\s*\{[^}]*\}\s*/g,
  /\.classified-stamp\s*\{[^}]*\}\s*/g,
  // scroll-reveal helpers (now in base.css)
  /\/\*[^\n]*SCROLL REVEAL[^\n]*\*\/[\s\S]*?\.reveal-delay-5\{[^}]*\}\s*/g,
  // breadcrumb (now in sections.css)
  /\/\*[^\n]*BREADCRUMB[^\n]*\*\/[\s\S]*?\.breadcrumb-current\{[^}]*\}\s*/g,
  // section eyebrow / title / line (now in sections.css)
  /\.section-eyebrow\s*\{[^}]*\}\s*\.section-title\s*\{[^}]*\}\s*\.section-line[^\s{]*\s*\{[^}]*\}\s*/gs,
]

// ── JS blocks to strip ────────────────────────────────────────
const DUPLICATE_JS = [
  // page-transition JS block (DOMContentLoaded + querySelectorAll fade)
  /\/\/[^\n]*PAGE TRANSITIONS?[^\n]*\n[\s\S]*?}\);\s*/g,
  // scroll reveal function + addEventListener
  /\/\/[^\n]*(SCROLL REVEAL|FADE)[^\n]*\n[\s\S]*?}\);\s*/g,
]

// ── Footer HTML pattern ───────────────────────────────────────
const FOOTER_HTML = /<footer>[\s\S]*?<\/footer>/g
const FOOTER_REPLACEMENT = `<div data-shared-footer></div>
<script type="module" src="shared/components/site-footer.js"></script>`

// ── Shared script tags to inject before </body> ───────────────
const SHARED_SCRIPTS = `<script src="shared/scripts/site-ui.js"></script>
<script>
  SiteUi.initPageFadeTransitions({ transitionMs: 400 });
</script>`

// ── Head old pattern ──────────────────────────────────────────
const OLD_HEAD = /<link rel=['"]icon['"][^>]*>\s*<meta charset[^>]*>\s*<meta name=['"]viewport['"][^>]*>\s*<title>([^<]*)<\/title>\s*<link href=['"]https:\/\/fonts\.googleapis[^>]*>\s*(?:<link[^>]*site-header\.css[^>]*>\s*)?(?:<script[^>]*site-header\.js[^>]*><\/script>\s*)?/gi

// ── Process one file ──────────────────────────────────────────
function processFile(filePath, options = {}) {
  let html = readFileSync(filePath, 'utf8')
  const titleMatch = html.match(/<title>([^<]*)<\/title>/)
  const title = options.title || (titleMatch && titleMatch[1]) || 'CIB Portal'

  // 1. Replace <head> boilerplate
  html = html.replace(OLD_HEAD, () => sharedHead(title, options.extraCss || []) + '\n')

  // 2. Strip duplicate CSS from <style> blocks
  let styleOpen = html.indexOf('<style>')
  let styleClose = html.indexOf('</style>')
  if (styleOpen !== -1 && styleClose !== -1) {
    let styleContent = html.slice(styleOpen + 7, styleClose)
    for (const pattern of DUPLICATE_CSS) {
      styleContent = styleContent.replace(pattern, '')
    }
    // Trim empty style block
    const trimmed = styleContent.trim()
    if (!trimmed) {
      html = html.slice(0, styleOpen) + html.slice(styleClose + 8)
    } else {
      html = html.slice(0, styleOpen + 7) + '\n' + trimmed + '\n' + html.slice(styleClose)
    }
  }

  // 3. Replace footer HTML
  if (FOOTER_HTML.test(html)) {
    FOOTER_HTML.lastIndex = 0
    html = html.replace(FOOTER_HTML, FOOTER_REPLACEMENT)
  }

  // 4. Strip duplicate page-transition JS
  for (const pattern of DUPLICATE_JS) {
    html = html.replace(pattern, '')
  }

  // 5. Ensure site-ui.js + SiteUi.init is present (only if not already)
  if (!html.includes('SiteUi.initPageFadeTransitions') && !html.includes('page-visible') ) {
    html = html.replace('</body>', SHARED_SCRIPTS + '\n</body>')
  } else if (!html.includes('site-ui.js')) {
    html = html.replace('<script>', SHARED_SCRIPTS + '\n<script>')
  }

  writeFileSync(filePath, html, 'utf8')
  console.log('Processed:', filePath.replace(PUBLIC, '').replace(/\\/g, '/'))
}

// ── Run on all public pages ───────────────────────────────────
const pages = [
  'index.html',
  'Page_Login.html',
  'Page_About.html',
  'Page_OurMission.html',
  'Page_Divisions.html',
  'Page_OurLeaders.html',
  'Page_Wanted.html',
  'Page_Press.html',
  'Page_Recruitment.html',
]

pages.forEach(page => {
  try {
    processFile(join(PUBLIC, page))
  } catch (e) {
    console.error('Error on', page, ':', e.message)
  }
})

console.log('\nDone!')
