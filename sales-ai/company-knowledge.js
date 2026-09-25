/**
 * Structured company knowledge — deliberately NOT a wall of prose baked into
 * a system prompt. Everything here is either read live from real synced data
 * (services/pricing come straight from the Setmore sync — the actual prices
 * customers are charged) or is an explicit "not yet defined" placeholder.
 *
 * IMPORTANT: sections like discount authority, objection scripts, and
 * service-area boundaries are NOT invented here. The CEO hasn't provided
 * them yet (see the open questions raised earlier in this project). Marking
 * them clearly missing is safer than fabricating a policy that isn't real —
 * the whole point of this file is that the AI never has to guess.
 */

function getCompanyServices(readData) {
  const setmore = readData('setmore.json');
  if (!setmore?.services?.length) {
    return { available: false, note: 'No Setmore services synced yet (SETMORE_API_KEY not set or sync has not run).', services: [] };
  }
  return {
    available: true,
    asOf: setmore.fetchedAt,
    services: setmore.services.map(s => ({ name: s.name, price: s.price, durationMinutes: s.duration })),
  };
}

// Everything below is genuinely unknown until the CEO defines it. Listed
// explicitly (rather than omitted) so the AI can say "this isn't defined
// yet" instead of silently having nothing to check.
const UNDEFINED_POLICY = {
  serviceAreaBoundary: 'Not defined — company_knowledge.serviceAreaBoundary. Some CRM contacts show non-Bay-Area cities (LA, Houston, NYC); no rule yet distinguishes in-area from out-of-area leads.',
  travelFees: 'Not defined.',
  discountAuthority: 'Not defined — how much a rep may discount without CEO approval is an open question.',
  bookingPolicies: 'Not defined beyond what Setmore enforces operationally.',
  addOns: 'Not catalogued separately from the Setmore service list above — add-ons, if any, are just additional line-item services.',
  qualificationRequirements: 'Not defined — no formal minimum bar (vehicle type, price range, etc.) for a lead to be "qualified" has been set by the CEO.',
  whatRepsCanPromise: 'Not defined.',
};

// The sales "rules" that actually exist today are the ones already running
// in sales-api/priority.js — encoded as config, not prose, so this stays
// truthful instead of restating a fictional playbook. Objection-handling
// scripts, price-objection responses, and a formal follow-up cadence beyond
// what's below have NOT been provided by the CEO yet (see priority CEO
// questions raised earlier in this project).
function getSalesRules(priorityConfig) {
  return {
    bucketDefinitions: {
      needs_reply: 'Customer\'s most recent message contains real sales content (pricing/availability/booking/service/vehicle/location/objection/a direct question) and hasn\'t been answered yet.',
      followup_due: 'A manually-set follow-up date/time has passed.',
      new_lead: `Never contacted (no message either direction, no disposition logged), has a real pipeline opportunity, created within ${priorityConfig.newLeadWindowHours} hours.`,
      ready_to_book: 'Pipeline stage name matches a high-intent pattern (e.g. "replied", "warm", "proposal", "ready for") and no appointment exists.',
      quote_followup: `Evidence of a quote (Quoted Price field, a "quote" tag, or a quote_sent disposition) with no booking, ${priorityConfig.quoteFollowupHours}+ hours since last contact.`,
      awaiting_reply: `We sent an outbound message and it's been ${priorityConfig.awaitingReplyHours}+ hours with no reply, but under ${priorityConfig.coldLeadDays} days.`,
      maintenance_due: `Existing maintenance-roster client whose next_due_date is within ${priorityConfig.maintenanceLookaheadDays} days.`,
      reactivation: `Completed a job ${priorityConfig.reactivationMonths}+ months ago, not on the maintenance roster.`,
      nurture: 'Customer explicitly signaled "later/future/not now" language.',
      cold_lead: `No activity in ${priorityConfig.coldLeadDays}+ days, not otherwise excluded.`,
      low_priority_source: 'Instagram DMs / unresolved phone calls / expired pipeline / bulk-imported lists / no pipeline opportunity at all — deprioritized by rep direction unless the message itself is clearly urgent.',
      no_action_needed: 'Thank-yous, message reactions, review requests, vendor spam, comment-bot artifacts (tagged "process commenter" etc.), or day-of-job logistics chatter — not a sales opportunity.',
    },
    hotVsWarm: 'Within Needs Reply: HOT = message mentions pricing, availability, booking, a callback request, or an objection. WARM = any other genuine sales content or an ambiguous-but-not-dismissable reply.',
    priorityOrder: 'Needs Reply (hot before warm) > Follow-Up Due > New Lead > Ready to Book > Quote Follow-Up > Awaiting Reply > Maintenance Due > Reactivation > Cold Lead > Nurture > Low-Priority Source.',
    ...UNDEFINED_POLICY,
  };
}

