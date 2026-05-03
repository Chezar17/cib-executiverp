/* ============================================================
   Investigation Report Form — report-form.js
   Uses direct DOM reads (getVal by ID) — no stale array refs.
   ============================================================ */

// ── counters for dynamic elements ──────────────────────────
let debriefCount  = 0;
let suspectCount  = 0;
let victimCount   = 0;
let witnessCount  = 0;
let evidenceCount = 0;
let currentSection = 0;
const TOTAL_SECTIONS = 7;

// ── report context ──────────────────────────────────────────
let reportId = null;

// ── helpers ────────────────────────────────────────────────
function getVal(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  return el.value.trim();
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.value = val ?? '';
}
function getCheckedRadio(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}
function setRadio(name, val) {
  if (!val) return;
  const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
  if (el) el.checked = true;
}
function getCheckboxValue(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}
function setCheckbox(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

// ── loading overlay ─────────────────────────────────────────
function showLoad(label) {
  const ov = document.getElementById('pdf-loading-overlay');
  const lb = document.getElementById('pdf-loading-label');
  if (ov) ov.style.display = 'flex';
  if (lb) lb.textContent = label || 'LOADING...';
}
function hideLoad() {
  const ov = document.getElementById('pdf-loading-overlay');
  if (ov) ov.style.display = 'none';
}

// ── section navigation ───────────────────────────────────────
function goToSection(n) {
  document.querySelectorAll('.ir-section').forEach((s, i) => s.classList.toggle('active', i === n));
  document.querySelectorAll('.ir-progress-step').forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i === n) s.classList.add('active');
    else if (i < n) s.classList.add('done');
  });
  currentSection = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function nextSection() { if (currentSection < TOTAL_SECTIONS - 1) goToSection(currentSection + 1); }
function prevSection() { if (currentSection > 0) goToSection(currentSection - 1); }

