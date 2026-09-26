/**
 * /api/sales/* — the Sales Command Center's own API surface.
 *
 * Deliberately a separate router instead of more routes bolted onto the
 * already-5,700-line server.js. It's mounted with app.use('/api/sales', ...)
 * from server.js, which already applies the existing DASHBOARD_SECRET gate to
 * everything under /api/* — this file adds no new auth of its own, it reuses
 * what's there. See server.js's apiGate() for how that works.
 *
 * The ONLY write this file makes to GoHighLevel is POST /leads/:id/send-message
 * (2026-09-26) — everything else here (notes, follow-ups, dispositions,
 * settings, handled-by, trash) lands only in the local sales_* tables added
 * to db/index.js. Every other outbound GHL call is read-only.
 */

const express = require('express');
const { computeQueue, DEFAULT_CONFIG, HOT_SIGNALS } = require('./priority');
const { getLeadsPage, getLeadDetail, getLeadTimeline, getRecentMessages, getBookingsOverview, getSalesMetrics, getRepAnalytics, globalSearch, getTrashedLeads } = require('./queries');
const { classifyMessage } = require('./intent');
const { analyzeCall } = require('../sales-ai/call-coaching');
const { resolveServiceKey, getRecommendedSlots } = require('./availability');
const { createBooking, SERVICE_LABELS, VEHICLE_LABELS } = require('./booking');

