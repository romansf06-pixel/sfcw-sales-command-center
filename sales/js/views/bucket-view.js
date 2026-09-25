// Shared by Reactivation and Maintenance nav items — both are just a single
// queue bucket rendered as its own page, so there is no separate fake page
// duplicating the queue's logic.
import { api } from '../api.js';
import { renderLeadCard } from '../components/lead-card.js';
import { openFollowupModal } from '../components/modal.js';
import { escapeHtml } from '../util.js';
import { navigate } from '../main.js';

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
    root.querySelectorAll('[data-lead-id]').forEach(card => {
      const id = card.dataset.leadId;
      card.querySelectorAll('[data-action="open"]').forEach(b => b.addEventListener('click', () => navigate(`#/lead/${id}`)));
      card.querySelectorAll('[data-action="followup"]').forEach(b => b.addEventListener('click', () => openFollowupModal(id, () => mount(root))));
    });
  };
}
