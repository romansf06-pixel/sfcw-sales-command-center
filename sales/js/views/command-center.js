// Placeholder — the real Command Center is being redesigned into something
// more useful than a KPI/next-best-action recap (2026-09-26, owner request).
// Not deleted: the route and nav item stay so this is easy to rebuild later.
import { navigate } from '../main.js';

export async function mount(root) {
  root.innerHTML = `
    <div class="page-hdr">
      <div><div class="page-title">Command Center</div><div class="page-sub">In construction</div></div>
    </div>
    <div class="empty-state" style="padding:60px 0;">
      This page is being rebuilt into something more useful — check <a href="#/queue" style="color:var(--accent-l);">My Queue</a> in the meantime.
    </div>
  `;
  root.querySelector('a[href="#/queue"]')?.addEventListener('click', (e) => { e.preventDefault(); navigate('#/queue'); });
}
