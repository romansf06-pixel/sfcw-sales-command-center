# SF City Wash — Sales Command Center

The Sales Command Center is SF City Wash's rep-facing app for working leads out of
GoHighLevel and Setmore: a priority queue, per-lead profiles, a call list, follow-ups,
an AI copilot with read-only GHL/Setmore tools, and a per-lead call helper (pricing
reference, an auto-built call script, and upsell guidance from the sales playbook).

Extracted from the SF City Wash internal dashboard monorepo
(`04-Dashboard/SF-City-Wash-Dashboard`) into a standalone app. GHL and Setmore data
is synced into a local SQLite mirror every 1-2 minutes, so reps don't call a lead
who already booked or replied elsewhere.

## Run it

```bash
npm install
cp .env.example .env   # fill in GHL_API_KEY, SETMORE_API_KEY, ANTHROPIC_API_KEY
npm start
```

Then open `http://localhost:3002/sales/`.

## Required environment variables

See `.env.example` for the full list and what each one unlocks. At minimum:

- `GHL_API_KEY` — GoHighLevel contacts/opportunities/conversations sync
- `SETMORE_API_KEY` — appointment/booking-status sync
- `ANTHROPIC_API_KEY` — the AI copilot (`/api/sales/copilot/*`)
- `DASHBOARD_SECRET` — recommended once this is deployed anywhere public; gates
  every `/api/*` route behind an `x-dashboard-key` header / `?key=` bootstrap

## Structure

- `server.js` — Express app: API auth gate, GHL/Setmore sync loops, SQLite
  bootstrap, and the two routers below
- `sales-api/` — REST routes for the queue, leads, call list, bookings
- `sales-ai/` — the AI copilot (Anthropic tool-use loop over read-only GHL/Setmore
  data) and the daily brief
- `sales/` — the static frontend the reps use
- `db/` — SQLite schema and query helpers (`better-sqlite3`)

## Known gap

`fetchGHLPipelines` in the original dashboard's `server.js` was declared twice —
the second definition silently shadowed the first everywhere in the file,
including at startup, so `ghl-pipelines.json` was never actually written and the
copilot's `get_pipeline_list` tool always returned "Not synced yet." This
extraction merges the two into a single function that does both jobs (returns
the pipeline-by-id map `fetchGHLContacts` needs, and writes `ghl-pipelines.json`
for the copilot tool), so that tool works here.
