// One-way archive — see sales-api/routes.js POST /leads/:id/trash. There is
// no restore action here by design (2026-09-25): a lead trashed by anyone is
// permanently out of every queue bucket, this page just keeps it visible for
// reference instead of disappearing entirely.
import { api } from '../api.js';
import { renderLeadCard, wireLeadCards } from '../components/lead-card.js';
import { escapeHtml } from '../util.js';

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading trash…</div>`;
  let data;
  try { data = await api.trash(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Trash</div><div class="page-sub">${data.leads.length} archived lead${data.leads.length === 1 ? '' : 's'} — permanently out of the queue, kept here for reference</div></div>
    </div>
    ${data.leads.length ? data.leads.map(renderLeadCard).join('') : `<div class="empty-state">Nothing in the trash.</div>`}
  `;

  wireLeadCards(root, { onChanged: () => mount(root) });
}
