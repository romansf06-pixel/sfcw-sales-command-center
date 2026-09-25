// Calendar tab — replaces the old flat Bookings list with a month grid so a
// rep can see the shape of the week/month at a glance, then click a day for
// full details. Same data source as before (api.bookings(), Setmore-backed
// via sales-api/queries.js getBookingsOverview) — this is a presentation
// change, not a new data source. See the disclaimer card below for the
// Setmore-vs-GHL-Calendar authority note carried over from bookings.js.
import { api } from '../api.js';
import { escapeHtml } from '../util.js';
import { navigate } from '../main.js';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Inverse of dayKey — always local time, never the UTC-midnight shift a
// bare `new Date("YYYY-MM-DD")` would introduce.
function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = startOffset - 1; i >= 0; i--) cells.push({ date: new Date(year, month - 1, prevMonthDays - i), out: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), out: false });
  let next = 1;
  while (cells.length % 7 !== 0) cells.push({ date: new Date(year, month + 1, next++), out: true });
  return cells;
}

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading calendar…</div>`;
  let data;
  try { data = await api.bookings(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const all = [...data.today, ...data.tomorrow, ...data.upcoming, ...data.recent];
  const byDay = new Map();
  for (const b of all) {
    const k = dayKey(b.startsAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(b);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.startsAt - b.startsAt);

  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  let selectedKey = dayKey(now.getTime());

  function render() {
    const cells = buildMonthGrid(viewYear, viewMonth);
    const todayKey = dayKey(Date.now());
    const selectedItems = byDay.get(selectedKey) || [];

    root.innerHTML = `
      <div class="page-hdr">
        <div><div class="page-title">Calendar</div><div class="page-sub">Source: Setmore — see note below</div></div>
      </div>
      <div class="card" style="border-color:var(--border2);">
        <div class="lead-meta">Setmore is used here because it's the system that actually creates jobs; the CEO hasn't
        confirmed whether it or the GHL Calendar should be treated as authoritative long-term. Status is always
        "confirmed" in this data — Setmore doesn't report completed/cancelled/no-show, so past bookings are labeled
        by date only, not by real outcome.</div>
      </div>

      <div class="cal-hdr">
        <button class="btn" id="cal-prev">‹ Prev</button>
        <div class="cal-hdr-title">${escapeHtml(new Date(viewYear, viewMonth, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</div>
        <button class="btn" id="cal-next">Next ›</button>
      </div>

      <div class="cal-grid">
        ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
        ${cells.map(c => {
          const k = dayKey(c.date.getTime());
          const items = byDay.get(k) || [];
          const shown = items.slice(0, 3);
          const classes = ['cal-cell', c.out && 'out', k === todayKey && 'today', k === selectedKey && 'selected'].filter(Boolean).join(' ');
          return `
            <div class="${classes}" data-day="${k}">
              <div class="cal-daynum">${c.date.getDate()}</div>
              ${shown.map(b => `<div class="cal-chip${b.startsAt < Date.now() ? ' past' : ''}" title="${escapeHtml(b.customerName)}">${escapeHtml(b.customerName)}</div>`).join('')}
              ${items.length > shown.length ? `<div class="cal-more">+${items.length - shown.length} more</div>` : ''}
            </div>`;
        }).join('')}
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="card-title">${escapeHtml(parseDayKey(selectedKey).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} (${selectedItems.length})</div>
        <div class="cal-detail-list">
          ${selectedItems.map(b => `
            <div class="lead-card" ${b.contactId ? `data-contact="${b.contactId}"` : ''}>
              <div class="lead-top">
                <div>
                  <div class="lead-name" ${b.contactId ? 'data-action="open"' : ''}>${escapeHtml(b.customerName)}</div>
                  <div class="lead-meta">${escapeHtml(b.service || 'Service')}${b.phone ? ' · ' + escapeHtml(b.phone) : ''}</div>
                </div>
                <div class="lead-meta">${new Date(b.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
              </div>
            </div>`).join('') || '<div class="empty-state">No bookings this day.</div>'}
        </div>
      </div>
    `;

    root.querySelector('#cal-prev').addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); });
    root.querySelector('#cal-next').addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); });
    root.querySelectorAll('[data-day]').forEach(el => el.addEventListener('click', () => { selectedKey = el.dataset.day; render(); }));
    root.querySelectorAll('[data-action="open"]').forEach(el => el.addEventListener('click', (e) => {
      const id = e.target.closest('[data-contact]')?.dataset.contact;
      if (id) navigate(`#/lead/${id}`);
    }));
  }

  render();
}
