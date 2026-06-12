const revealEls = document.querySelectorAll('.reveal, .stagger-children');
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('visible'), i * 60);
      observer.unobserve(e.target);
    }
  });
}, { threshold: 0.06 });
revealEls.forEach(el => observer.observe(el));

function animateCount(el) {
  const target = parseInt(el.dataset.count);
  const suffix = el.dataset.suffix || '';
  const plus = target === 50 ? '+' : '';
  const duration = 1400, step = 16;
  const increment = target / (duration / step);
  let current = 0;
  const timer = setInterval(() => {
    current = Math.min(current + increment, target);
    el.textContent = Math.floor(current) + suffix + (current >= target ? plus : '');
    if (current >= target) {
      el.classList.add('shimmer');
      clearInterval(timer);
    }
  }, step);
}

const metricObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.querySelectorAll('.metric-cell').forEach((cell, i) => {
        setTimeout(() => {
          cell.classList.add('animated');
          const val = cell.querySelector('.metric-value');
          if (val) animateCount(val);
        }, i * 160);
      });
      metricObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.3 });

const metricsGrid = document.querySelector('.metrics-grid');
if (metricsGrid) metricObserver.observe(metricsGrid);

function switchPage(idx) {
  document.querySelectorAll('.page-tab').forEach((t, i) => {
    t.classList.toggle('active', i === idx);
  });
  document.querySelectorAll('.page-panel').forEach((p, i) => {
    p.classList.toggle('active', i === idx);
  });
}

const hero = document.querySelector('.hero');
function spawnParticle() {
  const p = document.createElement('div');
  p.className = 'particle';
  const x = Math.random() * 100;
  const drift = (Math.random() - 0.5) * 60;
  const dur = 4 + Math.random() * 5;
  p.style.cssText = `left:${x}%; bottom:${10 + Math.random()*30}%; --drift:${drift}px; animation-duration:${dur}s; animation-delay:${Math.random()*3}s;`;
  hero.appendChild(p);
  setTimeout(() => p.remove(), (dur + 3) * 1000);
}
if (hero) {
  for (let i = 0; i < 18; i++) spawnParticle();
  setInterval(spawnParticle, 1800);
}

document.querySelectorAll('.purpose-card, .reason-card, .division-card').forEach(card => {
  card.classList.add('tilt-card');
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(600px) rotateY(${x * 6}deg) rotateX(${-y * 4}deg) translateZ(4px)`;
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
  });
});

const sections = document.querySelectorAll('section[id], div[id]');
const navLinks = document.querySelectorAll('.nav-links a');
window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(s => {
    if (window.scrollY >= s.offsetTop - 100) current = s.id;
  });
  navLinks.forEach(a => {
    a.style.color = a.getAttribute('href') === '#' + current ? 'var(--gold)' : '';
  });
}, { passive: true });

function typewrite(el, text, speed = 35) {
  el.textContent = '';
  let i = 0;
  const cursor = document.createElement('span');
  cursor.style.cssText = 'display:inline-block;width:6px;height:1em;background:var(--gold);margin-left:2px;vertical-align:middle;animation:cursorBlink 0.8s steps(1) infinite;';
  el.appendChild(cursor);
  const t = setInterval(() => {
    el.insertBefore(document.createTextNode(text[i++]), cursor);
    if (i >= text.length) { clearInterval(t); setTimeout(() => cursor.remove(), 800); }
  }, speed);
}

const eyebrowObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const eyebrow = entry.target.querySelector('.section-eyebrow');
      if (eyebrow && !eyebrow.dataset.typed) {
        eyebrow.dataset.typed = '1';
        const orig = eyebrow.textContent;
        typewrite(eyebrow, orig);
      }
      eyebrowObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.3 });

document.querySelectorAll('.section-header').forEach(h => eyebrowObserver.observe(h));

const panelObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const img = entry.target.querySelector('.panel-screenshot img');
    if (img) img.style.animationPlayState = entry.isIntersecting ? 'running' : 'paused';
  });
}, { threshold: 0.2 });
document.querySelectorAll('.page-panel').forEach(p => panelObserver.observe(p));
