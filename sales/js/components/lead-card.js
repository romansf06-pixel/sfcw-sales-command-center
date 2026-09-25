import { escapeHtml, fmtAgo } from '../util.js';

// Renders one queue/lead card as an HTML string. Buttons carry data-action +
// data-lead-id so the containing view can wire ONE delegated click listener
// instead of every card re-registering its own handlers.
const INTENT_BADGE = {
  hot:  '<span class="pill" style="border-color:var(--red);color:var(--red);">HOT</span>',
  warm: '<span class="pill" style="border-color:var(--blue);color:var(--blue);">WARM</span>',
};

export function renderLeadCard(lead) {
  const reasons = (lead.reasons || []).map(r => `<li>${escapeHtml(r)}</li>`).join('');
  const meta = [lead.vehicle, lead.service, lead.pipeline && lead.stage ? `${lead.pipeline} · ${lead.stage}` : lead.stage]
    .filter(Boolean).map(escapeHtml).join(' · ');
  const quoteLine = lead.lastMessage
    ? `<div class="lead-meta" style="margin-top:6px;font-style:italic;">"${escapeHtml(lead.lastMessage.slice(0, 140))}"</div>` : '';
  const badge = lead.intentTag ? INTENT_BADGE[lead.intentTag] || '' : '';
  const lowConfidence = lead.intent?.confidence === 'low'
    ? `<span class="pill" style="border-color:var(--muted);color:var(--muted);">verify</span>` : '';

  return `
  <div class="lead-card" data-lead-id="${lead.id}">
    <div class="lead-top">
      <div>
        <div class="lead-name" data-action="open">${escapeHtml(lead.name)} ${badge} ${lowConfidence}</div>
        <div class="lead-meta">${meta || '—'}${lead.phone ? ' · ' + escapeHtml(lead.phone) : ''}</div>
      </div>
      <div class="lead-meta">${lead.lastMessageAt ? fmtAgo(lead.lastMessageAt) : (lead.createdAt ? fmtAgo(lead.createdAt) : '')}</div>
    </div>
    ${quoteLine}
    <ul class="lead-reasons">${reasons}</ul>
    <div class="lead-actions">
      <button class="btn" data-action="open">Open Lead</button>
      ${lead.phone ? `<a class="btn" href="tel:${escapeHtml(lead.phone)}">Call</a>` : ''}
      <button class="btn" data-action="followup">Set Follow-Up</button>
    </div>
  </div>`;
}
