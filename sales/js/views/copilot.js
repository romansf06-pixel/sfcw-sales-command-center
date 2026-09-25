import { api } from '../api.js';
import { escapeHtml, toast } from '../util.js';
import { navigate } from '../main.js';
import { openFollowupModal } from '../components/modal.js';

const SUGGESTIONS = [
  'Who should I call right now?',
  'Give me my 10 best leads to call.',
  'Who replied and is waiting on us?',
  'Who was quoted but never booked?',
  'Show me customers worth reactivating.',
  'Which lead sources have been converting best?',
];

let state = { conversationId: null, messages: [], sending: false };

function renderMessage(m, i) {
  const bubble = `<div class="copilot-bubble">${escapeHtml(m.body)}</div>`;
  let extra = '';
  if (m.role === 'assistant' && m.tool_calls?.length) {
    const rows = m.tool_calls.map(t => `<div>› <b>${escapeHtml(t.name)}</b>(${escapeHtml(JSON.stringify(t.input || {}))})</div>`).join('');
    extra += `
      <div class="copilot-tools" data-toggle-tools="${i}">🔧 ${m.tool_calls.length} tool call${m.tool_calls.length === 1 ? '' : 's'} — click to see what was checked</div>
      <div class="copilot-tools-detail" id="tools-${i}">${rows}</div>`;
    const navs = m.tool_calls.filter(t => t.name === 'navigate').map(t => t.result);
    if (navs.length) extra += `<div class="copilot-nav-actions">${navs.map(n => `<button class="btn primary" data-nav-route="${escapeHtml(n.route)}">${escapeHtml(n.label)}</button>`).join('')}</div>`;
    const props = m.tool_calls.filter(t => t.name === 'propose_action').map(t => t.result);
    if (props.length) extra += `<div class="copilot-proposed">${props.map((p, pi) => `<button class="btn" data-propose="${i}-${pi}">✓ Confirm: ${escapeHtml(p.type)} for ${escapeHtml(p.contactId)}</button>`).join('')}</div>`;
  }
  return `<div class="copilot-msg ${m.role}">${bubble}${extra}</div>`;
}

export async function mount(root) {
  state = { conversationId: null, messages: [], sending: false };
  root.innerHTML = `<div class="spinner">Loading Copilot…</div>`;

  let conversations = [];
  try { conversations = (await api.copilotConversations()).conversations; } catch { /* fine — sidebar just starts empty */ }

  render(root, conversations);

  // Deep-link from a Lead Profile's "Ask Copilot" button — see lead-profile.js.
  const seed = sessionStorage.getItem('copilotSeed');
  if (seed) { sessionStorage.removeItem('copilotSeed'); send(root, seed); }
}

function render(root, conversations) {
  root.innerHTML = `
    <div class="page-hdr"><div class="page-title">AI Copilot</div><div class="page-sub">Grounded in live CRM data — every answer either comes from a tool call or says what's missing.</div></div>
    <div class="copilot-layout">
      <div class="copilot-sidebar">
        <button class="btn primary" id="cp-new" style="width:100%;margin-bottom:8px;">+ New Chat</button>
        ${conversations.map(c => `<div class="copilot-conv-item${c.id === state.conversationId ? ' active' : ''}" data-conv="${c.id}">${escapeHtml(c.title || 'Untitled')}</div>`).join('') || '<div class="empty-state" style="font-size:11px;">No chats yet.</div>'}
      </div>
      <div class="copilot-chat-col">
        <div class="copilot-messages" id="cp-messages">
          ${state.messages.length ? state.messages.map(renderMessage).join('') : `<div class="empty-state">Ask about your queue, a specific lead, or what to do next.</div>`}
        </div>
        ${!state.messages.length ? `<div class="copilot-suggestions">${SUGGESTIONS.map(s => `<button class="btn ghost" data-suggest="${escapeHtml(s)}" style="font-size:11px;">${escapeHtml(s)}</button>`).join('')}</div>` : ''}
        <div class="copilot-input-row">
          <textarea id="cp-input" placeholder="Ask the copilot… (Enter to send, Shift+Enter for a new line)"></textarea>
          <button class="btn primary" id="cp-send">Send</button>
        </div>
      </div>
    </div>
  `;

  root.querySelector('#cp-new').addEventListener('click', () => { state = { conversationId: null, messages: [], sending: false }; render(root, conversations); });
  root.querySelectorAll('[data-conv]').forEach(el => el.addEventListener('click', () => openConversation(root, el.dataset.conv, conversations)));
  root.querySelectorAll('[data-suggest]').forEach(el => el.addEventListener('click', () => send(root, el.dataset.suggest)));

  const input = root.querySelector('#cp-input');
  const doSend = () => { const v = input.value.trim(); if (v) { input.value = ''; send(root, v); } };
  root.querySelector('#cp-send').addEventListener('click', doSend);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });

  wireMessageActions(root);
  scrollToBottom(root);
}

function wireMessageActions(root) {
  root.querySelectorAll('[data-toggle-tools]').forEach(el => el.addEventListener('click', () => {
    root.querySelector(`#tools-${el.dataset.toggleTools}`)?.classList.toggle('open');
  }));
  root.querySelectorAll('[data-nav-route]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.navRoute)));
  root.querySelectorAll('[data-propose]').forEach(el => el.addEventListener('click', async () => {
    const [msgIdx, propIdx] = el.dataset.propose.split('-').map(Number);
    const prop = state.messages[msgIdx]?.tool_calls?.filter(t => t.name === 'propose_action')[propIdx]?.result;
    if (!prop) return;
    try {
      if (prop.type === 'create_followup') {
        openFollowupModal(prop.contactId, () => toast('Follow-up created'));
      } else if (prop.type === 'add_note') {
        await api.addNote(prop.contactId, prop.details?.body || prop.reason);
        toast('Note added');
      } else if (prop.type === 'change_disposition') {
        await api.addDisposition(prop.contactId, prop.details?.disposition, prop.details?.note);
        toast('Disposition logged');
      }
    } catch (e) { toast(e.message); }
  }));
}

async function openConversation(root, id, conversations) {
  try {
    const { messages } = await api.copilotConversation(id);
    state = { conversationId: id, messages, sending: false };
    render(root, conversations);
  } catch (e) { toast(e.message); }
}

async function send(root, message) {
  if (state.sending) return;
  state.sending = true;
  state.messages.push({ role: 'user', body: message, tool_calls: [] });
  renderMessagesOnly(root);
  try {
    const r = await api.copilotChat(message, state.conversationId);
    state.conversationId = r.conversationId;
    state.messages.push({ role: 'assistant', body: r.text, tool_calls: r.toolCalls || [] });
  } catch (e) {
    state.messages.push({ role: 'assistant', body: `Error: ${e.message}`, tool_calls: [] });
  }
  state.sending = false;
  renderMessagesOnly(root);
  try { const conversations = (await api.copilotConversations()).conversations; const sidebar = root.querySelector('.copilot-sidebar'); if (sidebar) render(root, conversations); } catch { /* non-fatal */ }
}

function renderMessagesOnly(root) {
  const el = root.querySelector('#cp-messages');
  if (!el) return;
  el.innerHTML = state.messages.length ? state.messages.map(renderMessage).join('') : '';
  wireMessageActions(root);
  scrollToBottom(root);
}

function scrollToBottom(root) {
  const el = root.querySelector('#cp-messages');
  if (el) el.scrollTop = el.scrollHeight;
}
