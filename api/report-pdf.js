// ============================================================
//  CIB – PDF Export API
//  GET /api/report-pdf?id=<uuid>   → generate PDF for a saved report
//  GET /api/report-pdf?id=demo     → generate PDF with built-in demo data
//
//  Vercel: uses @sparticuz/chromium (no system Chrome in serverless).
//  Local:  uses Chrome/Edge from disk, or CHROME_PATH.
// ============================================================
import { existsSync } from 'fs'
import path from 'path'
import { launch, defaultArgs } from 'puppeteer-core'
import { requireSession } from './_lib/session.js'
import { getSupabase } from './_lib/supabase.js'
import { buildPDFDocument, DEMO_REPORT } from './_lib/pdf-html.js'

const IS_VERCEL = process.env.VERCEL === '1'

function findLocalChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH
  }
  const localApp = process.env.LOCALAPPDATA || ''
  const candidates = [
    path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ]
  return candidates.find(p => existsSync(p)) || null
}

async function launchBrowser() {
  if (IS_VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default
    return launch({
      args: defaultArgs({ args: chromium.args, headless: 'shell' }),
      executablePath: await chromium.executablePath(),
      headless: 'shell',
    })
  }

  const executablePath = findLocalChrome()
  if (!executablePath) {
    const err = new Error('NO_CHROME')
    err.code = 'NO_CHROME'
    throw err
  }

  return launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const session = await requireSession(req, res)
  if (!session) return

  const id = req.query?.id || (req.url && new URL('http://x' + req.url).searchParams.get('id'))
  if (!id) return res.status(400).json({ error: 'id is required (?id=<uuid> or ?id=demo)' })

  let report
  if (id === 'demo') {
    report = DEMO_REPORT
  } else {
    const supabase = getSupabase()
    const { data: r, error } = await supabase
      .from('investigation_reports')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single()

    if (error || !r) return res.status(404).json({ error: 'Report not found' })

    const [victims, suspects, witnesses, evidences, debrief] = await Promise.all([
      supabase.from('ir_victims').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_suspects').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_witnesses').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_evidences').select('*').eq('report_id', id).order('sort_order'),
      supabase.from('ir_debrief_entries').select('*').eq('report_id', id).order('sort_order'),
    ])

    report = {
      ...r,
      victims: victims.data || [],
      suspects: suspects.data || [],
      witnesses: witnesses.data || [],
      evidences: evidences.data || [],
      debrief_entries: debrief.data || [],
    }
  }

  const html = buildPDFDocument(report)

  let browser
  try {
    browser = await launchBrowser()

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMediaType('print')
    // Small delay: fixed + background + blend layers settle before print.
    await new Promise((r) => setTimeout(r, 150))

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: false,
      preferCSSPageSize: false,
    })

    const base64 = Buffer.from(pdfBuffer).toString('base64')
    const safeName = (str, max) =>
      (str || '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, max)
    const filename = `CID-IR-${safeName(report.case_number, 8)}-${safeName(report.case_title, 35)}.pdf`

    return res.status(200).json({
      base64,
      pdf: base64,
      filename,
    })
  } catch (err) {
    if (err.code === 'NO_CHROME') {
      return res.status(500).json({
        error:
          'Chrome/Edge not found on this server. Set CHROME_PATH to chrome.exe, or use deploy on Vercel (bundled Chromium).',
      })
    }
    console.error('[report-pdf] puppeteer error:', err)
    return res.status(500).json({ error: 'PDF generation failed: ' + err.message })
  } finally {
    if (browser) await browser.close()
  }
}
