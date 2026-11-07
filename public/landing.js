// Mobile menu
const toggle = document.querySelector('.nav__toggle');
const menu = document.getElementById('menu');
toggle.addEventListener('click', () => {
  const open = menu.classList.toggle('is-open');
  toggle.setAttribute('aria-expanded', open);
});
menu.addEventListener('click', e => {
  if (e.target.closest('a')) { menu.classList.remove('is-open'); toggle.setAttribute('aria-expanded', false); }
});

// Walkthrough tabs
const tabs = document.querySelectorAll('.walk__tabs button');
const panels = document.querySelectorAll('.workspace__body');
tabs.forEach(tab => tab.addEventListener('click', () => {
  tabs.forEach(t => { t.classList.toggle('is-on', t === tab); t.setAttribute('aria-selected', t === tab); });
  panels.forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.step; });
}));

// FAQ: keep one item open at a time
const items = document.querySelectorAll('.faq details');
items.forEach(d => d.addEventListener('toggle', () => {
  if (d.open) items.forEach(o => { if (o !== d) o.open = false; });
}));
