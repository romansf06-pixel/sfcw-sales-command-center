/**
 * SF City Wash — Sales Command Center (standalone)
 *
 * Extracted from the SF City Wash internal dashboard monorepo
 * (04-Dashboard/SF-City-Wash-Dashboard). Serves the /sales rep app plus its
 * /api/sales and /api/sales/copilot routers, backed by a SQLite mirror of
 * GoHighLevel contacts/opportunities/conversations and Setmore appointments.
 *
 * This file is a trimmed-down server.js: only what /sales, /api/sales and
 * /api/sales/copilot actually need to run — GHL/Setmore sync, the API auth
 * gate, and the SQLite db module. The full dashboard (Content Lab, GBP,
 * Meta Ads, field ops, etc.) is NOT part of this repo.
 */
require("dotenv").config();
const express = require("express");
const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");
const salesRoutes   = require("./sales-api/routes");
const copilotRoutes = require("./sales-ai/routes");

// Normalized SQLite persistence layer
let dbModule = null;
try {
  dbModule = require("./db/index");
  console.log(`[DB] SQLite open at ${dbModule.DB_PATH}`);
} catch (e) {
  console.warn("[DB] SQLite unavailable — running JSON-only mode:", e.message);
}

let _anthropic = null;
function getAI() {
  // Some Anthropic API keys are organization-level rather than scoped to one
  // workspace — Anthropic then requires an explicit anthropic-workspace-id
  // header on every request. Harmless to set unconditionally: the SDK only
  // sends a header when defaultHeaders actually has a value.
  if (!_anthropic && process.env.ANTHROPIC_API_KEY)
    _anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : undefined,
    });
  return _anthropic;
}

// claude-sonnet-4-6 pricing ($/million tokens)
const AI_PRICES = { input: 3.0, output: 15.0, model: "claude-sonnet-4-6" };
const MODEL_PRICES = { "claude-sonnet-4-6": AI_PRICES, "claude-opus-5": { input: 5.0, output: 25.0 } };

function trackAIUsage(endpoint, usage, model = AI_PRICES.model) {
  if (!usage) return;
  try {
    const data = readData("anthropic-usage.json") || { calls: [], totals: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 } };
    const price = MODEL_PRICES[model] || AI_PRICES;
    const cost = ((usage.input_tokens || 0) * price.input + (usage.output_tokens || 0) * price.output) / 1_000_000;
    data.calls.unshift({
      timestamp:    new Date().toISOString(),
      endpoint, model,
      inputTokens:  usage.input_tokens  || 0,
      outputTokens: usage.output_tokens || 0,
      cost:         +cost.toFixed(6),
    });
    if (data.calls.length > 200) data.calls = data.calls.slice(0, 200);
    data.totals.calls        = (data.totals.calls        || 0) + 1;
    data.totals.inputTokens  = (data.totals.inputTokens  || 0) + (usage.input_tokens  || 0);
    data.totals.outputTokens = (data.totals.outputTokens || 0) + (usage.output_tokens || 0);
    data.totals.cost         = +((data.totals.cost || 0) + cost).toFixed(6);
    writeData("anthropic-usage.json", data);
  } catch (e) { console.error("trackAIUsage error:", e.message); }
}

const app  = express();
const PORT = process.env.PORT || 3002;

// ── Data directory ───────────────────────────────────────────────────────────
const DATA_DIR    = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, "data");
const BUNDLED_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── API access gate ──────────────────────────────────────────────────────────
// Same convention as the main dashboard: DASHBOARD_SECRET gates every /api/*
// route. Opt-in — leave it unset and the app behaves exactly as before (and
// warns on boot). The Sales Command Center frontend (sales/js/api.js) sends
// the key via x-dashboard-key header, using the same localStorage key
// ('sfcw_dashboard_key') and ?key= bootstrap convention as the main dashboard,
// so the two apps can share one key if deployed together.
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET || "";
const OPEN_PATHS = new Set(["/api/health", "/api/status"]);
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || "";
const WEBHOOK_PATHS = new Set(); // no webhook-only routes in this standalone app

if (!DASHBOARD_SECRET) {
  console.warn("[auth] DASHBOARD_SECRET is not set. Every /api/ route is readable by "
             + "anyone with this URL, including customer names and phone numbers. "
             + "Set DASHBOARD_SECRET to close it.");
} else {
  console.log("[auth] API gate ON. /api/* requires x-dashboard-key (or ?key= once).");
}

