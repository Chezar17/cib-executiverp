// ══════════════════════════════════════════════════════════════
//  CIB GANG INTEL — FULL CRUD ENGINE
//  Storage: Supabase via /api/gangs
//  Classification: top_secret/secret=CRUD | confidential=read | unclassified=kicked
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://nyxnoexxueoutpambduy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eG5vZXh4dWVvdXRwYW1iZHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzM5MjUsImV4cCI6MjA5MjUwOTkyNX0.iogR0A0vLpZ-DUBFXT-3JP-EL_ggxWbmidhKqYv5KBw';

const THREAT_ORDER = { critical:0, high:1, medium:2, low:3, dormant:4 };
const THREAT_PCT   = { critical:'100%', high:'80%', medium:'55%', low:'30%', dormant:'10%' };

let GANGS       = [];
let USER_CLASS  = '';   // 'top_secret','secret','confidential','unclassified',''
let CAN_CRUD    = false;
let _pendingDelId = null;
let _imgBase64  = null; // current upload in modal

// ── Helpers ─────────────────────────────────────────────────
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function toast(msg, type='success'){
  const c = document.getElementById('gang-toast');
  const t = document.createElement('div');
  t.className = `gang-toast-item gt-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('show')));
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),350);},2800);
}

// ── Supabase direct calls (no backend needed for reads) ─────
async function sbFetch(table, opts={}){
  const { method='GET', body, filter } = opts;
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (filter) url += `?${filter}`;
  else if (method === 'GET') url += '?order=org_id.asc';
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method==='POST' ? 'return=representation' : method==='PATCH' ? 'return=representation' : ''
  };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(()=>({message:res.statusText})); throw new Error(e.message||res.statusText); }
  if (res.status === 204) return null;
  return res.json();
}

// ── Audit log helper ─────────────────────────────────────────
async function auditLog(action, gangName, gangOrgId){
  const badge = sessionStorage.getItem('cib_badge') || 'unknown';
  try {
    await sbFetch('gang_audit_log', {
      method: 'POST',
      body: { action, gang_name: gangName, org_id: gangOrgId, performed_by: badge, performed_at: new Date().toISOString() }
    });
  } catch(e){ console.warn('Audit log failed:', e.message); }
}

// ── Build a single gang card element ────────────────────────
function buildGangCard(g){
  const threat = (g.threat||'medium').toLowerCase();
  const card = document.createElement('div');
  card.className = `gang-card threat-${threat}`;
  card.dataset.threat = threat;
  card.dataset.gangId = g.id;

  // Territory tags
  const tags = (g.territory_tags||[]).map(t=>`<span class="gang-territory-tag">${esc(t)}</span>`).join('');

  // Crimes list
  const crimes = (g.crimes||[]).map(c=>`<div class="gang-crime-item"><div class="gang-crime-dot"></div>${esc(c)}</div>`).join('');

  // Hierarchy
  const hier = (g.hierarchy||[]).map(h=>{
    const parts = h.split('|');
    const rank = esc((parts[0]||'').trim());
    const name = esc((parts[1]||'').trim());
    const note = esc((parts[2]||'').trim());
    return `<div class="gang-hier-item"><span class="gang-hier-rank">${rank}</span><div><div class="gang-hier-name">${name}</div>${note?`<div class="gang-hier-note">${note}</div>`:''}</div></div>`;
  }).join('');

  // Threat bar pct and pill class
  const pct = THREAT_PCT[threat] || '50%';
  const threatPcts = { critical:'100', high:'80', medium:'55', low:'30', dormant:'10' };
  const pctNum = threatPcts[threat] || '50';
  const statusPill = g.grd_status === 'Active' ? 'pill-active' : g.grd_status === 'Dormant' ? 'pill-dormant' : 'pill-monitored';

  // Logo — with update/delete controls for CRUD users
  const logoHtml = g.logo_url
    ? `<img src="${esc(g.logo_url)}" alt="${esc(g.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"/><div class="gang-logo-initials" style="display:none;">${esc((g.name||'??').slice(0,3).toUpperCase())}</div>`
    : `<div class="gang-logo-initials">${esc((g.name||'??').slice(0,3).toUpperCase())}</div>`;
  const logoControls = `
    <div class="gang-logo-controls">
      <label class="logo-ctrl-btn logo-ctrl-update" title="Update logo">
        ↑ Update
        <input class="logo-update-input" type="file" accept="image/*" onchange="updateLogoInline(this,'${g.id}')" />
      </label>
      <button class="logo-ctrl-btn logo-ctrl-delete" onclick="deleteLogoInline('${g.id}')">✕ Delete</button>
    </div>`;

  // CRUD bar
  const crudBar = CAN_CRUD ? `
    <div class="gang-crud-bar">
      <button class="gang-edit-btn" onclick="openGangModal('${g.id}')">✎ Edit</button>
      <button class="gang-del-btn" onclick="openDelModal('${g.id}')">✕ Delete</button>
    </div>` : '';

  card.innerHTML = `
    <div class="gang-card-header">
      <div class="gang-logo-zone">
        <div class="gang-logo-frame">${logoHtml}</div>
        ${logoControls}
        <div class="gang-logo-label">GRD-ORG-${String(g.org_seq||0).padStart(3,'0')}</div>
      </div>
      <div class="gang-identity">
        <div class="gang-doc-ref">GRD-ORG-${String(g.org_seq||0).padStart(3,'0')} · Last Updated: ${g.updated_at ? new Date(g.updated_at).toLocaleDateString('en-GB',{month:'2-digit',year:'numeric'}).replace('/','.') : '—'}</div>
        <div class="gang-name">${esc(g.name)}</div>
        <div class="gang-alias">${esc(g.alias||'')}</div>
        <div class="gang-meta-row">
          <div class="gang-meta-item"><span class="gang-meta-lbl">Primary Area</span><span class="gang-meta-val">${esc(g.primary_area||'—')}</span></div>
          <div class="gang-meta-item"><span class="gang-meta-lbl">Sector</span><span class="gang-meta-val">${esc(g.sector||'—')}</span></div>
          <div class="gang-meta-item"><span class="gang-meta-lbl">Known OGs</span><span class="gang-meta-val">${esc(String(g.known_ogs||'—'))}</span></div>
          <div class="gang-meta-item"><span class="gang-meta-lbl">Approx. Members</span><span class="gang-meta-val">${esc(String(g.approx_members||'—'))}</span></div>
          <div class="gang-meta-item"><span class="gang-meta-lbl">GRD Status</span><span class="gang-meta-val">${esc(g.grd_status||'—')}</span></div>
        </div>
        <div class="gang-territory-tags">${tags}</div>
      </div>
      <div class="gang-threat-panel">
        <div class="gang-threat-badge">
          <div class="gang-threat-label">Threat Level</div>
          <div class="gang-threat-level">${threat.toUpperCase()}</div>
        </div>
        <div style="width:100%;">
          <div class="gang-threat-bar-wrap"><div class="gang-threat-bar" style="width:${pct};"></div></div>
          <div class="gang-threat-bar-pct">${pctNum}% Threat Index</div>
        </div>
        <span class="gang-status-pill ${statusPill}">${esc(g.grd_status||'Monitored')}</span>
      </div>
    </div>
    ${crudBar}
    <button class="gang-expand-btn" onclick="toggleGang(this)">
      <span>View Full Profile</span><span class="arrow">▼</span>
    </button>
    <div class="gang-card-body">
      <div class="gang-body-inner">
        <div class="gang-bio-section">
          <div class="gang-section-title">Organization Bio</div>
          <div class="gang-bio-text">${esc(g.bio||'No intelligence summary on file.')}</div>
        </div>
        <div class="gang-crimes-section">
          <div class="gang-section-title">Common Criminal Activity</div>
          <div class="gang-crime-list">${crimes||'<div class="gang-crime-item"><div class="gang-crime-dot"></div>No data on file.</div>'}</div>
        </div>
        <div class="gang-hierarchy-section">
          <div class="gang-section-title">Known Hierarchy</div>
          <div class="gang-hier-list">${hier||'<div style="font-size:11px;color:var(--muted);">No hierarchy data on file.</div>'}</div>
        </div>

      </div>
    </div>`;
  return card;
}

// ── Render all cards ─────────────────────────────────────────
function renderGangs(gangs){
  const container = document.getElementById('gang-cards');
  container.innerHTML = '';
  // Sort by threat
  const sorted = [...gangs].sort((a,b)=>(THREAT_ORDER[a.threat]??9)-(THREAT_ORDER[b.threat]??9));
  sorted.forEach(g => container.appendChild(buildGangCard(g)));
  updateStats(gangs);
  applyFilters();
}

function updateStats(gangs){
  document.getElementById('stat-total').textContent    = gangs.length;
  document.getElementById('stat-critical').textContent = gangs.filter(g=>g.threat==='critical').length;
  document.getElementById('stat-high').textContent     = gangs.filter(g=>g.threat==='high').length;
}

// ── Load from Supabase ───────────────────────────────────────
async function loadGangs(){
  // Show CSV seed data immediately while Supabase loads
  if (CSV_SEED && CSV_SEED.length > 0 && GANGS.length === 0) {
    GANGS = CSV_SEED;
    document.getElementById('gang-loading').style.display = 'none';
    document.getElementById('gang-cards').style.display = '';
    renderGangs(GANGS);
  }
  try {
    const data = await sbFetch('gangs');
    GANGS = data || [];
    document.getElementById('gang-loading').style.display = 'none';
    document.getElementById('gang-cards').style.display = '';
    renderGangs(GANGS);
  } catch(e){
    console.error('Failed to load gangs:', e);
    document.getElementById('gang-loading').innerHTML = `<div style="text-align:center;padding:40px;font-family:'Roboto Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--red-alert);">FAILED TO LOAD DATABASE — ${esc(e.message)}</div>`;
    toast('Failed to load gang database', 'error');
  }
}

// ── Auto-generate next org_seq ───────────────────────────────
function getNextOrgSeq(){
  if (!GANGS.length) return 1;
  return Math.max(...GANGS.map(g=>g.org_seq||0)) + 1;
}

// ── Image Upload Handler ─────────────────────────────────────
function handleImgUpload(input){
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _imgBase64 = e.target.result; // data URL
    const img = document.getElementById('gf-img-preview');
    img.src = _imgBase64;
    img.style.display = 'block';
    document.getElementById('gf-img-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ── Open Modal ───────────────────────────────────────────────
function openGangModal(editId){
  _imgBase64 = null;
  document.getElementById('gf-img-preview').style.display = 'none';
  document.getElementById('gf-img-placeholder').style.display = '';
  document.getElementById('gf-img-input').value = '';

  if (editId) {
    const g = GANGS.find(x=>x.id==editId);
    if (!g) return;
    document.getElementById('gang-modal-title').textContent = 'Edit Gang';
    document.getElementById('gf-edit-id').value   = g.id;
    document.getElementById('gf-org-id').value    = 'GRD-ORG-' + String(g.org_seq||0).padStart(3,'0');
    document.getElementById('gf-name').value      = g.name || '';
    document.getElementById('gf-alias').value     = g.alias || '';
    document.getElementById('gf-threat').value    = g.threat || 'medium';
    document.getElementById('gf-area').value      = g.primary_area || '';
    document.getElementById('gf-sector').value    = g.sector || 'West';
    document.getElementById('gf-ogs').value       = g.known_ogs ?? '';
    document.getElementById('gf-members').value   = g.approx_members ?? '';
    document.getElementById('gf-grd-status').value= g.grd_status || 'Monitored';
    document.getElementById('gf-tags').value      = (g.territory_tags||[]).join(', ');
    document.getElementById('gf-bio').value       = g.bio || '';
    document.getElementById('gf-crimes').value    = (g.crimes||[]).join('\n');
    document.getElementById('gf-hierarchy').value = (g.hierarchy||[]).join('\n');
    if (g.logo_url){ _imgBase64=g.logo_url; document.getElementById('gf-img-preview').src=g.logo_url; document.getElementById('gf-img-preview').style.display='block'; document.getElementById('gf-img-placeholder').style.display='none'; }

  } else {
    document.getElementById('gang-modal-title').textContent = 'Add Gang';
    document.getElementById('gf-edit-id').value   = '';
    document.getElementById('gf-org-id').value    = 'GRD-ORG-' + String(getNextOrgSeq()).padStart(3,'0');
    document.getElementById('gf-name').value      = '';
    document.getElementById('gf-alias').value     = '';
    document.getElementById('gf-threat').value    = 'medium';
    document.getElementById('gf-area').value      = '';
    document.getElementById('gf-sector').value    = 'West';
    document.getElementById('gf-ogs').value       = '';
    document.getElementById('gf-members').value   = '';
    document.getElementById('gf-grd-status').value= 'Monitored';
    document.getElementById('gf-tags').value      = '';
    document.getElementById('gf-bio').value       = '';
    document.getElementById('gf-crimes').value    = '';
    document.getElementById('gf-hierarchy').value = '';

  }
  document.getElementById('gang-modal').classList.add('open');
}
function closeGangModal(){ document.getElementById('gang-modal').classList.remove('open'); }

// ── Save (Create / Update) ───────────────────────────────────
async function saveGang(){
  const name = document.getElementById('gf-name').value.trim();
  if (!name){ toast('Gang name is required','error'); return; }

  // ── Lock button while saving ──────────────────────────────
  const saveBtn = document.querySelector('.gf-save');
  saveBtn.classList.add('loading');
  saveBtn.disabled = true;

  const editId  = document.getElementById('gf-edit-id').value;
  const isEdit  = !!editId;
  const badge   = sessionStorage.getItem('cib_badge') || 'unknown';
  const orgSeq  = isEdit ? (GANGS.find(g=>g.id==editId)?.org_seq) : getNextOrgSeq();

  const payload = {
    name,
    alias:           document.getElementById('gf-alias').value.trim(),
    threat:          document.getElementById('gf-threat').value,
    primary_area:    document.getElementById('gf-area').value.trim(),
    sector:          document.getElementById('gf-sector').value,
    known_ogs:       parseInt(document.getElementById('gf-ogs').value)||0,
    approx_members:  parseInt(document.getElementById('gf-members').value)||0,
    grd_status:      document.getElementById('gf-grd-status').value,
    territory_tags:  document.getElementById('gf-tags').value.split(',').map(t=>t.trim()).filter(Boolean),
    bio:             document.getElementById('gf-bio').value.trim(),
    crimes:          document.getElementById('gf-crimes').value.split('\n').map(c=>c.trim()).filter(Boolean),
    hierarchy:       document.getElementById('gf-hierarchy').value.split('\n').map(h=>h.trim()).filter(Boolean),
    logo_url:        _imgBase64 || (isEdit ? GANGS.find(g=>g.id==editId)?.logo_url : null),
    updated_at:      new Date().toISOString(),
    updated_by:      badge,
  };

  try {
    if (isEdit){
      const updated = await sbFetch('gangs', { method:'PATCH', body:payload, filter:`id=eq.${editId}` });
      const idx = GANGS.findIndex(g=>g.id==editId);
      if (idx>-1) GANGS[idx] = Array.isArray(updated) ? updated[0] : {...GANGS[idx],...payload};
      await auditLog('EDIT', name, 'GRD-ORG-'+String(orgSeq).padStart(3,'0'));
      toast('Gang updated — ' + name, 'edit');
    } else {
      payload.org_seq    = orgSeq;
      payload.created_at = new Date().toISOString();
      payload.created_by = badge;
      const created = await sbFetch('gangs', { method:'POST', body:payload });
      const newGang = Array.isArray(created) ? created[0] : {...payload, id: Date.now()};
      GANGS.push(newGang);
      await auditLog('CREATE', name, 'GRD-ORG-'+String(orgSeq).padStart(3,'0'));
      toast('Gang registered — ' + name, 'success');
    }
    renderGangs(GANGS);
    closeGangModal();
  } catch(e){
    console.error('Save error:', e);
    toast('Save failed — ' + e.message, 'error');
    // ── Restore button on error so user can retry ──────────
    saveBtn.classList.remove('loading');
    saveBtn.disabled = false;
  }
}

// ── Delete ───────────────────────────────────────────────────
function openDelModal(gangId){
  _pendingDelId = gangId;
  const g = GANGS.find(x=>x.id==gangId);
  document.getElementById('gang-del-name').textContent = g?.name || '—';
  document.getElementById('gang-del-modal').classList.add('open');
}
function closeDelModal(){ document.getElementById('gang-del-modal').classList.remove('open'); _pendingDelId=null; }
async function confirmGangDelete(){
  if (!_pendingDelId) return;

  // ── Lock button while deleting ────────────────────────────
  const delBtn = document.querySelector('.gang-del-confirm');
  delBtn.classList.add('loading');
  delBtn.disabled = true;

  const g = GANGS.find(x=>x.id==_pendingDelId);
  try {
    await sbFetch('gangs', { method:'DELETE', filter:`id=eq.${_pendingDelId}` });
    await auditLog('DELETE', g?.name||'unknown', g ? 'GRD-ORG-'+String(g.org_seq||0).padStart(3,'0') : '—');
    GANGS = GANGS.filter(x=>x.id!=_pendingDelId);
    renderGangs(GANGS);
    closeDelModal();
    toast('Gang record deleted — ' + (g?.name||''), 'delete');
  } catch(e){
    console.error('Delete error:', e);
    toast('Delete failed — ' + e.message, 'error');
    // ── Restore button on error so user can retry ──────────
    delBtn.classList.remove('loading');
    delBtn.disabled = false;
    closeDelModal();
  }
}

// ── Close modals on backdrop ─────────────────────────────────
document.getElementById('gang-modal').addEventListener('click', e=>{ if(e.target===document.getElementById('gang-modal')) closeGangModal(); });
document.getElementById('gang-del-modal').addEventListener('click', e=>{ if(e.target===document.getElementById('gang-del-modal')) closeDelModal(); });

// ── AUTH + CLOCK + IDLE TIMEOUT ───────────────────────────────
PortalAuth.init({
  badgeEls: ['badgeDisplay'],
  clockEl:  'liveClock',
  onReady:  function() {
    USER_CLASS = (sessionStorage.getItem('cib_classification') || '').toLowerCase().trim()

    if (USER_CLASS === 'unclassified' || USER_CLASS === '') {
      toast('Access denied — insufficient clearance', 'error')
      setTimeout(() => window.location.href = 'Page_Nexus.html', 1200)
      return
    }

    CAN_CRUD = (USER_CLASS === 'top_secret' || USER_CLASS === 'secret')
    if (CAN_CRUD) document.body.classList.add('can-crud')

    if (USER_CLASS === 'confidential') {
      const notice = document.getElementById('confidential-notice')
      if (notice) notice.style.display = 'block'
    }

    const dispName = sessionStorage.getItem('cib_name') || sessionStorage.getItem('cib_badge') || '—'
    const badgeEl = document.getElementById('badgeDisplay')
    if (badgeEl) badgeEl.textContent = dispName

    loadGangs()
  }
})

function logout() { PortalAuth.logout() }

// ── MIRO BOARD PASSWORD GATE ─────────────────────────────────
// Hashes the password client-side (same method as login page),
// sends badge + hash to /api/verify-password for DB check.
// On success: removes the gate, loads the iframe src.

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function miroVerify() {
  const pwInput = document.getElementById('miro-gate-pw');
  const errEl   = document.getElementById('miro-gate-err');
  const btn     = document.getElementById('miro-gate-btn');
  const pw      = pwInput.value;

  if (!pw) {
    errEl.textContent = 'Enter your password.';
    pwInput.classList.add('error');
    setTimeout(() => pwInput.classList.remove('error'), 400);
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Verifying...';
  errEl.textContent = '';

  try {
    const badge        = sessionStorage.getItem('cib_badge') || '';
    const passwordHash = await sha256(pw);
    const token        = sessionStorage.getItem('cib_token') || '';

    const res = await fetch('/api/verify-password', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-session-token': token
      },
      body: JSON.stringify({ badge, passwordHash })
    });

    if (res.ok) {
      // ✅ Correct — unlock the board
      document.getElementById('miro-gate').classList.add('unlocked');
      const iframe = document.getElementById('miro-iframe');
      iframe.src   = iframe.dataset.src;  // now actually load Miro
      pwInput.value = '';
    } else {
      const data = await res.json();
      errEl.textContent = data.error || 'Incorrect password.';
      pwInput.classList.add('error');
      setTimeout(() => pwInput.classList.remove('error'), 400);
      btn.disabled    = false;
      btn.textContent = 'Verify Identity';
    }
  } catch(err) {
    errEl.textContent = 'Network error. Try again.';
    btn.disabled    = false;
    btn.textContent = 'Verify Identity';
  }
}

// ── EXPAND / COLLAPSE ────────────────────────────────────────
function toggleGang(btn){
  const card = btn.closest('.gang-card');
  const body = card.querySelector('.gang-card-body');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open',!isOpen);
  btn.classList.toggle('expanded',!isOpen);
  btn.querySelector('span:first-child').textContent = isOpen ? 'View Full Profile' : 'Collapse Profile';
}

// ── FILTER & SEARCH ──────────────────────────────────────────
const filterBtns = document.querySelectorAll('.filter-btn');
let currentFilter = 'all';

filterBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{
    filterBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    applyFilters();
  });
});

document.getElementById('gang-search').addEventListener('input', applyFilters);

function applyFilters(){
  const q = document.getElementById('gang-search').value.toLowerCase().trim();
  let visible = 0;
  document.querySelectorAll('.gang-card').forEach(card=>{
    const sector = (card.querySelector('.gang-alias')||{}).textContent?.split('·')[0]?.trim().toLowerCase()||'';
    const threatOk = currentFilter==='all' || card.dataset.threat===currentFilter || sector.includes(currentFilter);
    const textOk   = q==='' || card.innerText.toLowerCase().includes(q);
    const show = threatOk && textOk;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('no-results').style.display = visible===0 ? 'block' : 'none';
}


// ── CSV SEED DATA (from gangs.csv — used as initial data) ─────
// When Supabase loads, live data replaces this.
// This ensures something is visible even before network load.
const CSV_SEED = [
  {
    "id": "3",
    "org_seq": 1,
    "name": "Chezar",
    "alias": "Ramadhan",
    "threat": "medium",
    "primary_area": "eyaya",
    "sector": "West",
    "known_ogs": 1,
    "approx_members": 1,
    "grd_status": "Monitored",
    "territory_tags": [],
    "bio": "Test",
    "crimes": [
      "Makanan",
      "Minuman",
      "Lapar",
      "Sekali"
    ],
    "hierarchy": [
      "OG | Chezar | Bahaya sekali",
      "OG | Ramadhan | Tolol sekali"
    ],
    "logo_url": "",
    "updated_at": "2026-04-25 12:42:01.033+00"
  }
];

// ── Inline logo update (hover buttons on card) ─────────────────
function updateLogoInline(input, gangId){
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const base64 = e.target.result;
    try {
      await sbFetch('gangs', {method:'PATCH', body:{logo_url:base64, updated_at:new Date().toISOString()}, filter:`id=eq.${gangId}`});
      const idx = GANGS.findIndex(g=>g.id==gangId);
      if (idx>-1) GANGS[idx].logo_url = base64;
      renderGangs(GANGS);
      toast('Logo updated', 'edit');
    } catch(e) { toast('Logo update failed — '+e.message,'error'); }
  };
  reader.readAsDataURL(file);
}

// ── Inline logo delete (hover button on card) ─────────────────
async function deleteLogoInline(gangId){
  if (!confirm('Remove this gang logo?')) return;
  try {
    await sbFetch('gangs', {method:'PATCH', body:{logo_url:null, updated_at:new Date().toISOString()}, filter:`id=eq.${gangId}`});
    const idx = GANGS.findIndex(g=>g.id==gangId);
    if (idx>-1) GANGS[idx].logo_url = null;
    renderGangs(GANGS);
    toast('Logo removed', 'delete');
  } catch(e) { toast('Logo delete failed — '+e.message,'error'); }
}





SiteUi.initPageFadeTransitions({ transitionMs: 400 })
SiteUi.initScrollReveal()