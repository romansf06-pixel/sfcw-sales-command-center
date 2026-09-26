/**
 * Deterministic priority engine for the Sales Command Center.
 *
 * Every lead is assigned to AT MOST ONE bucket (the first rule below that
 * matches, checked top to bottom), so a lead never shows up twice in "My
 * Queue" wondering which card is the real one. Every entry carries a
 * human-readable `reasons` array built from the actual data that triggered
 * it — there is no black-box numeric score shown to the rep, only used
 * internally to pick the single "Next Best Action" across buckets.
 *
 * IMPORTANT data-quality note: contacts.updated_at and bookings/session
 * timestamps written by the sync jobs get touched on every sync cycle
 * regardless of whether anything really changed in GHL, so they are NOT used
 * here as an "activity recency" signal. Only genuinely event-sourced
 * timestamps are used: conversations.last_msg_at (from GHL), contacts.created_at
 * (GHL dateAdded), and pipeline_opportunities.updated_at (GHL's own
 * updatedAt, not sync time).
 *
 * COMMERCIAL-CORRECTNESS note (2026-09-24, round 1): a manual read of 36 real
 * "Needs Reply" conversations found "latest inbound > latest outbound" alone
 * was wrong about a third of the time — thank-yous, tapback reactions, a
 * vendor's review-swap pitch, cold outreach spam, job-logistics chatter, and
 * one SMS STOP opt-out were all showing up as live sales opportunities. Every
 * inbound message now runs through sales-api/intent.js first.
 *
 * COMMERCIAL-CORRECTNESS note (2026-09-24, round 2): three more real cases
 * from a second pass:
 *   - "Tia" (tagged "process commenter") is a Facebook comment auto-enrolled
 *     in a CTA flow, not a detailing inquiry — 350 contacts (12% of the
 *     account) carry a comment-automation tag like this. intent.js can't see
 *     tags; sales-api/lead-quality.js now checks them before anything else.
 *   - "hq media" (tagged "spam likely" by GHL's own automation) is a vendor
 *     cold-calling the business line — the tag already knew.
 *   - PIPELINE_MAP in server.js was silently missing 2 of 8 real pipelines,
 *     including "V3 Leads & Website" — one of the CEO's stated PRIMARY lead
 *     sources. Pipeline/stage names are now fetched live (server.js
 *     fetchGHLPipelines()) instead of hardcoded, and "high intent" / terminal
 *     stage detection here matches by NAME PATTERN rather than an exact list
 *     that goes stale the moment a pipeline is renamed or added.
 *   - Added an explicit "Awaiting Reply" bucket for the case of a lead we
 *     DID reach out to (first text sent) who hasn't answered yet — previously
 *     this fell through to a vague Cold Lead after 5 days with no distinction
 *     from a lead nobody ever contacted at all.
 */

const { phoneDigits } = require('./booking-source');
const { classifyMessage } = require('./intent');
const { classifyContactQuality, isDeprioritizedPipeline, isHighIntentStage, isTerminalStage } = require('./lead-quality');

const DEFAULT_CONFIG = {
  newLeadWindowHours: 336, // 14 days — a never-contacted lead stays "New" for 2 weeks before aging into Cold Lead
  awaitingReplyHours: 6,      // how long to wait after OUR outbound before flagging silence
  coldLeadDays: 5,
  quoteFollowupHours: 12,
  reactivationMonths: 4,
  maintenanceLookaheadDays: 7,
  // Substring match (lowercased) against real stage names fetched live from
  // GHL — see server.js fetchGHLPipelines(). A pattern survives a pipeline
  // rename or a brand-new pipeline; an exact hardcoded list does not (this is
  // exactly the bug that missed "V3 Leads & Website" — see file header).
  highIntentStagePatterns: ['replied', 'responded', 'contacted after', 'warm', 'proposal', 'ready for', 'give em a ring', 'asap', 'this week'],
  terminalStagePatterns: ['complete', 'closed', 'converted', 'booked', 'no show', 'cancel', 'outdated', 'lost', 'not interested', 'expired'],
  // Per explicit CEO/rep direction (2026-09-24): "SFCW Leads V2", "V3 Leads &
  // Website", "Quote Form V2" and the original "SF City Wash Pipeline" are
  // the real qualified-lead pipelines. Instagram DMs and unresolved phone
  // calls generate enough noise (comment-bots, vendor cold calls) that they
  // are deprioritized by default rather than treated as equally urgent —
  // still visible, just not competing for top-of-queue attention. A contact
  // with genuine sales-signal TEXT still reaches Needs Reply regardless of
  // pipeline, since that's evidence-based, not a pipeline guess.
  deprioritizedPipelinePatterns: ['instagram', 'incoming calls', 'expired'],
};

