// Mobile menu toggle
const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.getElementById('main-nav');

if (menuToggle && mainNav) {
  menuToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('is-open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });
  mainNav.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mainNav.classList.remove('is-open');
      menuToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Mark active nav link
const currentPath = window.location.pathname;
document.querySelectorAll('.main-nav a:not(.btn)').forEach(link => {
  const href = link.getAttribute('href');
  if (!href) return;
  try {
    const linkPath = new URL(href, window.location.href).pathname;
    if (currentPath === linkPath || (linkPath !== '/' && currentPath.startsWith(linkPath))) {
      link.classList.add('active');
    }
  } catch(e) {}
});

// Smooth scroll for hash links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', e => {
    var target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Plan button → pre-fill form + dispara evento "InitiateCheckout" a Pixel + Amplitude
document.querySelectorAll('.plan-btn[data-plan]').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var plan = btn.getAttribute('data-plan');
    var hidden = document.getElementById('plan-elegido');
    var textarea = document.getElementById('booking-objetivo');
    if (hidden) hidden.value = plan;
    if (textarea && !textarea.value.trim()) {
      textarea.placeholder = 'Me interesa el plan ' + plan + '. Quiero mejorar...';
    }
    try {
      if (window.cln && typeof window.cln.trackInitiateCheckout === 'function') {
        window.cln.trackInitiateCheckout(plan);
      }
    } catch (_) { /* telemetría nunca rompe UX */ }
  });
});

// Scroll reveal animations
(function() {
  var reveals = document.querySelectorAll('.reveal');
  if (!reveals.length || !('IntersectionObserver' in window)) {
    reveals.forEach(function(el) { el.classList.add('revealed'); });
    return;
  }
  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  reveals.forEach(function(el) { observer.observe(el); });
})();
