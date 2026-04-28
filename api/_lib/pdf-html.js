/**
 * pdf-html.js
 * Server-side PDF HTML builder for CID Investigation Reports (Form 0001).
 * Produces a self-contained HTML document with embedded CSS ready for
 * headless-Chrome PDF rendering via puppeteer-core.
 */
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath }            from 'url'
import path                         from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOGO_PATH = path.join(__dirname, '../../public/images/cib-logo-pdf.png')
function loadLogoBase64() {
  try {
    if (existsSync(LOGO_PATH)) {
      const buf = readFileSync(LOGO_PATH)
      return 'data:image/png;base64,' + buf.toString('base64')
    }
  } catch (_) { /* ignore */ }
  return null
}

/**
 * Seal image for PDF watermark — try api/_lib/assets first (bundled with serverless),
 * then public/ (local / monorepo).
 * Chromium PDF: use one position:fixed <img> (repeats every page); ::before/background often missing.
 */
function loadWatermarkDataUrl() {
  const candidates = [
    path.join(__dirname, 'assets', 'cid-seal-watermark.png'),
    path.join(__dirname, '../../public/images/cid-seal-watermark.png'),
    path.join(process.cwd(), 'public', 'images', 'cid-seal-watermark.png'),
  ]
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const buf = readFileSync(p)
        return 'data:image/png;base64,' + buf.toString('base64')
      }
    } catch (_) { /* next */ }
  }
  return null
}

const LOGO_SRC = loadLogoBase64()
const WM_SRC = loadWatermarkDataUrl()

/**
 * div + background-image prints more reliably in Chromium PDF than <img> position:fixed alone.
 * Single embed; fixed inset 0 = repeat on every physical sheet.
 */
function watermarkBodyHtml() {
  if (!WM_SRC) return ''
  // Behind .pdf-root (z-index). Fixed + background-image repeats on every PDF sheet in Chrome.
  return (
    '<div class="wm-layer" style="position:fixed;left:0;top:0;right:0;bottom:0;z-index:0;' +
    'pointer-events:none;opacity:0.22;' +
    "background-image:url('" +
    WM_SRC +
    "');background-size:52% auto;background-position:center center;background-repeat:no-repeat;" +
    '-webkit-print-color-adjust:exact;print-color-adjust:exact" aria-hidden="true"></div>'
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────
export function esc(s) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function fmtDate(d) {
  if (!d) return 'DD/MM/YYYY'
  const parts = String(d).split('-')
  if (parts.length !== 3) return String(d)
  return parts[2] + '/' + parts[1] + '/' + parts[0]
}

/** Supabase/JSON sometimes sends booleans as strings; PDF needs stable truth test. */
export function asPdfBool(v) {
  if (v === true || v === 1) return true
  if (v === false || v === 0) return false
  if (v === null || v === undefined) return false
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === '' || s === 'false' || s === 'f' || s === '0' || s === 'no' || s === 'n') return false
    if (s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'y') return true
    return false
  }
  return Boolean(v)
}

function strEqCI(a, b) {
  return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase()
}

function chk(checked) {
  const on = asPdfBool(checked)
  // U+2713 prints reliably in Chromium PDF; avoid tiny box clipping the glyph
  return `<span class="chkbox${on ? ' chkbox-on' : ''}" aria-hidden="true">${on ? '\u2713' : ''}</span>`
}

/** Form/API: case_referred_to is CSV (e.g. "LSPD,DOJ"). */
function referredIncludes(r, code) {
  const raw = (r.case_referred_to || '').trim()
  if (!raw) return false
  const up = code.toUpperCase()
  return raw.split(',').some((x) => x.trim().toUpperCase() === up)
}

/** Evidence: DB/form field evidence_was (legacy alias was_status). */
function evidenceWas(e) {
  return e?.evidence_was ?? e?.was_status ?? ''
}

/** Witness occupation: form saves welfare_occupation (legacy occupation). */
function witnessOccupation(w) {
  return w?.welfare_occupation ?? w?.occupation ?? ''
}