const BUCKET_WEIGHT = {
  needs_reply: 100, followup_due: 95, new_lead: 90, ready_to_book: 80,
  quote_followup: 70, awaiting_reply: 65, maintenance_due: 50, reactivation: 40,
  cold_lead: 20, nurture: 15, low_priority_source: 10,
  no_action_needed: 0, // real, but never the Next Best Action
};

const BUCKET_LABELS = {
  needs_reply: 'Needs Reply', followup_due: 'Follow-Up Due', new_lead: 'New Lead',
  ready_to_book: 'Ready to Book', quote_followup: 'Quote Follow-Up', awaiting_reply: 'Awaiting Reply',
  maintenance_due: 'Maintenance Due', reactivation: 'Reactivation', nurture: 'Nurture',
  cold_lead: 'Cold Lead', low_priority_source: 'Low-Priority Source', no_action_needed: 'No Sales Action Needed',
};

// Which classifyMessage() categories keep a lead in Needs Reply vs redirect it
// elsewhere. 'opt_out' is handled separately (compliance flag, excluded from
// every bucket, never re-contacted from this app).
const NO_ACTION_CATEGORIES = ['no_action', 'spam', 'operational', 'system_message'];
const HOT_SIGNALS = new Set(['booking', 'availability', 'pricing', 'callback', 'objection']);

function hoursAgo(ms) { return ms ? (Date.now() - ms) / 3_600_000 : Infinity; }
function daysAgo(ms) { return hoursAgo(ms) / 24; }
function fmtDuration(ms) {
  const h = hoursAgo(ms);
  if (!isFinite(h)) return 'unknown';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}
function parseTags(raw) { try { return JSON.parse(raw || '[]'); } catch { return []; } }

