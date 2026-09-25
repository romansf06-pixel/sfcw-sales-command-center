/**
 * SF City Wash pricing reference + per-lead call script for the Lead Profile
 * "call prep" panel. Every number here is read from the business's own
 * source-of-truth files, not invented — see the comments on each table for
 * where it came from. If a price changes at the source, update it here too;
 * do not let this drift into a second, silently-stale copy.
 *
 * Sources (verified 2026-09-25):
 *   Base packages + add-ons  → 02-Website-HTML-Builders/SFCW-Website/HTMLS/Miscellaneous/sfcwBOOKING.html
 *                               CONFIG.basePrices / CONFIG.addonPricing / CONFIG.vehicleTypes
 *   Ceramic coating matrix   → 02-Website-HTML-Builders/SFCW-Website/data/ceramic-pricing.json
 *   Travel fee zones         → 02-Website-HTML-Builders/SFCW-Website/docs/BUSINESS-MEMORY.md
 * Headlight restoration is $50/headlight (owner-confirmed 2026-08-19) — NOT
 * the older $60 figure that used to float around marketing copy.
 */

export const VEHICLE_CLASSES = [
  { id: 'sedan', label: 'Sedan / Coupe', hint: 'Compact cars, sports cars, standard sedans.' },
  { id: 'midsize', label: 'Midsize SUV / Crossover', hint: 'Crossovers, midsize SUVs, standard hatchbacks.' },
  { id: 'large', label: 'Large SUV / Truck / Minivan', hint: 'Full-size SUVs, pickup trucks, vans, minivans.' },
];

export const BASE_PACKAGES = [
  { label: 'Interior Detail', sedan: 229, midsize: 250, large: 300 },
  { label: 'Full Package (interior + exterior)', sedan: 279, midsize: 300, large: 350 },
  { label: 'Exterior Wash & Protection', sedan: 100, midsize: 125, large: 150 },
];

export const ADDONS = [
  { label: 'Pet Hair Removal', sedan: 75, midsize: 100, large: 100 },
  { label: 'Seat Extraction', sedan: 25, midsize: 25, large: 25, unit: 'per seat, cap $125 sedan/midsize · $175 large' },
  { label: 'Carpet Extraction', sedan: 25, midsize: 25, large: 25, unit: 'per area, cap $125 sedan/midsize · $175 large' },
  { label: 'Odor Treatment', sedan: 50, midsize: 50, large: 50 },
  { label: 'Leather Cleaning & Protection', sedan: 45, midsize: 45, large: 65 },
  { label: 'Interior Protection', sedan: 35, midsize: 50, large: 60 },
  { label: 'Exterior Wash & Wax (add-on)', sedan: 50, midsize: 50, large: 50 },
  { label: 'Iron Decontamination', sedan: 75, midsize: 100, large: 125 },
  { label: 'Clay Bar Treatment', sedan: 50, midsize: 75, large: 100 },
  { label: 'Bug / Tar / Sap Removal', sedan: 50, midsize: 50, large: 50 },
  { label: '2-Yr Black Trim Restoration', sedan: 75, midsize: 75, large: 100 },
  { label: 'Engine Bay Detailing', sedan: 75, midsize: 75, large: 75 },
  { label: 'Headlight Restoration', sedan: 50, midsize: 50, large: 50, unit: 'per headlight, max 2' },
];

export const TRAVEL_FEES = [
  { zone: 'SF + Daly City, Westlake, Pacifica, Colma, South SF, San Bruno, Brisbane', fee: 'No fee', booking: 'Book Now' },
  { zone: 'North Bay / South Peninsula / Coastside', fee: '+5% of base', booking: 'Quote only' },
  { zone: 'East Bay / South East Bay', fee: '+10% of base', booking: 'Quote only' },
];

