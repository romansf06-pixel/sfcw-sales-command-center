/**
 * The Sales Command Center's own capability manifest — lets the copilot
 * answer "where can I see X" / "how does Y work" without needing the actual
 * source code sent to Anthropic. Keep this in sync with sales/js/main.js's
 * route table and sales-api/routes.js when either changes meaningfully.
 */

const APP_MANIFEST = {
  pages: [
    { route: '#/', name: 'Command Center', purpose: 'Landing page — today\'s counts, Next Best Action, daily brief.' },
    { route: '#/queue', name: 'My Queue', purpose: 'Full prioritized list across all buckets. Each lead card has a "Handled by" toggle (Kieran/Roman/Sebas, shared/visible to the whole team) and can be dragged onto the global trash icon (bottom-right, every page) to archive it one-way — no restore, click the icon to see what\'s there.' },
    { route: '#/messages', name: 'Conversations', purpose: 'Every recent conversation/call-log entry, filterable, not just actionable ones.' },
    { route: '#/leads', name: 'Leads', purpose: 'Full searchable/filterable table over all contacts.' },
    { route: '#/lead/:id', name: 'Lead Profile', purpose: 'Everything known about one lead: conversation, timeline, notes, dispositions, follow-ups, booking status, live availability, AI actions.' },
    { route: '#/followups', name: 'Follow-Ups', purpose: 'Overdue and upcoming manually-set follow-ups.' },
    { route: '#/calendar', name: 'Calendar', purpose: 'Month-grid view of Setmore appointments (Today/Tomorrow/Upcoming/Recently Completed data, click a day for full detail).' },
    { route: '#/reactivation', name: 'Reactivation', purpose: 'The reactivation bucket as its own page.' },
    { route: '#/analytics', name: 'Analytics', purpose: 'Trustworthy-only KPIs — deliberately excludes anything the underlying data can\'t support yet.' },
    { route: '#/settings', name: 'Settings', purpose: 'Priority-engine thresholds (editable).' },
    { route: '#/copilot', name: 'AI Copilot', purpose: 'This chat interface.' },
  ],
  queueBuckets: [
    'needs_reply', 'followup_due', 'new_lead', 'ready_to_book', 'quote_followup',
    'awaiting_reply', 'maintenance_due', 'reactivation', 'nurture', 'cold_lead',
    'low_priority_source', 'no_action_needed',
  ],
  bookingProvider: 'Setmore (read-only sync). The CEO has not confirmed whether Setmore or the GHL Calendar is authoritative long-term — see sales-api/booking-source.js.',
  dataFreshness: {
    contactsAndOpportunities: 'GHL sync every 30 minutes',
    conversations: 'GHL sync every 5 minutes (top 100 most-recently-active only — GHL\'s API has no pagination beyond that)',
    bookings: 'Setmore sync every 60 minutes',
  },
  knownLimitations: [
    'Message classification only ever sees the SINGLE most recent message per conversation, not full history — short ambiguous replies can be miscategorized.',
    'Booking status is phone-number-matched between Setmore and GHL contacts — Setmore never returns a GHL contact id directly.',
    'Setmore appointment status always syncs as "confirmed" — there is no completed/cancelled/no-show signal in the data.',
    'Only ~5% of contacts have a city on file, and of those, some are clearly outside the Bay Area — no service-area rule exists yet.',
    'Dispositions (sales_dispositions table) are new and still have very little history — any "why leads don\'t book" analysis is based on a small sample and should be reported with that caveat.',
    'The Lead Profile "Availability — Next Openings" card is a live call to the public Booking Worker for one representative service key (matched from the lead\'s service text, or a Sedan/Coupe default) — it is a duration estimate, not a per-vehicle-size-accurate booking guarantee. See sales-api/availability.js.',
  ],
};

function getAppManifest() { return APP_MANIFEST; }

module.exports = { getAppManifest, APP_MANIFEST };