function secretEq(given, expected) {
  return !!expected && given.length === expected.length && given === expected;
}

function normPath(p) {
  const t = p.replace(/\/+$/, "").toLowerCase();
  return t === "" ? "/" : t;
}

function isMachinePath(p) {
  const n = normPath(p);
  return WEBHOOK_PATHS.has(n) || n.startsWith("/api/cron/");
}

const authFailures = [];
function recordAuthFailure(req) {
  const fp = v => v ? `${v.length}ch:${crypto.createHash("sha256").update(v).digest("hex").slice(0, 8)}` : null;
  authFailures.unshift({
    time: new Date().toISOString(), method: req.method, path: req.originalUrl,
    creds: {
      xWebhookToken: fp(req.get("x-webhook-token") || ""),
      xDashboardKey: fp(req.get("x-dashboard-key") || ""),
      queryKey:      fp(String(req.query.key || "")),
    },
  });
  if (authFailures.length > 40) authFailures.pop();
  console.warn(`[auth] REJECTED ${req.method} ${req.originalUrl}`);
}

function apiGate(req, res, next) {
  if (!DASHBOARD_SECRET) return next();
  if (!req.path.startsWith("/api/")) return next();
  if (OPEN_PATHS.has(normPath(req.path))) return next();

  const given = req.get("x-dashboard-key") || req.query.key || "";
  if (secretEq(given, DASHBOARD_SECRET)) return next();

  if (isMachinePath(req.path) && req.method === "POST") {
    const bearer = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const tok = req.get("x-webhook-token") || req.query.token || bearer || "";
    if (secretEq(tok, WEBHOOK_TOKEN)) return next();
  }
  recordAuthFailure(req);
  return res.status(401).json({
    ok: false, unauthorized: true, path: req.path,
    message: "This app serves customer names and phone numbers. Send the x-dashboard-key header, or open it once with ?key=<secret>.",
  });
}

function dataPath(file) {
  const primary = path.join(DATA_DIR, file);
  if (fs.existsSync(primary)) return primary;
  const bundled = path.join(BUNDLED_DIR, file);
  return fs.existsSync(bundled) ? bundled : primary;
}
function readData(file) {
  const p = dataPath(file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function writeData(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-dashboard-key");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(apiGate);

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "sfcw-sales-command-center" }));
app.get("/api/status", (_req, res) => res.json({ ok: true, locked: !!DASHBOARD_SECRET }));

function phoneDigits(v) { return String(v || "").replace(/\D/g, "").slice(-10); }

// ── GoHighLevel ───────────────────────────────────────────────────────────────
const GHL_LOCATION = "5Fa5nmnU3b4QtjdeIuB3";
const GHL_BASE     = "https://services.leadconnectorhq.com";

let STAGE_MAP = {};
let PIPELINE_MAP = {};
let PIPELINE_LIST = []; // [{id, name, stages:[{id,name,color,position}]}] — written to disk for sales-ai's get_pipeline_list tool

const VEHICLE_FIELD           = "Zo7VGrqqAzSeRBLpzyLI"; // "Vehicle Info" (free text)
const SERVICE_NEEDED_FIELD    = "8cEHoME24qpGU0cq0loO"; // "Service Needed " (SINGLE_OPTIONS) — primary
const SERVICE_CATEGORY_FIELD  = "GMwSkJaDvHTpjV9XoNAs"; // "Service Category" (SINGLE_OPTIONS)
const EXACT_PACKAGE_FIELD     = "lgx2uUmEXAHnpzCR37Db"; // "Exact Service Package" (TEXT)
const NOTES_FIELD             = "7iMKcZiGAPfNVkLnnQwa"; // "Anything we should know?"
const QUOTE_FIELD             = "62NNkg7BX1zOKvTnbRLm"; // "Quoted price" (MONETORY)
const URGENCY_FIELD           = "9NzQxoFi6CFQIlbxhOF2"; // "Urgency" (SINGLE_OPTIONS)
const VEHICLE_YEAR_FIELD      = "tKCcbsQfcaKuOs3QhlVc";
const VEHICLE_MAKE_FIELD      = "yg50D055FrQoOglRxn1c";
const VEHICLE_MODEL_FIELD     = "1bkjAoJSTWdvkRb1Cxf3";
const CONFIRMED_DATE_FIELD    = "1mTNfTSjkn6lwGlnVJN4"; // "Confirmed Appointment Date"
const CONFIRMED_TIME_FIELD    = "Im6uUfPl5nn6JdJIcXKw"; // "Confirmed Appointment Time"
const ZIP_FIELD               = "W3RD8PZym9XNffEDgfqx"; // "ZIP Code"