// Ceramic: every package already includes the full interior + exterior
// detail and paint decontamination. Correction is never sold standalone —
// it's always bundled with at least the 12-Month Sealant.
export const CERAMIC_CORRECTION_LEVELS = ['none', '1-step', '2-step', '3-step'];
export const CERAMIC_PACKAGES = [
  { label: '12-Month Sealant', prices: { none: { sedan: 399, midsize: 499, large: 599 }, '1-step': { sedan: 649, midsize: 799, large: 999 }, '2-step': { sedan: 899, midsize: 1149, large: 1349 }, '3-step': { sedan: 1149, midsize: 1449, large: 1749 } } },
  { label: '2-Year Sealant', prices: { none: { sedan: 549, midsize: 649, large: 749 }, '1-step': { sedan: 799, midsize: 949, large: 1149 }, '2-step': { sedan: 1049, midsize: 1299, large: 1499 }, '3-step': { sedan: 1299, midsize: 1599, large: 1899 } } },
  { label: '5-Year Coating', prices: { none: { sedan: 649, midsize: 749, large: 849 }, '1-step': { sedan: 899, midsize: 1049, large: 1249 }, '2-step': { sedan: 1149, midsize: 1399, large: 1599 }, '3-step': { sedan: 1399, midsize: 1699, large: 1999 } } },
  { label: '5-Year Plus', prices: { none: { sedan: 849, midsize: 949, large: 1049 }, '1-step': { sedan: 1099, midsize: 1249, large: 1449 }, '2-step': { sedan: 1349, midsize: 1599, large: 1799 }, '3-step': { sedan: 1599, midsize: 1899, large: 2199 } } },
];

const money = n => `$${n}`;

// Best-effort vehicle → class guess, used only to highlight a column so a
// rep who doesn't know cars can find the right price fast. This is a guess,
// never an authoritative fact — it's shown as "auto-detected, verify" and
// the full table with all three classes is always visible either way, so a
// wrong guess costs a glance, not a misquote. Keywords are distinctive model
// names/bodies, matched as substrings (handles concatenated CRM text like
// "PriusV"), checked large → midsize → sedan.
const CLASS_KEYWORDS = {
  large: [
    'suburban', 'tahoe', 'yukon', 'escalade', 'expedition', 'navigator', 'sequoia', 'armada',
    'wagoneer', 'f-150', 'f150', 'f-250', 'f250', 'silverado', 'sierra', 'ram 1500', 'ram1500',
    'ram 2500', 'tundra', 'titan', 'sprinter', 'transit', 'promaster', 'odyssey', 'sienna',
    'pacifica', '4runner', 'tacoma', 'ranger', 'colorado', 'canyon', 'gladiator', 'defender',
    'land cruiser', 'gx460', 'gx550', 'lx570', 'lx600', 'qx80', 'minivan', 'pickup',
  ],
  midsize: [
    'cr-v', 'crv', 'rav4', 'rav-4', 'rav 4', 'escape', 'equinox', 'rogue', 'tucson', 'sportage',
    'cx-5', 'cx5', 'cx-50', 'forester', 'outback', 'model y', 'tiguan', 'q5', 'x3', 'glc', 'rdx',
    'edge', 'murano', 'santa fe', 'highlander', 'pilot', 'explorer', 'telluride', 'palisade',
    'wrangler', 'grand cherokee', 'crosstrek', 'hr-v', 'hrv', 'trailblazer', 'bronco sport',
    'venza', 'ascent', 'atlas', 'xc60', 'xc90', 'crossover', 'suv',
  ],
  sedan: [
    'civic', 'corolla', 'camry', 'accord', 'altima', 'sentra', 'elantra', 'sonata', 'jetta',
    'passat', 'prius', 'model 3', 'model s', 'mazda3', 'mazda 3', 'mazda6', 'impreza', 'wrx',
    'focus', 'fusion', 'malibu', 'cruze', 'forte', 'optima', 'a3', 'a4', 'a6', 'c-class',
    '3 series', '5 series', 'integra', 'mustang', 'camaro', 'challenger', 'brz', 'miata', 'mx-5',
    'g35', 'g37', 'veloster', 'bolt', 'leaf', 'legacy', 'sedan', 'coupe',
  ],
};

export function guessVehicleClass(lead) {
  const raw = [lead?.vehicleMake, lead?.vehicleModel, lead?.vehicle].filter(Boolean).join(' ').toLowerCase();
  if (!raw.trim()) return null;
  for (const id of ['large', 'midsize', 'sedan']) {
    const hit = CLASS_KEYWORDS[id].find(kw => raw.includes(kw));
    if (hit) return { id, label: VEHICLE_CLASSES.find(v => v.id === id).label, matched: hit };
  }
  return null;
}

