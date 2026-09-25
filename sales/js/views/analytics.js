import { api } from '../api.js';
import { escapeHtml } from '../util.js';

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading analytics…</div>`;
  let data;
  try { data = await api.stats(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }
  const s = data.stats;

  const kpi = (val, label) => `<div class="kpi"><div class="kpi-val">${val}</div><div class="kpi-lbl">${label}</div></div>`;
  const dispRows = s.dispositionsLast30Days.map(d => `<div class="field-row"><span class="k">${escapeHtml(d.disposition)}</span><span>${d.n}</span></div>`).join('')
    || '<div class="empty-state">No dispositions logged yet.</div>';

  root.innerHTML = `
    <div class="page-hdr"><div class="page-title">Analytics</div><div class="page-sub">Only metrics whose underlying data is trustworthy today</div></div>
    <div class="kpi-row">
      ${kpi(s.newLeadsToday, 'New Leads Today')}
      ${kpi(s.newLeadsWeek, 'New Leads (7d)')}
      ${kpi(s.totalContacts.toLocaleString(), 'Total Contacts')}
      ${kpi(s.totalOpportunities.toLocaleString(), 'Total Opportunities')}
      ${kpi(s.openFollowups, 'Open Follow-Ups')}
      ${kpi(s.overdueFollowups, 'Overdue Follow-Ups')}
      ${kpi(s.upcomingBookings, 'Upcoming Bookings')}
      ${kpi(s.notesLogged, 'Notes Logged')}
    </div>
    <div class="card">
      <div class="card-title">Dispositions Logged (Last 30 Days)</div>
      ${dispRows}
    </div>
    <div class="card">
      <div class="card-title">What's Not Shown Yet — And Why</div>
      ${data.caveats.map(c => `<div class="lead-meta" style="margin-bottom:6px;">⚠ ${escapeHtml(c)}</div>`).join('')}
    </div>
  `;
}