// ── remove item helper ───────────────────────────────────────
function removeItem(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ── SECTION B: Debrief entries ───────────────────────────────
function addDebrief(data) {
  debriefCount++;
  const n = debriefCount;
  const div = document.createElement('div');
  div.className = 'repeat-item';
  div.id = `debrief-${n}`;
  div.innerHTML = `
    <div class="repeat-item-header">
      <div class="repeat-item-id">ENTRY #${n}</div>
      <button class="btn-remove" onclick="removeItem('debrief-${n}')">REMOVE</button>
    </div>
    <div class="form-grid form-grid-2" style="margin-bottom:10px">
      <div class="form-group">
        <label>Title</label>
        <input type="text" id="deb-title-${n}" placeholder='e.g. "Victim Body Found"' value="${esc(data?.title)}"/>
      </div>
      <div class="form-group">
        <label>Date of Incident</label>
        <input type="date" id="deb-date-${n}" value="${esc(data?.date_of_incident)}"/>
      </div>
    </div>
    <div class="form-group">
      <label>Description / Content</label>
      <textarea id="deb-content-${n}" rows="4" placeholder="Detailed account of the incident...">${esc(data?.content)}</textarea>
    </div>`;
  document.getElementById('debriefContainer').appendChild(div);
}

// ── SECTION C: Suspects ──────────────────────────────────────
function addSuspect(data) {
  suspectCount++;
  const n = suspectCount;
  const div = document.createElement('div');
  div.className = 'repeat-item';
  div.id = `suspect-${n}`;
  div.innerHTML = `
    <div class="repeat-item-header">
      <div class="repeat-item-id">SUSPECT ID: s.${n}</div>
      <button class="btn-remove" onclick="removeItem('suspect-${n}')">REMOVE</button>
    </div>
    <div style="display:grid;grid-template-columns:130px 1fr;gap:14px;margin-bottom:12px">
      <div>
        <label style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#6B7E9B;letter-spacing:2px;display:block;margin-bottom:5px">MUGSHOT / PHOTO</label>
        <div class="img-upload-area" id="sus-imgbox-${n}" onclick="openPhotoModal('suspect',${n},event)">
          <button type="button" class="img-clear-btn" onclick="clearPhotoRow('suspect',${n},event)">✕</button>
          <div class="img-upload-icon">📷</div>
          <p>CLICK TO SET URL</p>
          <div id="sus-pthumb-${n}" class="photo-thumb-fill"></div>
          <input type="hidden" id="sus-purl-${n}" value=""/>
          <input type="hidden" id="sus-pori-${n}" value="portrait"/>
          <input type="hidden" id="sus-pcrop-${n}" value=""/>
        </div>
      </div>
      <div>
        <div class="form-grid form-grid-2" style="margin-bottom:10px">
          <div class="form-group span-2">
            <label>Full Name / AKA</label>
            <input type="text" id="sus-name-${n}" placeholder="First Last AKA Alias" value="${esc(data?.full_name)}"/>
          </div>
          <div class="form-group">
            <label>Date of Birth</label>
            <input type="date" id="sus-dob-${n}" value="${esc(data?.dob)}"/>
          </div>
          <div class="form-group">
            <label>Sex</label>
            <select id="sus-sex-${n}">
              <option value="M" ${data?.sex==='M'?'selected':''}>Male</option>
              <option value="F" ${data?.sex==='F'?'selected':''}>Female</option>
            </select>
          </div>
        </div>
        <div class="form-grid form-grid-2">
          <div class="form-group">
            <label>Race</label>
            <input type="text" id="sus-race-${n}" placeholder="AA" value="${esc(data?.race)}"/>
          </div>
          <div class="form-group">
            <label>Age</label>
            <input type="text" id="sus-age-${n}" placeholder="—" value="${esc(data?.age)}"/>
          </div>
          <div class="form-group span-2">
            <label>Welfare / Occupation</label>
            <input type="text" id="sus-occ-${n}" placeholder="e.g. Gang Member" value="${esc(data?.welfare_occupation)}"/>
          </div>
        </div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label>Description (Physical / Behavioral)</label>
      <textarea id="sus-desc-${n}" rows="3" placeholder="Physical and behavioral description...">${esc(data?.description)}</textarea>
    </div>
    <div class="form-group">
      <label>Interrogation Summary</label>
      <textarea id="sus-interro-${n}" rows="3" placeholder="Summary of interrogation if conducted...">${esc(data?.interrogation_summary)}</textarea>
    </div>`;
  document.getElementById('suspectContainer').appendChild(div);
  syncPhotoRowFromData('suspect', n, data || {});
}

// ── SECTION D: Victims ───────────────────────────────────────
function addVictim(data) {
  victimCount++;
  const n = victimCount;
  const div = document.createElement('div');
  div.className = 'repeat-item';
  div.id = `victim-${n}`;
  div.innerHTML = `
    <div class="repeat-item-header">
      <div class="repeat-item-id">VICTIM ID: v.${n}</div>
      <button class="btn-remove" onclick="removeItem('victim-${n}')">REMOVE</button>
    </div>
    <div style="display:grid;grid-template-columns:130px 1fr;gap:14px;margin-bottom:14px">
      <div>
        <label style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#6B7E9B;letter-spacing:2px;display:block;margin-bottom:5px">VICTIM PHOTO</label>
        <div class="img-upload-area" id="vic-imgbox-${n}" onclick="openPhotoModal('victim',${n},event)">
          <button type="button" class="img-clear-btn" onclick="clearPhotoRow('victim',${n},event)">✕</button>
          <div class="img-upload-icon">📷</div>
          <p>CLICK TO SET URL</p>
          <div id="vic-pthumb-${n}" class="photo-thumb-fill"></div>
          <input type="hidden" id="vic-purl-${n}" value=""/>
          <input type="hidden" id="vic-pori-${n}" value="portrait"/>
          <input type="hidden" id="vic-pcrop-${n}" value=""/>
        </div>
      </div>
      <div>
        <div class="form-grid form-grid-2" style="margin-bottom:10px">
          <div class="form-group span-2">
            <label>Full Name / AKA</label>
            <input type="text" id="vic-name-${n}" placeholder="First Last, AKA ..." value="${esc(data?.full_name)}"/>
          </div>
          <div class="form-group">
            <label>Age</label>
            <input type="text" id="vic-age-${n}" placeholder="—" value="${esc(data?.age)}"/>
          </div>
          <div class="form-group">
            <label>Sex</label>
            <select id="vic-sex-${n}">
              <option value="M" ${data?.sex==='M'?'selected':''}>Male</option>
              <option value="F" ${data?.sex==='F'?'selected':''}>Female</option>
            </select>
          </div>
        </div>
        <div class="form-grid form-grid-3">
          <div class="form-group">
            <label>Race</label>
            <input type="text" id="vic-race-${n}" placeholder="e.g. AA" value="${esc(data?.race)}"/>
          </div>
          <div class="form-group">
            <label>Welfare</label>
            <select id="vic-welfare-${n}">
              <option ${welfareMatch(data?.welfare_occupation,'Deceased')}>Deceased</option>
              <option ${welfareMatch(data?.welfare_occupation,'Alive')}>Alive</option>
              <option ${welfareMatch(data?.welfare_occupation,'Critical')}>Critical</option>
              <option ${welfareMatch(data?.welfare_occupation,'Unknown')}>Unknown</option>
            </select>
          </div>
          <div class="form-group">
            <label>Occupation</label>
            <input type="text" id="vic-occ-${n}" placeholder="e.g. Ex-Gang Member" value="${esc(welfareOccPart(data?.welfare_occupation))}"/>
          </div>
        </div>
      </div>
    </div>
    <hr class="ir-divider"/>
    <div class="form-group" style="margin-bottom:14px">
      <label>Additional Notes / Family</label>
      <textarea id="vic-notes-${n}" rows="2" placeholder="Any additional notes...">${esc(data?.notes)}</textarea>
    </div>
    <hr class="ir-divider"/>
    <div style="margin-bottom:10px">
      <div class="ir-card-title" style="margin-bottom:12px">AUTOPSY REPORT</div>
      <div class="form-grid form-grid-2" style="margin-bottom:10px">
        <div class="form-group">
          <label>Performed By</label>
          <input type="text" id="vic-doctor-${n}" placeholder="Dr. Name" value="${esc(data?.autopsy_by)}"/>
        </div>
      </div>
      <div class="form-group">
        <label>Autopsy Summary</label>
        <textarea id="vic-autopsy-${n}" rows="5" placeholder="Detailed findings from forensic examination...">${esc(data?.autopsy_summary)}</textarea>
      </div>
    </div>`;
  document.getElementById('victimContainer').appendChild(div);
  syncPhotoRowFromData('victim', n, data || {});
}

// Helper: select welfare from stored string
function welfareMatch(stored, val) {
  if (!stored) return val === 'Unknown' ? 'selected' : '';
  return stored.startsWith(val) ? 'selected' : '';
}
// Helper: extract occupation from "Welfare / Occupation" combined field
function welfareOccPart(stored) {
  if (!stored) return '';
  const parts = stored.split(' / ');
  return parts.length > 1 ? parts.slice(1).join(' / ') : '';
}

// ── SECTION E: Witnesses ─────────────────────────────────────
function addWitness(data) {
  witnessCount++;
  const n = witnessCount;
  const div = document.createElement('div');
  div.className = 'repeat-item';
  div.id = `witness-${n}`;
  div.innerHTML = `
    <div class="repeat-item-header">
      <div class="repeat-item-id">WITNESS ID: w.${n}</div>
      <button class="btn-remove" onclick="removeItem('witness-${n}')">REMOVE</button>
    </div>
    <div class="form-grid form-grid-3" style="margin-bottom:10px">
      <div class="form-group">
        <label>Full Name</label>
        <input type="text" id="wit-name-${n}" placeholder="Witness Name" value="${esc(data?.full_name)}"/>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select id="wit-status-${n}">
          <option ${selMatch(data?.status,'Witness of motives')}>Witness of motives</option>
          <option ${selMatch(data?.status,'Witness of possible killer')}>Witness of possible killer</option>
          <option ${selMatch(data?.status,'Witness Evidence')}>Witness Evidence</option>
          <option ${selMatch(data?.status,'1st Forensic on scene')}>1st Forensic on scene</option>
          <option ${selMatch(data?.status,'Other')}>Other</option>
        </select>
      </div>
      <div class="form-group">
        <label>Welfare</label>
        <select id="wit-welfare-${n}">
          <option ${selMatch(data?.welfare,'Alive')}>Alive</option>
          <option ${selMatch(data?.welfare,'Deceased')}>Deceased</option>
          <option ${selMatch(data?.welfare,'Unknown')}>Unknown</option>
        </select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <label>Occupation</label>
      <input type="text" id="wit-occ-${n}" placeholder="e.g. Detective of CIB" value="${esc(data?.welfare_occupation)}"/>
    </div>
    <div class="form-group">
      <label>Affidavit / Testimony Content</label>
      <textarea id="wit-content-${n}" rows="5" placeholder="Full testimony content...">${esc(data?.content)}</textarea>
    </div>`;
  document.getElementById('witnessContainer').appendChild(div);
}

// ── SECTION F: Evidence ──────────────────────────────────────
function addEvidence(data) {
  evidenceCount++;
  const n = evidenceCount;
  const div = document.createElement('div');
  div.className = 'repeat-item';
  div.id = `evidence-${n}`;
  div.innerHTML = `
    <div class="repeat-item-header">
      <div class="repeat-item-id">EVIDENCE ID: e.${n}</div>
      <button class="btn-remove" onclick="removeItem('evidence-${n}')">REMOVE</button>
    </div>
    <div style="display:grid;grid-template-columns:130px 1fr;gap:14px;margin-bottom:12px">
      <div>
        <label style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#6B7E9B;letter-spacing:2px;display:block;margin-bottom:5px">EXHIBIT IMAGE</label>
        <div class="img-upload-area" id="ev-imgbox-${n}" onclick="openPhotoModal('evidence',${n},event)">
          <button type="button" class="img-clear-btn" onclick="clearPhotoRow('evidence',${n},event)">✕</button>
          <div class="img-upload-icon">📷</div>
          <p>CLICK TO SET URL</p>
          <div id="ev-pthumb-${n}" class="photo-thumb-fill"></div>
          <input type="hidden" id="ev-purl-${n}" value=""/>
          <input type="hidden" id="ev-pori-${n}" value="${data?.image_orientation === 'portrait' ? 'portrait' : 'landscape'}"/>
          <input type="hidden" id="ev-pcrop-${n}" value=""/>
        </div>
      </div>
      <div>
        <div class="form-grid form-grid-3" style="margin-bottom:10px">
          <div class="form-group">
            <label>Name of Evidence</label>
            <input type="text" id="ev-name-${n}" placeholder="e.g. Primary Crime Scene" value="${esc(data?.name)}"/>
          </div>
          <div class="form-group">
            <label>Evidence Was</label>
            <select id="ev-was-${n}">
              <option ${selMatch(data?.evidence_was,'Secured')}>Secured</option>
              <option ${selMatch(data?.evidence_was,'Unsecured')}>Unsecured</option>
              <option ${selMatch(data?.evidence_was,'Destroyed')}>Destroyed</option>
              <option ${selMatch(data?.evidence_was,'Lost')}>Lost</option>
            </select>
          </div>
          <div class="form-group">
            <label>Status of Evidence</label>
            <select id="ev-status-${n}">
              <option ${selMatch(data?.evidence_status,'Recovered')}>Recovered</option>
              <option ${selMatch(data?.evidence_status,'Pending')}>Pending</option>
              <option ${selMatch(data?.evidence_status,'Submitted to Lab')}>Submitted to Lab</option>
              <option ${selMatch(data?.evidence_status,'Released')}>Released</option>
            </select>
          </div>
        </div>
        <div class="form-grid form-grid-2" style="margin-bottom:10px">
          <div class="form-group">
            <label>Date of Retrieval</label>
            <input type="date" id="ev-date-${n}" value="${esc(data?.date_of_retrieval)}"/>
          </div>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>Summary of Evidence</label>
      <textarea id="ev-summary-${n}" rows="3" placeholder="Detailed description of evidence found...">${esc(data?.summary)}</textarea>
    </div>`;
  document.getElementById('evidenceContainer').appendChild(div);
  syncPhotoRowFromData('evidence', n, data || {});
}

// Helper: select match
function selMatch(stored, val) {
  return stored === val ? 'selected' : '';
}

// ── escape HTML for safe innerHTML insertion ─────────────────
function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Remote image modal (Cropper.js) ──────────────────────────────────
let irPhotoModalCropper = null;
/** @type {{ kind: string, rowN: number } | null} */
let irPhotoModalContext = null;

function photoPrefix(kind) {
  if (kind === 'suspect') return 'sus';
  if (kind === 'victim') return 'vic';
  return 'ev';
}

function storedImageTriple(kind, data) {
  if (!data || typeof data !== 'object')
    return { url: '', orientation: kind === 'evidence' ? 'landscape' : 'portrait', crop: null };
  if (kind === 'suspect')
    return {
      url: data.mugshot_url || '',
      orientation: String(data.mugshot_orientation || 'portrait').toLowerCase(),
      crop: cropFromDb(data.mugshot_crop),
    };
  if (kind === 'victim')
    return {
      url: data.photo_url || '',
      orientation: String(data.photo_orientation || 'portrait').toLowerCase(),
      crop: cropFromDb(data.photo_crop),
    };
  return {
    url: data.image_url || '',
    orientation: String(data.image_orientation || 'landscape').toLowerCase(),
    crop: cropFromDb(data.image_crop),
  };
}

/** Normalize crop value from API (object or JSON string). */
function cropFromDb(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) return isValidNormalizedCrop(raw) ? raw : null;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return isValidNormalizedCrop(o) ? o : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function isValidNormalizedCrop(o) {
  if (!o || typeof o !== 'object') return false;
  const nx = Number(o.nx);
  const ny = Number(o.ny);
  const nw = Number(o.nw);
  const nh = Number(o.nh);
  if (![nx, ny, nw, nh].every((x) => Number.isFinite(x))) return false;
  if (nw < 1e-4 || nh < 1e-4 || nx < 0 || ny < 0 || nx + nw > 1.002 || ny + nh > 1.002) return false;
  return true;
}

/** Clamp fractional crop so rounding/Cropper never exceeds bounds; keeps crop usable server-side. */
function clampNormalizedCrop(pack) {
  let nx = Number(pack.nx);
  let ny = Number(pack.ny);
  let nw = Number(pack.nw);
  let nh = Number(pack.nh);
  nx = Math.max(0, Math.min(nx, 1));
  ny = Math.max(0, Math.min(ny, 1));
  nw = Math.max(1e-4, Math.min(nw, 1 - nx));
  nh = Math.max(1e-4, Math.min(nh, 1 - ny));
  return { nx, ny, nw, nh };
}

function getCropperConstructor() {
  const w = typeof window !== 'undefined' ? window : {};
  const C = w.Cropper;
  if (typeof C === 'function') return C;
  if (C && typeof C.default === 'function') return C.default;
  return null;
}

/** Cropper leaves wrappers on <img>; replace element before each init so cropping reliably works. */
function ensureFreshModalImage() {
  destroyIrPhotoCropper();
  const wrap = document.querySelector('.ir-photo-modal-crop-wrap');
  if (!wrap) return null;
  wrap.innerHTML = '';
  const nu = document.createElement('img');
  nu.id = 'irPhotoModalImg';
  nu.alt = '';
  nu.style.cssText = 'max-width:100%;display:block';
  wrap.appendChild(nu);
  return nu;
}

function parseCropFromHidden(raw) {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return isValidNormalizedCrop(o) ? o : null;
  } catch (_) {
    return null;
  }
}

