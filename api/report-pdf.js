// ============================================================
//  CIB – PDF Export API
//  GET /api/report-pdf?id=<uuid>   → generate PDF for a saved report
//  GET /api/report-pdf?id=demo     → PDF smoke-test (empty shell; same field keys as form/API)
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
import {
  PDF_HEADER_TEMPLATE,
  buildPdfFooterTemplate,
  loadFooterLogoDataUrl,
} from './_lib/pdf-layout.js'
import { jsonApiError } from './_lib/api-error.js'

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
  let browser
  try {
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

      if (error || !r) {
        return jsonApiError(res, 404, 'Report not found or deleted', {
          supabase: error || undefined,
          context: 'report-pdf GET investigation_reports',
        })
      }

      const [victims, suspects, witnesses, evidences, debrief] = await Promise.all([
        supabase.from('ir_victims').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_suspects').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_witnesses').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_evidences').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
        supabase.from('ir_debrief_entries').select('*').eq('report_id', id).eq('is_deleted', false).order('sort_order'),
      ])

      const subs = [victims, suspects, witnesses, evidences, debrief]
      const names = ['ir_victims','ir_suspects','ir_witnesses','ir_evidences','ir_debrief_entries']
      const failIdx = subs.findIndex((x) => x.error)
      if (failIdx >= 0) {
        return jsonApiError(res, 500, 'Failed to load related rows for PDF', {
          supabase: subs[failIdx].error,
          context: `report-pdf sub-query ${names[failIdx]}`,
        })
      }

      report = {
        ...r,
        victims: victims.data || [],
        suspects: suspects.data || [],
        witnesses: witnesses.data || [],
        evidences: evidences.data || [],
        debrief_entries: debrief.data || [],
      }
    }

    let html
    try {
      html = buildPDFDocument(report)
    } catch (e) {
      return jsonApiError(res, 500, 'Failed to assemble PDF document HTML', {
        cause: e,
        context: 'report-pdf buildPDFDocument',
      })
    }

    browser = await launchBrowser()

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMediaType('print')
    await new Promise((r) => setTimeout(r, 150))

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', bottom: '0', left: '0', right: '0' },
      displayHeaderFooter: true,
      headerTemplate: PDF_HEADER_TEMPLATE,
      footerTemplate: buildPdfFooterTemplate(loadFooterLogoDataUrl()),
      preferCSSPageSize: true,
      scale: 1,
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
        code: 'NO_CHROME',
        reason: err.message,
      })
    }
    console.error('[report-pdf] error:', err)
    return jsonApiError(res, 500, err?.message || 'PDF generation failed', {
      cause: err,
      context: 'report-pdf puppeteer',
    })
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch (closeErr) {
        console.error('[report-pdf] browser.close failed:', closeErr)
      }
    }
  }
}
