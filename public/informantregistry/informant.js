// ── AUTH + CLOCK + IDLE TIMEOUT ───────────────────────────────
  PortalAuth.init({
    badgeEls: ['badgeDisplay'],
    clockEl:  'liveClock',
    onReady:  loadInformants,
  });

  function logout() { PortalAuth.logout(); }

  // ══════════════════════════════════════════════════════════════
  //  CIB INFORMANT REGISTRY — FULL CRUD ENGINE
  //  Storage: Supabase database via /api/informants
  //  All changes are saved to the real database instantly.
  // ══════════════════════════════════════════════════════════════

  // ── Helpers ────────────────────────────────────────────────
  function getInitials(name) {
    if (!name) return '??';
    const p = name.trim().split(/\s+/);
    return p.length >= 2 ? (p[0][0] + p[p.length-1][0]).toUpperCase() : name.slice(0,2).toUpperCase();
  }
  function statusClass(s) {
    s = (s||'').toLowerCase();
    if (s === 'active')   return 'status-active';
    if (s === 'burned')   return 'status-burned';
    return 'status-inactive';
  }
  function topColor(s) {
    s = (s||'').toLowerCase();
    if (s === 'active')  return 'var(--green)';
    if (s === 'burned')  return 'var(--red-alert)';
    return 'var(--muted)';
  }

  function showToast(msg, type) {
    PortalAuth.showToast(msg, type || 'success', 'inf-toast');
  }

  // ── API helper — sends requests to your Vercel backend ────
  async function apiCall(method, body, queryId) {
    const token = sessionStorage.getItem('cib_token') || '';
    const url   = queryId ? `/api/informants?id=${queryId}` : '/api/informants';
    const opts  = {
      method,
      headers: {
        'Content-Type':    'application/json',
        'x-session-token': token
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }

  // ── Render a single card element ──────────────────────────
  // ── Render a single card element ──────────────────────────
  function toggleTask(btn) {
    const txt = btn.previousElementSibling;
    const expanded = txt.classList.toggle('expanded');
    btn.textContent = expanded ? '▲ Show less' : '▼ Show more';
  }

  function buildCard(r, index) {
    const div = document.createElement('div');
    div.className = 'informant-card';
    div.dataset.status  = (r.status||'').toLowerCase();
    div.dataset.handler = (r.handler||'').replace(/\s+/g,'_').toLowerCase();
    div.dataset.infId   = r.id;
    div.style.borderTopColor = topColor(r.status);
    div.style.animationDelay = Math.min((index||0) * 0.05, 0.6) + 's';

    let rowsHtml = '';
    if (r.handler) rowsHtml += `
      <div class="informant-row">
        <div class="informant-row-label">Handler</div>
        <div class="informant-row-value">${esc(r.handler)}</div>
      </div>`;
    if (r.gang) rowsHtml += `
      <div class="informant-row">
        <div class="informant-row-label">Affiliation</div>
        <div class="informant-row-value">${esc(r.gang)}</div>
      </div>`;

    if (r.task) {
      const long = r.task.length > 120;
      rowsHtml += `
      <div class="informant-row">
        <div class="informant-row-label">Current Task</div>
        <div class="inf-task-text${long ? '' : ' expanded'}">${esc(r.task)}</div>
        ${long ? `<button class="inf-task-toggle" onclick="toggleTask(this)">&#9660; Show more</button>` : ''}
      </div>`;
    }

    if (r.notes) rowsHtml += `
      <div class="informant-row">
        <div class="informant-row-label">Notes</div>
        <div class="informant-row-value" style="color:var(--gold-light);font-size:10px;font-style:italic;">${esc(r.notes)}</div>
      </div>`;

    let auditHtml = '';
    if (r.created_by || r.edited_by) {
      let a = '';
      if (r.created_by) a += `<div class="informant-row" style="padding:5px 0;"><div class="informant-row-label" style="color:#2a3a58;">Created by</div><div class="informant-row-value" style="color:#374f6e;font-size:9px;font-family:'Roboto Mono',monospace;">${esc(r.created_by)}</div></div>`;
      if (r.edited_by)  a += `<div class="informant-row" style="padding:5px 0;"><div class="informant-row-label" style="color:#2a3a58;">Last edited by</div><div class="informant-row-value" style="color:#374f6e;font-size:9px;font-family:'Roboto Mono',monospace;">${esc(r.edited_by)}</div></div>`;
      auditHtml = `<div class="informant-rows" style="padding-top:6px;margin-top:4px;border-top:1px solid #0d1828;">${a}</div>`;
    }

    const sc = statusClass(r.status);
    const canDelete = (r.status||'').toLowerCase() !== 'active';
    const deleteBtn = canDelete
      ? `<button class="inf-del-btn" onclick="deleteInformant(this)">&#10005; Delete</button>`
      : `<button class="inf-del-btn" disabled title="Set status to Inactive or Burned to delete" style="opacity:0.2;cursor:not-allowed;pointer-events:none;">&#10005; Delete</button>`;

    div.innerHTML = `
      <div class="informant-header">
        <div class="informant-avatar">${getInitials(r.name)}</div>
        <div style="min-width:0;flex:1;">
          <div class="informant-codename">${esc(r.name)}</div>
          <div class="informant-id">INF-ID: CIB-INF-${esc(r.code)}</div>
        </div>
      </div>
      <div class="informant-body">
        <div class="informant-rows">${rowsHtml}</div>
        ${auditHtml}
      </div>
      <div class="informant-footer">
        <div class="informant-status ${sc}"><div class="status-dot"></div> ${esc(r.status)}</div>
        <div class="inf-card-actions">
          <button class="inf-edit-btn" onclick="editInformant(this)">&#9998; Edit</button>
          ${deleteBtn}
        </div>
      </div>`;
    return div;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Render all cards from records array ───────────────────
  function renderAll(records) {
    const grid = document.getElementById('informant-grid');
    grid.innerHTML = '';
    const sorted = [...records].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    sorted.forEach((r, i) => grid.appendChild(buildCard(r, i)));
    updateInfStats(records);
  }

  // ── Stats update ──────────────────────────────────────────
  function updateInfStats(records) {
    const active   = records.filter(r => (r.status||'').toLowerCase() === 'active').length;
    const inactive = records.filter(r => (r.status||'').toLowerCase() === 'inactive').length;
    const burned   = records.filter(r => (r.status||'').toLowerCase() === 'burned').length;
    const els = document.querySelectorAll('.inf-stat-num');
    if (els[0]) els[0].textContent = active;
    if (els[1]) els[1].textContent = inactive;
    if (els[2]) els[2].textContent = burned;
    const sub = document.querySelector('.nx-section-sub');
    if (sub && sub.textContent.includes('registered')) {
      sub.textContent = sub.textContent.replace(/Total: \d+ registered/, `Total: ${records.length} registered`);
    }
    document.querySelectorAll('.inf-filter-btn').forEach(b => {
      const f = b.dataset.filter;
      if (f === 'all')      b.textContent = `All (${records.length})`;
      if (f === 'active')   b.textContent = `Active (${active})`;
      if (f === 'inactive') b.textContent = `Inactive (${inactive})`;
      if (f === 'burned')   b.textContent = `Burned (${burned})`;
    });
  }

  // ── Init — load from API (called by PortalAuth.init onReady) ─
  let RECORDS = [];

  async function loadInformants() {
    try {
      const result = await apiCall('GET');
      RECORDS = result.data || [];
      renderAll(RECORDS);
    } catch (err) {
      console.error('Failed to load informants:', err);
      showToast('Failed to load data from server', 'delete');
    }
    initFilters();
  }

  // ── Filter & Search ───────────────────────────────────────
  function initFilters() {
    const btns = document.querySelectorAll('.inf-filter-btn');
    let currentFilter = 'all';

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => {
          b.style.background  = 'transparent';
          b.style.color       = 'var(--muted)';
          b.style.borderColor = 'var(--navy-border)';
        });
        btn.style.background  = 'rgba(201,168,76,0.12)';
        btn.style.color       = 'var(--gold)';
        btn.style.borderColor = 'var(--gold)';
        currentFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    document.getElementById('inf-search').addEventListener('input', applyFilters);

    function applyFilters() {
      const q = document.getElementById('inf-search').value.toLowerCase().trim();
      let visible = 0;
      document.querySelectorAll('#informant-grid .informant-card').forEach(card => {
        const statusOk = currentFilter === 'all' || card.dataset.status === currentFilter;
        const textOk   = q === '' || card.innerText.toLowerCase().includes(q);
        const show = statusOk && textOk;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      document.getElementById('inf-no-results').style.display = visible === 0 ? 'block' : 'none';
    }
  }

  // ── Auto-generate next code from existing RECORDS ─────────
  function getNextCode() {
    let maxNum = 0;
    RECORDS.forEach(r => {
      const match = (r.code || '').match(/(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    return 'CIB-INF-C' + (maxNum + 1);
  }

  // ── MODAL — Open / Close ──────────────────────────────────
  function openInfModal(prefill) {
    const isEdit = !!prefill;
    document.getElementById('inf-modal-title').textContent = isEdit ? 'Edit Informant' : 'Add Informant';
    document.getElementById('inf-edit-id').value   = prefill?.id     || '';
    document.getElementById('inf-f-name').value    = prefill?.name   || '';
    document.getElementById('inf-f-status').value  = prefill?.status || 'Active';
    document.getElementById('inf-f-handler').value = prefill?.handler|| '';
    document.getElementById('inf-f-gang').value    = prefill?.gang   || '';
    document.getElementById('inf-f-task').value    = prefill?.task   || '';
    document.getElementById('inf-f-notes').value   = prefill?.notes  || '';

    const codeEl = document.getElementById('inf-f-code');
    if (isEdit) {
      codeEl.value = prefill.code || '';
    } else {
      codeEl.value = getNextCode();
    }

    document.getElementById('inf-modal').classList.add('open');
  }
  function closeInfModal() {
    document.getElementById('inf-modal').classList.remove('open');
  }

  // ── SAVE (Create or Update) ───────────────────────────────
  async function saveInformant() {
    // Strip the display prefix "CIB-INF-" — DB stores only the short code e.g. "C34"
    const rawCode = document.getElementById('inf-f-code').value.trim();
    const code    = rawCode.replace(/^CIB-INF-/i, '');
    const name   = document.getElementById('inf-f-name').value.trim();
    const status = document.getElementById('inf-f-status').value;

    if (!code) { document.getElementById('inf-f-code').focus(); return; }
    if (!name) { document.getElementById('inf-f-name').focus(); return; }

    const editId  = document.getElementById('inf-edit-id').value;
    const myBadge = sessionStorage.getItem('cib_badge') || 'Unknown';
    const record = {
      code, name, status,
      handler: document.getElementById('inf-f-handler').value.trim(),
      gang:    document.getElementById('inf-f-gang').value.trim(),
      task:    document.getElementById('inf-f-task').value.trim(),
      notes:   document.getElementById('inf-f-notes').value.trim(),
    };

    try {
      if (editId) {
        // UPDATE — log who edited it
        const result = await apiCall('PUT', { id: editId, ...record, edited_by: myBadge });
        const idx = RECORDS.findIndex(r => r.id === editId);
        if (idx > -1) RECORDS[idx] = result.data;
        showToast('Record updated — ' + name, 'edit');
      } else {
        // CREATE — log who created it
        const result = await apiCall('POST', { ...record, created_by: myBadge });
        RECORDS.push(result.data);
        showToast('New informant registered — ' + name, 'success');
      }
      renderAll(RECORDS);
      closeInfModal();
      initFilters();
    } catch (err) {
      console.error('Save error:', err);
      showToast('Failed to save — check console', 'delete');
    }
  }

  // ── EDIT — populate modal from card ──────────────────────
  function editInformant(btn) {
    const card = btn.closest('.informant-card');
    const id   = card.dataset.infId;
    const rec  = RECORDS.find(r => r.id === id);
    if (rec) openInfModal(rec);
  }

  // ── DELETE ────────────────────────────────────────────────
  let _pendingDeleteId = null;

  function deleteInformant(btn) {
    const card = btn.closest('.informant-card');
    _pendingDeleteId = card.dataset.infId;
    const rec = RECORDS.find(r => r.id === _pendingDeleteId);
    document.getElementById('inf-del-name-display').textContent = rec?.name || 'this informant';
    document.getElementById('inf-del-modal').classList.add('open');
  }
  function closeDelModal() {
    document.getElementById('inf-del-modal').classList.remove('open');
    _pendingDeleteId = null;
  }
  async function confirmDelete() {
    if (!_pendingDeleteId) return;
    const rec = RECORDS.find(r => r.id === _pendingDeleteId);
    try {
      const myBadge = sessionStorage.getItem('cib_badge') || 'Unknown';
      await apiCall('DELETE', { deleted_by: myBadge }, _pendingDeleteId);
      RECORDS = RECORDS.filter(r => r.id !== _pendingDeleteId);
      renderAll(RECORDS);
      closeDelModal();
      initFilters();
      showToast('Record deleted — ' + (rec?.name || ''), 'delete');
    } catch (err) {
      console.error('Delete error:', err);
      showToast('Failed to delete — check console', 'delete');
      closeDelModal();
    }
  }

  // Close modals on backdrop click
  document.getElementById('inf-modal').addEventListener('click', e => { if (e.target === document.getElementById('inf-modal')) closeInfModal(); });
  document.getElementById('inf-del-modal').addEventListener('click', e => { if (e.target === document.getElementById('inf-del-modal')) closeDelModal(); });

SiteUi.initPageFadeTransitions({ transitionMs: 400 })
SiteUi.initScrollReveal()