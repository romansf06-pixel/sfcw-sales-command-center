/**
 * Daily Sales Brief — every number is computed deterministically FIRST from
 * real queue/stats data. The AI, when available, only rephrases those exact
 * numbers into a short natural-language brief; it is never the source of a
 * number. Without ANTHROPIC_API_KEY (or on any API error), the template
 * below is returned as-is — the brief still works, just without the nicer
 * prose, per "the app must keep functioning if the AI fails."
 */

const { computeQueue } = require('../sales-api/priority');

function buildBriefData(dbModule, priorityConfig) {
  const q = computeQueue(dbModule, priorityConfig);
  const c = q.counts;
  const needsReplyHot = q.buckets.needs_reply.filter(l => l.intentTag === 'hot').length;
  const overdueFollowups = q.buckets.followup_due.length;
  const focus = [];
  if (c.needs_reply) focus.push(`Clear ${c.needs_reply} waiting message${c.needs_reply === 1 ? '' : 's'}${needsReplyHot ? ` (${needsReplyHot} look urgent)` : ''}.`);
  if (c.new_lead) focus.push(`Make first contact with ${c.new_lead} never-contacted lead${c.new_lead === 1 ? '' : 's'}.`);
  if (c.ready_to_book) focus.push(`Push ${c.ready_to_book} high-intent-stage lead${c.ready_to_book === 1 ? '' : 's'} toward booking.`);
  if (overdueFollowups) focus.push(`Complete ${overdueFollowups} overdue follow-up${overdueFollowups === 1 ? '' : 's'}.`);
  if (c.awaiting_reply) focus.push(`${c.awaiting_reply} lead${c.awaiting_reply === 1 ? '' : 's'} we already reached out to, still waiting on them.`);
  if (c.maintenance_due) focus.push(`${c.maintenance_due} maintenance client${c.maintenance_due === 1 ? '' : 's'} due soon.`);
  if (c.reactivation) focus.push(`${c.reactivation} past customer${c.reactivation === 1 ? '' : 's'} worth reactivating.`);

  return {
    counts: c,
    needsReplyHot,
    complianceFlags: q.complianceFlags.length,
    nextBestAction: q.nextBestAction,
    focus,
    generatedAt: q.generatedAt,
  };
}

function templateBrief(data) {
  const total = Object.entries(data.counts).filter(([k]) => k !== 'no_action_needed' && k !== 'low_priority_source').reduce((s, [, v]) => s + v, 0);
  const lines = [`${total} leads currently need attention.`];
  if (data.complianceFlags) lines.push(`⚠ ${data.complianceFlags} opt-out(s) waiting on compliance confirmation.`);
  if (data.focus.length) {
    lines.push('Recommended focus:');
    data.focus.slice(0, 5).forEach((f, i) => lines.push(`${i + 1}. ${f}`));
  } else {
    lines.push('Queue is quiet — nothing urgent right now.');
  }
  return lines.join('\n');
}

async function buildDailyBrief(dbModule, priorityConfig, ai) {
  const data = buildBriefData(dbModule, priorityConfig);
  const template = templateBrief(data);
  if (!ai) return { text: template, source: 'template', data };

  try {
    const resp = await ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: 'You write a short "good morning" sales brief for a mobile detailing sales rep. Use ONLY the numbers given below — never state a number that is not present in the data. Keep it under 80 words, direct, no corporate tone. End with a numbered "Recommended focus" list drawn only from the provided focus items, in the given order.',
      messages: [{ role: 'user', content: `Data:\n${JSON.stringify(data, null, 2)}\n\nWrite the brief.` }],
    }, { timeout: 20_000 });
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    return { text: text || template, source: text ? 'ai' : 'template', data };
  } catch (e) {
    return { text: template, source: 'template', data, error: e.message };
  }
}

module.exports = { buildDailyBrief, buildBriefData, templateBrief };
