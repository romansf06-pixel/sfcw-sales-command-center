import { api, setUnauthorizedHandler } from './api.js';
import { renderNav } from './components/nav.js';
import { initSearch } from './search.js';
import { toast } from './util.js';

import * as CommandCenter from './views/command-center.js';
import * as Queue from './views/queue.js';
import * as Messages from './views/messages.js';
import * as Copilot from './views/copilot.js';
import * as Leads from './views/leads.js';
import * as LeadProfile from './views/lead-profile.js';
import * as Followups from './views/followups.js';
import * as CallList from './views/call-list.js';
import * as Scripts from './views/scripts.js';
import * as Calendar from './views/calendar.js';
import * as Trash from './views/trash.js';
import * as Analytics from './views/analytics.js';
import * as Settings from './views/settings.js';
import { makeBucketView } from './views/bucket-view.js';

const Reactivation = { mount: makeBucketView('reactivation', 'Reactivation', 'Previous customers overdue for renewed outreach') };
const Maintenance  = { mount: makeBucketView('maintenance_due', 'Maintenance', 'Recurring clients approaching their next visit') };

const app = document.getElementById('app');
const navEl = document.createElement('div');
navEl.className = 'nav';
const mainEl = document.createElement('div');
mainEl.className = 'main';
app.appendChild(navEl);
app.appendChild(mainEl);

function matchRoute(hash) {
  if (hash === '' || hash === '#' || hash === '#/') return { view: CommandCenter, params: [] };
  const leadMatch = hash.match(/^#\/lead\/(.+)$/);
  if (leadMatch) return { view: LeadProfile, params: [decodeURIComponent(leadMatch[1])] };
  const table = {
    '#/queue': Queue, '#/messages': Messages, '#/copilot': Copilot, '#/leads': Leads, '#/followups': Followups,
    '#/call-list': CallList, '#/scripts': Scripts, '#/calendar': Calendar, '#/trash': Trash, '#/reactivation': Reactivation,
    '#/maintenance': Maintenance, '#/analytics': Analytics, '#/settings': Settings,
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
  navEl.innerHTML = renderNav(normalizedHash(), navCounts, syncState);
  navEl.querySelectorAll('[data-route]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.route)));
  const syncBtn = navEl.querySelector('[data-action="sync-now"]');
  if (syncBtn) syncBtn.addEventListener('click', syncNow);
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

setUnauthorizedHandler(showKeyGate);
window.addEventListener('hashchange', route);

initSearch();
route();
refreshNavCounts();
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