// ── CSS ────────────────────────────────────────────────────────────────────
const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; background: #fff; }
a { color: #000; }
/* Watermark: inline styles on .wm-layer (see watermarkBodyHtml); class hooks print colors */
.wm-layer { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pdf-root { position: relative; z-index: 1; isolation: auto; }
/* block flow: keeps bureau bar inside page-body (was flex: footer jumped to top of next page) */
.page { display: block; }
.page-body { display: block; }
.page-break { page-break-before: always; padding-top: 2mm; }
.print-keep { break-inside: avoid; page-break-inside: avoid; }
/* Flow sections: pack multiple short items per sheet; keep each card intact when possible */
.debrief-entry-block,
.evidence-card-block,
.witness-affidavit-block {
  break-inside: avoid;
  page-break-inside: avoid;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ddd;
}
.debrief-entry-block:last-child,
.evidence-card-block:last-child,
.witness-affidavit-block:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
/* Avoid orphan section titles; allow large summary tables to split naturally */
table.split-ok { page-break-inside: auto; }
table.split-ok tr { break-inside: auto; page-break-inside: auto; }
table.compact-avoid tr { break-inside: avoid; page-break-inside: avoid; }
.narrative { orphans: 3; widows: 3; }
.section-title { break-after: avoid; page-break-after: avoid; }
.page-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 10px;
  font-size: 8pt; font-weight: bold; letter-spacing: 0.4px;
}
.bureau-bar {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-top: 18px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 9pt;
  break-inside: avoid; page-break-inside: avoid; break-after: avoid;
  clear: both;
}
.bureau-bar .pg { font-weight: bold; font-size: 10pt; }
.sec-divider {
  flex: 1; display: flex; align-items: center; justify-content: center;
  font-size: 24pt; font-weight: bold; letter-spacing: 3px;
}
.section-title {
  background: #000; color: #fff; padding: 3px 8px;
  font-size: 9pt; font-weight: bold; letter-spacing: 1px;
  margin: 14px 0 8px;
}
.lbl { font-size: 7pt; font-weight: bold; color: #333; margin-bottom: 2px; letter-spacing: 0.3px; }
.chkbox {
  display: inline-block; min-width: 13px; height: 13px;
  border: 1px solid #000; margin-right: 3px; text-align: center;
  line-height: 13px; font-size: 9pt; vertical-align: middle;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.chkbox-on { font-weight: bold; font-family: Arial, Helvetica, sans-serif; }
/* Keep closure checkbox tables together (was split-ok breaking between rows) */
.closure-forms-wrap {
  break-inside: avoid;
  page-break-inside: avoid;
}
table.closure-table { page-break-inside: avoid; break-inside: avoid; }
table.closure-table tr { break-inside: avoid; page-break-inside: avoid; }
table { width: 100%; border-collapse: collapse; margin-bottom: 2px; }
th { background: #eee; border: 1px solid #000; padding: 3px 6px; font-size: 8pt; text-align: left; font-weight: bold; }
td { border: 1px solid #000; padding: 5px 8px; font-size: 9pt; vertical-align: top; }
.narrative {
  font-size: 9pt; line-height: 1.65; margin: 6px 0;
  text-align: justify; white-space: pre-wrap; word-break: break-word;
}
.sign-line { border-top: 1px solid #000; margin-top: 18px; padding-top: 4px; font-size: 8pt; }
.mugshot-box {
  width: 120px; height: 150px; border: 1px solid #000;
  display: flex; align-items: center; justify-content: center;
  font-size: 8pt; color: #666; text-align: center; margin: auto;
}
.cover {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 240mm; text-align: center;
}
.cover-logo   { width: 80px; height: auto; margin-bottom: 20px; }
.cover-bureau { font-size: 16pt; font-weight: bold; letter-spacing: 3px; margin-bottom: 6px; }
.cover-state  { font-size: 11pt; letter-spacing: 2px; margin-bottom: 36px; }
.cover-title  {
  font-size: 20pt; font-weight: bold; letter-spacing: 4px;
  border: 3px solid #000; padding: 16px 40px; margin-bottom: 36px;
}
.cover-case   { font-size: 12pt; margin-top: 8px; }
.hdr-logo     { width: 22px; height: auto; vertical-align: middle; margin-right: 5px; }
@page { size: A4; margin: 20mm 15mm 20mm 15mm; }
@media print { .page-break { page-break-before: always; } }
`

// ── Page chrome helpers ────────────────────────────────────────────────────
function pageHeader(formId) {
  return `<div class="page-header">
    <span>CRIMINAL INVESTIGATION DIVISION &ndash; STATE OF SAN ANDREAS</span>
    <span>${esc(formId)}</span>
  </div>`
}

function bureauBar(pg) {
  const logoTag = LOGO_SRC
    ? `<img class="hdr-logo" src="${LOGO_SRC}" alt="CIB"/>`
    : ''
  return `<div class="bureau-bar">
    <div>${logoTag}<strong>CENTRAL INVESTIGATION BUREAU</strong><br/>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;STATE OF SAN ANDREAS</div>
    <div class="pg">${pg}</div>
  </div>`
}

function sectionDividerPage(label) {
  return `<div class="page page-break"><div class="sec-divider">${label}</div></div>`
}

// ── Main builder ───────────────────────────────────────────────────────────
export function buildPDFDocument(r) {
  const formId = 'FORM 0001 (CID/' +
    (r.date_of_offense
      ? r.date_of_offense.replace(/-/g, '').slice(6) +
        r.date_of_offense.replace(/-/g, '').slice(4, 6) +
        r.date_of_offense.slice(2, 4)
      : 'DDMMYY') + ')'

  const ph  = pageHeader(formId)
  const jurs = [['LSPD', asPdfBool(r.jurisdiction_lspd)], ['SAST', asPdfBool(r.jurisdiction_sast)],
                ['LSCS', asPdfBool(r.jurisdiction_lscs)], ['STATE', asPdfBool(r.jurisdiction_state)]]
    .map(([j, v]) => `${chk(v)}&nbsp;${j}`).join(' &nbsp;&nbsp; ')

  let body = ''

  // ── COVER ──────────────────────────────────────────────────────────────
  const coverLogo = LOGO_SRC
    ? `<img class="cover-logo" src="${LOGO_SRC}" alt="CIB Logo"/>`
    : ''
  body += `<div class="page cover">
    ${coverLogo}
    <div class="cover-bureau">CENTRAL INVESTIGATION BUREAU</div>
    <div class="cover-state">STATE OF SAN ANDREAS</div>
    <div class="cover-title">INVESTIGATION REPORT</div>
    <div class="cover-case">Case: &ldquo;${esc(r.case_title || 'Untitled')}&rdquo;</div>
  </div>`

  // ── SECTION DIVIDER: A ────────────────────────────────────────────────
  body += sectionDividerPage('A. Classification')

  // ── PAGE 1: CLASSIFICATION ─────────────────────────────────────────────
  body += `<div class="page page-break"><div class="page-body">${ph}`
  body += `<div class="section-title">CASE CLASSIFICATION: CRIME AGAINST PERSON</div>`

  body += `<table><tr>
    <td style="width:32%"><div class="lbl">1. CATEGORY</div>
      ${chk(strEqCI(r.category, 'A'))}&nbsp;a.&nbsp;CATEGORY A &nbsp;
      ${chk(strEqCI(r.category, 'B'))}&nbsp;b.&nbsp;CATEGORY B &nbsp;
      ${chk(strEqCI(r.category, 'C'))}&nbsp;c.&nbsp;CATEGORY C
    </td>
    <td style="width:16%"><div class="lbl">2. CASE NO.</div>${esc(r.case_number || '')}</td>
    <td><div class="lbl">3. HIGHEST TYPE OF OFFENSE OR INCIDENT</div>${esc(r.offense_type || '')}</td>
  </tr></table>`

  body += `<table><tr>
    <td style="width:20%"><div class="lbl">4. MDW INCIDENT NUMBER</div>${esc(r.mdw_incident_number || '')}</td>
    <td style="width:20%"><div class="lbl">5. BUILDING NUMBER</div>${esc(r.building_number || '')}</td>
    <td><div class="lbl">6. ADDRESS</div>${esc(r.address || '')}</td>
  </tr></table>`

  body += `<table><tr>
    <td style="width:16%"><div class="lbl">7. NAME OF BUREAU</div>${esc(r.bureau_name || 'CID')}</td>
    <td style="width:16%"><div class="lbl">8. AGENCY/BUREAU CODE</div>${esc(r.agency_code || '')}</td>
    <td><div class="lbl">9. SPECIFIC LOCATION</div>${esc(r.specific_location || '')}</td>
  </tr></table>`

  body += `<table><tr>
    <td style="width:20%"><div class="lbl">10. LOCATION CODE</div>${esc(r.location_code || '')}</td>
    <td style="width:20%"><div class="lbl">11a. DATE OF OFFENSE/INCIDENT</div>${fmtDate(r.date_of_offense)}</td>
    <td style="width:20%"><div class="lbl">11a. TIME OF OFFENSE/INCIDENT</div>${esc(r.time_of_offense || '')}</td>
    <td><div class="lbl">12. DAY</div>${esc(r.day_of_offense || '')}</td>
  </tr></table>`

  body += `<table><tr>
    <td style="width:25%"><div class="lbl">13a. DATE REPORTED</div>${fmtDate(r.date_reported)}</td>
    <td style="width:20%"><div class="lbl">13b. DAY</div>${esc(r.day_reported || '')}</td>
    <td><div class="lbl">14. JURISDICTION (X)</div>${jurs}</td>
  </tr></table>`

  body += `<table><tr>
    <td><div class="lbl">15. LEAD INVESTIGATORS</div>${esc(r.lead_investigators || '')}</td>
    <td><div class="lbl">16a. PROSECUTOR</div>${esc(r.prosecutor || 'TBA')}</td>
    <td style="width:18%"><div class="lbl">16b. TIME START</div>${fmtDate(r.prosecutor_time_start)}</td>
    <td style="width:18%"><div class="lbl">16c. TIME END</div>${fmtDate(r.prosecutor_time_end)}</td>
  </tr></table>`

  // 17. Victims summary
  if (r.victims && r.victims.length) {
    body += `<br/><div class="lbl" style="font-size:9pt">17. VICTIM(S)</div>
    <table class="split-ok"><thead><tr><th>ID CODE (a)</th><th>IDENTIFICATION (b)</th><th>AGE (c)</th><th>SEX (d)</th><th>RACE (e)</th><th>TELEPHONE (f)</th><th>Welfare, Occupation</th></tr></thead><tbody>`
    r.victims.forEach(v => {
      body += `<tr><td>${esc(v.id_code || '')}</td><td>${esc(v.full_name || '')}</td><td>${esc(v.age || '')}</td><td>${esc(v.sex || '')}</td><td>${esc(v.race || '')}</td><td>${esc(v.telephone || '-')}</td><td>${esc(v.welfare_occupation || '')}</td></tr>`
      body += `<tr><td style="font-size:7.5pt;color:#444">PERSONAL<br/>Notes: ${esc(v.notes || '-')}</td><td colspan="3" style="font-size:7.5pt;color:#444">Welfare, Occupation<br/>${esc(v.welfare_occupation || '')}</td><td colspan="3" style="font-size:7.5pt;color:#444">FAMILY<br/>${esc(v.family || '-')}</td></tr>`
    })
    body += `</tbody></table>`
  }

  // 18. Suspects summary
  if (r.suspects && r.suspects.length) {
    body += `<br/><div class="lbl" style="font-size:9pt">18. SUSPECT(S)</div>
    <table class="split-ok"><thead><tr><th>ID CODE (a)</th><th>IDENTIFICATION (b)</th><th>AGE (c)</th><th>SEX (d)</th><th>RACE (e)</th><th>TELEPHONE (f)</th><th>Status, Welfare, Occupation</th></tr></thead><tbody>`
    r.suspects.forEach(s => {
      body += `<tr><td>${esc(s.id_code || '')}</td><td>${esc(s.full_name || '')}</td><td>${esc(s.age || '')}</td><td>${esc(s.sex || '')}</td><td>${esc(s.race || '')}</td><td>${esc(s.telephone || '-')}</td><td>${esc(s.welfare_occupation || '')}</td></tr>`
      body += `<tr><td style="font-size:7.5pt;color:#444">PERSONAL<br/>${esc(s.telephone || '-')}</td><td colspan="3" style="font-size:7.5pt;color:#444">Status, Welfare, Occupation<br/>${esc(s.welfare_occupation || '-')}</td><td colspan="3" style="font-size:7.5pt;color:#444">FAMILY<br/>${esc(s.family || '-')}</td></tr>`
      body += `<tr><td colspan="7" style="font-size:7.5pt;color:#444">Interrogations: ${esc(s.interrogation_url || '-')}</td></tr>`
    })
    body += `</tbody></table>`
  }

  // 19-20 — individual checkboxes matching the form
  body += `<table style="margin-top:8px"><tr>
    <td style="width:50%;vertical-align:top">
      <div class="lbl">19. SUSPECT STATUS</div>
      <div style="font-size:8.5pt;line-height:1.9">
        ${chk(strEqCI(r.suspect_status, 'NOT_IDENTIFIED'))}&nbsp;a. NOT IDENTIFIED<br/>
        ${chk(strEqCI(r.suspect_status, 'GOVT_EMPLOYEE'))}&nbsp;b. GOVERNMENT EMPLOYEE<br/>
        ${chk(strEqCI(r.suspect_status, 'GOVT_CONTRACT'))}&nbsp;c. GOVERNMENT CONTRACT<br/>
        ${chk(strEqCI(r.suspect_status, 'CITATION'))}&nbsp;d. CITATION ISSUED<br/>
        ${chk(strEqCI(r.suspect_status, 'NON_GOVT'))}&nbsp;d. NON-GOVERNMENT EMPLOYEE<br/>
        ${chk(strEqCI(r.suspect_status, 'NA'))}&nbsp;e. N/A
      </div>
      ${r.suspect_notes ? `<div style="font-size:8pt;margin-top:4px">Notes:<br/>${esc(r.suspect_notes)}</div>` : ''}
    </td>
    <td style="vertical-align:top">
      <div class="lbl">20. DISPOSITION OF SUSPECT</div>
      <div style="font-size:8.5pt;line-height:1.9">
        ${chk(strEqCI(r.suspect_disposition, 'ARRESTED'))}&nbsp;a. ARRESTED<br/>
        ${chk(strEqCI(r.suspect_disposition, 'NOT_ARRESTED'))}&nbsp;b. NOT ARRESTED<br/>
        ${chk(strEqCI(r.suspect_disposition, 'RELEASED'))}&nbsp;c. RELEASED<br/>
        ${chk(strEqCI(r.suspect_disposition, 'NA'))}&nbsp;d. N/A
      </div>
    </td>
  </tr></table>`
  body += bureauBar('1')
  body += `</div>` // end page-body
  body += `</div>` // end page

  // ── SECTION B: DEBRIEF — flow entries; short entries share a page (cards avoid split) ──
  if (r.debrief_entries && r.debrief_entries.length) {
    body += sectionDividerPage('B. Debrief of Incident')
    body += `<div class="page page-break"><div class="page-body">${ph}`
    body += `<div class="section-title">B. DEBRIEF OF INCIDENT</div>`
    r.debrief_entries.forEach((d, i) => {
      body += `<div class="debrief-entry-block print-keep">`
      body += `<table class="compact-avoid"><tr>
        <td style="width:40%"><div class="lbl">${i + 1}a. TITLE</div>${esc(d.title || '')}</td>
        <td><div class="lbl">b. DATE OF INCIDENT</div>${fmtDate(d.date_of_incident)}</td>
      </tr></table>`
      body += `<div class="narrative">${esc(d.content || '')}</div>`
      body += `</div>`
    })
    body += bureauBar('B')
    body += `</div>`
    body += `</div>`
  }

  // ── SECTION C: SUSPECTS DETAIL ────────────────────────────────────────
  if (r.suspects && r.suspects.length) {
    body += sectionDividerPage('C. Suspect')
    const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    r.suspects.forEach((s, i) => {
      const L = (n) => ALPHA[(i * 5) + n] // 5 fields per suspect, progressive letters
      body += `<div class="page page-break"><div class="page-body">${ph}`
      body += `<div style="font-size:9pt;font-weight:bold;margin-bottom:8px">Suspect ID: ${esc(s.id_code || 's.' + (i + 1))}</div>`
      body += `<table><tr>
        <td style="width:60%">
          <table style="border:none"><tr>
            <td style="border:none"><div class="lbl">${L(0)}. Name</div>${esc(s.full_name || '')}</td>
            <td style="border:none"><div class="lbl">${L(1)}. Description</div>${esc(s.description || '')}</td>
          </tr><tr>
            <td style="border:none"><div class="lbl">${L(2)}. DOB</div>${fmtDate(s.dob)}</td>
            <td style="border:none"><div class="lbl">${L(3)}. SEX</div>${esc(s.sex || '')}</td>
          </tr></table>
          <br/>
          <div class="lbl">${L(4)}. Interrogation</div>
          <div style="font-size:8pt;margin:4px 0">Interrogation: &nbsp;${s.interrogation_url ? `<a href="${esc(s.interrogation_url)}">${esc(s.interrogation_url)}</a>` : ''}</div>
          <div class="narrative">${esc(s.interrogation_summary || '')}</div>
        </td>
        <td style="width:40%;vertical-align:top;text-align:center">
          ${s.mugshot_url
            ? `<img src="${esc(s.mugshot_url)}" style="max-width:120px;max-height:150px;border:1px solid #000"/>`
            : '<div class="mugshot-box">&ldquo;SUSPECT MUGSHOT/<br/>AVAILABLE PICTURE&rdquo;</div>'}
        </td>
      </tr></table>`
      body += bureauBar((i + 1).toString())
      body += `</div>` // end page-body
      body += `</div>` // end page
    })
  }

  // ── SECTION D: VICTIMS DETAIL ─────────────────────────────────────────
  if (r.victims && r.victims.length) {
    body += sectionDividerPage('D. Victim')
    r.victims.forEach((v, i) => {
      body += `<div class="page page-break"><div class="page-body">${ph}`
      body += `<div style="font-size:9pt;font-weight:bold;margin-bottom:8px">Victim ID: ${esc(v.id_code || 'v.' + (i + 1))}</div>`
      body += `<table><tr>
        <td><div class="lbl">IDENTIFICATION (a)</div>
          First, Last Name, AKA<br/><strong>${esc(v.full_name || '')}</strong>
        </td>
        <td style="width:10%"><div class="lbl">AGE (c)</div>${esc(v.age || '')}</td>
        <td style="width:8%"><div class="lbl">SEX (d)</div>${esc(v.sex || '')}</td>
        <td style="width:10%"><div class="lbl">RACE (e)</div>${esc(v.race || '')}</td>
        <td style="width:16%"><div class="lbl">TELEPHONE (f)</div>${esc(v.telephone || '-')}</td>
      </tr><tr>
        <td colspan="2"><div class="lbl">Welfare, Occupation</div>${esc(v.welfare_occupation || '')}</td>
        <td colspan="3"><div class="lbl">Notes</div>${esc(v.notes || '-')}</td>
      </tr><tr>
        <td colspan="5"><div class="lbl">FAMILY</div>${esc(v.family || '-')}</td>
      </tr></table>`
      if (v.autopsy_by || v.autopsy_summary) {
        body += `<div class="print-keep">`
        body += `<table style="margin-top:8px"><tr>
          <td><div class="lbl">AUTOPSY (g)</div>
            <div style="font-size:8pt;margin:4px 0">Autopsy Report &ndash; By: <strong>${esc(v.autopsy_by || '')}</strong></div>
          </td>
        </tr></table>`
        body += `<div class="narrative" style="margin-top:6px">${esc(v.autopsy_summary || '')}</div></div>`
      }
      body += bureauBar((i + 1).toString())
      body += `</div>` // end page-body
      body += `</div>` // end page
    })
  }

  // ── SECTION E: WITNESSES — flow affidavits; short entries may share a page ──
  if (r.witnesses && r.witnesses.length) {
    body += sectionDividerPage('E. Witness')
    body += `<div class="page page-break"><div class="page-body">${ph}`
    body += `<div class="section-title">E. WITNESS AFFIDAVITS</div>`
    r.witnesses.forEach((w) => {
      body += `<div class="witness-affidavit-block print-keep">`
      body += `<table class="compact-avoid"><tr>
          <td style="width:8%"><div class="lbl">No.</div>${esc(w.id_code || '')}</td>
          <td colspan="3" style="font-weight:bold;font-size:10pt">AFFIDAVIT</td>
        </tr><tr>
          <td></td>
          <td style="width:25%"><div class="lbl">a. Name</div>${esc(w.full_name || '')}</td>
          <td style="width:20%"><div class="lbl">b. Witness ID Code</div>${esc(w.id_code || '')}</td>
          <td><div class="lbl">c. Status</div>${esc(w.status || '')}</td>
        </tr><tr>
          <td></td>
          <td><div class="lbl">d. Welfare</div>${esc(w.welfare || '')}</td>
          <td colspan="2"><div class="lbl">e. Occupation</div>${esc(witnessOccupation(w))}</td>
        </tr></table>`
      body += `<div class="lbl" style="margin-top:5px">f. Content</div>`
      body += `<div class="narrative">${esc(w.content || '')}</div>`
      body += `<div class="sign-line">[${esc(w.full_name || '')}]</div>`
      body += `</div>`
    })
    body += bureauBar('E')
    body += `</div>`
    body += `</div>`
  }

  // ── SECTION F: EVIDENCES — flow cards; short items may share a page ──
  if (r.evidences && r.evidences.length) {
    body += sectionDividerPage('F. Evidences')
    body += `<div class="page page-break"><div class="page-body">${ph}`
    body += `<div class="section-title">F. EVIDENCES</div>`
    r.evidences.forEach((e) => {
      body += `<div class="evidence-card-block print-keep">`
      body += `<table class="compact-avoid"><tr>
          <td style="width:10%"><div class="lbl">Evidence ID</div>${esc(e.id_code || '')}</td>
          <td><div class="lbl">a. NAME OF EVIDENCE</div>${esc(e.name || '')}</td>
          <td style="width:15%"><div class="lbl">b. EVIDENCE WAS</div>${esc(evidenceWas(e))}</td>
          <td style="width:15%"><div class="lbl">c. STATUS OF EVIDENCE</div>${esc(e.evidence_status || '')}</td>
          <td style="width:18%"><div class="lbl">d. DATE OF RETRIEVAL</div>${fmtDate(e.date_of_retrieval)}</td>
        </tr></table>`
      if (e.image_url) {
        body += `<div class="lbl" style="margin-top:4px">l. IMAGE</div>
          <img src="${esc(e.image_url)}" style="max-width:180px;max-height:110px;border:1px solid #000;margin:4px 0;display:block" crossorigin="anonymous"/>`
      } else {
        body += `<div style="width:180px;height:80px;border:1px solid #ccc;margin:4px 0;display:flex;align-items:center;justify-content:center;font-size:8pt;color:#888">Exhibit</div>`
      }
      body += `<div class="lbl">Summary of evidences</div>`
      body += `<div class="narrative">${esc(e.summary || '')}</div>`
      body += `</div>`
    })
    body += bureauBar('F')
    body += `</div>`
    body += `</div>`
  }

  // ── SECTION G: CLOSURE ────────────────────────────────────────────────
  body += sectionDividerPage('G. Closure')
  body += `<div class="page page-break"><div class="page-body">${ph}`
  body += `<div class="section-title">INVESTIGATION CLOSURE</div>`
  if (r.closure_summary) {
    body += `<div class="print-keep"><div class="lbl">I. Summary of Investigation</div>`
    body += `<div class="narrative">${esc(r.closure_summary)}</div></div><br/>`
  }
  if (r.closure_forensic) {
    body += `<div class="print-keep"><div class="lbl">II. Forensic Findings and Cause of Death</div>`
    body += `<div class="narrative">${esc(r.closure_forensic)}</div></div><br/>`
  }
  if (r.closure_suspect_id) {
    body += `<div class="print-keep"><div class="lbl">III. Suspect Identification and Culpability</div>`
    body += `<div class="narrative">${esc(r.closure_suspect_id)}</div></div><br/>`
  }
  if (r.closure_final_disposition) {
    body += `<div class="print-keep"><div class="lbl">IV. Final Disposition</div>`
    body += `<div class="narrative">${esc(r.closure_final_disposition)}</div></div>`
  }

  body += `<div class="closure-forms-wrap">`

  body += `<table class="closure-table" style="margin-top:12px"><tr>
    <td style="width:20%"><div class="lbl">24a. TIME RECEIVED</div>${fmtDate(r.closure_time_received)}</td>
    <td style="width:20%"><div class="lbl">24b. TIME ARRIVED</div>${fmtDate(r.closure_time_arrived)}</td>
    <td style="width:18%"><div class="lbl">a. TYPE</div>
      ${chk(strEqCI(r.closure_type, 'CID'))}&nbsp;CID &nbsp;&nbsp;
      ${chk(strEqCI(r.closure_type, 'GRD'))}&nbsp;GRD
    </td>
    <td><div class="lbl">b. SIGNATURE &mdash; d. DATE</div>${fmtDate(r.closure_date)}</td>
    <td style="width:20%"><div class="lbl">c. RETURNED TO SERVICE</div>${fmtDate(r.closure_returned_to_service)}</td>
  </tr><tr>
    <td colspan="2"><div class="lbl">c. NAME</div>${esc(r.closure_detective_name || '')}</td>
    <td colspan="3"></td>
  </tr></table>`

  body += `<table class="closure-table" style="margin-top:8px"><tr>
    <td><div class="lbl">26. CASE REFERRED TO</div>
      <div style="font-size:8.5pt;line-height:1.8">
        ${chk(referredIncludes(r, 'LSPD'))}&nbsp;a. LSPD &nbsp;
        ${chk(referredIncludes(r, 'LSCS'))}&nbsp;b. LSCS &nbsp;
        ${chk(referredIncludes(r, 'SAST'))}&nbsp;c. SAST<br/>
        ${chk(referredIncludes(r, 'DOJ'))}&nbsp;d. DOJ &nbsp;
        ${chk(referredIncludes(r, 'DOC'))}&nbsp;e. DOC &nbsp;
        ${chk(referredIncludes(r, 'NA'))}&nbsp;f. N/A
      </div>
    </td>
    <td><div class="lbl">27. CASE STATUS</div>
      <div style="font-size:8.5pt;line-height:1.8">
        ${chk(strEqCI(r.case_status, 'OPEN'))}&nbsp;a. OPEN<br/>
        ${chk(strEqCI(r.case_status, 'CLOSED'))}&nbsp;b. CLOSED<br/>
        ${chk(strEqCI(r.case_status, 'COLD'))}&nbsp;c. COLD
      </div>
    </td>
    <td><div class="lbl">28. PROSECUTOR</div>
      a. Name: ${esc(r.prosecutor_final_name || '-')}<br/>
      c. Occupation: ${esc(r.prosecutor_final_occupation || '-')}
    </td>
  </tr></table>`

  body += `<table class="closure-table" style="margin-top:8px"><tr>
    <td colspan="3"><div class="lbl">29. DETECTIVE STATUS</div>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;border:none"><tr style="border:none">
    <td style="vertical-align:top;border:1px solid #000;width:33%"><div class="lbl">b. HOW CLOSED</div>
      ${chk(strEqCI(r.detective_how_closed, 'INACTIVE'))}&nbsp;INACTIVE &nbsp;
      ${chk(strEqCI(r.detective_how_closed, 'ARREST'))}&nbsp;ARREST &nbsp;
      ${chk(strEqCI(r.detective_how_closed, 'OTHER'))}&nbsp;OTHER MEANS
    </td>
    <td style="vertical-align:top;border:1px solid #000;width:34%">
      ${chk(asPdfBool(r.detective_suspect_developed))}&nbsp;Suspect Developed &nbsp;
      ${chk(asPdfBool(r.detective_suspect_arrested))}&nbsp;Suspect Arrested<br/>
      ${chk(asPdfBool(r.detective_entered_forensics))}&nbsp;Entered Forensics &nbsp;
      ${chk(asPdfBool(r.detective_evidence_recovered))}&nbsp;Evidence Recovered<br/>
      ${chk(asPdfBool(r.detective_cleared_forensics))}&nbsp;Cleared Forensics
    </td>
    <td style="vertical-align:top;border:1px solid #000;width:33%">
      <div class="lbl">f. Value of Property</div>${esc(r.detective_value_of_property || 'N/A')}<br/>
      <div class="lbl" style="margin-top:4px">h. Referred To</div>${esc(r.detective_referred_to || '-')}<br/>
      <div class="lbl" style="margin-top:4px">i. Date Referral Accepted</div>${fmtDate(r.detective_date_referral)}
    </td>
      </tr></table>
    </td>
  </tr></table>`
  body += `</div>`
  body += bureauBar('1')
  body += `</div>` // end page-body
  body += `</div>` // end closure page

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>CID Investigation Report &mdash; ${esc(r.case_title || 'Draft')}</title>
<style>${CSS}</style>
</head><body>${watermarkBodyHtml()}<div class="pdf-root">${body}</div></body></html>`
}

/** Smoke-test payload for ?id=demo — empty fields; keys align with form/API (no sample narrative). */
export const DEMO_REPORT = {
  case_number: null,
  case_title: null,
  category: 'A',
  offense_type: null,
  mdw_incident_number: null,
  building_number: null,
  address: null,
  bureau_name: 'CID',
  agency_code: null,
  specific_location: null,
  location_code: null,
  date_of_offense: null,
  time_of_offense: null,
  day_of_offense: null,
  date_reported: null,
  day_reported: null,
  jurisdiction_lspd: false,
  jurisdiction_sast: false,
  jurisdiction_lscs: false,
  jurisdiction_state: false,
  lead_investigators: null,
  prosecutor: null,
  prosecutor_time_start: null,
  prosecutor_time_end: null,
  suspect_status: null,
  suspect_disposition: null,
  suspect_notes: null,
  closure_summary: null,
  closure_forensic: null,
  closure_suspect_id: null,
  closure_final_disposition: null,
  closure_time_received: null,
  closure_time_arrived: null,
  closure_type: 'CID',
  closure_detective_name: null,
  closure_date: null,
  closure_returned_to_service: null,
  case_referred_to: null,
  case_status: 'OPEN',
  prosecutor_final_name: null,
  prosecutor_final_occupation: null,
  detective_how_closed: null,
  detective_suspect_developed: false,
  detective_suspect_arrested: false,
  detective_entered_forensics: false,
  detective_evidence_recovered: false,
  detective_value_of_property: null,
  detective_cleared_forensics: false,
  detective_referred_to: null,
  detective_date_referral: null,
  debrief_entries: [],
  victims: [],
  suspects: [],
  witnesses: [],
  evidences: [],
}
