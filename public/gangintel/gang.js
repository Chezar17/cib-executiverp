// ══════════════════════════════════════════════════════════════
//  NEXUS — GANG INTELLIGENCE DATABASE (gang.js)
//  Merges:
//   - Authentication + Supabase CRUD engine (from gang1.js)
//   - Interactive territory map / pin placement (from gang.js)
//  Storage: Supabase table "gangs" (+ "gang_audit_log" for audit trail)
//  Classification: top_secret/secret = full CRUD | confidential = read only
//                  unclassified/none = kicked back to Nexus
//
//  NOTE ON SCHEMA: the on-page form (gang.html) collects these
//  fields — make sure the "gangs" table in Supabase has matching
//  columns (create them if they don't exist yet):
//    id (pk), org_seq (int), name (text), location (text),
//    threat (text), sector (text), bio (text), accent_color (text),
//    known_og (jsonb array), known_members (jsonb array),
//    logo_url (text — either an uploaded data: URI or a plain image URL),
//    pin_x (float8), pin_y (float8),
//    created_at, created_by, updated_at, updated_by
// ══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://nyxnoexxueoutpambduy.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eG5vZXh4dWVvdXRwYW1iZHV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzM5MjUsImV4cCI6MjA5MjUwOTkyNX0.iogR0A0vLpZ-DUBFXT-3JP-EL_ggxWbmidhKqYv5KBw';

const THREAT_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

let GANGS         = [];   // in-memory cache of loaded gang records
let USER_CLASS    = '';   // 'top_secret','secret','confidential','unclassified',''
let CAN_CRUD      = false;
let _pendingDelId = null;
let _imgBase64    = null; // current logo upload in the modal
let _pinCoords    = null; // {x,y} staged from a map click, consumed on next modal open (fresh "Add Gang" flow)
let _pendingPinEdit = null; // {editId, draft} staged when "Set/Change Pin on Map" is used from inside the form

