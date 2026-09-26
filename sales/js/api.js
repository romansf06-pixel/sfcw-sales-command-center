// Reuses the exact same localStorage key + ?key= convention as the main
// dashboard (index.html) so unlocking one unlocks the other. See server.js
// apiGate() — DASHBOARD_SECRET gates every /api/* route, sales included.
const KEY_STORE = 'sfcw_dashboard_key';

(function bootstrapKey() {
  const u = new URL(window.location.href);
  const fromUrl = u.searchParams.get('key');
  if (fromUrl) {
    try { localStorage.setItem(KEY_STORE, fromUrl); } catch {}
    u.searchParams.delete('key');
    window.history.replaceState({}, '', u.pathname + u.search + u.hash);
  }
})();

function getKey() {
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}

function setKey(k) {
  try { localStorage.setItem(KEY_STORE, k); } catch {}
}

// "Who's using this browser" — a no-password identity picker, not real auth
// (the dashboard key above is the only real access control). Lets
// dispositions/notes/call-coaching attribute to the right person for
// Analytics. See sales-api/routes.js's repId() for how the header resolves.
const REP_STORE = 'sfcw_sales_rep';

function getRepName() {
  try { return localStorage.getItem(REP_STORE) || ''; } catch { return ''; }
}

function setRepName(name) {
  try { localStorage.setItem(REP_STORE, name); } catch {}
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const k = getKey();
  if (k) headers.set('x-dashboard-key', k);
  const rep = getRepName();
  if (rep) headers.set('x-sales-rep', rep);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) { onUnauthorized(); throw new Error('Unauthorized — dashboard key missing or wrong'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function get(path, params) {
  const qs = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null)) : '';
  return request(path + qs);
}
function post(path, body) { return request(path, { method: 'POST', body: JSON.stringify(body || {}) }); }
function del(path) { return request(path, { method: 'DELETE' }); }

export const api = {
  setKey, getKey, setRepName, getRepName,
  rep:            () => get('/api/sales/rep'),
  queue:          () => get('/api/sales/queue'),
  syncNow:        () => post('/api/sales/sync-now'),
  leads:          (params) => get('/api/sales/leads', params),
  lead:           (id) => get(`/api/sales/leads/${id}`),
  timeline:       (id) => get(`/api/sales/leads/${id}/timeline`),
  availability:   (id) => get(`/api/sales/leads/${id}/availability`),
  conversation:   (id) => get(`/api/sales/leads/${id}/conversations`),
  sendMessage:    (id, message) => post(`/api/sales/leads/${id}/send-message`, { message }),
  addNote:        (id, body) => post(`/api/sales/leads/${id}/notes`, { body }),
  addFollowup:    (id, dueAt, reason, note) => post(`/api/sales/leads/${id}/followups`, { dueAt, reason, note }),
  followups:      (status) => get('/api/sales/followups', { status }),
  completeFollowup: (id) => post(`/api/sales/followups/${id}/complete`),
  cancelFollowup: (id) => post(`/api/sales/followups/${id}/cancel`),
  addDisposition: (id, disposition, note) => post(`/api/sales/leads/${id}/dispositions`, { disposition, note }),
  snooze:         (id, untilMs) => post(`/api/sales/leads/${id}/snooze`, { untilMs }),
  setHandledBy:   (id, handledBy) => post(`/api/sales/leads/${id}/handled-by`, { handledBy }),
  trashLead:      (id) => post(`/api/sales/leads/${id}/trash`),
  trash:          () => get('/api/sales/trash'),
  search:         (q) => get('/api/sales/search', { q }),
  messages:       (platform) => get('/api/sales/messages', { platform }),
  bookings:       () => get('/api/sales/bookings'),
  copilotChat:    (message, conversationId) => post('/api/sales/copilot/chat', { message, conversationId }),
  copilotConversations: () => get('/api/sales/copilot/conversations'),
  copilotConversation: (id) => get(`/api/sales/copilot/conversations/${id}`),
  copilotDeleteConversation: (id) => del(`/api/sales/copilot/conversations/${id}`),
  dailyBrief:     () => get('/api/sales/copilot/daily-brief'),
  settings:       () => get('/api/sales/settings'),
  saveSettings:   (patch) => post('/api/sales/settings', patch),
  stats:          () => get('/api/sales/stats'),
  repAnalytics:   () => get('/api/sales/analytics/reps'),
  assist:         (id, action) => post(`/api/sales/leads/${id}/assist`, { action }),
  callCoaching:   (id, transcript, callDuration, callStatus) => post(`/api/sales/leads/${id}/call-coaching`, { transcript, callDuration, callStatus }),
  getCallCoaching: (id) => get(`/api/sales/leads/${id}/call-coaching`),
  confirmCallCoaching: (coachingId, text, extracted) => post(`/api/sales/call-coaching/${coachingId}/confirm`, { text, extracted }),
};