function ghlHeaders() {
  return { Authorization: `Bearer ${process.env.GHL_API_KEY}`, Version: "2021-07-28", "Content-Type": "application/json" };
}

// GHL's contacts and opportunities endpoints both cap a single page at 100
// records and expose the next page via meta.startAfter/meta.startAfterId.
async function ghlPaginated(url, baseParams, itemsKey) {
  let items = [];
  let params = { ...baseParams, limit: 100 };
  for (let page = 0; page < 80; page++) { // safety cap: 8,000 records
    const r = await axios.get(url, { headers: ghlHeaders(), params, timeout: 20000 });
    const batch = r.data[itemsKey] || [];
    items = items.concat(batch);
    const meta = r.data.meta;
    if (!meta || !meta.nextPage || batch.length < params.limit) break;
    params = { ...baseParams, limit: 100, startAfter: meta.startAfter, startAfterId: meta.startAfterId };
  }
  return items;
}

// Fetches every pipeline + stage for this location, both as a byId map (used
// inline by fetchGHLContacts to resolve stage/pipeline names) and as a side
// effect that populates STAGE_MAP/PIPELINE_MAP/PIPELINE_LIST and writes
// ghl-pipelines.json to disk (read by sales-ai/tools.js's get_pipeline_list
// copilot tool). Cached 30 minutes.
let _pipelineCache = null; // { at, byId }
async function fetchGHLPipelines() {
  if (_pipelineCache && Date.now() - _pipelineCache.at < 30 * 60 * 1000) return _pipelineCache.byId;
  const key = process.env.GHL_API_KEY;
  if (!key) return {};
  try {
    const r = await axios.get(`${GHL_BASE}/opportunities/pipelines`, {
      headers: ghlHeaders(), params: { locationId: GHL_LOCATION }, timeout: 15000,
    });
    const byId = {};
    const newStageMap = {}, newPipelineMap = {};
    for (const p of r.data.pipelines || []) {
      newPipelineMap[p.id] = p.name;
      const stages = (p.stages || []).slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map(s => { newStageMap[s.id] = s.name; return { id: s.id, name: s.name, color: s.color || "#64748B", position: s.position ?? 0 }; });
      byId[p.id] = { id: p.id, name: p.name, stages };
    }
    STAGE_MAP = newStageMap;
    PIPELINE_MAP = newPipelineMap;
    PIPELINE_LIST = Object.values(byId);
    writeData("ghl-pipelines.json", { pipelines: PIPELINE_LIST, fetchedAt: new Date().toISOString() });
    _pipelineCache = { at: Date.now(), byId };
    console.log(`✅ GHL pipelines synced: ${PIPELINE_LIST.length} pipelines, ${Object.keys(newStageMap).length} stages`);
    return byId;
  } catch (e) {
    console.error("GHL pipelines fetch error:", e.response?.data?.message || e.message);
    return _pipelineCache?.byId || {};
  }
}

function detectSrc(contact) {
  const attrs  = contact.attributions || [];
  const medium = (attrs.find(a => a.medium)?.medium || "").toLowerCase();
  const session= (attrs[0]?.utmSessionSource || "").toLowerCase();
  const name   = contact.contactName || "";
  if (medium.includes("instagram"))                                            return "instagram";
  if (["other","conversation"].includes(medium) || session === "other")        return "phone";
  if (medium === "form" || (contact.source||"").toLowerCase().includes("form"))return "lead_form";
  if (medium.includes("facebook") || (contact.source||"").toLowerCase().includes("lead")) return "lead_form";
  if (medium === "manual" || session.includes("crm") || session.includes("workflow")) return "manual";
  if (name.startsWith("(") || (name.length > 5 && name.slice(1).replace(/[-+ ]/g,"").match(/^\d+$/))) return "phone";
  return "manual";
}

