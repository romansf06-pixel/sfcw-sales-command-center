/**
 * Booking-source resolver.
 *
 * The CEO hasn't confirmed yet whether Setmore or the GHL Calendar is the real
 * source of truth for appointments (both are live: Setmore is what the booking
 * flow actually writes to; GHL has its own "SFCW Calendar" plus "Confirmed
 * Appointment Date/Time" custom fields that suggest some bookings get recorded
 * there too). Rather than hard-code an assumption into every screen that needs
 * to know "is this lead booked?", every caller goes through resolveBooking()
 * here. When the CEO answers, only PRIORITY below needs to change.
 *
 * Today Setmore is checked first because it's the system that actually creates
 * jobs (per docs/COMMAND-CENTER-AUDIT.md); the GHL custom fields are a fallback
 * signal, not proof of a real appointment.
 */

const PRIORITY = ['setmore', 'ghl'];

function phoneDigits(v) {
  return String(v || '').replace(/\D/g, '').slice(-10);
}

/**
 * @param {object} dbModule - the required ./db/index module
 * @param {object} contact - a contacts row (must have `id`, `phone`, optionally confirmed_appt_date/time)
 * @returns {{source: 'setmore'|'ghl'|'none', status: string|null, date: string|null, time: string|null, startsAtMs: number|null, raw: object|null}}
 */
function resolveBooking(dbModule, contact) {
  if (!contact) return { source: 'none', status: null, date: null, time: null, startsAtMs: null, raw: null };

  const sources = {
    setmore: () => {
      const byPhone = dbModule.getBookingsByPhone(phoneDigits(contact.phone));
      const byContact = contact.id ? dbModule.getBookingsByContactId(contact.id) : [];
      const rows = [...byContact, ...byPhone];
      if (!rows.length) return null;
      // Prefer the soonest upcoming booking; fall back to the most recent past one.
      const now = Date.now();
      const upcoming = rows.filter(r => r.starts_at && r.starts_at >= now).sort((a, b) => a.starts_at - b.starts_at);
      const row = upcoming[0] || rows.sort((a, b) => (b.starts_at || 0) - (a.starts_at || 0))[0];
      if (!row) return null;
      // Setmore's sync always writes status "confirmed" (the API doesn't
      // expose completed/cancelled/no-show — see server.js fetchSetmoreData),
      // so "confirmed" on a PAST date would misleadingly read as if the
      // appointment is still pending. `timing` lets callers phrase it
      // correctly ("last appointment" vs "upcoming appointment") without
      // claiming a completion status the data doesn't actually have.
      const isUpcoming = row.starts_at && row.starts_at >= now;
      return {
        source: 'setmore',
        status: row.status || 'confirmed',
        timing: isUpcoming ? 'upcoming' : 'past',
        date: row.starts_at ? new Date(row.starts_at).toISOString().slice(0, 10) : null,
        time: row.starts_at ? new Date(row.starts_at).toISOString().slice(11, 16) : null,
        startsAtMs: row.starts_at || null,
        raw: row,
      };
    },
    ghl: () => {
      if (!contact.confirmed_appt_date) return null;
      const parsed = Date.parse(contact.confirmed_appt_date);
      return {
        source: 'ghl',
        status: 'confirmed',
        timing: isFinite(parsed) && parsed >= Date.now() ? 'upcoming' : 'past',
        date: contact.confirmed_appt_date,
        time: contact.confirmed_appt_time || null,
        startsAtMs: null, // GHL only gives us date/time strings, not a parsed instant
        raw: null,
      };
    },
  };

  for (const key of PRIORITY) {
    const result = sources[key]();
    if (result) return result;
  }
  return { source: 'none', status: null, date: null, time: null, startsAtMs: null, raw: null };
}

module.exports = { resolveBooking, PRIORITY, phoneDigits };
