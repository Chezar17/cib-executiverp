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

const LOGO_SRC = loadLogoBase64()

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

function chk(checked) {
  return `<span class="chkbox${checked ? ' chkbox-on' : ''}">${checked ? '&#10003;' : ''}</span>`
}

// ── CSS ────────────────────────────────────────────────────────────────────
const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; background: #fff; }
a { color: #000; }
.page { display: flex; flex-direction: column; min-height: 257mm; }
.page-body { flex: 1; }
.page-break { page-break-before: always; padding-top: 2mm; }
.page-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 10px;
  font-size: 8pt; font-weight: bold; letter-spacing: 0.4px;
}
.bureau-bar {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-top: 14px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 9pt;
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
  display: inline-block; width: 11px; height: 11px;
  border: 1px solid #000; margin-right: 2px; text-align: center;
  line-height: 11px; font-size: 8pt; vertical-align: middle;
}
.chkbox-on { font-weight: bold; }
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
  const jurs = [['LSPD', r.jurisdiction_lspd], ['SAST', r.jurisdiction_sast],
                ['LSCS', r.jurisdiction_lscs], ['STATE', r.jurisdiction_state]]
    .map(([j, v]) => `${chk(v)}&nbsp;${j}`).join(' &nbsp;&nbsp; ')

  const statusMap = {
    NOT_IDENTIFIED: 'a. Not Identified', GOVT_EMPLOYEE: 'b. Government Employee',
    GOVT_CONTRACT: 'c. Government Contract', CITATION: 'd. Citation Issued',
    NON_GOVT: 'd. Non-Government Employee', NA: 'e. N/A',
  }
  const dispMap = {
    ARRESTED: 'a. Arrested', NOT_ARRESTED: 'b. Not Arrested',
    RELEASED: 'c. Released', NA: 'd. N/A',
  }
  const caseRefMap  = { LSPD: 'a. LSPD', LSCS: 'b. LSCS', SAST: 'c. SAST', DOJ: 'd. DOJ', DOC: 'e. DOC', NA: 'f. N/A' }
  const caseStatMap = { OPEN: 'a. OPEN', CLOSED: 'b. CLOSED', COLD: 'c. COLD' }
  const howMap      = { INACTIVE: 'INACTIVE', ARREST: 'ARREST', OTHER: 'OTHER MEANS' }

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
      ${chk(r.category === 'A')}&nbsp;a.&nbsp;CATEGORY A &nbsp;
      ${chk(r.category === 'B')}&nbsp;b.&nbsp;CATEGORY B &nbsp;
      ${chk(r.category === 'C')}&nbsp;c.&nbsp;CATEGORY C
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
    <table><thead><tr><th>ID CODE (a)</th><th>IDENTIFICATION (b)</th><th>AGE (c)</th><th>SEX (d)</th><th>RACE (e)</th><th>TELEPHONE (f)</th><th>Welfare, Occupation</th></tr></thead><tbody>`
    r.victims.forEach(v => {
      body += `<tr><td>${esc(v.id_code || '')}</td><td>${esc(v.full_name || '')}</td><td>${esc(v.age || '')}</td><td>${esc(v.sex || '')}</td><td>${esc(v.race || '')}</td><td>${esc(v.telephone || '-')}</td><td>${esc(v.welfare_occupation || '')}</td></tr>`
      body += `<tr><td style="font-size:7.5pt;color:#444">PERSONAL<br/>Notes: ${esc(v.notes || '-')}</td><td colspan="3" style="font-size:7.5pt;color:#444">Welfare, Occupation<br/>${esc(v.welfare_occupation || '')}</td><td colspan="3" style="font-size:7.5pt;color:#444">FAMILY<br/>${esc(v.family || '-')}</td></tr>`
    })
    body += `</tbody></table>`
  }

  // 18. Suspects summary
  if (r.suspects && r.suspects.length) {
    body += `<br/><div class="lbl" style="font-size:9pt">18. SUSPECT(S)</div>
    <table><thead><tr><th>ID CODE (a)</th><th>IDENTIFICATION (b)</th><th>AGE (c)</th><th>SEX (d)</th><th>RACE (e)</th><th>TELEPHONE (f)</th><th>Status, Welfare, Occupation</th></tr></thead><tbody>`
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
        ${chk(r.suspect_status === 'NOT_IDENTIFIED')}&nbsp;a. NOT IDENTIFIED<br/>
        ${chk(r.suspect_status === 'GOVT_EMPLOYEE')}&nbsp;b. GOVERNMENT EMPLOYEE<br/>
        ${chk(r.suspect_status === 'GOVT_CONTRACT')}&nbsp;c. GOVERNMENT CONTRACT<br/>
        ${chk(r.suspect_status === 'CITATION')}&nbsp;d. CITATION ISSUED<br/>
        ${chk(r.suspect_status === 'NON_GOVT')}&nbsp;d. NON-GOVERNMENT EMPLOYEE<br/>
        ${chk(r.suspect_status === 'NA')}&nbsp;e. N/A
      </div>
      ${r.suspect_notes ? `<div style="font-size:8pt;margin-top:4px">Notes:<br/>${esc(r.suspect_notes)}</div>` : ''}
    </td>
    <td style="vertical-align:top">
      <div class="lbl">20. DISPOSITION OF SUSPECT</div>
      <div style="font-size:8.5pt;line-height:1.9">
        ${chk(r.suspect_disposition === 'ARRESTED')}&nbsp;a. ARRESTED<br/>
        ${chk(r.suspect_disposition === 'NOT_ARRESTED')}&nbsp;b. NOT ARRESTED<br/>
        ${chk(r.suspect_disposition === 'RELEASED')}&nbsp;c. RELEASED<br/>
        ${chk(r.suspect_disposition === 'NA')}&nbsp;d. N/A
      </div>
    </td>
  </tr></table>`
  body += `</div>` // end page-body
  body += bureauBar('1')
  body += `</div>` // end page

  // ── SECTION B: DEBRIEF ────────────────────────────────────────────────
  if (r.debrief_entries && r.debrief_entries.length) {
    body += sectionDividerPage('B. Debrief of Incident')
    body += `<div class="page page-break"><div class="page-body">${ph}`
    body += `<div class="section-title">B. DEBRIEF OF INCIDENT</div>`
    r.debrief_entries.forEach((d, i) => {
      body += `<table><tr>
        <td style="width:40%"><div class="lbl">${i + 1}a. TITLE</div>${esc(d.title || '')}</td>
        <td><div class="lbl">b. DATE OF INCIDENT</div>${fmtDate(d.date_of_incident)}</td>
      </tr></table>`
      body += `<div class="narrative">${esc(d.content || '')}</div><br/>`
    })
    body += `</div>` // end page-body
    body += bureauBar('1')
    body += `</div>` // end page
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
            <td style="border:none"><div class="lbl">${L(1)}. Description</div>${esc(s.description || 'Short summary of the suspect')}</td>
          </tr><tr>
            <td style="border:none"><div class="lbl">${L(2)}. DOB</div>${fmtDate(s.dob)}</td>
            <td style="border:none"><div class="lbl">${L(3)}. SEX</div>${esc(s.sex || '')}</td>
          </tr></table>
          <br/>
          <div class="lbl">${L(4)}. Interrogation</div>
          <div style="font-size:8pt;margin:4px 0">Interrogation: &nbsp;${s.interrogation_url ? `<a href="${esc(s.interrogation_url)}">${esc(s.interrogation_url)}</a>` : '&ldquo;INTERROGATION URL&rdquo;'}</div>
          <div class="narrative">${esc(s.interrogation_summary || '&ldquo;INTERROGATION SUMMARY&rdquo;')}</div>
        </td>
        <td style="width:40%;vertical-align:top;text-align:center">
          ${s.mugshot_url
            ? `<img src="${esc(s.mugshot_url)}" style="max-width:120px;max-height:150px;border:1px solid #000"/>`
            : '<div class="mugshot-box">&ldquo;SUSPECT MUGSHOT/<br/>AVAILABLE PICTURE&rdquo;</div>'}
        </td>
      </tr></table>`
      body += `</div>` // end page-body
      body += bureauBar((i + 1).toString())
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
        body += `<table style="margin-top:8px"><tr>
          <td><div class="lbl">AUTOPSY (g)</div>
            <div style="font-size:8pt;margin:4px 0">Autopsy Report &ndash; By: <strong>${esc(v.autopsy_by || '')}</strong></div>
          </td>
        </tr></table>`
        body += `<div class="narrative" style="margin-top:6px">${esc(v.autopsy_summary || '')}</div>`
      }
      body += `</div>` // end page-body
      body += bureauBar((i + 1).toString())
      body += `</div>` // end page
    })
  }

  // ── SECTION E: WITNESSES ──────────────────────────────────────────────
  if (r.witnesses && r.witnesses.length) {
    body += sectionDividerPage('E. Witness')
    let pgCount = 1
    const WITNESSES_PER_PAGE = 2
    for (let i = 0; i < r.witnesses.length; i += WITNESSES_PER_PAGE) {
      const chunk = r.witnesses.slice(i, i + WITNESSES_PER_PAGE)
      body += `<div class="page page-break"><div class="page-body">${ph}`
      chunk.forEach(w => {
        body += `<table><tr>
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
          <td colspan="2"><div class="lbl">e. Occupation</div>${esc(w.occupation || '')}</td>
        </tr></table>`
        body += `<div class="lbl" style="margin-top:5px">c. Content</div>`
        body += `<div class="narrative">${esc(w.content || '')}</div>`
        body += `<div class="sign-line">[${esc(w.full_name || '')}]</div><br/>`
      })
      body += `</div>` // end page-body
      body += bureauBar(pgCount.toString())
      body += `</div>` // end page
      pgCount++
    }
  }

  // ── SECTION F: EVIDENCES ──────────────────────────────────────────────
  if (r.evidences && r.evidences.length) {
    body += sectionDividerPage('F. Evidences')
    const EVIDENCES_PER_PAGE = 2
    for (let i = 0; i < r.evidences.length; i += EVIDENCES_PER_PAGE) {
      const chunk = r.evidences.slice(i, i + EVIDENCES_PER_PAGE)
      const pg    = Math.floor(i / EVIDENCES_PER_PAGE) + 1
      body += `<div class="page page-break"><div class="page-body">${ph}`
      chunk.forEach(e => {
        body += `<table><tr>
          <td style="width:10%"><div class="lbl">Evidence ID</div>${esc(e.id_code || '')}</td>
          <td><div class="lbl">a. NAME OF EVIDENCE</div>${esc(e.name || '')}</td>
          <td style="width:15%"><div class="lbl">b. EVIDENCE WAS</div>${esc(e.was_status || '')}</td>
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
        body += `<div class="narrative">${esc(e.summary || '')}</div><br/>`
      })
      body += `</div>` // end page-body
      body += bureauBar(pg.toString())
      body += `</div>` // end page
    }
  }

  // ── SECTION G: CLOSURE ────────────────────────────────────────────────
  body += sectionDividerPage('G. Closure')
  body += `<div class="page page-break"><div class="page-body">${ph}`
  body += `<div class="section-title">INVESTIGATION CLOSURE</div>`
  if (r.closure_summary)
    body += `<div class="lbl">I. Summary of Investigation</div><div class="narrative">${esc(r.closure_summary)}</div><br/>`
  if (r.closure_forensic)
    body += `<div class="lbl">II. Forensic Findings and Cause of Death</div><div class="narrative">${esc(r.closure_forensic)}</div><br/>`
  if (r.closure_suspect_id)
    body += `<div class="lbl">III. Suspect Identification and Culpability</div><div class="narrative">${esc(r.closure_suspect_id)}</div><br/>`
  if (r.closure_final_disposition)
    body += `<div class="lbl">IV. Final Disposition</div><div class="narrative">${esc(r.closure_final_disposition)}</div>`

  body += `<table style="margin-top:12px"><tr>
    <td style="width:20%"><div class="lbl">24a. TIME RECEIVED</div>${fmtDate(r.closure_time_received)}</td>
    <td style="width:20%"><div class="lbl">24b. TIME ARRIVED</div>${fmtDate(r.closure_time_arrived)}</td>
    <td style="width:18%"><div class="lbl">a. TYPE</div>
      ${chk(r.closure_type === 'CID')}&nbsp;CID &nbsp;&nbsp;
      ${chk(r.closure_type === 'GRD')}&nbsp;GRD
    </td>
    <td><div class="lbl">b. SIGNATURE &mdash; d. DATE</div>${fmtDate(r.closure_date)}</td>
    <td style="width:20%"><div class="lbl">c. RETURNED TO SERVICE</div>${fmtDate(r.closure_returned_to_service)}</td>
  </tr><tr>
    <td colspan="2"><div class="lbl">c. NAME</div>${esc(r.closure_detective_name || '')}</td>
    <td colspan="3"></td>
  </tr></table>`

  body += `<table style="margin-top:8px"><tr>
    <td><div class="lbl">26. CASE REFERRED TO</div>
      <div style="font-size:8.5pt;line-height:1.8">
        ${chk(r.case_referred_to === 'LSPD')}&nbsp;a. LSPD &nbsp;
        ${chk(r.case_referred_to === 'LSCS')}&nbsp;b. LSCS &nbsp;
        ${chk(r.case_referred_to === 'SAST')}&nbsp;c. SAST<br/>
        ${chk(r.case_referred_to === 'DOJ')}&nbsp;d. DOJ &nbsp;
        ${chk(r.case_referred_to === 'DOC')}&nbsp;e. DOC &nbsp;
        ${chk(r.case_referred_to === 'NA')}&nbsp;f. N/A
      </div>
    </td>
    <td><div class="lbl">27. CASE STATUS</div>
      <div style="font-size:8.5pt;line-height:1.8">
        ${chk(r.case_status === 'OPEN')}&nbsp;a. OPEN<br/>
        ${chk(r.case_status === 'CLOSED')}&nbsp;b. CLOSED<br/>
        ${chk(r.case_status === 'COLD')}&nbsp;c. COLD
      </div>
    </td>
    <td><div class="lbl">28. PROSECUTOR</div>
      a. Name: ${esc(r.prosecutor_final_name || '-')}<br/>
      c. Occupation: ${esc(r.prosecutor_final_occupation || '-')}
    </td>
  </tr></table>`

  body += `<table style="margin-top:8px"><tr>
    <td colspan="3"><div class="lbl">29. DETECTIVE STATUS</div></td>
  </tr><tr>
    <td><div class="lbl">b. HOW CLOSED</div>
      ${chk(r.detective_how_closed === 'INACTIVE')}&nbsp;INACTIVE &nbsp;
      ${chk(r.detective_how_closed === 'ARREST')}&nbsp;ARREST &nbsp;
      ${chk(r.detective_how_closed === 'OTHER')}&nbsp;OTHER MEANS
    </td>
    <td>
      ${chk(r.detective_suspect_developed)}&nbsp;Suspect Developed &nbsp;
      ${chk(r.detective_suspect_arrested)}&nbsp;Suspect Arrested<br/>
      ${chk(r.detective_entered_forensics)}&nbsp;Entered Forensics &nbsp;
      ${chk(r.detective_evidence_recovered)}&nbsp;Evidence Recovered<br/>
      ${chk(r.detective_cleared_forensics)}&nbsp;Cleared Forensics
    </td>
    <td>
      <div class="lbl">f. Value of Property</div>${esc(r.detective_value_of_property || 'N/A')}<br/>
      <div class="lbl" style="margin-top:4px">h. Referred To</div>${esc(r.detective_referred_to || '-')}<br/>
      <div class="lbl" style="margin-top:4px">i. Date Referral Accepted</div>${fmtDate(r.detective_date_referral)}
    </td>
  </tr></table>`
  body += `</div>` // end page-body
  body += bureauBar('1')
  body += `</div>` // end closure page

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>CID Investigation Report &mdash; ${esc(r.case_title || 'Draft')}</title>
<style>${CSS}</style>
</head><body><div class="pdf-root">${body}</div></body></html>`
}

// ── Demo data (Trae Dackerwood) ────────────────────────────────────────────
export const DEMO_REPORT = {
  case_number:        '0001',
  case_title:         'Homicide of Trae Dackerwood',
  category:           'A',
  offense_type:       '1st DEGREE MURDER',
  mdw_incident_number:'#310',
  building_number:    'Not Identified',
  address:            'Municipal Area',
  bureau_name:        'CID',
  agency_code:        'VICE',
  specific_location:  'Rear of Mission Row Police Department (Primary) / Sandy Shores Office (Secondary)',
  location_code:      'Not Identified',
  date_of_offense:    '2026-03-07',
  time_of_offense:    '02:15 UTC+7',
  day_of_offense:     'Saturday',
  date_reported:      '2026-03-07',
  day_reported:       'Saturday',
  jurisdiction_lspd:  true,
  jurisdiction_sast:  true,
  jurisdiction_lscs:  false,
  jurisdiction_state: false,
  lead_investigators: 'Detective II Julian Flux',
  prosecutor:         'TBA',
  prosecutor_time_start: null,
  prosecutor_time_end:   null,
  suspect_status:      'NON_GOVT',
  suspect_disposition: 'ARRESTED',
  suspect_notes:       'Government Employee, State of Freedom Regional Leader',

  debrief_entries: [
    {
      title:           '"Victim before death"',
      date_of_incident:'2026-03-07',
      content: 'The victim, Trae Dackerwood, was a former gang member who served as an informant for Detective Tarsha Kim. Days before his death, he approached witness Scott Hawkes in a state of fear, revealing his compromised status and mentioning he overheard "Knuckle Money" (Nelson Moss) confess to shooting Officer Tarsha Kim.',
    },
    {
      title:           '"Victim Body were found"',
      date_of_incident:'2026-03-07',
      content: 'On March 7th, 2026, at approximately 02:15 UTC+7, a headless body was discovered lying on its back near the railway tracks behind the Mission Row Headquarters (MRHQ).\n\nAt approximately 02:30 UTC+7, an unknown masked individual delivered a box to the Sandy Shores Sheriff Station and fled in one of three identified vehicles (Black Mercedes SUV, Green Nissan GTR R35, or another black vehicle). Upon inspection, the box was found to contain a severed human head.\n\nAn anonymous 911A transmission confirmed the head belonged to Trae Dackerwood and included a taunting message to "enjoy the ride, and wait for the \'game\'".',
    },
  ],

  suspects: [
    { id_code: 's.1', full_name: 'Nelson Moss AKA Knuckle Money', description: 'Short summary of the suspect', dob: null, sex: 'M', age: '-', race: 'AA', telephone: '-', welfare_occupation: '-', family: '-', interrogation_url: '', interrogation_summary: '"INTERROGATION SUMMARY"', mugshot_url: null },
    { id_code: 's.2', full_name: 'Don Whymean', description: 'Short summary of the suspect', dob: null, sex: 'M', age: '-', race: 'AA', telephone: '-', welfare_occupation: '-', family: '-', interrogation_url: '', interrogation_summary: '"INTERROGATION SUMMARY"', mugshot_url: null },
    { id_code: 's.3', full_name: 'Santigo Salvator', description: 'Short summary of the suspect', dob: null, sex: 'M', age: '-', race: 'AA', telephone: '-', welfare_occupation: '-', family: '-', interrogation_url: '', interrogation_summary: '"INTERROGATION SUMMARY"', mugshot_url: null },
  ],

  victims: [
    {
      id_code: 'v.1', full_name: 'Trae Dackerwood', age: '-', sex: 'M', race: 'AA',
      telephone: '-', welfare_occupation: 'Deceased, Ex-Gang Member', notes: '-', family: '-',
      autopsy_by: 'Dr. Ryu Ji Kenedy',
      autopsy_summary: 'The forensic examination conducted by Dr. Ryu Ji Kenedy of the San Andreas Health Department identifies the victim as Trae Dackerwood, a male born on August 15, 2008. The autopsy concludes that the victim died from severe trauma caused by decapitation, which resulted in massive hemorrhage.\n\nAn examination of the cervical region indicates that the decapitation was carried out using a sharp-edged weapon or a heavy cutting instrument, leaving relatively clean cutting margins along the neck structures. Furthermore, the presence of significant blood loss suggests that this fatal injury occurred while the victim was still alive or shortly before his death.\n\nPrior to the mutilation, the victim suffered physical assault, evidenced by additional pre-mortem injuries. These include:\n\u2022 Stab Wound (Vulnus Punctum): Located on the right thigh, approximately 4 cm deep, which penetrated the muscle tissue and caused damage to surrounding blood vessels, leading to active bleeding and severe pain.\n\u2022 Incised Wound (Vulnus Scissum): Found on the abdomen, measuring about 6 cm in length and affecting the superficial layers of the skin and soft tissue, resulting in moderate bleeding and open wound exposure.\n\nThe victim was discovered in a dismembered condition, with the head separated from the body. Scene findings revealed that the victim\'s head was located in the Sandy Shores area, while the body was recovered behind the Mission Row Headquarters (MRHQ). The official time of death is recorded as March 7th, 2026, at 02:45 UTC +7, and the manner of death is officially classified as a Homicide.',
    },
  ],

  witnesses: [
    { id_code: 'w.1', full_name: 'Scott Hawkes', status: 'Witness of motives', welfare: 'Alive', occupation: 'Detective of CIB', content: 'According to the testimony provided by Scott Hawkes, it was revealed that several days prior to his death, the victim, Trae Dackerwood, approached the witness in a state of profound fear. Trae disclosed that his position as an informant for Officer Tarsha Kim had been compromised. The victim admitted that during his time living on Grove Street, he routinely reported all illegal activities conducted by the Ballas gang to Officer Tarsha.\n\nIn his statement, Scott Hawkes explained that Trae had been present during an internal conversation among Ballas members. There, Trae directly overheard a confession from a subject identified as "Knuckle Money." The subject openly stated, "I just shot a female Officer and she is now in a coma," a statement that directly refers to the current critical condition of Officer Tarsha Kim.\n\nThis testimony establishes a clear retaliatory motive for the brutal execution of Trae Dackerwood and identifies "Knuckle Money" as a primary suspect in both the homicide of the victim and the attempted murder of Officer Tarsha Kim.\n\nI hereby declare that the information stated above is true and accurate to the best of my knowledge and professional expertise.' },
    { id_code: 'w.2', full_name: 'Meifanny Lorenta', status: 'Witness of possible killer', welfare: 'Alive', occupation: 'Detective of CIB', content: 'Pada saat Det. Meifanny Lorenta melakukan interogasi dengan Nelson Moss mengenai kidnapping terhadap Chief of Police, dia tiba-tiba berkata bahwa apakah kami akan menerima laporan ada orang yang meninggal beberapa jam kedepan, dan dia berharap kita bisa menemukan pelakunya.\n\nI hereby declare that the information stated above is true and accurate to the best of my knowledge and professional expertise.' },
    { id_code: 'w.3', full_name: 'Marco Romano', status: 'Witness Evidence [e.2]', welfare: 'Alive', occupation: 'Deputy of LSCS', content: 'While several deputies were standing in front of the Sheriff Station, an unknown individual wearing all black clothing and a full-face mask approached the area while carrying a box. Behind the individual, three vehicles were observed nearby: a black Mercedes SUV, a green Nissan GTR R35, and another unidentified black vehicle.\n\nThe individual then placed the box in front of the Sheriff Station before entering one of the vehicles. Shortly after, all vehicles fled the scene heading towards East Joshua Road.\n\nDeputy Kennedy later opened the box to inspect its contents and discovered that it contained a severed human head. The suspects had already fled the area before deputies were able to identify or apprehend them.\n\nI hereby declare that the information stated above is true and accurate to the best of my knowledge and professional expertise.' },
  ],

  evidences: [
    { id_code: 'e.1', name: 'Primary Crime Scene',                   was_status: 'Secured', evidence_status: 'Recovered', date_of_retrieval: '2026-03-07', image_url: null, summary: 'The victim was found at around 02.15 lying on his back beside the railway tracks behind MRHQ with no head and a lot of blood around him.' },
    { id_code: 'e.2', name: 'Secondary Crime Scene',                 was_status: 'Secured', evidence_status: 'Recovered', date_of_retrieval: null,          image_url: null, summary: 'A head was found around 2:30 a.m. in a box in front of the Sandy Shores Sheriff Station.' },
    { id_code: 'e.3', name: 'Reports on 911 about Head of victim',   was_status: 'Secured', evidence_status: 'Recovered', date_of_retrieval: null,          image_url: null, summary: 'Log 1 (911): "Sir, I saw a headless body behind MRPD."\nLog 2 (311): Request for detective presence at Sandy Shores Station by Edward Choi.\nLog 3 (911A): Anonymous — "The Head of Trae Deckerwood has been sent to front sheriff office. enjoy the ride, and wait for the \'game\'".' },
    { id_code: 'e.4', name: 'Victim Phone',                          was_status: 'Secured', evidence_status: 'Recovered', date_of_retrieval: null,          image_url: null, summary: 'Digital evidence from Trae Dackerwood\'s mobile device confirmed that he was an active Confidential Informant (CI) for Detective Tarsha Kim, frequently providing intelligence on Ballas crimes.\n\nOn the day of his death, Trae made a call to Billie Joe Crownstone, and a missed call from Detective Tarsha Kim.' },
    { id_code: 'e.5', name: 'DNA found on victim',                   was_status: 'Secured', evidence_status: 'Recovered', date_of_retrieval: null,          image_url: null, summary: 'DNA Analysis Report\nThe forensic analysis conducted at the Los Santos Medical Service on March 8, 2026, confirms with 99% certainty that complete sets of fingerprints belonging to three distinct individuals — Nelson Moss (s.1), Santigo Salvator (s.2), and Don Whymean (s.3) — were recovered directly from the body of Trae Dackerwood.' },
  ],

  closure_summary:
    'The investigation into the death of Trae Dackerwood has concluded that the victim was the target of a premeditated and brutal retaliatory execution. Evidence indicates the homicide was a direct response to the victim\'s role as a Confidential Informant (CI) for Detective Tarsha Kim. Digital forensics from the victim\'s mobile device confirmed he frequently provided intelligence regarding the illegal activities of the Ballas gang.',
  closure_forensic:
    'According to the autopsy performed by Dr. Ryu Ji Kenedy, the cause of death was decapitation resulting in massive hemorrhage. The examination revealed the victim was alive during the initial assault, evidenced by: a 4 cm deep stab wound (Vulnus Punctum) on the right thigh; a 6 cm incised wound (Vulnus Scissum) on the abdomen; clean cutting margins in the cervical region. The victim\'s remains were recovered from two separate locations: the body behind the Mission Row Police Department, and the severed head delivered in a box to the Sandy Shores Sheriff Station.',
  closure_suspect_id:
    'The Criminal Investigation Division has identified three primary suspects: Nelson Moss (aka "Knuckle Money"), Santigo Salvator, and Don Whymean. Physical evidence: forensic analysis confirmed with 99% certainty fingerprints from all three suspects were recovered from the victim\'s body. Testimonial evidence: Scott Hawkes testified that the victim overheard Nelson Moss confessing to the shooting of Officer Tarsha Kim. Behavioral evidence: Nelson Moss predicted the victim\'s death during interrogation by Detective Meifanny Lorenta.',
  closure_final_disposition:
    'Based on the overwhelming physical and testimonial evidence, this case is classified as 1st Degree Murder. The suspects have been marked as Arrested. All evidence — including the victim\'s phone, identity card, and forensic DNA reports — has been secured and recovered. The case is officially referred to the Department of Justice (DOJ) for prosecution.',
  closure_time_received:    null,
  closure_time_arrived:     null,
  closure_type:             'CID',
  closure_detective_name:   'Julian Flux',
  closure_date:             null,
  closure_returned_to_service: null,
  case_referred_to:         'LSCS',
  case_status:              'CLOSED',
  prosecutor_final_name:    '-',
  prosecutor_final_occupation: '-',
  detective_how_closed:     null,
  detective_suspect_developed:  false,
  detective_suspect_arrested:   false,
  detective_entered_forensics:  true,
  detective_evidence_recovered: true,
  detective_value_of_property:  'N/A',
  detective_cleared_forensics:  true,
  detective_referred_to:    '-',
  detective_date_referral:  null,
}
