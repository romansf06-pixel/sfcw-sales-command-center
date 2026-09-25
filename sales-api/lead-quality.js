/**
 * Tag-based lead-quality classifier.
 *
 * Built from a live read of every distinct tag in the GHL account
 * (2026-09-24). Two concrete cases drove this: "Tia" — tagged "process
 * commenter" — is a Facebook comment who got auto-enrolled in a CTA follow-up
 * flow, not a detailing inquiry. "hq media" — tagged "spam likely" by GHL's
 * own automation — is a vendor cold-calling the business line, not a
 * customer. Message-text classification (intent.js) can't catch either of
 * these reliably; the tag already knows.
 *
 * ~350 of the account's ~2,934 contacts (12%) carry a "process commenter" /
 * "ig - process requested" / "headlight restoration commenter" tag — real
 * volume, not an edge case.
 */

const EXCLUDE_TAGS = new Set(['spam likely', 'webhook-test', 'delete-me']);
const SOCIAL_ENGAGEMENT_TAGS = new Set([
  'process commenter', 'ig - process requested', 'headlight restoration commenter', 'ig - detailing redirect sent',
]);
const REVIEW_TAGS = new Set(['review requested']);
const ALREADY_BOOKED_TAGS = new Set(['setmore-booking']);
const WEBSITE_TAGS = new Set(['website-form']);
const IMPORTED_LIST_TAGS = new Set(['spreadsheet-lead']);

/**
 * @param {string[]} tags
 * @returns {{category: 'excluded'|'social_engagement'|'no_action'|'booked'|'website_lead'|'normal', reason: string|null}}
 */
function classifyContactQuality(tags) {
  const t = (tags || []).map(x => String(x).toLowerCase());
  const hit = (set) => t.find(x => set.has(x));

  let m = hit(EXCLUDE_TAGS);
  if (m) return { category: 'excluded', reason: `Tagged "${m}"` };

  m = hit(SOCIAL_ENGAGEMENT_TAGS);
  if (m) return { category: 'social_engagement', reason: `Facebook/Instagram comment-automation contact, not a direct inquiry (tagged "${m}")` };

  m = hit(REVIEW_TAGS);
  if (m) return { category: 'no_action', reason: 'Review-request contact, not a new sales lead' };

  m = hit(ALREADY_BOOKED_TAGS);
  if (m) return { category: 'booked', reason: 'Tagged "setmore-booking" — already has a booking on file' };

  m = hit(WEBSITE_TAGS);
  if (m) return { category: 'website_lead', reason: 'Real website form submission' };

  m = hit(IMPORTED_LIST_TAGS);
  if (m) return { category: 'imported_list', reason: `Bulk-imported contact list, not an organic inbound lead (tagged "${m}")` };

  return { category: 'normal', reason: null };
}

// Substring match on pipeline name, not an exact list — pipelines get
// renamed/added (this account has 8, growing), so pattern matching survives
// that better than a hardcoded id map ever did (see server.js PIPELINE_MAP
// history: it silently missed 2 of 8 real pipelines before 2026-09-24).
function isDeprioritizedPipeline(pipelineName, patterns) {
  if (!pipelineName) return false;
  const n = pipelineName.toLowerCase();
  return patterns.some(p => n.includes(p));
}

function isHighIntentStage(stageName, patterns) {
  if (!stageName) return false;
  const n = stageName.toLowerCase();
  return patterns.some(p => n.includes(p));
}

function isTerminalStage(stageName, patterns) {
  if (!stageName) return false;
  const n = stageName.toLowerCase();
  return patterns.some(p => n.includes(p));
}

module.exports = { classifyContactQuality, isDeprioritizedPipeline, isHighIntentStage, isTerminalStage };
