// Sales-only analytics, per person — replaces the old generic KPI dashboard
// (2026-09-26, owner request). Two attribution signals per person, kept
// distinct on purpose — see sales-api/queries.js getRepAnalytics:
//   - "Logged in as" activity: dispositions logged while signed in as them.
//   - "Handled by" deals/revenue: leads they own, regardless of who was
//     signed in when a disposition got logged on it.
import { api } from '../api.js';
import { escapeHtml } from '../util.js';

function pct(closed, lost) {
  const total = closed + lost;
  return total ? Math.round((closed / total) * 100) : null;
}

function warmthLine(label, w) {
  const p = pct(w.closed, w.lost);
  return `<div class="field-row"><span class="k">${label}</span><span>${p === null ? 'No closed/lost data yet' : `${p}% (${w.closed} of ${w.closed + w.lost})`}</span></div>`;
}

function personCard(p) {
  return `
    <div class="card">
      <div class="card-title">${escapeHtml(p.name)}</div>
      <div class="kpi-row" style="margin-bottom:14px;">
        <div class="kpi"><div class="kpi-val">$${p.revenue.toLocaleString()}</div><div class="kpi-lbl">Revenue (Closed Deals)</div></div>
        <div class="kpi"><div class="kpi-val">${p.closedCount}</div><div class="kpi-lbl">Deals Closed</div></div>
        <div class="kpi"><div class="kpi-val">${p.handledCount}</div><div class="kpi-lbl">Leads Handled</div></div>
        <div class="kpi"><div class="kpi-val">${p.activityCount}</div><div class="kpi-lbl">Dispositions Logged In As ${escapeHtml(p.name)}</div></div>
      </div>
      <div class="lead-meta" style="margin-bottom:4px;">Close % by warmth, for leads handled by ${escapeHtml(p.name)}:</div>
      ${warmthLine('Hot leads', p.warmth.hot)}
      ${warmthLine('Warm leads', p.warmth.warm)}
    </div>`;
}

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading analytics…</div>`;
  let data;
  try { data = await api.repAnalytics(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  root.innerHTML = `
    <div class="page-hdr"><div class="page-title">Analytics</div><div class="page-sub">Per person — revenue and close rate, not generic pipeline counts</div></div>
    ${data.people.map(personCard).join('')}
    <div class="card">
      <div class="card-title">What's Not Shown Yet — And Why</div>
      ${data.caveats.map(c => `<div class="lead-meta" style="margin-bottom:6px;">⚠ ${escapeHtml(c)}</div>`).join('')}
    </div>
  `;
}