function applyNormalizedCropBg(el, crop) {
  if (!el) return;
  if (!crop) {
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center center';
    return;
  }
  const { nx, ny, nw, nh } = crop;
  if (nw >= 0.999 && nh >= 0.999) {
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center center';
    return;
  }
  const sx = (100 / nw).toFixed(6);
  const sy = (100 / nh).toFixed(6);
  const px = nw >= 0.999 ? 50 : (nx / (1 - nw)) * 100;
  const py = nh >= 0.999 ? 50 : (ny / (1 - nh)) * 100;
  el.style.backgroundSize = `${sx}% ${sy}%`;
  el.style.backgroundPosition = `${px.toFixed(4)}% ${py.toFixed(4)}%`;
}

function renderPhotoThumb(kind, rowN) {
  const p = photoPrefix(kind);
  const thumb = document.getElementById(`${p}-pthumb-${rowN}`);
  const urlEl = document.getElementById(`${p}-purl-${rowN}`);
  const cropEl = document.getElementById(`${p}-pcrop-${rowN}`);
  const oriEl = document.getElementById(`${p}-pori-${rowN}`);
  const box = document.getElementById(
    kind === 'suspect' ? `sus-imgbox-${rowN}` : kind === 'victim' ? `vic-imgbox-${rowN}` : `ev-imgbox-${rowN}`,
  );
  if (!thumb || !urlEl || !box) return;
  const ori = ((oriEl && oriEl.value) || 'portrait').toLowerCase();
  const landscape = ori === 'landscape';
  if (kind === 'evidence') {
    thumb.style.aspectRatio = landscape ? '180 / 110' : '110 / 180';
  } else {
    thumb.style.aspectRatio = landscape ? '150 / 120' : '120 / 150';
  }
  const url = (urlEl.value || '').trim();
  const crop = parseCropFromHidden(cropEl ? cropEl.value : '');
  if (!url) {
    thumb.style.backgroundImage = '';
    thumb.style.backgroundSize = '';
    thumb.style.backgroundPosition = '';
    box.classList.remove('has-image');
    return;
  }
  box.classList.add('has-image');
  thumb.style.backgroundImage = `url(${JSON.stringify(url)})`;
  thumb.style.backgroundRepeat = 'no-repeat';
  applyNormalizedCropBg(thumb, crop);
}

