/**
 * Post-call coaching. Deliberately built around a plain `transcript` string
 * input, decoupled from how that text was produced — see db/index.js
 * call_coaching table comment. Today a rep types/pastes what was said
 * (source='manual'), because GHL's API exposes call duration/status but no
 * recording (verified live 2026-09-25 — see the conversation with the user
 * about live-listen feasibility). If a recording ever becomes available,
 * transcribe it and call this same function with source='transcribed'. A
 * future live-stream integration would call it incrementally with
 * source='live'. Nothing here needs to change for either upgrade.
 */

async function analyzeCall({ ai, transcript, lead }) {
  if (!ai) return { error: 'ANTHROPIC_API_KEY not set' };

  const context = {
    name: lead?.name, vehicle: lead?.vehicle, service: lead?.service,
    stage: lead?.stage, pipeline: lead?.pipeline, quotedPrice: lead?.quotedPrice,
    bookingStatus: lead?.booking, priorNotes: (lead?.notes || []).map(n => n.body),
  };

  const resp = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 700,
    system: `You are a sales call coach for a mobile car detailing company. You will be given a transcript or summary of a call the rep just had, plus what's known about the lead from the CRM. Respond in EXACTLY this structure, plain text, these exact labels:
What worked: [specific things the rep did well, citing the transcript]
What to improve: [specific, actionable — not generic advice]
Objections raised: [quote or paraphrase from the transcript, or "None identified"]
Suggested follow-up message: [a short text message the rep could send next, in this business's casual/direct tone, or "Not needed — appointment booked" if the call ended in a booking]
Key takeaway: [one sentence]
Only use what's actually in the transcript and CRM context below — if the transcript doesn't mention something, don't invent it. Never state a percentage or probability of closing.`,
    messages: [{ role: 'user', content: `CRM context:\n${JSON.stringify(context, null, 2)}\n\nCall transcript/summary:\n${transcript}` }],
  }, { timeout: 30_000 });

  const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  return { text, usage: resp.usage };
}

module.exports = { analyzeCall };
