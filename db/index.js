/**
 * SFCW Database — SQLite via better-sqlite3
 *
 * DB path: /data/sfcw.db (Railway volume) or ./data/sfcw.db (local dev).
 * Without a Railway persistent volume the file survives the session but is
 * wiped on redeploy — same behavior as the old flat JSON files, just better
 * structured. Add a Railway volume mounted at /data to make it durable.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Resolve DB path: prefer Railway volume mount, fall back to local ./data/
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'sfcw.db');

let db;
try {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
} catch (err) {
  console.error('[DB] Failed to open SQLite:', err.message);
  // Re-throw so server startup fails loudly rather than silently running without DB
  throw err;
}

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
-- ── Integration tracking ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id           TEXT PRIMARY KEY,            -- e.g. "meta", "ghl", "gbp"
  name         TEXT NOT NULL,
  status       TEXT DEFAULT 'unknown',      -- connected | warning | broken | unconfigured
  last_sync_ok INTEGER,                     -- unix ms
  last_sync_at INTEGER,                     -- unix ms
  last_error   TEXT,
  records_last INTEGER DEFAULT 0,
  api_version  TEXT,
  meta         TEXT                         -- JSON blob for extra info
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  integration  TEXT NOT NULL,
  started_at   INTEGER NOT NULL,            -- unix ms
  ended_at     INTEGER,
  status       TEXT,                        -- ok | error | partial
  records_in   INTEGER DEFAULT 0,
  error        TEXT
);

-- ── Meta Ads ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id           TEXT PRIMARY KEY,
  name         TEXT,
  status       TEXT,
  objective    TEXT,
  created_at   INTEGER,
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS ad_sets (
  id           TEXT PRIMARY KEY,
  campaign_id  TEXT REFERENCES campaigns(id),
  name         TEXT,
  status       TEXT,
  daily_budget TEXT,
  destination_type TEXT,                    -- WEBSITE | LEAD_GENERATION | etc
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS ads (
  id           TEXT PRIMARY KEY,
  ad_set_id    TEXT REFERENCES ad_sets(id),
  campaign_id  TEXT REFERENCES campaigns(id),
  name         TEXT,
  status       TEXT,
  creative_id  TEXT,
  thumbnail_url TEXT,
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS ad_metrics_daily (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type        TEXT NOT NULL,         -- campaign | ad_set | ad | account
  entity_id          TEXT NOT NULL,
  date               TEXT NOT NULL,         -- YYYY-MM-DD
  spend              REAL DEFAULT 0,
  impressions        INTEGER DEFAULT 0,
  reach              INTEGER DEFAULT 0,
  clicks             INTEGER DEFAULT 0,
  outbound_clicks    INTEGER DEFAULT 0,
  cpm                REAL DEFAULT 0,
  cpc                REAL DEFAULT 0,
  ctr                REAL DEFAULT 0,
  frequency          REAL DEFAULT 0,
  leads              INTEGER DEFAULT 0,
  video_views        INTEGER DEFAULT 0,
  landing_page_views INTEGER DEFAULT 0,
  raw_actions        TEXT,                  -- JSON array from Meta
  synced_at          INTEGER,
  UNIQUE (entity_type, entity_id, date)
);

-- ── Social accounts and posts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_accounts (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,               -- instagram | facebook | tiktok
  handle       TEXT,
  name         TEXT,
  follower_count INTEGER DEFAULT 0,
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS social_posts (
  id           TEXT PRIMARY KEY,
  account_id   TEXT REFERENCES social_accounts(id),
  platform     TEXT NOT NULL,
  media_type   TEXT,                        -- IMAGE | VIDEO | CAROUSEL_ALBUM | REEL
  caption      TEXT,
  permalink    TEXT,
  thumbnail_url TEXT,
  published_at INTEGER,
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS social_post_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id         TEXT REFERENCES social_posts(id),
  date            TEXT NOT NULL,            -- YYYY-MM-DD of the sync
  impressions     INTEGER DEFAULT 0,
  reach           INTEGER DEFAULT 0,
  likes           INTEGER DEFAULT 0,
  comments        INTEGER DEFAULT 0,
  shares          INTEGER DEFAULT 0,
  saves           INTEGER DEFAULT 0,
  views           INTEGER DEFAULT 0,
  avg_watch_pct   REAL DEFAULT 0,
  engagement_rate REAL DEFAULT 0,
  UNIQUE (post_id, date)
);

-- ── GHL Contacts / Leads ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contacts (
  id           TEXT PRIMARY KEY,
  ghl_id       TEXT UNIQUE,
  first_name   TEXT,
  last_name    TEXT,
  email        TEXT,
  phone        TEXT,
  source       TEXT,
  tags         TEXT,                        -- JSON array
  vehicle      TEXT,
  service      TEXT,
  created_at   INTEGER,
  updated_at   INTEGER,
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS lead_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id   TEXT REFERENCES contacts(id),
  event_type   TEXT,                        -- created | stage_change | booked | etc
  stage        TEXT,
  payload      TEXT,                        -- JSON raw webhook
  occurred_at  INTEGER
);

CREATE TABLE IF NOT EXISTS pipeline_opportunities (
  id           TEXT PRIMARY KEY,
  ghl_id       TEXT UNIQUE,
  contact_id   TEXT REFERENCES contacts(id),
  name         TEXT,
  stage        TEXT,
  pipeline     TEXT,
  monetary_value REAL DEFAULT 0,
  status       TEXT,
  created_at   INTEGER,
  updated_at   INTEGER,
  synced_at    INTEGER
);

-- ── Conversations / Messages ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id           TEXT PRIMARY KEY,
  ghl_id       TEXT UNIQUE,
  contact_id   TEXT REFERENCES contacts(id),
  platform     TEXT,                        -- instagram | sms | email | etc
  last_message TEXT,
  last_msg_at  INTEGER,
  unread       INTEGER DEFAULT 0,
  synced_at    INTEGER
);

-- ── Bookings / Jobs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,
  setmore_id   TEXT UNIQUE,
  contact_id   TEXT,
  service      TEXT,
  vehicle      TEXT,
  starts_at    INTEGER,
  ends_at      INTEGER,
  status       TEXT,                        -- confirmed | cancelled | completed
  staff        TEXT,
  synced_at    INTEGER
);

CREATE TABLE IF NOT EXISTS job_revenue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id   TEXT REFERENCES bookings(id),
  date         TEXT,
  base         REAL DEFAULT 0,
  tip          REAL DEFAULT 0,
  addons       REAL DEFAULT 0,
  total        REAL DEFAULT 0,
  source       TEXT                         -- setmore | manual | stripe
);

-- ── Tracking links ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracking_links (
  id           TEXT PRIMARY KEY,
  slug         TEXT UNIQUE NOT NULL,
  destination  TEXT NOT NULL,
  name         TEXT,
  campaign     TEXT,
  source       TEXT,
  medium       TEXT,
  content      TEXT,
  platform     TEXT,
  created_at   INTEGER
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id      TEXT REFERENCES tracking_links(id),
  event_type   TEXT,                        -- click | lead | booking
  occurred_at  INTEGER,
  session_id   TEXT,
  ip_hash      TEXT,
  user_agent   TEXT
);

-- ── Attribution ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracking_sessions (
  id           TEXT PRIMARY KEY,
  session_id   TEXT UNIQUE,
  started_at   INTEGER,
  landing_page TEXT,
  utm_source   TEXT,
  utm_medium   TEXT,
  utm_campaign TEXT,
  utm_content  TEXT,
  utm_term     TEXT,
  fbclid       TEXT,
  gclid        TEXT,
  referrer     TEXT,
  contact_id   TEXT
);

CREATE TABLE IF NOT EXISTS conversion_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT REFERENCES tracking_sessions(id),
  event_name   TEXT NOT NULL,              -- PageView | BookingStarted | QuoteSubmitted | etc
  occurred_at  INTEGER,
  payload      TEXT,                       -- JSON
  dedup_key    TEXT UNIQUE                 -- prevents duplicate CAPI events
);

-- ── Amazon Affiliate ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_tracking_ids (
  id           TEXT PRIMARY KEY,
  tracking_id  TEXT UNIQUE NOT NULL,
  name         TEXT,
  channel      TEXT,                       -- website | instagram | facebook | etc
  created_at   INTEGER
);

CREATE TABLE IF NOT EXISTS affiliate_metrics_daily (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id  TEXT REFERENCES affiliate_tracking_ids(tracking_id),
  date         TEXT NOT NULL,
  clicks       INTEGER DEFAULT 0,
  ordered_items INTEGER DEFAULT 0,
  shipped_items INTEGER DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  shipped_revenue REAL DEFAULT 0,
  commissions  REAL DEFAULT 0,
  UNIQUE (tracking_id, date)
);

-- ── Finance ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  category     TEXT,
  description  TEXT,
  amount       REAL NOT NULL,
  recurring    INTEGER DEFAULT 0,          -- 0/1
  source       TEXT                        -- manual | stripe | quickbooks
);

-- ── Maintenance clients ───────────────────────────────────────────────────────
-- Repeat clients on a recurring schedule at a rate that was agreed with them
-- individually. maintenance_price is the whole point of this table: it is the
-- client's price, stored, and it must never be re-derived from public pricing.
CREATE TABLE IF NOT EXISTS maintenance_clients (
  id                TEXT PRIMARY KEY,
  ghl_contact_id    TEXT,                       -- GHL CRM contact id, when known
  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  address           TEXT,
  service_area      TEXT,                       -- neighborhood / region label
  vehicle_year      TEXT,
  vehicle_make      TEXT,
  vehicle_model     TEXT,
  vehicle_size      TEXT,                       -- sedan | midsize | large
  service           TEXT,                       -- interior | full | exterior
  addons            TEXT,                       -- JSON array of add-on ids
  addon_qty         TEXT,                       -- JSON { seats, carpetAreas, carpetMats }
  maintenance_price REAL,                       -- the agreed rate — stored, never recalculated
  base_price        REAL,                       -- public price when the rate was agreed (reference only)
  frequency         TEXT,                       -- human label: Monthly, Every 6 weeks, Quarterly…
  frequency_days    INTEGER,                    -- numeric interval used for next-due math
  notes             TEXT,
  last_service_date TEXT,                       -- YYYY-MM-DD
  next_due_date     TEXT,                       -- YYYY-MM-DD; derived on booking, editable
  status            TEXT DEFAULT 'active',      -- active | paused | inactive
  created_at        INTEGER,
  updated_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_maint_status ON maintenance_clients(status, next_due_date);
CREATE INDEX IF NOT EXISTS idx_maint_name   ON maintenance_clients(name);

-- Every maintenance visit actually booked through the dashboard. This is what
-- makes last_service_date trustworthy instead of something someone remembered
-- to type in.
CREATE TABLE IF NOT EXISTS maintenance_visits (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    TEXT REFERENCES maintenance_clients(id) ON DELETE CASCADE,
  service_date TEXT,                            -- YYYY-MM-DD
  service_time TEXT,                            -- HH:MM 24h
  price        REAL,
  booking_ref  TEXT,                            -- Setmore/worker reference when returned
  note         TEXT,
  created_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_maint_visits_client ON maintenance_visits(client_id, service_date DESC);

-- ── Generated creative assets ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generated_assets (
  id           TEXT PRIMARY KEY,
  created_at   INTEGER,
  model        TEXT,
  type         TEXT,                       -- image | video | audio
  prompt       TEXT,
  aspect_ratio TEXT,
  campaign     TEXT,
  output_url   TEXT,
  status       TEXT,                       -- pending | approved | rejected
  associated_ad TEXT,
  higgsfield_job_id TEXT
);
`);

// ── Migrations: additive columns on tables that predate them ──────────────────
// better-sqlite3 has no "ADD COLUMN IF NOT EXISTS", so existence is checked
// first. Safe to run on every boot — a fresh DB already has these from the
// CREATE TABLE above and PRAGMA table_info will simply list them.
function ensureColumn(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}
// Fields the GHL custom-field audit found that the dashboard never cached —
// needed so the Sales Command Center can show real quote/urgency/vehicle
// detail instead of the mislabeled single "service" text blob.
ensureColumn('contacts', 'assigned_to',         'TEXT'); // GHL user id from contact.assignedTo
ensureColumn('contacts', 'ghl_notes',           'TEXT'); // "Anything we should know?" — was wrongly used as service
ensureColumn('contacts', 'quoted_price',        'REAL');
ensureColumn('contacts', 'urgency',             'TEXT');
ensureColumn('contacts', 'service_category',    'TEXT');
ensureColumn('contacts', 'vehicle_year',        'TEXT');
ensureColumn('contacts', 'vehicle_make',        'TEXT');
ensureColumn('contacts', 'vehicle_model',       'TEXT');
ensureColumn('contacts', 'confirmed_appt_date', 'TEXT');
ensureColumn('contacts', 'confirmed_appt_time', 'TEXT');
ensureColumn('contacts', 'city', 'TEXT');
ensureColumn('contacts', 'state', 'TEXT');
ensureColumn('contacts', 'zip', 'TEXT');
// Setmore appointments already resolve a customer phone at sync time (see
// fetchSetmoreData) but it was discarded before reaching this table, which is
// why nothing could ever match a booking back to a GHL contact.
ensureColumn('bookings', 'phone',         'TEXT');
ensureColumn('bookings', 'customer_name', 'TEXT');
// GHL's conversation search returns lastMessageDirection but the old sync
// route dropped it, so nothing could tell "customer is waiting on us" from
// "we already replied" — the single most important signal for a sales queue.
ensureColumn('conversations', 'last_message_direction', 'TEXT');

// ── Sales Command Center — local, rep-specific data ────────────────────────────
// Everything here is data that does NOT belong in GHL: it's how a specific
// salesperson is working a lead, not the lead record itself. Keyed by
// contact_id = the GHL contact id (contacts.id), so it joins straight onto
// the synced CRM cache above without duplicating any GHL-owned field.
db.exec(`
CREATE TABLE IF NOT EXISTS sales_reps (
  id           TEXT PRIMARY KEY,       -- internal id, independent of any GHL user
  name         TEXT NOT NULL,
  email        TEXT,
  ghl_user_id  TEXT,                   -- nullable until the rep also exists as a GHL user
  active       INTEGER DEFAULT 1,
  created_at   INTEGER
);

CREATE TABLE IF NOT EXISTS sales_followups (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id   TEXT NOT NULL,
  rep_id       TEXT REFERENCES sales_reps(id),
  due_at       INTEGER NOT NULL,
  reason       TEXT,
  note         TEXT,
  status       TEXT DEFAULT 'open',    -- open | done | cancelled
  created_at   INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_followups_due ON sales_followups(status, due_at);
CREATE INDEX IF NOT EXISTS idx_followups_contact ON sales_followups(contact_id);

CREATE TABLE IF NOT EXISTS sales_notes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id   TEXT NOT NULL,
  rep_id       TEXT REFERENCES sales_reps(id),
  body         TEXT NOT NULL,
  created_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notes_contact ON sales_notes(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sales_dispositions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id   TEXT NOT NULL,
  rep_id       TEXT REFERENCES sales_reps(id),
  disposition  TEXT NOT NULL,          -- no_answer | voicemail | spoke_follow_up | quote_sent | ...
  note         TEXT,
  created_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dispositions_contact ON sales_dispositions(contact_id, created_at DESC);

-- Manual overrides / rep-local state that doesn't fit a history log.
CREATE TABLE IF NOT EXISTS sales_lead_state (
  contact_id         TEXT PRIMARY KEY,
  rep_id             TEXT REFERENCES sales_reps(id),   -- internal ownership, independent of GHL assignedTo
  priority_override  INTEGER,
  snoozed_until      INTEGER,
  updated_at         INTEGER
);

CREATE TABLE IF NOT EXISTS sales_saved_views (
  id           TEXT PRIMARY KEY,
  rep_id       TEXT REFERENCES sales_reps(id),
  name         TEXT NOT NULL,
  config       TEXT NOT NULL,          -- JSON: filters, sort, columns
  created_at   INTEGER
);

CREATE TABLE IF NOT EXISTS sales_settings (
  rep_id       TEXT PRIMARY KEY REFERENCES sales_reps(id),
  config       TEXT NOT NULL,          -- JSON: priority thresholds, default view, layout, shortcuts
  updated_at   INTEGER
);

-- ── AI Copilot ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS copilot_conversations (
  id           TEXT PRIMARY KEY,
  rep_id       TEXT REFERENCES sales_reps(id),
  title        TEXT,                   -- first user message, truncated — set once, shown in the chat list
  created_at   INTEGER,
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_copilot_conv_rep ON copilot_conversations(rep_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT REFERENCES copilot_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,        -- user | assistant
  body            TEXT NOT NULL,        -- assistant's rendered text (tool_use blocks not persisted verbatim, see tool_calls)
  tool_calls      TEXT,                 -- JSON array of {name, input, result} actually executed for this turn — the "why" trail
  created_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_copilot_msg_conv ON copilot_messages(conversation_id, created_at ASC);

-- AI-made classifications, kept separate from sales_dispositions (which are
-- rep-confirmed facts) so an AI guess is never mistaken for a human decision.
-- A manual disposition always exists as an override path — see priority.js,
-- which excludes on sales_dispositions, never on this table.
CREATE TABLE IF NOT EXISTS ai_lead_classifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id     TEXT NOT NULL,
  classification TEXT NOT NULL,         -- High Intent | Warm | Nurture | Low Intent | No Sales Action | Spam/Vendor | Needs Human Review
  confidence     TEXT,                  -- high | medium | low
  reason         TEXT,
  model          TEXT,                  -- e.g. claude-sonnet-4-6
  created_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_class_contact ON ai_lead_classifications(contact_id, created_at DESC);

-- Call coaching. The "source" column is what makes this forward-compatible
-- with a real live-listen integration later: today every row is 'manual'
-- (the rep pastes what was said, since GHL's API returns call duration and
-- status but no recording or transcript — verified live 2026-09-25). If a
-- recording ever becomes available the same analysis pipeline takes
-- source='transcribed'; a future live-stream feed would be source='live'.
-- The coaching logic itself never needs to change, only how the transcript
-- text gets filled in.
CREATE TABLE IF NOT EXISTS call_coaching (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id     TEXT NOT NULL,
  rep_id         TEXT REFERENCES sales_reps(id),
  source         TEXT DEFAULT 'manual',   -- manual | transcribed | live
  call_duration  INTEGER,                 -- seconds, from GHL's TYPE_CALL meta when known
  call_status    TEXT,                    -- completed | no-answer | busy | failed, from GHL when known
  transcript     TEXT NOT NULL,
  analysis       TEXT,                    -- JSON: {whatWorked, whatToImprove, objections, suggestedFollowUp, keyTakeaway}
  model          TEXT,
  created_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_call_coaching_contact ON call_coaching(contact_id, created_at DESC);
`);

// Seed integration rows so health check can track them
const integrationDefaults = [
  { id: 'meta',      name: 'Meta Ads',          api_version: 'v19.0' },
  { id: 'instagram', name: 'Instagram',          api_version: 'v19.0' },
  { id: 'facebook',  name: 'Facebook Page',      api_version: 'v19.0' },
  { id: 'ghl',       name: 'GoHighLevel CRM',    api_version: 'v2' },
  { id: 'gbp',       name: 'Google Business',    api_version: 'v1' },
  { id: 'setmore',   name: 'Setmore Booking',    api_version: 'v1' },
  { id: 'tiktok',    name: 'TikTok',             api_version: null },
  { id: 'amazon',    name: 'Amazon Associates',  api_version: null },
  { id: 'higgsfield',name: 'Higgsfield AI',      api_version: null },
  { id: 'anthropic', name: 'Anthropic Claude',   api_version: null },
];
const upsertIntegration = db.prepare(`
  INSERT INTO integrations (id, name, api_version)
  VALUES (@id, @name, @api_version)
  ON CONFLICT(id) DO UPDATE SET name = excluded.name
`);
const upsertMany = db.transaction(rows => rows.forEach(r => upsertIntegration.run(r)));
upsertMany(integrationDefaults);

// ── Prepared statements ───────────────────────────────────────────────────────

const stmts = {
  // Integrations
  setIntegrationOk: db.prepare(`
    UPDATE integrations SET status='connected', last_sync_ok=@ts, last_sync_at=@ts,
      records_last=@records, last_error=NULL WHERE id=@id
  `),
  setIntegrationErr: db.prepare(`
    UPDATE integrations SET status='warning', last_sync_at=@ts, last_error=@error WHERE id=@id
  `),
  getIntegrations: db.prepare(`SELECT * FROM integrations ORDER BY name`),

  // Sync runs
  startSyncRun: db.prepare(`
    INSERT INTO sync_runs (integration, started_at, status) VALUES (@integration, @ts, 'running')
  `),
  endSyncRun: db.prepare(`
    UPDATE sync_runs SET ended_at=@ts, status=@status, records_in=@records, error=@error
    WHERE id=@id
  `),

  // Campaigns
  upsertCampaign: db.prepare(`
    INSERT INTO campaigns (id, name, status, objective, synced_at)
    VALUES (@id, @name, @status, @objective, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, status=excluded.status,
      objective=excluded.objective, synced_at=excluded.synced_at
  `),

  // Ad sets
  upsertAdSet: db.prepare(`
    INSERT INTO ad_sets (id, campaign_id, name, status, daily_budget, destination_type, synced_at)
    VALUES (@id, @campaign_id, @name, @status, @daily_budget, @destination_type, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, status=excluded.status,
      daily_budget=excluded.daily_budget, destination_type=excluded.destination_type,
      synced_at=excluded.synced_at
  `),

  // Ads
  upsertAd: db.prepare(`
    INSERT INTO ads (id, ad_set_id, campaign_id, name, status, creative_id, thumbnail_url, synced_at)
    VALUES (@id, @ad_set_id, @campaign_id, @name, @status, @creative_id, @thumbnail_url, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, status=excluded.status,
      creative_id=excluded.creative_id, thumbnail_url=excluded.thumbnail_url,
      synced_at=excluded.synced_at
  `),

  // Ad metrics — idempotent daily upsert
  upsertAdMetric: db.prepare(`
    INSERT INTO ad_metrics_daily
      (entity_type, entity_id, date, spend, impressions, reach, clicks,
       outbound_clicks, cpm, cpc, ctr, frequency, leads, video_views,
       landing_page_views, raw_actions, synced_at)
    VALUES
      (@entity_type, @entity_id, @date, @spend, @impressions, @reach, @clicks,
       @outbound_clicks, @cpm, @cpc, @ctr, @frequency, @leads, @video_views,
       @landing_page_views, @raw_actions, @synced_at)
    ON CONFLICT(entity_type, entity_id, date) DO UPDATE SET
      spend=excluded.spend, impressions=excluded.impressions, reach=excluded.reach,
      clicks=excluded.clicks, outbound_clicks=excluded.outbound_clicks,
      cpm=excluded.cpm, cpc=excluded.cpc, ctr=excluded.ctr, frequency=excluded.frequency,
      leads=excluded.leads, video_views=excluded.video_views,
      landing_page_views=excluded.landing_page_views,
      raw_actions=excluded.raw_actions, synced_at=excluded.synced_at
  `),

  // Social accounts
  upsertSocialAccount: db.prepare(`
    INSERT INTO social_accounts (id, platform, handle, name, follower_count, synced_at)
    VALUES (@id, @platform, @handle, @name, @follower_count, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      handle=excluded.handle, name=excluded.name,
      follower_count=excluded.follower_count, synced_at=excluded.synced_at
  `),

  // Social posts
  upsertSocialPost: db.prepare(`
    INSERT INTO social_posts (id, account_id, platform, media_type, caption, permalink, thumbnail_url, published_at, synced_at)
    VALUES (@id, @account_id, @platform, @media_type, @caption, @permalink, @thumbnail_url, @published_at, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      media_type=excluded.media_type, caption=excluded.caption, permalink=excluded.permalink,
      thumbnail_url=excluded.thumbnail_url, synced_at=excluded.synced_at
  `),

  // Social post metrics
  upsertPostMetric: db.prepare(`
    INSERT INTO social_post_metrics
      (post_id, date, impressions, reach, likes, comments, shares, saves, views, avg_watch_pct, engagement_rate)
    VALUES (@post_id, @date, @impressions, @reach, @likes, @comments, @shares, @saves, @views, @avg_watch_pct, @engagement_rate)
    ON CONFLICT(post_id, date) DO UPDATE SET
      impressions=excluded.impressions, reach=excluded.reach,
      likes=excluded.likes, comments=excluded.comments, shares=excluded.shares,
      saves=excluded.saves, views=excluded.views,
      avg_watch_pct=excluded.avg_watch_pct, engagement_rate=excluded.engagement_rate
  `),

  // GHL Contacts
  upsertContact: db.prepare(`
    INSERT INTO contacts (
      id, ghl_id, first_name, last_name, email, phone, source, tags, vehicle, service,
      assigned_to, ghl_notes, quoted_price, urgency, service_category,
      vehicle_year, vehicle_make, vehicle_model, confirmed_appt_date, confirmed_appt_time,
      city, state, zip,
      created_at, updated_at, synced_at
    )
    VALUES (
      @id, @ghl_id, @first_name, @last_name, @email, @phone, @source, @tags, @vehicle, @service,
      @assigned_to, @ghl_notes, @quoted_price, @urgency, @service_category,
      @vehicle_year, @vehicle_make, @vehicle_model, @confirmed_appt_date, @confirmed_appt_time,
      @city, @state, @zip,
      @created_at, @updated_at, @synced_at
    )
    ON CONFLICT(ghl_id) DO UPDATE SET
      first_name=excluded.first_name, last_name=excluded.last_name,
      email=excluded.email, phone=excluded.phone, source=excluded.source,
      tags=excluded.tags, vehicle=excluded.vehicle, service=excluded.service,
      assigned_to=excluded.assigned_to, ghl_notes=excluded.ghl_notes,
      quoted_price=excluded.quoted_price, urgency=excluded.urgency,
      service_category=excluded.service_category,
      vehicle_year=excluded.vehicle_year, vehicle_make=excluded.vehicle_make,
      vehicle_model=excluded.vehicle_model,
      confirmed_appt_date=excluded.confirmed_appt_date, confirmed_appt_time=excluded.confirmed_appt_time,
      city=excluded.city, state=excluded.state, zip=excluded.zip,
      updated_at=excluded.updated_at, synced_at=excluded.synced_at
  `),

  // GHL Opportunities
  upsertOpportunity: db.prepare(`
    INSERT INTO pipeline_opportunities (id, ghl_id, contact_id, name, stage, pipeline, monetary_value, status, created_at, updated_at, synced_at)
    VALUES (@id, @ghl_id, @contact_id, @name, @stage, @pipeline, @monetary_value, @status, @created_at, @updated_at, @synced_at)
    ON CONFLICT(ghl_id) DO UPDATE SET
      contact_id=excluded.contact_id, name=excluded.name, stage=excluded.stage,
      pipeline=excluded.pipeline, monetary_value=excluded.monetary_value,
      status=excluded.status, updated_at=excluded.updated_at, synced_at=excluded.synced_at
  `),

  // Bookings
  upsertBooking: db.prepare(`
    INSERT INTO bookings (id, setmore_id, contact_id, service, vehicle, starts_at, ends_at, status, staff, phone, customer_name, synced_at)
    VALUES (@id, @setmore_id, @contact_id, @service, @vehicle, @starts_at, @ends_at, @status, @staff, @phone, @customer_name, @synced_at)
    ON CONFLICT(setmore_id) DO UPDATE SET
      service=excluded.service, vehicle=excluded.vehicle,
      starts_at=excluded.starts_at, ends_at=excluded.ends_at,
      status=excluded.status, phone=excluded.phone, customer_name=excluded.customer_name,
      synced_at=excluded.synced_at
  `),

  // Tracking links
  upsertTrackingLink: db.prepare(`
    INSERT INTO tracking_links (id, slug, destination, name, campaign, source, medium, content, platform, created_at)
    VALUES (@id, @slug, @destination, @name, @campaign, @source, @medium, @content, @platform, @created_at)
    ON CONFLICT(slug) DO UPDATE SET
      destination=excluded.destination, name=excluded.name,
      campaign=excluded.campaign, source=excluded.source, medium=excluded.medium,
      content=excluded.content, platform=excluded.platform
  `),

  // Tracking events
  insertTrackingEvent: db.prepare(`
    INSERT INTO tracking_events (link_id, event_type, occurred_at, session_id, ip_hash, user_agent)
    VALUES (@link_id, @event_type, @occurred_at, @session_id, @ip_hash, @user_agent)
  `),

  // Tracking sessions (attribution)
  upsertSession: db.prepare(`
    INSERT INTO tracking_sessions
      (id, session_id, started_at, landing_page, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, referrer)
    VALUES
      (@id, @session_id, @started_at, @landing_page, @utm_source, @utm_medium, @utm_campaign, @utm_content, @utm_term, @fbclid, @gclid, @referrer)
    ON CONFLICT(session_id) DO UPDATE SET contact_id=excluded.contact_id
  `),

  // Conversion events — dedup_key enforces exactly-once semantics
  insertConversionEvent: db.prepare(`
    INSERT OR IGNORE INTO conversion_events (session_id, event_name, occurred_at, payload, dedup_key)
    VALUES (@session_id, @event_name, @occurred_at, @payload, @dedup_key)
  `),

  // Expenses
  upsertExpense: db.prepare(`
    INSERT INTO expenses (id, date, category, description, amount, recurring, source)
    VALUES (@id, @date, @category, @description, @amount, @recurring, @source)
    ON CONFLICT(id) DO UPDATE SET
      date=excluded.date, category=excluded.category, description=excluded.description,
      amount=excluded.amount, recurring=excluded.recurring
  `),

  // Affiliate tracking IDs
  upsertTrackingId: db.prepare(`
    INSERT INTO affiliate_tracking_ids (id, tracking_id, name, channel, created_at)
    VALUES (@id, @tracking_id, @name, @channel, @created_at)
    ON CONFLICT(tracking_id) DO UPDATE SET
      name=excluded.name, channel=excluded.channel
  `),
  deleteTrackingId: db.prepare(`DELETE FROM affiliate_tracking_ids WHERE tracking_id=?`),
  getTrackingIds: db.prepare(`SELECT * FROM affiliate_tracking_ids ORDER BY created_at DESC`),

  // Affiliate daily metrics
  upsertAffiliateMetric: db.prepare(`
    INSERT INTO affiliate_metrics_daily
      (tracking_id, date, clicks, ordered_items, shipped_items, conversion_rate, shipped_revenue, commissions)
    VALUES (@tracking_id, @date, @clicks, @ordered_items, @shipped_items, @conversion_rate, @shipped_revenue, @commissions)
    ON CONFLICT(tracking_id, date) DO UPDATE SET
      clicks=excluded.clicks, ordered_items=excluded.ordered_items,
      shipped_items=excluded.shipped_items, conversion_rate=excluded.conversion_rate,
      shipped_revenue=excluded.shipped_revenue, commissions=excluded.commissions
  `),

  // Generated assets
  upsertAsset: db.prepare(`
    INSERT INTO generated_assets (id, created_at, model, type, prompt, aspect_ratio, campaign, output_url, status, associated_ad, higgsfield_job_id)
    VALUES (@id, @created_at, @model, @type, @prompt, @aspect_ratio, @campaign, @output_url, @status, @associated_ad, @higgsfield_job_id)
    ON CONFLICT(id) DO UPDATE SET
      output_url=excluded.output_url, status=excluded.status,
      higgsfield_job_id=excluded.higgsfield_job_id
  `),
};

// ── Batch helpers ─────────────────────────────────────────────────────────────

const batchUpsertAds = db.transaction(ads => ads.forEach(a => stmts.upsertAd.run(a)));
const batchUpsertAdSets = db.transaction(sets => sets.forEach(s => stmts.upsertAdSet.run(s)));
const batchUpsertCampaigns = db.transaction(c => c.forEach(x => stmts.upsertCampaign.run(x)));
const batchUpsertAdMetrics = db.transaction(m => m.forEach(x => stmts.upsertAdMetric.run(x)));
const batchUpsertContacts = db.transaction(c => c.forEach(x => stmts.upsertContact.run(x)));
const batchUpsertOpportunities = db.transaction(o => o.forEach(x => stmts.upsertOpportunity.run(x)));
const batchUpsertBookings = db.transaction(b => b.forEach(x => stmts.upsertBooking.run(x)));
const batchUpsertPosts = db.transaction(p => p.forEach(x => stmts.upsertSocialPost.run(x)));
const batchUpsertPostMetrics = db.transaction(m => m.forEach(x => stmts.upsertPostMetric.run(x)));
const batchUpsertAffiliateMetrics = db.transaction(m => m.forEach(x => stmts.upsertAffiliateMetric.run(x)));

// ── Maintenance clients ───────────────────────────────────────────────────────

const maintStmts = {
  upsert: db.prepare(`
    INSERT INTO maintenance_clients (
      id, ghl_contact_id, name, phone, email, address, service_area,
      vehicle_year, vehicle_make, vehicle_model, vehicle_size,
      service, addons, addon_qty, maintenance_price, base_price,
      frequency, frequency_days, notes, last_service_date, next_due_date,
      status, created_at, updated_at
    ) VALUES (
      @id, @ghl_contact_id, @name, @phone, @email, @address, @service_area,
      @vehicle_year, @vehicle_make, @vehicle_model, @vehicle_size,
      @service, @addons, @addon_qty, @maintenance_price, @base_price,
      @frequency, @frequency_days, @notes, @last_service_date, @next_due_date,
      @status, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      ghl_contact_id    = excluded.ghl_contact_id,
      name              = excluded.name,
      phone             = excluded.phone,
      email             = excluded.email,
      address           = excluded.address,
      service_area      = excluded.service_area,
      vehicle_year      = excluded.vehicle_year,
      vehicle_make      = excluded.vehicle_make,
      vehicle_model     = excluded.vehicle_model,
      vehicle_size      = excluded.vehicle_size,
      service           = excluded.service,
      addons            = excluded.addons,
      addon_qty         = excluded.addon_qty,
      maintenance_price = excluded.maintenance_price,
      base_price        = excluded.base_price,
      frequency         = excluded.frequency,
      frequency_days    = excluded.frequency_days,
      notes             = excluded.notes,
      last_service_date = excluded.last_service_date,
      next_due_date     = excluded.next_due_date,
      status            = excluded.status,
      updated_at        = excluded.updated_at
  `),
  getAll:  db.prepare(`SELECT * FROM maintenance_clients ORDER BY status='active' DESC, next_due_date IS NULL, next_due_date ASC, name ASC`),
  getOne:  db.prepare(`SELECT * FROM maintenance_clients WHERE id = ?`),
  remove:  db.prepare(`DELETE FROM maintenance_clients WHERE id = ?`),
  // Recording a visit is the only thing that moves the schedule forward.
  markServiced: db.prepare(`
    UPDATE maintenance_clients
    SET last_service_date = @date, next_due_date = @next, updated_at = @ts
    WHERE id = @id
  `),
  addVisit: db.prepare(`
    INSERT INTO maintenance_visits (client_id, service_date, service_time, price, booking_ref, note, created_at)
    VALUES (@client_id, @service_date, @service_time, @price, @booking_ref, @note, @created_at)
  `),
  getVisits: db.prepare(`
    SELECT * FROM maintenance_visits WHERE client_id = ? ORDER BY service_date DESC, id DESC LIMIT ?
  `),
};

function getMaintenanceClients() {
  return maintStmts.getAll.all();
}

function getMaintenanceClient(id) {
  const row = maintStmts.getOne.get(id);
  if (!row) return null;
  row.visits = maintStmts.getVisits.all(id, 12);
  return row;
}

function saveMaintenanceClient(row) {
  maintStmts.upsert.run(row);
  return maintStmts.getOne.get(row.id);
}

function deleteMaintenanceClient(id) {
  maintStmts.remove.run(id);
}

// Records a booked visit and advances the schedule in one transaction, so a
// half-written record can't leave a client showing as due when they aren't.
const recordMaintenanceVisit = db.transaction(v => {
  maintStmts.addVisit.run(v.visit);
  maintStmts.markServiced.run(v.schedule);
  return maintStmts.getOne.get(v.schedule.id);
});

// ── Sales Command Center helpers ───────────────────────────────────────────────

const DEFAULT_REP_ID = 'rep_default';

const salesStmts = {
  upsertRep: db.prepare(`
    INSERT INTO sales_reps (id, name, email, ghl_user_id, active, created_at)
    VALUES (@id, @name, @email, @ghl_user_id, @active, @created_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, email=excluded.email, ghl_user_id=excluded.ghl_user_id, active=excluded.active
  `),
  getRep: db.prepare(`SELECT * FROM sales_reps WHERE id = ?`),
  getReps: db.prepare(`SELECT * FROM sales_reps WHERE active = 1 ORDER BY created_at ASC`),

  addFollowup: db.prepare(`
    INSERT INTO sales_followups (contact_id, rep_id, due_at, reason, note, status, created_at)
    VALUES (@contact_id, @rep_id, @due_at, @reason, @note, 'open', @created_at)
  `),
  completeFollowup: db.prepare(`UPDATE sales_followups SET status='done', completed_at=@ts WHERE id=@id`),
  cancelFollowup:   db.prepare(`UPDATE sales_followups SET status='cancelled', completed_at=@ts WHERE id=@id`),
  openFollowupForContact: db.prepare(`
    SELECT * FROM sales_followups WHERE contact_id=? AND status='open' ORDER BY due_at ASC LIMIT 1
  `),
  followupsByContact: db.prepare(`SELECT * FROM sales_followups WHERE contact_id=? ORDER BY due_at DESC`),
  openFollowups: db.prepare(`SELECT * FROM sales_followups WHERE status='open' ORDER BY due_at ASC`),

  addNote: db.prepare(`
    INSERT INTO sales_notes (contact_id, rep_id, body, created_at) VALUES (@contact_id, @rep_id, @body, @created_at)
  `),
  notesByContact: db.prepare(`SELECT * FROM sales_notes WHERE contact_id=? ORDER BY created_at DESC`),

  addDisposition: db.prepare(`
    INSERT INTO sales_dispositions (contact_id, rep_id, disposition, note, created_at)
    VALUES (@contact_id, @rep_id, @disposition, @note, @created_at)
  `),
  dispositionsByContact: db.prepare(`SELECT * FROM sales_dispositions WHERE contact_id=? ORDER BY created_at DESC`),
  lastDispositionForContact: db.prepare(`
    SELECT * FROM sales_dispositions WHERE contact_id=? ORDER BY created_at DESC LIMIT 1
  `),
  callAttemptCount: db.prepare(`
    SELECT COUNT(*) as n FROM sales_dispositions
    WHERE contact_id=? AND disposition IN ('no_answer','voicemail','spoke_follow_up')
  `),

  upsertLeadState: db.prepare(`
    INSERT INTO sales_lead_state (contact_id, rep_id, priority_override, snoozed_until, updated_at)
    VALUES (@contact_id, @rep_id, @priority_override, @snoozed_until, @updated_at)
    ON CONFLICT(contact_id) DO UPDATE SET
      rep_id=excluded.rep_id, priority_override=excluded.priority_override,
      snoozed_until=excluded.snoozed_until, updated_at=excluded.updated_at
  `),
  getLeadState: db.prepare(`SELECT * FROM sales_lead_state WHERE contact_id=?`),

  upsertSettings: db.prepare(`
    INSERT INTO sales_settings (rep_id, config, updated_at) VALUES (@rep_id, @config, @updated_at)
    ON CONFLICT(rep_id) DO UPDATE SET config=excluded.config, updated_at=excluded.updated_at
  `),
  getSettings: db.prepare(`SELECT * FROM sales_settings WHERE rep_id=?`),

  upsertSavedView: db.prepare(`
    INSERT INTO sales_saved_views (id, rep_id, name, config, created_at)
    VALUES (@id, @rep_id, @name, @config, @created_at)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, config=excluded.config
  `),
  savedViewsByRep: db.prepare(`SELECT * FROM sales_saved_views WHERE rep_id=? ORDER BY created_at DESC`),
  deleteSavedView: db.prepare(`DELETE FROM sales_saved_views WHERE id=?`),
};

// Seed a single internal rep so the app works before any real auth/GHL user
// linkage exists. ghl_user_id stays null until the CEO adds this person as a
// GHL user — nothing else in the app needs to change when that happens.
salesStmts.upsertRep.run({
  id: DEFAULT_REP_ID, name: 'Sales Rep', email: null, ghl_user_id: null,
  active: 1, created_at: Date.now(),
});

function getOpportunityCount() {
  return db.prepare(`SELECT COUNT(*) as n FROM pipeline_opportunities`).get().n;
}

function getConversationCount() {
  return db.prepare(`SELECT COUNT(*) as n FROM conversations`).get().n;
}

function addFollowup(row) {
  const info = salesStmts.addFollowup.run(row);
  return { id: info.lastInsertRowid, ...row };
}
function completeFollowup(id)  { salesStmts.completeFollowup.run({ id, ts: Date.now() }); }
function cancelFollowup(id)    { salesStmts.cancelFollowup.run({ id, ts: Date.now() }); }
function getOpenFollowupForContact(contactId) { return salesStmts.openFollowupForContact.get(contactId) || null; }
function getFollowupsForContact(contactId)    { return salesStmts.followupsByContact.all(contactId); }
function getOpenFollowups()                   { return salesStmts.openFollowups.all(); }

function addNote(row) {
  const info = salesStmts.addNote.run(row);
  return { id: info.lastInsertRowid, ...row };
}
function getNotesForContact(contactId) { return salesStmts.notesByContact.all(contactId); }

function addDisposition(row) {
  const info = salesStmts.addDisposition.run(row);
  return { id: info.lastInsertRowid, ...row };
}
function getDispositionsForContact(contactId) { return salesStmts.dispositionsByContact.all(contactId); }
function getLastDispositionForContact(contactId) { return salesStmts.lastDispositionForContact.get(contactId) || null; }
function getCallAttemptCount(contactId) { return salesStmts.callAttemptCount.get(contactId).n; }

function setLeadState(row) {
  salesStmts.upsertLeadState.run({ priority_override: null, snoozed_until: null, ...row, updated_at: Date.now() });
  return salesStmts.getLeadState.get(row.contact_id);
}
function getLeadState(contactId) { return salesStmts.getLeadState.get(contactId) || null; }

function getSalesSettings(repId = DEFAULT_REP_ID) {
  const row = salesStmts.getSettings.get(repId);
  return row ? JSON.parse(row.config) : null;
}
function saveSalesSettings(repId, config) {
  salesStmts.upsertSettings.run({ rep_id: repId, config: JSON.stringify(config), updated_at: Date.now() });
  return config;
}

function getSavedViews(repId = DEFAULT_REP_ID) {
  return salesStmts.savedViewsByRep.all(repId).map(r => ({ ...r, config: JSON.parse(r.config) }));
}
function saveSavedView(row) {
  salesStmts.upsertSavedView.run(row);
  return getSavedViews(row.rep_id);
}
function deleteSavedView(id) { salesStmts.deleteSavedView.run(id); }

function getRep(id = DEFAULT_REP_ID) { return salesStmts.getRep.get(id) || null; }
function getReps() { return salesStmts.getReps.all(); }

// Booking lookup by phone — the only reliable join available today, because
// Setmore appointments are never written back to GHL with a contact id (see
// fetchSetmoreData). See sales-api/booking-source.js for how this is used.
function getBookingsByPhone(phoneDigitsStr) {
  if (!phoneDigitsStr) return [];
  return db.prepare(`
    SELECT * FROM bookings WHERE phone = ? ORDER BY starts_at DESC
  `).all(phoneDigitsStr);
}
function getBookingsByContactId(contactId) {
  return db.prepare(`SELECT * FROM bookings WHERE contact_id = ? ORDER BY starts_at DESC`).all(contactId);
}

// ── AI Copilot ───────────────────────────────────────────────────────────────

const copilotStmts = {
  upsertConversation: db.prepare(`
    INSERT INTO copilot_conversations (id, rep_id, title, created_at, updated_at)
    VALUES (@id, @rep_id, @title, @created_at, @updated_at)
    ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
  `),
  touchConversation: db.prepare(`UPDATE copilot_conversations SET updated_at = @ts WHERE id = @id`),
  listConversations: db.prepare(`SELECT * FROM copilot_conversations WHERE rep_id = ? ORDER BY updated_at DESC LIMIT ?`),
  getConversation: db.prepare(`SELECT * FROM copilot_conversations WHERE id = ?`),
  deleteConversation: db.prepare(`DELETE FROM copilot_conversations WHERE id = ?`),
  addMessage: db.prepare(`
    INSERT INTO copilot_messages (conversation_id, role, body, tool_calls, created_at)
    VALUES (@conversation_id, @role, @body, @tool_calls, @created_at)
  `),
  messagesForConversation: db.prepare(`SELECT * FROM copilot_messages WHERE conversation_id = ? ORDER BY created_at ASC`),
  addClassification: db.prepare(`
    INSERT INTO ai_lead_classifications (contact_id, classification, confidence, reason, model, created_at)
    VALUES (@contact_id, @classification, @confidence, @reason, @model, @created_at)
  `),
  classificationsForContact: db.prepare(`SELECT * FROM ai_lead_classifications WHERE contact_id = ? ORDER BY created_at DESC LIMIT 10`),
};

function createCopilotConversation(id, repId, title) {
  const now = Date.now();
  copilotStmts.upsertConversation.run({ id, rep_id: repId, title, created_at: now, updated_at: now });
  return copilotStmts.getConversation.get(id);
}
function touchCopilotConversation(id) { copilotStmts.touchConversation.run({ id, ts: Date.now() }); }
function listCopilotConversations(repId, limit = 50) { return copilotStmts.listConversations.all(repId, limit); }
function getCopilotConversation(id) { return copilotStmts.getConversation.get(id) || null; }
function deleteCopilotConversation(id) { copilotStmts.deleteConversation.run(id); }
function addCopilotMessage(row) { copilotStmts.addMessage.run(row); }
function getCopilotMessages(conversationId) {
  return copilotStmts.messagesForConversation.all(conversationId).map(m => ({
    ...m, tool_calls: m.tool_calls ? JSON.parse(m.tool_calls) : [],
  }));
}
function addAiClassification(row) { copilotStmts.addClassification.run(row); }
function getAiClassifications(contactId) { return copilotStmts.classificationsForContact.all(contactId); }

const callCoachingStmts = {
  add: db.prepare(`
    INSERT INTO call_coaching (contact_id, rep_id, source, call_duration, call_status, transcript, analysis, model, created_at)
    VALUES (@contact_id, @rep_id, @source, @call_duration, @call_status, @transcript, @analysis, @model, @created_at)
  `),
  forContact: db.prepare(`SELECT * FROM call_coaching WHERE contact_id = ? ORDER BY created_at DESC`),
};
function addCallCoaching(row) {
  const info = callCoachingStmts.add.run(row);
  return { id: info.lastInsertRowid, ...row };
}
function getCallCoachingForContact(contactId) {
  return callCoachingStmts.forContact.all(contactId).map(r => ({ ...r, analysis: r.analysis ? JSON.parse(r.analysis) : null }));
}

// ── Query helpers ─────────────────────────────────────────────────────────────

function getAdMetricsRange(entityType, entityId, fromDate, toDate) {
  return db.prepare(`
    SELECT * FROM ad_metrics_daily
    WHERE entity_type=? AND entity_id=? AND date>=? AND date<=?
    ORDER BY date ASC
  `).all(entityType, entityId, fromDate, toDate);
}

function getContactCount() {
  return db.prepare(`SELECT COUNT(*) as n FROM contacts`).get().n;
}

function getRecentContacts(limit = 50) {
  return db.prepare(`
    SELECT * FROM contacts ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

function getIntegrationStatus() {
  return stmts.getIntegrations.all();
}

module.exports = {
  db,
  stmts,
  batchUpsertAds,
  batchUpsertAdSets,
  batchUpsertCampaigns,
  batchUpsertAdMetrics,
  batchUpsertContacts,
  batchUpsertOpportunities,
  batchUpsertBookings,
  batchUpsertPosts,
  batchUpsertPostMetrics,
  batchUpsertAffiliateMetrics,
  getAdMetricsRange,
  getContactCount,
  getOpportunityCount,
  getConversationCount,
  getRecentContacts,
  getIntegrationStatus,
  // Maintenance clients
  getMaintenanceClients,
  getMaintenanceClient,
  saveMaintenanceClient,
  deleteMaintenanceClient,
  recordMaintenanceVisit,
  // Sales Command Center
  DEFAULT_REP_ID,
  getRep,
  getReps,
  addFollowup,
  completeFollowup,
  cancelFollowup,
  getOpenFollowupForContact,
  getFollowupsForContact,
  getOpenFollowups,
  addNote,
  getNotesForContact,
  addDisposition,
  getDispositionsForContact,
  getLastDispositionForContact,
  getCallAttemptCount,
  setLeadState,
  getLeadState,
  getSalesSettings,
  saveSalesSettings,
  getSavedViews,
  saveSavedView,
  deleteSavedView,
  getBookingsByPhone,
  getBookingsByContactId,
  // AI Copilot
  createCopilotConversation,
  touchCopilotConversation,
  listCopilotConversations,
  getCopilotConversation,
  deleteCopilotConversation,
  addCopilotMessage,
  getCopilotMessages,
  addAiClassification,
  getAiClassifications,
  addCallCoaching,
  getCallCoachingForContact,
  DB_PATH,
};