function computeQueue(dbModule, overrides = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  const now = Date.now();

  const contacts = dbModule.db.prepare(`SELECT * FROM contacts`).all();

  // Bulk-load every join ONCE (not per-contact) — at ~3,000 contacts this
  // keeps the whole computation to a handful of full-table scans instead of
  // tens of thousands of individual prepared-statement round trips.
  const oppByContact = new Map();
  for (const o of dbModule.db.prepare(`SELECT * FROM pipeline_opportunities`).all()) {
    const cur = oppByContact.get(o.contact_id);
    if (!cur || (o.updated_at || 0) > (cur.updated_at || 0)) oppByContact.set(o.contact_id, o);
  }
  const convoByContact = new Map();
  for (const c of dbModule.db.prepare(`SELECT * FROM conversations ORDER BY last_msg_at DESC`).all()) {
    if (!convoByContact.has(c.contact_id)) convoByContact.set(c.contact_id, c);
  }
  const followupByContact = new Map();
  for (const f of dbModule.getOpenFollowups()) if (!followupByContact.has(f.contact_id)) followupByContact.set(f.contact_id, f);

  const lastDispositionByContact = new Map();
  for (const d of dbModule.db.prepare(`SELECT * FROM sales_dispositions ORDER BY created_at DESC`).all()) {
    if (!lastDispositionByContact.has(d.contact_id)) lastDispositionByContact.set(d.contact_id, d);
  }
  const leadStateByContact = new Map();
  for (const s of dbModule.db.prepare(`SELECT * FROM sales_lead_state`).all()) leadStateByContact.set(s.contact_id, s);

  const maintenanceByGhlId = new Map(), maintenanceByPhone = new Map();
  for (const m of dbModule.getMaintenanceClients()) {
    if (m.ghl_contact_id) maintenanceByGhlId.set(m.ghl_contact_id, m);
    if (m.phone) maintenanceByPhone.set(phoneDigits(m.phone), m);
  }
  const bookingsByPhone = new Map();
  for (const b of dbModule.db.prepare(`SELECT * FROM bookings WHERE phone IS NOT NULL`).all()) {
    const list = bookingsByPhone.get(b.phone) || [];
    list.push(b);
    bookingsByPhone.set(b.phone, list);
  }

  const buckets = { needs_reply: [], followup_due: [], new_lead: [], ready_to_book: [],
    quote_followup: [], awaiting_reply: [], maintenance_due: [], reactivation: [], nurture: [],
    cold_lead: [], low_priority_source: [], no_action_needed: [] };
  // Opt-outs never appear in any bucket a rep works from — surfaced once here
  // so the STOP is visible and actionable (confirm Do Not Contact) without
  // ever being mistaken for a lead to call.
  const complianceFlags = [];

  for (const c of contacts) {
    const disposition = lastDispositionByContact.get(c.id);
    if (disposition && ['do_not_contact', 'lost', 'wrong_number'].includes(disposition.disposition)) continue;

    const state = leadStateByContact.get(c.id);
    if (state && state.trashed_at) continue; // one-way archive — see sales-api/routes.js POST /leads/:id/trash
    if (state && state.snoozed_until && state.snoozed_until > now) continue;

    const tags = parseTags(c.tags);
    const quality = classifyContactQuality(tags);
    if (quality.category === 'excluded') {
      buckets.no_action_needed.push({ id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.phone || 'Unknown',
        phone: c.phone, bucket: 'no_action_needed', sortKey: now, reasons: [quality.reason] });
      continue;
    }

    const convo = convoByContact.get(c.id);
    const opp = oppByContact.get(c.id);
    const followup = followupByContact.get(c.id);
    const ph = phoneDigits(c.phone);
    const bookingRows = bookingsByPhone.get(ph) || [];
    const isBooked = bookingRows.some(b => b.starts_at && b.starts_at >= now) || !!c.confirmed_appt_date || quality.category === 'booked';
    const maintenance = maintenanceByGhlId.get(c.id) || (ph ? maintenanceByPhone.get(ph) : null);
    const neverContacted = !convo && !disposition;
    const isTerminal = isTerminalStage(opp ? opp.stage : null, cfg.terminalStagePatterns);
    // Either the pipeline itself is noisy (IG/unresolved calls/expired) or
    // the contact is a bulk-imported list entry, not an organic inbound lead
    // — both get the same treatment: still visible, just not competing with
    // real qualified-pipeline leads for top-of-queue attention.
    const pipelineDeprioritized = isDeprioritizedPipeline(opp ? opp.pipeline : null, cfg.deprioritizedPipelinePatterns)
      || quality.category === 'imported_list';

    const base = {
      id: c.id, name: [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.phone || 'Unknown',
      phone: c.phone, vehicle: c.vehicle, service: c.service,
      stage: opp ? opp.stage : null, pipeline: opp ? opp.pipeline : null, source: c.source,
      handledBy: state ? state.handled_by : null,
    };

    // 1. Social-media comment-automation contacts (e.g. "process commenter")
    // aren't a direct inquiry regardless of what pipeline/stage they landed
    // in — route them out before any message/stage logic runs.
    if (quality.category === 'social_engagement') {
      buckets.no_action_needed.push({ ...base, bucket: 'no_action_needed', sortKey: c.created_at || now, reasons: [quality.reason] });
      continue;
    }
    if (quality.category === 'no_action' && (!convo || convo.last_message_direction !== 'inbound')) {
      buckets.no_action_needed.push({ ...base, bucket: 'no_action_needed', sortKey: c.created_at || now, reasons: [quality.reason] });
      continue;
    }

    // 2. A customer message is sitting unanswered. Whether it belongs in
    // Needs Reply depends on what it actually says — see intent.js. Timing
    // alone (inbound > outbound) is necessary but no longer sufficient.
    if (convo && convo.last_message_direction === 'inbound') {
      const intent = classifyMessage(convo.last_message);
      const withMsg = { ...base, sortKey: convo.last_msg_at, lastMessage: convo.last_message, lastMessageAt: convo.last_msg_at, intent };

      if (intent.category === 'opt_out') {
        complianceFlags.push({ ...withMsg, bucket: 'compliance', reasons: [intent.reason] });
        continue;
      }
      if (NO_ACTION_CATEGORIES.includes(intent.category)) {
        buckets.no_action_needed.push({ ...withMsg, bucket: 'no_action_needed', reasons: [intent.reason] });
        continue;
      }
      if (intent.category === 'nurture') {
        buckets.nurture.push({ ...withMsg, bucket: 'nurture', reasons: [`${intent.reason} — messaged ${fmtDuration(convo.last_msg_at)} ago`] });
        continue;
      }
      // 'sales_signal' or 'ambiguous' — a real reply is warranted (ambiguous
      // stays visible rather than risk hiding a real lead; see intent.js).
      const tag = intent.signals?.some(s => HOT_SIGNALS.has(s)) ? 'hot' : 'warm';

      // EXCEPTION (2026-09-24, real cases: "maksym" — "Air Duster" — and
      // "neburia" — "Hey buddy", an unpaid-sponsorship pitch): an unanswered
      // message from a deprioritized-pipeline contact (IG DMs, unresolved
      // calls) only belongs in Needs Reply if it's actually urgent — a HOT
      // sales signal. A vague or ambiguous IG DM goes to Low-Priority Source
      // instead, still visible, just not competing with a real text
      // conversation for top billing. A genuinely hot IG message ("how much
      // for a full detail, can you come today?") still surfaces normally —
      // real content overrides the pipeline guess, just not for weak signals.
      if (pipelineDeprioritized && tag !== 'hot') {
        buckets.low_priority_source.push({ ...withMsg, bucket: 'low_priority_source',
          reasons: [`${base.pipeline || 'Low-priority source'} — no clear urgency: ${intent.reason.toLowerCase()}`] });
        continue;
      }

      buckets.needs_reply.push({ ...withMsg, bucket: 'needs_reply', intentTag: tag,
        reasons: [`Customer messaged ${fmtDuration(convo.last_msg_at)} ago — ${intent.reason.toLowerCase()}`] });
      continue;
    }

    // 3. Follow-up due — a manual commitment the rep made themselves.
    if (followup && followup.due_at <= now) {
      buckets.followup_due.push({ ...base, bucket: 'followup_due', sortKey: followup.due_at,
        reasons: [`Follow-up was due ${fmtDuration(followup.due_at)} ago${followup.reason ? ` — ${followup.reason}` : ''}`],
        followup: { id: followup.id, dueAt: followup.due_at, reason: followup.reason, note: followup.note } });
      continue;
    }

    if (isBooked) continue; // has an appointment — nothing left for the queue to flag unless caught above

    // 4. Never contacted, and has an actual pipeline opportunity — i.e. a
    // real lead, not just a bare contact record. A contact with NO
    // opportunity at all (1,277 of them in this account — old unresolved
    // phone entries, mostly) isn't something the pipeline ever treated as a
    // lead, so it's not treated as one here either; it's still visible, just
    // under Low-Priority Source rather than competing with real leads.
    //
    // Within the window, this outranks "we already reached out and are
    // waiting" (bucket 7) on purpose — per explicit direction (2026-09-24):
    // an untouched lead is more urgent than one already worked once. Sorted
    // oldest-first so the most-neglected lead surfaces at the top.
    if (neverContacted && opp) {
      if (daysAgo(c.created_at) * 24 <= cfg.newLeadWindowHours) {
        const src = pipelineDeprioritized ? buckets.low_priority_source : buckets.new_lead;
        src.push({ ...base, bucket: pipelineDeprioritized ? 'low_priority_source' : 'new_lead', sortKey: c.created_at,
          reasons: [`New ${c.source || ''} lead — created ${fmtDuration(c.created_at)} ago, never reached out to`
            + (pipelineDeprioritized ? ` (${opp.pipeline})` : '')] });
        continue;
      }
      // Beyond the window: falls through to Cold Lead (bucket 10) below,
      // which keeps a distinct "Never contacted" reason from "went quiet
      // after we reached out" — still flagged, just not fighting for top
      // billing against genuinely fresh leads forever.
    }
    if (neverContacted && !opp) {
      buckets.low_priority_source.push({ ...base, bucket: 'low_priority_source', sortKey: c.created_at,
        reasons: [`No pipeline opportunity on file — not an active lead (created ${fmtDuration(c.created_at)} ago)`] });
      continue;
    }

    // 5. Ready to book — pipeline stage signals real interest, no appointment exists.
    if (opp && !isTerminal && isHighIntentStage(opp.stage, cfg.highIntentStagePatterns)) {
      const src = pipelineDeprioritized ? buckets.low_priority_source : buckets.ready_to_book;
      src.push({ ...base, bucket: pipelineDeprioritized ? 'low_priority_source' : 'ready_to_book',
        sortKey: -(convo ? convo.last_msg_at : (opp.updated_at || 0)),
        reasons: [`Stage "${opp.stage}" — no appointment booked yet` + (pipelineDeprioritized ? ` (${opp.pipeline})` : '')] });
      continue;
    }

    // 6. Quote follow-up — evidence of a quote conversation. Deliberately NOT
    // gated solely on the Quoted Price custom field (only ~2% of contacts
    // have it filled in per the live GHL audit) — any one signal is enough.
    const quoteTag = tags.find(t => /quote/i.test(t));
    const quoteEvidence = [];
    if (c.quoted_price) quoteEvidence.push(`quoted $${c.quoted_price}`);
    if (quoteTag) quoteEvidence.push(`tagged "${quoteTag}"`);
    if (disposition && disposition.disposition === 'quote_sent') quoteEvidence.push('marked "Quote Sent"');
    if (quoteEvidence.length && convo && hoursAgo(convo.last_msg_at) >= cfg.quoteFollowupHours) {
      buckets.quote_followup.push({ ...base, bucket: 'quote_followup', sortKey: convo.last_msg_at,
        reasons: [`${quoteEvidence.join(', ')} — ${fmtDuration(convo.last_msg_at)} ago, no booking since`] });
      continue;
    }

    // 7. Awaiting reply — we made contact (an outbound message exists) and
    // it's gone quiet, but nothing above already claimed it. This is
    // deliberately its own bucket rather than falling straight to Cold Lead:
    // "we reached out and haven't heard back" is a different, earlier, and
    // more actionable state than "nobody has said anything in 5+ days."
    if (convo && convo.last_message_direction === 'outbound' && !isTerminal
        && hoursAgo(convo.last_msg_at) >= cfg.awaitingReplyHours && daysAgo(convo.last_msg_at) < cfg.coldLeadDays) {
      const src = pipelineDeprioritized ? buckets.low_priority_source : buckets.awaiting_reply;
      src.push({ ...base, bucket: pipelineDeprioritized ? 'low_priority_source' : 'awaiting_reply',
        sortKey: convo.last_msg_at,
        reasons: [`We reached out ${fmtDuration(convo.last_msg_at)} ago — no response yet`
          + (pipelineDeprioritized ? ` (${opp?.pipeline})` : '')] });
      continue;
    }

    // 8. Maintenance due — existing recurring client approaching their interval.
    if (maintenance && maintenance.status === 'active' && maintenance.next_due_date) {
      const dueMs = new Date(maintenance.next_due_date).getTime();
      if (isFinite(dueMs) && dueMs <= now + cfg.maintenanceLookaheadDays * 86_400_000) {
        buckets.maintenance_due.push({ ...base, bucket: 'maintenance_due', sortKey: dueMs,
          reasons: [`Maintenance due ${maintenance.next_due_date} (${maintenance.frequency || 'recurring'})`] });
        continue;
      }
    }

    // 9. Reactivation — completed a job a while ago, not on the maintenance roster.
    if (opp && /complete/i.test(opp.stage || '') && !maintenance) {
      const monthsSince = daysAgo(opp.updated_at) / 30;
      if (monthsSince >= cfg.reactivationMonths) {
        buckets.reactivation.push({ ...base, bucket: 'reactivation', sortKey: opp.updated_at || 0,
          reasons: [`Previous ${c.service || 'service'} customer — last activity ~${Math.round(monthsSince)} months ago`] });
        continue;
      }
    }

    // 10. Cold lead — catch-all so nothing silently disappears. Uses only
    // event-sourced timestamps (see file header) — never contacts.updated_at.
    const lastActivity = Math.max(convo ? convo.last_msg_at || 0 : 0, opp ? opp.updated_at || 0 : 0, c.created_at || 0);
    if (!isTerminal && daysAgo(lastActivity) >= cfg.coldLeadDays) {
      const src = pipelineDeprioritized ? buckets.low_priority_source : buckets.cold_lead;
      src.push({ ...base, bucket: pipelineDeprioritized ? 'low_priority_source' : 'cold_lead', sortKey: lastActivity,
        reasons: [(neverContacted
          ? `Never contacted — ${Math.round(daysAgo(lastActivity))} days old`
          : `No response in ${Math.round(daysAgo(lastActivity))} days`) + (pipelineDeprioritized ? ` (${opp?.pipeline})` : '')] });
    }
  }

  // Within Needs Reply specifically, hottest first regardless of wait time —
  // a HOT "call me Tuesday" from an hour ago outranks a WARM ambiguous reply
  // from 3 days ago. Other buckets are unaffected (they have no intentTag,
  // so this falls through to the original oldest/most-overdue-first order).
  const TAG_RANK = { hot: 0, warm: 1 };
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => {
      const tagDiff = (TAG_RANK[a.intentTag] ?? 2) - (TAG_RANK[b.intentTag] ?? 2);
      return tagDiff !== 0 ? tagDiff : a.sortKey - b.sortKey;
    });
  }

  let nextBestAction = null, bestScore = -Infinity;
  for (const [key, items] of Object.entries(buckets)) {
    if (!items.length || key === 'no_action_needed') continue;
    if (BUCKET_WEIGHT[key] > bestScore) { bestScore = BUCKET_WEIGHT[key]; nextBestAction = items[0]; }
  }

  return {
    counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    buckets, complianceFlags, nextBestAction, config: cfg,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { computeQueue, DEFAULT_CONFIG, BUCKET_LABELS, BUCKET_WEIGHT };
