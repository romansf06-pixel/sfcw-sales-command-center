import { api } from '../api.js';
import { escapeHtml, fmtAgo, fmtDateTime, fmtDate, DISPOSITIONS, toast } from '../util.js';
import { openFollowupModal } from '../components/modal.js';
import { navigate } from '../main.js';
import { renderPricingCard, buildCallScript, buildUpsellNotes, BASE_PACKAGES } from '../pricing.js';

// Same origin as the main dashboard (both served by this same server.js), so
// this localStorage key is already shared — if the staff key was pasted in
// once from the main dashboard's "Instant Booking" widget, it just works
// here too. See index.html's BK_STAFF_KEY_STORE / bkSetStaffKey.
const STAFF_KEY_STORE = 'sfcw_staff_override';

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

const CALL_FIELDS = [
  ['service', 'Service discussed'], ['price', 'Price mentioned'], ['date', 'Date/time mentioned'],
  ['vehicle', 'Vehicle'], ['objection', 'Objection'], ['nextStep', 'Next step'],
];

// AI-extracted fields from a pasted call transcript, shown as an editable
// form so the rep confirms or corrects before it's treated as real —
// deliberately not auto-saved as-is. See sales-ai/call-coaching.js.
function renderCallFieldsForm(coachingId, extracted) {
  return `
    <div class="call-fields" data-coaching-id="${coachingId}">
      ${CALL_FIELDS.map(([key, label]) => `
        <div class="call-field-row">
          <span class="k">${escapeHtml(label)}</span>
          <input type="text" data-field="${key}" value="${escapeHtml(extracted?.[key] ?? '')}" placeholder="Not mentioned">
        </div>`).join('')}
      <button class="btn primary" data-action="confirm-call-fields" style="margin-top:8px;font-size:11px;">Confirm</button>
      <span class="call-fields-saved" style="display:none;">✓ Saved</span>
    </div>`;
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
          ${lead.phone ? `
            <div class="reply-box">
              <textarea id="lp-reply-input" placeholder="Text ${escapeHtml(lead.firstName || lead.name)}…"></textarea>
              <button class="btn primary" id="lp-reply-send">Send</button>
            </div>` : '<div class="lead-meta" style="margin-top:8px;">No phone number on file — can\'t text this lead.</div>'}
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
          <div class="card-title">Book Appointment</div>
          <div class="lead-meta" style="margin-bottom:8px;">Base packages only — note any add-ons below, they won't be added to the appointment automatically yet. Click a time above to fill in the date/time, or enter your own.</div>
          <div class="book-form">
            <select id="bk-service">
              <option value="interior">Interior — from $${BASE_PACKAGES[0].sedan}</option>
              <option value="full">Full Package — from $${BASE_PACKAGES[1].sedan}</option>
              <option value="exterior">Exterior — from $${BASE_PACKAGES[2].sedan}</option>
            </select>
            <select id="bk-vehicle">
              <option value="sedan">Sedan / Coupe</option>
              <option value="midsize">Midsize SUV / Crossover</option>
              <option value="large">Large SUV / Truck / Minivan</option>
            </select>
            <input type="date" id="bk-date">
            <input type="time" id="bk-time">
            <input type="text" id="bk-address" placeholder="Job address">
            <input type="number" id="bk-price" placeholder="Price" min="0" step="5">
            <textarea id="bk-note" placeholder="Note (add-ons, anything Setmore should know)"></textarea>
          </div>
          <div id="bk-staff-key-status" class="lead-meta" style="margin:8px 0;"></div>
          <button class="btn primary" id="bk-book-btn" style="width:100%;">Book Appointment</button>
          <div id="bk-book-result"></div>
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
        toast('Coaching ready — review the extracted fields below');
        const box = root.querySelector(`#log-call-${i}`);
        box.innerHTML = `
          <div class="assist-box">${escapeHtml(res.text)}</div>
          <div class="lead-meta" style="margin-top:8px;margin-bottom:4px;">Pulled from the transcript — check these before they're treated as confirmed:</div>
          ${renderCallFieldsForm(res.coaching.id, res.extracted)}`;
        box.querySelector('[data-action="confirm-call-fields"]').addEventListener('click', async (e) => {
          const wrap = e.target.closest('.call-fields');
          const edited = {};
          wrap.querySelectorAll('[data-field]').forEach(inp => { edited[inp.dataset.field] = inp.value.trim() || null; });
          e.target.disabled = true;
          try {
            await api.confirmCallCoaching(wrap.dataset.coachingId, res.text, edited);
            wrap.querySelector('.call-fields-saved').style.display = 'inline';
            toast('Call details saved');
          } catch (err) { toast(err.message); e.target.disabled = false; }
        });
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
              ${d.times.map(t => `<button type="button" class="avail-chip" data-action="pick-slot" data-date="${d.date}" data-time="${t}">${escapeHtml(fmtTime12(t))}</button>`).join('')}
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
    el.querySelectorAll('[data-action="pick-slot"]').forEach(chip => chip.addEventListener('click', () => {
      const dateInput = root.querySelector('#bk-date'), timeInput = root.querySelector('#bk-time');
      if (dateInput) dateInput.value = chip.dataset.date;
      if (timeInput) timeInput.value = chip.dataset.time;
      toast(`Filled in ${fmtWeekdayDate(chip.dataset.date)} at ${fmtTime12(chip.dataset.time)}`);
    }));
  }).catch(() => {
    if (root.dataset.leadId !== id) return;
    const el = root.querySelector('#lp-availability');
    if (el) el.innerHTML = `<div class="card-title">Availability — Next Openings</div><div class="empty-state">Could not load live availability.</div>`;
  });

  root.querySelector('#lp-reply-send')?.addEventListener('click', async () => {
    const input = root.querySelector('#lp-reply-input');
    const message = input.value.trim();
    if (!message) return;
    const btn = root.querySelector('#lp-reply-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await api.sendMessage(id, message);
      input.value = '';
      toast('Sent');
      const convoEl = root.querySelector('#lp-convo');
      if (convoEl) convoEl.innerHTML += `
        <div class="msg out">
          <div style="font-size:10px;color:var(--muted);margin-bottom:2px;">SF CITY WASH</div>
          ${escapeHtml(message)}
          <div class="msg-date">Just now</div>
        </div>`;
    } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Send'; }
  });

  root.querySelector('#lp-followup').addEventListener('click', () => openFollowupModal(id, () => mount(root, id)));
  root.querySelector('#lp-ask-copilot').addEventListener('click', () => {
    sessionStorage.setItem('copilotSeed', `Tell me about lead id ${id} (${lead.name}) — what's the situation and what should I do next?`);
    navigate('#/copilot');
  });

  // ── Book Appointment ────────────────────────────────────────────────────
  const bkServiceEl = root.querySelector('#bk-service'), bkVehicleEl = root.querySelector('#bk-vehicle'), bkPriceEl = root.querySelector('#bk-price');
  const bkPackages = { interior: BASE_PACKAGES[0], full: BASE_PACKAGES[1], exterior: BASE_PACKAGES[2] };
  function bkUpdatePrice() {
    const pkg = bkPackages[bkServiceEl.value];
    if (pkg) bkPriceEl.value = pkg[bkVehicleEl.value] ?? '';
  }
  bkServiceEl.addEventListener('change', bkUpdatePrice);
  bkVehicleEl.addEventListener('change', bkUpdatePrice);
  bkUpdatePrice();

  function bkStaffKey() { try { return localStorage.getItem(STAFF_KEY_STORE) || ''; } catch { return ''; } }
  function renderStaffKeyStatus() {
    const el = root.querySelector('#bk-staff-key-status');
    if (!el) return;
    const key = bkStaffKey();
    el.innerHTML = key
      ? `Staff key set for this browser — <span data-action="clear-staff-key" style="color:var(--accent-l);cursor:pointer;">clear</span>`
      : `No staff key set — bookings will follow customer-facing scheduling rules (lead time, buffers). <span data-action="set-staff-key" style="color:var(--accent-l);cursor:pointer;">Set staff key</span>`;
    el.querySelector('[data-action="set-staff-key"]')?.addEventListener('click', () => {
      const val = (prompt('Paste the STAFF_OVERRIDE_KEY from the Worker (same one used in the main dashboard):') || '').trim();
      if (val) { try { localStorage.setItem(STAFF_KEY_STORE, val); } catch {} renderStaffKeyStatus(); }
    });
    el.querySelector('[data-action="clear-staff-key"]')?.addEventListener('click', () => {
      try { localStorage.removeItem(STAFF_KEY_STORE); } catch {} renderStaffKeyStatus();
    });
  }
  renderStaffKeyStatus();

  root.querySelector('#bk-book-btn').addEventListener('click', async () => {
    const payload = {
      serviceType: bkServiceEl.value, vehicleClass: bkVehicleEl.value,
      date: root.querySelector('#bk-date').value, time: root.querySelector('#bk-time').value,
      address: root.querySelector('#bk-address').value.trim(),
      total: parseFloat(bkPriceEl.value) || null,
      note: root.querySelector('#bk-note').value.trim(),
      staffOverride: bkStaffKey(),
    };
    if (!payload.date || !payload.time) { toast('Pick a date and time first — click an available slot above or enter your own'); return; }
    const btn = root.querySelector('#bk-book-btn');
    btn.disabled = true; btn.textContent = 'Booking…';
    root.querySelector('#bk-book-result').innerHTML = '';
    try {
      await api.bookAppointment(id, payload);
      toast('Appointment booked — "Booked" disposition logged');
      mount(root, id);
    } catch (e) {
      root.querySelector('#bk-book-result').innerHTML = `<div class="empty-state" style="color:var(--red);">${escapeHtml(e.message)}</div>`;
      btn.disabled = false; btn.textContent = 'Book Appointment';
    }
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
