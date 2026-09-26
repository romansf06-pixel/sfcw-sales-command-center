import { escapeHtml, fmtAgo, HANDLED_BY_NAMES, toast } from '../util.js';
import { api } from '../api.js';
import { openFollowupModal } from './modal.js';
import { navigate } from '../main.js';

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

  const handledChips = HANDLED_BY_NAMES.map(n => `
    <button class="handled-chip${lead.handledBy === n ? ' active' : ''}" data-handled-by="${escapeHtml(n)}">${escapeHtml(n)}</button>
  `).join('');

  return `
  <div class="lead-card" data-lead-id="${lead.id}" draggable="true" title="Drag to the trash icon to archive this lead">
    <div class="lead-top">
      <div>
        <div class="lead-name" data-action="open">${escapeHtml(lead.name)} ${badge} ${lowConfidence}</div>
        <div class="lead-meta">${meta || '—'}${lead.phone ? ' · ' + escapeHtml(lead.phone) : ''}</div>
      </div>
      <div class="lead-meta">${lead.lastMessageAt ? fmtAgo(lead.lastMessageAt) : (lead.createdAt ? fmtAgo(lead.createdAt) : '')}</div>
    </div>
    ${quoteLine}
    <ul class="lead-reasons">${reasons}</ul>
    <div class="handled-row">
      <span class="handled-label">Handled by</span>
      ${handledChips}
    </div>
    <div class="lead-actions">
      <button class="btn" data-action="open">Open Lead</button>
      ${lead.phone ? `<a class="btn" href="tel:${escapeHtml(lead.phone)}">Call</a>` : ''}
      <button class="btn" data-action="followup">Set Follow-Up</button>
    </div>
  </div>`;
}

// Shared click-wiring for every view that renders a list of renderLeadCard()
// output (Queue, Command Center, the bucket views) — kept in one place so
// "Handled by" doesn't need re-wiring by hand in three files. Pass onChanged
// to control what happens after a Handled-by/Follow-up action (e.g. re-mount
// the page); omitted, Handled-by toggles its own chip in place. Trashing is
// drag-and-drop onto the global trash icon (see main.js), not a click here —
// dragstart is wired below regardless of onChanged.
export function wireLeadCards(root, { onChanged } = {}) {
  root.querySelectorAll('[data-lead-id]').forEach(card => {
    const id = card.dataset.leadId;
    card.querySelectorAll('[data-action="open"]').forEach(b => b.addEventListener('click', () => navigate(`#/lead/${id}`)));
    card.querySelectorAll('[data-action="followup"]').forEach(b => b.addEventListener('click', () => openFollowupModal(id, onChanged)));

    card.querySelectorAll('[data-handled-by]').forEach(chip => chip.addEventListener('click', async () => {
      const name = chip.dataset.handledBy;
      const wasActive = chip.classList.contains('active');
      try {
        await api.setHandledBy(id, wasActive ? null : name);
        if (onChanged) { onChanged(); return; }
        card.querySelectorAll('[data-handled-by]').forEach(c => c.classList.toggle('active', c === chip && !wasActive));
      } catch (e) { toast(e.message); }
    }));

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });
}
