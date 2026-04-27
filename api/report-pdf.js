// ============================================================
//  CIB – PDF Export API
//  GET /api/report-pdf?id=<uuid>   → generate PDF for a saved report
//  GET /api/report-pdf?id=demo     → generate PDF with built-in demo data
//
//  Returns: { pdf: "<base64>", filename: "CID-IR-....pdf" }
// ============================================================
import { existsSync }    from 'fs'
import puppeteer         from 'puppeteer-core'
import { requireSession }  from './_lib/session.js'
import { getSupabase }     from './_lib/supabase.js'
import { buildPDFDocument, DEMO_REPORT } from './_lib/pdf-html.js'

// ── Find system Chromium/Chrome/Edge ─────────────────────────────────────
function findChrome() {
  const candidates = [
    // Windows – Chrome
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    // Windows – Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // Linux (CI / Vercel with chrome installed)
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ]
  return candidates.find(p => existsSync(p)) || null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const session = await requireSession(req, res)
  if (!session) return

  const id = req.query?.id || (req.url && new URL('http://x' + req.url).searchParams.get('id'))
  if (!id) return res.status(400).json({ error: 'id is required (?id=<uuid> or ?id=demo)' })

  // ── Fetch data ──────────────────────────────────────────────────────────
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
      victims:         victims.data  || [],
      suspects:        suspects.data || [],
      witnesses:       witnesses.data|| [],
      evidences:       evidences.data|| [],
      debrief_entries: debrief.data  || [],
    }
  }

  // ── Build HTML ──────────────────────────────────────────────────────────
  const html = buildPDFDocument(report)

  // ── Launch Chromium ─────────────────────────────────────────────────────
  const executablePath = findChrome()
  if (!executablePath) {
    return res.status(500).json({
      error: 'Chrome/Edge not found on this machine. Install Google Chrome or Microsoft Edge.',
    })
  }

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })

    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })

    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: false,
    })

    const base64   = Buffer.from(pdfBuffer).toString('base64')
    const safeName = (str, max) =>
      (str || '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, max)
    const filename = `CID-IR-${safeName(report.case_number, 8)}-${safeName(report.case_title, 35)}.pdf`

    return res.status(200).json({ pdf: base64, filename })
  } catch (err) {
    console.error('[report-pdf] puppeteer error:', err)
    return res.status(500).json({ error: 'PDF generation failed: ' + err.message })
  } finally {
    if (browser) await browser.close()
  }
}
