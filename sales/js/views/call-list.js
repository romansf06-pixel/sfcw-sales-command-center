import { api } from '../api.js';
import { escapeHtml, DISPOSITIONS, toast } from '../util.js';
import { renderPricingCard, buildCallScript, buildUpsellNotes } from '../pricing.js';

let cursor = 0;
let helperToken = 0; // guards against a slow api.lead() for a skipped card landing on the next one

// Working set = everything actionable, needs-reply first, cold/reactivation
// last — a rep working straight down this list touches the highest-value
// leads first without having to think about which bucket to open.
const ORDER = ['needs_reply', 'followup_due', 'new_lead', 'ready_to_book', 'quote_followup', 'maintenance_due', 'reactivation', 'cold_lead'];

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Building call list…</div>`;
  let data;
  try { data = await api.queue(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }
  const list = ORDER.flatMap(k => data.buckets[k] || []);
  cursor = 0;
  renderCard(root, list);
}

function renderCard(root, list) {
  if (!list.length) { root.innerHTML = `<div class="empty-state">Queue is empty — nothing to call.</div>`; return; }
  if (cursor >= list.length) {
    root.innerHTML = `<div class="call-card"><h2>All done 🎉</h2><p class="page-sub">Worked through ${list.length} leads.</p><button class="btn primary" id="cl-restart">Start Over</button></div>`;
    root.querySelector('#cl-restart').addEventListener('click', () => { cursor = 0; renderCard(root, list); });
    return;
  }
  const lead = list[cursor];
  root.innerHTML = `
    <div class="page-hdr"><div class="page-title">Call List</div></div>
    <div class="call-card card" style="max-width:640px;">
      <div class="call-progress">Call ${cursor + 1} of ${list.length}</div>
      <h2 style="margin:4px 0;">${escapeHtml(lead.name)}</h2>
      <div class="page-sub">${escapeHtml(lead.vehicle || '')}${lead.service ? ' · ' + escapeHtml(lead.service) : ''}</div>
      ${lead.phone ? `<div style="margin-top:6px;"><a class="btn primary" href="tel:${escapeHtml(lead.phone)}">📞 ${escapeHtml(lead.phone)}</a></div>` : ''}

      <div class="call-goal">
        <b>WHY CALLING</b><br>${(lead.reasons || []).map(escapeHtml).join('<br>')}
      </div>

      <div class="disp-grid">
        ${DISPOSITIONS.map(([val, label]) => `<button class="btn disp-btn" data-disposition="${val}">${escapeHtml(label)}</button>`).join('')}
      </div>

      <div class="call-actions">
        <button class="btn" id="cl-open">Open Full Profile</button>
        <button class="btn ghost" id="cl-skip">Skip →</button>
      </div>
    </div>

    <div id="cl-helper" style="max-width:640px;margin:0 auto;text-align:left;">
      <div class="spinner">Loading call helper…</div>
    </div>
  `;

  root.querySelectorAll('[data-disposition]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.addDisposition(lead.id, btn.dataset.disposition);
      toast('Logged: ' + btn.textContent);
      cursor++;
      renderCard(root, list);
    } catch (e) { toast(e.message); }
  }));
  root.querySelector('#cl-open').addEventListener('click', () => { window.location.hash = `#/lead/${lead.id}`; });
  root.querySelector('#cl-skip').addEventListener('click', () => { cursor++; renderCard(root, list); });

  // Queue entries are the thin priority-engine shape (name/vehicle/service/
  // reasons only) — fetch the full lead record for pricing + script + upsell
  // notes, which need vehicleYear/Make/Model, quotedPrice, notes, etc. Token
  // guard: if the rep skips/dispositions to the next card before this
  // resolves, a stale response must not overwrite the new card's #cl-helper
  // (same id reused every render, so an element-existence check isn't enough).
  const myToken = ++helperToken;
  api.lead(lead.id).then(({ lead: full }) => {
    if (myToken !== helperToken) return;
    const helper = root.querySelector('#cl-helper');
    if (!helper) return;
    helper.innerHTML = `
      ${renderPricingCard(full)}
      <div class="card">
        <div class="card-title">Call Script — For This Lead</div>
        ${buildCallScript(full, escapeHtml)}
      </div>
      <div class="card">
        <div class="card-title">Upsell &amp; Recommendations</div>
        ${buildUpsellNotes(full, escapeHtml)}
      </div>
    `;
  }).catch(() => {
    if (myToken !== helperToken) return;
    const helper = root.querySelector('#cl-helper');
    if (helper) helper.innerHTML = `<div class="empty-state">Could not load call helper for this lead.</div>`;
  });
}
