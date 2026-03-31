// ═══════════════════════════════════════════
//  AIRBRUSH — main.js
// ═══════════════════════════════════════════

// ── NAVBAR SCROLL EFFECT ─────────────────
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 60);
});

// ── SCROLL REVEAL ────────────────────────
const reveals = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      // Stagger delay based on sibling index
      const siblings = [...entry.target.parentElement.children];
      const idx = siblings.indexOf(entry.target);
      const delay = Math.min(idx * 80, 400);
      setTimeout(() => {
        entry.target.classList.add('visible');
      }, delay);
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

reveals.forEach(el => revealObserver.observe(el));

// ── SMOOTH SCROLL FOR ANCHOR LINKS ───────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      const offset = 80; // navbar height
      const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ── PARTICLES BACKGROUND ─────────────────
const canvas = document.getElementById('particles-canvas');
const ctx = canvas.getContext('2d');

let width, height, particles;

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

function createParticles() {
  const count = Math.floor((width * height) / 18000);
  particles = Array.from({ length: count }, () => ({
    x: randomBetween(0, width),
    y: randomBetween(0, height),
    r: randomBetween(0.6, 2.2),
    vx: randomBetween(-0.25, 0.25),
    vy: randomBetween(-0.35, -0.05),
    alpha: randomBetween(0.15, 0.7),
    color: Math.random() > 0.5 ? '124,58,237' : '6,182,212',
  }));
}

function drawParticles() {
  ctx.clearRect(0, 0, width, height);
  particles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
    ctx.fill();

    p.x += p.vx;
    p.y += p.vy;

    // Reset particle when it drifts off screen
    if (p.y < -5) { p.y = height + 5; p.x = randomBetween(0, width); }
    if (p.x < -5) { p.x = width + 5; }
    if (p.x > width + 5) { p.x = -5; }
  });

  // Draw faint connecting lines between nearby particles
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 100) {
        const opacity = (1 - dist / 100) * 0.08;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = `rgba(124,58,237,${opacity})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }

  requestAnimationFrame(drawParticles);
}

window.addEventListener('resize', () => { resize(); createParticles(); });
resize();
createParticles();
drawParticles();
