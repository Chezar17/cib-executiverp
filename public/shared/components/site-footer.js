import { FOOTER_COLUMNS, FOOTER_LEGAL } from '../routes/site-routes.js'

function buildFooterHtml() {
  const cols = FOOTER_COLUMNS.map((col) => `
    <div class="footer-col">
      <h4>${col.heading}</h4>
      <ul>
        ${col.links.map((l) => `<li><a href="${l.href}">${l.label}</a></li>`).join('\n        ')}
      </ul>
    </div>`).join('\n  ')

  return `
<footer>
  <div class="footer-top">
    <div class="footer-brand">
      <img src="images/cib-logo.png" alt="CIB" onerror="this.style.display='none'"/>
      <p>Central Investigation Bureau</p>
      <small>A division of the San Andreas Law Enforcement Officer.<br>
        Serving and protecting the state of San Andreas.<br>
        All investigations are conducted under the jurisdiction<br>
        of the Law Enforcement and applicable federal statutes.
      </small>
    </div>
    ${cols}
  </div>
  <div class="footer-bottom">
    <p>${FOOTER_LEGAL}</p>
    <div class="classified-stamp">EXECUTIVE RP</div>
  </div>
</footer>`
}

function mountSharedFooter() {
  const mountPoint = document.querySelector('[data-shared-footer]')
  if (!mountPoint) return
  mountPoint.outerHTML = buildFooterHtml()
}

mountSharedFooter()