// Sales technique/judgment provided directly by the team's senior sales rep
// (2026-09-25) — NOT read from a live system, so it's kept separate from
// getCompanyServices (which only ever states real synced Setmore pricing).
// This is "how an experienced rep on this team thinks about a quote," not a
// pricing fact — the AI should frame it that way rather than stating it as
// company policy. Mirrored in the frontend at sales/js/pricing.js
// (buildUpsellNotes) so the Call Helper shows the same guidance without a
// round trip; if one changes, check the other.
function getSalesPlaybook() {
  return {
    providedBy: 'Senior sales rep, relayed by the owner',
    asOf: '2026-09-25',
    note: 'Technique and judgment calls, not verified company policy — frame it that way when relaying it, distinct from get_company_services (real pricing) and get_sales_rules (deterministic queue logic).',
    paintCorrectionByAge: {
      '2025+':    'New vehicle — ask if they want long-term paint protection (ceramic) applied while the paint is still pristine.',
      '2024':     'Newer vehicle, no correction typically needed.',
      '2017-2023':'Ask about paint condition on the call; recommend a 1-step correction if swirls/marring are visible.',
      'pre-2017': 'Ask about buildup in cupholders and carpets. If described as dirtier than average, a +$75 condition add-on may apply.',
    },
    interiorDifficultyByBrand: {
      easierToClean: { makes: ['BMW', 'Mercedes-Benz', 'Audi', 'Volvo', 'Porsche'], note: 'German luxury makes — carpets are typically less embedded.' },
      oftenEmbedded: { makes: ['Toyota', 'Honda', 'Tesla'], note: 'Often run embedded carpet contaminants — set expectations with "embedded" rather than promising 100% removal.' },
    },
    stainTiers: [
      { tier: 'Minor — a seat or two', handling: 'Included in the standard detail.' },
      { tier: 'Moderate — every seat / larger area', handling: 'Steam treatment add-on, +$50.' },
      { tier: 'Heavy — large spills or heavy staining', handling: 'Recommend Seat Extraction add-on.' },
    ],
    petHairAndSand: 'Only recommend the add-on if the customer specifically wants 100% removal — the standard process clears the majority on its own. Describe anything left over as "embedded," never promise full removal.',
    ceramicTierGuidance: {
      default: '2-Year Sealant — most popular, the default recommendation.',
      lowCommitment: '12-Month Sealant — right for a customer only a little interested who wants to see the difference without committing.',
      correctionRule: 'Recommend a correction step alongside 2-Year/5-Year packages on older or visibly swirled paint.',
    },
    newCarLeadRule: 'Every lead on a 2025, 2026, or 2027 vehicle should be asked about interest in longer-term paint protection.',
    quotingStrategy: 'Default to quoting the Full Package (most popular) — it covers everything except pet hair, large stains, or heavier grime buildup. If the paint feels rough to the touch, recommend a Clay Bar Treatment. Most add-on upsells close easier in person, once the customer can see the vehicle, than over the phone.',
    waxSealantInclusion: 'All exterior and Full Package bookings already include a 6-month wax sealant — mention it as included, not an upsell.',
    bookingWorkflowReference: 'sfcitywash.com/express-booking — point customers here for questions about how the booking workflow works.',
  };
}

module.exports = { getCompanyServices, getSalesRules, getSalesPlaybook, UNDEFINED_POLICY };