function syncPhotoRowFromData(kind, rowN, data) {
  const p = photoPrefix(kind);
  const u = document.getElementById(`${p}-purl-${rowN}`);
  const o = document.getElementById(`${p}-pori-${rowN}`);
  const c = document.getElementById(`${p}-pcrop-${rowN}`);
  if (!u || !o || !c) return;
  const t = storedImageTriple(kind, data);
  u.value = t.url || '';
  o.value = t.orientation === 'landscape' ? 'landscape' : 'portrait';
  c.value = t.crop && isValidNormalizedCrop(t.crop) ? JSON.stringify(t.crop) : '';
  renderPhotoThumb(kind, rowN);
}

function destroyIrPhotoCropper() {
  if (irPhotoModalCropper) {
    try {
      irPhotoModalCropper.destroy();
    } catch (_) {
      /* ignore */
    }
    irPhotoModalCropper = null;
  }
}

function modalAspectRatio() {
  const orientL = document.getElementById('irPhotoModalOrientL');
  const landscape = orientL && orientL.checked;
  if (!irPhotoModalContext) return 1;
  const { kind } = irPhotoModalContext;
  if (kind === 'evidence') return landscape ? 180 / 110 : 110 / 180;
  return landscape ? 150 / 120 : 120 / 150;
}

function irPhotoModalOrientChanged() {
  if (!irPhotoModalCropper) return;
  try {
    irPhotoModalCropper.setAspectRatio(modalAspectRatio());
  } catch (_) {
    /* if ratio update fails, user can Reload preview */
  }
}

function openPhotoModal(kind, rowN, evt) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }
  irPhotoModalContext = { kind, rowN };
  const p = photoPrefix(kind);
  const url = (document.getElementById(`${p}-purl-${rowN}`)?.value || '').trim();
  const ori = (document.getElementById(`${p}-pori-${rowN}`)?.value || (kind === 'evidence' ? 'landscape' : 'portrait')).toLowerCase();

  ensureFreshModalImage();

  const urlInput = document.getElementById('irPhotoModalUrl');
  if (urlInput) urlInput.value = url;

  const rp = document.getElementById('irPhotoModalOrientP');
  const rl = document.getElementById('irPhotoModalOrientL');
  if (rp && rl) {
    rp.checked = ori !== 'landscape';
    rl.checked = ori === 'landscape';
  }

  const shell = document.getElementById('irPhotoModal');
  if (shell) {
    shell.classList.add('is-open');
    shell.setAttribute('aria-hidden', 'false');
  }
  document.addEventListener('keydown', irPhotoModalEsc);

  if (url) {
    queueMicrotask(() => irPhotoModalLoadPreview());
  }
}

