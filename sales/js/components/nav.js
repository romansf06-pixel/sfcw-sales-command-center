const ITEMS = [
  { route: '#/', label: 'Command Center' },
  { route: '#/queue', label: 'My Queue', countKey: 'needs_reply' },
  { route: '#/copilot', label: 'AI Copilot' },
  { route: '#/inbox', label: 'Inbox' },
  { route: '#/messages', label: 'Conversations' },
  { route: '#/leads', label: 'Leads' },
  { route: '#/followups', label: 'Follow-Ups' },
  { route: '#/call-list', label: 'Call List' },
  { route: '#/scripts', label: 'Scripts' },
  { route: '#/bookings', label: 'Bookings' },
  { route: '#/reactivation', label: 'Reactivation', countKey: 'reactivation' },
  { route: '#/maintenance', label: 'Maintenance', countKey: 'maintenance_due' },
  { route: '#/analytics', label: 'Analytics' },
  { route: '#/settings', label: 'Settings' },
];

function fmtSyncAge(ms) {
  if (!ms) return 'not yet synced';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

export function renderNav(currentRoute, counts = {}, sync = {}) {
  const rows = ITEMS.map(it => {
    const active = currentRoute === it.route ? ' active' : '';
    const count = it.countKey ? counts[it.countKey] : undefined;
    const urgent = it.countKey === 'needs_reply' && count > 0;
    const badge = count ? `<span class="nav-count${urgent ? ' urgent' : ''}">${count}</span>` : '';
    return `<div class="nav-item${active}" data-route="${it.route}">${it.label}${badge}</div>`;
  }).join('');

  return `
    <div class="nav-brand">SF CITY WASH<small>Sales Command Center</small></div>
    <div class="nav-search-hint" id="nav-search-hint">Search leads <span>⌘K</span></div>
    <div class="nav-sync${sync.syncing ? ' syncing' : ''}" id="nav-sync" data-action="sync-now">
      <span>${sync.syncing ? 'Syncing…' : '🔄 Refresh'}</span>
      <span class="nav-sync-age">GHL/Setmore synced ${fmtSyncAge(sync.lastSyncedAt)}</span>
    </div>
    ${rows}
    <div class="nav-footer">Company dashboard is separate — <a href="/" target="_blank" style="color:var(--accent-l);">open it ↗</a></div>
  `;
}
