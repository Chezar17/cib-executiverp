SiteUi.initPageFadeTransitions({ transitionMs: 400 });

// ── MOST WANTED (home) ──
// Uses the same source as Page_Wanted.html, so both pages always show the same suspects.
(function () {
  const API = '/api/press-releases?type=wanted';
  const THREAT_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

  const esc = s => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const placeholder = `
    <div class="wanted-photo-placeholder">
      <svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
      <span>No Photo Available</span>
    </div>`;

  function cardHTML(w) {
    const level   = w.threat_level || 'high';
    const name    = w.alias ? `"${w.alias}"` : (w.full_name || 'Unknown');
    const charges = Array.isArray(w.charges) ? w.charges.join(' · ') : '';
    const photo   = w.photo_url
      ? `<img src="${esc(w.photo_url)}" alt="${esc(w.alias || w.full_name)}" onerror="this.replaceWith(document.createRange().createContextualFragment(window.__wantedPlaceholder))"/>`
      : placeholder;

    return `
      <a class="wanted-card" href="Page_Wanted.html">
        <div class="wanted-case-ref">WANTED &middot; ${esc(w.case_number || '—')}</div>
        <div class="wanted-photo">
          ${photo}
          <div class="wanted-overlay"><span class="wanted-overlay-text">View File</span></div>
        </div>
        <div class="wanted-info">
          <div class="wanted-label">Wanted</div>
          <div class="wanted-name">${esc(name)}</div>
          <div class="wanted-crime">${esc(charges || 'Charges pending')}</div>
          <span class="wanted-threat threat-${esc(level)}">${esc((THREAT_LABELS[level] || level).toUpperCase())} THREAT</span>
        </div>
      </a>`;
  }

  async function loadHomeWanted() {
    const grid = document.getElementById('homeWantedGrid');
    if (!grid) return;
    window.__wantedPlaceholder = placeholder;

    try {
      const res  = await fetch(API);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');

      // Same rule as the Most Wanted page: hide anyone marked "cleared"
      const data = (json.data || []).filter(w => w.status !== 'cleared');

      grid.innerHTML = data.length
        ? data.map(cardHTML).join('')
        : '<div class="wanted-grid-msg">No active wanted individuals at this time</div>';
    } catch (err) {
      console.error('Most Wanted load failed:', err);
      grid.innerHTML = '<div class="wanted-grid-msg">Unable to load the wanted list right now</div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadHomeWanted);
  } else {
    loadHomeWanted();
  }
})();