function classCols(highlightId) {
  return VEHICLE_CLASSES.map(v => `<th${v.id === highlightId ? ' class="px-hl"' : ''}>${v.label.split(' / ')[0]}</th>`).join('');
}

function priceCells(row, highlightId) {
  return VEHICLE_CLASSES.map(v => `<td${v.id === highlightId ? ' class="px-hl"' : ''}>${money(row[v.id])}</td>`).join('');
}

export function renderPricingCard(lead) {
  const guess = guessVehicleClass(lead || {});
  const rawVehicle = escapeHtmlLocal([lead?.vehicleYear, lead?.vehicleMake, lead?.vehicleModel].filter(Boolean).join(' ') || lead?.vehicle || '');

  return `
    <div class="card">
      <div class="card-title">Pricing Reference</div>
      <div class="lead-meta" style="margin-bottom:10px;">SF City Wash's real base prices and add-ons — say an exact number tied to the exact package, never a range.</div>

      ${guess
        ? `<div style="font-size:12px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:8px 10px;margin-bottom:12px;">
             Vehicle class detected: <b style="color:var(--green);">${guess.label}</b> from “${rawVehicle}” — highlighted below. <span style="color:var(--muted);">Not good with cars? Double-check against the classes list before quoting.</span>
           </div>`
        : `<div style="font-size:12px;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:12px;color:var(--text-dim);">
             Couldn't auto-detect a vehicle class from “${rawVehicle || 'the record on file'}” — pick manually from the classes below.
           </div>`}

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Vehicle Classes</div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">
        ${VEHICLE_CLASSES.map(v => `<div style="margin-bottom:2px;${v.id === guess?.id ? 'color:var(--green);' : ''}"><b style="color:${v.id === guess?.id ? 'var(--green)' : 'var(--text)'};">${v.label}${v.id === guess?.id ? ' ✓' : ''}</b> — ${v.hint}</div>`).join('')}
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Base Packages</div>
      <div class="table-wrap" style="margin-bottom:14px;">
        <table class="leads" style="min-width:0;">
          <thead><tr><th>Package</th>${classCols(guess?.id)}</tr></thead>
          <tbody>
            ${BASE_PACKAGES.map(p => `<tr><td>${p.label}</td>${priceCells(p, guess?.id)}</tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Add-Ons</div>
      <div class="table-wrap" style="margin-bottom:14px;">
        <table class="leads" style="min-width:0;">
          <thead><tr><th>Add-on</th>${classCols(guess?.id)}</tr></thead>
          <tbody>
            ${ADDONS.map(a => `<tr><td>${a.label}${a.unit ? `<div style="color:var(--muted);font-size:10px;">${a.unit}</div>` : ''}</td>${priceCells(a, guess?.id)}</tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">Travel Fees</div>
      <div style="font-size:11.5px;color:var(--text-dim);margin-bottom:14px;">
        ${TRAVEL_FEES.map(t => `<div style="margin-bottom:3px;"><b style="color:var(--text);">${t.fee}</b> — ${t.zone} <span style="color:var(--muted);">(${t.booking})</span></div>`).join('')}
      </div>

      <details>
        <summary style="cursor:pointer;font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;">Ceramic Coating (full matrix)</summary>
        <div class="lead-meta" style="margin:8px 0;">Every ceramic package already includes the full detail + paint decontamination. Correction is never sold standalone — always bundled with at least the 12-Month Sealant.</div>
        ${VEHICLE_CLASSES.map(vc => `
          <div style="font-size:11px;font-weight:700;margin:10px 0 4px;${vc.id === guess?.id ? 'color:var(--green);' : ''}">${vc.label}${vc.id === guess?.id ? ' ✓ this vehicle' : ''}</div>
          <div class="table-wrap" style="margin-bottom:8px;">
            <table class="leads" style="min-width:0;">
              <thead><tr><th>Package</th>${CERAMIC_CORRECTION_LEVELS.map(c => `<th>${c === 'none' ? 'No correction' : c}</th>`).join('')}</tr></thead>
              <tbody>
                ${CERAMIC_PACKAGES.map(p => `<tr><td>${p.label}</td>${CERAMIC_CORRECTION_LEVELS.map(c => `<td${vc.id === guess?.id ? ' class="px-hl"' : ''}>${money(p.prices[c][vc.id])}</td>`).join('')}</tr>`).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
      </details>
    </div>
  `;
}

// Tiny local escaper so this module doesn't have to import the app's shared
// one just for a couple of read-only strings inside table captions.
function escapeHtmlLocal(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function scriptBeat(label, text) {
  return `<div class="script-quote"><span class="label">${label}</span>${text}</div>`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// Builds a script from what's actually on file for this lead — no invented
// price, no invented vehicle class. Where the CRM doesn't have an answer
// (e.g. no quoted price yet), the script tells the rep to read it off the
// Pricing Reference card above rather than guessing one.
export function buildCallScript(lead, escapeHtml) {
  const name = escapeHtml(lead.firstName || lead.name || 'there');
  const vehicle = escapeHtml([lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ') || lead.vehicle || 'their vehicle');
  const service = escapeHtml(lead.service || lead.serviceCategory || 'the detail they asked about');
  const beats = [];

  if (lead.booking && lead.booking.source !== 'none' && lead.booking.timing === 'upcoming') {
    beats.push(scriptBeat('Opener — confirming a booked job', `Hey ${name}, this is [Rep] with SF City Wash, just confirming your ${service} for the ${vehicle} on ${escapeHtml(lead.booking.date || 'the scheduled date')}${lead.booking.time ? ' at ' + escapeHtml(lead.booking.time) : ''}. Still good on your end?`));
  } else if (lead.quotedPrice) {
    beats.push(scriptBeat('Opener — following up on a quote', `Hey ${name}, following up on the $${lead.quotedPrice} quote for the ${vehicle} ${service} — did that work for you, or was there something specific holding it up? Easy to adjust the package if needed.`));
  } else {
    beats.push(scriptBeat('Opener — first contact', `Hey ${name}, this is [Rep] with SF City Wash. I just received your detail quote request for your ${vehicle}. Are you available for a quick call today or tomorrow to go over the best option? If text is easier, happy to just go through pricing and availability here.`));
  }

  if (lead.lastMessage) {
    beats.push(scriptBeat(`What they last said (${lead.lastMessageDirection === 'inbound' ? 'from them' : 'from us'}, ${timeAgo(lead.lastMessageAt)})`, escapeHtml(lead.lastMessage.slice(0, 240))));
  }

  if (lead.ghlNotes) {
    beats.push(scriptBeat('Note on file', escapeHtml(lead.ghlNotes)));
  }

  if (lead.openFollowup?.reason) {
    beats.push(scriptBeat('Follow-up reason logged', escapeHtml(lead.openFollowup.reason)));
  }

  if (lead.quotedPrice) {
    beats.push(scriptBeat('Price', `Already quoted at $${lead.quotedPrice}. Restate it plainly if asked — don't re-negotiate down on request; redirect a discount ask to the maintenance plan instead.`));
  } else {
    beats.push(scriptBeat('Price', `Nothing quoted yet. Identify the vehicle class (sedan / midsize / large) against the Pricing Reference above and give one exact dollar figure for the package they asked about — never a range. Ask one qualifying question in the same breath (pet hair, mold, anything specific).`));
  }

  beats.push(scriptBeat('If they push back on water/power access', `No worries at all — we come equipped with our own power and water source, so that shouldn't be a problem.`));
  beats.push(scriptBeat('If they ask for a discount', `We aren't running any promotions right now, but I can get you on our maintenance plan for cheaper details monthly while keeping your car upkept.`));
  beats.push(scriptBeat('Close', `Match ${name}'s tone from the conversation above — short answers get short answers, detailed questions get detailed answers. Ask for a specific date/time rather than leaving it open-ended.`));

  return beats.join('');
}

// ── Upsell & recommendation playbook ────────────────────────────────────────
// Provided directly by the team's senior sales rep (2026-09-25) — real
// operational know-how, not pulled from a GHL transcript. Kept separate from
// the "Real close" tags used elsewhere in this app for verbatim customer
// threads, since this is technique/judgment rather than a quoted message.
// Duplicated conceptually in sales-ai/company-knowledge.js (getSalesPlaybook)
// so the AI Copilot can draw on the same rules server-side — if one changes,
// check the other.
const LUXURY_GERMAN_MAKES = ['bmw', 'mercedes', 'mercedes-benz', 'audi', 'volvo', 'porsche'];
const EMBEDDED_RISK_MAKES = ['toyota', 'honda', 'tesla'];

function vehicleYearOf(lead) {
  const y = parseInt(lead?.vehicleYear, 10);
  if (y) return y;
  const m = String(lead?.vehicle || '').match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

// Real CRM data often has vehicleMake/vehicleModel blank with only the
// free-text `vehicle` field populated (e.g. "2017 Toyota PriusV") — fall
// back to matching brand keywords in that string so the interior-difficulty
// callout still fires. Returns the matched brand word, not the raw field,
// since vehicleMake may be null in the fallback case.
function makeOf(lead) {
  const text = ((lead?.vehicleMake || '') + ' ' + (lead?.vehicle || '')).toLowerCase();
  return text.trim();
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function buildUpsellNotes(lead, escapeHtml) {
  const beats = [];
  const year = vehicleYearOf(lead);
  const make = makeOf(lead);

  if (year) {
    if (year >= 2025) {
      beats.push(scriptBeat('New-car protection ask', `This is a ${year} — a brand-new vehicle. Ask if they're interested in long-term paint protection (ceramic coating) while the paint is still pristine.`));
    } else if (year >= 2024) {
      beats.push(scriptBeat('Correction guidance', `${year} — newer vehicle, no paint correction typically needed.`));
    } else if (year >= 2017) {
      beats.push(scriptBeat('Correction guidance', `${year} — ask about paint condition on the call. If swirls or marring are visible, recommend a 1-step correction alongside any ceramic package.`));
    } else {
      beats.push(scriptBeat('Correction guidance', `${year} — older vehicle. Ask about buildup in cupholders and carpets; if they describe it as dirtier than average, a +$75 condition add-on may apply.`));
    }
  }

  const luxuryHit = LUXURY_GERMAN_MAKES.find(k => make.includes(k));
  const embeddedHit = EMBEDDED_RISK_MAKES.find(k => make.includes(k));
  if (luxuryHit) {
    beats.push(scriptBeat('Interior expectation', `${escapeHtml(cap(luxuryHit))} — these typically clean easier; carpets usually aren't heavily embedded.`));
  } else if (embeddedHit) {
    beats.push(scriptBeat('Interior expectation', `${escapeHtml(cap(embeddedHit))} — these often run embedded carpet contaminants. Use "embedded" when describing leftover residue rather than promising 100% removal.`));
  }

  beats.push(scriptBeat('Stain tiers', `Minor stains on a seat or two — included in the standard detail. Stains across every seat / a larger area — steam treatment, +$50. Heavy spills or large staining — recommend Seat Extraction instead.`));
  beats.push(scriptBeat('Pet hair / sand', `Only recommend the add-on if they specifically want 100% removal — the standard process clears the majority on its own. Describe anything left over as "embedded," not a promise of full removal.`));
  beats.push(scriptBeat('Ceramic tier default', `2-Year Sealant is the most popular, default recommendation. 12-Month suits someone only a little interested who wants to see the difference without committing. Recommend a correction step with 2-Year/5-Year on older or visibly swirled paint.`));
  beats.push(scriptBeat('Quoting strategy', `Default to the Full Package (most popular) — covers everything except pet hair, large stains, or heavier grime buildup. All exterior/full packages already include a 6-month wax sealant. If the paint feels rough to the touch, recommend a Clay Bar Treatment. Most add-on upsells close easier in person, once they can see the car.`));
  beats.push(scriptBeat('Booking questions', `Point them to sfcitywash.com/express-booking for how the booking workflow works.`));

  return beats.join('');
}
