/* ============================================================
   CIB — Most Wanted Public Front-End
   File location: scripts/wanted.js

   Fetches live data from GET /api/wanted (public, no auth)
   and renders suspect cards into Page_Wanted.html.
   ============================================================ */

SiteUi.initPageFadeTransitions({ transitionMs: 400 });
SiteUi.initScrollReveal();

// ── Config ────────────────────────────────────────────────────
const WANTED_API = '/api/wanted';

// ── Helpers ───────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  if (!dateStr) return 'Unknown';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).toUpperCase();
  } catch {
    return dateStr;
  }
}

function parseCrimes(crimesRaw) {
  if (!crimesRaw) return [];
  if (Array.isArray(crimesRaw)) return crimesRaw;
  try { return JSON.parse(crimesRaw); } catch { return []; }
}

function threatClass(level) {
  const map = { critical: 'threat-critical', high: 'threat-high', medium: 'threat-medium', low: 'threat-low' };
  return map[(level || 'critical').toLowerCase()] || 'threat-critical';
}

function statusColor(status) {
  const s = (status || '').toLowerCase();
  if (s === 'captured')  return 'color:var(--gold)';
  if (s === 'deceased')  return 'color:var(--muted)';
  return 'color:var(--red-alert)'; // At Large
}

function detectiveInitials(name) {
  if (!name) return '??';
  return name.replace(/^(Det\.|Sgt\.|Cpl\.|Lt\.|Insp\.)\s*/i, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();
}

// ── Card renderer ─────────────────────────────────────────────

function renderCard(w, index) {
  const crimes    = parseCrimes(w.crimes);
  const photoHtml = w.photo_url
    ? `<img src="${escHtml(w.photo_url)}" alt="${escHtml(w.full_name)}" />`
    : `<div class="photo-placeholder">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
           <circle cx="12" cy="7" r="4"/>
         </svg>
         <span>No Photo Available</span>
       </div>`;

  const crimeTags = crimes.length
    ? crimes.map(c => `<span class="crime-tag">${escHtml(c)}</span>`).join('')
    : '<span class="crime-tag">Charges Pending</span>';

  const detInitials = detectiveInitials(w.det_name);
  const detName     = w.det_name     ? `Det. ${escHtml(w.det_name)}` : 'Unassigned';
  const detRank     = w.det_rank     ? escHtml(w.det_rank)           : 'CIB';
  const detDivision = w.det_division ? escHtml(w.det_division)       : 'Central Investigation Bureau';

  const cardNum = String(index + 1).padStart(2, '0');

  return `
    <div class="wanted-card" data-wanted-id="${escHtml(w.id)}">

      <!-- LEFT: PHOTO COLUMN -->
      <div class="suspect-photo-col">
        <div class="suspect-photo">
          ${photoHtml}
        </div>
        <div class="photo-case-strip">
          <div class="photo-case-id">CASE NO. ${escHtml(w.case_no || '—')}</div>
          <div class="photo-date-wanted">WANTED SINCE: <span>${formatDate(w.wanted_since)}</span></div>
        </div>
      </div>

      <!-- RIGHT: INFO COLUMN -->
      <div class="suspect-info">

        <!-- Name + Threat Level -->
        <div class="suspect-header">
          <div class="suspect-name-block">
            ${w.alias ? `<div class="suspect-alias">AKA &ldquo;${escHtml(w.alias)}&rdquo;</div>` : ''}
            <div class="suspect-name">${escHtml(w.full_name)}</div>
            <div class="suspect-id">
              ${w.suspect_id  ? `SUSPECT ID: ${escHtml(w.suspect_id)} &nbsp;|&nbsp; ` : ''}
              DOB: ${escHtml(w.dob || 'Unknown')} &nbsp;|&nbsp;
              NATIONALITY: ${escHtml(w.nationality || 'Unknown')}
            </div>
          </div>
          <div class="threat-badge ${threatClass(w.threat_level)}">
            <div class="threat-badge-label">Threat Level</div>
            <div class="threat-badge-level">${escHtml(w.threat_level ? w.threat_level.charAt(0).toUpperCase() + w.threat_level.slice(1) : 'Critical')}</div>
          </div>
        </div>

        <!-- Bounty -->
        <div class="bounty-row">
          <div>
            <div class="bounty-label">Bounty on Capture</div>
            <div class="bounty-note">${escHtml(w.bounty_note || 'Authorized by CIB Director')}</div>
          </div>
          <div class="bounty-amount">${escHtml(w.bounty)}</div>
        </div>

        <!-- Quick meta stats -->
        <div class="suspect-meta-grid">
          <div class="meta-cell">
            <div class="meta-cell-label">Last Known Location</div>
            <div class="meta-cell-value">${escHtml(w.last_location || 'Unknown')}</div>
          </div>
          <div class="meta-cell">
            <div class="meta-cell-label">Affiliation</div>
            <div class="meta-cell-value">${escHtml(w.affiliation || 'Unknown')}</div>
          </div>
          <div class="meta-cell">
            <div class="meta-cell-label">Status</div>
            <div class="meta-cell-value" style="${statusColor(w.status)}">${escHtml(w.status || 'At Large')}</div>
          </div>
        </div>

        <!-- Debrief -->
        <div style="margin-bottom:20px;">
          <div class="suspect-section-title">Suspect Debrief</div>
          <div class="suspect-debrief">${escHtml(w.debrief)}</div>
        </div>

        <!-- Crimes list -->
        <div class="crimes-block">
          <div class="suspect-section-title">Charges &amp; Offenses</div>
          <div class="crimes-list">${crimeTags}</div>
        </div>

        <!-- Primary Detective -->
        <div class="detective-row">
          <div class="detective-avatar">${escHtml(detInitials)}</div>
          <div class="detective-info">
            <div class="detective-label">Primary Detective</div>
            <div class="detective-name">${detName}</div>
            <div class="detective-rank">${detRank}</div>
          </div>
          <div class="detective-division">${detDivision}</div>
        </div>

      </div>
    </div>`;
}

// ── Count bar updater ─────────────────────────────────────────

function updateCountBar(count, updatedAt) {
  const countNumEl = document.querySelector('.count-num');
  const countRightEl = document.querySelector('.count-bar-right');

  if (countNumEl) {
    countNumEl.textContent = String(count).padStart(2, '0');
  }
  if (countRightEl && updatedAt) {
    const d = new Date(updatedAt);
    const dateStr = d.toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    }).toUpperCase();
    const timeStr = d.toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    // Detect timezone offset
    const tz = 'HRS · CIB PRIORITY LIST';
    countRightEl.textContent = `LAST UPDATED: ${dateStr} · ${timeStr} ${tz}`;
  }
}

