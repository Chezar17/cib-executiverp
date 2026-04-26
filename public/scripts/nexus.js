// ── PANEL DATA ──────────────────────────────────────────────
  const PANEL_META = {
    dashboard: {bc:'NEXUS · PORTAL',     title:'Dashboard',          sub:'Command overview · Active session',                              badge:''},
    guidebook: {bc:'NEXUS · DOCUMENTS',  title:'CIB Guidebook',      sub:'Standard operating procedures · Rules of engagement',           badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(201,168,76,0.1);color:var(--gold);border:1px solid rgba(201,168,76,0.3);">INTERNAL</span>'},
    penal:     {bc:'NEXUS · DOCUMENTS',  title:'Penal Codes',        sub:'Criminal statutes · Charge reference · Sentencing guidelines',  badge:''},
    directory: {bc:'NEXUS · DOCUMENTS',  title:'Main Directory',     sub:'Complete case files · Operation archives · Personnel records',  badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(192,57,43,0.1);color:var(--red-alert);border:1px solid rgba(192,57,43,0.3);">TOP SECRET</span>'},
    weapons:   {bc:'NEXUS · INTELLIGENCE',title:'Weapons Tracker',   sub:'Active arms networks · Seizure logs · Supply chain mapping',   badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(192,57,43,0.1);color:var(--red-alert);border:1px solid rgba(192,57,43,0.3);">CIB EYES ONLY</span>'},
    gang:      {bc:'NEXUS · INTELLIGENCE',title:'Gang Intelligence',  sub:'Active gang profiles · Territorial maps · Threat assessments', badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(224,90,40,0.1);color:#E05A28;border:1px solid rgba(224,90,40,0.3);">GRD DATABASE</span>'},
    informant: {bc:'NEXUS · INTELLIGENCE',title:'Informant Registry', sub:'Handler access only · Identities classified · 33 registered', badge:'<span style="font-family:\'Roboto Mono\',monospace;font-size:8px;letter-spacing:2px;padding:3px 10px;background:rgba(192,57,43,0.1);color:var(--red-alert);border:1px solid rgba(192,57,43,0.3);">HANDLER EYES ONLY</span>'},
  };

  function showPanel(name, navEl) {
    document.querySelectorAll('.nx-panel').forEach(p => p.classList.remove('panel-active'));
    document.getElementById('panel-' + name).classList.add('panel-active');
    document.querySelectorAll('.nx-nav-item').forEach(n => n.classList.remove('active'));
    if (navEl) navEl.classList.add('active');
    const m = PANEL_META[name];
    document.getElementById('panelBreadcrumb').textContent = m.bc;
    document.getElementById('panelTitle').textContent = m.title;
    document.getElementById('panelSub').textContent = m.sub;
    document.getElementById('panelBadge').innerHTML = m.badge;
    document.querySelector('.nx-main').scrollTop = 0;
  }

  function showPanelByName(name) {
    const navEl = [...document.querySelectorAll('.nx-nav-item')].find(el =>
      el.getAttribute('onclick')?.includes("'" + name + "'")
    );
    showPanel(name, navEl);
  }

  // ── Auth + clock + idle timeout (via shared portal-auth.js) ──
  PortalAuth.init({
    loginHref: 'Page_Login.html',
    badgeEls:  ['badgeDisplay', 'sidebarBadge', 'dashWelcomeName', 'dashHeroOfficer'],
    clockEl:   'liveClock',
  });

  function logout() { PortalAuth.logout('Page_Login.html'); }

  function showToast(msg, type) {
    PortalAuth.showToast(msg, type, 'inf-toast');
  }

  SiteUi.initPageFadeTransitions({ transitionMs: 400, skipInitialFadeIn: true });
  SiteUi.initScrollReveal();