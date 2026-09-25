import { api } from './api.js';

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtAgo(ms) {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  const m = Math.round(abs / 60000);
  if (m < 60) return `${Math.max(1, m)}m ${suffix}`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ${suffix}`;
  return `${Math.round(h / 24)}d ${suffix}`;
}

export function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const BUCKET_META = {
  needs_reply:     { label: 'Needs Reply',     color: 'var(--red)' },
  followup_due:    { label: 'Follow-Up Due',   color: 'var(--amber)' },
  new_lead:        { label: 'New Lead',        color: 'var(--blue)' },
  ready_to_book:   { label: 'Ready to Book',   color: 'var(--green)' },
  quote_followup:  { label: 'Quote Follow-Up', color: 'var(--accent-l)' },
  awaiting_reply:  { label: 'Awaiting Reply',  color: 'var(--blue)' },
  maintenance_due: { label: 'Maintenance Due', color: 'var(--purple)' },
  reactivation:    { label: 'Reactivation',    color: 'var(--text-dim)' },
  nurture:         { label: 'Nurture',         color: 'var(--blue)' },
  cold_lead:       { label: 'Cold Lead',       color: 'var(--muted)' },
  low_priority_source: { label: 'Low-Priority Source', color: 'var(--muted)' },
  no_action_needed:{ label: 'No Sales Action Needed', color: 'var(--muted)' },
};

export const DISPOSITIONS = [
  ['no_answer', 'No Answer'], ['voicemail', 'Left Voicemail'], ['spoke_follow_up', 'Spoke — Follow Up'],
  ['needs_quote', 'Needs Quote'], ['quote_sent', 'Quote Sent'], ['thinking', 'Thinking About It'],
  ['ready_to_book', 'Ready To Book'], ['booked', 'Booked'], ['not_interested', 'Not Interested'],
  ['price_objection', 'Price Objection'], ['timing_objection', 'Timing Objection'],
  ['wrong_number', 'Wrong Number'], ['do_not_contact', 'Do Not Contact'], ['lost', 'Lost'],
];

export const FOLLOWUP_PRESETS = [
  ['Later today', 3 * 3600e3], ['Tomorrow', 24 * 3600e3], ['2 days', 2 * 86400e3],
  ['3 days', 3 * 86400e3], ['1 week', 7 * 86400e3],
];

export function renderComplianceBanner(flags) {
  if (!flags || !flags.length) return '';
  const rows = flags.map(f => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;">
      <span>${escapeHtml(f.name)} (${escapeHtml(f.phone || '')}) — ${escapeHtml(f.reasons[0])}</span>
      <button class="btn danger" data-confirm-dnc="${f.id}" style="font-size:11px;padding:4px 10px;">Confirm Do Not Contact</button>
    </div>`).join('');
  return `<div class="card" style="border-color:var(--red);background:rgba(239,68,68,.06);">
    <div class="card-title" style="color:var(--red);">⚠ Compliance — Opt-Out Detected</div>
    <div style="font-size:12px;">${rows}</div>
  </div>`;
}

// Shared wiring for the button rendered above — call after inserting the
// banner's HTML into the DOM. A human confirms rather than the system
// auto-writing a disposition from a regex match alone.
export function wireComplianceBanner(root, onConfirmed) {
  root.querySelectorAll('[data-confirm-dnc]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await api.addDisposition(btn.dataset.confirmDnc, 'do_not_contact', 'Auto-detected SMS opt-out (STOP), confirmed by rep');
      toast('Marked Do Not Contact');
      if (onConfirmed) onConfirmed();
    } catch (e) { toast(e.message); }
  }));
}

export function toast(msg) {
  let el = document.getElementById('sfcw-toast');
  if (!el) { el = document.createElement('div'); el.id = 'sfcw-toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
}
