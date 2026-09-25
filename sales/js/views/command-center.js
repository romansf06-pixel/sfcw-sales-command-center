import { api } from '../api.js';
import { renderLeadCard } from '../components/lead-card.js';
import { openFollowupModal } from '../components/modal.js';
import { BUCKET_META, escapeHtml, renderComplianceBanner, wireComplianceBanner } from '../util.js';
import { navigate } from '../main.js';

export async function mount(root) {
  root.innerHTML = `<div class="spinner">Loading command center…</div>`;
  let data;
  try { data = await api.queue(); } catch (e) { root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; return; }

  const order = ['needs_reply', 'new_lead', 'followup_due', 'ready_to_book', 'awaiting_reply'];
  const kpis = order.map(k => `
    <div class="kpi c-${k}" data-jump="${k}">
      <div class="kpi-val">${data.counts[k] || 0}</div>
      <div class="kpi-lbl">${BUCKET_META[k].label}</div>
    </div>`).join('');

  const nba = data.nextBestAction
    ? `<div class="nba"><div class="nba-label">Next Best Action — ${BUCKET_META[data.nextBestAction.bucket].label}</div>${renderLeadCard(data.nextBestAction)}</div>`
    : `<div class="nba"><div class="nba-label">Next Best Action</div><div class="empty-state">Nothing urgent right now — nice work.</div></div>`;

  const upcomingKeys = order.filter(k => data.buckets[k]?.length).slice(0, 3);
  const preview = upcomingKeys.map(k => `
    <div class="bucket-hdr"><span class="dot" style="background:${BUCKET_META[k].color}"></span>${BUCKET_META[k].label} (${data.buckets[k].length})</div>
    ${data.buckets[k].slice(0, 2).map(renderLeadCard).join('')}
  `).join('');

  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Command Center</div><div class="page-sub">Generated ${new Date(data.generatedAt).toLocaleTimeString()}</div></div>
      <button class="btn" id="cc-refresh">↺ Refresh</button>
    </div>
    <div class="brief-card" id="cc-brief"><div class="brief-label">Daily Brief</div><div class="spinner" style="padding:0;">Loading…</div></div>
    ${renderComplianceBanner(data.complianceFlags)}
    <div class="kpi-row">${kpis}</div>
    ${nba}
    ${preview}
    <div style="text-align:center;margin-top:10px;"><a href="#/queue" class="btn">Open Full Queue →</a></div>
  `;

  root.querySelector('#cc-refresh').addEventListener('click', () => mount(root));
  wireComplianceBanner(root, () => mount(root));
  root.querySelectorAll('[data-jump]').forEach(el => el.addEventListener('click', () => navigate('#/queue')));
  root.querySelectorAll('[data-lead-id]').forEach(card => {
    const id = card.dataset.leadId;
    card.querySelectorAll('[data-action="open"]').forEach(b => b.addEventListener('click', () => navigate(`#/lead/${id}`)));
    card.querySelectorAll('[data-action="followup"]').forEach(b => b.addEventListener('click', () => openFollowupModal(id, () => mount(root))));
  });

  // Non-blocking: the rest of the page is already useful even if this is slow or unavailable.
  api.dailyBrief().then(r => {
    const el = root.querySelector('#cc-brief');
    if (el) el.innerHTML = `<div class="brief-label">Daily Brief${r.source === 'template' ? ' (AI unavailable — showing raw numbers)' : ''}</div>${escapeHtml(r.text)}`;
  }).catch(() => {
    const el = root.querySelector('#cc-brief');
    if (el) el.style.display = 'none';
  });
}