function closePhotoModal() {
  destroyIrPhotoCropper();
  ensureFreshModalImage();
  const shell = document.getElementById('irPhotoModal');
  if (shell) {
    shell.classList.remove('is-open');
    shell.setAttribute('aria-hidden', 'true');
  }
  irPhotoModalContext = null;
  document.removeEventListener('keydown', irPhotoModalEsc);
}

function irPhotoModalEsc(e) {
  if (e.key === 'Escape') closePhotoModal();
}

function irPhotoModalLoadPreview() {
  const url = document.getElementById('irPhotoModalUrl').value.trim();
  if (!url) {
    if (typeof PortalAuth !== 'undefined' && PortalAuth.showToast)
      PortalAuth.showToast('Enter an image URL first', 'error');
    return;
  }
  const CropperCtor = getCropperConstructor();
  if (!CropperCtor) {
    if (typeof PortalAuth !== 'undefined' && PortalAuth.showToast)
      PortalAuth.showToast('Cropper.js failed to load (check network / CDN).', 'error');
    return;
  }
  const img = ensureFreshModalImage();
  if (!img) return;
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      irPhotoModalCropper = new CropperCtor(img, {
        aspectRatio: modalAspectRatio(),
        viewMode: 1,
        autoCropArea: 0.92,
        responsive: true,
        restore: false,
      });
    } catch (err) {
      if (typeof PortalAuth !== 'undefined' && PortalAuth.showToast)
        PortalAuth.showToast('Cropper failed: ' + (err?.message || err), 'error');
      return;
    }
    const ctx = irPhotoModalContext;
    if (ctx && irPhotoModalCropper) {
      const p = photoPrefix(ctx.kind);
      const cropRaw = document.getElementById(`${p}-pcrop-${ctx.rowN}`)?.value;
      const saved = parseCropFromHidden(cropRaw);
      if (saved && img.naturalWidth && img.naturalHeight) {
        irPhotoModalCropper.setData({
          x: saved.nx * img.naturalWidth,
          y: saved.ny * img.naturalHeight,
          width: saved.nw * img.naturalWidth,
          height: saved.nh * img.naturalHeight,
        });
      }
    }
  };
  img.onerror = () => {
    if (typeof PortalAuth !== 'undefined' && PortalAuth.showToast)
      PortalAuth.showToast('Image failed to load (CORS or invalid URL). You can still save the URL without crop.', 'error');
  };
  img.src = url;
}

function irPhotoModalSave() {
  const ctx = irPhotoModalContext;
  if (!ctx) return closePhotoModal();
  const url = document.getElementById('irPhotoModalUrl').value.trim();
  if (!url) {
    if (typeof PortalAuth !== 'undefined' && PortalAuth.showToast) PortalAuth.showToast('URL required', 'error');
    return;
  }
  const orientL = document.getElementById('irPhotoModalOrientL');
  const orient = orientL && orientL.checked ? 'landscape' : 'portrait';
  const p = photoPrefix(ctx.kind);
  const img = document.getElementById('irPhotoModalImg');
  let cropStr = '';
  if (irPhotoModalCropper && img && img.naturalWidth && img.naturalHeight) {
    try {
      const d = irPhotoModalCropper.getData(true);
      const nx = d.x / img.naturalWidth;
      const ny = d.y / img.naturalHeight;
      const nw = d.width / img.naturalWidth;
      const nh = d.height / img.naturalHeight;
      const pack = clampNormalizedCrop({ nx, ny, nw, nh });
      if (isValidNormalizedCrop(pack)) cropStr = JSON.stringify(pack);
    } catch (_) {
      /* leave empty */
    }
  }
  document.getElementById(`${p}-purl-${ctx.rowN}`).value = url;
  document.getElementById(`${p}-pori-${ctx.rowN}`).value = orient;
  document.getElementById(`${p}-pcrop-${ctx.rowN}`).value = cropStr;
  renderPhotoThumb(ctx.kind, ctx.rowN);
  closePhotoModal();
}

function clearPhotoRow(kind, rowN, evt) {
  evt.preventDefault();
  evt.stopPropagation();
  const p = photoPrefix(kind);
  const u = document.getElementById(`${p}-purl-${rowN}`);
  const o = document.getElementById(`${p}-pori-${rowN}`);
  const c = document.getElementById(`${p}-pcrop-${rowN}`);
  if (u) u.value = '';
  if (o) o.value = kind === 'evidence' ? 'landscape' : 'portrait';
  if (c) c.value = '';
  renderPhotoThumb(kind, rowN);
}

// ── collect dynamic sections from DOM ───────────────────────
function collectDebriefs() {
  const out = [];
  document.querySelectorAll('[id^="deb-title-"]').forEach(el => {
    const n = el.id.replace('deb-title-', '');
    if (!document.getElementById(`debrief-${n}`)) return;
    out.push({
      sort_order : out.length,
      title      : getVal(`deb-title-${n}`) || null,
      date_of_incident : getVal(`deb-date-${n}`) || null,
      content    : getVal(`deb-content-${n}`) || null
    });
  });
  return out;
}

function collectSuspects() {
  const out = [];
  document.querySelectorAll('[id^="sus-name-"]').forEach(el => {
    const n = el.id.replace('sus-name-', '');
    if (!document.getElementById(`suspect-${n}`)) return;
    out.push({
      sort_order          : out.length,
      id_code             : `s.${out.length + 1}`,
      full_name           : getVal(`sus-name-${n}`) || null,
      dob                 : getVal(`sus-dob-${n}`) || null,
      sex                 : getVal(`sus-sex-${n}`) || 'M',
      age                 : getVal(`sus-age-${n}`) || null,
      race                : getVal(`sus-race-${n}`) || null,
      welfare_occupation  : getVal(`sus-occ-${n}`) || null,
      description         : getVal(`sus-desc-${n}`) || null,
      interrogation_summary: getVal(`sus-interro-${n}`) || null,
      telephone           : null,
      family              : null,
      mugshot_url           : getVal(`sus-purl-${n}`) || null,
      mugshot_orientation   : getVal(`sus-pori-${n}`) || 'portrait',
      mugshot_crop          : parseCropFromHidden(getVal(`sus-pcrop-${n}`)),
      interrogation_url   : null
    });
  });
  return out;
}

