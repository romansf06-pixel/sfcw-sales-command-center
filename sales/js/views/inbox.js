import { api } from '../api.js';
import { renderLeadCard } from '../components/lead-card.js';
import { openFollowupModal } from '../components/modal.js';
import { escapeHtml } from '../util.js';
import { navigate } from '../main.js';

// "Inbox" here means conversations that actually need action, not every
// conversation ever sent — reuses the exact same needs_reply rule the queue
// uses (GHL's lastMessageDirection === 'inbound' with nothing sent back since).
export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading inbox…</div>`;
  let data;
  try { data = await api.queue(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }
  const items = data.buckets.needs_reply || [];

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Inbox</div><div class="page-sub">Conversations waiting on a reply — sorted longest-waiting first</div></div>
      <button class="btn" id="ib-refresh">↺ Refresh</button>
    </div>
    ${items.length ? items.map(renderLeadCard).join('') : `<div class="empty-state">No unanswered messages right now.</div>`}
  `;
  root.querySelector('#ib-refresh').addEventListener('click', () => mount(root));
  root.querySelectorAll('[data-lead-id]').forEach(card => {
    const id = card.dataset.leadId;
    card.querySelectorAll('[data-action="open"]').forEach(b => b.addEventListener('click', () => navigate(`#/lead/${id}`)));
    card.querySelectorAll('[data-action="followup"]').forEach(b => b.addEventListener('click', () => openFollowupModal(id, () => mount(root))));
  });
}
