/**
 * Rules-based message-intent classifier.
 *
 * Built directly from a manual read of 36 real "needs reply" conversations in
 * the live SF City Wash GHL account (2026-09-24). That inspection found that
 * roughly half of what "inbound message > outbound message" flagged as
 * needing a reply was actually: thank-yous, iMessage tapback reactions
 * ("Loved '...'"), a vendor asking for a review swap, cold outreach spam, an
 * SMS STOP opt-out, and day-of-job logistics chatter ("I'll be right out").
 * None of those are sales opportunities.
 *
 * This does NOT replace the deterministic inbound/outbound timestamp check —
 * it runs on top of it, so the queue keeps the parts of the old system that
 * were correct (timing) and stops trusting message *direction alone* to mean
 * "sales-relevant."
 *
 * Deliberately conservative: only messages matching a HIGH-confidence
 * negative pattern get removed from Needs Reply. Anything that doesn't
 * clearly match either direction stays visible (category 'ambiguous') rather
 * than risk hiding a real lead — false negatives (a hidden real lead) are
 * worse than false positives (one extra card to glance at and dismiss).
 *
 * This is regex/keyword based, not an LLM call, on purpose: it runs over
 * every contact on every queue computation (sub-second, no API cost, no
 * latency). An LLM-based second pass could refine the 'ambiguous' bucket
 * later without changing this contract.
 */

function stripEmoji(s) {
  return String(s || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '').trim();
}

const SPAM_PHRASES = [
  'leave me a review', 'leave one for you as well', 'solo dev', 'free lifetime access',
  'love your feed', 'like comment repost', "i'll engage on your post", 'i am the owner of a',
  'built this so you can', 'built detailsafe', 'would love your feedback', 'active mobile crew',
];

const OPERATIONAL_PHRASES = [
  "i'll be right out", 'on my way', 'be there in', 'just arrived', 'walking back',
  'let me know when you get here', 'omw', 'here now', 'outside now',
];

const NURTURE_PHRASES = [
  'just for future', 'for the future', 'maybe later', 'not right now', 'not now',
  'down the road', 'next month', 'someday', "i'll let you know", 'let you know',
  'thinking about it', 'not ready yet', 'next week', // "next week" alone, with no question, reads as a deferral
];

const GRATITUDE_STARTS = ['thank', 'thanks', 'thx', 'ty', 'wow thanks', 'appreciate', 'great job', 'awesome job', 'nice work'];

const SYSTEM_MESSAGE_PHRASES = ['sorry we missed your call', 'sfcitywash.com', "here's the full process", 'here is the full process'];

const SALES_PATTERNS = {
  pricing:      /how much|pricing|\bprice\b|\bcost\b|\bquote\b|\bcharge\b|\$\s?\d|\brate\b/i,
  availability: /availab|earliest|this week|tomorrow|saturday|sunday|weekend|time slot|when (can|are|is)|what time/i,
  booking:      /\bbook\b|appointment|reserve|confirm.*time|come (by|out)|schedule/i,
  service:      /\bdetail\b|\bwash\b|\bwax\b|correction|coating|interior|exterior|vacuum|\bstain\b|pet hair|\bscratch\b|\bbuff\b|\bclean(ing)?\b|fading/i,
  vehicle:      /\b(19|20)\d{2}\b.{0,25}\b(tesla|bmw|honda|toyota|ford|chevy|mercedes|tacoma|audi|lexus|subaru|mazda|nissan|jeep|suv|sedan|truck)\b/i,
  location:     /\bi work near\b|\bi'?m in\b|\bi am in\b|located in|zip code|\bnear\b \w+/i,
  callback:     /call me|please call|call (mon|tue|wed|thu|fri|sat|sun)/i,
  objection:    /too expensive|too much|can you do (it )?(for|cheaper)|any discount|price is high/i,
};