async function fetchGHLContacts() {
  const key = process.env.GHL_API_KEY;
  if (!key) { console.log("GHL_API_KEY not set — skipping auto-fetch"); return null; }
  try {
    const [contacts, opps] = await Promise.all([
      ghlPaginated(`${GHL_BASE}/contacts/`, { locationId: GHL_LOCATION, sortBy: "date_added" }, "contacts"),
      ghlPaginated(`${GHL_BASE}/opportunities/search`, { location_id: GHL_LOCATION, status: "all" }, "opportunities"),
    ]);

    let pipes = {};
    try { pipes = await fetchGHLPipelines(); } catch (e) { console.warn("GHL pipelines:", e.message); }
    const stageName = {};
    for (const p of Object.values(pipes)) for (const st of p.stages) stageName[st.id] = st.name;
    const stageMap = {};
    for (const o of opps) {
      const cid = o.contactId || o.contact?.id;
      if (!cid) continue;
      const t = new Date(o.updatedAt || o.createdAt || 0).getTime();
      if (!stageMap[cid] || t > stageMap[cid].t) {
        stageMap[cid] = {
          t,
          stage:    stageName[o.pipelineStageId] || STAGE_MAP[o.pipelineStageId] || "",
          pipeline: pipes[o.pipelineId]?.name   || PIPELINE_MAP[o.pipelineId]    || "",
          status:   o.status || "open",
        };
      }
    }

    function resolveService(cf) {
      return cf[SERVICE_NEEDED_FIELD] || cf[SERVICE_CATEGORY_FIELD] || cf[EXACT_PACKAGE_FIELD] || null;
    }

    const leads = contacts.map(c => {
      const cf = Object.fromEntries((c.customFields||[]).map(f=>[f.id,f.value]));
      const si = stageMap[c.id] || {};
      return {
        id: c.id, name: c.contactName || [c.firstName,c.lastName].filter(Boolean).join(" ") || "Unknown",
        phone: c.phone || null, email: c.email || null, src: detectSrc(c),
        city: c.city || null, state: c.state || null, photo: c.profilePhoto || null,
        date: c.dateAdded, tags: c.tags || [],
        vehicle: cf[VEHICLE_FIELD] || null, service: resolveService(cf),
        stage: si.stage || "", pipeline: si.pipeline || "", dealStatus: si.status || "",
      };
    });

    const payload = { totalContacts: contacts.length, recentLeads: leads.slice(0, 300), pipelineActivity: [], lastUpdated: new Date().toISOString() };
    writeData("ghl-data.json", payload);

    if (dbModule) {
      try {
        const now = Date.now();
        dbModule.batchUpsertContacts(contacts.map(c => {
          const cf = Object.fromEntries((c.customFields||[]).map(f=>[f.id,f.value]));
          return {
            id: c.id, ghl_id: c.id,
            first_name: c.firstName || null, last_name: c.lastName || null,
            email: c.email || null, phone: c.phone || null,
            source: detectSrc(c), tags: JSON.stringify(c.tags || []),
            vehicle: cf[VEHICLE_FIELD] || null, service: resolveService(cf),
            assigned_to: c.assignedTo || null,
            ghl_notes: cf[NOTES_FIELD] || null,
            quoted_price: cf[QUOTE_FIELD] != null ? parseFloat(cf[QUOTE_FIELD]) || null : null,
            urgency: cf[URGENCY_FIELD] || null,
            service_category: cf[SERVICE_CATEGORY_FIELD] || null,
            vehicle_year: cf[VEHICLE_YEAR_FIELD] || null,
            vehicle_make: cf[VEHICLE_MAKE_FIELD] || null,
            vehicle_model: cf[VEHICLE_MODEL_FIELD] || null,
            confirmed_appt_date: cf[CONFIRMED_DATE_FIELD] || null,
            confirmed_appt_time: cf[CONFIRMED_TIME_FIELD] || null,
            city: c.city || null, state: c.state || null, zip: cf[ZIP_FIELD] || c.postalCode || null,
            created_at: c.dateAdded ? new Date(c.dateAdded).getTime() : now,
            updated_at: now, synced_at: now,
          };
        }));
        const knownContacts = new Set(contacts.map(c => c.id));
        dbModule.batchUpsertOpportunities(opps.map(o => ({
          id: o.id, ghl_id: o.id,
          contact_id: knownContacts.has(o.contactId || o.contact?.id) ? (o.contactId || o.contact?.id) : null,
          name: o.name || null,
          stage: STAGE_MAP[o.pipelineStageId] || o.pipelineStageId || null,
          pipeline: PIPELINE_MAP[o.pipelineId] || o.pipelineId || null,
          monetary_value: parseFloat(o.monetaryValue || 0),
          status: o.status || "open",
          created_at: o.createdAt ? new Date(o.createdAt).getTime() : now,
          updated_at: o.updatedAt ? new Date(o.updatedAt).getTime() : now,
          synced_at: now,
        })));
        dbModule.stmts.setIntegrationOk.run({ id: "ghl", ts: now, records: contacts.length });
      } catch (dbErr) { console.error("[DB] GHL write error:", dbErr.message); }
    }

    console.log(`✅ GHL synced: ${leads.length} contacts`);
    return payload;
  } catch (e) {
    if (dbModule) { try { dbModule.stmts.setIntegrationErr.run({ id: "ghl", ts: Date.now(), error: e.message }); } catch (_) {} }
    console.error("GHL fetch error:", e.response?.data?.message || e.message);
    return null;
  }
}

