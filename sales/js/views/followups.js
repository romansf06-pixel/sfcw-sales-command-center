import { api } from '../api.js';
import { escapeHtml, fmtDateTime, fmtAgo, toast } from '../util.js';
import { navigate } from '../main.js';

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading follow-ups…</div>`;
  let data;
  try { data = await api.followups('open'); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const now = Date.now();
  const overdue = data.followups.filter(f => f.due_at <= now).sort((a, b) => a.due_at - b.due_at);
  const upcoming = data.followups.filter(f => f.due_at > now).sort((a, b) => a.due_at - b.due_at);

  const row = (f, isOverdue) => `
    <div class="lead-card" data-id="${f.id}" data-contact="${f.contact_id}">
      <div class="lead-top">
        <div>
          <div class="lead-name" data-action="open">${escapeHtml(f.reason || 'Follow-up')}</div>
          <div class="lead-meta">${isOverdue ? `Overdue by ${fmtAgo(f.due_at)}` : `Due ${fmtDateTime(f.due_at)}`}</div>
          ${f.note ? `<div class="lead-meta">${escapeHtml(f.note)}</div>` : ''}
        </div>
      </div>
      <div class="lead-actions">
        <button class="btn" data-action="open">Open Lead</button>
        <button class="btn primary" data-action="complete">Mark Done</button>
        <button class="btn ghost" data-action="cancel">Cancel</button>
      </div>
    </div>`;

  root.innerHTML = `
    <div class="page-hdr"><div><div class="page-title">Follow-Ups</div><div class="page-sub">${overdue.length} overdue · ${upcoming.length} upcoming</div></div></div>
    <div class="bucket-hdr"><span class="dot" style="background:var(--red)"></span>Overdue</div>
    ${overdue.length ? overdue.map(f => row(f, true)).join('') : '<div class="empty-state">Nothing overdue.</div>'}
    <div class="bucket-hdr"><span class="dot" style="background:var(--blue)"></span>Upcoming</div>
    ${upcoming.length ? upcoming.map(f => row(f, false)).join('') : '<div class="empty-state">Nothing scheduled.</div>'}
  `;

  root.querySelectorAll('[data-id]').forEach(card => {
    const id = card.dataset.id, contact = card.dataset.contact;
    card.querySelectorAll('[data-action="open"]').forEach(b => b.addEventListener('click', () => navigate(`#/lead/${contact}`)));
    card.querySelector('[data-action="complete"]').addEventListener('click', async () => { await api.completeFollowup(id); toast('Marked done'); mount(root); });
    card.querySelector('[data-action="cancel"]').addEventListener('click', async () => { await api.cancelFollowup(id); toast('Cancelled'); mount(root); });
  });
}
