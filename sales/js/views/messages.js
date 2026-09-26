import { api } from '../api.js';
import { escapeHtml, fmtAgo } from '../util.js';
import { navigate } from '../main.js';

// Every recent conversation/call PLUS Setmore bookings, merged into one
// activity feed and deduped to one row per person (see sales-api/queries.js
// getRecentMessages) — a customer who both texted and has a booking on file
// no longer shows up twice. Styled as a real text-thread list, not lead-cards.
let platformFilter = '';

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

function row(m) {
  const unread = m.unread > 0;
  const isBooking = m.kind === 'booking';
  const dirBadge = m.direction
    ? `<span class="pill" style="border-color:${m.direction === 'inbound' ? 'var(--red)' : 'var(--muted)'};color:${m.direction === 'inbound' ? 'var(--red)' : 'var(--text-dim)'};">${m.direction === 'inbound' ? 'FROM CUSTOMER' : 'FROM US'}</span>`
    : '';
  const meta = [m.vehicle, m.service].filter(Boolean).map(escapeHtml).join(' · ');

  return `
    <div class="thread-row" ${m.contactId ? `data-contact="${m.contactId}" data-action="open"` : ''}>
      <div class="thread-avatar">${isBooking ? '📅' : escapeHtml(initial(m.name))}</div>
      <div class="thread-body">
        <div class="thread-top">
          <span class="thread-name${unread ? ' unread' : ''}">${escapeHtml(m.name)}</span>
          <span class="thread-time">${fmtAgo(m.at)}</span>
        </div>
        <div class="thread-preview${unread ? ' unread' : ''}">${escapeHtml((m.preview || '').slice(0, 160))}</div>
        <div class="thread-meta">
          <span class="pill">${escapeHtml(m.platform || 'unknown')}</span>
          ${dirBadge}
          ${unread ? `<span class="pill" style="border-color:var(--red);color:var(--red);">${m.unread} unread</span>` : ''}
          ${meta ? ' · ' + meta : ''}
        </div>
      </div>
    </div>`;
}

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading conversations…</div>`;
  let data;
  try { data = await api.messages(platformFilter); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const platforms = [...new Set(data.messages.map(m => m.platform))];
  const rows = data.messages.map(row).join('');

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Conversations</div><div class="page-sub">${data.messages.length} most recent, one row per person — texts, calls, and Setmore bookings merged</div></div>
    </div>
    <div class="filters">
      <button class="btn ${!platformFilter ? 'primary' : ''}" data-plat="">All (${data.messages.length})</button>
      ${platforms.map(p => `<button class="btn ${platformFilter === p ? 'primary' : ''}" data-plat="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
    </div>
    <div class="thread-list">${rows || `<div class="empty-state">No activity synced yet.</div>`}</div>
  `;

  root.querySelectorAll('[data-plat]').forEach(btn => btn.addEventListener('click', () => { platformFilter = btn.dataset.plat; mount(root); }));
  root.querySelectorAll('[data-action="open"]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.contact;
    if (id) navigate(`#/lead/${id}`);
  }));
}
