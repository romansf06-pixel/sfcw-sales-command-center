import { api } from '../api.js';
import { escapeHtml, toast } from '../util.js';

const FIELDS = [
  ['newLeadWindowHours', 'New lead window (hours)', 'A lead stops counting as "new" after this many hours with no contact.'],
  ['coldLeadDays', 'Cold lead threshold (days)', 'No activity for this long → shows in Cold Lead.'],
  ['quoteFollowupHours', 'Quote follow-up wait (hours)', 'How long to wait after a quote signal before flagging a follow-up.'],
  ['reactivationMonths', 'Reactivation interval (months)', 'Months since last completed job before a past customer is offered for reactivation.'],
  ['maintenanceLookaheadDays', 'Maintenance lookahead (days)', 'Show maintenance clients this many days before they\'re actually due.'],
];

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading settings…</div>`;
  const [{ settings, defaults }, { rep }] = await Promise.all([api.settings(), api.rep()]);
  const priority = { ...defaults.priority, ...(settings.priority || {}) };

  root.innerHTML = `
    <div class="page-hdr"><div class="page-title">Settings</div></div>
    <div class="card">
      <div class="card-title">Rep Identity</div>
      <div class="field-row"><span class="k">Name</span><span>${escapeHtml(rep.name)}</span></div>
      <div class="field-row"><span class="k">GHL user</span><span>${rep.ghl_user_id ? escapeHtml(rep.ghl_user_id) : 'Not linked yet — works fine without one'}</span></div>
    </div>
    <div class="card">
      <div class="card-title">Priority Engine Thresholds</div>
      ${FIELDS.map(([key, label, hint]) => `
        <div style="margin-bottom:10px;">
          <label style="font-size:12px;font-weight:700;">${label}</label>
          <input type="number" id="f-${key}" value="${priority[key]}" style="width:100px;margin-left:10px;">
          <div style="font-size:11px;color:var(--muted);">${hint}</div>
        </div>`).join('')}
      <button class="btn primary" id="save-settings">Save</button>
    </div>
    <div class="card">
      <div class="card-title">Saved Views &amp; Custom Columns</div>
      <div class="empty-state">Coming in a later phase — the queue and leads table are built to support this without a redesign.</div>
    </div>
  `;

  root.querySelector('#save-settings').addEventListener('click', async () => {
    const next = { ...priority };
    FIELDS.forEach(([key]) => { next[key] = Number(root.querySelector(`#f-${key}`).value) || priority[key]; });
    try { await api.saveSettings({ priority: next }); toast('Settings saved'); } catch (e) { toast(e.message); }
  });
}
