SiteUi.initPageFadeTransitions({ transitionMs: 400 });

(function(){
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          if (entry.target.classList.contains('reveal-stagger')) {
            entry.target.querySelectorAll(':scope > *').forEach((child, i) => {
              child.style.opacity = '0';
              child.style.transform = 'translateY(24px)';
              child.style.transition = 'opacity 0.55s ' + (i*0.08) + 's cubic-bezier(0.16,1,0.3,1), transform 0.55s ' + (i*0.08) + 's cubic-bezier(0.16,1,0.3,1)';
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  child.style.opacity = '1';
                  child.style.transform = 'translateY(0)';
                });
              });
            });
          }
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

    function initReveal() {
      document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
    }

    document.addEventListener('panelSwitched', initReveal);
    window.addEventListener('DOMContentLoaded', () => setTimeout(initReveal, 120));
  })();

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  //  PANEL SWITCH WITH ANIMATION
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  function switchTab(div) {
    document.getElementById('tab-cid').classList.toggle('cid-active', div==='cid');
    document.getElementById('tab-cid').classList.toggle('tab-dim',    div!=='cid');
    document.getElementById('tab-grd').classList.toggle('grd-active', div==='grd');
    document.getElementById('tab-grd').classList.toggle('tab-dim',    div!=='grd');
    // Remove wrong initial class if present
    if (div==='grd') document.getElementById('tab-grd').classList.remove('cid-active');
    if (div==='cid') document.getElementById('tab-cid').classList.remove('grd-active');

    const panels = document.querySelectorAll('.division-panel');
    panels.forEach(p => {
      p.classList.remove('panel-active','panel-entering');
      p.style.display = 'none';
    });

    const target = document.getElementById('panel-' + div);
    if (target) {
      target.style.display = 'block';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          target.classList.add('panel-active','panel-entering');
          document.dispatchEvent(new Event('panelSwitched'));
        });
      });
    }
  }