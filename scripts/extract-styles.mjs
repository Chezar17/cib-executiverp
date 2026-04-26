/**
 * extract-styles.mjs
 *
 * Extracts all <style> blocks from HTML files into separate CSS files,
 * then replaces the inline blocks with <link rel="stylesheet"> tags.
 *
 * Usage: node scripts/extract-styles.mjs
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// ── Map: HTML file → output CSS path + link href ──────────────────────
const FILES = [
  // Marketing pages (CSS lives in public/styles/)
  {
    html: 'public/index.html',
    css:  'public/styles/index.css',
    href: 'styles/index.css',
  },
  {
    html: 'public/Page_About.html',
    css:  'public/styles/about.css',
    href: 'styles/about.css',
  },
  {
    html: 'public/Page_Login.html',
    css:  'public/styles/login.css',
    href: 'styles/login.css',
  },
  {
    html: 'public/Page_Divisions.html',
    css:  'public/styles/divisions.css',
    href: 'styles/divisions.css',
  },
  {
    html: 'public/Page_OurLeaders.html',
    css:  'public/styles/leaders.css',
    href: 'styles/leaders.css',
  },
  {
    html: 'public/Page_OurMission.html',
    css:  'public/styles/mission.css',
    href: 'styles/mission.css',
  },
  {
    html: 'public/Page_Press.html',
    css:  'public/styles/press.css',
    href: 'styles/press.css',
  },
  {
    html: 'public/Page_Recruitment.html',
    css:  'public/styles/recruitment.css',
    href: 'styles/recruitment.css',
  },
  {
    html: 'public/Page_Wanted.html',
    css:  'public/styles/wanted.css',
    href: 'styles/wanted.css',
  },
  // Portal shell pages
  {
    html: 'public/nexus.html',
    css:  'public/styles/nexus.css',
    href: 'styles/nexus.css',
  },
  {
    html: 'public/Page_Nexus.html',
    css:  'public/styles/page-nexus.css',
    href: 'styles/page-nexus.css',
  },
  // Portal sub-apps (CSS lives next to the HTML)
  {
    html: 'public/targets/hvc.html',
    css:  'public/targets/hvc.css',
    href: 'hvc.css',
  },
  {
    html: 'public/budget/finance.html',
    css:  'public/budget/finance.css',
    href: 'finance.css',
  },
  {
    html: 'public/gangintel/gang.html',
    css:  'public/gangintel/gang.css',
    href: 'gang.css',
  },
  {
    html: 'public/informantregistry/informant.html',
    css:  'public/informantregistry/informant.css',
    href: 'informant.css',
  },
]

// ── Regex to match one <style> block (non-greedy) ─────────────────────
const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/gi

function extractAndReplace(htmlPath, cssPath, linkHref) {
  const fullHtml = path.join(ROOT, htmlPath)
  const fullCss  = path.join(ROOT, cssPath)

  if (!fs.existsSync(fullHtml)) {
    console.warn(`⚠  Not found: ${htmlPath}`)
    return
  }

  let html = fs.readFileSync(fullHtml, 'utf8')

  // Collect all <style> block contents
  const cssChunks = []
  html = html.replace(STYLE_BLOCK, (_, content) => {
    const trimmed = content.trim()
    if (trimmed) cssChunks.push(trimmed)
    return '' // remove the <style> block
  })

  if (cssChunks.length === 0) {
    console.log(`   ○  ${htmlPath} — no <style> blocks found, skipping`)
    return
  }

  // Write CSS file
  fs.mkdirSync(path.dirname(fullCss), { recursive: true })
  const cssContent = cssChunks.join('\n\n')
  fs.writeFileSync(fullCss, cssContent, 'utf8')

  // Insert <link> just before </head>
  const linkTag = `<link rel="stylesheet" href="${linkHref}"/>`
  if (html.includes('</head>')) {
    html = html.replace('</head>', `${linkTag}\n</head>`)
  } else {
    // fallback: insert after last existing <link>
    html = html.replace(/(<\/style>\s*)/, `$1\n${linkTag}`)
  }

  fs.writeFileSync(fullHtml, html, 'utf8')
  const lines = cssChunks.reduce((n, c) => n + c.split('\n').length, 0)
  console.log(`   ✓  ${htmlPath} → ${cssPath}  (${lines} lines, ${cssChunks.length} block(s))`)
}

console.log('\n── Extracting <style> blocks ───────────────────────────────────\n')
for (const { html, css, href } of FILES) {
  extractAndReplace(html, css, href)
}
console.log('\n── Done ────────────────────────────────────────────────────────\n')