// GHL's conversations/search endpoint has no pagination cursor — max page size
// is 100, sorted by last_message_date desc, which is exactly "everything
// active enough to possibly need a reply right now."
async function syncGHLConversations(limit = 100) {
  const key = process.env.GHL_API_KEY;
  if (!key) return null;
  const searchRes = await axios.get(`${GHL_BASE}/conversations/search`, {
    headers: ghlHeaders(),
    params: { locationId: GHL_LOCATION, limit: Math.min(limit, 100), sort: "desc", sortBy: "last_message_date" },
    timeout: 15000,
  });
  const convs = searchRes.data.conversations || [];

  const ghlData = readData("ghl-data.json") || {};
  const contactIndex = Object.fromEntries((ghlData.recentLeads || []).map(c => [c.id, c]));

  const conversations = convs.map(c => {
    const contact = contactIndex[c.contactId] || {};
    const platform = c.type === "TYPE_PHONE" ? "call/text"
      : c.type === "instagram" ? "instagram"
      : c.type === "facebook" ? "facebook"
      : c.type === "sms" ? "sms"
      : c.type === "email" ? "email"
      : c.type || "unknown";
    return {
      id: c.id, contact_id: c.contactId,
      contact_name: contact.name || c.contactName || c.fullName || "Unknown",
      platform, last_message: c.lastMessageBody || "",
      last_msg_at: c.lastMessageDate || c.dateUpdated || null,
      direction: c.lastMessageDirection || null,
      unread: c.unreadCount || 0,
      stage: contact.stage || "", pipeline: contact.pipeline || "",
      vehicle: contact.vehicle || null, service: contact.service || null,
      phone: contact.phone || null,
    };
  });

  if (dbModule) {
    try {
      const now = Date.now();
      const rows = conversations.map(c => ({
        id: c.id, ghl_id: c.id, contact_id: c.contact_id,
        platform: c.platform, last_message: c.last_message.slice(0, 500),
        last_msg_at: c.last_msg_at ? new Date(c.last_msg_at).getTime() : null,
        last_message_direction: c.direction, unread: c.unread, synced_at: now,
      }));
      const upsert = dbModule.db.prepare(`
        INSERT INTO conversations (id, ghl_id, contact_id, platform, last_message, last_msg_at, last_message_direction, unread, synced_at)
        VALUES (@id, @ghl_id, @contact_id, @platform, @last_message, @last_msg_at, @last_message_direction, @unread, @synced_at)
        ON CONFLICT(ghl_id) DO UPDATE SET
          last_message=excluded.last_message, last_msg_at=excluded.last_msg_at,
          last_message_direction=excluded.last_message_direction,
          unread=excluded.unread, synced_at=excluded.synced_at
      `);
      const upsertAll = dbModule.db.transaction(r => r.forEach(x => upsert.run(x)));
      upsertAll(rows);
      dbModule.stmts.setIntegrationOk.run({ id: "ghl", ts: now, records: conversations.length });
    } catch (dbErr) { console.error("[DB] Conversations write error:", dbErr.message); }
  }

  return { conversations, total: searchRes.data.total || convs.length };
}

// ── Setmore ───────────────────────────────────────────────────────────────────
const SETMORE_OAUTH = "https://developer.setmore.com/api/v1/o/oauth2/token";
const SETMORE_API   = "https://developer.setmore.com/api/v1/bookingapi";
let _setmoreToken = null, _setmoreTokenExpiry = 0;