// ── Loading / error states ────────────────────────────────────

function renderLoading(container) {
  container.innerHTML = `
    <div style="
      padding:60px 0; text-align:center;
      font-family:'Roboto Mono',monospace; font-size:11px;
      letter-spacing:3px; color:var(--muted); opacity:0.5;
      text-transform:uppercase;
    ">
      <div style="margin-bottom:12px;">Loading active wanted list&hellip;</div>
    </div>`;
}

function renderError(container, message) {
  container.innerHTML = `
    <div style="
      padding:60px 0; text-align:center;
      font-family:'Roboto Mono',monospace; font-size:11px;
      letter-spacing:2px; color:var(--red-alert); opacity:0.7;
      text-transform:uppercase; line-height:2;
    ">
      <div>⚠ Failed to load wanted list</div>
      <div style="font-size:9px;margin-top:8px;opacity:0.6;">${escHtml(message || 'Network error')}</div>
    </div>`;
}

function renderEmpty(container) {
  container.innerHTML = `
    <div style="
      padding:60px 0; text-align:center;
      font-family:'Roboto Mono',monospace; font-size:11px;
      letter-spacing:3px; color:var(--muted); opacity:0.5;
      text-transform:uppercase;
    ">
      No active wanted individuals at this time.
    </div>`;
}

// ── Main fetch & render ───────────────────────────────────────

async function loadWantedList() {
  const list = document.querySelector('.wanted-list');
  if (!list) return;

  renderLoading(list);

  try {
    const res = await fetch(WANTED_API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API error');

    const items = json.data || [];

    if (!items.length) {
      renderEmpty(list);
      updateCountBar(0, null);
      return;
    }

    // Sort: At Large first, then by created_at descending (already from API but re-assert)
    const sorted = [...items].sort((a, b) => {
      const aLarge = (a.status || '').toLowerCase() === 'at large' ? 0 : 1;
      const bLarge = (b.status || '').toLowerCase() === 'at large' ? 0 : 1;
      if (aLarge !== bLarge) return aLarge - bLarge;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    list.innerHTML = sorted.map((w, i) => renderCard(w, i)).join('\n');

    // Update count and timestamp
    const latest = sorted[0];
    updateCountBar(items.length, latest?.updated_at || latest?.created_at);

  } catch (err) {
    console.error('[CIB Wanted] Load error:', err);
    renderError(list, err.message);
  }
}

// ── Boot ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', loadWantedList);