function collectVictims() {
  const out = [];
  document.querySelectorAll('[id^="vic-name-"]').forEach(el => {
    const n = el.id.replace('vic-name-', '');
    if (!document.getElementById(`victim-${n}`)) return;
    const welfare = getVal(`vic-welfare-${n}`);
    const occ     = getVal(`vic-occ-${n}`);
    const welfareOcc = occ ? `${welfare} / ${occ}` : welfare;
    out.push({
      sort_order      : out.length,
      id_code         : `v.${out.length + 1}`,
      full_name       : getVal(`vic-name-${n}`) || null,
      age             : getVal(`vic-age-${n}`) || null,
      sex             : getVal(`vic-sex-${n}`) || 'M',
      race            : getVal(`vic-race-${n}`) || null,
      telephone       : null,
      welfare_occupation : welfareOcc || null,
      notes           : getVal(`vic-notes-${n}`) || null,
      family          : null,
      autopsy_by      : getVal(`vic-doctor-${n}`) || null,
      autopsy_summary : getVal(`vic-autopsy-${n}`) || null,
      photo_url       : getVal(`vic-purl-${n}`) || null,
      photo_orientation : getVal(`vic-pori-${n}`) || 'portrait',
      photo_crop      : parseCropFromHidden(getVal(`vic-pcrop-${n}`)),
    });
  });
  return out;
}

function collectWitnesses() {
  const out = [];
  document.querySelectorAll('[id^="wit-name-"]').forEach(el => {
    const n = el.id.replace('wit-name-', '');
    if (!document.getElementById(`witness-${n}`)) return;
    out.push({
      sort_order        : out.length,
      id_code           : `w.${out.length + 1}`,
      full_name         : getVal(`wit-name-${n}`) || null,
      status            : getVal(`wit-status-${n}`) || null,
      welfare           : getVal(`wit-welfare-${n}`) || null,
      welfare_occupation: getVal(`wit-occ-${n}`) || null,
      content           : getVal(`wit-content-${n}`) || null,
      telephone         : null,
      family            : null
    });
  });
  return out;
}

function collectEvidences() {
  const out = [];
  document.querySelectorAll('[id^="ev-name-"]').forEach(el => {
    const n = el.id.replace('ev-name-', '');
    if (!document.getElementById(`evidence-${n}`)) return;
    out.push({
      sort_order       : out.length,
      id_code          : `e.${out.length + 1}`,
      name             : getVal(`ev-name-${n}`) || null,
      evidence_was     : getVal(`ev-was-${n}`) || null,
      evidence_status  : getVal(`ev-status-${n}`) || null,
      date_of_retrieval: getVal(`ev-date-${n}`) || null,
      summary          : getVal(`ev-summary-${n}`) || null,
      image_url        : getVal(`ev-purl-${n}`) || null,
      image_orientation : getVal(`ev-pori-${n}`) || 'landscape',
      image_crop       : parseCropFromHidden(getVal(`ev-pcrop-${n}`)),
    });
  });
  return out;
}

// ── build full save payload ──────────────────────────────────
function buildPayload() {
  // case_referred_to — collect checked checkboxes, join as CSV
  const refIds = ['ref_lspd','ref_lscs','ref_sast','ref_doj','ref_doc'];
  const refs = refIds.filter(id => getCheckboxValue(id)).map(id => id.replace('ref_','').toUpperCase());

  return {
    case_title               : getVal('case_title') || null,
    case_number              : getVal('case_number') || null,
    category                 : getVal('category') || 'A',
    offense_type             : getVal('offense_type') || null,
    mdw_incident_number      : getVal('mdw_incident_number') || null,
    building_number          : getVal('building_number') || null,
    address                  : getVal('address') || null,
    bureau_name              : getVal('bureau_name') || null,
    agency_code              : getVal('agency_code') || null,
    specific_location        : getVal('specific_location') || null,
    location_code            : getVal('location_code') || null,
    date_of_offense          : getVal('date_of_offense') || null,
    time_of_offense          : getVal('time_of_offense') || null,
    day_of_offense           : getVal('day_of_offense') || null,
    date_reported            : getVal('date_reported') || null,
    day_reported             : getVal('day_reported') || null,
    jurisdiction_lspd        : getCheckboxValue('jur_lspd'),
    jurisdiction_sast        : getCheckboxValue('jur_sast'),
    jurisdiction_lscs        : getCheckboxValue('jur_lscs'),
    jurisdiction_state       : getCheckboxValue('jur_state'),
    lead_investigators       : getVal('lead_investigators') || null,
    prosecutor               : getVal('prosecutor') || null,
    prosecutor_time_start    : getVal('prosecutor_time_start') || null,
    prosecutor_time_end      : getVal('prosecutor_time_end') || null,
    suspect_status           : getCheckedRadio('suspectStatus') || null,
    suspect_disposition      : getCheckedRadio('suspectDisp') || null,
    suspect_notes            : getVal('suspect_notes') || null,
    closure_summary          : getVal('closure_summary') || null,
    closure_forensic         : getVal('closure_forensic') || null,
    closure_suspect_id       : getVal('closure_suspect_id') || null,
    closure_final_disposition: getVal('closure_final_disposition') || null,
    closure_time_received    : getVal('closure_time_received') || null,
    closure_time_arrived     : getVal('closure_time_arrived') || null,
    closure_type             : getCheckedRadio('closure_type') || 'CID',
    closure_detective_name   : getVal('closure_detective_name') || null,
    closure_date             : getVal('closure_date') || null,
    closure_returned_to_service: getVal('closure_returned_to_service') || null,
    case_referred_to         : refs.join(',') || null,
    case_status              : getVal('case_status') || 'OPEN',
    prosecutor_final_name    : getVal('prosecutor_final_name') || null,
    prosecutor_final_occupation: getVal('prosecutor_final_occupation') || null,
    detective_how_closed     : getVal('detective_how_closed') || null,
    detective_suspect_developed : getCheckboxValue('det_suspect_developed'),
    detective_suspect_arrested  : getCheckboxValue('det_suspect_arrested'),
    detective_entered_forensics : getCheckboxValue('det_entered_forensics'),
    detective_evidence_recovered: getCheckboxValue('det_evidence_recovered'),
    detective_value_of_property : getVal('detective_value_of_property') || null,
    detective_cleared_forensics : getCheckboxValue('det_cleared_forensics'),
    detective_referred_to    : getVal('detective_referred_to') || null,
    detective_date_referral  : getVal('detective_date_referral') || null,
    debrief_entries          : collectDebriefs(),
    victims                  : collectVictims(),
    suspects                 : collectSuspects(),
    witnesses                : collectWitnesses(),
    evidences                : collectEvidences()
  };
}

