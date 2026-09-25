/**
 * /api/sales/* — the Sales Command Center's own API surface.
 *
 * Deliberately a separate router instead of more routes bolted onto the
 * already-5,700-line server.js. It's mounted with app.use('/api/sales', ...)
 * from server.js, which already applies the existing DASHBOARD_SECRET gate to
 * everything under /api/* — this file adds no new auth of its own, it reuses
 * what's there. See server.js's apiGate() for how that works.
 *
 * This file writes NOTHING to GoHighLevel. Every write here (notes, follow-ups,
 * dispositions, settings) lands only in the local sales_* tables added to
 * db/index.js. The only outbound GHL calls are read-only (conversations/messages).
 */

const express = require('express');
const { computeQueue, DEFAULT_CONFIG } = require('./priority');
const { getLeadsPage, getLeadDetail, getLeadTimeline, getRecentMessages, getBookingsOverview, getSalesMetrics, globalSearch } = require('./queries');
const { classifyMessage } = require('./intent');
const { analyzeCall } = require('../sales-ai/call-coaching');

module.exports = function salesRoutes({ dbModule, axios, GHL_BASE, GHL_LOCATION, ghlHeaders, getAI, syncNow }) {
  const router = express.Router();

  function requireDb(req, res, next) {
    if (!dbModule) return res.status(503).json({ ok: false, error: 'Database unavailable' });
    next();
  }
  router.use(requireDb);

  const repId = () => dbModule.DEFAULT_REP_ID;

  // ── Identity ──────────────────────────────────────────────────────────────
  router.get('/rep', (_req, res) => {
    res.json({ ok: true, rep: dbModule.getRep() });
  });

  // ── Queue ─────────────────────────────────────────────────────────────────
  router.get('/queue', (_req, res) => {
    const settings = dbModule.getSalesSettings(repId());
    const result = computeQueue(dbModule, settings?.priority || {});
    res.json({ ok: true, ...result });
  });

  // Manual "refresh right now" — runs the same GHL contacts/opportunities,
  // GHL conversations and Setmore syncs the background timers run, then
  // returns a fresh queue. Exists so a rep can force-sync right before
  // making calls instead of trusting the interval to have landed already.
  router.post('/sync-now', async (_req, res) => {
    if (!syncNow) return res.status(503).json({ ok: false, error: 'Sync not wired up' });
    try {
      const result = await syncNow();
      const settings = dbModule.getSalesSettings(repId());
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
        contact_id: req.params.id, rep_id: repId(), source: req.body?.source || 'manual',
        call_duration: req.body?.callDuration ?? null, call_status: req.body?.callStatus || null,
        transcript, analysis: JSON.stringify({ text: result.text }), model: 'claude-sonnet-4-6', created_at: Date.now(),
      });
      res.json({ ok: true, coaching: row, text: result.text, usage: result.usage });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/leads/:id/call-coaching', (req, res) => {
    res.json({ ok: true, coaching: dbModule.getCallCoachingForContact(req.params.id) });
  });

  // ── Notes ─────────────────────────────────────────────────────────────────
  router.post('/leads/:id/notes', (req, res) => {
    const body = (req.body?.body || '').trim();
    if (!body) return res.status(400).json({ ok: false, error: 'note body required' });
    const note = dbModule.addNote({ contact_id: req.params.id, rep_id: repId(), body, created_at: Date.now() });
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
      contact_id: req.params.id, rep_id: repId(),
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
    const row = dbModule.addDisposition({
      contact_id: req.params.id, rep_id: repId(), disposition, note: note || null, created_at: Date.now(),
    });
    res.json({ ok: true, disposition: row });
  });
  router.get('/leads/:id/dispositions', (req, res) => {
    res.json({ ok: true, dispositions: dbModule.getDispositionsForContact(req.params.id) });
  });

  // ── Snooze / manual priority override ────────────────────────────────────
  router.post('/leads/:id/snooze', (req, res) => {
    const { untilMs } = req.body || {};
    const state = dbModule.setLeadState({ contact_id: req.params.id, rep_id: repId(), snoozed_until: Number(untilMs) || null });
    res.json({ ok: true, state });
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
  router.get('/settings', (_req, res) => {
    const config = dbModule.getSalesSettings(repId()) || { priority: DEFAULT_CONFIG, ui: {} };
    res.json({ ok: true, settings: config, defaults: { priority: DEFAULT_CONFIG } });
  });
  router.post('/settings', (req, res) => {
    const current = dbModule.getSalesSettings(repId()) || {};
    const next = { ...current, ...req.body };
    dbModule.saveSalesSettings(repId(), next);
    res.json({ ok: true, settings: next });
  });

  // ── Saved views ───────────────────────────────────────────────────────────
  router.get('/views', (_req, res) => res.json({ ok: true, views: dbModule.getSavedViews(repId()) }));
  router.post('/views', (req, res) => {
    const { id, name, config } = req.body || {};
    if (!name || !config) return res.status(400).json({ ok: false, error: 'name and config required' });
    const views = dbModule.saveSavedView({
      id: id || `view_${Date.now()}`, rep_id: repId(), name, config: JSON.stringify(config), created_at: Date.now(),
    });
    res.json({ ok: true, views });
  });
  router.delete('/views/:id', (req, res) => { dbModule.deleteSavedView(req.params.id); res.json({ ok: true }); });

  // ── Stats — only metrics whose underlying data is trustworthy today ─────
  // Shared with the AI Copilot's get_sales_metrics tool (queries.js
  // getSalesMetrics) so the assistant can never report a number that
  // disagrees with what this page shows.
  router.get('/stats', (_req, res) => {
    res.json({ ok: true, ...getSalesMetrics(dbModule, dbModule.getSalesSettings(repId())?.priority || {}) });
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