// ── Helpers ─────────────────────────────────────────────────
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function toast(msg, type = 'success') {
  const c = document.getElementById('gang-toast');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `gang-toast-item gt-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, 2800);
}

function toLines(text) {
  return (text || '').split('\n').map(s => s.trim()).filter(Boolean);
}

// ── Reusable name-chip / tag input (used for OG list & Member list) ──
// Backspace on an empty field no longer nukes an already-added name outright:
// the first press just "arms" (highlights) the last chip, and only a second
// press (or a fresh Backspace after re-arming) actually removes it. Typing
// anything else, or moving focus, disarms it — so a mis-timed Backspace
// while the field happens to be empty can't silently delete a saved name.
function createTagInput(chipsEl, inputEl) {
  let values = [];
  let armedForRemoval = false; // true once the last chip is "selected" and ready to delete

  function disarm() { armedForRemoval = false; }

  function render() {
    chipsEl.innerHTML = '';
    values.forEach((v, i) => {
      const chip = document.createElement('span');
      chip.className = 'gf-tag-chip';
      if (armedForRemoval && i === values.length - 1) chip.classList.add('gf-tag-chip-armed');
      chip.innerHTML = `<span>${esc(v)}</span>`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + v);
      rm.textContent = '×';
      rm.addEventListener('click', () => { values.splice(i, 1); disarm(); render(); });
      chip.appendChild(rm);
      chipsEl.appendChild(chip);
    });
  }

  function addValue(v) {
    v = v.trim();
    if (v && !values.includes(v)) values.push(v);
  }

  function commitInput() {
    const raw = inputEl.value;
    if (!raw.trim()) { inputEl.value = ''; return; }
    raw.split(',').forEach(addValue);
    inputEl.value = '';
    disarm();
    render();
  }

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitInput();
    } else if (e.key === 'Backspace' && inputEl.value === '' && values.length) {
      e.preventDefault();
      if (armedForRemoval) {
        values.pop();
        armedForRemoval = false;
      } else {
        armedForRemoval = true; // first press just highlights the last chip
      }
      render();
    } else if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') {
      disarm();
    }
  });
  inputEl.addEventListener('input', () => { if (inputEl.value !== '') disarm(); });
  inputEl.addEventListener('blur', () => { disarm(); commitInput(); });
  inputEl.addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && /[\n,]/.test(text)) {
      e.preventDefault();
      text.split(/[\n,]/).forEach(addValue);
      disarm();
      render();
    }
  });

  return {
    get: () => values.slice(),
    set: (arr) => { values = (arr || []).map(v => String(v).trim()).filter(Boolean); disarm(); render(); },
    clear: () => { values = []; disarm(); render(); },
  };
}

// ── Supabase REST calls ──────────────────────────────────────
async function sbFetch(table, opts = {}) {
  const { method = 'GET', body, filter } = opts;
  let url = `${SUPABASE_URL}/rest/v1/${table}`;
  if (filter) url += `?${filter}`;
  else if (method === 'GET') url += '?order=org_seq.asc';
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': method === 'POST' ? 'return=representation' : method === 'PATCH' ? 'return=representation' : ''
  };
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) { const e = await res.json().catch(() => ({ message: res.statusText })); throw new Error(e.message || res.statusText); }
  if (res.status === 204) return null;
  return res.json();
}

async function auditLog(action, gangName, gangOrgId) {
  const badge = sessionStorage.getItem('cib_badge') || 'unknown';
  try {
    await sbFetch('gang_audit_log', {
      method: 'POST',
      body: { action, gang_name: gangName, org_id: gangOrgId, performed_by: badge, performed_at: new Date().toISOString() }
    });
  } catch (e) { console.warn('Audit log failed:', e.message); }
}

// ── Auto-generate next org_seq ───────────────────────────────
function getNextOrgSeq() {
  if (!GANGS.length) return 1;
  return Math.max(...GANGS.map(g => g.org_seq || 0)) + 1;
}

// ══════════════════════════════════════════════════════════════
//  MAP: PAN + ZOOM + PIN PLACEMENT
// ══════════════════════════════════════════════════════════════

const mapUpload   = document.getElementById('mapUpload');
const mapCanvas   = document.getElementById('mapCanvas');
const mapViewport = document.getElementById('mapViewport');
const mapEmpty    = document.getElementById('mapEmpty');
const mapHint     = document.getElementById('mapHint');
const btnPinMode  = document.getElementById('btnPinMode');
const zoomInBtn   = document.getElementById('zoomIn');
const zoomOutBtn  = document.getElementById('zoomOut');
const zoomResetBtn = document.getElementById('zoomReset');

const MAP_IMAGE_KEY = 'nexus_gangintel_map_image_v1';
const MIN_SCALE = 0.4;
const MAX_SCALE = 10;       // pushed way up so users can zoom in tight on a block
const BASE_CANVAS_W = 1800; // canvas width in unscaled px; height derives from the image's own aspect ratio

let scale = 1, panX = 0, panY = 0;
let isDragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;
let pinMode = false;

function applyTransform() {
  mapCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  updatePinScale();
}

// Pins live inside the scaled canvas, so counter-scale them individually —
// otherwise they'd balloon in size (and cover half the map) at high zoom.
function updatePinScale() {
  const inv = Math.max(0.35, Math.min(1, 1 / scale));
  mapCanvas.querySelectorAll('.map-pin').forEach(p => {
    p.style.transform = `translate(-50%, -100%) scale(${inv})`;
  });
}

function clampPan() {
  const vpRect = mapViewport.getBoundingClientRect();
  const cw = mapCanvas.offsetWidth  || BASE_CANVAS_W;
  const ch = mapCanvas.offsetHeight || BASE_CANVAS_W * 0.75;
  const maxX = vpRect.width * 0.9;
  const maxY = vpRect.height * 0.9;
  panX = Math.max(-cw * scale + 60, Math.min(maxX, panX));
  panY = Math.max(-ch * scale + 60, Math.min(maxY, panY));
}

zoomInBtn.addEventListener('click', () => { scale = Math.min(MAX_SCALE, +(scale + 0.4).toFixed(2)); clampPan(); applyTransform(); });
zoomOutBtn.addEventListener('click', () => { scale = Math.max(MIN_SCALE, +(scale - 0.4).toFixed(2)); clampPan(); applyTransform(); });
zoomResetBtn.addEventListener('click', () => { scale = 1; panX = 0; panY = 0; applyTransform(); });

// Scroll-to-zoom disabled — the mouse wheel now behaves like it does on the
// rest of the page (normal page scroll) instead of zooming the map.

mapViewport.addEventListener('mousedown', (e) => {
  if (pinMode) return; // clicking places a pin instead of dragging
  e.preventDefault(); // stop the browser from starting a text/image selection drag
  isDragging = true;
  mapViewport.classList.add('grabbing');
  dragStartX = e.clientX; dragStartY = e.clientY;
  panStartX = panX; panStartY = panY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  panX = panStartX + (e.clientX - dragStartX);
  panY = panStartY + (e.clientY - dragStartY);
  applyTransform();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  mapViewport.classList.remove('grabbing');
});

function setPinMode(on) {
  pinMode = on;
  mapViewport.classList.toggle('pin-mode', pinMode);
  mapHint.classList.toggle('active', pinMode);
  btnPinMode.classList.toggle('active', pinMode);
  btnPinMode.textContent = pinMode ? '✕ Cancel Pin Placement' : '📍 Place Pin';
  mapHint.textContent = pinMode
    ? 'Click a location on the map to file a new entry'
    : 'Click anywhere on the map to drop a pin';
}

btnPinMode.addEventListener('click', () => {
  if (!CAN_CRUD) { toast('Insufficient clearance to add entries', 'error'); return; }
  const turningOn = !pinMode;
  // This button is always for a fresh, not-yet-placed pin — reset the view
  // to a neutral default so the user isn't left staring at wherever the map
  // happened to be panned/zoomed to before.
  if (turningOn) { scale = 1; panX = 0; panY = 0; applyTransform(); }
  setPinMode(turningOn);
});

mapCanvas.addEventListener('click', (e) => {
  if (!pinMode) return;
  const rect = mapCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / scale;
  const y = (e.clientY - rect.top) / scale;

  setPinMode(false);

  if (_pendingPinEdit) {
    // came from "Set/Change Pin on Map" inside the Edit/Add form —
    // reopen that same record with the new coordinates + any unsaved edits intact
    const { editId, draft } = _pendingPinEdit;
    _pendingPinEdit = null;
    openGangModal(editId);
    restoreDraftToForm(draft);
    gfPinX.value = x;
    gfPinY.value = y;
    updatePinStatusUI();
    toast(editId ? 'Pin updated — save to confirm' : 'Pin placed — save to confirm', 'success');
  } else {
    // fresh pin from the top "Place Pin" / bottom "Add Gang" button
    _pinCoords = { x, y };
    openGangModal(null);
  }
});

// ── Map image upload (stored client-side) ────────────────────
function setMapImage(dataUrl) {
  if (dataUrl) {
    // Size the canvas to match the image's own aspect ratio so a tall/
    // portrait territory map is never cropped by a fixed 4:3 box.
    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalHeight / img.naturalWidth || 0.75;
      mapCanvas.style.width  = BASE_CANVAS_W + 'px';
      mapCanvas.style.height = Math.round(BASE_CANVAS_W * ratio) + 'px';
      mapCanvas.style.backgroundSize = '100% 100%'; // canvas ratio now matches the image, so no crop/stretch
      mapCanvas.style.backgroundImage = `url('${dataUrl}')`;
      mapEmpty.style.display = 'none';
      clampPan();
      applyTransform();
    };
    img.src = dataUrl;
  } else {
    mapCanvas.style.backgroundImage = 'none';
    mapEmpty.style.display = 'flex';
  }
}

mapUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    localStorage.setItem(MAP_IMAGE_KEY, reader.result);
    setMapImage(reader.result);
  };
  reader.readAsDataURL(file);
});

(function initMapImage() {
  const saved = localStorage.getItem(MAP_IMAGE_KEY);
  if (saved) setMapImage(saved);
})();

// ── Render map pins ───────────────────────────────────────────
function renderPins() {
  mapCanvas.querySelectorAll('.map-pin').forEach(p => p.remove());

  GANGS.forEach(g => {
    if (g.pin_x === undefined || g.pin_x === null || g.pin_y === undefined || g.pin_y === null) return;
    const threat = (g.threat || 'medium').toLowerCase();
    const pin = document.createElement('div');
    pin.className = `map-pin threat-${threat}`;
    pin.style.left = g.pin_x + 'px';
    pin.style.top = g.pin_y + 'px';
    pin.dataset.gangId = g.id;
    pin.innerHTML = `
      <div class="pin-dot"><span>●</span></div>
      <div class="map-pin-label">${esc(g.name || 'UNNAMED')}</div>
    `;
    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      focusGangCard(g.id);
    });
    mapCanvas.appendChild(pin);
  });
  updatePinScale();
}

// Centre the map viewport on a given (unscaled) canvas coordinate, optionally
// zooming in to targetScale. Used both for "View Location" on a gang card
// and for auto-panning to an existing pin when the user goes to edit it.
function panToCanvasPoint(x, y, targetScale) {
  if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) return;
  if (targetScale != null) scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
  const vpRect = mapViewport.getBoundingClientRect();
  panX = vpRect.width / 2 - x * scale;
  panY = vpRect.height / 2 - y * scale;
  clampPan();
  applyTransform();
}

// Briefly pulse a pin on the map so it's easy to spot after panning to it
function flashPinForGang(gangId) {
  const pin = mapCanvas.querySelector(`.map-pin[data-gang-id="${gangId}"]`);
  if (!pin) return;
  pin.classList.remove('pin-flash');
  void pin.offsetWidth; // restart animation if it's already flashing
  pin.classList.add('pin-flash');
  setTimeout(() => pin.classList.remove('pin-flash'), 1600);
}

// "View Location" button on a gang card — jump to the map and zoom into
// that gang's pin.
function viewGangLocation(gangId) {
  const g = GANGS.find(x => x.id == gangId);
  if (!g || g.pin_x === undefined || g.pin_x === null || g.pin_y === undefined || g.pin_y === null) {
    toast('No location pinned for this gang yet', 'error');
    return;
  }
  document.querySelector('.map-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setTimeout(() => {
    panToCanvasPoint(g.pin_x, g.pin_y, 3.2);
    flashPinForGang(gangId);
  }, 350); // let the scroll settle so viewport dimensions are stable
}

// Scroll to + expand a gang's card in the registry below the map
function focusGangCard(gangId) {
  const card = document.querySelector(`.gang-card[data-gang-id="${gangId}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const body = card.querySelector('.gang-card-body');
  const btn = card.querySelector('.gang-expand-btn');
  if (body && !body.classList.contains('open')) {
    body.classList.add('open');
    btn.classList.add('expanded');
    btn.querySelector('span:first-child').textContent = 'Collapse Profile';
  }
  card.classList.add('gang-card-flash');
  setTimeout(() => card.classList.remove('gang-card-flash'), 1200);
}

// ══════════════════════════════════════════════════════════════
//  BUILD + RENDER GANG CARDS
// ══════════════════════════════════════════════════════════════

function buildGangCard(g) {
  const threat = (g.threat || 'medium').toLowerCase();
  const card = document.createElement('div');
  card.className = `gang-card threat-${threat}`;
  card.dataset.threat = threat;
  card.dataset.sector = (g.sector || '').toLowerCase();
  card.dataset.gangId = g.id;
  if (g.accent_color) card.style.setProperty('--card-accent', g.accent_color);

  const knownOg = (g.known_og || []).map(n =>
    `<div class="gang-people-item"><div class="gang-crime-dot"></div>${esc(n)}</div>`).join('');
  const knownMembers = (g.known_members || []).map(n =>
    `<div class="gang-people-item"><div class="gang-crime-dot"></div>${esc(n)}</div>`).join('');

  const logoHtml = g.logo_url
    ? `<img src="${esc(g.logo_url)}" alt="${esc(g.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"/><div class="gang-logo-initials" style="display:none;">${esc((g.name || '??').slice(0, 3).toUpperCase())}</div>`
    : `<div class="gang-logo-initials">${esc((g.name || '??').slice(0, 3).toUpperCase())}</div>`;

  const hasPin = g.pin_x !== undefined && g.pin_x !== null && g.pin_y !== undefined && g.pin_y !== null;
  const viewLocBtn = hasPin
    ? `<button class="gang-view-loc-btn" onclick="viewGangLocation('${g.id}')">📍 View Location</button>`
    : `<span class="gang-view-loc-btn gang-view-loc-btn-disabled">📍 No Location Pinned</span>`;

  const crudBar = CAN_CRUD ? `
    <div class="gang-crud-bar">
      <button class="gang-edit-btn" onclick="openGangModal('${g.id}')">✎ Edit</button>
      <button class="gang-del-btn" onclick="openDelModal('${g.id}')">✕ Delete</button>
    </div>` : '';

  card.innerHTML = `
    <div class="gang-card-header">
      <div class="gang-logo-zone">
        <div class="gang-logo-frame">${logoHtml}</div>
        <div class="gang-logo-label">GRD-ORG-${String(g.org_seq || 0).padStart(3, '0')}</div>
      </div>
      <div class="gang-identity">
        <div class="gang-doc-ref"><span class="gang-accent-chip"></span>GRD-ORG-${String(g.org_seq || 0).padStart(3, '0')} · Last Updated: ${g.updated_at ? new Date(g.updated_at).toLocaleDateString('en-GB', { month: '2-digit', year: 'numeric' }).replace('/', '.') : '—'}</div>
        <div class="gang-name">${esc(g.name)}</div>
        <div class="gang-alias">${esc(g.location || '')}</div>
        <div class="gang-meta-row">
          <div class="gang-meta-item"><span class="gang-meta-lbl">Location</span><span class="gang-meta-val">${esc(g.location || '—')}</span></div>
          <div class="gang-meta-item"><span class="gang-meta-lbl">Sector</span><span class="gang-meta-val">${esc(g.sector || '—')}</span></div>
          <div class="gang-meta-item"><span class="gang-meta-lbl">OG(s)</span><span class="gang-meta-val">${(g.known_og || []).length}</span></div>
          <div class="gang-meta-item"><span class="gang-meta-lbl">Members</span><span class="gang-meta-val">${(g.known_members || []).length}</span></div>
        </div>
      </div>
      <div class="gang-threat-panel">
        <div class="gang-threat-badge">
          <div class="gang-threat-label">Threat Level</div>
          <div class="gang-threat-level">${threat.toUpperCase()}</div>
        </div>
        <div style="width:100%;">
          <div class="gang-threat-bar-wrap"><div class="gang-threat-bar"></div></div>
        </div>
        <span class="gang-sector-pill">${esc(g.sector || '—')}</span>
        ${viewLocBtn}
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
          <div class="gang-bio-text">${esc(g.bio || 'No intelligence summary on file.')}</div>
        </div>
        <div class="gang-og-section">
          <div class="gang-section-title">List of OG(s)</div>
          <div class="gang-people-list">${knownOg || '<div class="gang-people-item"><div class="gang-crime-dot"></div>None on file.</div>'}</div>
        </div>
        <div class="gang-members-section">
          <div class="gang-section-title">List of Members</div>
          <div class="gang-people-list">${knownMembers || '<div class="gang-people-item"><div class="gang-crime-dot"></div>None on file.</div>'}</div>
        </div>
      </div>
    </div>`;
  return card;
}

function renderGangs(gangs) {
  const container = document.getElementById('gang-cards');
  container.innerHTML = '';
  const sorted = [...gangs].sort((a, b) => (THREAT_ORDER[a.threat] ?? 9) - (THREAT_ORDER[b.threat] ?? 9));
  sorted.forEach(g => container.appendChild(buildGangCard(g)));
  updateStats(gangs);
  renderPins();
  applyFilters();
}

function updateStats(gangs) {
  document.getElementById('stat-total').textContent = gangs.length;
  document.getElementById('stat-critical').textContent = gangs.filter(g => g.threat === 'critical').length;
  document.getElementById('stat-high').textContent = gangs.filter(g => g.threat === 'high').length;
}

// ── Load from Supabase ───────────────────────────────────────
async function loadGangs() {
  const loadingEl = document.getElementById('gang-loading');
  const cardsEl = document.getElementById('gang-cards');
  loadingEl.style.display = 'flex';
  cardsEl.style.display = 'none';
  try {
    const data = await sbFetch('gangs');
    GANGS = data || [];
    loadingEl.style.display = 'none';
    cardsEl.style.display = '';
    renderGangs(GANGS);
  } catch (e) {
    console.error('Failed to load gangs:', e);
    loadingEl.innerHTML = `<div style="text-align:center;padding:40px;font-family:'Roboto Mono',monospace;font-size:10px;letter-spacing:2px;color:var(--red-alert);">FAILED TO LOAD DATABASE — ${esc(e.message)}</div>`;
    toast('Failed to load gang database', 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  ADD / EDIT MODAL
// ══════════════════════════════════════════════════════════════

const gfImgInput = document.getElementById('gf-img-input');
const gfImgPreview = document.getElementById('gf-img-preview');
const gfImgPlaceholder = document.getElementById('gf-img-placeholder');
const gfImgZone = document.getElementById('gf-img-zone');
const gfImgUrlInput = document.getElementById('gf-img-url');
const gfLogoTabUpload = document.getElementById('gf-logo-tab-upload');
const gfLogoTabUrl = document.getElementById('gf-logo-tab-url');
const gfColorInput = document.getElementById('gf-color');
const gfColorHex = document.getElementById('gf-color-hex');
const gfPinX = document.getElementById('gf-pin-x');
const gfPinY = document.getElementById('gf-pin-y');
const gfPinRow = document.getElementById('gf-pin-status').closest('.gf-pin-row');
const gfPinStatus = document.getElementById('gf-pin-status');
const gfPinBtn = document.getElementById('gf-pin-btn');
const gfPinClear = document.getElementById('gf-pin-clear');

const ogTagInput = createTagInput(document.getElementById('gf-og-chips'), document.getElementById('gf-og-text'));
const memberTagInput = createTagInput(document.getElementById('gf-members-chips'), document.getElementById('gf-members-text'));

let _logoMode = 'upload'; // 'upload' | 'url'

function setLogoMode(mode) {
  _logoMode = mode;
  gfLogoTabUpload.classList.toggle('active', mode === 'upload');
  gfLogoTabUrl.classList.toggle('active', mode === 'url');
  gfImgZone.style.display = mode === 'upload' ? '' : 'none';
  gfImgUrlInput.style.display = mode === 'url' ? '' : 'none';
}
gfLogoTabUpload.addEventListener('click', () => setLogoMode('upload'));
gfLogoTabUrl.addEventListener('click', () => setLogoMode('url'));

gfImgInput.addEventListener('change', () => {
  const file = gfImgInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _imgBase64 = e.target.result;
    gfImgPreview.src = _imgBase64;
    gfImgPreview.style.display = 'block';
    gfImgPlaceholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
});

// keep the colour swatch and hex text field in sync
gfColorInput.addEventListener('input', () => { gfColorHex.value = gfColorInput.value; });
gfColorHex.addEventListener('input', () => {
  let v = gfColorHex.value.trim();
  if (v && !v.startsWith('#')) v = '#' + v;
  if (/^#[0-9A-Fa-f]{6}$/.test(v)) gfColorInput.value = v;
});

// ── Territory pin status (works for both a brand-new gang and an
//    existing gang that has, or doesn't yet have, a pin on the map) ──
function updatePinStatusUI() {
  const has = gfPinX.value !== '' && gfPinY.value !== '';
  gfPinRow.classList.toggle('gf-pin-set', has);
  gfPinStatus.textContent = has ? 'Pinned on the territory map' : 'Not yet placed on the map';
  gfPinBtn.textContent = has ? '📍 Change Pin on Map' : '📍 Set Pin on Map';
}

function collectDraftFromForm() {
  return {
    threat: document.getElementById('gf-threat').value,
    name: document.getElementById('gf-name').value,
    location: document.getElementById('gf-location').value,
    sector: document.getElementById('gf-sector').value,
    bio: document.getElementById('gf-bio').value,
    knownOg: ogTagInput.get(),
    knownMembers: memberTagInput.get(),
    accentColor: gfColorHex.value,
    logoMode: _logoMode,
    imgUrl: gfImgUrlInput.value,
    imgBase64: _imgBase64,
  };
}

function restoreDraftToForm(draft) {
  if (!draft) return;
  document.getElementById('gf-threat').value = draft.threat || '';
  document.getElementById('gf-name').value = draft.name || '';
  document.getElementById('gf-location').value = draft.location || '';
  document.getElementById('gf-sector').value = draft.sector || '';
  document.getElementById('gf-bio').value = draft.bio || '';
  ogTagInput.set(draft.knownOg);
  memberTagInput.set(draft.knownMembers);
  const accent = draft.accentColor || '#C9A84C';
  gfColorInput.value = accent;
  gfColorHex.value = accent;
  setLogoMode(draft.logoMode || 'upload');
  if (draft.logoMode === 'url') {
    gfImgUrlInput.value = draft.imgUrl || '';
  } else if (draft.imgBase64) {
    _imgBase64 = draft.imgBase64;
    gfImgPreview.src = draft.imgBase64;
    gfImgPreview.style.display = 'block';
    gfImgPlaceholder.style.display = 'none';
  }
}

gfPinBtn.addEventListener('click', () => {
  if (!CAN_CRUD) { toast('Insufficient clearance to place pins', 'error'); return; }
  const editId = document.getElementById('gf-edit-id').value || null;
  _pendingPinEdit = { editId, draft: collectDraftFromForm() };

  // Grab the pin's current coordinates (staged in the form) before the modal closes.
  const curXRaw = gfPinX.value, curYRaw = gfPinY.value;
  const hasCurrentPin = curXRaw !== '' && curYRaw !== '';

  closeGangModal();
  document.querySelector('.map-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  setTimeout(() => {
    if (hasCurrentPin) {
      // A pin is already placed (or staged) — auto-pan/zoom the map to it so
      // the user can see exactly where it is before repositioning it.
      panToCanvasPoint(parseFloat(curXRaw), parseFloat(curYRaw), Math.max(scale, 2.4));
    } else {
      // Nothing placed yet — start from a neutral default view.
      scale = 1; panX = 0; panY = 0; applyTransform();
    }
    setPinMode(true);
  }, 350); // let the scroll-into-view settle so viewport dimensions are stable

  toast(hasCurrentPin ? 'Click a new location on the map to move the pin' : 'Click a location on the map to place the pin', 'success');
});

gfPinClear.addEventListener('click', () => {
  gfPinX.value = '';
  gfPinY.value = '';
  updatePinStatusUI();
  toast('Pin cleared — save the record to remove it from the map', 'edit');
});

function openGangModal(editId) {
  if (!CAN_CRUD) { toast('Insufficient clearance to add entries', 'error'); return; }

  _imgBase64 = null;
  gfImgPreview.style.display = 'none';
  gfImgPlaceholder.style.display = '';
  gfImgInput.value = '';
  gfImgUrlInput.value = '';
  setLogoMode('upload');

  if (editId) {
    const g = GANGS.find(x => x.id == editId);
    if (!g) return;
    document.getElementById('gang-modal-title').textContent = 'Edit Gang';
    document.getElementById('gf-edit-id').value = g.id;
    gfPinX.value = g.pin_x ?? '';
    gfPinY.value = g.pin_y ?? '';
    document.getElementById('gf-org-id').value = 'GRD-ORG-' + String(g.org_seq || 0).padStart(3, '0');
    document.getElementById('gf-threat').value = g.threat || '';
    document.getElementById('gf-name').value = g.name || '';
    document.getElementById('gf-location').value = g.location || '';
    document.getElementById('gf-sector').value = g.sector || '';
    document.getElementById('gf-bio').value = g.bio || '';
    ogTagInput.set(g.known_og);
    memberTagInput.set(g.known_members);

    const accent = g.accent_color || '#C9A84C';
    gfColorInput.value = accent;
    gfColorHex.value = accent;

    if (g.logo_url) {
      _imgBase64 = g.logo_url;
      if (g.logo_url.startsWith('data:')) {
        setLogoMode('upload');
        gfImgPreview.src = g.logo_url;
        gfImgPreview.style.display = 'block';
        gfImgPlaceholder.style.display = 'none';
      } else {
        setLogoMode('url');
        gfImgUrlInput.value = g.logo_url;
      }
    }
  } else {
    document.getElementById('gang-modal-title').textContent = 'Add Gang';
    document.getElementById('gf-edit-id').value = '';
    document.getElementById('gf-org-id').value = 'GRD-ORG-' + String(getNextOrgSeq()).padStart(3, '0');
    document.getElementById('gf-threat').selectedIndex = 0;
    document.getElementById('gf-name').value = '';
    document.getElementById('gf-location').value = '';
    document.getElementById('gf-sector').selectedIndex = 0;
    document.getElementById('gf-bio').value = '';
    ogTagInput.clear();
    memberTagInput.clear();
    gfColorInput.value = '#C9A84C';
    gfColorHex.value = '#C9A84C';

    // if this modal was opened from a map click, stage those coords
    if (_pinCoords) {
      gfPinX.value = _pinCoords.x;
      gfPinY.value = _pinCoords.y;
      _pinCoords = null;
    } else {
      gfPinX.value = '';
      gfPinY.value = '';
    }
  }
  updatePinStatusUI();
  document.getElementById('gang-modal').classList.add('open');
}

function closeGangModal() {
  document.getElementById('gang-modal').classList.remove('open');
}

// Some Supabase tables may be missing newer columns (e.g. accent_color) if
// the schema hasn't been migrated yet. Rather than hard-failing, strip the
// offending column and retry once so the rest of the record still saves.
async function sbFetchResilient(table, opts) {
  let body = opts.body;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await sbFetch(table, { ...opts, body });
    } catch (e) {
      const m = /could not find the '(\w+)' column/i.exec(e.message || '');
      if (m && body && Object.prototype.hasOwnProperty.call(body, m[1])) {
        console.warn(`Column "${m[1]}" missing on "${table}" — add it in Supabase. Retrying without it.`);
        toast(`"${m[1]}" column missing in database — saved without it`, 'error');
        const { [m[1]]: _omit, ...rest } = body;
        body = rest;
        continue;
      }
      throw e;
    }
  }
  throw new Error('Save failed after removing unrecognized columns');
}

// ── Save (Create / Update) ───────────────────────────────────
async function saveGang() {
  const name = document.getElementById('gf-name').value.trim();
  const threat = document.getElementById('gf-threat').value || 'medium';
  const location = document.getElementById('gf-location').value.trim();
  const sector = document.getElementById('gf-sector').value;

  if (!name) { toast('Gang name is required', 'error'); return; }
  if (!location) { toast('Gang location name is required', 'error'); return; }
  if (!sector) { toast('Sector is required', 'error'); return; }

  const saveBtn = document.querySelector('.gf-save');
  saveBtn.classList.add('loading');
  saveBtn.disabled = true;

  const editId = document.getElementById('gf-edit-id').value;
  const isEdit = !!editId;
  const badge  = sessionStorage.getItem('cib_badge') || 'unknown';
  const orgSeq = isEdit ? (GANGS.find(g => g.id == editId)?.org_seq) : getNextOrgSeq();

  const pinXVal = document.getElementById('gf-pin-x').value;
  const pinYVal = document.getElementById('gf-pin-y').value;

  const urlLogo = document.getElementById('gf-img-url').value.trim();
  const logoUrl = _logoMode === 'url'
    ? (urlLogo || null)
    : (_imgBase64 || (isEdit ? GANGS.find(g => g.id == editId)?.logo_url : null));

  const payload = {
    name,
    threat,
    location,
    sector,
    bio:            document.getElementById('gf-bio').value.trim(),
    accent_color:   gfColorHex.value.trim() || '#C9A84C',
    known_og:       ogTagInput.get(),
    known_members:  memberTagInput.get(),
    logo_url:       logoUrl,
    pin_x:          pinXVal !== '' ? parseFloat(pinXVal) : null,
    pin_y:          pinYVal !== '' ? parseFloat(pinYVal) : null,
    updated_at:     new Date().toISOString(),
    updated_by:     badge,
  };

  try {
    if (isEdit) {
      const updated = await sbFetchResilient('gangs', { method: 'PATCH', body: payload, filter: `id=eq.${editId}` });
      const idx = GANGS.findIndex(g => g.id == editId);
      if (idx > -1) GANGS[idx] = Array.isArray(updated) ? updated[0] : { ...GANGS[idx], ...payload };
      await auditLog('EDIT', name, 'GRD-ORG-' + String(orgSeq).padStart(3, '0'));
      toast('Gang updated — ' + name, 'edit');
    } else {
      payload.org_seq    = orgSeq;
      payload.created_at = new Date().toISOString();
      payload.created_by = badge;
      const created = await sbFetchResilient('gangs', { method: 'POST', body: payload });
      const newGang = Array.isArray(created) ? created[0] : { ...payload, id: Date.now() };
      GANGS.push(newGang);
      await auditLog('CREATE', name, 'GRD-ORG-' + String(orgSeq).padStart(3, '0'));
      toast('Gang registered — ' + name, 'success');
    }
    renderGangs(GANGS);
    closeGangModal();
  } catch (e) {
    console.error('Save error:', e);
    toast('Save failed — ' + e.message, 'error');
    saveBtn.classList.remove('loading');
    saveBtn.disabled = false;
    return;
  }
  saveBtn.classList.remove('loading');
  saveBtn.disabled = false;
}

// ══════════════════════════════════════════════════════════════
//  DELETE
// ══════════════════════════════════════════════════════════════

function openDelModal(gangId) {
  if (!CAN_CRUD) { toast('Insufficient clearance to delete entries', 'error'); return; }
  _pendingDelId = gangId;
  const g = GANGS.find(x => x.id == gangId);
  document.getElementById('gang-del-name').textContent = g?.name || '—';
  document.getElementById('gang-del-modal').classList.add('open');
}
function closeDelModal() {
  document.getElementById('gang-del-modal').classList.remove('open');
  _pendingDelId = null;
}
async function confirmGangDelete() {
  if (!_pendingDelId) return;
  const delBtn = document.querySelector('.gang-del-confirm');
  delBtn.classList.add('loading');
  delBtn.disabled = true;

  const g = GANGS.find(x => x.id == _pendingDelId);
  try {
    await sbFetch('gangs', { method: 'DELETE', filter: `id=eq.${_pendingDelId}` });
    await auditLog('DELETE', g?.name || 'unknown', g ? 'GRD-ORG-' + String(g.org_seq || 0).padStart(3, '0') : '—');
    GANGS = GANGS.filter(x => x.id != _pendingDelId);
    renderGangs(GANGS);
    closeDelModal();
    toast('Gang record deleted — ' + (g?.name || ''), 'delete');
  } catch (e) {
    console.error('Delete error:', e);
    toast('Delete failed — ' + e.message, 'error');
    delBtn.classList.remove('loading');
    delBtn.disabled = false;
    closeDelModal();
  }
}

// ── Modal wiring ──────────────────────────────────────────────
document.getElementById('modalCloseBtn').addEventListener('click', closeGangModal);
document.getElementById('modalCancelBtn').addEventListener('click', closeGangModal);
document.getElementById('gang-modal').addEventListener('click', e => { if (e.target === document.getElementById('gang-modal')) closeGangModal(); });

document.getElementById('gangForm').addEventListener('submit', e => { e.preventDefault(); saveGang(); });

document.getElementById('delCancelBtn').addEventListener('click', closeDelModal);
document.getElementById('delConfirmBtn').addEventListener('click', confirmGangDelete);
document.getElementById('gang-del-modal').addEventListener('click', e => { if (e.target === document.getElementById('gang-del-modal')) closeDelModal(); });

document.getElementById('add-gang-btn').addEventListener('click', () => {
  if (!CAN_CRUD) { toast('Insufficient clearance to add entries', 'error'); return; }
  document.querySelector('.map-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // No pin exists yet for a brand-new gang — start from a neutral default view.
  scale = 1; panX = 0; panY = 0; applyTransform();
  setPinMode(true);
});

// ── EXPAND / COLLAPSE ────────────────────────────────────────
function toggleGang(btn) {
  const card = btn.closest('.gang-card');
  const body = card.querySelector('.gang-card-body');
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  btn.classList.toggle('expanded', !isOpen);
  btn.querySelector('span:first-child').textContent = isOpen ? 'View Full Profile' : 'Collapse Profile';
}

// ── FILTER & SEARCH ──────────────────────────────────────────
const filterBtns = document.querySelectorAll('.filter-btn');
let currentFilter = 'all';

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    applyFilters();
  });
});

