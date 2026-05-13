/**
 * pdf-html.js
 * Server-side PDF HTML builder for CID Investigation Reports (Form 0001).
 * Produces a self-contained HTML document with embedded CSS ready for
 * headless-Chrome PDF rendering via puppeteer-core.
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { pdfPageMarginCssString, PDF_MARGIN_MM } from "./pdf-layout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, "../../public/images/cib-logo-pdf.png");
function loadLogoBase64() {
  try {
    if (existsSync(LOGO_PATH)) {
      const buf = readFileSync(LOGO_PATH);
      return "data:image/png;base64," + buf.toString("base64");
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

/**
 * Seal image for PDF watermark — try api/_lib/assets first (bundled with serverless),
 * then public/ (local / monorepo).
 * Chromium PDF: use one position:fixed <img> (repeats every page); ::before/background often missing.
 */
function loadWatermarkDataUrl() {
  const candidates = [
    path.join(__dirname, "assets", "cid-seal-watermark.png"),
    path.join(__dirname, "../../public/images/cid-seal-watermark.png"),
    path.join(process.cwd(), "public", "images", "cid-seal-watermark.png"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const buf = readFileSync(p);
        return "data:image/png;base64," + buf.toString("base64");
      }
    } catch (_) {
      /* next */
    }
  }
  return null;
}

const LOGO_SRC = loadLogoBase64();
const WM_SRC = loadWatermarkDataUrl();

/**
 * div + background-image prints more reliably in Chromium PDF than <img> position:fixed alone.
 * Single embed; fixed inset 0 = repeat on every physical sheet.
 */