// ── validate required fields ─────────────────────────────────
function validateForm() {
  const required = [
    { id: 'case_title', label: 'Case Title', section: 0 }
  ];
  for (const f of required) {
    if (!getVal(f.id)) {
      goToSection(f.section);
      const el = document.getElementById(f.id);
      if (el) { el.focus(); el.style.borderColor = '#C0392B'; }
      PortalAuth.showToast(`${f.label} is required`, 'error');
      setTimeout(() => { if (el) el.style.borderColor = ''; }, 3000);
      return false;
    }
  }
  return true;
}

// ── API: save report ─────────────────────────────────────────
async function saveReport() {
  if (!validateForm()) return;
  const btn = document.getElementById('saveBtn');
  const payload = buildPayload();
  showLoad('SAVING REPORT...');
  if (btn) { btn.disabled = true; btn.textContent = 'SAVING...'; }
  try {
    const token = sessionStorage.getItem('cib_token');
    const url   = reportId ? `/api/reports/${reportId}` : '/api/reports';
    const method = reportId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-session-token': token },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    if (data.report?.case_number) {
      setVal('case_number', data.report.case_number);
    }
    if (!reportId && data.report?.id) {
      reportId = data.report.id;
      window.history.replaceState(null, '', `?id=${reportId}`);
    }
    PortalAuth.showToast('Report saved successfully', 'success');
  } catch (err) {
    PortalAuth.showToast('Save failed: ' + err.message, 'error');
  } finally {
    hideLoad();
    if (btn) { btn.disabled = false; btn.textContent = 'SAVE REPORT'; }
  }
}