/**
 * @param {string} raw - the message body to classify
 * @returns {{category: 'opt_out'|'no_action'|'spam'|'operational'|'nurture'|'sales_signal'|'ambiguous', confidence: 'high'|'medium'|'low', reason: string, signals?: string[]}}
 */
function classifyMessage(raw) {
  const text = String(raw || '').trim();
  if (!text) return { category: 'ambiguous', confidence: 'low', reason: 'No message text (likely an image/attachment) — verify manually' };

  const noEmoji = stripEmoji(text);
  const clean = noEmoji.toLowerCase().replace(/[.,!?;:'"]+$/, '').trim();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;
  const hasQuestion = /\?/.test(text);

  // 1. TCPA compliance — never a sales lead, must never receive another outbound message.
  if (/^(stop|unsubscribe|cancel|quit|opt.?out)$/i.test(clean)) {
    return { category: 'opt_out', confidence: 'high', reason: 'Customer sent an SMS opt-out keyword ("STOP") — do not contact again' };
  }

  // 2. iMessage/SMS tapback rendered as text ("Loved "..."") — not an actual reply.
  if (/^(loved|liked|laughed at|emphasized|disliked|questioned)\s+[""“]/i.test(text)) {
    return { category: 'no_action', confidence: 'high', reason: 'Message reaction (tapback) to an earlier text, not a new reply' };
  }

  // 3. Cold outreach / vendor solicitation — not a customer at all.
  if (SPAM_PHRASES.some(p => clean.includes(p))) {
    return { category: 'spam', confidence: 'medium', reason: 'Reads like vendor/marketing outreach, not a customer inquiry' };
  }

  // 3.5. GHL's lastMessageDirection has been observed mislabeling our OWN
  // auto-responder / content-link messages as inbound (found during the
  // 2026-09-24 manual audit — a missed-call auto-reply and a scuff-removal
  // guide link both showed up tagged "inbound"). Text content is the only
  // signal available to catch this; it's a known limitation, not a fix.
  if (SYSTEM_MESSAGE_PHRASES.some(p => clean.includes(p))) {
    return { category: 'system_message', confidence: 'medium', reason: 'Reads like our own auto-response or content link — GHL may have mislabeled the message direction' };
  }

  // 4. Pure gratitude/closing — short, no question, nothing left to act on.
  if (!hasQuestion && wordCount <= 8 && GRATITUDE_STARTS.some(p => clean.startsWith(p))) {
    return { category: 'no_action', confidence: 'high', reason: 'Thank-you / closing acknowledgment — nothing pending' };
  }

  // 5. Day-of-job logistics chatter — real, but not a sales action.
  if (!hasQuestion && OPERATIONAL_PHRASES.some(p => clean.includes(p))) {
    return { category: 'operational', confidence: 'medium', reason: 'Logistics for a job already in progress, not a new sales question' };
  }

  // 6. Explicit "not now" — real interest, wrong bucket for urgent action.
  if (!hasQuestion && NURTURE_PHRASES.some(p => clean.includes(p))) {
    return { category: 'nurture', confidence: 'medium', reason: 'Customer signaled interest later, not right now' };
  }

  // 7. Clear sales signal.
  const hitTypes = Object.entries(SALES_PATTERNS).filter(([, re]) => re.test(clean)).map(([k]) => k);
  if (hitTypes.length) {
    return { category: 'sales_signal', confidence: 'high', reason: `Mentions ${hitTypes.join(', ')}`, signals: hitTypes };
  }

  // 8. No keyword match, but it IS a question — still worth a reply.
  if (hasQuestion) return { category: 'sales_signal', confidence: 'medium', reason: 'Customer asked a question', signals: ['question'] };

  // 9. Genuinely unclear from text alone. Kept visible on purpose — see file header.
  return { category: 'ambiguous', confidence: 'low', reason: 'Short reply — intent unclear from text alone, worth a quick human look' };
}

module.exports = { classifyMessage };
