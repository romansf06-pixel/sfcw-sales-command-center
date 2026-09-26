/**
 * Read-side queries for the Sales Command Center. Everything here reads the
 * local SQLite cache that fetchGHLContacts()/syncGHLConversations() already
 * keep in sync from GHL every 5-30 minutes — GHL itself is never called live
 * on a page load. This is the same architecture the existing dashboard uses;
 * the sales app just adds the joins a salesperson actually needs.
 */

const { resolveBooking, phoneDigits } = require('./booking-source');
const { classifyMessage } = require('./intent');
const { computeQueue } = require('./priority');

function fullName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.phone || 'Unknown';
}

// Best matching opportunity for a contact: prefer the SF City Wash pipeline
// (the "real" sales pipeline per docs/COMMAND-CENTER-AUDIT.md), else whichever
// was most recently updated.
function primaryOpportunity(dbModule, contactId) {
  const rows = dbModule.db.prepare(
    `SELECT * FROM pipeline_opportunities WHERE contact_id = ? ORDER BY
       (pipeline = 'SF City Wash') DESC, updated_at DESC LIMIT 1`
  ).get(contactId);
  return rows || null;
}

function latestConversation(dbModule, contactId) {
  return dbModule.db.prepare(
    `SELECT * FROM conversations WHERE contact_id = ? ORDER BY last_msg_at DESC LIMIT 1`
  ).get(contactId) || null;
}

function matchMaintenance(dbModule, contact) {
  try {
    const rows = dbModule.getMaintenanceClients();
    const ph = phoneDigits(contact.phone);
    const hit = rows.find(r => r.ghl_contact_id === contact.id)
             || (ph ? rows.find(r => phoneDigits(r.phone) === ph) : null);
    return hit || null;
  } catch { return null; }
}

// The one place a raw contacts row + its joins become the "lead" shape every
// sales-API endpoint returns. Keep this the single source of truth for field
// names so the frontend never has to guess between two slightly different
// shapes of the same lead.
function buildLead(dbModule, contact, { withEnrichment = true } = {}) {
  if (!contact) return null;
  const opp = withEnrichment ? primaryOpportunity(dbModule, contact.id) : null;
  const convo = withEnrichment ? latestConversation(dbModule, contact.id) : null;
  const booking = withEnrichment ? resolveBooking(dbModule, contact) : null;
  const maintenance = withEnrichment ? matchMaintenance(dbModule, contact) : null;
  const openFollowup = withEnrichment ? dbModule.getOpenFollowupForContact(contact.id) : null;
  const lastDisposition = withEnrichment ? dbModule.getLastDispositionForContact(contact.id) : null;
  const leadState = withEnrichment ? dbModule.getLeadState(contact.id) : null;

  return {
    id: contact.id,
    name: fullName(contact),
    firstName: contact.first_name,
    lastName: contact.last_name,
    phone: contact.phone,
    email: contact.email,
    source: contact.source,
    tags: (() => { try { return JSON.parse(contact.tags || '[]'); } catch { return []; } })(),
    vehicle: contact.vehicle,
    vehicleYear: contact.vehicle_year,
    vehicleMake: contact.vehicle_make,
    vehicleModel: contact.vehicle_model,
    service: contact.service,
    serviceCategory: contact.service_category,
    ghlNotes: contact.ghl_notes,
    quotedPrice: contact.quoted_price,
    urgency: contact.urgency,
    assignedTo: contact.assigned_to,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
    stage: opp ? opp.stage : null,
    pipeline: opp ? opp.pipeline : null,
    dealStatus: opp ? opp.status : null,
    opportunityValue: opp ? opp.monetary_value : null,
    lastMessage: convo ? convo.last_message : null,
    lastMessageAt: convo ? convo.last_msg_at : null,
    lastMessageDirection: convo ? convo.last_message_direction : null,
    unreadCount: convo ? convo.unread : 0,
    booking,
    maintenance: maintenance ? {
      id: maintenance.id, status: maintenance.status,
      nextDueDate: maintenance.next_due_date, frequency: maintenance.frequency,
      lastServiceDate: maintenance.last_service_date,
    } : null,
    openFollowup: openFollowup ? {
      id: openFollowup.id, dueAt: openFollowup.due_at, reason: openFollowup.reason, note: openFollowup.note,
    } : null,
    lastDisposition: lastDisposition ? {
      disposition: lastDisposition.disposition, note: lastDisposition.note, createdAt: lastDisposition.created_at,
    } : null,
    handledBy: leadState ? leadState.handled_by : null,
    trashedAt: leadState ? leadState.trashed_at : null,
  };
}

