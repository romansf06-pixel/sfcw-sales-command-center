import { api } from '../api.js';
import { escapeHtml, fmtAgo } from '../util.js';
import { navigate } from '../main.js';

// Every recent conversation/call, chronological — not filtered to "needs
// reply." Reuses the same GHL-synced cache the queue reads (most recent 100
// active threads; GHL's conversations/search endpoint has no pagination
// beyond that, so this IS the practical ceiling for "recent").
let platformFilter = '';

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading messages…</div>`;
  let data;
  try { data = await api.messages(platformFilter); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const platforms = [...new Set(data.messages.map(m => m.platform))];
  const rows = data.messages.map(m => `
    <div class="lead-card" data-contact="${m.contactId || ''}">
      <div class="lead-top">
        <div>
          <div class="lead-name" ${m.contactId ? 'data-action="open"' : ''}>${escapeHtml(m.name)} ${m.unread ? `<span class="pill" style="border-color:var(--red);color:var(--red);">${m.unread} unread</span>` : ''}</div>
          <div class="lead-meta">
            <span class="pill">${escapeHtml(m.platform || 'unknown')}</span>
            <span class="pill" style="margin-left:4px;border-color:${m.direction === 'inbound' ? 'var(--red)' : 'var(--muted)'};color:${m.direction === 'inbound' ? 'var(--red)' : 'var(--text-dim)'};">${m.direction === 'inbound' ? 'FROM CUSTOMER' : 'FROM US'}</span>
            ${m.vehicle ? ' · ' + escapeHtml(m.vehicle) : ''}${m.service ? ' · ' + escapeHtml(m.service) : ''}
          </div>
        </div>
        <div class="lead-meta">${fmtAgo(m.lastMessageAt)}</div>
      </div>
      <div class="lead-meta" style="margin-top:6px;font-style:italic;">"${escapeHtml((m.lastMessage || '(no text — image/attachment)').slice(0, 160))}"</div>
    </div>`).join('');

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Messages</div><div class="page-sub">${data.messages.length} most recent conversations &amp; call log entries</div></div>
    </div>
    <div class="filters">
      <button class="btn ${!platformFilter ? 'primary' : ''}" data-plat="">All (${data.messages.length})</button>
      ${platforms.map(p => `<button class="btn ${platformFilter === p ? 'primary' : ''}" data-plat="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
    </div>
    ${rows || `<div class="empty-state">No conversations synced yet.</div>`}
  `;

  root.querySelectorAll('[data-plat]').forEach(btn => btn.addEventListener('click', () => { platformFilter = btn.dataset.plat; mount(root); }));
  root.querySelectorAll('[data-action="open"]').forEach(el => el.addEventListener('click', (e) => {
    const id = e.target.closest('[data-contact]').dataset.contact;
    if (id) navigate(`#/lead/${id}`);
  }));
}