function watermarkBodyHtml() {
  if (!WM_SRC) return "";
  const m = PDF_MARGIN_MM;
  // Match @page inset (pdf-layout PDF_MARGIN_MM) so the seal stays in the printable content box on every sheet.
  // Chromium repeats position:fixed backgrounds across PDF pages when printBackground is true.
  return (
    '<div class="wm-layer" style="position:fixed;left:' +
    m.left +
    ";top:" +
    m.top +
    ";right:" +
    m.right +
    ";bottom:" +
    m.bottom +
    ";z-index:0;" +
    "pointer-events:none;opacity:0.26;" +
    "background-image:url('" +
    WM_SRC +
    "');background-size:52% auto;background-position:center center;background-repeat:no-repeat;" +
    '-webkit-print-color-adjust:exact;print-color-adjust:exact" aria-hidden="true"></div>'
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
export function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtDate(d) {
  if (!d) return "DD/MM/YYYY";
  const parts = String(d).split("-");
  if (parts.length !== 3) return String(d);
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

/** Printed below witness narrative, before signature line (full-width table). */
const WITNESS_TRUTH_DECLARATION =
  "I hereby declare that the information stated above is true and accurate to the best of my knowledge and professional expertise.";

/** Minimal escaping for remote URLs inside single-quoted CSS `url('...')` in HTML attributes. */
function cssUrlForPdfAttr(href) {
  if (!href) return "";
  return String(href)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function normalizePdfCrop(raw) {
  if (!raw || typeof raw !== "object") return null;
  const nx = Number(raw.nx);
  const ny = Number(raw.ny);
  const nw = Number(raw.nw);
  const nh = Number(raw.nh);
  if (![nx, ny, nw, nh].every((n) => Number.isFinite(n))) return null;
  if (nw < 1e-4 || nh < 1e-4 || nx < 0 || ny < 0 || nx + nw > 1.0001 || ny + nh > 1.0001) return null;
  return { nx, ny, nw, nh };
}

/**
 * Fixed-size photo cell for PDF: only URL + optional normalized crop are stored.
 * Uses background-image so Chromium prints the chosen crop predictably.
 */
function pdfFramedPhotoHtml(url, orientation, crop, portraitW, portraitH, landscapeW, landscapeH, fallbackInnerHtml) {
  let boxW;
  let boxH;
  if (orientation === "square") {
    const side = Math.min(portraitW, portraitH, landscapeW, landscapeH);
    boxW = boxH = side;
  } else {
    const landscape = orientation === "landscape";
    boxW = landscape ? landscapeW : portraitW;
    boxH = landscape ? landscapeH : portraitH;
  }
  if (!url) {
    return `<div class="mugshot-box" style="width:${boxW}px;height:${boxH}px;max-width:100%">${fallbackInnerHtml}</div>`;
  }
  const u = cssUrlForPdfAttr(url);
  const c = normalizePdfCrop(crop);
  let bgSize;
  let bgPos;
  if (!c || (c.nw >= 0.999 && c.nh >= 0.999)) {
    bgSize = "cover";
    bgPos = "50% 50%";
  } else {
    const sx = (100 / c.nw).toFixed(6);
    const sy = (100 / c.nh).toFixed(6);
    const px = c.nw >= 0.999 ? 50 : (c.nx / (1 - c.nw)) * 100;
    const py = c.nh >= 0.999 ? 50 : (c.ny / (1 - c.nh)) * 100;
    bgSize = sx + "% " + sy + "%";
    bgPos = px.toFixed(4) + "% " + py.toFixed(4) + "%";
  }
  return (
    `<div class="pdf-framed-photo" style="display:inline-block;width:${boxW}px;height:${boxH}px;max-width:100%;border:1px solid #000;margin:auto;` +
    `background-image:url('${u}');background-repeat:no-repeat;background-size:${bgSize};background-position:${bgPos};` +
    `-webkit-print-color-adjust:exact;print-color-adjust:exact"></div>`
  );
}

/** Evidence exhibit: fills grid column height (matches text column); uses same crop math as framed photos. */
function pdfEvidencePhotoFillHtml(url, crop, fallbackInnerHtml) {
  if (!url) {
    return `<div class="pdf-evidence-photo-fill pdf-evidence-photo-fill--empty">${fallbackInnerHtml}</div>`;
  }
  const u = cssUrlForPdfAttr(url);
  const c = normalizePdfCrop(crop);
  let bgSize;
  let bgPos;
  if (!c || (c.nw >= 0.999 && c.nh >= 0.999)) {
    bgSize = "cover";
    bgPos = "50% 50%";
  } else {
    const sx = (100 / c.nw).toFixed(6);
    const sy = (100 / c.nh).toFixed(6);
    const px = c.nw >= 0.999 ? 50 : (c.nx / (1 - c.nw)) * 100;
    const py = c.nh >= 0.999 ? 50 : (c.ny / (1 - c.nh)) * 100;
    bgSize = sx + "% " + sy + "%";
    bgPos = px.toFixed(4) + "% " + py.toFixed(4) + "%";
  }
  return (
    `<div class="pdf-evidence-photo-fill" style="background-image:url('${u}');background-size:${bgSize};background-position:${bgPos};"></div>`
  );
}

/** Supabase/JSON sometimes sends booleans as strings; PDF needs stable truth test. */
export function asPdfBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (v === null || v === undefined) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (
      s === "" ||
      s === "false" ||
      s === "f" ||
      s === "0" ||
      s === "no" ||
      s === "n"
    )
      return false;
    if (s === "true" || s === "t" || s === "1" || s === "yes" || s === "y")
      return true;
    return false;
  }
  return Boolean(v);
}

function strEqCI(a, b) {
  return (
    String(a ?? "")
      .trim()
      .toUpperCase() ===
    String(b ?? "")
      .trim()
      .toUpperCase()
  );
}

function chk(checked) {
  const on = asPdfBool(checked);
  // ASCII "X" survives all Chromium PDF font stacks; unicode checkmarks can disappear in headless PDF
  const mark = on ? '<span class="chk-mark">X</span>' : "";
  return `<span class="chkbox${on ? " chkbox-on" : ""}" aria-hidden="true">${mark}</span>`;
}

/** Form/API: case_referred_to is CSV (e.g. "LSPD,DOJ"). */
function referredIncludes(r, code) {
  const raw = (r.case_referred_to || "").trim();
  if (!raw) return false;
  const up = code.toUpperCase();
  return raw.split(",").some((x) => x.trim().toUpperCase() === up);
}

/** Evidence: DB/form field evidence_was (legacy alias was_status). */
function evidenceWas(e) {
  return e?.evidence_was ?? e?.was_status ?? "";
}

/** Witness occupation: form saves welfare_occupation (legacy occupation). */
function witnessOccupation(w) {
  const base = w?.welfare_occupation ?? w?.occupation ?? "";
  if (asPdfBool(w?.is_expert) && String(w?.expertise || "").trim())
    return (base ? `${base} — ` : "") + String(w.expertise || "");
  return base;
}

const DETECTIVE_RANK_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
/** Detective 3 → Detective III (Arabic ranks 1–10). */
function normalizeDetectiveRankRoman(text) {
  if (text == null || text === "") return "";
  let s = String(text);
  s = s.replace(/\bDetective\.?\s*(\d{1,2})\b/gi, (_, num) => {
    const n = parseInt(num, 10);
    if (n >= 1 && n <= 10) return `Detective ${DETECTIVE_RANK_ROMAN[n]}`;
    return `Detective ${num}`;
  });
  s = s.replace(/\bDet\.?\s*(\d{1,2})\b/gi, (_, num) => {
    const n = parseInt(num, 10);
    if (n >= 1 && n <= 10) return `Det. ${DETECTIVE_RANK_ROMAN[n]}`;
    return `Det. ${num}`;
  });
  return s;
}

function evidenceCropAspectLabel(e) {
  const a = String(e?.image_crop_aspect || "free").toLowerCase();
  return a === "square" ? "Square (1:1)" : "Free";
}

// ── CSS ────────────────────────────────────────────────────────────────────
const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 10pt;
  color: #000;
  background: #fff;
  position: relative;
}
a { color: #000; }
/* CID seal (api/_lib/assets/cid-seal-watermark.png) — fixed layer repeats on each PDF page */
.wm-layer {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
@media print {
  .wm-layer {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
.pdf-root { position: relative; z-index: 1; isolation: auto; }
/* block flow for printable pages */
.page { display: block; }
.page-body { display: block; }
.page-break { page-break-before: always; padding-top: 2mm; }
.print-keep { break-inside: avoid; page-break-inside: avoid; }
/* Profile sections may span sheets; outer cards do not force one page */
.suspect-detail-block,
.victim-detail-block,
.evidence-card-block {
  break-inside: auto;
  page-break-inside: auto;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ddd;
}
.debrief-entry-block,
.witness-affidavit-block {
  break-inside: auto;
  page-break-inside: auto;
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
.suspect-detail-block:last-child,
.victim-detail-block:last-child {
  border-bottom: none;
  margin-bottom: 0;
}
/* Summary listing: may span sheets; split between victim/suspect groups; rows stay intact */
table.pdf-summary-table {
  page-break-inside: auto;
  break-inside: auto;
}
tbody.pdf-row-group {
  break-inside: auto;
  page-break-inside: auto;
}
tbody.pdf-row-group tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
/* Tables: prefer one page; may continue on next page between rows — borders close/open via row boundaries */
table.pdf-solid-table {
  break-inside: auto;
  page-break-inside: auto;
}
table.pdf-solid-table > thead > tr,
table.pdf-solid-table > tbody > tr,
table.pdf-solid-table > tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
table.pdf-table-keep {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}
table.compact-avoid {
  break-inside: auto;
  page-break-inside: auto;
}
table.compact-avoid tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
.pdf-id-row {
  font-size: 9pt;
  font-weight: bold;
  padding: 6px 8px;
}
/* Evidence: two-column table (replaces grid) — photo stacks under label inside cell */
table.pdf-evidence-split-table {
  width: 100%;
  border-collapse: collapse;
  break-inside: auto;
  page-break-inside: auto;
}
table.pdf-evidence-split-table > tbody > tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
table.pdf-evidence-split-table td.pdf-evidence-fields-cell {
  width: 62%;
  vertical-align: top;
  padding: 8px;
}
table.pdf-evidence-split-table td.pdf-evidence-photo-cell {
  width: 38%;
  vertical-align: top;
  padding: 8px;
}
.pdf-evidence-photo-stack {
  display: flex;
  flex-direction: column;
  min-height: 220px;
  height: 100%;
}
.pdf-evidence-photo-fill {
  flex: 1 1 auto;
  width: 100%;
  min-height: 180px;
  margin-top: 4px;
  border: 1px solid #000;
  background-repeat: no-repeat;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.pdf-evidence-photo-fill--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8pt;
  color: #666;
  text-align: center;
  padding: 12px;
}
td .narrative,
th .narrative {
  break-inside: auto;
  page-break-inside: auto;
}
td, th {
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}
/* Witness declaration row inside affidavit table — splittable with parent table */
table.witness-affidavit-table td.witness-declaration-cell {
  width: 100%;
  padding: 12px 14px;
  font-size: 9pt;
  line-height: 1.65;
  text-align: justify;
  vertical-align: middle;
}
table.witness-sign-row td {
  border-top: 1px solid #000;
  padding-top: 10px;
  margin-top: 0;
  font-size: 8pt;
}
.section-title {
  background: #000; color: #fff; padding: 3px 8px;
  font-size: 9pt; font-weight: bold; letter-spacing: 1px;
  margin: 14px 0 8px;
  break-after: avoid;
  page-break-after: avoid;
}
.page-header {
  display: flex; justify-content: space-between; align-items: flex-end;
  border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 10px;
  font-size: 8pt; font-weight: bold; letter-spacing: 0.4px;
  break-after: avoid;
  page-break-after: avoid;
}
/* Keeps CID header + section ribbon together and glued to the content that follows */
.pdf-section-intro {
  break-inside: avoid;
  page-break-inside: avoid;
}
.pdf-section-intro + * {
  break-before: avoid;
  page-break-before: avoid;
}
.section-banner + .section-title {
  break-before: avoid;
  page-break-before: avoid;
}
.section-banner {
  font-size: 11pt;
  font-weight: bold;
  letter-spacing: 0.6px;
  color: #fff;
  background: #111;
  padding: 6px 10px;
  margin: 0 0 10px 0;
  border-radius: 2px;
  break-after: avoid;
  page-break-after: avoid;
}
.lbl { font-size: 7pt; font-weight: bold; color: #333; margin-bottom: 2px; letter-spacing: 0.3px; }
.chkbox {
  display: inline-block; min-width: 13px; height: 13px;
  border: 1px solid #000; margin-right: 3px; text-align: center;
  line-height: 13px; font-size: 9pt; vertical-align: middle;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.chkbox-on { font-weight: bold; font-family: Arial, Helvetica, sans-serif; }
.chk-mark {
  display: inline-block;
  font-weight: bold;
  font-size: 10pt;
  line-height: 1;
  color: #000;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
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
  orphans: 3;
  widows: 3;
  break-inside: avoid;
  page-break-inside: avoid;
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
  page-break-after: always;
  break-after: page;
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
/* Same inset as api/report-pdf.js — @page ensures margins apply on every printed sheet (page 2+, not only the cover). */
@page { size: A4; margin: ${pdfPageMarginCssString()}; }
@media print { .page-break { page-break-before: always; } }
`;

// ── Page chrome helpers ────────────────────────────────────────────────────
/** FORM 0001 (CID/DDMMYY) — must match Puppeteer header (`buildPdfHeaderTemplate`). */
export function pdfFormIdFromReport(r) {
  const d = r?.date_of_offense;
  const tail = d
    ? String(d).replace(/-/g, '').slice(6) +
      String(d).replace(/-/g, '').slice(4, 6) +
      String(d).slice(2, 4)
    : 'DDMMYY';
  return 'FORM 0001 (CID/' + tail + ')';
}

function sectionBanner(label) {
  return `<div class="section-banner">${esc(label)}</div>`;
}

/** Section ribbon only — CID strip repeats via Puppeteer header on every sheet. */
function pdfSectionIntro(bannerLabel) {
  return `<div class="pdf-section-intro">${sectionBanner(bannerLabel)}</div>`;
}

function pdfClosureIntro() {
  return `<div class="pdf-section-intro pdf-section-intro--closure">${sectionBanner(
    "G. Closure",
  )}<div class="section-title" style="margin-top:4px">Investigation closure</div></div>`;
}

// ── Main builder ───────────────────────────────────────────────────────────
export function buildPDFDocument(r) {
  const jurs = [
    ["LSPD", asPdfBool(r.jurisdiction_lspd)],
    ["SAST", asPdfBool(r.jurisdiction_sast)],
    ["LSCS", asPdfBool(r.jurisdiction_lscs)],
    ["STATE", asPdfBool(r.jurisdiction_state)],
  ]
    .map(([j, v]) => `${chk(v)}&nbsp;${j}`)
    .join(" &nbsp;&nbsp; ");

  let body = "";

  // ── COVER ──────────────────────────────────────────────────────────────
  const coverLogo = LOGO_SRC
    ? `<img class="cover-logo" src="${LOGO_SRC}" alt="CIB Logo"/>`
    : "";
  body += `<div class="page cover">
    ${coverLogo}
    <div class="cover-bureau">CENTRAL INVESTIGATION BUREAU</div>
    <div class="cover-state">STATE OF SAN ANDREAS</div>
    <div class="cover-title">INVESTIGATION REPORT</div>
    <div class="cover-case">Case: &ldquo;${esc(r.case_title || "Untitled")}&rdquo;</div>
  </div>`;

  // ── A. CLASSIFICATION (no extra page-break: cover already ends the sheet) ──
  body += `<div class="page-body">${pdfSectionIntro("A. Classification")}`;

  body += `<table class="pdf-solid-table"><tr>
    <td style="width:32%"><div class="lbl">1. CATEGORY</div>
      ${chk(strEqCI(r.category, "A"))}&nbsp;&nbsp;CATEGORY A <br/>
      ${chk(strEqCI(r.category, "B"))}&nbsp;&nbsp;CATEGORY B <br/>
      ${chk(strEqCI(r.category, "C"))}&nbsp;&nbsp;CATEGORY C <br/>
    </td>
    <td style="width:16%"><div class="lbl">2. CASE NO.</div>${esc(r.case_number || "")}</td>
    <td><div class="lbl">3. HIGHEST TYPE OF OFFENSE OR INCIDENT</div>${esc(r.offense_type || "")}</td>
  </tr></table>`;

  body += `<table class="pdf-solid-table"><tr>
    <td style="width:20%"><div class="lbl">4. MDW INCIDENT NUMBER</div>${esc(r.mdw_incident_number || "")}</td>
    <td style="width:20%"><div class="lbl">5. BUILDING NUMBER</div>${esc(r.building_number || "")}</td>
    <td><div class="lbl">6. ADDRESS</div>${esc(r.address || "")}</td>
  </tr></table>`;

  body += `<table class="pdf-solid-table"><tr>
    <td style="width:16%"><div class="lbl">7. NAME OF BUREAU</div>${esc(r.bureau_name || "CID")}</td>
    <td style="width:16%"><div class="lbl">8. AGENCY/BUREAU CODE</div>${esc(r.agency_code || "")}</td>
    <td><div class="lbl">9. SPECIFIC LOCATION</div>${esc(r.specific_location || "")}</td>
  </tr></table>`;

  body += `<table class="pdf-solid-table"><tr>
    <td style="width:20%"><div class="lbl">10. LOCATION CODE</div>${esc(r.location_code || "")}</td>
    <td style="width:20%"><div class="lbl">11a. DATE OF OFFENSE/INCIDENT</div>${fmtDate(r.date_of_offense)}</td>
    <td style="width:20%"><div class="lbl">11a. TIME OF OFFENSE/INCIDENT</div>${esc(r.time_of_offense || "")}</td>
    <td><div class="lbl">12. DAY</div>${esc(r.day_of_offense || "")}</td>
  </tr></table>`;

  body += `<table class="pdf-solid-table"><tr>
    <td style="width:25%"><div class="lbl">13a. DATE REPORTED</div>${fmtDate(r.date_reported)}</td>
    <td style="width:20%"><div class="lbl">13b. DAY</div>${esc(r.day_reported || "")}</td>
    <td><div class="lbl">14. JURISDICTION (X)</div>${jurs}</td>
  </tr></table>`;

  body += `<table class="pdf-solid-table"><tr>
    <td><div class="lbl">15. LEAD INVESTIGATORS</div>${esc(normalizeDetectiveRankRoman(r.lead_investigators || ""))}</td>
    <td><div class="lbl">16a. PROSECUTOR</div>${esc(r.prosecutor || "TBA")}</td>
    <td style="width:18%"><div class="lbl">16b. TIME START</div>${fmtDate(r.prosecutor_time_start)}</td>
    <td style="width:18%"><div class="lbl">16c. TIME END</div>${fmtDate(r.prosecutor_time_end)}</td>
  </tr></table>`;

  body += `<table class="pdf-solid-table"><tr>
    <td><div class="lbl">FIRST RESPONDER (NAME)</div>${esc(r.first_responder_name || "")}</td>
    <td><div class="lbl">FIRST RESPONDER (OCCUPATION)</div>${esc(r.first_responder_occupation || "")}</td>
  </tr><tr>
    <td><div class="lbl">MEDIC INVOLVED (NAME)</div>${esc(r.medic_involved_name || "")}</td>
    <td><div class="lbl">MEDIC INVOLVED (ROLE)</div>${esc(r.medic_involved_role || "")}</td>
  </tr></table>`;

  // 17. Victims summary — each victim row-group stays on one sheet when possible
  if (r.victims && r.victims.length) {
    body += `<br/><div class="lbl" style="font-size:9pt">17. VICTIM(S)</div>
    <table class="pdf-summary-table"><thead><tr><th>ID CODE (a)</th><th>IDENTIFICATION (b)</th><th>AGE (c)</th><th>SEX (d)</th><th>RACE (e)</th><th>TELEPHONE (f)</th><th>Welfare, Occupation</th></tr></thead>`;
    r.victims.forEach((v) => {
      body += `<tbody class="pdf-row-group"><tr>
      <td>${esc(v.id_code || "")}</td><td>${esc(v.full_name || "")}</td><td>${esc(v.age || "")}</td><td>${esc(v.sex || "")}</td><td>${esc(v.race || "")}</td><td>${esc(v.telephone || "-")}</td><td>${esc(v.welfare_occupation || "")}</td></tr>
      <tr><td colspan="7" style="font-size:7.5pt;color:#444">Cause of death: ${esc(v.cause_of_death || "—")} &nbsp;|&nbsp; Cause of injury: ${esc(v.cause_of_injury || "—")}<br/>
      Family / contact: ${esc(v.family_contact_name || "—")} &nbsp; ${esc(v.family_contact_phone || "")}<br/>
      Medical debrief: ${esc(v.medical_debrief || v.notes || "—")}</td></tr>
      </tbody>`;
    });
    body += `</table>`;
  }

  // 18. Suspects summary
  if (r.suspects && r.suspects.length) {
    body += `<br/><div class="lbl" style="font-size:9pt">18. SUSPECT(S)</div>
    <table class="pdf-summary-table"><thead><tr><th>ID CODE (a)</th><th>IDENTIFICATION (b)</th><th>AGE (c)</th><th>SEX (d)</th><th>RACE (e)</th><th>TELEPHONE (f)</th><th>Status, Welfare, Occupation</th></tr></thead>`;
    r.suspects.forEach((s) => {
      body += `<tbody class="pdf-row-group"><tr>
      <td>${esc(s.id_code || "")}</td><td>${esc(s.full_name || "")}</td><td>${esc(s.age || "")}</td><td>${esc(s.sex || "")}</td><td>${esc(s.race || "")}</td><td>${esc(s.telephone || "-")}</td><td>${esc(s.welfare_occupation || "")}</td></tr>
      <tr><td colspan="7" style="font-size:7.5pt;color:#444">Affiliation: ${esc(s.affiliation || "—")} &nbsp;|&nbsp; Phone: ${esc(s.telephone || "—")}<br/>
      Reason of suspicion: ${esc(s.reason_of_suspicion || "—")}</td></tr>
      <tr><td colspan="7" style="font-size:7.5pt;color:#444">Interrogations: ${esc(s.interrogation_url || "-")}</td></tr>
      </tbody>`;
    });
    body += `</table>`;
  }

  // 19-20 — individual checkboxes matching the form
  body += `<table class="pdf-solid-table" style="margin-top:8px"><tr>
    <td style="width:50%;vertical-align:top">
      <div class="lbl">19. SUSPECT STATUS</div>
      <div style="font-size:8.5pt;line-height:1.9">
        ${chk(strEqCI(r.suspect_status, "NOT_IDENTIFIED"))}&nbsp;a. NOT IDENTIFIED<br/>
        ${chk(strEqCI(r.suspect_status, "GOVT_EMPLOYEE"))}&nbsp;b. GOVERNMENT EMPLOYEE<br/>
        ${chk(strEqCI(r.suspect_status, "GOVT_CONTRACT"))}&nbsp;c. GOVERNMENT CONTRACT<br/>
        ${chk(strEqCI(r.suspect_status, "CITATION"))}&nbsp;d. CITATION ISSUED<br/>
        ${chk(strEqCI(r.suspect_status, "NON_GOVT"))}&nbsp;d. NON-GOVERNMENT EMPLOYEE<br/>
        ${chk(strEqCI(r.suspect_status, "NA"))}&nbsp;e. N/A
      </div>
      ${r.suspect_notes ? `<div style="font-size:8pt;margin-top:4px">Notes:<br/>${esc(r.suspect_notes)}</div>` : ""}
    </td>
    <td style="vertical-align:top">
      <div class="lbl">20. DISPOSITION OF SUSPECT</div>
      <div style="font-size:8.5pt;line-height:1.9">
        ${chk(strEqCI(r.suspect_disposition, "ARRESTED"))}&nbsp;a. ARRESTED<br/>
        ${chk(strEqCI(r.suspect_disposition, "NOT_ARRESTED"))}&nbsp;b. NOT ARRESTED<br/>
        ${chk(strEqCI(r.suspect_disposition, "RELEASED"))}&nbsp;c. RELEASED<br/>
        ${chk(strEqCI(r.suspect_disposition, "NA"))}&nbsp;d. N/A
      </div>
    </td>
  </tr></table>`;
  body += `</div>`;

  // ── SECTION B: DEBRIEF ──────────────────────────────────────────────────
  const hasDebrief = r.debrief_entries && r.debrief_entries.length;
  const hasIncidentPad =
    !!(r.incident_report_optional && String(r.incident_report_optional).trim()) ||
    !!(r.incident_report_written_by && String(r.incident_report_written_by).trim());
  if (hasDebrief || hasIncidentPad) {
    body += `<div class="page page-break"><div class="page-body">${pdfSectionIntro(
      "B. Debrief of Incident",
    )}`;
    if (hasIncidentPad) {
      body += `<div class="print-keep" style="margin-bottom:12px">`;
      body += `<table class="pdf-solid-table"><tr>
        <td><div class="lbl">Incident report (optional)</div><div class="narrative">${esc(r.incident_report_optional || "")}</div></td>
      </tr><tr>
        <td><div class="lbl">Written by</div>${esc(r.incident_report_written_by || "")}</td>
      </tr></table></div>`;
    }
    if (hasDebrief) {
      r.debrief_entries.forEach((d, i) => {
        body += `<div class="debrief-entry-block">`;
        body += `<table class="compact-avoid pdf-solid-table"><tr>
        <td style="width:40%"><div class="lbl">${i + 1}a. TITLE</div>${esc(d.title || "")}</td>
        <td><div class="lbl">b. DATE OF INCIDENT</div>${fmtDate(d.date_of_incident)}</td>
      </tr><tr><td colspan="2"><div class="lbl">Entry</div><div class="narrative">${esc(d.content || "")}</div></td></tr></table>`;
        body += `</div>`;
      });
    }
    body += `</div>`;
    body += `</div>`;
  }

  // ── SECTION C: SUSPECTS DETAIL (continuous flow; multiple suspects per sheet when space allows) ──
  if (r.suspects && r.suspects.length) {
    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    body += `<div class="page page-break"><div class="page-body">${pdfSectionIntro("C. Suspect")}`;
    r.suspects.forEach((s, i) => {
      const L = (n) => ALPHA[i * 5 + n]; // 5 fields per suspect, progressive letters
      body += `<div class="suspect-detail-block">`;
      body += `<table class="pdf-solid-table suspect-detail-table"><tr><td colspan="2" class="pdf-id-row">Suspect ID: ${esc(s.id_code || "s." + (i + 1))}</td></tr><tr>
        <td style="width:60%;vertical-align:top;padding:8px">
          <table class="compact-avoid" style="border:none;width:100%"><tr>
            <td style="border:none"><div class="lbl">${L(0)}. Name</div>${esc(s.full_name || "")}</td>
            <td style="border:none"><div class="lbl">${L(1)}. Description</div>${esc(s.description || "")}</td>
          </tr><tr>
            <td style="border:none"><div class="lbl">${L(2)}. DOB</div>${fmtDate(s.dob)}</td>
            <td style="border:none"><div class="lbl">${L(3)}. SEX</div>${esc(s.sex || "")}</td>
          </tr></table>
          <div class="lbl" style="margin-top:8px">${L(4)}. Interrogation</div>
          <div style="font-size:8pt;margin:4px 0">Interrogation: &nbsp;${s.interrogation_url ? `<a href="${esc(s.interrogation_url)}">${esc(s.interrogation_url)}</a>` : ""}</div>
          <div class="narrative">${esc(s.interrogation_summary || "")}</div>
        </td>
        <td style="width:40%;vertical-align:top;text-align:center;padding:8px">${pdfFramedPhotoHtml(
          s.mugshot_url,
          s.mugshot_orientation || "portrait",
          s.mugshot_crop,
          120,
          150,
          150,
          120,
          "&ldquo;SUSPECT MUGSHOT/<br/>AVAILABLE PICTURE&rdquo;",
        )}</td>
      </tr><tr><td colspan="2" style="padding:6px 8px">
        <table class="pdf-solid-table" style="margin:0;width:100%"><tr>
        <td style="width:35%"><div class="lbl">Affiliation</div>${esc(s.affiliation || "")}</td>
        <td style="width:20%"><div class="lbl">Telephone</div>${esc(s.telephone || "")}</td>
        <td><div class="lbl">Reason of suspicion</div>${esc(s.reason_of_suspicion || "")}</td>
      </tr></table>
      </td></tr></table>`;
      body += `</div>`;
    });
    body += `</div>`;
    body += `</div>`;
  }

  // ── SECTION D: VICTIMS DETAIL ───────────────────────────────────────────
  if (r.victims && r.victims.length) {
    body += `<div class="page page-break"><div class="page-body">${pdfSectionIntro("D. Victim")}`;
    r.victims.forEach((v, i) => {
      const vid = esc(v.id_code || "v." + (i + 1));
      body += `<div class="victim-detail-block">`;
      body += `<table class="pdf-solid-table victim-detail-table"><tr><td colspan="2" class="pdf-id-row">Victim ID: ${vid}</td></tr><tr>
        <td style="vertical-align:top;padding:8px">
          <table class="pdf-solid-table" style="width:100%;margin:0"><tr>
        <td><div class="lbl">IDENTIFICATION (a)</div>
          First, Last Name, AKA<br/><strong>${esc(v.full_name || "")}</strong>
        </td>
        <td style="width:10%"><div class="lbl">AGE (c)</div>${esc(v.age || "")}</td>
        <td style="width:8%"><div class="lbl">SEX (d)</div>${esc(v.sex || "")}</td>
        <td style="width:10%"><div class="lbl">RACE (e)</div>${esc(v.race || "")}</td>
        <td style="width:16%"><div class="lbl">TELEPHONE (f)</div>${esc(v.telephone || "-")}</td>
      </tr></table>
        </td>
        <td rowspan="6" style="width:38%;vertical-align:top;text-align:center;padding:8px">${pdfFramedPhotoHtml(
          v.photo_url,
          v.photo_orientation || "portrait",
          v.photo_crop,
          120,
          150,
          150,
          120,
          "&ldquo;VICTIM PHOTO/<br/>AVAILABLE PICTURE&rdquo;",
        )}</td>
      </tr><tr><td style="padding:8px"><div class="lbl">Welfare, Occupation</div>${esc(v.welfare_occupation || "")}</td></tr>
      <tr><td style="padding:8px"><div class="lbl">Cause of death</div>${esc(v.cause_of_death || "—")}</td></tr>
      <tr><td style="padding:8px"><div class="lbl">Cause of injury</div>${esc(v.cause_of_injury || "—")}</td></tr>
      <tr><td style="padding:8px"><table class="pdf-solid-table" style="width:100%;margin:0"><tr>
        <td style="width:50%"><div class="lbl">Family / contact (name)</div>${esc(v.family_contact_name || "—")}</td>
        <td style="width:50%"><div class="lbl">Family / contact (phone)</div>${esc(v.family_contact_phone || "—")}</td>
      </tr></table></td></tr>
      <tr><td style="padding:8px"><div class="lbl">Medical debrief</div><div class="narrative">${esc(v.medical_debrief || v.notes || "")}</div></td></tr>`;
      if (v.autopsy_by || v.autopsy_summary) {
        body += `<tr><td colspan="2" style="padding:8px"><table class="pdf-solid-table" style="margin:0;width:100%"><tr>
          <td><div class="lbl">AUTOPSY (g)</div>
            <div style="font-size:8pt;margin:4px 0">Autopsy Report &ndash; By: <strong>${esc(v.autopsy_by || "")}</strong></div>
          </td>
        </tr></table><div class="narrative" style="margin-top:6px">${esc(v.autopsy_summary || "")}</div></td></tr>`;
      }
      body += `</table></div>`;
    });
    body += `</div>`;
    body += `</div>`;
  }

  // ── SECTION E: WITNESSES ────────────────────────────────────────────────
  if (r.witnesses && r.witnesses.length) {
    body += `<div class="page page-break"><div class="page-body">${pdfSectionIntro(
      "E. Witness affidavits",
    )}`;
    r.witnesses.forEach((w) => {
      body += `<div class="witness-affidavit-block">`;
      body += `<table class="compact-avoid pdf-solid-table witness-affidavit-table"><tr>
          <td style="width:8%"><div class="lbl">No.</div>${esc(w.id_code || "")}</td>
          <td colspan="3" style="font-weight:bold;font-size:10pt">AFFIDAVIT</td>
        </tr><tr>
          <td></td>
          <td style="width:25%"><div class="lbl">a. Name</div>${esc(w.full_name || "")}</td>
          <td style="width:20%"><div class="lbl">b. Witness ID Code</div>${esc(w.id_code || "")}</td>
          <td><div class="lbl">c. Status</div>${esc(w.status || "")}</td>
        </tr><tr>
          <td></td>
          <td><div class="lbl">d. Welfare</div>${esc(w.welfare || "")}</td>
          <td colspan="2"><div class="lbl">e. Occupation</div>${esc(witnessOccupation(w))}</td>
        </tr>`;
      if (asPdfBool(w.is_expert)) {
        body += `<tr><td></td><td colspan="3"><div class="lbl">Expert witness</div>${chk(true)} &nbsp; ${esc(w.expertise || "")}</td></tr>`;
      }
      body += `<tr><td colspan="4"><div class="lbl">f. Content</div><div class="narrative">${esc(w.content || "")}</div></td></tr>`;
      body += `<tr><td colspan="4" class="witness-declaration-cell">${esc(WITNESS_TRUTH_DECLARATION)}</td></tr>`;
      body += `<tr class="witness-sign-row"><td colspan="4">[${esc(w.full_name || "")}]</td></tr>`;
      body += `</table></div>`;
    });
    body += `</div>`;
    body += `</div>`;
  }

  // ── SECTION F: EVIDENCE ───────────────────────────────────────────────────
  if (r.evidences && r.evidences.length) {
    body += `<div class="page page-break"><div class="page-body">${pdfSectionIntro("F. Evidence")}`;
    r.evidences.forEach((e, evidIdx) => {
      body += `<div class="evidence-card-block">`;
      body += `<table class="pdf-solid-table pdf-evidence-split-table"><tr><td colspan="2" class="pdf-id-row">Evidence ID: ${esc(e.id_code || "e." + (evidIdx + 1))}</td></tr><tr>
        <td class="pdf-evidence-fields-cell">
          <table class="compact-avoid" style="width:100%"><tr>
            <td colspan="3"><div class="lbl">a. NAME OF EVIDENCE</div>${esc(e.name || "")}</td>
          </tr><tr>
            <td style="width:34%"><div class="lbl">b. EVIDENCE WAS</div>${esc(evidenceWas(e))}</td>
            <td style="width:33%"><div class="lbl">c. STATUS OF EVIDENCE</div>${esc(e.evidence_status || "")}</td>
            <td style="width:33%"><div class="lbl">d. DATE OF RETRIEVAL</div>${fmtDate(e.date_of_retrieval)}</td>
          </tr></table>
          <div class="lbl" style="margin-top:8px">Summary of evidences</div>
          <div class="narrative">${esc(e.summary || "")}</div>
        </td>
        <td class="pdf-evidence-photo-cell"><div class="pdf-evidence-photo-stack">
          <div class="lbl">l. IMAGE (${esc(evidenceCropAspectLabel(e))})</div>
          ${pdfEvidencePhotoFillHtml(
            e.image_url,
            e.image_crop,
            "&ldquo;EXHIBIT PHOTO/<br/>AVAILABLE PICTURE&rdquo;",
          )}
        </div></td>
      </tr></table>`;
      body += `</div>`;
    });
    body += `</div>`;
    body += `</div>`;
  }

  // ── SECTION G: CLOSURE ──────────────────────────────────────────────────
  body += `<div class="page page-break"><div class="page-body">${pdfClosureIntro()}`;
  if (r.closure_summary) {
    body += `<div class="print-keep"><div class="lbl">I. Summary of Investigation</div>`;
    body += `<div class="narrative">${esc(r.closure_summary)}</div></div><br/>`;
  }
  if (r.closure_forensic) {
    body += `<div class="print-keep"><div class="lbl">II. Forensic Findings and Cause of Death</div>`;
    body += `<div class="narrative">${esc(r.closure_forensic)}</div></div><br/>`;
  }
  if (r.closure_suspect_id) {
    body += `<div class="print-keep"><div class="lbl">III. Suspect Identification and Culpability</div>`;
    body += `<div class="narrative">${esc(r.closure_suspect_id)}</div></div><br/>`;
  }
  if (r.closure_final_disposition) {
    body += `<div class="print-keep"><div class="lbl">IV. Final Disposition</div>`;
    body += `<div class="narrative">${esc(r.closure_final_disposition)}</div></div>`;
  }

  body += `<div class="closure-forms-wrap">`;

  body += `<table class="closure-table" style="margin-top:12px"><tr>
    <td style="width:20%"><div class="lbl">24a. TIME RECEIVED</div>${fmtDate(r.closure_time_received)}</td>
    <td style="width:20%"><div class="lbl">24b. TIME ARRIVED</div>${fmtDate(r.closure_time_arrived)}</td>
    <td style="width:18%"><div class="lbl">a. TYPE</div>
      ${chk(strEqCI(r.closure_type, "CID"))}&nbsp;CID &nbsp;&nbsp;
      ${chk(strEqCI(r.closure_type, "GRD"))}&nbsp;GRD
    </td>
    <td><div class="lbl">b. SIGNATURE &mdash; d. DATE</div>${fmtDate(r.closure_date)}</td>
    <td style="width:20%"><div class="lbl">c. RETURNED TO SERVICE</div>${fmtDate(r.closure_returned_to_service)}</td>
  </tr><tr>
    <td colspan="2"><div class="lbl">c. NAME</div>${esc(normalizeDetectiveRankRoman(r.closure_detective_name || ""))}</td>
    <td colspan="3"></td>
  </tr></table>`;

  body += `<table class="closure-table" style="margin-top:8px"><tr>
    <td><div class="lbl">26. CASE REFERRED TO</div>
      <div style="font-size:8.5pt;line-height:1.8">
        ${chk(referredIncludes(r, "LSPD"))}&nbsp;a. LSPD &nbsp;
        ${chk(referredIncludes(r, "LSCS"))}&nbsp;b. LSCS &nbsp;
        ${chk(referredIncludes(r, "SAST"))}&nbsp;c. SAST<br/>
        ${chk(referredIncludes(r, "DOJ"))}&nbsp;d. DOJ &nbsp;
        ${chk(referredIncludes(r, "DOC"))}&nbsp;e. DOC &nbsp;
        ${chk(referredIncludes(r, "NA"))}&nbsp;f. N/A
      </div>
    </td>
    <td><div class="lbl">27. CASE STATUS</div>
      <div style="font-size:8.5pt;line-height:1.8">
        ${chk(strEqCI(r.case_status, "OPEN"))}&nbsp;a. OPEN<br/>
        ${chk(strEqCI(r.case_status, "CLOSED"))}&nbsp;b. CLOSED<br/>
        ${chk(strEqCI(r.case_status, "COLD"))}&nbsp;c. COLD
      </div>
    </td>
    <td><div class="lbl">28. PROSECUTOR</div>
      a. Name: ${esc(r.prosecutor_final_name || "-")}<br/>
      c. Occupation: ${esc(r.prosecutor_final_occupation || "-")}
    </td>
  </tr></table>`;

  body += `<table class="closure-table" style="margin-top:8px"><tr>
    <td colspan="3"><div class="lbl">29. DETECTIVE STATUS</div>
      <table style="width:100%;border-collapse:collapse;margin-top:6px;border:none"><tr style="border:none">
    <td style="vertical-align:top;border:1px solid #000;width:33%"><div class="lbl">b. HOW CLOSED</div>
      ${chk(strEqCI(r.detective_how_closed, "INACTIVE"))}&nbsp;INACTIVE &nbsp;
      ${chk(strEqCI(r.detective_how_closed, "ARREST"))}&nbsp;ARREST &nbsp;
      ${chk(strEqCI(r.detective_how_closed, "OTHER"))}&nbsp;OTHER MEANS
    </td>
    <td style="vertical-align:top;border:1px solid #000;width:34%">
      ${chk(asPdfBool(r.detective_suspect_developed))}&nbsp;Suspect Developed &nbsp;
      ${chk(asPdfBool(r.detective_suspect_arrested))}&nbsp;Suspect Arrested<br/>
      ${chk(asPdfBool(r.detective_entered_forensics))}&nbsp;Entered Forensics &nbsp;
      ${chk(asPdfBool(r.detective_evidence_recovered))}&nbsp;Evidence Recovered<br/>
      ${chk(asPdfBool(r.detective_cleared_forensics))}&nbsp;Cleared Forensics
    </td>
    <td style="vertical-align:top;border:1px solid #000;width:33%">
      <div class="lbl">f. Value of Property</div>${esc(r.detective_value_of_property || "N/A")}<br/>
      <div class="lbl" style="margin-top:4px">h. Referred To</div>${esc(r.detective_referred_to || "-")}<br/>
      <div class="lbl" style="margin-top:4px">i. Date Referral Accepted</div>${fmtDate(r.detective_date_referral)}
    </td>
      </tr></table>
    </td>
  </tr></table>`;
  body += `</div>`;
  body += `</div>`;
  body += `</div>`;

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>CID Investigation Report &mdash; ${esc(r.case_title || "Draft")}</title>
<style>${CSS}</style>
</head><body>${watermarkBodyHtml()}<div class="pdf-root">${body}</div></body></html>`;
}

/** Smoke-test payload for ?id=demo — empty fields; keys align with form/API (no sample narrative). */
export const DEMO_REPORT = {
  case_number: null,
  case_title: null,
  category: "A",
  offense_type: null,
  mdw_incident_number: null,
  building_number: null,
  address: null,
  bureau_name: "CID",
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
  closure_type: "CID",
  closure_detective_name: null,
  closure_date: null,
  closure_returned_to_service: null,
  case_referred_to: null,
  case_status: "OPEN",
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
  first_responder_name: null,
  first_responder_occupation: null,
  medic_involved_name: null,
  medic_involved_role: null,
  incident_report_optional: null,
  incident_report_written_by: null,
  debrief_entries: [],
  victims: [],
  suspects: [],
  witnesses: [],
  evidences: [],
};