async function getSetmoreToken() {
  if (_setmoreToken && Date.now() < _setmoreTokenExpiry) return _setmoreToken;
  const key = process.env.SETMORE_API_KEY;
  if (!key) return null;
  try {
    const res = await axios.get(SETMORE_OAUTH, { params: { refreshToken: key }, timeout: 10000 });
    _setmoreToken       = res.data?.data?.token?.access_token;
    _setmoreTokenExpiry = Date.now() + 25 * 60 * 1000;
    console.log("✅ Setmore token refreshed");
    return _setmoreToken;
  } catch (e) {
    console.error("Setmore token error:", e.response?.data || e.message);
    return null;
  }
}

async function setmoreGet(pathStr, params, timeout = 15000) {
  const call = async () => {
    const token = await getSetmoreToken();
    if (!token) { const e = new Error("no Setmore token"); e.noToken = true; throw e; }
    return axios.get(`${SETMORE_API}${pathStr}`, { headers: { Authorization: `Bearer ${token}` }, params, timeout });
  };
  try {
    return await call();
  } catch (e) {
    if (e.response?.status !== 401) throw e;
    _setmoreToken = null; _setmoreTokenExpiry = 0;
    console.warn(`[setmore] 401 on ${pathStr} - refreshing once`);
    return call();
  }
}

function fmtSetmoreDate(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const m   = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}-${m}-${d.getFullYear()}`;
}

// Setmore times are wall clock; the trailing "Z" is not a real timezone
// marker (verified against the booking Worker, which treats it the same way).
const BUSINESS_TZ = "America/Los_Angeles";
const _tzParts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TZ, hour12: false,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function _tzOffsetMs(ms) {
  const p = Object.fromEntries(_tzParts.formatToParts(new Date(ms)).filter(x => x.type !== "literal").map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ms;
}
function setmoreClock(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let date = "", hh = null, mm = null;
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
  if (iso) { date = iso[1]; hh = +iso[2]; mm = +iso[3]; }
  else {
    const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:[T ](\d{1,2}):(\d{2}))?/);
    if (dmy) { date = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
               hh = dmy[4] != null ? +dmy[4] : null; mm = dmy[5] != null ? +dmy[5] : null; }
  }
  if (!date) return null;
  let label = "";
  if (hh != null) { const ap = hh >= 12 ? "PM" : "AM"; let h12 = hh % 12; if (h12 === 0) h12 = 12; label = `${h12}:${String(mm).padStart(2, "0")} ${ap}`; }
  return { date, h: hh, m: mm, label };
}
function setmoreEpochPT(raw) {
  const c = setmoreClock(raw);
  if (!c || c.h == null) return null;
  const [y, mo, d] = c.date.split("-").map(Number);
  let guess = Date.UTC(y, mo - 1, d, c.h, c.m);
  guess -= _tzOffsetMs(guess);
  guess = Date.UTC(y, mo - 1, d, c.h, c.m) - _tzOffsetMs(guess);
  return guess;
}
function parseSetmoreTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    let h = d.getHours(), min = String(d.getMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${min} ${ampm}`;
  } catch { return iso; }
}
function parseSetmoreDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch { return iso; }
}

const _setmoreCustomers = new Map();

