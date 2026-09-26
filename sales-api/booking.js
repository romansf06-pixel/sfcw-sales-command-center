/**
 * Create a real Setmore appointment from the Sales Command Center — v1,
 * base packages only (no add-ons/ceramic/correction; note them in the
 * booking note for now). Every service key below is copied verbatim from
 * the main dashboard's BK_SVC_KEYS.base (index.html) — the proven, live
 * Setmore register — not guessed or re-derived. If that register changes,
 * check both files.
 *
 * Same public Booking Worker the main dashboard's "Instant Booking" widget
 * and the customer-facing site both use — see .claude/skills/
 * integrating-sfcw-apis/references/setmore.md before touching this contract.
 */

const { WORKER_BASE } = require('./availability');

const BASE_SERVICE_KEYS = {
  interior: { sedan: '1e930881-298f-42c9-9b72-954e358c2e73', midsize: '78c2669c-dd76-4d11-8176-2bb1b76c1674', large: '96dfc26d-09b3-4ff6-8dc6-27592a910bd5' },
  full:     { sedan: '7d6b89a1-d180-4f95-abe6-e99189e45902', midsize: 'b2adcb24-45ae-4c83-b346-b9e22de0a652', large: 'ba8d7820-61fa-41f0-92bf-b8d2d4cd0af1' },
  exterior: { sedan: '23c701f7-b019-47a3-a9ef-9228d56ab428', midsize: 'c002e265-0bb0-4929-869f-89c1c5275fac', large: 'a492a0b0-fb43-44fa-84ea-64724d14acef' },
};

const SERVICE_LABELS = { interior: 'Interior', full: 'Full Package', exterior: 'Exterior' };
const VEHICLE_LABELS = { sedan: 'Sedan / Coupe', midsize: 'Midsize SUV / Crossover', large: 'Large SUV / Truck / Minivan' };

/**
 * Creates the appointment via the public Worker (same call the main
 * dashboard's bkBook() makes — see index.html). staffOverride is passed
 * straight through from whatever the caller (the browser) supplied; this
 * function never knows or needs the secret itself, same trust model as the
 * existing widget.
 */
async function createBooking({ axios, serviceType, vehicleClass, date, time, firstName, lastName, email, phone, address, note, total, staffOverride }) {
  const serviceKey = BASE_SERVICE_KEYS[serviceType]?.[vehicleClass];
  if (!serviceKey) return { ok: false, error: `Unknown service/vehicle combination: ${serviceType}/${vehicleClass}` };

  const payload = {
    serviceKey, addonKeys: [], addonNames: [],
    date, time, firstName, lastName, email: email || '', phone: phone || '', address: address || '',
    note: note || '', total, vehicle: VEHICLE_LABELS[vehicleClass], service: SERVICE_LABELS[serviceType],
    staffOverride: staffOverride || '',
  };

  let res;
  try {
    res = await axios.post(`${WORKER_BASE}/book`, payload, { timeout: 15000 });
  } catch (e) {
    return { ok: false, error: e.response?.data?.error || e.message };
  }
  const data = res.data;
  if (!data.success) return { ok: false, error: data.error || 'Booking failed' };
  // The Worker falls back to demo mode when its Setmore secret is missing —
  // still answers success:true with mock:true and creates nothing. Checking
  // only `success` is exactly the bug the main dashboard's own comment warns
  // about (index.html bkBook()) — do not repeat it here.
  if (data.mock) return { ok: false, error: 'Booking worker is in DEMO mode — no appointment was created (SETMORE_REFRESH_TOKEN not set on the Worker).' };

  return { ok: true, data };
}

module.exports = { createBooking, BASE_SERVICE_KEYS, SERVICE_LABELS, VEHICLE_LABELS };
