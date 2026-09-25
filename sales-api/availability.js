/**
 * Recommended-slots lookup for the Lead Profile "Availability" card.
 *
 * Reuses the public Booking Worker's GET /slots endpoint — the same
 * proven, filtered availability the customer-facing booking widget and
 * server.js's own /api/health check call (server.js:1150). No Setmore
 * credentials needed here: the Worker holds those and already applies the
 * real scheduling rules (5h lead time, buffers, 9 PM finish cap, blackout
 * dates). This file does NOT re-implement any of that — see
 * .claude/skills/integrating-sfcw-apis/references/setmore.md before
 * touching the Worker's own /slots logic.
 *
 * Called as a normal (non-staff) request, so what a rep sees here is
 * exactly what a customer could actually book — never a staff-only or
 * override slot that would surprise the customer at drop-off.
 */

const WORKER_BASE = 'https://sfcw-booking.sfcitywash.workers.dev';

// Interior Detail — Sedan / Coupe. Real, currently-bookable key (verified
// live 2026-09-25) — also what server.js's health check uses as its known-
// good probe. Used only when a lead's service text can't be matched against
// the live-synced catalog, so estimates never silently rely on a stale or
// made-up key.
const FALLBACK_SERVICE = { key: '1e930881-298f-42c9-9b72-954e358c2e73', name: 'Interior Detail — Sedan / Coupe' };

const PACKAGE_KEYWORDS = [
  { kw: ['ceramic', 'coating', 'sealant'], test: name => /ceramic|coating|sealant/i.test(name) },
  { kw: ['full'], test: name => /^full (package|detail)/i.test(name) || /full package/i.test(name) },
  { kw: ['exterior', 'wash'], test: name => /^(exterior|standard exterior)/i.test(name) },
  { kw: ['interior'], test: name => /^interior detail/i.test(name) },
];

// No reliable vehicle-size classifier exists elsewhere in this codebase
// (see .claude/skills/integrating-sfcw-apis SKILL.md — service-area/vehicle
// inference is explicitly called out as not yet defined). Defaulting to the
// Sedan/Coupe tier rather than guessing a size keeps the duration estimate
// honest; the UI marks it as approximate.
const DEFAULT_VEHICLE_SUFFIX = 'Sedan / Coupe';

/**
 * Match a lead's free-text service against the live-synced Setmore catalog
 * (data/setmore.json, kept fresh by the background sync — see
 * sales-ai/company-knowledge.js's getCompanyServices for the same read).
 * Falls back to a known-bookable default when nothing matches or the
 * catalog hasn't synced yet, and always says so via `approximate`.
 */
function resolveServiceKey(readData, leadServiceText) {
  const setmore = readData('setmore.json');
  const services = setmore?.services || [];
  if (!services.length) {
    return { ...FALLBACK_SERVICE, approximate: true, note: 'No live Setmore catalog synced yet — using a default service as a stand-in.' };
  }

  const text = (leadServiceText || '').toLowerCase();
  const sedanServices = services.filter(s => s.name.includes(DEFAULT_VEHICLE_SUFFIX));
  const pool = sedanServices.length ? sedanServices : services;

  for (const { kw, test } of PACKAGE_KEYWORDS) {
    if (!kw.some(k => text.includes(k))) continue;
    const match = pool.find(s => test(s.name));
    if (match) return { key: match.key, name: match.name, price: match.price, durationMinutes: match.duration, approximate: false };
  }

  // No confident keyword match — use whichever package the fallback key
  // represents, described from the live catalog if it's still in there.
  const fallbackInCatalog = services.find(s => s.key === FALLBACK_SERVICE.key);
  return {
    key: FALLBACK_SERVICE.key,
    name: fallbackInCatalog?.name || FALLBACK_SERVICE.name,
    price: fallbackInCatalog?.price,
    durationMinutes: fallbackInCatalog?.duration,
    approximate: true,
    note: `Couldn't match "${leadServiceText || 'no service on file'}" to a specific package — showing availability for a standard appointment length instead.`,
  };
}

function dateStr(d) { return d.toISOString().slice(0, 10); }

/**
 * Pulls the next `days` days of live availability for one service key from
 * the public Worker, in parallel. Returns only days that have at least one
 * open slot, each capped to `maxPerDay` times so the card stays short.
 */
async function getRecommendedSlots({ axios, serviceKey, days = 7, maxPerDay = 4 }) {
  const today = new Date();
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return dateStr(d);
  });

  const results = await Promise.all(dates.map(async d => {
    try {
      const res = await axios.get(`${WORKER_BASE}/slots`, { params: { date: d, serviceKeys: serviceKey }, timeout: 8000 });
      const body = res.data;
      if (!body?.success) return null;
      const open = (body.slots || []).filter(s => s.available).map(s => s.time);
      if (!open.length) return null;
      return { date: d, times: open.slice(0, maxPerDay), totalOpen: open.length, jobMinutes: body.jobMinutes };
    } catch {
      return null; // one bad day shouldn't blank the whole card
    }
  }));

  return { days: results.filter(Boolean), supportPhone: '(415) 360-1964' };
}

module.exports = { resolveServiceKey, getRecommendedSlots, WORKER_BASE, FALLBACK_SERVICE };
