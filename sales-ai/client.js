/**
 * The Copilot's tool-calling agent loop. Runs entirely server-side —
 * ANTHROPIC_API_KEY never reaches the browser (getAI() is passed in from
 * server.js, same pattern as the existing per-lead /assist endpoint).
 *
 * Every tool is read-only (see tools.js), so this loop never needs to ask
 * permission before running one — the safety boundary is "no write tools
 * exist," not "check before calling this one."
 */

const { buildSystemPrompt } = require('./prompts');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_LOOPS = 6;
const MAX_TOKENS = 1500;
const REQUEST_TIMEOUT_MS = 45_000;

function textFrom(contentBlocks) {
  return (contentBlocks || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

/**
 * @param {object} opts
 * @param {object} opts.ai - Anthropic client instance (from getAI())
 * @param {{definitions: object[], executors: Record<string, Function>}} opts.tools
 * @param {Array} opts.history - prior {role, content} messages for this conversation (Anthropic message format)
 * @param {string} opts.userMessage
 * @param {string} [opts.repName]
 * @param {Function} [opts.trackUsage] - (endpoint, usage, model) => void
 */
async function runCopilotTurn({ ai, tools, history, userMessage, repName, trackUsage }) {
  const system = buildSystemPrompt({ repName }) + `\n\nCurrent date/time: ${new Date().toISOString()}`;
  const messages = [...history, { role: 'user', content: userMessage }];
  const toolCalls = [];
  const navigationSuggestions = [];
  const proposedActions = [];
  let totalUsage = { input_tokens: 0, output_tokens: 0 };

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const resp = await ai.messages.create(
      { model: MODEL, max_tokens: MAX_TOKENS, system, tools: tools.definitions, messages },
      { timeout: REQUEST_TIMEOUT_MS }
    );
    if (resp.usage) {
      totalUsage.input_tokens += resp.usage.input_tokens || 0;
      totalUsage.output_tokens += resp.usage.output_tokens || 0;
    }

    if (resp.stop_reason !== 'tool_use') {
      if (trackUsage) trackUsage('copilot_chat', totalUsage, MODEL);
      return {
        text: textFrom(resp.content) || "I don't have a response for that.",
        toolCalls, navigationSuggestions, proposedActions,
        finalMessages: [...messages, { role: 'assistant', content: resp.content }],
        usage: totalUsage,
      };
    }

    messages.push({ role: 'assistant', content: resp.content });
    const toolResultBlocks = [];
    for (const block of resp.content) {
      if (block.type !== 'tool_use') continue;
      const executor = tools.executors[block.name];
      let result;
      try {
        result = executor ? await executor(block.input || {}) : { error: `Unknown tool: ${block.name}` };
      } catch (e) {
        result = { error: e.message };
      }
      toolCalls.push({ name: block.name, input: block.input, result });
      if (block.name === 'navigate') navigationSuggestions.push(result);
      if (block.name === 'propose_action') proposedActions.push(result);
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result ?? null).slice(0, 6000) });
    }
    messages.push({ role: 'user', content: toolResultBlocks });
  }

  if (trackUsage) trackUsage('copilot_chat', totalUsage, MODEL);
  return {
    text: "That question needed more research steps than I'm allowed to take at once — try narrowing it (e.g. ask about one lead or one bucket at a time).",
    toolCalls, navigationSuggestions, proposedActions, finalMessages: messages, usage: totalUsage,
  };
}

module.exports = { runCopilotTurn, MODEL };
