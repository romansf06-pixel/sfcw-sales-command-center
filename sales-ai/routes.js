/**
 * /api/sales/copilot/* — the AI Copilot's own API surface. Mounted from
 * server.js alongside (not instead of) the existing /api/sales router, and
 * covered by the same DASHBOARD_SECRET gate (apiGate matches any /api/* path).
 */

const express = require('express');
const crypto = require('crypto');
const { buildTools } = require('./tools');
const { runCopilotTurn } = require('./client');
const { buildDailyBrief } = require('./daily-brief');

module.exports = function copilotRoutes({ dbModule, axios, GHL_BASE, GHL_LOCATION, ghlHeaders, readData, getAI, trackUsage }) {
  const router = express.Router();
  const tools = buildTools({ dbModule, axios, GHL_BASE, GHL_LOCATION, ghlHeaders, readData });
  const repId = () => dbModule.DEFAULT_REP_ID;

  router.use((req, res, next) => {
    if (!dbModule) return res.status(503).json({ ok: false, error: 'Database unavailable' });
    next();
  });

  // Rebuilds conversation history as plain text turns for the model. This
  // deliberately does NOT replay the exact tool_use/tool_result blocks from
  // earlier turns — those are persisted separately (copilot_messages.tool_calls)
  // purely for the human-readable "why" trail in the UI. The model re-running
  // a cheap read-only tool it already called earlier is harmless and far
  // simpler than reconstructing exact API block trees across restarts.
  function historyFor(conversationId) {
    if (!conversationId) return [];
    return dbModule.getCopilotMessages(conversationId).map(m => ({ role: m.role, content: m.body }));
  }

  router.post('/chat', async (req, res) => {
    const ai = getAI();
    if (!ai) return res.status(503).json({ ok: false, error: 'ANTHROPIC_API_KEY not set' });
    const message = (req.body?.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'message required' });

    let conversationId = req.body?.conversationId || null;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      dbModule.createCopilotConversation(conversationId, repId(), message.slice(0, 80));
    } else if (!dbModule.getCopilotConversation(conversationId)) {
      return res.status(404).json({ ok: false, error: 'Conversation not found' });
    }

    const rep = dbModule.getRep();
    try {
      const result = await runCopilotTurn({
        ai, tools, history: historyFor(conversationId), userMessage: message,
        repName: rep?.name, trackUsage,
      });

      const now = Date.now();
      dbModule.addCopilotMessage({ conversation_id: conversationId, role: 'user', body: message, tool_calls: null, created_at: now });
      dbModule.addCopilotMessage({
        conversation_id: conversationId, role: 'assistant', body: result.text,
        tool_calls: JSON.stringify(result.toolCalls || []), created_at: now + 1,
      });
      dbModule.touchCopilotConversation(conversationId);

      res.json({
        ok: true, conversationId, text: result.text,
        toolCalls: result.toolCalls, navigationSuggestions: result.navigationSuggestions,
        proposedActions: result.proposedActions, usage: result.usage,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get('/conversations', (_req, res) => {
    res.json({ ok: true, conversations: dbModule.listCopilotConversations(repId()) });
  });

  router.get('/conversations/:id', (req, res) => {
    const conv = dbModule.getCopilotConversation(req.params.id);
    if (!conv) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, conversation: conv, messages: dbModule.getCopilotMessages(req.params.id) });
  });

  router.delete('/conversations/:id', (req, res) => {
    dbModule.deleteCopilotConversation(req.params.id);
    res.json({ ok: true });
  });

  router.get('/daily-brief', async (_req, res) => {
    const priorityConfig = dbModule.getSalesSettings(repId())?.priority || {};
    const ai = getAI();
    const result = await buildDailyBrief(dbModule, priorityConfig, ai);
    res.json({ ok: true, ...result });
  });

  return router;
};
