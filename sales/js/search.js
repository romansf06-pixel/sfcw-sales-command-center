import { api } from './api.js';
import { escapeHtml } from './util.js';
import { navigate } from './main.js';

let overlay, input, results, selected = 0, items = [];

export function initSearch() {
  overlay = document.createElement('div');
  overlay.className = 'palette-overlay';
  overlay.id = 'palette-overlay';
  overlay.innerHTML = `
    <div class="palette">
      <input type="text" id="palette-input" placeholder="Search name, phone, email, vehicle, service…" autocomplete="off">
      <div class="palette-results" id="palette-results"></div>
    </div>`;
  document.body.appendChild(overlay);
  input = overlay.querySelector('#palette-input');
  results = overlay.querySelector('#palette-results');

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    else if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); open(); }
    else if (e.key === 'Escape') close();
  });
  // Nav re-renders on every route change, so this listens for clicks anywhere
  // rather than binding to an element that gets replaced.
  document.addEventListener('click', (e) => { if (e.target.closest('#nav-search-hint')) open(); });

  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    if (e.key === 'Enter') { e.preventDefault(); pick(selected); }
  });
}

export function open() {
  overlay.classList.add('open');
  input.value = '';
  results.innerHTML = '';
  items = [];
  setTimeout(() => input.focus(), 0);
}
function close() { overlay.classList.remove('open'); }

async function runSearch() {
  const q = input.value.trim();
  if (q.length < 2) { results.innerHTML = ''; items = []; return; }
  try {
    const r = await api.search(q);
    items = r.results;
    selected = 0;
    results.innerHTML = items.map((l, i) => `
      <div class="palette-row${i === 0 ? ' sel' : ''}" data-i="${i}">
        <b>${escapeHtml(l.name)}</b><div class="sub">${escapeHtml([l.phone, l.vehicle, l.service].filter(Boolean).join(' · '))}</div>
      </div>`).join('') || `<div class="palette-row">No matches.</div>`;
    results.querySelectorAll('[data-i]').forEach(row => row.addEventListener('click', () => pick(Number(row.dataset.i))));
  } catch { results.innerHTML = `<div class="palette-row">Search failed.</div>`; }
}

function move(delta) {
  if (!items.length) return;
  selected = Math.max(0, Math.min(items.length - 1, selected + delta));
  results.querySelectorAll('.palette-row').forEach((r, i) => r.classList.toggle('sel', i === selected));
}

function pick(i) {
  const lead = items[i];
  if (!lead) return;
  close();
  navigate(`#/lead/${lead.id}`);
}
