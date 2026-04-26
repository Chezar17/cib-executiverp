// â”€â”€ DEV NOTICE POPUP â”€â”€
  function dismissDevNotice() {
    const overlay = document.getElementById('dev-overlay');
    overlay.classList.add('hidden');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  }
  SiteUi.initPageFadeTransitions({ transitionMs: 400 });