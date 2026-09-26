import { api } from '../api.js';
import { renderLeadCard, wireLeadCards } from '../components/lead-card.js';
import { BUCKET_META, escapeHtml, renderComplianceBanner, wireComplianceBanner } from '../util.js';

const ORDER = ['needs_reply', 'followup_due', 'new_lead', 'ready_to_book', 'quote_followup', 'awaiting_reply', 'maintenance_due', 'reactivation', 'nurture', 'cold_lead'];
const COLLAPSED = ['low_priority_source', 'no_action_needed'];

function collapsedSection(key, items, idPrefix) {
  if (!items.length) return '';
  const label = key === 'low_priority_source'
    ? `${items.length} from a lower-priority source (Instagram / unresolved calls / expired) — click to review`
    : `${items.length} message${items.length === 1 ? '' : 's'} classified as no sales action needed — click to review`;
  return `
    <div class="bucket-hdr" id="${idPrefix}-toggle" style="cursor:pointer;color:var(--muted);">
      <span class="dot" style="background:${BUCKET_META[key].color}"></span>${label}
    </div>
    <div id="${idPrefix}-list" style="display:none;">${items.map(renderLeadCard).join('')}</div>
  `;
}

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading queue…</div>`;
  let data;
  try { data = await api.queue(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const actionableTotal = ORDER.reduce((sum, k) => sum + (data.counts[k] || 0), 0);
  const sections = ORDER.map(key => {
    const items = data.buckets[key] || [];
    if (!items.length) return '';
    return `
      <div class="bucket-hdr"><span class="dot" style="background:${BUCKET_META[key].color}"></span>${BUCKET_META[key].label} (${items.length})</div>
      ${items.map(renderLeadCard).join('')}
    `;
  }).join('');

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">My Queue</div><div class="page-sub">${actionableTotal} leads need attention right now</div></div>
      <button class="btn" id="q-refresh">↺ Refresh</button>
    </div>
    ${renderComplianceBanner(data.complianceFlags)}
    ${actionableTotal ? sections : `<div class="empty-state">Queue is empty — everything's either booked, snoozed, or waiting on the customer.</div>`}
    ${collapsedSection('low_priority_source', data.buckets.low_priority_source || [], 'lp')}
    ${collapsedSection('no_action_needed', data.buckets.no_action_needed || [], 'na')}
  `;

  root.querySelector('#q-refresh').addEventListener('click', () => mount(root));
  wireComplianceBanner(root, () => mount(root));
  ['lp', 'na'].forEach(prefix => {
    const toggle = root.querySelector(`#${prefix}-toggle`);
    if (toggle) toggle.addEventListener('click', () => {
      const list = root.querySelector(`#${prefix}-list`);
      list.style.display = list.style.display === 'none' ? 'block' : 'none';
    });
  });
  wireLeadCards(root, { onChanged: () => mount(root) });
}
