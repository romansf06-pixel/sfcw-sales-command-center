// Shared by Reactivation and Maintenance nav items — both are just a single
// queue bucket rendered as its own page, so there is no separate fake page
// duplicating the queue's logic.
import { api } from '../api.js';
import { renderLeadCard, wireLeadCards } from '../components/lead-card.js';
import { escapeHtml } from '../util.js';

export function makeBucketView(bucketKey, title, subtitle) {
  return async function mount(root) {
    root.innerHTML = `<div class="spinner">Loading…</div>`;
    let data;
    try { data = await api.queue(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }
    const items = data.buckets[bucketKey] || [];
    root.innerHTML = `
      <div class="page-hdr"><div><div class="page-title">${title}</div><div class="page-sub">${subtitle}</div></div></div>
      ${items.length ? items.map(renderLeadCard).join('') : `<div class="empty-state">Nothing here right now.</div>`}
    `;
    wireLeadCards(root, { onChanged: () => mount(root) });
  };
}