module.exports = function salesRoutes({ dbModule, axios, GHL_BASE, GHL_LOCATION, ghlHeaders, getAI, syncNow, readData }) {
  const router = express.Router();

  function requireDb(req, res, next) {
    if (!dbModule) return res.status(503).json({ ok: false, error: 'Database unavailable' });
    next();
  }
  router.use(requireDb);

  // "Who's using this browser" — a no-password picker (sales/js/main.js),
  // sent as x-sales-rep on every request (sales/js/api.js). Not real auth;
  // falls back to the single shared default rep if missing/unrecognized.
  const HANDLED_BY_NAMES = ['Kieran', 'Roman', 'Sebas']; // keep in sync with sales/js/util.js
  const repId = (req) => {
    const header = (req?.headers?.['x-sales-rep'] || '').toLowerCase();
    return HANDLED_BY_NAMES.map(n => n.toLowerCase()).includes(header) ? header : dbModule.DEFAULT_REP_ID;
  };

  // ── Identity ──────────────────────────────────────────────────────────────
  router.get('/rep', (req, res) => {
    res.json({ ok: true, rep: dbModule.getRep(repId(req)) });
  });

  // ── Queue ─────────────────────────────────────────────────────────────────
  router.get('/queue', (req, res) => {
    const settings = dbModule.getSalesSettings(repId(req));
    const result = computeQueue(dbModule, settings?.priority || {});
    res.json({ ok: true, ...result });
  });

  // Manual "refresh right now" — runs the same GHL contacts/opportunities,
  // GHL conversations and Setmore syncs the background timers run, then
  // returns a fresh queue. Exists so a rep can force-sync right before
  // making calls instead of trusting the interval to have landed already.
  router.post('/sync-now', async (req, res) => {
    if (!syncNow) return res.status(503).json({ ok: false, error: 'Sync not wired up' });
    try {
      const result = await syncNow();
      const settings = dbModule.getSalesSettings(repId(req));
      const queue = computeQueue(dbModule, settings?.priority || {});
      res.json({ ok: true, syncedAt: Date.now(), ...result, ...queue });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Leads list + detail ───────────────────────────────────────────────────
  router.get('/leads', (req, res) => {
    const q = req.query;
    const result = getLeadsPage(dbModule, {
      search: q.search || '', source: q.source || '', pipeline: q.pipeline || '',
      stage: q.stage || '', service: q.service || '', tag: q.tag || '',
      needsReply: q.needsReply === '1' || q.needsReply === 'true',
      followupDue: q.followupDue === '1' || q.followupDue === 'true',
      page: Math.max(1, parseInt(q.page) || 1),
      pageSize: Math.min(200, Math.max(1, parseInt(q.pageSize) || 50)),
      sort: q.sort || 'created', dir: q.dir || 'desc',
    });
    res.json({ ok: true, ...result });
  });

  router.get('/leads/:id', (req, res) => {
    const lead = getLeadDetail(dbModule, req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    res.json({ ok: true, lead });
  });

  router.get('/leads/:id/timeline', (req, res) => {
    res.json({ ok: true, timeline: getLeadTimeline(dbModule, req.params.id) });
  });

  // Reuses the same GHL Conversations v2 calls the existing Outreach page uses
  // (server.js /api/ghl/messages/:contactId) — read-only, no message is sent here.
  router.get('/leads/:id/conversations', async (req, res) => {
    if (!process.env.GHL_API_KEY) return res.status(503).json({ ok: false, error: 'GHL_API_KEY not set' });
    try {
      const contactId = req.params.id;
      const searchRes = await axios.get(`${GHL_BASE}/conversations/search`, {
        headers: ghlHeaders(), params: { locationId: GHL_LOCATION, contactId, limit: 1 },
      });
      const convs = searchRes.data.conversations || [];
      if (!convs.length) return res.json({ ok: true, messages: [], contactId });
      const convId = convs[0].id;
      const msgRes = await axios.get(`${GHL_BASE}/conversations/${convId}/messages`, {
        headers: ghlHeaders(), params: { limit: 100 },
      });
      const raw = msgRes.data.messages?.messages || [];
      // TYPE_CALL entries have no body — just meta.call.{duration,status}
      // (verified live 2026-09-25: no recording/transcript is ever present).
      // Surfaced as their own entry type so the UI can show real call
      // history distinctly from text messages, and so a rep can attach
      // post-call coaching notes to the actual call.
      const messages = raw.map(m => {
        if (m.messageType === 'TYPE_CALL') {
          return { id: m.id, type: 'call', direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
            callDuration: m.meta?.call?.duration ?? null, callStatus: m.meta?.call?.status || 'unknown',
            date: m.dateAdded || m.createdAt || '' };
        }
        return { id: m.id, type: 'message', body: m.body || m.text || '',
          direction: m.direction === 1 || m.direction === 'inbound' ? 'inbound' : 'outbound',
          date: m.dateAdded || m.createdAt || '' };
      }).reverse();
      res.json({ ok: true, conversationId: convId, messages, contactId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.response?.data?.message || e.message });
    }
  });

  // ── Send a text reply — the ONE write this app makes to GHL (everything
  // else here is read-only, see the file header). Uses the exact call+params
  // proven live in production by sfcw-booking-worker/src/index.js:652
  // (sendGHLSMS) — including its Version header, 2021-04-15, NOT the
  // dashboard's usual ghlHeaders() (2021-07-28). Per
  // .claude/skills/integrating-sfcw-apis: never unify GHL API versions on a
  // guess — this one is the version actually verified to work for sending.
  router.post('/leads/:id/send-message', async (req, res) => {
    if (!process.env.GHL_API_KEY) return res.status(503).json({ ok: false, error: 'GHL_API_KEY not set' });
    const message = (req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'message required' });
    const contactId = req.params.id;
    try {
      await axios.post(`${GHL_BASE}/conversations/messages`,
        { type: 'SMS', contactId, locationId: GHL_LOCATION, message },
        { headers: { Authorization: `Bearer ${process.env.GHL_API_KEY}`, 'Content-Type': 'application/json', Version: '2021-04-15' } });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.response?.data?.message || e.message });
    }
    // Optimistic local update so the Conversations/Lead Profile view reflects
    // the send immediately, without waiting for the next GHL sync cycle —
    // the next sync (see server.js syncGHLConversations) still overwrites
    // this with GHL's own record, same as everywhere else in this app.
    try {
      const now = Date.now();
      const existing = dbModule.db.prepare(`SELECT id FROM conversations WHERE contact_id = ? ORDER BY last_msg_at DESC LIMIT 1`).get(contactId);
      if (existing) {
        dbModule.db.prepare(`UPDATE conversations SET last_message=?, last_msg_at=?, last_message_direction='outbound', unread=0 WHERE id=?`)
          .run(message.slice(0, 500), now, existing.id);
      } else {
        dbModule.db.prepare(`
          INSERT INTO conversations (id, ghl_id, contact_id, platform, last_message, last_msg_at, last_message_direction, unread, synced_at)
          VALUES (@id, @id, @contact_id, 'sms', @last_message, @now, 'outbound', 0, @now)
        `).run({ id: `local_${contactId}_${now}`, contact_id: contactId, last_message: message.slice(0, 500), now });
      }
    } catch (e) { /* the send itself already succeeded — a cache-update miss isn't worth failing the request over */ }
    res.json({ ok: true, sentAt: Date.now() });
  });

  // ── Availability — "can I offer them a slot right now" without leaving
  // the lead's page. Reads live from the public Booking Worker (see
  // sales-api/availability.js) — never invents a time; a day with no
  // response or no openings is simply omitted, not padded with a guess.
  router.get('/leads/:id/availability', async (req, res) => {
    const lead = getLeadDetail(dbModule, req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    try {
      const service = resolveServiceKey(readData, lead.service);
      const { days, supportPhone } = await getRecommendedSlots({ axios, serviceKey: service.key });
      res.json({ ok: true, service, days, supportPhone });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Book — v1, base packages only (no add-ons/ceramic; see sales-api/booking.js
  // header). Creates a REAL Setmore appointment via the same public Worker the
  // main dashboard's Instant Booking widget uses. staffOverride is passed
  // through verbatim from the browser's own localStorage (sfcw_staff_override,
  // same key the main dashboard reads — same origin, shared storage) — this
  // route never needs to know the secret itself.
  router.post('/leads/:id/book', async (req, res) => {
    const lead = getLeadDetail(dbModule, req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const { serviceType, vehicleClass, date, time, address, total, note, staffOverride } = req.body || {};
    if (!SERVICE_LABELS[serviceType]) return res.status(400).json({ ok: false, error: `serviceType must be one of ${Object.keys(SERVICE_LABELS).join(', ')}` });
    if (!VEHICLE_LABELS[vehicleClass]) return res.status(400).json({ ok: false, error: `vehicleClass must be one of ${Object.keys(VEHICLE_LABELS).join(', ')}` });
    if (!date || !time) return res.status(400).json({ ok: false, error: 'date and time required' });
    if (!lead.firstName || !lead.phone) return res.status(400).json({ ok: false, error: 'This lead is missing a first name or phone number — Setmore requires both to book.' });

    const result = await createBooking({
      axios, serviceType, vehicleClass, date, time, address, note, total: total || null, staffOverride,
      firstName: lead.firstName, lastName: lead.lastName || '', email: lead.email || '', phone: lead.phone,
    });
    if (!result.ok) return res.status(502).json(result);

    // Confirmed with the owner (2026-09-26): a successful booking auto-logs a
    // "Booked" disposition so it's reflected in the queue/Analytics without an
    // extra click.
    const disposition = dbModule.addDisposition({
      contact_id: req.params.id, rep_id: repId(req), disposition: 'booked',
      note: `Booked via Sales Command Center — ${SERVICE_LABELS[serviceType]} (${VEHICLE_LABELS[vehicleClass]}), ${date} ${time}`,
      lead_temperature: null, created_at: Date.now(),
    });
    res.json({ ok: true, booking: result.data, disposition });
  });

  // ── Call coaching ─────────────────────────────────────────────────────────
  // See db/index.js call_coaching table + sales-ai/call-coaching.js for why
  // this takes a plain transcript string: GHL exposes call duration/status
  // but no recording, so today the rep provides the transcript themselves.
  router.post('/leads/:id/call-coaching', async (req, res) => {
    const ai = getAI();
    if (!ai) return res.status(503).json({ ok: false, error: 'ANTHROPIC_API_KEY not set' });
    const transcript = (req.body?.transcript || '').trim();
    if (!transcript) return res.status(400).json({ ok: false, error: 'transcript required' });
    const lead = getLeadDetail(dbModule, req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
    try {
      const result = await analyzeCall({ ai, transcript, lead });
      if (result.error) return res.status(503).json({ ok: false, error: result.error });
      const row = dbModule.addCallCoaching({
        contact_id: req.params.id, rep_id: repId(req), source: req.body?.source || 'manual',
        call_duration: req.body?.callDuration ?? null, call_status: req.body?.callStatus || null,
        transcript, analysis: JSON.stringify({ text: result.text, extracted: result.extracted }), model: 'claude-sonnet-4-6', created_at: Date.now(),
      });
      res.json({ ok: true, coaching: row, text: result.text, extracted: result.extracted, usage: result.usage });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/leads/:id/call-coaching', (req, res) => {
    res.json({ ok: true, coaching: dbModule.getCallCoachingForContact(req.params.id) });
  });

  // Rep reviews/edits the AI-extracted fields before treating them as
  // confirmed — see sales/js/views/lead-profile.js's "Confirm" step.
  router.post('/call-coaching/:coachingId/confirm', (req, res) => {
    const { text, extracted } = req.body || {};
    if (!extracted) return res.status(400).json({ ok: false, error: 'extracted required' });
    const row = dbModule.updateCallCoachingAnalysis(req.params.coachingId, { text: text || '', extracted, confirmed: true });
    if (!row) return res.status(404).json({ ok: false, error: 'Coaching record not found' });
    res.json({ ok: true, coaching: row });
  });

  // ── Notes ─────────────────────────────────────────────────────────────────
  router.post('/leads/:id/notes', (req, res) => {
    const body = (req.body?.body || '').trim();
    if (!body) return res.status(400).json({ ok: false, error: 'note body required' });
    const note = dbModule.addNote({ contact_id: req.params.id, rep_id: repId(req), body, created_at: Date.now() });
    res.json({ ok: true, note });
  });
  router.get('/leads/:id/notes', (req, res) => {
    res.json({ ok: true, notes: dbModule.getNotesForContact(req.params.id) });
  });

  // ── Follow-ups ────────────────────────────────────────────────────────────
  router.post('/leads/:id/followups', (req, res) => {
    const { dueAt, reason, note } = req.body || {};
    if (!dueAt) return res.status(400).json({ ok: false, error: 'dueAt (unix ms) required' });
    const followup = dbModule.addFollowup({
      contact_id: req.params.id, rep_id: repId(req),
      due_at: Number(dueAt), reason: reason || null, note: note || null, created_at: Date.now(),
    });
    res.json({ ok: true, followup });
  });
  router.get('/followups', (req, res) => {
    const status = req.query.status || 'open';
    const now = Date.now();
    let rows = status === 'open' ? dbModule.getOpenFollowups()
      : dbModule.db.prepare(`SELECT * FROM sales_followups WHERE status=? ORDER BY due_at DESC`).all(status);
    rows = rows.map(f => ({ ...f, bucket: f.status !== 'open' ? f.status : (f.due_at <= now ? 'overdue' : 'upcoming') }));
    res.json({ ok: true, followups: rows });
  });
  router.post('/followups/:id/complete', (req, res) => {
    dbModule.completeFollowup(req.params.id);
    res.json({ ok: true });
  });
  router.post('/followups/:id/cancel', (req, res) => {
    dbModule.cancelFollowup(req.params.id);
    res.json({ ok: true });
  });

  // ── Dispositions ──────────────────────────────────────────────────────────
  router.post('/leads/:id/dispositions', (req, res) => {
    const { disposition, note } = req.body || {};
    if (!disposition) return res.status(400).json({ ok: false, error: 'disposition required' });
    // Captured at log time, same HOT_SIGNALS rule the queue's HOT/WARM badge
    // uses — see db/index.js's ensureColumn comment for why this can't be
    // re-derived reliably later (a lead's live message-based classification
    // isn't stable history, it's a snapshot of whatever the last message was).
    const lead = getLeadDetail(dbModule, req.params.id);
    const intent = lead?.messageIntent;
    const lead_temperature = intent ? (intent.signals?.some(s => HOT_SIGNALS.has(s)) ? 'hot' : 'warm') : null;
    const row = dbModule.addDisposition({
      contact_id: req.params.id, rep_id: repId(req), disposition, note: note || null, lead_temperature, created_at: Date.now(),
    });
    res.json({ ok: true, disposition: row });
  });
  router.get('/leads/:id/dispositions', (req, res) => {
    res.json({ ok: true, dispositions: dbModule.getDispositionsForContact(req.params.id) });
  });

  // ── Snooze / manual priority override ────────────────────────────────────
  router.post('/leads/:id/snooze', (req, res) => {
    const { untilMs } = req.body || {};
    const state = dbModule.setLeadState({ contact_id: req.params.id, snoozed_until: Number(untilMs) || null });
    res.json({ ok: true, state });
  });

  // ── Handled By — a shared, visible-to-everyone marker (not per-viewer
  // ownership), since the whole team works the same queue. Same fixed set of
  // names as the x-sales-rep login picker above, but a different concept:
  // "who is this lead assigned to" vs "who is using this browser right now."
  // Passing handledBy: null clears it.
  router.post('/leads/:id/handled-by', (req, res) => {
    const { handledBy } = req.body || {};
    if (handledBy !== null && !HANDLED_BY_NAMES.includes(handledBy)) {
      return res.status(400).json({ ok: false, error: `handledBy must be one of ${HANDLED_BY_NAMES.join(', ')}, or null` });
    }
    const state = dbModule.setLeadState({ contact_id: req.params.id, handled_by: handledBy });
    res.json({ ok: true, state });
  });

  // ── Trash — one-way archive. Once set, priority.js excludes the contact
  // from every queue bucket entirely; there is no restore endpoint by design
  // (see conversation 2026-09-25 — this was an explicit choice, not an
  // oversight, if a restore path is ever wanted it's a new decision).
  router.post('/leads/:id/trash', (req, res) => {
    const state = dbModule.setLeadState({ contact_id: req.params.id, trashed_at: Date.now() });
    res.json({ ok: true, state });
  });
  router.get('/trash', (_req, res) => {
    res.json({ ok: true, leads: getTrashedLeads(dbModule) });
  });

  // ── Bookings — Setmore is the system that actually creates jobs; see
  // sales-api/booking-source.js for the Setmore-vs-GHL-Calendar note.
  router.get('/bookings', (_req, res) => {
    res.json({ ok: true, ...getBookingsOverview(dbModule) });
  });

  // ── Messages / call log — everything recent, not just what's actionable ──
  router.get('/messages', (req, res) => {
    res.json({ ok: true, messages: getRecentMessages(dbModule, { limit: Math.min(200, parseInt(req.query.limit) || 100), platform: req.query.platform || '' }) });
  });

  // ── Search ────────────────────────────────────────────────────────────────
  router.get('/search', (req, res) => {
    res.json({ ok: true, results: globalSearch(dbModule, req.query.q || '', Math.min(50, parseInt(req.query.limit) || 20)) });
  });

  // ── Settings (customization) ─────────────────────────────────────────────
  router.get('/settings', (req, res) => {
    const config = dbModule.getSalesSettings(repId(req)) || { priority: DEFAULT_CONFIG, ui: {} };
    res.json({ ok: true, settings: config, defaults: { priority: DEFAULT_CONFIG } });
  });
  router.post('/settings', (req, res) => {
    const current = dbModule.getSalesSettings(repId(req)) || {};
    const next = { ...current, ...req.body };
    dbModule.saveSalesSettings(repId(req), next);
    res.json({ ok: true, settings: next });
  });

  // ── Saved views ───────────────────────────────────────────────────────────
  router.get('/views', (req, res) => res.json({ ok: true, views: dbModule.getSavedViews(repId(req)) }));
  router.post('/views', (req, res) => {
    const { id, name, config } = req.body || {};
    if (!name || !config) return res.status(400).json({ ok: false, error: 'name and config required' });
    const views = dbModule.saveSavedView({
      id: id || `view_${Date.now()}`, rep_id: repId(req), name, config: JSON.stringify(config), created_at: Date.now(),
    });
    res.json({ ok: true, views });
  });
  router.delete('/views/:id', (req, res) => { dbModule.deleteSavedView(req.params.id); res.json({ ok: true }); });

  // ── Stats — only metrics whose underlying data is trustworthy today ─────
  // Shared with the AI Copilot's get_sales_metrics tool (queries.js
  // getSalesMetrics) so the assistant can never report a number that
  // disagrees with what this page shows.
  router.get('/stats', (req, res) => {
    res.json({ ok: true, ...getSalesMetrics(dbModule, dbModule.getSalesSettings(repId(req))?.priority || {}) });
  });

  // Per-person revenue/close-rate breakdown — see queries.js getRepAnalytics
  // for the two distinct attribution signals it reports and why they're kept
  // separate.
  router.get('/analytics/reps', (_req, res) => {
    res.json({ ok: true, ...getRepAnalytics(dbModule) });
  });

  // ── Sales Assistant (Claude) ─────────────────────────────────────────────
  // Structured context only — the model is explicitly told never to invent
  // pricing, availability, or customer statements, and this endpoint never
  // sends anything anywhere; it only returns text for the rep to review.
  router.post('/leads/:id/assist', async (req, res) => {
    const ai = getAI();
    if (!ai) return res.status(503).json({ ok: false, error: 'ANTHROPIC_API_KEY not set' });
    const action = req.body?.action;
    const ACTIONS = {
      qualify: `Assess this lead's sales quality using EXACTLY this structure (plain text, these exact labels, one per line):
Lead quality: [High intent | Medium intent | Low intent | Not a lead]
Why: [one sentence citing the specific evidence]
Service: [service requested, or "Unknown" if not stated]
Vehicle: [vehicle, or "Unknown"]
Objection: [the objection if one exists, otherwise "None identified"]
Booking detected: [Yes | No]
Recommended action: [the single next action]
Goal: [what that action should achieve]
Confidence: [High | Medium | Low]
A "ruleBasedIntent" field is provided below from a separate deterministic classifier — treat it as a strong prior, but you may disagree if the fuller conversation clearly supports a different read; if you disagree, say why in "Why".`,
      summarize: 'Summarize this lead in 2-3 sentences for a salesperson who has not looked at it yet.',
      prepare_call: `Prepare call notes using EXACTLY this structure:
CALL OBJECTIVE: [one sentence — what this call needs to accomplish]
Questions:
- [question 1]
- [question 2]
- [question 3]
Base every question only on what's actually unknown from the data below — do not invent vehicle details, pricing, or availability that isn't there.`,
      next_action: 'State the single next best action to take with this lead and why, in one or two sentences.',
      draft_followup: 'Draft a short, friendly follow-up text message to this customer based on where the conversation left off.',
      draft_booking_response: 'Draft a short text message confirming next steps to book an appointment, referencing only information given below.',
      objections: 'List any objections or hesitations the customer has expressed, based only on the conversation provided.',
      unanswered_questions: 'List any customer questions in the conversation that do not appear to have been answered yet.',
    };
    if (!ACTIONS[action]) return res.status(400).json({ ok: false, error: `Unknown action. Valid: ${Object.keys(ACTIONS).join(', ')}` });

    const lead = getLeadDetail(dbModule, req.params.id);
    if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });

    let conversation = [];
    try {
      const searchRes = await axios.get(`${GHL_BASE}/conversations/search`, {
        headers: ghlHeaders(), params: { locationId: GHL_LOCATION, contactId: req.params.id, limit: 1 },
      });
      const convs = searchRes.data.conversations || [];
      if (convs.length) {
        const msgRes = await axios.get(`${GHL_BASE}/conversations/${convs[0].id}/messages`, { headers: ghlHeaders(), params: { limit: 30 } });
        conversation = (msgRes.data.messages?.messages || []).map(m => ({
          direction: m.direction === 1 || m.direction === 'inbound' ? 'customer' : 'sf_city_wash',
          body: m.body || m.text || '', date: m.dateAdded || m.createdAt || '',
        })).reverse();
      }
    } catch { /* conversation is best-effort context, not required */ }

    const context = {
      name: lead.name, phone: lead.phone, vehicle: [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ') || lead.vehicle,
      serviceRequested: lead.service, source: lead.source, stage: lead.stage, pipeline: lead.pipeline,
      quotedPrice: lead.quotedPrice, tags: lead.tags, notesFromCustomer: lead.ghlNotes,
      salesNotes: lead.notes.map(n => n.body), lastDisposition: lead.lastDisposition,
      openFollowup: lead.openFollowup, bookingStatus: lead.booking,
      // Same deterministic rules the Queue uses — keeps the AI's read consistent
      // with what the rep already saw on the card instead of contradicting it.
      ruleBasedIntent: lead.lastMessage ? classifyMessage(lead.lastMessage) : null,
      conversation,
    };

    try {
      const msg = await ai.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: 'You are a sales assistant for a mobile car detailing company. You will be given structured CRM '
          + 'data about one lead as JSON. Use ONLY the information provided. Never invent pricing, availability, '
          + 'services, or customer statements that are not present in the data. If something needed to answer is '
          + 'missing, say so explicitly instead of guessing. You are drafting text for a human salesperson to '
          + 'review and send themselves — never imply the message has already been sent.',
        messages: [{ role: 'user', content: `${ACTIONS[action]}\n\nCRM data:\n${JSON.stringify(context, null, 2)}` }],
      });
      const text = msg.content?.[0]?.text || '';
      res.json({ ok: true, action, text, usage: msg.usage });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
};