async function fetchSetmoreData() {
  if (!await getSetmoreToken()) return null;
  const backDays = Number(process.env.SETMORE_BACK_DAYS) || 120;
  const fwdDays  = Number(process.env.SETMORE_FORWARD_DAYS) || 45;
  const startDate = fmtSetmoreDate(new Date(Date.now() - backDays * 86400000));
  const endDate   = fmtSetmoreDate(new Date(Date.now() + fwdDays * 86400000));

  const CHUNK_DAYS = 15; // Setmore caps a single /appointments response around 30 rows
  async function fetchAppointmentWindow() {
    const from = Date.now() - backDays * 86400000, to = Date.now() + fwdDays * 86400000;
    const byKey = new Map();
    let capped = false, failures = 0, chunks = 0;
    for (let t = from; t < to; t += CHUNK_DAYS * 86400000) {
      const a = fmtSetmoreDate(new Date(t));
      const b = fmtSetmoreDate(new Date(Math.min(t + (CHUNK_DAYS - 1) * 86400000, to)));
      try {
        const r = await setmoreGet("/appointments", { startDate: a, endDate: b });
        const rows = r.data?.data?.appointments || [];
        if (rows.length >= 30) capped = true;
        for (const x of rows) if (x && x.key) byKey.set(x.key, x);
        chunks++;
      } catch (e) {
        failures++;
        console.error(`Setmore appointments ${a}..${b}:`, e.response?.status || e.message);
      }
    }
    if (capped) console.warn("[setmore] a chunk returned 30+ appointments - the window may still be truncated; lower CHUNK_DAYS.");
    return { appts: [...byKey.values()], failures, chunks };
  }

  try {
    const [apptRes, servRes] = await Promise.allSettled([
      fetchAppointmentWindow(),
      setmoreGet("/services", undefined, 10000),
    ]);

    const apptOut  = apptRes.status === "fulfilled" ? apptRes.value : { appts: [], failures: 1, chunks: 0 };
    const rawAppts = apptOut.appts;
    const rawSvcs  = servRes.status === "fulfilled" ? (servRes.value.data?.data?.services || []) : [];

    console.log(`Setmore raw: ${rawAppts.length} appts, ${rawSvcs.length} services`
      + (apptOut.failures ? ` (${apptOut.failures} of ${apptOut.failures + apptOut.chunks} chunks FAILED)` : ""));

    if (apptOut.failures && !rawAppts.length) {
      console.error("[setmore] every chunk failed - keeping the last good snapshot rather than overwriting it with an empty calendar");
      return null;
    }

    let svcRows = rawSvcs;
    if (!svcRows.length) {
      const cached = readData("setmore.json")?.services || [];
      if (cached.length) {
        console.warn(`[setmore] /services returned nothing - reusing ${cached.length} cached service names`);
        svcRows = cached.map(c => ({ key: c.key, service_name: c.name, cost: c.price, duration: c.duration }));
      }
    }
    const svcMap = Object.fromEntries(svcRows.map(s => [s.key, s]));

    const customerKeys = [...new Set(rawAppts.map(a => a.customer_key).filter(Boolean))];
    await Promise.all(customerKeys
      .filter(k => !_setmoreCustomers.has(k))
      .map(async k => {
        try {
          const r = await setmoreGet(`/customer/${encodeURIComponent(k)}`, undefined, 8000);
          const c = r.data?.data?.customer || r.data?.data || {};
          const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
          _setmoreCustomers.set(k, { name: name || null, phone: c.cell_phone || c.work_phone || null });
        } catch (e) {
          _setmoreCustomers.set(k, { name: null, phone: null, unavailable: e.response?.status || e.message });
        }
      }));

    const appointments = rawAppts.map(a => {
      const svc   = svcMap[a.service_key] || {};
      const price = parseFloat(a.cost || svc.cost || 0);
      const dateStr = parseSetmoreDate(a.start_time);
      const cust  = _setmoreCustomers.get(a.customer_key) || {};
      const sc = setmoreClock(a.start_time), ec = setmoreClock(a.end_time);
      return {
        key: a.key, date: sc ? sc.date : dateStr,
        startRaw: a.start_time || null,
        startsAtMs: setmoreEpochPT(a.start_time), endsAtMs: setmoreEpochPT(a.end_time),
        startTime: sc ? sc.label : parseSetmoreTime(a.start_time),
        endTime: ec ? ec.label : parseSetmoreTime(a.end_time),
        serviceName: svc.service_name || "Service", serviceKey: a.service_key || "",
        servicePrice: price,
        customerName: cust.name || null, customerPhone: cust.phone || null,
        customerKey: a.customer_key || "", staffName: "",
        comment: a.comment || "", label: a.label || "No label", status: "confirmed",
      };
    });

    appointments.sort((a, b) => {
      const da = new Date(a.date + "T" + (a.startTime || "00:00"));
      const db = new Date(b.date + "T" + (b.startTime || "00:00"));
      return da - db;
    });

    const services = svcRows.map(s => ({ key: s.key, name: s.service_name || "", price: parseFloat(s.cost || 0), duration: s.duration || null }));

    const isoWin = d => { const [dd, mm, yy] = d.split("-"); return `${yy}-${mm}-${dd}`; };
    let merged = appointments;
    if (apptOut.failures) {
      const prev = readData("setmore.json")?.appointments || [];
      const byKey = new Map(prev.map(a => [a.key, a]));
      for (const a of appointments) byKey.set(a.key, a);
      merged = [...byKey.values()].sort((a, b) => (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || "")));
      console.warn(`[setmore] ${apptOut.failures} chunk(s) failed - merged ${appointments.length} fresh rows onto ${prev.length} cached, keeping ${merged.length}`);
    }

    const data = { appointments: merged, services, window: { from: isoWin(startDate), to: isoWin(endDate) }, fetchedAt: new Date().toISOString(), partial: apptOut.failures > 0 || undefined };
    writeData("setmore.json", data);

    if (dbModule) {
      try {
        const now = Date.now();
        dbModule.batchUpsertBookings(merged.map(a => ({
          id: a.key, setmore_id: a.key, contact_id: null,
          service: a.serviceName, vehicle: null,
          starts_at: a.startsAtMs || null, ends_at: a.endsAtMs || null,
          status: a.status || "confirmed", staff: a.staffName || null,
          phone: phoneDigits(a.customerPhone), customer_name: a.customerName || null,
          synced_at: now,
        })));
        dbModule.stmts.setIntegrationOk.run({ id: "setmore", ts: now, records: appointments.length });
      } catch (dbErr) { console.error("[DB] Setmore write error:", dbErr.message); }
    }

    console.log(`✅ Setmore synced: ${appointments.length} appointments`);
    return data;
  } catch (e) {
    if (dbModule) { try { dbModule.stmts.setIntegrationErr.run({ id: "setmore", ts: Date.now(), error: e.message }); } catch (_) {} }
    console.error("Setmore fetch error:", e.response?.data || e.message);
    return null;
  }
}

