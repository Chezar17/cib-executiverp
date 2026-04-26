/**
 * Refactor portal sub-directory pages (gangintel, informantregistry, targets, budget).
 * Injects shared CSS links with ../ prefix and removes duplicate inline CSS.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT    = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PUBLIC  = join(ROOT, 'public')

const SHARED_HEAD_PORTAL = `<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Roboto:wght@300;400;500&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="../shared/styles/tokens.css"/>
<link rel="stylesheet" href="../shared/styles/base.css"/>`

// Removes duplicate CSS from a CSS string
function stripDuplicates(css) {
  const patterns = [
    // CSS reset
    /\*\s*\{\s*margin\s*:\s*0[^}]*\}\s*/g,
    // :root block (with token vars)
    /:root\s*\{[^}]*--gold[^}]*\}\s*/gs,
    // body base
    /body\s*\{\s*background[^}]*(font-family|overflow)[^}]*\}\s*/g,
    // page transition
    /body\s*\{[^}]*opacity\s*:\s*0[^}]*transition[^}]*\}\s*/g,
    /body\.page-visible\s*\{[^}]*\}\s*/g,
    // scrollbar
    /::?-webkit-scrollbar[^\{]*\{[^}]*\}\s*/g,
  ]
  let result = css
  for (const pat of patterns) {
    pat.lastIndex = 0
    result = result.replace(pat, '')
  }
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

function processPortalPage(relPath) {
  const filePath = join(PUBLIC, relPath)
  if (!existsSync(filePath)) { console.warn('SKIP:', relPath); return }

  let html = readFileSync(filePath, 'utf8')
  const titleMatch = html.match(/<title>([^<]*)<\/title>/)
  const title = titleMatch ? titleMatch[1] : 'CIB Portal'

  // Replace head up to <style>
  html = html.replace(
    /<link rel=['"]icon['"][^>]*>\n<link href=['"]https:\/\/fonts[^>]*>\n/,
    ''
  )
  html = html.replace(
    /<meta charset="UTF-8"\/>\n<meta name="viewport"[^>]*>\n<title>[^<]*<\/title>\n<link rel=['"]icon['"][^>]*>\n<link href=['"]https:\/\/fonts[^>]*>\n/,
    SHARED_HEAD_PORTAL + '\n<title>' + title + '</title>\n<link rel="icon" href="../images/cib-logo.png" type="image/png"/>\n'
  )
  // Fallback: replace just old icon + fonts line
  if (html.includes('<link rel="icon" href="images/') || html.includes("<link rel='icon'")) {
    html = html.replace(
      /(<meta charset="UTF-8"\/>)\n(<meta name="viewport"[^>]*>)\n(<title>[^<]*<\/title>)\n(<link rel=['"]icon[^>]*>)\n(<link href=['"]https:\/\/fonts[^>]*>)/,
      `$1\n$2\n$3\n<link rel="icon" href="../images/cib-logo.png" type="image/png"/>\n<link rel="preconnect" href="https://fonts.googleapis.com"/>\n$5\n<link rel="stylesheet" href="../shared/styles/tokens.css"/>\n<link rel="stylesheet" href="../shared/styles/base.css"/>`
    )
  }

  // Clean duplicate CSS from <style> blocks
  const styleStart = html.indexOf('<style>')
  const styleEnd   = html.indexOf('</style>')
  if (styleStart !== -1 && styleEnd !== -1) {
    let css = html.slice(styleStart + 7, styleEnd)
    css = stripDuplicates(css)
    if (!css) {
      html = html.slice(0, styleStart) + html.slice(styleEnd + 8)
    } else {
      html = html.slice(0, styleStart + 7) + '\n' + css + '\n' + html.slice(styleEnd)
    }
  }

  // Add site-ui.js if not present
  if (!html.includes('site-ui.js')) {
    html = html.replace(
      '</body>',
      '<script src="../shared/scripts/site-ui.js"></script>\n' +
      '<script>\n  SiteUi.initPageFadeTransitions({ transitionMs: 400 });\n</script>\n</body>'
    )
  }

  writeFileSync(filePath, html, 'utf8')
  console.log('Processed portal page:', relPath)
}

const PORTAL_PAGES = [
  'gangintel/gang.html',
  'informantregistry/informant.html',
  'targets/hvc.html',
  'budget/finance.html',
]
PORTAL_PAGES.forEach(processPortalPage)
console.log('\nPortal pages done!')
