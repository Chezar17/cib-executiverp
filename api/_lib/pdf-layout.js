/**
 * Shared PDF margin + Puppeteer header/footer chrome for CID investigation reports.
 * Keep CSS @page and page.pdf() in sync so every sheet (not only page 1) gets the same inset.
 */
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Same file as pdf-html cover logo — embedded in footer template (Chromium needs data URL). */
const FOOTER_LOGO_PATH = path.join(__dirname, '../../public/images/cib-logo-pdf.png')

/** Bottom slightly taller than default text margins — footer row carries larger CIB wordmark. */
export const PDF_MARGIN_MM = Object.freeze({
  top: '20mm',
  bottom: '28mm',
  left: '15mm',
  right: '15mm',
})

/** Puppeteer margin object (spread into page.pdf). */
export function pdfPuppeteerMargins() {
  return { ...PDF_MARGIN_MM }
}

/** CSS @page shorthand: top right bottom left — must match PDF_MARGIN_MM. */
export function pdfPageMarginCssString() {
  const m = PDF_MARGIN_MM
  return `${m.top} ${m.right} ${m.bottom} ${m.left}`
}

export function loadFooterLogoDataUrl() {
  try {
    if (existsSync(FOOTER_LOGO_PATH)) {
      const buf = readFileSync(FOOTER_LOGO_PATH)
      return 'data:image/png;base64,' + buf.toString('base64')
    }
  } catch (_) {
    /* ignore */
  }
  return null
}

/** Minimal header slot for Chromium PDF (avoid layout quirks). */
export const PDF_HEADER_TEMPLATE =
  '<div style="width:100%;height:1px;margin:0;padding:0;font-size:1px;line-height:1px;overflow:hidden;"></div>'

/** Wordmark height in footer — fills strip visually. */
const FOOTER_LOGO_HEIGHT = '13mm'

/** Tight gap between logo image and bureau text (px — footer template uses screen px). */
const FOOTER_LOGO_TEXT_GAP = '4px'

/**
 * Footer: CIB logo + bureau line — left/right inset matches PDF_MARGIN_MM; logo sits tight to following text.
 */
export function buildPdfFooterTemplate(logoDataUrl) {
  const padL = PDF_MARGIN_MM.left
  const padR = PDF_MARGIN_MM.right
  const logoCell = logoDataUrl
    ? `<td style="vertical-align:bottom;padding:0 ${FOOTER_LOGO_TEXT_GAP} 0 0;line-height:0;width:1%;white-space:nowrap;">
        <img src="${logoDataUrl}" alt="CIB" style="height:${FOOTER_LOGO_HEIGHT};width:auto;display:block;margin:0;padding:0;border:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"/>
      </td>`
    : ''

  return `
<div style="width:100%;box-sizing:border-box;margin:0;padding:0 ${padR} 0 ${padL};font-size:8px;line-height:1.35;font-family:Arial,Helvetica,sans-serif;color:#222;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
  <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border-top:1px solid #aaa;">
    <tr>
      ${logoCell}
      <td style="vertical-align:middle;padding:10px 12px 10px 0;text-align:left;font-weight:bold;letter-spacing:0.35px;">CENTRAL INVESTIGATION BUREAU — STATE OF SAN ANDREAS</td>
      <td style="vertical-align:middle;padding:10px 0 10px 12px;text-align:right;white-space:nowrap;width:1%;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></td>
    </tr>
  </table>
</div>
`.trim()
}
