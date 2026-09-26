import { api } from '../api.js';
import { escapeHtml, fmtAgo, toast } from '../util.js';
import { navigate } from '../main.js';

// Every recent conversation/call PLUS Setmore bookings, merged into one
// activity feed and deduped to one row per person (see sales-api/queries.js
// getRecentMessages) — a customer who both texted and has a booking on file
// no longer shows up twice. Styled as a real text-thread list, not lead-cards.
//
// "Called" is intentionally labeled "Calls & Texts", not "Calls" — verified
// live 2026-09-24 (server.js syncGHLConversations comment): this GHL account
// returns every conversation as generic "TYPE_PHONE" whether it was actually
// a call or a text thread, so the sync can't currently tell them apart at the
// conversation-list level. Labeling it as a pure call filter would overclaim
// precision the data doesn't have. Older synced rows may also still carry the
// raw "TYPE_PHONE" string from before that mapping existed — both count.
const PHONE_PLATFORMS = new Set(['call/text', 'TYPE_PHONE']);

let platformFilter = '';
let quickFilter = ''; // '' | 'unread' | 'needs_reply'

function initial(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }

function platformLabel(p) {
  if (PHONE_PLATFORMS.has(p)) return 'Calls & Texts';
  if (p === 'setmore') return 'Setmore';
  return p || 'unknown';
}

function row(m) {
  const unread = m.unread > 0;
  const isBooking = m.kind === 'booking';
  const dirBadge = m.direction
    ? `<span class="pill" style="border-color:${m.direction === 'inbound' ? 'var(--red)' : 'var(--muted)'};color:${m.direction === 'inbound' ? 'var(--red)' : 'var(--text-dim)'};">${m.direction === 'inbound' ? 'FROM CUSTOMER' : 'FROM US'}</span>`
    : '';
  const meta = [m.vehicle, m.service].filter(Boolean).map(escapeHtml).join(' · ');
  const canReply = !isBooking && m.contactId;

  return `
    <div class="thread-row${unread ? ' unread' : ''}" data-contact="${m.contactId || ''}">
      ${unread ? '<span class="thread-unread-dot" title="Unread"></span>' : ''}
      <div class="thread-avatar" ${m.contactId ? 'data-action="open"' : ''}>${isBooking ? '📅' : escapeHtml(initial(m.name))}</div>
      <div class="thread-body">
        <div class="thread-top" ${m.contactId ? 'data-action="open"' : ''}>
          <span class="thread-name${unread ? ' unread' : ''}">${escapeHtml(m.name)}</span>
          <span class="thread-time">${fmtAgo(m.at)}</span>
        </div>
        <div class="thread-preview${unread ? ' unread' : ''}" ${m.contactId ? 'data-action="open"' : ''}>${escapeHtml((m.preview || '').slice(0, 160))}</div>
        <div class="thread-meta">
          <span class="pill">${escapeHtml(platformLabel(m.platform))}</span>
          ${dirBadge}
          ${meta ? ' · ' + meta : ''}
          ${canReply ? `<button class="btn ghost" data-action="reply-toggle" style="margin-left:auto;font-size:11px;padding:2px 8px;">Reply</button>` : ''}
        </div>
        ${canReply ? `
          <div class="reply-box" data-reply-box style="display:none;margin-top:8px;">
            <textarea data-reply-input placeholder="Text ${escapeHtml(m.name)}…"></textarea>
            <button class="btn primary" data-action="reply-send">Send</button>
          </div>` : ''}
      </div>
    </div>`;
}

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading conversations…</div>`;
  let data;
  try { data = await api.messages(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const platformGroups = [...new Set(data.messages.map(m => platformLabel(m.platform)))];

  function render() {
    let items = data.messages;
    if (platformFilter) items = items.filter(m => platformLabel(m.platform) === platformFilter);
    if (quickFilter === 'unread') items = items.filter(m => m.unread > 0);
    if (quickFilter === 'needs_reply') items = items.filter(m => m.kind === 'message' && m.direction === 'inbound');

    // Unread first (so a rep never has to hunt for it), then most recent —
    // no "(unread)" text label anywhere, just the dot + bold name/preview.
    items = [...items].sort((a, b) => {
      const u = (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0);
      return u !== 0 ? u : b.at - a.at;
    });

    const unreadCount = data.messages.filter(m => m.unread > 0).length;
    const needsReplyCount = data.messages.filter(m => m.kind === 'message' && m.direction === 'inbound').length;

    root.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Conversations</div><div class="page-sub">${data.messages.length} most recent, one row per person — texts, calls, and Setmore bookings merged</div></div>
      </div>
      <div class="filters">
        <button class="btn ${!quickFilter ? 'primary' : ''}" data-quick="">All (${data.messages.length})</button>
        <button class="btn ${quickFilter === 'unread' ? 'primary' : ''}" data-quick="unread">Unread (${unreadCount})</button>
        <button class="btn ${quickFilter === 'needs_reply' ? 'primary' : ''}" data-quick="needs_reply">Needs a Reply (${needsReplyCount})</button>
      </div>
      <div class="filters">
        <button class="btn ghost ${!platformFilter ? 'primary' : ''}" data-plat="">All sources</button>
        ${platformGroups.map(p => `<button class="btn ghost ${platformFilter === p ? 'primary' : ''}" data-plat="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
      </div>
      <div class="thread-list">${items.map(row).join('') || `<div class="empty-state">Nothing matches this filter.</div>`}</div>
    `;

    root.querySelectorAll('[data-quick]').forEach(btn => btn.addEventListener('click', () => { quickFilter = btn.dataset.quick; render(); }));
    root.querySelectorAll('[data-plat]').forEach(btn => btn.addEventListener('click', () => { platformFilter = btn.dataset.plat; render(); }));
    root.querySelectorAll('[data-action="open"]').forEach(el => el.addEventListener('click', () => {
      const id = el.closest('[data-contact]')?.dataset.contact;
      if (id) navigate(`#/lead/${id}`);
    }));
    root.querySelectorAll('[data-action="reply-toggle"]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const box = btn.closest('.thread-body').querySelector('[data-reply-box]');
      const opening = box.style.display === 'none';
      box.style.display = opening ? 'flex' : 'none';
      if (opening) box.querySelector('[data-reply-input]').focus();
    }));
    root.querySelectorAll('[data-action="reply-send"]').forEach(btn => btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = btn.closest('[data-contact]');
      const id = row.dataset.contact;
      const input = row.querySelector('[data-reply-input]');
      const message = input.value.trim();
      if (!id || !message) return;
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await api.sendMessage(id, message);
        input.value = '';
        btn.closest('[data-reply-box]').style.display = 'none';
        toast('Sent');
      } catch (e2) { toast(e2.message); } finally { btn.disabled = false; btn.textContent = 'Send'; }
    }));
  }

  render();
}