// ── API: load report ─────────────────────────────────────────
async function loadReport(id) {
  showLoad('LOADING REPORT...');
  try {
    const token = sessionStorage.getItem('cib_token');
    const res = await fetch(`/api/reports/${id}`, {
      headers: { 'x-session-token': token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load');
    populateForm(data.report);
  } catch (err) {
    PortalAuth.showToast('Could not load report: ' + err.message, 'error');
  } finally {
    hideLoad();
  }
}

// ── populate form from API response ─────────────────────────
function populateForm(r) {
  if (!r) return;

  // Page title
  const title = document.getElementById('formPageTitle');
  if (title) title.textContent = r.case_title ? `EDIT — ${r.case_title}` : 'EDIT INVESTIGATION REPORT';

  // Main fields
  setVal('case_title',    r.case_title);
  setVal('case_number',   r.case_number);
  setVal('category',      r.category);
  setVal('offense_type',  r.offense_type);
  setVal('mdw_incident_number', r.mdw_incident_number);
  setVal('building_number',  r.building_number);
  setVal('address',          r.address);
  setVal('bureau_name',      r.bureau_name);
  setVal('agency_code',      r.agency_code);
  setVal('specific_location',r.specific_location);
  setVal('location_code',    r.location_code);
  setVal('date_of_offense',  r.date_of_offense);
  setVal('time_of_offense',  r.time_of_offense);
  setVal('day_of_offense',   r.day_of_offense);
  setVal('date_reported',    r.date_reported);
  setVal('day_reported',     r.day_reported);
  setCheckbox('jur_lspd',  r.jurisdiction_lspd);
  setCheckbox('jur_sast',  r.jurisdiction_sast);
  setCheckbox('jur_lscs',  r.jurisdiction_lscs);
  setCheckbox('jur_state', r.jurisdiction_state);
  setVal('lead_investigators',    r.lead_investigators);
  setVal('prosecutor',            r.prosecutor);
  setVal('prosecutor_time_start', r.prosecutor_time_start);
  setVal('prosecutor_time_end',   r.prosecutor_time_end);
  setRadio('suspectStatus', r.suspect_status);
  setRadio('suspectDisp',   r.suspect_disposition);
  setVal('suspect_notes',   r.suspect_notes);
  setVal('closure_summary',           r.closure_summary);
  setVal('closure_forensic',          r.closure_forensic);
  setVal('closure_suspect_id',        r.closure_suspect_id);
  setVal('closure_final_disposition', r.closure_final_disposition);
  setVal('closure_time_received',   r.closure_time_received);
  setVal('closure_time_arrived',    r.closure_time_arrived);
  setRadio('closure_type',          r.closure_type);
  setVal('closure_detective_name',  r.closure_detective_name);
  setVal('closure_date',            r.closure_date);
  setVal('closure_returned_to_service', r.closure_returned_to_service);
  setVal('case_status',             r.case_status);
  setVal('detective_how_closed',    r.detective_how_closed);
  setVal('prosecutor_final_name',        r.prosecutor_final_name);
  setVal('prosecutor_final_occupation',  r.prosecutor_final_occupation);
  setCheckbox('det_suspect_developed',  r.detective_suspect_developed);
  setCheckbox('det_suspect_arrested',   r.detective_suspect_arrested);
  setCheckbox('det_entered_forensics',  r.detective_entered_forensics);
  setCheckbox('det_evidence_recovered', r.detective_evidence_recovered);
  setCheckbox('det_cleared_forensics',  r.detective_cleared_forensics);
  setVal('detective_value_of_property', r.detective_value_of_property);
  setVal('detective_referred_to',       r.detective_referred_to);
  setVal('detective_date_referral',     r.detective_date_referral);

  // Case referred to checkboxes (stored as CSV, e.g. "LSPD,DOJ")
  if (r.case_referred_to) {
    const vals = r.case_referred_to.split(',').map(v => v.trim().toLowerCase());
    ['lspd','lscs','sast','doj','doc'].forEach(k => setCheckbox(`ref_${k}`, vals.includes(k)));
  }

  // Sub-items: clear containers and re-render
  ['debriefContainer','suspectContainer','victimContainer','witnessContainer','evidenceContainer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  debriefCount = 0; suspectCount = 0; victimCount = 0; witnessCount = 0; evidenceCount = 0;

  (r.debrief_entries || []).forEach(d => addDebrief(d));
  (r.suspects        || []).forEach(s => addSuspect(s));
  (r.victims         || []).forEach(v => addVictim(v));
  (r.witnesses       || []).forEach(w => addWitness(w));
  (r.evidences       || []).forEach(e => addEvidence(e));

}

// ── API: export PDF ──────────────────────────────────────────
async function exportPDF() {
  if (!reportId) { PortalAuth.showToast('Save report first', 'error'); return; }
  const btn = document.getElementById('exportBtn');
  showLoad('GENERATING PDF...');
  if (btn) btn.disabled = true;
  try {
    const token = sessionStorage.getItem('cib_token');
    const headers = { 'x-session-token': token };
    const pdfRes = await fetch(`/api/report-pdf?id=${reportId}`, { headers });
    const pdfData = await pdfRes.json();

    if (!pdfRes.ok) throw new Error(pdfData.error || 'PDF generation failed');

    const a = document.createElement('a');
    a.href = `data:application/pdf;base64,${pdfData.base64}`;
    a.download = pdfData.filename || `CIB_IR_${reportId}.pdf`;
    a.click();
    PortalAuth.showToast('PDF downloaded', 'success');
  } catch (err) {
    PortalAuth.showToast('PDF failed: ' + err.message, 'error');
  } finally {
    hideLoad();
    if (btn) btn.disabled = false;
  }
}

// ── next case number (preview; server re-assigns on POST) ───
async function prefetchNextCaseNumber() {
  const el = document.getElementById('case_number');
  if (el) {
    el.readOnly = true;
    el.setAttribute('aria-readonly', 'true');
  }
  try {
    const token = sessionStorage.getItem('cib_token');
    const res = await fetch('/api/reports?nextCaseNumber=1', {
      headers: { 'x-session-token': token }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Next case number');
    if (data.next_case_number) setVal('case_number', data.next_case_number);
  } catch (e) {
    setVal('case_number', '—');
    if (el) el.title = e?.message || 'Will be assigned on save';
  }
}

// ── weekday name for a YYYY-MM-DD string (avoids UTC shift) ───
function dayNameForIsoDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

// ── apply session-based defaults (new report) — all sections that fit ──
function applySessionDefaults() {
  const s = typeof PortalAuth !== 'undefined' && PortalAuth.getSession
    ? PortalAuth.getSession()
    : {}
  const badge    = s.badge    || sessionStorage.getItem('cib_badge')    || '';
  const division = s.division || sessionStorage.getItem('cib_division') || 'CID';
  const rank     = s.rank     || sessionStorage.getItem('cib_rank')     || '';
  const name     = s.name     || sessionStorage.getItem('cib_name')     || '';
  const today    = new Date().toISOString().split('T')[0];
  const leadLine = [rank, name].filter(Boolean).join(' ');

  // Section A — classification
  if (!getVal('date_of_offense')) setVal('date_of_offense', today);
  if (!getVal('date_reported'))   setVal('date_reported',   today);
  if (!getVal('bureau_name'))     setVal('bureau_name',     division);
  if (!getVal('day_of_offense'))  setVal('day_of_offense',  dayNameForIsoDate(today));
  if (!getVal('day_reported'))    setVal('day_reported',    dayNameForIsoDate(today));
  if (!getVal('prosecutor'))      setVal('prosecutor',      'TBA');
  if (!getVal('prosecutor_time_start')) setVal('prosecutor_time_start', today);

  const agOk = ['VICE', 'CID', 'GRD', 'CMD'];
  if (agOk.includes(division)) {
    setVal('agency_code', division);
  }

  if (!getVal('lead_investigators') && leadLine) {
    setVal('lead_investigators', leadLine);
  }

  const anyJur = getCheckboxValue('jur_lspd') || getCheckboxValue('jur_sast')
    || getCheckboxValue('jur_lscs') || getCheckboxValue('jur_state');
  if (!anyJur) setCheckbox('jur_lspd', true);

  // Section B — first debrief entry (if blank)
  if (debriefCount >= 1) {
    if (!getVal('deb-title-1')) {
      setVal('deb-title-1', 'Initial debrief / incident summary');
    }
    if (!getVal('deb-date-1')) setVal('deb-date-1', today);
  }

  // Section F — first evidence: retrieval date
  if (evidenceCount >= 1 && !getVal('ev-date-1')) {
    setVal('ev-date-1', today);
  }

  // Section E — first witness: occupation hint from role
  if (witnessCount >= 1 && !getVal('wit-occ-1') && leadLine) {
    setVal('wit-occ-1', `${leadLine} — ${division}`);
  }

  // Section D — first victim: neutral welfare (not Deceased as implicit first <option>)
  const vicW1 = document.getElementById('vic-welfare-1');
  if (vicW1 && victimCount >= 1 && vicW1.options?.length) {
    const u = Array.from(vicW1.options).find(o => o.textContent.trim() === 'Unknown');
    if (u) vicW1.value = u.value;
  }

  // Section G — closure: detective line + type + file opened
  if (!getVal('closure_detective_name') && leadLine) {
    setVal('closure_detective_name', leadLine);
  }
  if (!getVal('prosecutor_final_name')) {
    setVal('prosecutor_final_name', 'TBA');
  }
  if (!getVal('detective_value_of_property')) {
    setVal('detective_value_of_property', 'N/A');
  }
  if (!getVal('closure_time_received')) {
    setVal('closure_time_received', today);
  }
  if (division === 'GRD') {
    setRadio('closure_type', 'GRD');
  } else {
    setRadio('closure_type', 'CID');
  }

  // Badge display in topbar
  const bd = document.getElementById('badgeDisplay');
  if (bd && badge) bd.textContent = badge;
}

// ── init ──────────────────────────────────────────────────────
PortalAuth.init({
  loginHref: '/Page_Login.html',
  onReady(badge) {
    // Unhide main content
    const content = document.getElementById('portalContent');
    if (content) content.style.display = '';

    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id) {
      reportId = id;
      loadReport(id);
    } else {
      // New report: add default entries and apply session defaults
      addDebrief();
      addSuspect();
      addVictim();
      addWitness();
      addEvidence();
      applySessionDefaults();
      prefetchNextCaseNumber();
    }
  }
});
