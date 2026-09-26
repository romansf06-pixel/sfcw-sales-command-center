// Website quote-form submissions, most recent first — see sales-api/queries.js
// getFormSubmits (source='lead_form', the one clean value for this).
import { api } from '../api.js';
import { renderLeadCard, wireLeadCards } from '../components/lead-card.js';
import { escapeHtml } from '../util.js';

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading form submits…</div>`;
  let data;
  try { data = await api.formSubmits(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Form Submits</div><div class="page-sub">${data.leads.length} most recent website quote-form submissions</div></div>
    </div>
    ${data.leads.length ? data.leads.map(renderLeadCard).join('') : `<div class="empty-state">No form submissions on file.</div>`}
  `;

  wireLeadCards(root, { onChanged: () => mount(root) });
}
