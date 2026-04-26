/**
 * Directly injects shared CSS links into portal sub-pages.
 * Uses simple string insertion at the <head> tag.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT   = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PUBLIC = join(ROOT, 'public')

const PORTAL_INJECT = `<link rel="stylesheet" href="../shared/styles/tokens.css"/>
<link rel="stylesheet" href="../shared/styles/base.css"/>`

const ROOT_INJECT = `<link rel="stylesheet" href="shared/styles/tokens.css"/>
<link rel="stylesheet" href="shared/styles/base.css"/>`

function injectIfMissing(filePath, inject) {
  if (!existsSync(filePath)) return
  let html = readFileSync(filePath, 'utf8')
  if (html.includes('tokens.css')) { console.log('SKIP (already has tokens.css):', filePath); return }

  // Insert after <head>
  html = html.replace('<head>', '<head>\n' + inject)

  // Strip :root block
  html = html.replace(/:root\s*\{[^}]*--gold[^}]*\}/gs, ':root {}')
  // Remove empty :root {}
  html = html.replace(/:root\s*\{\s*\}/g, '')
  // Strip reset
  html = html.replace(/^\s*\*\s*\{[^}]*margin\s*:\s*0[^}]*\}\s*$/gm, '')
  // Strip body base  
  html = html.replace(/^\s*body\s*\{[^}]*(font-family|overflow)[^}]*\}/gm, '')
  // Strip page-visible
  html = html.replace(/^\s*body\.page-visible\s*\{[^}]*\}\s*$/gm, '')
  // Strip body opacity transition
  html = html.replace(/^\s*body\s*\{\s*[\r\n\s]*opacity\s*:\s*0[^}]*\}\s*$/gm, '')
  
  writeFileSync(filePath, html, 'utf8')
  console.log('Injected:', filePath.replace(ROOT, ''))
}

// Portal pages
const PORTAL = ['gangintel/gang.html','informantregistry/informant.html','targets/hvc.html','budget/finance.html']
PORTAL.forEach(p => injectIfMissing(join(PUBLIC, p), PORTAL_INJECT))

console.log('Done.')
