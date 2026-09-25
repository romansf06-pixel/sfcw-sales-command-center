import { api } from '../api.js';
import { escapeHtml, fmtDateTime, fmtAgo } from '../util.js';
import { navigate } from '../main.js';

// Setmore side of the booking picture — real data as of 2026-09-25 (the CEO
// hasn't confirmed whether Setmore or the GHL Calendar is authoritative; see
// sales-api/booking-source.js). Setmore's API never reports
// completed/cancelled/no-show status (everything syncs as "confirmed"), so
// this only distinguishes past vs. upcoming by date, not by real outcome.
function row(b, { showWhen = true } = {}) {
  const when = showWhen ? fmtDateTime(b.startsAt) : new Date(b.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `
    <div class="lead-card" ${b.contactId ? `data-contact="${b.contactId}"` : ''}>
      <div class="lead-top">
        <div>
          <div class="lead-name" ${b.contactId ? 'data-action="open"' : ''}>${escapeHtml(b.customerName)}</div>
          <div class="lead-meta">${escapeHtml(b.service || 'Service')}${b.phone ? ' · ' + escapeHtml(b.phone) : ''}</div>
        </div>
        <div class="lead-meta">${when}</div>
      </div>
    </div>`;
}

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading bookings…</div>`;
  let data;
  try { data = await api.bookings(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const section = (title, items, opts) => `
    <div class="bucket-hdr">${title} (${items.length})</div>
    ${items.length ? items.map(b => row(b, opts)).join('') : `<div class="empty-state">Nothing here.</div>`}
  `;

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Bookings</div><div class="page-sub">Source: Setmore — see note below</div></div>
    </div>
    <div class="card" style="border-color:var(--border2);">
      <div class="lead-meta">Setmore is used here because it's the system that actually creates jobs; the CEO hasn't
      confirmed whether it or the GHL Calendar should be treated as authoritative long-term. Status is always
      "confirmed" in this data — Setmore doesn't report completed/cancelled/no-show, so past bookings are labeled
      by date only, not by real outcome.</div>
    </div>
    ${section('Today', data.today, { showWhen: false })}
    ${section('Tomorrow', data.tomorrow, { showWhen: false })}
    ${section('Upcoming', data.upcoming, {})}
    ${section('Recently Completed', data.recent, {})}
  `;

  root.querySelectorAll('[data-action="open"]').forEach(el => el.addEventListener('click', (e) => {
    const id = e.target.closest('[data-contact]')?.dataset.contact;
    if (id) navigate(`#/lead/${id}`);
  }));
}
