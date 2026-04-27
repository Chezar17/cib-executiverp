/* ============================================================
   reports.js – Investigation Reports landing page
   ============================================================ */
;(function () {
  'use strict'

  let allReports = []
  let pendingDeleteId = null

  // ── Bootstrap ───────────────────────────────────────────
  PortalAuth.init({
    loginHref:        '/login',
    badgeEls:  ['badgeDisplay'],
    clockEl:   'liveClock',
    gateElementId:    'access-gate',
    onReady: function () {
      document.getElementById('portalContent').style.display = 'block'
      loadReports()
    }
  })

  // ── Load reports ────────────────────────────────────────
  async function loadReports() {
    setTableBody('<tr><td colspan="8" class="loading-row">Loading reports...</td></tr>')
    try {
      const token = sessionStorage.getItem('cib_token')
      const res   = await fetch('/api/reports', {
        headers: { 'x-session-token': token }
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = await res.json()
      allReports = json.reports || []
      renderStats(allReports)
      renderTable(allReports)
    } catch (e) {
      setTableBody('<tr><td colspan="8" class="loading-row">Failed to load reports. Please try again.</td></tr>')
      PortalAuth.showToast('Failed to load reports: ' + e.message, 'error', 'toast-container')
    }
  }

  // ── Stats ────────────────────────────────────────────────
  function renderStats(rows) {
    document.getElementById('statTotal').textContent  = rows.length
    document.getElementById('statOpen').textContent   = rows.filter(r => r.case_status === 'OPEN').length
    document.getElementById('statClosed').textContent = rows.filter(r => r.case_status === 'CLOSED').length
    document.getElementById('statCold').textContent   = rows.filter(r => r.case_status === 'COLD').length
  }

  // ── Render table ────────────────────────────────────────
  function renderTable(rows) {
    if (!rows.length) {
      setTableBody('<tr><td colspan="8" class="loading-row">No investigation reports found.</td></tr>')
      document.getElementById('rowCount').textContent = '0 records'
      return
    }
    const html = rows.map(r => {
      const dateStr = r.date_of_offense ? formatDate(r.date_of_offense) : '&ndash;'
      const status  = r.case_status || 'OPEN'
      const cat     = r.category    || 'A'
      return `<tr>
        <td><span style="font-family:'Roboto Mono',monospace;color:var(--gold)">${esc(r.case_number || '&ndash;')}</span></td>
        <td>${esc(r.case_title || '&ndash;')}</td>
        <td><span class="badge badge-${cat.toLowerCase()}">${esc(cat)}</span></td>
        <td>${esc(r.offense_type || '&ndash;')}</td>
        <td style="font-family:'Roboto Mono',monospace;font-size:12px">${dateStr}</td>
        <td>${esc(r.lead_investigators || '&ndash;')}</td>
        <td><span class="badge badge-${status.toLowerCase()}">${status}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-icon view" title="View / Edit" onclick="editReport('${r.id}')">&#9998; Edit</button>
            <button class="btn-icon del"  title="Delete"      onclick="openDeleteModal('${r.id}')">&#128465;</button>
          </div>
        </td>
      </tr>`
    }).join('')
    setTableBody(html)
    document.getElementById('rowCount').textContent = rows.length + ' record' + (rows.length !== 1 ? 's' : '')
  }

  // ── Filter ───────────────────────────────────────────────
  window.filterTable = function () {
    const q      = (document.getElementById('searchInput').value || '').toLowerCase()
    const status = document.getElementById('statusFilter').value
    const filtered = allReports.filter(r => {
      const matchSearch = !q ||
        (r.case_number       || '').toLowerCase().includes(q) ||
        (r.case_title        || '').toLowerCase().includes(q) ||
        (r.offense_type      || '').toLowerCase().includes(q) ||
        (r.lead_investigators|| '').toLowerCase().includes(q)
      const matchStatus = !status || r.case_status === status
      return matchSearch && matchStatus
    })
    renderTable(filtered)
  }

  // ── Navigation ───────────────────────────────────────────
  window.editReport = function (id) {
    window.location.href = 'form/report-form.html?id=' + id
  }

  // ── Delete modal ────────────────────────────────────────
  window.openDeleteModal = function (id) {
    pendingDeleteId = id
    document.getElementById('deleteModal').style.display = 'flex'
  }
  window.closeDeleteModal = function () {
    pendingDeleteId = null
    document.getElementById('deleteModal').style.display = 'none'
  }
  window.confirmDelete = async function () {
    if (!pendingDeleteId) return
    try {
      const token = sessionStorage.getItem('cib_token')
      const res = await fetch('/api/reports/' + pendingDeleteId, {
        method: 'DELETE',
        headers: { 'x-session-token': token }
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      closeDeleteModal()
      PortalAuth.showToast('Report deleted.', 'success', 'toast-container')
      loadReports()
    } catch (e) {
      PortalAuth.showToast('Delete failed: ' + e.message, 'error', 'toast-container')
    }
  }

  // ── Helpers ──────────────────────────────────────────────
  function setTableBody(html) { document.getElementById('tableBody').innerHTML = html }

  function formatDate(d) {
    if (!d) return '&ndash;'
    const parts = d.split('-')
    if (parts.length !== 3) return d
    return parts[2] + '/' + parts[1] + '/' + parts[0]
  }

  function esc(s) {
    if (s === null || s === undefined) return ''
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#039;')
  }
})()