// ── Sales Command Center ──────────────────────────────────────────────────────
app.use("/sales", express.static(path.join(__dirname, "sales")));
app.get("/", (_req, res) => res.redirect("/sales/"));

app.use("/api/sales", salesRoutes({
  dbModule, axios, GHL_BASE, GHL_LOCATION, ghlHeaders, getAI,
  syncNow: async () => {
    await Promise.all([
      (async () => { await fetchGHLPipelines(); await fetchGHLContacts(); })(),
      syncGHLConversations(),
      fetchSetmoreData(),
    ]);
    return { ok: true };
  },
}));
app.use("/api/sales/copilot", copilotRoutes({ dbModule, axios, GHL_BASE, GHL_LOCATION, ghlHeaders, readData, getAI, trackUsage: trackAIUsage }));

app.listen(PORT, async () => {
  console.log(`🚀 Sales Command Center listening on :${PORT}`);
  console.log(`   /sales           — rep app`);
  console.log(`   /api/sales/*     — queue, leads, call list, bookings`);
  console.log(`   /api/sales/copilot/* — AI copilot`);
  console.log();

  const GHL_SYNC_MINUTES = 2;
  let ghlContactsSyncInFlight = false;
  async function runGHLContactsSync() {
    if (ghlContactsSyncInFlight) return;
    ghlContactsSyncInFlight = true;
    try { await fetchGHLPipelines(); await fetchGHLContacts(); }
    catch (e) { console.error("GHL contacts sync:", e.message); }
    finally { ghlContactsSyncInFlight = false; }
  }
  if (process.env.GHL_API_KEY) {
    console.log("📋 Fetching GHL pipelines + contacts on startup...");
    await fetchGHLPipelines();
    await fetchGHLContacts();
    setInterval(runGHLContactsSync, GHL_SYNC_MINUTES * 60 * 1000);
    console.log(`📋 GHL auto-sync every ${GHL_SYNC_MINUTES} minutes`);

    const GHL_CONVO_SYNC_MINUTES = 1;
    syncGHLConversations().catch(e => console.error("GHL conversations sync (startup):", e.message));
    setInterval(() => syncGHLConversations().catch(e => console.error("GHL conversations sync:", e.message)), GHL_CONVO_SYNC_MINUTES * 60 * 1000);
    console.log(`💬 GHL conversations auto-sync every ${GHL_CONVO_SYNC_MINUTES} minute(s)`);
  } else {
    console.log("📋 GHL_API_KEY not set — skipping GHL sync");
  }

  if (process.env.SETMORE_API_KEY) {
    const smLast  = readData("setmore.json")?.fetchedAt;
    const smStale = !smLast || (Date.now() - new Date(smLast).getTime() > 60 * 1000);
    if (smStale) {
      console.log("📅 Fetching Setmore appointments on startup...");
      await fetchSetmoreData();
    } else {
      console.log(`📅 Setmore data fresh (last: ${smLast})`);
    }
    setInterval(() => fetchSetmoreData().catch(e => console.error("Setmore sync:", e.message)), 60 * 1000);
    console.log("📅 Setmore auto-sync every 1 minute");
  } else {
    console.log("📅 Setmore: ⚠️  set SETMORE_API_KEY to enable appointments");
  }
});
