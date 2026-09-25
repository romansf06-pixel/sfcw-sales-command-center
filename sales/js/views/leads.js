import { api } from '../api.js';
import { escapeHtml, fmtDate } from '../util.js';
import { navigate } from '../main.js';

let state = { search: '', source: '', service: '', needsReply: false, followupDue: false, page: 1, pageSize: 50 };

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading leads…</div>`;
  let data;
  try { data = await api.leads(state); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const rows = data.leads.map(l => `
    <tr data-lead-id="${l.id}">
      <td><b style="cursor:pointer" data-action="open">${escapeHtml(l.name)}</b></td>
      <td>${escapeHtml(l.phone || '—')}</td>
      <td>${escapeHtml(l.vehicle || [l.vehicleMake, l.vehicleModel].filter(Boolean).join(' ') || '—')}</td>
      <td>${escapeHtml(l.service || '—')}</td>
      <td>${escapeHtml(l.source || '—')}</td>
      <td>${escapeHtml(l.pipeline || '—')}${l.stage ? ' · ' + escapeHtml(l.stage) : ''}</td>
      <td>${l.booking?.source && l.booking.source !== 'none' ? `✅ ${escapeHtml(l.booking.date || '')}` : '—'}</td>
      <td>${fmtDate(l.createdAt)}</td>
    </tr>`).join('');

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Leads</div><div class="page-sub">${data.total.toLocaleString()} total in GHL</div></div>
    </div>
    <div class="filters">
      <input type="text" id="f-search" placeholder="Search name, phone, vehicle, service…" value="${escapeHtml(state.search)}" style="min-width:240px;">
      <select id="f-source">
        <option value="">All sources</option>
        ${['instagram','phone','lead_form','manual'].map(s => `<option value="${s}" ${state.source===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;"><input type="checkbox" id="f-reply" ${state.needsReply?'checked':''}> Needs reply</label>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;"><input type="checkbox" id="f-followup" ${state.followupDue?'checked':''}> Follow-up due</label>
    </div>
    <div class="table-wrap">
      <table class="leads">
        <thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Service</th><th>Source</th><th>Pipeline / Stage</th><th>Booking</th><th>Created</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="empty-state">No leads match these filters.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="pager">
      <button class="btn" id="p-prev" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
      <span>Page ${state.page} of ${totalPages}</span>
      <button class="btn" id="p-next" ${state.page >= totalPages ? 'disabled' : ''}>Next →</button>
    </div>
  `;

  const rerender = () => mount(root);
  root.querySelector('#f-search').addEventListener('change', e => { state.search = e.target.value; state.page = 1; rerender(); });
  root.querySelector('#f-source').addEventListener('change', e => { state.source = e.target.value; state.page = 1; rerender(); });
  root.querySelector('#f-reply').addEventListener('change', e => { state.needsReply = e.target.checked; state.page = 1; rerender(); });
  root.querySelector('#f-followup').addEventListener('change', e => { state.followupDue = e.target.checked; state.page = 1; rerender(); });
  root.querySelector('#p-prev').addEventListener('click', () => { if (state.page > 1) { state.page--; rerender(); } });
  root.querySelector('#p-next').addEventListener('click', () => { if (state.page < totalPages) { state.page++; rerender(); } });
  root.querySelectorAll('tr[data-lead-id]').forEach(tr => tr.addEventListener('click', () => navigate(`#/lead/${tr.dataset.leadId}`)));
}