document.getElementById('gang-search').addEventListener('input', applyFilters);

function applyFilters() {
  const q = document.getElementById('gang-search').value.toLowerCase().trim();
  let visible = 0;
  document.querySelectorAll('.gang-card').forEach(card => {
    const filterOk = currentFilter === 'all' || card.dataset.threat === currentFilter || card.dataset.sector === currentFilter;
    const textOk = q === '' || card.innerText.toLowerCase().includes(q);
    const show = filterOk && textOk;
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });
  document.getElementById('no-results').style.display = visible === 0 ? 'block' : 'none';
}

// ══════════════════════════════════════════════════════════════
//  AUTH + CLOCK + IDLE TIMEOUT (PortalAuth — same engine as the
//  rest of the Nexus site; must be loaded before this script)
// ══════════════════════════════════════════════════════════════

document.getElementById('logoutBtn').addEventListener('click', () => {
  if (window.PortalAuth) PortalAuth.logout();
});

if (window.PortalAuth) {
  PortalAuth.init({
    badgeEls: ['badgeDisplay'],
    clockEl:  'liveClock',
    onReady: function () {
      USER_CLASS = (sessionStorage.getItem('cib_classification') || '').toLowerCase().trim();

      if (USER_CLASS === 'unclassified' || USER_CLASS === '') {
        toast('Access denied — insufficient clearance', 'error');
        setTimeout(() => window.location.href = 'Page_Nexus.html', 1200);
        return;
      }

      CAN_CRUD = (USER_CLASS === 'top_secret' || USER_CLASS === 'secret');
      if (CAN_CRUD) document.body.classList.add('can-crud');

      const dispName = sessionStorage.getItem('cib_name') || sessionStorage.getItem('cib_badge') || '—';
      const badgeEl = document.getElementById('badgeDisplay');
      if (badgeEl) badgeEl.textContent = dispName;

      loadGangs();
    }
  });
} else {
  // PortalAuth wasn't loaded — fail closed rather than exposing the page.
  console.error('PortalAuth is not loaded. Include the shared auth script before gang.js.');
  toast('Authentication engine unavailable', 'error');
  setTimeout(() => window.location.href = 'Page_Nexus.html', 1200);
}

if (window.SiteUi) {
  SiteUi.initPageFadeTransitions({ transitionMs: 400 });
  SiteUi.initScrollReveal();
}
