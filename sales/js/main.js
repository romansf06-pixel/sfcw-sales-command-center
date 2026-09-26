import { api, setUnauthorizedHandler } from './api.js';
import { renderNav } from './components/nav.js';
import { initSearch } from './search.js';
import { toast, HANDLED_BY_NAMES } from './util.js';

import * as CommandCenter from './views/command-center.js';
import * as Queue from './views/queue.js';
import * as Messages from './views/messages.js';
import * as Copilot from './views/copilot.js';
import * as Leads from './views/leads.js';
import * as LeadProfile from './views/lead-profile.js';
import * as Followups from './views/followups.js';
import * as Calendar from './views/calendar.js';
import { openTrashModal } from './views/trash.js';
import * as Analytics from './views/analytics.js';
import * as Settings from './views/settings.js';
import { makeBucketView } from './views/bucket-view.js';

const Reactivation = { mount: makeBucketView('reactivation', 'Reactivation', 'Previous customers overdue for renewed outreach') };

const app = document.getElementById('app');
const navEl = document.createElement('div');
navEl.className = 'nav';
const mainEl = document.createElement('div');
mainEl.className = 'main';
app.appendChild(navEl);
app.appendChild(mainEl);

// Global drag-to-trash target — present on every page (not just Queue), since
// lead-card.js's cards render in Command Center and the bucket views too. See
// sales-api/routes.js POST /leads/:id/trash and sales/js/views/trash.js.
const trashEl = document.createElement('div');
trashEl.className = 'trash-fab';
trashEl.title = 'Drag a lead here to move it to Trash — click to view Trash';
trashEl.textContent = '🗑️';
document.body.appendChild(trashEl);
trashEl.addEventListener('dragover', (e) => { e.preventDefault(); trashEl.classList.add('drag-over'); });
trashEl.addEventListener('dragleave', () => trashEl.classList.remove('drag-over'));
trashEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  trashEl.classList.remove('drag-over');
  const id = e.dataTransfer.getData('text/plain');
  if (!id) return;
  try {
    await api.trashLead(id);
    toast('Moved to Trash');
    document.querySelectorAll(`[data-lead-id="${id}"]`).forEach(el => el.remove());
  } catch (err) { toast(err.message); }
});
trashEl.addEventListener('click', () => openTrashModal());

function matchRoute(hash) {
  if (hash === '' || hash === '#' || hash === '#/') return { view: CommandCenter, params: [] };
  const leadMatch = hash.match(/^#\/lead\/(.+)$/);
  if (leadMatch) return { view: LeadProfile, params: [decodeURIComponent(leadMatch[1])] };
  const table = {
    '#/queue': Queue, '#/messages': Messages, '#/copilot': Copilot, '#/leads': Leads, '#/followups': Followups,
    '#/calendar': Calendar, '#/reactivation': Reactivation, '#/analytics': Analytics, '#/settings': Settings,
  };
  return { view: table[hash] || CommandCenter, params: [] };
}

let navCounts = {};
// Backend auto-syncs GHL contacts/opportunities every 2min and GHL
// conversations + Setmore every 1min (server.js) — this just needs to poll
// often enough that the queue counts in the nav don't lag noticeably behind
// that, plus it doubles as the "last synced" clock shown next to Refresh.
let syncState = { lastSyncedAt: null, syncing: false };
async function refreshNavCounts() {
  try {
    const { counts } = await api.queue();
    navCounts = counts;
    if (!syncState.lastSyncedAt) syncState.lastSyncedAt = Date.now();
    renderNavBar();
  } catch { /* ignore — nav still works without counts */ }
}

async function syncNow() {
  if (syncState.syncing) return;
  syncState.syncing = true; renderNavBar();
  try {
    const { counts } = await api.syncNow();
    navCounts = counts;
    syncState.lastSyncedAt = Date.now();
    toast('Synced with GoHighLevel + Setmore');
  } catch (e) {
    toast(e.message);
  } finally {
    syncState.syncing = false; renderNavBar();
  }
}

function renderNavBar() {
  navEl.innerHTML = renderNav(normalizedHash(), navCounts, syncState, api.getRepName());
  navEl.querySelectorAll('[data-route]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.route)));
  const syncBtn = navEl.querySelector('[data-action="sync-now"]');
  if (syncBtn) syncBtn.addEventListener('click', syncNow);
  const switchBtn = navEl.querySelector('[data-action="switch-rep"]');
  if (switchBtn) switchBtn.addEventListener('click', () => { api.setRepName(''); showRepGate(); });
}

function normalizedHash() {
  const h = window.location.hash || '#/';
  return h === '#' ? '#/' : h;
}

export function navigate(route) {
  window.location.hash = route;
}

async function route() {
  const { view, params } = matchRoute(normalizedHash());
  renderNavBar();
  try {
    await view.mount(mainEl, ...params);
  } catch (e) {
    mainEl.innerHTML = `<div class="empty-state">Something went wrong: ${e.message}</div>`;
    console.error(e);
  }
}

function showKeyGate() {
  mainEl.innerHTML = `
    <div class="card" style="max-width:420px;margin:60px auto;text-align:center;">
      <div class="card-title">Dashboard Key Required</div>
      <p style="font-size:12px;color:var(--muted);">Same key as the main SF City Wash dashboard.</p>
      <input type="password" id="key-input" placeholder="Dashboard key" style="width:100%;margin-bottom:10px;">
      <button class="btn primary" id="key-save" style="width:100%;">Unlock</button>
    </div>`;
  mainEl.querySelector('#key-save').addEventListener('click', () => {
    const v = mainEl.querySelector('#key-input').value.trim();
    if (v) { api.setKey(v); route(); }
  });
}

// "Who's using this browser" — a no-password identity picker, not real
// access control (the dashboard key above is the only real gate). Lets
// Handled-by/notes/dispositions/analytics attribute to the right person. See
// sales-api/routes.js's repId() and sales/js/api.js's x-sales-rep header.
function showRepGate() {
  navEl.innerHTML = '';
  mainEl.innerHTML = `
    <div class="card" style="max-width:420px;margin:60px auto;text-align:center;">
      <div class="card-title">Who's working the queue?</div>
      <p style="font-size:12px;color:var(--muted);">Picked once per browser so Handled-by, notes, and Analytics track the right person. Not a password — anyone can switch anytime from the nav footer.</p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${HANDLED_BY_NAMES.map(n => `<button class="btn primary" data-pick-rep="${n}" style="width:100%;">${n}</button>`).join('')}
      </div>
    </div>`;
  mainEl.querySelectorAll('[data-pick-rep]').forEach(b => b.addEventListener('click', () => {
    api.setRepName(b.dataset.pickRep);
    boot();
  }));
}

function boot() {
  if (!api.getRepName()) { showRepGate(); return; }
  route();
  refreshNavCounts();
}

setUnauthorizedHandler(showKeyGate);
window.addEventListener('hashchange', route);

initSearch();
boot();
setInterval(refreshNavCounts, 60 * 1000);
// Ages the "synced Xs/Xm ago" label between actual syncs without re-rendering
// (and re-binding listeners on) the whole nav every few seconds.
setInterval(() => {
  const el = navEl.querySelector('.nav-sync-age');
  if (el && syncState.lastSyncedAt) {
    const s = Math.round((Date.now() - syncState.lastSyncedAt) / 1000);
    el.textContent = `GHL/Setmore synced ${s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`}`;
  }
}, 5 * 1000);
