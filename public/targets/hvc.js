// ══════════════════════════════════════════════════════════════
  //  CIB HVC REGISTRY — FULL CRUD ENGINE
  //  Storage: Supabase via /api/hvc
  // ══════════════════════════════════════════════════════════════

  // ── Auth + clock + idle timeout (via shared portal-auth.js) ──
  PortalAuth.init({
    badgeEls: ['badgeDisplay'],
    clockEl:  'liveClock',
    onReady:  loadHVC,
  });

  function logout() { PortalAuth.logout(); }

  function showToast(msg, type) {
    PortalAuth.showToast(msg, type || 'success', 'hvc-toast');
  }

  // ── API Helper ────────────────────────────────────────────────
  async function apiCall(method, body, queryId) {
    const token = sessionStorage.getItem('cib_token') || '';
    const url   = queryId ? `/api/hvc?id=${queryId}` : '/api/hvc';
    const opts  = { method, headers: { 'Content-Type': 'application/json', 'x-session-token': token } };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }

  // ── Helpers ───────────────────────────────────────────────────
  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function threatColor(t) {
    t = (t||'').toLowerCase();
    if (t === 'critical') return 'var(--threat-critical)';
    if (t === 'high')     return 'var(--threat-high)';
    if (t === 'medium')   return 'var(--threat-medium)';
    if (t === 'low')      return 'var(--threat-low)';
    return 'var(--muted)';
  }

  function warrantyClass(w) {
    w = (w||'').toLowerCase();
    if (w === 'active')  return 'warrant-active';
    if (w === 'cleared') return 'warrant-cleared';
    return 'warrant-none';
  }

  function warrantyLabel(w) {
    w = (w||'').toLowerCase();
    if (w === 'active')  return 'Active Warrant';
    if (w === 'cleared') return 'Cleared';
    return 'No Warrant';
  }

  function parseCrimes(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try { const p = JSON.parse(val); if (Array.isArray(p)) return p; } catch(e){}
    return val.split(/[,;]+/).map(s=>s.trim()).filter(Boolean);
  }

  // ── Build Card DOM element ─────────────────────────────────────
  function buildCard(r, seqNum) {
    const seqStr = String(seqNum || 0).padStart(3, '0');
    const hvcIdLabel = `CIB-HVC-${seqStr}`;

    const div = document.createElement('div');
    div.className = 'hvc-card';
    div.dataset.threat = (r.threat||'').toLowerCase();
    div.dataset.hvcId  = r.id;

    const crimes = parseCrimes(r.crimes);
    const crimeTags = crimes.map(c => `<span class="hvc-crime-tag">${esc(c)}</span>`).join('');

    const photoHtml = r.photo_url
      ? `<img src="${esc(r.photo_url)}" alt="${esc(r.name)}" style="width:100%;height:100%;object-fit:cover;object-position:top center;"/>`
      : `<div class="hvc-photo-placeholder"><svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg><div class="hvc-photo-placeholder-text">No Photo</div></div>`;

    const threatLvl = (r.threat||'unknown').toLowerCase();
    const wc  = warrantyClass(r.warrant_status);

    div.innerHTML = `
      <div class="hvc-photo-strip">
        ${photoHtml}
        <div class="hvc-threat-badge threat-badge-${threatLvl}">${esc(r.threat||'Unknown')}</div>
      </div>
      <div class="hvc-card-body">
        <div class="hvc-card-name">${esc(r.name)}</div>
        <div class="hvc-card-id">HVC-ID: ${hvcIdLabel}</div>
        ${r.bio ? `<div class="hvc-card-bio">${esc(r.bio)}</div>` : ''}
        <div class="hvc-card-rows">
          ${r.affiliation ? `<div class="hvc-card-row"><div class="hvc-card-row-label">Affiliation</div><div class="hvc-card-row-value">${esc(r.affiliation)}</div></div>` : ''}
          ${r.location    ? `<div class="hvc-card-row"><div class="hvc-card-row-label">Last Location</div><div class="hvc-card-row-value">${esc(r.location)}</div></div>` : ''}
          ${r.handler     ? `<div class="hvc-card-row"><div class="hvc-card-row-label">Handler</div><div class="hvc-card-row-value">${esc(r.handler)}</div></div>` : ''}
          ${crimes.length ? `<div class="hvc-card-row"><div class="hvc-card-row-label">Crimes</div><div class="hvc-crimes-list">${crimeTags}</div></div>` : ''}
        </div>
        ${r.notes ? `<div class="hvc-card-notes">${esc(r.notes)}</div>` : ''}
        <div class="hvc-warrant ${wc}"><div class="hvc-warrant-dot"></div> ${warrantyLabel(r.warrant_status)}</div>
        <div class="hvc-card-actions">
          <button class="hvc-edit-btn" onclick="editHvc(this)">✎ Edit</button>
          <button class="hvc-del-btn"  onclick="deleteHvc(this)">✕ Delete</button>
        </div>
      </div>`;

    // Click card body (not buttons) to open view modal
    div.querySelector('.hvc-card-body').addEventListener('click', e => {
      if (e.target.closest('.hvc-card-actions')) return;
      openViewModal(r.id);
    });

    return div;
  }

  // ── Render All ────────────────────────────────────────────────
  function renderAll(records) {
    const grid = document.getElementById('hvc-grid');
    grid.innerHTML = '';

    // Sort ALL records by created_at ascending so IDs are stable
    // even when filters show a subset
    const allSorted = [...RECORDS].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });
    // Map each record's real UUID → its permanent display number
    const seqMap = {};
    allSorted.forEach((r, i) => { seqMap[r.id] = i + 1; });

    records.forEach(r => grid.appendChild(buildCard(r, seqMap[r.id] || 0)));
    updateStats(records);
  }

  // ── Stats ─────────────────────────────────────────────────────
  function updateStats(records) {
    const count = t => records.filter(r=>(r.threat||'').toLowerCase()===t).length;
    const critical = count('critical'), high = count('high'), medium = count('medium'), low = count('low');
    document.getElementById('stat-critical').textContent = critical;
    document.getElementById('stat-high').textContent     = high;
    document.getElementById('stat-medium').textContent   = medium;
    document.getElementById('stat-low').textContent      = low;
    document.getElementById('hvc-section-sub').textContent =
      `Priority targets tracked by the Bureau · All identities classified · Total: ${records.length} registered`;
    document.querySelectorAll('.hvc-filter-btn').forEach(b => {
      const f = b.dataset.filter;
      if (f === 'all')      b.textContent = `All (${records.length})`;
      if (f === 'critical') b.textContent = `Critical (${critical})`;
      if (f === 'high')     b.textContent = `High (${high})`;
      if (f === 'medium')   b.textContent = `Medium (${medium})`;
      if (f === 'low')      b.textContent = `Low (${low})`;
    });
  }

  // ── Init: load from DB (called by PortalAuth.init onReady) ──
  let RECORDS = [];
  async function loadHVC() {
    try {
      const result = await apiCall('GET');
      RECORDS = result.data || [];
      renderAll(RECORDS);
    } catch(err) {
      console.error('Failed to load HVC records:', err);
      showToast('Failed to load data from server', 'delete');
    }
    initFilters();
  }

  // ── Filters & Search ──────────────────────────────────────────
  function initFilters() {
    const btns = document.querySelectorAll('.hvc-filter-btn');
    let currentFilter = 'all';

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active-filter'));
        btn.classList.add('active-filter');
        currentFilter = btn.dataset.filter;
        applyFilters();
      });
    });

    document.getElementById('hvc-search').addEventListener('input', applyFilters);

    function applyFilters() {
      const q = document.getElementById('hvc-search').value.toLowerCase().trim();
      let visible = 0;
      document.querySelectorAll('#hvc-grid .hvc-card').forEach(card => {
        const threatOk = currentFilter === 'all' || card.dataset.threat === currentFilter;
        const textOk   = q === '' || card.innerText.toLowerCase().includes(q);
        const show = threatOk && textOk;
        card.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      document.getElementById('hvc-no-results').style.display = visible === 0 ? 'block' : 'none';
    }
  }

  // ── Photo handling ────────────────────────────────────────────
  let _pendingPhotoBase64 = null;

  function handlePhotoSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      _pendingPhotoBase64 = e.target.result;
      const preview = document.getElementById('hvc-photo-preview');
      preview.src = _pendingPhotoBase64;
      preview.style.display = 'block';
      document.getElementById('hvc-photo-placeholder').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }

  function resetPhotoUI() {
    _pendingPhotoBase64 = null;
    const preview = document.getElementById('hvc-photo-preview');
    preview.src = '';
    preview.style.display = 'none';
    document.getElementById('hvc-photo-placeholder').style.display = '';
    document.getElementById('hvc-photo-input').value = '';
  }

  function setPhotoPreview(url) {
    if (url) {
      const preview = document.getElementById('hvc-photo-preview');
      preview.src = url;
      preview.style.display = 'block';
      document.getElementById('hvc-photo-placeholder').style.display = 'none';
    } else {
      resetPhotoUI();
    }
  }

  // ── Crimes tags (in modal) ────────────────────────────────────
  let _crimes = [];

  function renderCrimeTags() {
    const row = document.getElementById('crimes-tags-row');
    row.innerHTML = '';
    _crimes.forEach((c, i) => {
      const tag = document.createElement('span');
      tag.className = 'hvc-crime-input-tag';
      tag.innerHTML = `${esc(c)} <button onclick="removeCrimeTag(${i})">✕</button>`;
      row.appendChild(tag);
    });
  }

  function addCrimeTag() {
    const input = document.getElementById('crime-add-input');
    const val = input.value.trim();
    if (!val) return;
    val.split(',').map(s=>s.trim()).filter(Boolean).forEach(v => {
      if (!_crimes.includes(v)) _crimes.push(v);
    });
    input.value = '';
    renderCrimeTags();
  }

  function removeCrimeTag(idx) {
    _crimes.splice(idx, 1);
    renderCrimeTags();
  }

  // ── Modal: Open / Close ───────────────────────────────────────
  function openHvcModal(prefill) {
    document.getElementById('hvc-modal-title').textContent = prefill ? 'Edit Subject' : 'Add Subject';
    document.getElementById('hvc-edit-id').value      = prefill?.id    || '';
    document.getElementById('hvc-f-name').value       = prefill?.name  || '';
    document.getElementById('hvc-f-threat').value     = prefill?.threat|| 'critical';
    document.getElementById('hvc-f-warrant').value    = prefill?.warrant_status || 'active';
    document.getElementById('hvc-f-affiliation').value= prefill?.affiliation || '';
    document.getElementById('hvc-f-location').value   = prefill?.location || '';
    document.getElementById('hvc-f-bio').value        = prefill?.bio   || '';
    document.getElementById('hvc-f-handler').value    = prefill?.handler|| '';
    document.getElementById('hvc-f-notes').value      = prefill?.notes || '';
    _crimes = prefill ? parseCrimes(prefill.crimes) : [];
    renderCrimeTags();
    if (prefill?.photo_url) {
      setPhotoPreview(prefill.photo_url);
    } else {
      resetPhotoUI();
    }
    document.getElementById('hvc-modal').classList.add('open');
  }

  function closeHvcModal() {
    document.getElementById('hvc-modal').classList.remove('open');
    resetPhotoUI();
    _crimes = [];
  }

  // ── Save (Create / Update) ────────────────────────────────────
  async function saveHvc() {
    const name   = document.getElementById('hvc-f-name').value.trim();
    const threat = document.getElementById('hvc-f-threat').value;
    if (!name) { document.getElementById('hvc-f-name').focus(); return; }

    const editId = document.getElementById('hvc-edit-id').value;
    const record = {
      name,
      threat,
      warrant_status: document.getElementById('hvc-f-warrant').value,
      affiliation:    document.getElementById('hvc-f-affiliation').value.trim(),
      location:       document.getElementById('hvc-f-location').value.trim(),
      bio:            document.getElementById('hvc-f-bio').value.trim(),
      handler:        document.getElementById('hvc-f-handler').value.trim(),
      notes:          document.getElementById('hvc-f-notes').value.trim(),
      crimes:         JSON.stringify(_crimes),
      photo_base64:   _pendingPhotoBase64 || null,
    };

    try {
      if (editId) {
        const result = await apiCall('PUT', { id: editId, ...record });
        const idx = RECORDS.findIndex(r => r.id === editId);
        if (idx > -1) RECORDS[idx] = result.data;
        showToast('Record updated — ' + name, 'edit');
      } else {
        const result = await apiCall('POST', record);
        RECORDS.push(result.data);
        showToast('Subject registered — ' + name, 'success');
      }
      renderAll(RECORDS);
      closeHvcModal();
      initFilters();
    } catch(err) {
      console.error('Save error:', err);
      showToast('Failed to save — check console', 'delete');
    }
  }

  // ── Edit ──────────────────────────────────────────────────────
  function editHvc(btn) {
    const card = btn.closest('.hvc-card');
    const rec  = RECORDS.find(r => r.id === card.dataset.hvcId);
    if (rec) openHvcModal(rec);
  }

  // ── Delete ────────────────────────────────────────────────────
  let _pendingDeleteId = null;

  function deleteHvc(btn) {
    const card = btn.closest('.hvc-card');
    _pendingDeleteId = card.dataset.hvcId;
    const rec = RECORDS.find(r => r.id === _pendingDeleteId);
    document.getElementById('hvc-del-name-display').textContent = rec?.name || 'this subject';
    document.getElementById('hvc-del-reason').value = '';
    document.getElementById('hvc-del-modal').classList.add('open');
  }

  function closeDelModal() {
    document.getElementById('hvc-del-modal').classList.remove('open');
    _pendingDeleteId = null;
  }

  async function confirmDelete() {
    if (!_pendingDeleteId) return;
    const rec    = RECORDS.find(r => r.id === _pendingDeleteId);
    const reason = document.getElementById('hvc-del-reason').value.trim();
    const badge  = sessionStorage.getItem('cib_badge') || 'Unknown';
    try {
      await apiCall('DELETE', { deleted_by: badge, reason }, _pendingDeleteId);
      RECORDS = RECORDS.filter(r => r.id !== _pendingDeleteId);
      renderAll(RECORDS);
      closeDelModal();
      initFilters();
      showToast('Record removed — ' + (rec?.name||''), 'delete');
    } catch(err) {
      console.error('Delete error:', err);
      showToast('Failed to delete — check console', 'delete');
      closeDelModal();
    }
  }

  // ── View Modal ────────────────────────────────────────────────
  function openViewModal(id) {
    const r = RECORDS.find(x => x.id === id);
    if (!r) return;

    // Calculate the same sequential number as renderAll
    const allSorted = [...RECORDS].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });
    const seqNum = allSorted.findIndex(x => x.id === id) + 1;
    const hvcIdLabel = `CIB-HVC-${String(seqNum).padStart(3, '0')}`;

    document.getElementById('view-eyebrow').textContent =
      `${hvcIdLabel} · THREAT: ${(r.threat||'').toUpperCase()} · ${warrantyLabel(r.warrant_status).toUpperCase()}`;
    document.getElementById('view-name').textContent = r.name || '—';

    const photoWrap = document.getElementById('view-photo-wrap');
    if (r.photo_url) {
      photoWrap.innerHTML = `<img class="hvc-view-photo" src="${esc(r.photo_url)}" alt="${esc(r.name)}"/>`;
    } else {
      photoWrap.innerHTML = `<div class="hvc-view-photo-placeholder"><svg viewBox="0 0 24 24" style="width:56px;height:56px;fill:var(--navy-border)"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg></div>`;
    }

    const crimes = parseCrimes(r.crimes);
    const crimeTags = crimes.map(c=>`<span class="hvc-crime-tag">${esc(c)}</span>`).join('');

    document.getElementById('view-body').innerHTML = `
      <div class="hvc-view-section">
        <div class="hvc-view-section-label">Threat Level</div>
        <div class="hvc-view-section-value" style="color:${threatColor(r.threat)};font-family:'Oswald',sans-serif;font-size:16px;letter-spacing:2px;">${esc(r.threat||'—').toUpperCase()}</div>
      </div>
      <div class="hvc-view-section">
        <div class="hvc-view-section-label">Warrant Status</div>
        <div class="hvc-view-section-value ${warrantyClass(r.warrant_status)}">${warrantyLabel(r.warrant_status)}</div>
      </div>
      <div class="hvc-view-section">
        <div class="hvc-view-section-label">Gang / Affiliation</div>
        <div class="hvc-view-section-value">${esc(r.affiliation||'—')}</div>
      </div>
      <div class="hvc-view-section">
        <div class="hvc-view-section-label">Last Known Location</div>
        <div class="hvc-view-section-value">${esc(r.location||'—')}</div>
      </div>
      <div class="hvc-view-section">
        <div class="hvc-view-section-label">Assigned Handler</div>
        <div class="hvc-view-section-value">${esc(r.handler||'—')}</div>
      </div>
      ${r.bio ? `
      <div class="hvc-view-section full">
        <div class="hvc-view-section-label">Biography</div>
        <div class="hvc-view-section-value">${esc(r.bio)}</div>
      </div>` : ''}
      ${crimes.length ? `
      <div class="hvc-view-section full">
        <div class="hvc-view-section-label">Known Crimes & Charges</div>
        <div class="hvc-view-crimes">${crimeTags}</div>
      </div>` : ''}
      ${r.notes ? `
      <div class="hvc-view-section full">
        <div class="hvc-view-section-label">Handler Notes</div>
        <div class="hvc-view-section-value" style="color:var(--gold-light);font-style:italic;">${esc(r.notes)}</div>
      </div>` : ''}
    `;

    document.getElementById('view-edit-btn').onclick = () => { closeViewModal(); openHvcModal(r); };
    document.getElementById('view-del-btn').onclick  = () => { closeViewModal(); deleteHvcById(r.id); };

    document.getElementById('hvc-view-modal').classList.add('open');
  }

  function deleteHvcById(id) {
    const rec = RECORDS.find(r => r.id === id);
    _pendingDeleteId = id;
    document.getElementById('hvc-del-name-display').textContent = rec?.name || 'this subject';
    document.getElementById('hvc-del-reason').value = '';
    document.getElementById('hvc-del-modal').classList.add('open');
  }

  function closeViewModal() {
    document.getElementById('hvc-view-modal').classList.remove('open');
  }

  // ── Backdrop close ────────────────────────────────────────────
  document.getElementById('hvc-modal').addEventListener('click', e => { if(e.target===document.getElementById('hvc-modal')) closeHvcModal(); });
  document.getElementById('hvc-del-modal').addEventListener('click', e => { if(e.target===document.getElementById('hvc-del-modal')) closeDelModal(); });
  document.getElementById('hvc-view-modal').addEventListener('click', e => { if(e.target===document.getElementById('hvc-view-modal')) closeViewModal(); });

SiteUi.initPageFadeTransitions({ transitionMs: 400 });
  SiteUi.initScrollReveal();