// One-way archive — see sales-api/routes.js POST /leads/:id/trash. priority.js
// excludes these from every queue bucket, so this is the only place they're
// still visible, most-recently-trashed first.
function getTrashedLeads(dbModule) {
  const rows = dbModule.db.prepare(`
    SELECT c.* FROM contacts c
    JOIN sales_lead_state s ON s.contact_id = c.id
    WHERE s.trashed_at IS NOT NULL
    ORDER BY s.trashed_at DESC
  `).all();
  return rows.map(c => buildLead(dbModule, c));
}

const SORT_COLUMNS = {
  created: 'created_at', updated: 'updated_at', name: 'first_name', phone: 'phone',
};

// Server-side filtered/paginated leads list. Filters that need a join against
// conversations/followups/opportunities are expressed as SQL EXISTS clauses so
// filtering and pagination both happen in SQLite, not by loading everything
// into Node — this matters at 2,900+ contacts.
function getLeadsPage(dbModule, opts = {}) {
  const {
    search = '', source = '', pipeline = '', stage = '', service = '', tag = '',
    needsReply = false, followupDue = false,
    page = 1, pageSize = 50, sort = 'created', dir = 'desc',
  } = opts;

  const where = [];
  const params = {};

  if (search) {
    where.push(`(
      (first_name || ' ' || last_name) LIKE @q OR phone LIKE @q OR email LIKE @q OR
      vehicle LIKE @q OR vehicle_make LIKE @q OR vehicle_model LIKE @q OR
      service LIKE @q OR tags LIKE @q
    )`);
    params.q = `%${search}%`;
  }
  if (source)  { where.push(`source = @source`); params.source = source; }
  if (service) { where.push(`service LIKE @service`); params.service = `%${service}%`; }
  if (tag)     { where.push(`tags LIKE @tag`); params.tag = `%"${tag}"%`; }
  if (pipeline || stage) {
    const sub = [];
    if (pipeline) { sub.push(`pipeline = @pipeline`); params.pipeline = pipeline; }
    if (stage)    { sub.push(`stage = @stage`); params.stage = stage; }
    where.push(`id IN (SELECT contact_id FROM pipeline_opportunities WHERE ${sub.join(' AND ')})`);
  }
  if (needsReply) {
    where.push(`id IN (SELECT contact_id FROM conversations WHERE last_message_direction = 'inbound')`);
  }
  if (followupDue) {
    where.push(`id IN (SELECT contact_id FROM sales_followups WHERE status='open' AND due_at <= @now)`);
    params.now = Date.now();
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORT_COLUMNS[sort] || 'created_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const total = dbModule.db.prepare(`SELECT COUNT(*) as n FROM contacts ${whereSql}`).get(params).n;
  const rows = dbModule.db.prepare(
    `SELECT * FROM contacts ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });

  return {
    total, page, pageSize,
    leads: rows.map(r => buildLead(dbModule, r, { withEnrichment: true })),
  };
}

function getLeadDetail(dbModule, contactId) {
  const contact = dbModule.db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId);
  if (!contact) return null;
  const lead = buildLead(dbModule, contact);
  lead.messageIntent = lead.lastMessageDirection === 'inbound' ? classifyMessage(lead.lastMessage) : null;
  lead.notes = dbModule.getNotesForContact(contactId);
  lead.dispositionHistory = dbModule.getDispositionsForContact(contactId);
  lead.followupHistory = dbModule.getFollowupsForContact(contactId);
  lead.callAttempts = dbModule.getCallAttemptCount(contactId);
  lead.opportunities = dbModule.db.prepare(
    `SELECT * FROM pipeline_opportunities WHERE contact_id = ? ORDER BY updated_at DESC`
  ).all(contactId);
  lead.previousBookings = [
    ...(contact.id ? dbModule.getBookingsByContactId(contact.id) : []),
    ...dbModule.getBookingsByPhone(phoneDigits(contact.phone)),
  ].filter((b, i, arr) => arr.findIndex(x => x.id === b.id) === i)
   .sort((a, b) => (b.starts_at || 0) - (a.starts_at || 0));
  return lead;
}

// Chronological merge of everything known about a lead. GHL webhook events
// (lead_events) are the weakest source here — the webhook has no signature
// verification (see server.js apiGate comments), so treat it as "probably
// right" rather than authoritative; it's included because it's the only
// record of stage-change timing that exists at all.
function getLeadTimeline(dbModule, contactId) {
  const contact = dbModule.db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(contactId);
  if (!contact) return [];
  const events = [];

  events.push({ type: 'lead_created', at: contact.created_at, label: `Lead created via ${contact.source || 'unknown source'}` });

  for (const e of dbModule.db.prepare(`SELECT * FROM lead_events WHERE contact_id = ? ORDER BY occurred_at ASC`).all(contactId)) {
    events.push({ type: e.event_type || 'stage_change', at: e.occurred_at, label: e.stage ? `Stage → ${e.stage}` : (e.event_type || 'Update') });
  }
  for (const n of dbModule.getNotesForContact(contactId)) {
    events.push({ type: 'note', at: n.created_at, label: n.body });
  }
  for (const d of dbModule.getDispositionsForContact(contactId)) {
    events.push({ type: 'disposition', at: d.created_at, label: d.disposition + (d.note ? ` — ${d.note}` : '') });
  }
  for (const f of dbModule.getFollowupsForContact(contactId)) {
    events.push({ type: 'followup', at: f.created_at, label: `Follow-up set for ${new Date(f.due_at).toLocaleString()}${f.reason ? ` — ${f.reason}` : ''}`, status: f.status });
  }
  const bookings = [
    ...(contact.id ? dbModule.getBookingsByContactId(contact.id) : []),
    ...dbModule.getBookingsByPhone(phoneDigits(contact.phone)),
  ];
  for (const b of bookings) {
    events.push({ type: 'booking', at: b.starts_at || b.synced_at, label: `Appointment: ${b.service || 'Service'} (${b.status})` });
  }

  return events.filter(e => e.at).sort((a, b) => a.at - b.at);
}

// All recently-active conversations (call/text log), not filtered to "needs
// reply" — the Messages page's job is to show what's actually happening
// across the account, not just what's actionable. Reuses the same 100-most-
// recent cache the queue engine reads (GHL's conversations/search endpoint
// has no pagination, so "most recent 100" is the practical ceiling — see
// syncGHLConversations in server.js).
// Unified activity feed: GHL conversations + Setmore bookings, merged and
// deduped to the single most recent event PER PERSON — a customer who both
// texted and has a booking on file should show up once, not twice. Setmore
// never returns a GHL contact id (see booking-source.js), so bookings are
// matched back to a contact by phone where possible; if no contact matches,
// the booking still gets its own row keyed by phone so it isn't dropped.
function getRecentMessages(dbModule, { limit = 100, platform = '' } = {}) {
  const byPerson = new Map();

  const convoRows = dbModule.db.prepare(`
    SELECT v.*, c.first_name, c.last_name, c.vehicle, c.service, c.source
    FROM conversations v LEFT JOIN contacts c ON c.id = v.contact_id
    WHERE v.contact_id IS NOT NULL
    ORDER BY v.last_msg_at DESC
  `).all();
  for (const r of convoRows) {
    const existing = byPerson.get(r.contact_id);
    if (existing && existing.at >= (r.last_msg_at || 0)) continue;
    byPerson.set(r.contact_id, {
      contactId: r.contact_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Unknown',
      vehicle: r.vehicle, service: r.service, source: r.source,
      kind: 'message', platform: r.platform, direction: r.last_message_direction,
      preview: r.last_message || '(no text — image/attachment)',
      at: r.last_msg_at || 0, unread: r.unread,
    });
  }

  const contactByPhone = new Map();
  for (const c of dbModule.db.prepare(`SELECT id, phone, first_name, last_name, vehicle, service, source FROM contacts WHERE phone IS NOT NULL`).all()) {
    contactByPhone.set(phoneDigits(c.phone), c);
  }
  for (const b of dbModule.db.prepare(`SELECT * FROM bookings WHERE phone IS NOT NULL`).all()) {
    const match = contactByPhone.get(phoneDigits(b.phone));
    const key = match ? match.id : `phone:${phoneDigits(b.phone)}`;
    const at = b.starts_at || 0;
    const existing = byPerson.get(key);
    if (existing && existing.at >= at) continue;
    byPerson.set(key, {
      contactId: match ? match.id : null,
      name: (match ? [match.first_name, match.last_name].filter(Boolean).join(' ').trim() : '') || b.customer_name || 'Unknown',
      vehicle: match ? match.vehicle : null, service: b.service, source: match ? match.source : null,
      kind: 'booking', platform: 'setmore', direction: null,
      preview: `Booked: ${b.service || 'a service'} — ${new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`,
      at, unread: 0,
    });
  }

  let rows = [...byPerson.values()].sort((a, b) => b.at - a.at);
  if (platform) rows = rows.filter(r => r.platform === platform);
  return rows.slice(0, limit);
}

// Bookings overview — Setmore is the system that actually creates jobs (see
// booking-source.js header for the Setmore-vs-GHL-Calendar note), so this
// reads the bookings table directly rather than going through a per-contact
// resolver. Matches each booking back to a CRM contact by phone where
// possible so the rep can jump straight to the lead profile.
function getBookingsOverview(dbModule, { upcomingLimit = 100, recentLimit = 30 } = {}) {
  const now = Date.now();
  const contactByPhone = new Map();
  for (const c of dbModule.db.prepare(`SELECT id, phone, first_name, last_name FROM contacts WHERE phone IS NOT NULL`).all()) {
    contactByPhone.set(phoneDigits(c.phone), c);
  }
  const enrich = (b) => {
    const match = contactByPhone.get(b.phone);
    return {
      id: b.id, service: b.service, startsAt: b.starts_at, endsAt: b.ends_at, status: b.status,
      customerName: (match ? [match.first_name, match.last_name].filter(Boolean).join(' ').trim() : '') || b.customer_name || 'Unknown',
      contactId: match ? match.id : null, phone: b.phone,
    };
  };
  const upcoming = dbModule.db.prepare(`SELECT * FROM bookings WHERE starts_at >= ? ORDER BY starts_at ASC LIMIT ?`).all(now, upcomingLimit).map(enrich);
  const recent = dbModule.db.prepare(`SELECT * FROM bookings WHERE starts_at < ? ORDER BY starts_at DESC LIMIT ?`).all(now, recentLimit).map(enrich);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const tomorrowStart = new Date(); tomorrowStart.setDate(tomorrowStart.getDate() + 1); tomorrowStart.setHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart); tomorrowEnd.setHours(23, 59, 59, 999);
  return {
    today: upcoming.filter(b => b.startsAt <= todayEnd.getTime()),
    tomorrow: upcoming.filter(b => b.startsAt >= tomorrowStart.getTime() && b.startsAt <= tomorrowEnd.getTime()),
    upcoming: upcoming.filter(b => b.startsAt > tomorrowEnd.getTime()),
    recent,
  };
}

const CONVERSION_CAVEATS = [
  'Booking status is limited to "upcoming count" — Setmore sync does not yet capture completed/cancelled/no-show status.',
  'Conversion rate and revenue-per-booking are not included: booking-to-contact linkage is phone-match only (Setmore never returns a GHL contact id), so per-lead revenue attribution is not reliable enough to report yet.',
];

// Shared by /api/sales/stats and the AI Copilot's get_sales_metrics tool —
// one source of truth so the assistant can never report a different number
// than the Analytics page shows for the same thing.
function getSalesMetrics(dbModule, priorityConfig = {}) {
  const db = dbModule.db;
  const now = Date.now();
  const dayMs = 86_400_000;
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * dayMs;

  const newLeadsToday = db.prepare(`SELECT COUNT(*) n FROM contacts WHERE created_at >= ?`).get(startOfToday.getTime()).n;
  const newLeadsWeek = db.prepare(`SELECT COUNT(*) n FROM contacts WHERE created_at >= ?`).get(weekAgo).n;
  const totalContacts = dbModule.getContactCount();
  const totalOpportunities = dbModule.getOpportunityCount();
  const openFollowups = dbModule.getOpenFollowups();
  const overdueFollowups = openFollowups.filter(f => f.due_at <= now).length;
  const dispositions30d = db.prepare(`
    SELECT disposition, COUNT(*) n FROM sales_dispositions WHERE created_at >= ? GROUP BY disposition
  `).all(now - 30 * dayMs);
  const notesLogged = db.prepare(`SELECT COUNT(*) n FROM sales_notes`).get().n;
  const upcomingBookings = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE starts_at >= ?`).get(now).n;
  const queue = computeQueue(dbModule, priorityConfig);

  return {
    stats: {
      newLeadsToday, newLeadsWeek, totalContacts, totalOpportunities,
      openFollowups: openFollowups.length, overdueFollowups,
      dispositionsLast30Days: dispositions30d, notesLogged, upcomingBookings,
      queueCounts: queue.counts,
    },
    caveats: CONVERSION_CAVEATS,
  };
}

function globalSearch(dbModule, q, limit = 20) {
  if (!q || q.length < 2) return [];
  const like = `%${q}%`;
  const rows = dbModule.db.prepare(`
    SELECT * FROM contacts WHERE
      (first_name || ' ' || last_name) LIKE @q OR phone LIKE @q OR email LIKE @q OR
      vehicle LIKE @q OR vehicle_make LIKE @q OR vehicle_model LIKE @q OR
      service LIKE @q OR tags LIKE @q
    ORDER BY updated_at DESC LIMIT @limit
  `).all({ q: like, limit });
  return rows.map(r => buildLead(dbModule, r, { withEnrichment: false }));
}

module.exports = { buildLead, getLeadsPage, getLeadDetail, getLeadTimeline, getRecentMessages, getBookingsOverview, getSalesMetrics, globalSearch, getTrashedLeads, fullName, matchMaintenance, primaryOpportunity, latestConversation };
