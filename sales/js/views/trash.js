// One-way archive — see sales-api/routes.js POST /leads/:id/trash. There is
// no restore action here by design (2026-09-25): a lead trashed by anyone is
// permanently out of every queue bucket. Opened as a modal from the global
// trash icon (main.js), not a page route — drag a lead card onto the icon to
// trash it, click the icon to see what's in here.
import { api } from '../api.js';
import { renderLeadCard, wireLeadCards } from '../components/lead-card.js';
import { showModal } from '../components/modal.js';
import { escapeHtml } from '../util.js';

export async function openTrashModal() {
  const el = showModal(`<div class="spinner">Loading trash…</div>`);
  await render(el);
}

async function render(el) {
  let data;
  try { data = await api.trash(); } catch (e) { el.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  el.innerHTML = `
    <div class="card-title">Trash — ${data.leads.length} archived lead${data.leads.length === 1 ? '' : 's'}</div>
    <div class="lead-meta" style="margin-bottom:10px;">Permanently out of the queue. No restore — kept here for reference only.</div>
    <div class="trash-modal-list">
      ${data.leads.length ? data.leads.map(renderLeadCard).join('') : `<div class="empty-state">Nothing in the trash.</div>`}
    </div>
  `;
  wireLeadCards(el, { onChanged: () => render(el) });
}
