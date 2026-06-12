const revealEls = document.querySelectorAll('.reveal');
const revealObs = new IntersectionObserver((entries) => {
entries.forEach((e, i) => {
  if (e.isIntersecting) {
    setTimeout(() => e.target.classList.add('visible'), i * 60);
    revealObs.unobserve(e.target);
  }
});
}, { threshold: 0.06 });
revealEls.forEach(el => revealObs.observe(el));

const tlItems = document.querySelectorAll('.tl-item');
const tlObs = new IntersectionObserver((entries) => {
entries.forEach((e, i) => {
  if (e.isIntersecting) {
    setTimeout(() => e.target.classList.add('visible'), i * 150);
    tlObs.unobserve(e.target);
  }
});
}, { threshold: 0.15 });
tlItems.forEach(el => tlObs.observe(el));

const bars = document.querySelectorAll('.budget-bar-fill');
const barObs = new IntersectionObserver((entries) => {
entries.forEach(entry => {
  if (entry.isIntersecting) {
    entry.target.querySelectorAll('.budget-bar-fill').forEach((bar, i) => {
      const pct = bar.dataset.pct || 50;
      setTimeout(() => { bar.style.width = pct + '%'; }, i * 100 + 200);
    });
    barObs.unobserve(entry.target);
  }
});
}, { threshold: 0.3 });

const budgetRows = document.querySelector('.budget-rows');
if (budgetRows) barObs.observe(budgetRows);

function animateCount(el, target, suffix) {
const duration = 1600, step = 16;
const increment = target / (duration / step);
let current = 0;
const timer = setInterval(() => {
  current = Math.min(current + increment, target);
  el.textContent = (Number.isInteger(target) ? Math.floor(current) : current.toFixed(0)) + suffix;
  if (current >= target) {
    el.classList.add('shimmer');
    clearInterval(timer);
  }
}, step);
}

const statsEl = document.querySelector('.hero-stats');
let statsDone = false;
const statsObs = new IntersectionObserver((entries) => {
entries.forEach(entry => {
  if (entry.isIntersecting && !statsDone) {
    statsDone = true;
    document.querySelectorAll('.hero-stat-val').forEach((el, i) => {
      const raw = el.textContent.trim();

      const match = raw.match(/^v?(\d+)/);
      if (match) {
        const num = parseInt(match[1]);
        const prefix = raw.startsWith('v') ? 'v' : '';
        const suffix = raw.includes('%') ? '%' : (raw.startsWith('v') ? '.0' : '');
        el.textContent = prefix + '0' + suffix;
        setTimeout(() => animateCount(el, num, prefix ? '' : suffix), i * 200);
        if (prefix) {

          setTimeout(() => { el.textContent = 'v1.0'; el.classList.add('shimmer'); }, 1800 + i * 200);
        }
      }
    });
  }
});
}, { threshold: 0.5 });
if (statsEl) statsObs.observe(statsEl);

const hero = document.querySelector('.hero');
function spawnParticle() {
const p = document.createElement('div');
p.className = 'particle';
const x = Math.random() * 100;
const drift = (Math.random() - 0.5) * 80;
const dur = 4 + Math.random() * 5;
p.style.cssText = `left:${x}%;bottom:${10 + Math.random()*30}%;--dur:${dur}s;--delay:${Math.random()*2}s;--drift:${drift}px;`;
hero.appendChild(p);
setTimeout(() => p.remove(), (dur + 3) * 1000);
}
if (hero) {
for (let i = 0; i < 20; i++) spawnParticle();
setInterval(spawnParticle, 1600);
}

document.querySelectorAll('.mod-item, .value-card, .overview-cell').forEach(card => {
card.addEventListener('mousemove', e => {
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  card.style.transform = `perspective(700px) rotateY(${x * 5}deg) rotateX(${-y * 3}deg)`;
});
card.addEventListener('mouseleave', () => {
  card.style.transform = '';
});
});

function typewrite(el, text, speed = 38) {
el.textContent = '';
let i = 0;
const cursor = document.createElement('span');
cursor.style.cssText = 'display:inline-block;width:5px;height:0.9em;background:var(--gold);margin-left:2px;vertical-align:middle;animation:cursorBlink 0.8s steps(1) infinite;';
el.appendChild(cursor);
const t = setInterval(() => {
  el.insertBefore(document.createTextNode(text[i++]), cursor);
  if (i >= text.length) { clearInterval(t); setTimeout(() => cursor.remove(), 800); }
}, speed);
}

const eyebrowObs = new IntersectionObserver(entries => {
entries.forEach(entry => {
  if (entry.isIntersecting) {
    const eyebrow = entry.target.querySelector('.section-eyebrow');
    if (eyebrow && !eyebrow.dataset.typed) {
      eyebrow.dataset.typed = '1';
      const orig = eyebrow.textContent;
      typewrite(eyebrow, orig);
    }
    eyebrowObs.unobserve(entry.target);
  }
});
}, { threshold: 0.4 });

document.querySelectorAll('.section-header').forEach(h => eyebrowObs.observe(h));

const sections = document.querySelectorAll('div[id]');
const navAs = document.querySelectorAll('.nav-pills a');
window.addEventListener('scroll', () => {
let current = '';
sections.forEach(s => {
  if (window.scrollY >= s.offsetTop - 120) current = s.id;
});
navAs.forEach(a => {
  const href = a.getAttribute('href').replace('#', '');
  a.style.color = href === current ? 'var(--gold)' : '';
  a.style.borderColor = href === current ? 'var(--gold-dim)' : 'transparent';
  a.style.background = href === current ? 'var(--gold-glow)' : '';
});
}, { passive: true });
