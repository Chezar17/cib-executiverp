/**
 * extract-scripts.mjs
 *
 * Extracts all INLINE <script> blocks (no src= attribute) from HTML
 * files into separate .js files, then replaces the inline blocks with
 * <script src="...js"></script> tags.
 *
 * External <script src="..."> tags are left untouched.
 *
 * Usage: node scripts/extract-scripts.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Map: HTML file → output JS path + script src href ────────────────
const FILES = [
  // Marketing pages
  { html: 'public/index.html',             js: 'public/scripts/index.js',             href: 'scripts/index.js' },
  { html: 'public/Page_About.html',        js: 'public/scripts/about.js',             href: 'scripts/about.js' },
  { html: 'public/Page_Login.html',        js: 'public/scripts/login.js',             href: 'scripts/login.js' },
  { html: 'public/Page_Divisions.html',    js: 'public/scripts/divisions.js',         href: 'scripts/divisions.js' },
  { html: 'public/Page_OurLeaders.html',   js: 'public/scripts/leaders.js',           href: 'scripts/leaders.js' },
  { html: 'public/Page_OurMission.html',   js: 'public/scripts/mission.js',           href: 'scripts/mission.js' },
  { html: 'public/Page_Press.html',        js: 'public/scripts/press.js',             href: 'scripts/press.js' },
  { html: 'public/Page_Recruitment.html',  js: 'public/scripts/recruitment.js',       href: 'scripts/recruitment.js' },
  { html: 'public/Page_Wanted.html',       js: 'public/scripts/wanted.js',            href: 'scripts/wanted.js' },
  // Portal shell pages
  { html: 'public/nexus.html',             js: 'public/scripts/nexus.js',             href: 'scripts/nexus.js' },
  { html: 'public/Page_Nexus.html',        js: 'public/scripts/page-nexus.js',        href: 'scripts/page-nexus.js' },
  // Portal sub-apps (JS lives next to the HTML)
  { html: 'public/targets/hvc.html',                    js: 'public/targets/hvc.js',                    href: 'hvc.js' },
  { html: 'public/budget/finance.html',                 js: 'public/budget/finance.js',                 href: 'finance.js' },
  { html: 'public/gangintel/gang.html',                 js: 'public/gangintel/gang.js',                 href: 'gang.js' },
  { html: 'public/informantregistry/informant.html',    js: 'public/informantregistry/informant.js',    href: 'informant.js' },
]

// Match inline <script> tags only (no src= attribute)
// Captures optional type/defer/async attributes but not src
const INLINE_SCRIPT = /<script(?![^>]*\bsrc\b)([^>]*)>([\s\S]*?)<\/script>/gi

function extractAndReplace(htmlPath, jsPath, scriptHref) {
  const fullHtml = path.join(ROOT, htmlPath)
  const fullJs   = path.join(ROOT, jsPath)

  if (!fs.existsSync(fullHtml)) {
    console.warn(`   ⚠  Not found: ${htmlPath}`)
    return
  }

  let html = fs.readFileSync(fullHtml, 'utf8')

  const jsChunks = []
  let hasNonEmptyInline = false

  html = html.replace(INLINE_SCRIPT, (_, attrs, content) => {
    const trimmed = content.trim()

    // Keep empty blocks or type="module" ESM imports (they may have special semantics)
    // But if they contain actual code, extract
    if (!trimmed) return '' // remove empty script tags

    // Preserve type=importmap or other non-js types
    if (/type\s*=\s*["'](importmap|application\/json)['"]/i.test(attrs)) {
      return `<script${attrs}>${content}</script>`
    }

    hasNonEmptyInline = true
    jsChunks.push(trimmed)
    return '' // remove the inline block; we'll add one <script src> at the end
  })

  if (!hasNonEmptyInline) {
    console.log(`   ○  ${htmlPath} — no inline script content, skipping`)
    return
  }

  // Write JS file
  fs.mkdirSync(path.dirname(fullJs), { recursive: true })
  const jsContent = jsChunks.join('\n\n')
  fs.writeFileSync(fullJs, jsContent, 'utf8')

  // Insert <script src="..."> just before </body>
  const scriptTag = `<script src="${scriptHref}"></script>`
  if (html.includes('</body>')) {
    html = html.replace('</body>', `${scriptTag}\n</body>`)
  } else {
    html += `\n${scriptTag}`
  }

  fs.writeFileSync(fullHtml, html, 'utf8')

  const lines = jsChunks.reduce((n, c) => n + c.split('\n').length, 0)
  console.log(`   ✓  ${htmlPath} → ${jsPath}  (~${lines} lines, ${jsChunks.length} block(s) merged)`)
}

console.log('\n── Extracting inline <script> blocks ──────────────────────────\n')
for (const { html, js, href } of FILES) {
  extractAndReplace(html, js, href)
}
console.log('\n── Done ────────────────────────────────────────────────────────\n')
