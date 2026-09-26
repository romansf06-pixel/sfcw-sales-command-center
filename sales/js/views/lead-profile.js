import { api } from '../api.js';
import { escapeHtml, fmtAgo, fmtDateTime, fmtDate, DISPOSITIONS, toast } from '../util.js';
import { openFollowupModal } from '../components/modal.js';
import { navigate } from '../main.js';
import { renderPricingCard, buildCallScript, buildUpsellNotes } from '../pricing.js';

function fmtTime12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function fmtWeekdayDate(dateStr) {
  // dateStr is "YYYY-MM-DD" — parsed as local, not UTC, so the weekday
  // shown always matches the date shown (a bare `new Date("YYYY-MM-DD")`
  // parses as UTC midnight, which reads as the previous day west of UTC).
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function ruleBasedSummary(lead) {
  const parts = [];
  parts.push(`${lead.name} came in via ${lead.source || 'an unknown source'}${lead.vehicle ? ` for a ${escapeHtml(lead.vehicle)}` : ''}${lead.service ? `, requesting ${escapeHtml(lead.service)}` : ''}.`);
  if (lead.stage) parts.push(`Currently in "${escapeHtml(lead.stage)}"${lead.pipeline ? ` (${escapeHtml(lead.pipeline)})` : ''}.`);
  if (lead.lastMessage) {
    parts.push(`Last message ${lead.lastMessageDirection === 'inbound' ? 'from the customer' : 'from SF City Wash'} ${fmtAgo(lead.lastMessageAt)}: "${escapeHtml(lead.lastMessage.slice(0, 160))}"`);
  } else {
    parts.push('No conversation on record yet.');
  }
  if (lead.booking && lead.booking.source !== 'none') parts.push(`${lead.booking.timing === 'upcoming' ? 'Upcoming appointment' : 'Last appointment (past)'}: ${escapeHtml(lead.booking.date || '')} via ${lead.booking.source}.`);
  else parts.push('No appointment found.');
  if (lead.openFollowup) parts.push(`Follow-up set for ${fmtDateTime(lead.openFollowup.dueAt)}${lead.openFollowup.reason ? ` — ${escapeHtml(lead.openFollowup.reason)}` : ''}.`);
  return parts.join(' ');
}

// The page container (`root`) is reused across every navigation — if a rep
// opens lead A then clicks lead B before A's requests finish, A's responses
// would otherwise land after B's own mount() has already redrawn the page,
// silently overwriting B's card with A's data (or an empty/error state) until
// a hard refresh. `root.dataset.leadId` is stamped synchronously the instant
// each mount() call starts, so every later async callback can check "is my
// lead still the one on screen" before touching the DOM.
export async function mount(root, id) {
  root.dataset.leadId = id;
  root.innerHTML = `<div class="spinner">Loading lead…</div>`;
  let lead, timeline;
  try {
    [lead, timeline] = await Promise.all([api.lead(id).then(r => r.lead), api.timeline(id).then(r => r.timeline)]);
  } catch (e) {
    if (root.dataset.leadId !== id) return;
    root.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    return;
  }
  if (root.dataset.leadId !== id) return; // navigated away while this was loading

  const vehicle = [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ') || lead.vehicle || '—';

  root.innerHTML = `
    <div class="page-hdr">
      <div>
        <div class="page-title">${escapeHtml(lead.name)}</div>
        <div class="page-sub">${escapeHtml(lead.phone || '')} ${lead.email ? '· ' + escapeHtml(lead.email) : ''}</div>
      </div>
      <div style="display:flex;gap:8px;">
        ${lead.phone ? `<a class="btn primary" href="tel:${escapeHtml(lead.phone)}">Call</a>` : ''}
        <button class="btn" id="lp-followup">Set Follow-Up</button>
        <button class="btn" id="lp-ask-copilot">Ask Copilot</button>
      </div>
    </div>

    <div class="profile-grid">
      <div>
        <div class="card">
          <div class="card-title">Sales Summary</div>
          <div id="lp-summary">${escapeHtml(ruleBasedSummary(lead))}</div>
          ${lead.messageIntent ? `<div class="lead-meta" style="margin-top:6px;">Rule-based message read: <b>${escapeHtml(lead.messageIntent.category)}</b> (${escapeHtml(lead.messageIntent.confidence)} confidence) — ${escapeHtml(lead.messageIntent.reason)}</div>` : ''}
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
            ${['qualify','summarize','prepare_call','next_action','draft_followup','objections','unanswered_questions'].map(a =>
              `<button class="btn ghost" data-assist="${a}" style="font-size:11px;">${a.replace(/_/g,' ')}</button>`).join('')}
          </div>
          <div id="lp-assist-out"></div>
        </div>

        <div class="card">
          <div class="card-title">Conversation</div>
          <div id="lp-convo" style="display:flex;flex-direction:column;">Loading…</div>
        </div>

        <div class="card">
          <div class="card-title">Activity Timeline</div>
          <div class="timeline">
            ${timeline.map(e => `<div class="timeline-item"><div class="timeline-time">${fmtDateTime(e.at)}</div>${escapeHtml(e.label)}</div>`).join('') || '<div class="empty-state">No activity yet.</div>'}
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">Details</div>
          <div class="field-row"><span class="k">Vehicle</span><span>${escapeHtml(vehicle)}</span></div>
          <div class="field-row"><span class="k">Service</span><span>${escapeHtml(lead.service || '—')}</span></div>
          <div class="field-row"><span class="k">Source</span><span>${escapeHtml(lead.source || '—')}</span></div>
          <div class="field-row"><span class="k">Pipeline / Stage</span><span>${escapeHtml(lead.pipeline || '—')}${lead.stage ? ' / ' + escapeHtml(lead.stage) : ''}</span></div>
          <div class="field-row"><span class="k">Tags</span><span>${(lead.tags||[]).map(escapeHtml).join(', ') || '—'}</span></div>
          ${lead.ghlNotes ? `<div class="field-row"><span class="k">Customer note</span><span>${escapeHtml(lead.ghlNotes)}</span></div>` : ''}
          ${lead.maintenance ? `<div class="field-row"><span class="k">Maintenance</span><span>${escapeHtml(lead.maintenance.status)} · next due ${escapeHtml(lead.maintenance.nextDueDate || '—')}</span></div>` : ''}
        </div>

        <div class="card" id="lp-availability">
          <div class="card-title">Availability — Next Openings</div>
          <div class="spinner">Checking live availability…</div>
        </div>

        <div class="card">
          <div class="card-title">Booking</div>
          ${lead.booking && lead.booking.source !== 'none'
            ? `<div>${lead.booking.timing === 'upcoming' ? '✅ Upcoming' : '🕘 Past (most recent)'} — ${escapeHtml(lead.booking.date || '')} ${escapeHtml(lead.booking.time || '')} <span style="color:var(--muted)">(source: ${lead.booking.source})</span></div>`
            : `<div class="empty-state" style="padding:8px 0;">NO APPOINTMENT FOUND</div>`}
          ${lead.previousBookings?.length ? `<div style="margin-top:8px;font-size:11px;color:var(--muted);">${lead.previousBookings.length} previous booking(s) on file</div>` : ''}
        </div>

        <div class="card">
          <div class="card-title">Log Outcome (Disposition)</div>
          <div class="disp-grid">
            ${DISPOSITIONS.map(([val, label]) => `<button class="btn disp-btn" data-disposition="${val}">${escapeHtml(label)}</button>`).join('')}
          </div>
        </div>

        ${renderPricingCard(lead)}

        <div class="card">
          <div class="card-title">Call Script — For This Lead</div>
          <div class="lead-meta" style="margin-bottom:8px;">Built from what's on file for ${escapeHtml(lead.firstName || lead.name)} — keep this open while you dial.</div>
          ${buildCallScript(lead, escapeHtml)}
        </div>

        <div class="card">
          <div class="card-title">Upsell &amp; Recommendations</div>
          <div class="lead-meta" style="margin-bottom:8px;">From the team's sales playbook — condition/correction guidance, interior expectations, and default quoting strategy for this vehicle.</div>
          ${buildUpsellNotes(lead, escapeHtml)}
        </div>

        <div class="card">
          <div class="card-title">Notes</div>
          <textarea id="lp-note-input" placeholder="Add a sales note…" style="width:100%;min-height:60px;"></textarea>
          <button class="btn" id="lp-note-save" style="margin-top:6px;">Save Note</button>
          <div id="lp-notes" style="margin-top:10px;">
            ${lead.notes.map(n => `<div style="font-size:12px;margin-bottom:8px;"><div style="color:var(--muted);font-size:10px;">${fmtDateTime(n.created_at)}</div>${escapeHtml(n.body)}</div>`).join('') || '<div class="empty-state">No notes yet.</div>'}
          </div>
        </div>
      </div>
    </div>
  `;

  // Conversation (fetched separately — live GHL call, not part of the cached lead object)
  api.conversation(id).then(r => {
    if (root.dataset.leadId !== id) return; // superseded by a later navigation
    const el = root.querySelector('#lp-convo');
    if (!r.messages?.length) { el.innerHTML = '<div class="empty-state">No messages on file.</div>'; return; }
    el.innerHTML = r.messages.map((m, i) => {
      if (m.type === 'call') {
        const mins = m.callDuration ? `${Math.floor(m.callDuration / 60)}:${String(m.callDuration % 60).padStart(2, '0')}` : null;
        return `
          <div class="msg ${m.direction === 'inbound' ? 'in' : 'out'}" style="max-width:100%;background:var(--card3);">
            <div style="font-size:10px;color:var(--muted);margin-bottom:2px;">📞 ${m.direction === 'inbound' ? 'INCOMING CALL' : 'OUTGOING CALL'}</div>
            ${m.callStatus === 'completed' ? `Connected — ${mins}` : `${escapeHtml(m.callStatus || 'unknown')}${mins ? ` — ${mins}` : ''}`}
            <div class="msg-date">${fmtDateTime(new Date(m.date).getTime())}</div>
            <button class="btn ghost" data-log-call="${i}" style="font-size:10px;margin-top:6px;">Log &amp; Coach This Call</button>
            <div id="log-call-${i}" style="display:none;margin-top:8px;">
              <textarea id="log-call-input-${i}" placeholder="What was discussed? (paste notes or a rough transcript)" style="width:100%;min-height:70px;"></textarea>
              <button class="btn primary" data-submit-call="${i}" data-duration="${m.callDuration || ''}" data-status="${escapeHtml(m.callStatus || '')}" style="margin-top:6px;font-size:11px;">Get Coaching</button>
            </div>
          </div>`;
      }
      return `
      <div class="msg ${m.direction === 'inbound' ? 'in' : 'out'}">
        <div style="font-size:10px;color:var(--muted);margin-bottom:2px;">${m.direction === 'inbound' ? 'CUSTOMER' : 'SF CITY WASH'}</div>
        ${escapeHtml(m.body)}
        <div class="msg-date">${fmtDateTime(new Date(m.date).getTime())}</div>
      </div>`;
    }).join('');

    root.querySelectorAll('[data-log-call]').forEach(btn => btn.addEventListener('click', () => {
      const box = root.querySelector(`#log-call-${btn.dataset.logCall}`);
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
    }));
    root.querySelectorAll('[data-submit-call]').forEach(btn => btn.addEventListener('click', async () => {
      const i = btn.dataset.submitCall;
      const transcript = root.querySelector(`#log-call-input-${i}`).value.trim();
      if (!transcript) return;
      btn.disabled = true; btn.textContent = 'Analyzing…';
      try {
        const res = await api.callCoaching(id, transcript, btn.dataset.duration || null, btn.dataset.status || null);
        toast('Coaching ready');
        root.querySelector(`#log-call-${i}`).innerHTML = `<div class="assist-box">${escapeHtml(res.text)}</div>`;
      } catch (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Get Coaching'; }
    }));
  }).catch(() => {
    if (root.dataset.leadId !== id) return;
    root.querySelector('#lp-convo').innerHTML = '<div class="empty-state">Could not load conversation.</div>';
  });

  // Availability (fetched separately — live call to the public Booking
  // Worker, not part of the cached lead object) — see sales-api/availability.js.
  api.availability(id).then(r => {
    if (root.dataset.leadId !== id) return; // superseded by a later navigation
    const el = root.querySelector('#lp-availability');
    if (!el) return;
    const svcLine = r.service.approximate
      ? `<div class="lead-meta" style="margin-bottom:8px;">${escapeHtml(r.service.note || 'Approximate — based on a standard appointment length.')}</div>`
      : `<div class="lead-meta" style="margin-bottom:8px;">For ${escapeHtml(r.service.name)}${r.service.price ? ` · $${r.service.price}` : ''}${r.service.durationMinutes ? ` · ~${r.service.durationMinutes} min` : ''}</div>`;
    // Every day of the window renders, always — a day that's genuinely fully
    // booked (checked: true, available: false) looks visibly different from
    // one we simply failed to verify (checked: false), so a real outage never
    // reads as an ordinary quiet week.
    const dayRow = d => {
      if (d.available) {
        return `
          <div class="avail-day">
            <div class="avail-date">${escapeHtml(fmtWeekdayDate(d.date))}</div>
            <div class="avail-times">
              ${d.times.map(t => `<span class="avail-chip">${escapeHtml(fmtTime12(t))}</span>`).join('')}
              ${d.totalOpen > d.times.length ? `<span class="avail-more">+${d.totalOpen - d.times.length} more</span>` : ''}
            </div>
          </div>`;
      }
      if (d.checked) {
        return `
          <div class="avail-day">
            <div class="avail-date">${escapeHtml(fmtWeekdayDate(d.date))}</div>
            <span class="avail-chip unavailable">Fully booked</span>
          </div>`;
      }
      return `
        <div class="avail-day">
          <div class="avail-date">${escapeHtml(fmtWeekdayDate(d.date))}</div>
          <span class="avail-chip unchecked">Couldn't check</span>
        </div>`;
    };
    el.innerHTML = `
      <div class="card-title">Availability — Next 7 Days</div>
      ${svcLine}
      <div class="avail-days">${(r.days || []).map(dayRow).join('')}</div>
      ${r.days?.some(d => !d.checked) ? `<div class="lead-meta" style="margin-top:8px;">Some days couldn't be verified live — call ${escapeHtml(r.supportPhone || '')} to confirm those.</div>` : ''}
    `;
  }).catch(() => {
    if (root.dataset.leadId !== id) return;
    const el = root.querySelector('#lp-availability');
    if (el) el.innerHTML = `<div class="card-title">Availability — Next Openings</div><div class="empty-state">Could not load live availability.</div>`;
  });

  root.querySelector('#lp-followup').addEventListener('click', () => openFollowupModal(id, () => mount(root, id)));
  root.querySelector('#lp-ask-copilot').addEventListener('click', () => {
    sessionStorage.setItem('copilotSeed', `Tell me about lead id ${id} (${lead.name}) — what's the situation and what should I do next?`);
    navigate('#/copilot');
  });

  root.querySelector('#lp-note-save').addEventListener('click', async () => {
    const body = root.querySelector('#lp-note-input').value.trim();
    if (!body) return;
    try { await api.addNote(id, body); toast('Note saved'); mount(root, id); } catch (e) { toast(e.message); }
  });

  root.querySelectorAll('[data-disposition]').forEach(btn => btn.addEventListener('click', async () => {
    try { await api.addDisposition(id, btn.dataset.disposition); toast('Logged: ' + btn.textContent); mount(root, id); } catch (e) { toast(e.message); }
  }));

  root.querySelectorAll('[data-assist]').forEach(btn => btn.addEventListener('click', async () => {
    const out = root.querySelector('#lp-assist-out');
    out.innerHTML = `<div class="assist-box">Thinking…</div>`;
    try {
      const r = await api.assist(id, btn.dataset.assist);
      out.innerHTML = `<div class="assist-box">${escapeHtml(r.text)}</div>`;
    } catch (e) { out.innerHTML = `<div class="assist-box">${escapeHtml(e.message)}</div>`; }
  }));
}
