/**
 * The AI Copilot's tool layer.
 *
 * EVERY tool here is read-only. There is no tool that writes to the CRM, GHL,
 * or sends anything to a customer — that's deliberate, not an oversight (see
 * `propose_action` below). This means the tool-calling loop in client.js
 * never needs a "should I actually run this" gate: everything it can call is
 * already safe to run automatically.
 *
 * Each tool is a thin wrapper around functions sales-api/routes.js already
 * uses — the copilot reads the exact same data the rest of the app shows,
 * never a separate or stale context dump.
 */

const { getLeadsPage, getLeadDetail, getLeadTimeline, getRecentMessages, getBookingsOverview, getSalesMetrics, globalSearch } = require('../sales-api/queries');
const { computeQueue, DEFAULT_CONFIG } = require('../sales-api/priority');
const { getCompanyServices, getSalesRules, getSalesPlaybook } = require('./company-knowledge');
const { getAppManifest } = require('./context');

function buildTools({ dbModule, axios, GHL_BASE, GHL_LOCATION, ghlHeaders, readData }) {
  const repId = () => dbModule.DEFAULT_REP_ID;
  const priorityConfig = () => dbModule.getSalesSettings(repId())?.priority || {};

  // Queue payloads can be large (thousands of leads in low_priority_source /
  // cold_lead) — tool results go straight into the model's context window,
  // so every bucket is capped hard and callers are told the true count.
  function trimBucket(items, limit = 15) {
    return { count: items.length, shown: items.slice(0, limit) };
  }

  const definitions = [
    {
      name: 'get_sales_queue',
      description: 'The full prioritized sales queue, bucketed (needs_reply, followup_due, new_lead, ready_to_book, quote_followup, awaiting_reply, maintenance_due, reactivation, nurture, cold_lead, low_priority_source, no_action_needed). Each entry includes WHY it is there. Use this for "who should I call/text right now", "give me my hottest leads", "what needs attention".',
      input_schema: { type: 'object', properties: {
        buckets: { type: 'array', items: { type: 'string' }, description: 'Optional: only return these buckets (e.g. ["needs_reply","ready_to_book"]). Omit for all.' },
        limitPerBucket: { type: 'integer', description: 'Max entries per bucket, default 15.' },
      } },
    },
    {
      name: 'search_leads',
      description: 'Free-text search across name, phone, email, vehicle, service, tags. Use to find a specific person by name ("Jason", "Sarah").',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
    },
    {
      name: 'get_leads_list',
      description: 'Server-side filtered/paginated list of ALL leads (thousands of contacts) — use for questions like "show Instagram leads from this week" or "leads with no appointment in Quote Form V2". Prefer get_sales_queue for priority-based questions; use this for arbitrary filters.',
      input_schema: { type: 'object', properties: {
        search: { type: 'string' }, source: { type: 'string', description: 'instagram | phone | lead_form | manual' },
        pipeline: { type: 'string' }, stage: { type: 'string' }, service: { type: 'string' }, tag: { type: 'string' },
        needsReply: { type: 'boolean' }, followupDue: { type: 'boolean' },
        page: { type: 'integer' }, pageSize: { type: 'integer', description: 'max 25 for this tool' },
        sort: { type: 'string', description: 'created | updated | name | phone' }, dir: { type: 'string', description: 'asc | desc' },
      } },
    },
    {
      name: 'get_lead',
      description: 'Full profile for one lead: contact info, vehicle, service, stage/pipeline, last message, booking status, maintenance status, open follow-up, last disposition, notes, disposition history, opportunities, previous bookings. Use before answering any question about a specific named person.',
      input_schema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
    },
    {
      name: 'get_lead_timeline',
      description: 'Chronological event history for one lead: created, stage changes, notes, dispositions, follow-ups set, bookings.',
      input_schema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
    },
    {
      name: 'get_lead_conversation',
      description: 'The full message thread for one lead, fetched live from GoHighLevel (not just the cached last message). Use this before drafting a response or summarizing "what has happened with this person so far".',
      input_schema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] },
    },
    {
      name: 'get_followups',
      description: 'Follow-ups by status (default "open"), each tagged overdue/upcoming.',
      input_schema: { type: 'object', properties: { status: { type: 'string', description: 'open | done | cancelled' } } },
    },
    {
      name: 'get_bookings',
      description: 'Setmore appointments grouped into Today/Tomorrow/Upcoming/Recently Completed. Use for "who can I fill tomorrow with" or "what does today look like".',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_sales_metrics',
      description: 'Trustworthy KPI numbers: new leads today/this week, total contacts/opportunities, open/overdue follow-ups, dispositions logged in last 30 days, upcoming bookings, queue bucket counts. Includes explicit caveats about what is NOT reliable yet (e.g. booking outcome status, revenue attribution) — always read and respect those caveats.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_maintenance_clients',
      description: 'The recurring-maintenance client roster with next_due_date, frequency, agreed price.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_company_services',
      description: 'Real service names, prices, and durations, read live from the synced Setmore service list — the actual current pricing. If this returns available:false, no pricing data has been synced and you must say pricing is unknown rather than guessing.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_sales_rules',
      description: 'The deterministic rules the priority queue actually runs on (what defines each bucket, hot vs warm), plus an explicit list of business policies that are NOT yet defined (service area boundary, discount authority, etc.) — never invent an answer for anything listed as not defined.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_sales_playbook',
      description: 'Upsell/recommendation technique from the team\'s senior sales rep: paint-correction guidance by vehicle age, which brands have easier vs harder-to-clean interiors, stain-tier handling, pet hair/sand add-on phrasing, ceramic tier recommendation defaults, the new-car (2025+) protection ask, default quoting strategy, and the included 6-month wax sealant. This is technique/judgment, not verified pricing or policy — say so when relaying it, and use get_company_services for actual prices.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_pipeline_list',
      description: 'The real list of GHL pipelines and their stages, fetched live from GoHighLevel (not hardcoded).',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'get_system_status',
      description: 'What pages/routes/data-sources exist in this application right now, data-freshness intervals, and known data limitations. Use for "where can I see X" / "how does Y work" / "what data are we missing".',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'navigate',
      description: 'Suggest the user open a specific page or lead in the app. This does NOT perform the navigation — it surfaces a clickable button for the user. Use whenever the user asks to "open", "take me to", or "show me" a page or a specific person.',
      input_schema: { type: 'object', properties: {
        route: { type: 'string', description: 'App hash route, e.g. "#/lead/abc123", "#/queue", "#/followups", "#/calendar"' },
        label: { type: 'string', description: 'Short button label, e.g. "Open Jason\'s profile"' },
      }, required: ['route', 'label'] },
    },
    {
      name: 'propose_action',
      description: 'Prepare (but do NOT execute) a change: creating a follow-up, adding a note, or logging a disposition. This only returns a confirmation card for the user to approve — it never writes anything itself. Use this instead of claiming you performed an action.',
      input_schema: { type: 'object', properties: {
        type: { type: 'string', description: 'create_followup | add_note | change_disposition' },
        contactId: { type: 'string' },
        details: { type: 'object', description: 'e.g. {dueAt, reason, note} for create_followup; {body} for add_note; {disposition, note} for change_disposition' },
        reason: { type: 'string', description: 'Why you are proposing this' },
      }, required: ['type', 'contactId', 'details', 'reason'] },
    },
  ];

  const executors = {
    get_sales_queue: async ({ buckets, limitPerBucket }) => {
      const q = computeQueue(dbModule, priorityConfig());
      const keys = buckets?.length ? buckets : Object.keys(q.buckets);
      const trimmed = {};
      for (const k of keys) if (q.buckets[k]) trimmed[k] = trimBucket(q.buckets[k], limitPerBucket || 15);
      return { counts: q.counts, complianceFlags: q.complianceFlags, nextBestAction: q.nextBestAction, buckets: trimmed, generatedAt: q.generatedAt };
    },
    search_leads: async ({ query, limit }) => ({ results: globalSearch(dbModule, query, Math.min(limit || 15, 25)) }),
    get_leads_list: async (input) => getLeadsPage(dbModule, { ...input, pageSize: Math.min(input.pageSize || 15, 25) }),
    get_lead: async ({ contactId }) => {
      const lead = getLeadDetail(dbModule, contactId);
      return lead || { error: 'No contact found with that id.' };
    },
    get_lead_timeline: async ({ contactId }) => ({ timeline: getLeadTimeline(dbModule, contactId) }),
    get_lead_conversation: async ({ contactId }) => {
      if (!process.env.GHL_API_KEY) return { error: 'GHL_API_KEY not set — cannot fetch live conversation.' };
      try {
        const searchRes = await axios.get(`${GHL_BASE}/conversations/search`, { headers: ghlHeaders(), params: { locationId: GHL_LOCATION, contactId, limit: 1 } });
        const convs = searchRes.data.conversations || [];
        if (!convs.length) return { messages: [] };
        const msgRes = await axios.get(`${GHL_BASE}/conversations/${convs[0].id}/messages`, { headers: ghlHeaders(), params: { limit: 50 } });
        const raw = msgRes.data.messages?.messages || [];
        // TYPE_CALL entries have no body — GHL exposes duration/status but no
        // recording or transcript (verified live). Surfaced distinctly so the
        // model can answer "did we call them" without inventing call content.
        return { messages: raw.map(m => m.messageType === 'TYPE_CALL'
          ? { type: 'call', direction: m.direction === 'inbound' ? 'customer' : 'sf_city_wash', callDuration: m.meta?.call?.duration ?? null, callStatus: m.meta?.call?.status || 'unknown', date: m.dateAdded || m.createdAt || '' }
          : { type: 'message', direction: m.direction === 1 || m.direction === 'inbound' ? 'customer' : 'sf_city_wash', body: m.body || m.text || '', date: m.dateAdded || m.createdAt || '' }
        ).reverse() };
      } catch (e) { return { error: e.message }; }
    },
    get_followups: async ({ status }) => {
      const s = status || 'open';
      const rows = s === 'open' ? dbModule.getOpenFollowups() : dbModule.db.prepare(`SELECT * FROM sales_followups WHERE status=?`).all(s);
      const now = Date.now();
      return { followups: rows.map(f => ({ ...f, bucket: f.status !== 'open' ? f.status : (f.due_at <= now ? 'overdue' : 'upcoming') })) };
    },
    get_bookings: async () => getBookingsOverview(dbModule),
    get_sales_metrics: async () => getSalesMetrics(dbModule, priorityConfig()),
    get_maintenance_clients: async () => ({ clients: dbModule.getMaintenanceClients() }),
    get_company_services: async () => getCompanyServices(readData),
    get_sales_rules: async () => getSalesRules({ ...DEFAULT_CONFIG, ...priorityConfig() }),
    get_sales_playbook: async () => getSalesPlaybook(),
    get_pipeline_list: async () => readData('ghl-pipelines.json') || { pipelines: [], note: 'Not synced yet.' },
    get_system_status: async () => ({ ...getAppManifest(), integrations: dbModule.getIntegrationStatus() }),
    navigate: async ({ route, label }) => ({ navigated: false, route, label }), // the frontend renders this as a button
    propose_action: async ({ type, contactId, details, reason }) => ({ proposed: true, type, contactId, details, reason }),
  };

  return { definitions, executors };
}

module.exports = { buildTools };
