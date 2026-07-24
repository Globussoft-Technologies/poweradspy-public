'use strict';

/**
 * Market Trends — single-file additive feature (router + access + ES aggs).
 *
 * Mounted at /api/v1/intelligence ONLY when config.intelligence.enabled (app.js).
 * Access is granted if EITHER of two independent mechanisms says yes (OR, not
 * either/or-replace — 2026-07-14 decision):
 *   1. config.intelligence.allowedUserIds — a manual override list (empty = everyone),
 *      e.g. for internal testers who should see it regardless of their plan.
 *   2. plan_access_config's `market_trends` filter doc — the real plan-tier gate
 *      (PRD FR-17 beta→GA). Computed directly here (NOT via planAccessMiddleware,
 *      deliberately — that middleware can itself 403/503 a request for reasons
 *      unrelated to Market Trends, e.g. an unrelated restricted filter in the body,
 *      which would wrongly block someone who qualifies via mechanism 1 above).
 * Neither mechanism can break the other: a config.json override always works even
 * if the plan-tier lookup fails, and vice versa. Read-only ES aggregations against
 * the Meta `search_mix` index (fb + ig). Full doc + enable/remove steps:
 * MARKET_TRENDS_MANIFEST.md (repo root). See docs/PLAN_ACCESS.md § "Market Trends
 * beta→GA" for the full history of this decision.
 *
 * NOTE: this is a plain file under services/ (not a folder), so ServiceRegistry
 * does NOT auto-mount it — mounting is flag-gated in app.js only.
 */

const { Router } = require('express');
const config = require('../config');
const databaseManager = require('../database/DatabaseManager');
const serviceRegistry = require('./ServiceRegistry');
const { authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const planAccessService = require('./planAccess/planAccessService');

// ─── Mechanism 1: per-user allow-list (config.json + userId) ─────────────────
// This is a targeted OVERRIDE for specific user IDs, not a toggle for whether
// plan-tier gating applies at all — an empty list contributes NOTHING (final
// access then rests entirely on mechanism 2 below). Previously an empty list
// meant "everyone", which silently made ANY plan-tier restriction on the
// market_trends doc's allowed_plan_ids unenforceable — an admin configuring
// e.g. allowed_plan_ids:[102] via the Plan Access tab saw it have zero effect
// on real access, since this mechanism unconditionally won via OR. Confirmed
// 2026-07-14. To go back to "open to everyone", set market_trends's
// allowed_plan_ids to null (or every current plan ID), not this list.
function isAllowedUser(userId) {
  const allow = config.intelligence?.allowedUserIds || [];
  if (!allow.length) return false;
  if (userId === undefined || userId === null || userId === '') return false;
  return allow.map(String).includes(String(userId));
}

// ─── Mechanism 2: plan-tier gate (plan_access_config's market_trends filter doc) ──
// Self-contained — does not depend on / run planAccessMiddleware, so a failure here
// (no plan_id, DB unreachable, etc.) only means "this mechanism didn't grant access
// this time," never a 500/503 for the whole request. Mechanism 1 is unaffected either way.
async function isAllowedByPlan(req) {
  try {
    const planId = req.user?.userSubscriptionType ?? req.user?.plan_id;
    if (planId === undefined || planId === null) return false;
    const planConfig = await planAccessService.getConfig();
    if (!planConfig || planConfig.length === 0) return false;
    // Preserve the plan-access contract at the feature boundary as well as in
    // getFilterStatus(): null/undefined means unrestricted. This direct check
    // prevents a stale/older shared status implementation in a deployed worker
    // from turning an explicitly open beta feature into a false subscription
    // denial. An explicit [] still means deny everyone and is not bypassed.
    const featureDoc = planConfig.find((doc) => doc._id === 'market_trends');
    if (featureDoc && featureDoc.allowed_plan_ids == null) return true;
    const network = req.body?.network || req.query?.network || 'all';
    const filterStatus = planAccessService.getFilterStatus(planId, network, planConfig);
    return filterStatus?.market_trends?.enabled === true;
  } catch (_e) {
    return false;
  }
}

async function hasMarketTrendsAccess(req) {
  const uid = req.user?.id ?? req.body?.user_id ?? req.query?.user_id;
  if (isAllowedUser(uid)) return true;
  return isAllowedByPlan(req);
}

async function accessGuard(req, res, next) {
  if (await hasMarketTrendsAccess(req)) return marketTrendsCapability(req, res, next);
  return res.status(403).json({
    code: 403,
    message: 'Market Trends is not enabled for this account',
    showSubscriptionModal: true,
    data: [],
  });
}

// ─── Which networks THIS plan sees in Market Trends specifically ────────────
// Checks the market_trends doc's own network_overrides.<planId> FIRST (set via
// the admin Plan Access tab's dedicated "Market Trends Networks" control) —
// this is independent of platform_access (which governs Ads Library search
// access) so an admin can give a plan a different network scope in Market
// Trends analytics without touching what it can actually search. Falls back to
// platform_access's allowedPlatforms when no override has been configured for
// that plan yet, so an unconfigured plan behaves exactly as before this existed.
function resolveMarketTrendsNetworks(planId, planConfig) {
  const doc = planConfig.find((d) => d._id === 'market_trends');
  const override = doc?.network_overrides?.[String(planId)];
  if (Array.isArray(override)) return override;
  return planAccessService.getAllowedPlatforms(planId, planConfig);
}

// ─── Network restriction — clamp the requested network(s) to what this account's
// PLAN actually includes for Market Trends (see resolveMarketTrendsNetworks).
// Previously Market Trends had NO server-side network restriction at all — the
// frontend's network chips only *looked* restricted; the raw API happily
// returned data for any network regardless of plan (bypassable via
// devtools/curl). Runs after accessGuard, so a plan without Market Trends
// access at all never reaches this. Self-contained like the access checks
// above — a lookup failure fails open (no restriction) rather than breaking
// the feature outright; no plan_id at all (e.g. a pure allow-list override
// tester) also skips restriction, matching that mechanism's intent.
async function restrictNetworkToPlan(req, res, next) {
  try {
    const planId = req.user?.userSubscriptionType ?? req.user?.plan_id;
    if (planId === undefined || planId === null) return next();
    const planConfig = await planAccessService.getConfig();
    if (!planConfig || planConfig.length === 0) return next();
    const allowed = resolveMarketTrendsNetworks(planId, planConfig);
    if (!allowed || allowed.length === 0) return next();
    const requested = req.query?.network ?? req.body?.network;
    const requestedList = (!requested || requested === 'all')
      ? allowed
      : String(requested).split(',').map((s) => s.trim().toLowerCase()).filter((n) => allowed.includes(n));
    const clamped = (requestedList.length ? requestedList : allowed).join(',');
    if (req.query) req.query.network = clamped;
    if (req.body) req.body.network = clamped;
  } catch (_e) {
    // fail open — an infra hiccup here shouldn't take down Market Trends entirely
  }
  next();
}

// `stage` (beta/ga label only, NOT an access gate) comes from plan_access_config's
// market_trends doc purely so the frontend can show a BETA badge.
async function getMarketTrendsStage() {
  try {
    const planConfig = await planAccessService.getConfig();
    const doc = planConfig.find((d) => d._id === 'market_trends');
    return doc?.stage || 'beta';
  } catch (_e) {
    return 'beta';
  }
}

// ─── ES helpers ──────────────────────────────────────────────────────────────
function clampInt(v, fb, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min) return fb;
  return n > max ? max : n;
}
function getEs(net = 'facebook') {
  const s = serviceRegistry.getService(net);
  if (s && s.db && s.db.elastic) return s.db.elastic;
  return databaseManager.getElastic(net) || null;
}
function esBody(r) { return r && r.body ? r.body : r; }

// A single dashboard load asks several panels for the same max(last_seen).
// Coalesce only calls that are currently in flight; completed values are not
// retained, so production data freshness is exactly the same as before.
const dateMaxInflight = new WeakMap();
function getCoalescedDateMax(es, field) {
  const index = es.indexName || 'search_mix';
  let entries = dateMaxInflight.get(es);
  if (!entries) { entries = new Map(); dateMaxInflight.set(es, entries); }
  const key = `${index}:${field}`;
  const inflight = entries.get(key);
  if (inflight) return inflight;

  const promise = es.search({
    index,
    request_cache: true,
    body: { size: 0, aggs: { a: { max: { field } } } },
  }).then((r) => esBody(r).aggregations?.a || null);
  entries.set(key, promise);
  promise.then(
    () => { if (entries.get(key) === promise) entries.delete(key); },
    () => { if (entries.get(key) === promise) entries.delete(key); }
  );
  return promise;
}

// Anchor the window to the newest ad (max last_seen), not wall-clock now, so a
// stale/dev index still shows a populated window. Falls back to Date.now().
async function getAnchorMs(es, field = 'facebook_ad.last_seen') {
  if (!es) return Date.now();
  try {
    const v = (await getCoalescedDateMax(es, field))?.value;
    return (typeof v === 'number' && v > 0) ? v : Date.now();
  } catch { return Date.now(); }
}
// Try candidate fields in order; a text field w/o `.keyword` throws → next one.
async function aggWithFallback(es, buildBody, candidates) {
  if (!es) return { ok: false, aggs: {}, reason: 'Elasticsearch connection unavailable' };
  const index = es.indexName || 'search_mix';
  let last = null;
  for (const f of candidates) {
    try {
      const r = await es.search({ index, request_cache: true, body: buildBody(f) });
      return { ok: true, field: f, aggs: esBody(r).aggregations || {} };
    } catch (e) { last = e; }
  }
  return { ok: false, aggs: {}, reason: last ? last.message : 'no candidate field matched the mapping' };
}

// ─── Aggregation query bodies ────────────────────────────────────────────────
const DATE_FMT = "yyyy-MM-dd HH:mm:ss";
// Placeholder/default media the UI hides — excluded from every count.
const PLACEHOLDER = ['*pasvideo*', '*pasimage*', '*bydefault*', '*DefaultImage*'];
const MEDIA_FIELDS = ['new_nas_image_url.keyword', 'Thumbnail.keyword', 'othermedia.keyword'];

// Category / advertiser / CTA aggregations need structured keyword fields that
// exist only on the Meta indexes. Per-network config so the tab can be scoped to
// Facebook or Instagram (both carry advertiser; category/CTA are richest on FB).
const META = {
  facebook: {
    net: 'facebook', label: 'Facebook', date: 'facebook_ad.last_seen',
    category: ['facebook.category.keyword', 'facebook.category'],
    cta: ['facebook_call_to_actions.action.keyword', 'facebook_call_to_actions.action'],
    advertiser: ['facebook_ad_post_owners.post_owner_lower.keyword', 'facebook_ad_post_owners.post_owner_name.keyword'],
    advLabel: 'facebook_ad_post_owners.post_owner_name',
  },
  instagram: {
    net: 'instagram', label: 'Instagram', date: 'instagram_ad.last_seen',
    category: ['instagram.category.keyword', 'instagram.category'],
    cta: ['instagram_call_to_actions.action.keyword', 'instagram_call_to_actions.action'],
    advertiser: ['instagram_ad_post_owners.post_owner_lower.keyword', 'instagram_ad_post_owners.post_owner_name.keyword'],
    advLabel: 'instagram_ad_post_owners.post_owner_name',
  },
  // Other *_search_mix indexes carry the same nested structure — advertiser is
  // populated on all; category on some (native/pinterest); CTA mostly empty.
  native: {
    net: 'native', label: 'Native', date: 'native_ad.last_seen',
    category: ['native.category.keyword', 'native.category'],
    cta: ['native_call_to_actions.action.keyword'],
    advertiser: ['native_ad_post_owners.post_owner_lower.keyword'],
    advLabel: 'native_ad_post_owners.post_owner_name',
  },
  reddit: {
    net: 'reddit', label: 'Reddit', date: 'reddit_ad.last_seen',
    category: ['reddit.category.keyword', 'reddit.category'],
    cta: ['reddit_call_to_actions.action.keyword'],
    advertiser: ['reddit_ad_post_owners.post_owner_lower.keyword'],
    advLabel: 'reddit_ad_post_owners.post_owner_name',
  },
  quora: {
    net: 'quora', label: 'Quora', date: 'quora_ad.last_seen',
    category: ['quora.category.keyword', 'quora.category'],
    cta: ['quora_call_to_actions.action.keyword'],
    advertiser: ['quora_ad_post_owners.post_owner_lower.keyword'],
    advLabel: 'quora_ad_post_owners.post_owner_name',
  },
  pinterest: {
    net: 'pinterest', label: 'Pinterest', date: 'pinterest_ad.last_seen',
    category: ['pinterest.category.keyword', 'pinterest.category'],
    cta: ['pinterest_call_to_actions.action.keyword'],
    advertiser: ['pinterest_ad_post_owners.post_owner_lower.keyword'],
    advLabel: 'pinterest_ad_post_owners.post_owner_name',
  },
  gdn: {
    // GDN is search_mix-style: advertiser + country populated; category/CTA empty.
    net: 'gdn', label: 'GDN', date: 'gdn_ad.last_seen',
    category: ['gdn.category.keyword'], cta: ['gdn_call_to_actions.action.keyword'],
    advertiser: ['gdn_ad_post_owners.post_owner_lower.keyword'],
    advLabel: 'gdn_ad_post_owners.post_owner_name',
  },
  // Flat-schema networks (not *_search_mix) — different field names, no media
  // placeholder fields, partial coverage. Verified against the live indexes:
  google: {
    // per google_ads_data_v2 mapping: category/post_owner_lower/target_keyword
    // are all `keyword`; post_owner_name is text (+.kw). No CTA field.
    net: 'google', label: 'Google', date: 'last_seen', mediaFilter: false,
    category: ['category'], cta: [],
    advertiser: ['post_owner_lower', 'post_owner_name.kw'], advLabel: 'post_owner_name',
  },
  youtube: {
    net: 'youtube', label: 'YouTube', date: 'last_seen', mediaFilter: false,
    category: [], cta: ['call_to_action.keyword'],
    advertiser: [], advLabel: null,
  },
  linkedin: {
    net: 'linkedin', label: 'LinkedIn', date: 'last_seen', mediaFilter: false,
    category: [], cta: ['call_to_action.keyword'],
    advertiser: [], advLabel: null,
  },
};
// Networks that carry SOME structured advertiser/category/CTA data.
const META_ALL = ['facebook', 'instagram', 'native', 'reddit', 'quora', 'pinterest', 'google', 'youtube', 'linkedin', 'gdn'];
// Parse a `network` param that may be 'all', a single slug, or a CSV list.
function parseNetList(network) {
  if (!network || network === 'all') return null; // null = every network
  return String(network).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
}
// Resolve requested network(s) → Meta config(s) + a display label. Honors a CSV
// selection so the compare chips double as a filter; non-Meta networks in the
// selection are ignored here (they lack advertiser/category structured data).
function metaCfgs(network) {
  const list = parseNetList(network);
  const nets = list ? list.filter((n) => META[n]) : META_ALL;
  const cfgs = nets.map((n) => META[n]);
  if (!cfgs.length) return null;
  const label = list ? cfgs.map((c) => c.label).join(', ') : 'All networks';
  return { label, cfgs };
}

const fmt = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
function windowRange(days, anchorMs = Date.now()) {
  return { nowMs: anchorMs, startMs: anchorMs - days * 86400000, prevStartMs: anchorMs - 2 * days * 86400000 };
}
// Parse an optional absolute custom range (YYYY-MM-DD or ISO) → { fromMs, toMs }.
function parseRange(raw) {
  const f = raw.from; const t = raw.to;
  if (!f || !t) return null;
  const fromMs = Date.parse(String(f).length <= 10 ? `${f}T00:00:00Z` : f);
  const toMs = Date.parse(String(t).length <= 10 ? `${t}T23:59:59Z` : t);
  if (isNaN(fromMs) || isNaN(toMs) || toMs < fromMs) return null;
  return { fromMs, toMs };
}
// Resolve the working window: an explicit custom range wins, else last `days`
// anchored to `anchorMs` (the previous window is the same length before it).
function winFrom(days, anchorMs, custom) {
  if (custom) return { nowMs: custom.toMs, startMs: custom.fromMs, prevStartMs: custom.fromMs - (custom.toMs - custom.fromMs) };
  return windowRange(days, anchorMs);
}
function placeholderMustNot() {
  const o = [];
  for (const f of MEDIA_FIELDS) for (const p of PLACEHOLDER) o.push({ wildcard: { [f]: { value: p } } });
  return o;
}
// date in [s,e] AND (for search_mix nets) not a placeholder-media ad — scoped to
// a Meta config's date field. Flat-schema nets (mediaFilter:false) skip the media
// must_not since they don't have those fields.
function windowQueryFor(cfg, s, e, extra = []) {
  const b = { filter: [{ range: { [cfg.date]: { gte: fmt(s), lte: fmt(e), format: DATE_FMT } } }, ...extra] };
  if (cfg.mediaFilter !== false) b.must_not = placeholderMustNot();
  return { bool: b };
}
function categoryBodyFor(cfg, size, field, win, extra = []) {
  const { nowMs, startMs, prevStartMs } = win;
  const t = { terms: { field, size } };
  return {
    size: 0,
    query: windowQueryFor(cfg, prevStartMs, nowMs, extra),
    aggs: {
      current: { filter: { range: { [cfg.date]: { gte: fmt(startMs), lte: fmt(nowMs), format: DATE_FMT } } }, aggs: { items: t } },
      previous: { filter: { range: { [cfg.date]: { gte: fmt(prevStartMs), lt: fmt(startMs), format: DATE_FMT } } }, aggs: { items: t } },
    },
  };
}
// Top movers with period-over-period growth: terms split into current/previous
// windows (mirrors categoryBodyFor) so each advertiser/CTA carries a change %.
function topBodyFor(cfg, size, field, win, subAggs, extra = []) {
  const { nowMs, startMs, prevStartMs } = win;
  return {
    size: 0,
    query: windowQueryFor(cfg, prevStartMs, nowMs, extra),
    aggs: {
      current: { filter: { range: { [cfg.date]: { gte: fmt(startMs), lte: fmt(nowMs), format: DATE_FMT } } }, aggs: { items: { terms: { field, size }, ...(subAggs ? { aggs: subAggs } : {}) } } },
      previous: { filter: { range: { [cfg.date]: { gte: fmt(prevStartMs), lt: fmt(startMs), format: DATE_FMT } } }, aggs: { items: { terms: { field, size } } } },
    },
  };
}

// ─── Controllers ─────────────────────────────────────────────────────────────
const mapBuckets = (b) => (b || []).reduce((o, x) => { o[x.key] = x.doc_count; return o; }, {});
const topHit = (b) => b.label?.hits?.hits?.[0]?._source || null;

async function getOverview(req, res) {
  const raw = { ...req.query, ...req.body };
  const days = clampInt(raw.days, 30, 1, 365);
  // network can be 'all', a single slug, or a CSV list (restrictNetworkToPlan clamps
  // 'all' to a CSV of the plan's allowedPlatforms when that's more than one but not
  // every network — a single-value `only` check here used to silently match zero
  // networks whenever a plan had exactly 2+ (but not all) networks allowed).
  const only = raw.network && raw.network !== 'all'
    ? String(raw.network).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const nets = only ? TREND_NETWORKS.filter((n) => only.includes(n)) : [...TREND_NETWORKS];

  const country = String(raw.country || '').trim();
  const custom = parseRange(raw);
  const trendDates = custom ? { anchorMs: 0, byNet: {} } : await resolveTrendDates(nets);
  const anchorMs = trendDates.anchorMs;
  const startMs = custom ? custom.fromMs : anchorMs - days * 86400000;
  const endMs = custom ? custom.toMs : anchorMs;

  // Per-network daily maps (in parallel), keeping only networks that returned data.
  const maps = {};
  const present = [];
  await Promise.all(nets.map(async (net) => {
    const m = await dailySeries(net, startMs, endMs, country, trendDates.byNet[net]);
    if (m && Object.keys(m).length) { maps[net] = m; present.push(net); }
  }));
  present.sort((a, b) => TREND_NETWORKS.indexOf(a) - TREND_NETWORKS.indexOf(b));

  // Union of dates → one row per day with a count per present network + total.
  const dateSet = new Set();
  for (const net of present) for (const d of Object.keys(maps[net])) dateSet.add(d);
  const dates = [...dateSet].sort();
  const series = dates.map((d) => {
    const row = { date: d };
    let dayTotal = 0;
    for (const net of present) { const c = maps[net][d] || 0; row[net] = c; dayTotal += c; }
    row.total = dayTotal;
    return row;
  });
  const total = series.reduce((s, r) => s + r.total, 0);

  return res.status(200).json({ code: 200, data: { days, networks: present, series, total }, message: 'Ad volume by network' });
}

// Category & advertiser/CTA are Meta-only. If the requested network isn't a Meta
// one, respond with an "unsupported" flag so the UI shows a friendly note.
function unsupported(res, days, network) {
  res.status(200).json({ code: 200, data: { days, network, items: [] }, message: 'unsupported', meta: { unsupported: true, network } });
}

// category current/previous maps for one Meta config (optional country filter).
async function catForCfg(cfg, days, size, country, advertiser, custom) {
  const es = getEs(cfg.net);
  if (!es) return { cur: {}, prev: {} };
  const anchorMs = custom ? 0 : await getAnchorMs(es, cfg.date);
  const win = winFrom(days, anchorMs, custom);
  const extra = extraFilters(cfg.net, country, advertiser);
  const { aggs } = await aggWithFallback(es, (f) => categoryBodyFor(cfg, size, f, win, extra), cfg.category);
  return { cur: mapBuckets(aggs.current?.items?.buckets), prev: mapBuckets(aggs.previous?.items?.buckets) };
}
// top advertiser/CTA buckets [{key,label,current,previous,net}] for one Meta config.
async function topForCfg(cfg, type, days, size, country, advertiser, custom) {
  const es = getEs(cfg.net);
  if (!es) return [];
  const anchorMs = custom ? 0 : await getAnchorMs(es, cfg.date);
  const win = winFrom(days, anchorMs, custom);
  const subAggs = type === 'advertiser' ? { label: { top_hits: { size: 1, _source: [cfg.advLabel] } } } : undefined;
  const extra = extraFilters(cfg.net, country, advertiser);
  const { aggs } = await aggWithFallback(es, (f) => topBodyFor(cfg, size, f, win, subAggs, extra), cfg[type]);
  const prevMap = mapBuckets(aggs.previous?.items?.buckets);
  return (aggs.current?.items?.buckets || []).filter((b) => String(b.key).trim() !== '')
    .map((b) => ({
      key: String(b.key),
      label: type === 'advertiser' ? (topHit(b)?.[cfg.advLabel] || String(b.key)) : String(b.key),
      current: b.doc_count, previous: prevMap[b.key] || 0, net: cfg.net,
    }));
}
// dominant contributing network from a { net: count } tally.
const dominantNet = (nets) => Object.entries(nets).sort((a, b) => b[1] - a[1])[0]?.[0];
const addInto = (target, key, n) => { target[key] = (target[key] || 0) + n; };

async function getCategories(req, res) {
  const raw = { ...req.query, ...req.body };
  const days = clampInt(raw.days, 30, 1, 365);
  const size = clampInt(raw.size, 15, 1, 50);
  const sel = metaCfgs(raw.network);
  if (!sel) return unsupported(res, days, String(raw.network).toLowerCase());

  const country = String(raw.country || '').trim();
  const advertiser = String(raw.advertiser || '').trim();
  const custom = parseRange(raw);
  const cur = {}; const prev = {}; const byNet = {}; // category → { net: current count }
  const parts = await Promise.all(sel.cfgs.map((cfg) => catForCfg(cfg, days, size, country, advertiser, custom)));
  parts.forEach((p, i) => {
    const net = sel.cfgs[i].net;
    for (const [k, v] of Object.entries(p.cur)) if (k.trim() !== '') { addInto(cur, k, v); (byNet[k] = byNet[k] || {})[net] = (byNet[k][net] || 0) + v; }
    for (const [k, v] of Object.entries(p.prev)) if (k.trim() !== '') addInto(prev, k, v);
  });
  const items = [...new Set([...Object.keys(cur), ...Object.keys(prev)])].map((key) => {
    const current = cur[key] || 0; const previous = prev[key] || 0;
    const growthPct = previous > 0 ? Math.round(((current - previous) / previous) * 100) : (current > 0 ? 100 : 0);
    return { category: key, current, previous, growthPct, net: dominantNet(byNet[key] || {}), byNet: byNet[key] || {} };
  }).sort((a, b) => b.current - a.current).slice(0, size);
  return res.status(200).json({ code: 200, data: { days, network: sel.label, items }, message: 'Category trends' });
}

async function getTop(req, res) {
  const raw = { ...req.query, ...req.body };
  const type = raw.type === 'cta' ? 'cta' : 'advertiser';
  const days = clampInt(raw.days, 30, 1, 365);
  const size = clampInt(raw.size, 15, 1, 50);
  const sel = metaCfgs(raw.network);
  if (!sel) return unsupported(res, days, String(raw.network).toLowerCase());

  const country = String(raw.country || '').trim();
  const advertiser = String(raw.advertiser || '').trim();
  const custom = parseRange(raw);
  const merged = {};
  const parts = await Promise.all(sel.cfgs.map((cfg) => topForCfg(cfg, type, days, size, country, advertiser, custom)));
  for (const list of parts) {
    for (const b of list) {
      if (!merged[b.key]) merged[b.key] = { id: b.key, label: b.label, current: 0, previous: 0, nets: {} };
      merged[b.key].current += b.current;
      merged[b.key].previous += b.previous;
      merged[b.key].nets[b.net] = (merged[b.key].nets[b.net] || 0) + b.current;
    }
  }
  const items = Object.values(merged)
    .map((m) => {
      const growthPct = m.previous > 0 ? Math.round(((m.current - m.previous) / m.previous) * 100) : (m.current > 0 ? 100 : 0);
      return { id: m.id, label: m.label, count: m.current, previous: m.previous, growthPct, net: dominantNet(m.nets), byNet: m.nets };
    })
    .sort((a, b) => b.count - a.count).slice(0, size);
  return res.status(200).json({ code: 200, data: { type, days, network: sel.label, items }, message: 'Top movers' });
}

// ── Per-network volume (daily time series) ───────────────────────────────────
// ALL networks are charted; each has its own candidate last_seen date field(s).
// A network only appears if its index is connected AND returns data (dev may not
// have every network wired up — those are simply omitted, not errors).
const TREND_NETWORKS = ['facebook', 'instagram', 'google', 'youtube', 'linkedin', 'gdn', 'native', 'reddit', 'quora', 'pinterest', 'tiktok'];
const NET_DATE_CANDIDATES = {
  facebook: ['facebook_ad.last_seen'],
  instagram: ['instagram_ad.last_seen'],
  google: ['last_seen'],
  youtube: ['last_seen'],
  linkedin: ['last_seen'],
  gdn: ['last_seen', 'gdn_ad.last_seen'],
  native: ['last_seen', 'native_ad.last_seen'],
  reddit: ['last_seen', 'reddit_ad.last_seen'],
  quora: ['last_seen', 'quora_ad.last_seen'],
  pinterest: ['last_seen', 'pinterest_ad.last_seen'],
  tiktok: ['last_seen', 'tiktok_ad.last_seen'],
};
// First date-typed candidate field for a network's ES (max exposes
// value_as_string only for date fields), plus that max as epoch-ms.
async function resolveNetDate(es, net) {
  for (const f of (NET_DATE_CANDIDATES[net] || ['last_seen'])) {
    try {
      const a = await getCoalescedDateMax(es, f);
      if (a && a.value != null && a.value_as_string) return { field: f, maxMs: a.value };
    } catch { /* try next */ }
  }
  return null;
}
// Latest data point across the requested networks (aligns the shared time axis).
async function resolveTrendDates(nets) {
  let anchor = 0;
  const byNet = {};
  await Promise.all(nets.map(async (net) => {
    const es = getEs(net);
    if (!es) return;
    const d = await resolveNetDate(es, net);
    if (d) {
      byNet[net] = d;
      if (d.maxMs > anchor) anchor = d.maxMs;
    }
  }));
  return { anchorMs: anchor || Date.now(), byNet };
}
// { 'YYYY-MM-DD': count } for a network in [startMs,endMs], placeholder ads
// excluded, optionally filtered to a country.
async function dailySeries(net, startMs, endMs, country, resolvedDate) {
  const es = getEs(net);
  if (!es) return null;
  const d = resolvedDate || await resolveNetDate(es, net);
  if (!d) return null;
  const f = d.field;
  const cc = countryClause(net, country);
  const intervalKey = es.esMajor >= 8 ? 'calendar_interval' : 'interval'; // ES8 renamed it
  try {
    const r = await es.search({
      index: es.indexName,
      request_cache: true,
      body: {
        size: 0,
        query: { bool: { filter: [{ range: { [f]: { gte: fmt(startMs), lte: fmt(endMs), format: DATE_FMT } } }, ...(cc ? [cc] : [])], must_not: placeholderMustNot() } },
        aggs: { d: { date_histogram: { field: f, [intervalKey]: 'day', format: 'yyyy-MM-dd' } } },
      },
    });
    const buckets = esBody(r).aggregations?.d?.buckets || [];
    const map = {};
    for (const b of buckets) map[b.key_as_string] = b.doc_count;
    return map;
  } catch { return null; }
}

// ── Ads by country (all networks) ────────────────────────────────────────────
// Each network stores its geo under a different field; values are country names
// with inconsistent case + junk ("ALL"). We normalise + merge across networks.
const NET_COUNTRY = {
  facebook: 'country_only.country.keyword',
  instagram: 'instagram_country_only.country.keyword',
  native: 'native_country_only.country.keyword',
  reddit: 'reddit_country_only.country.keyword',
  quora: 'quora_country_only.country.keyword',
  pinterest: 'pinterest_country_only.country.keyword',
  google: 'country',
  youtube: 'countries.keyword',
  linkedin: 'countries.keyword',
  gdn: 'gdn_country_only.country.keyword',
};
const GEO_NETWORKS = Object.keys(NET_COUNTRY);
// A case-insensitive country filter clause for a network (values are stored with
// inconsistent case). Returns null when no country is set or the net has no geo.
function countryClause(net, country) {
  if (!country) return null;
  const f = NET_COUNTRY[net];
  const c = String(country).trim();
  if (!f || !c) return null;
  const title = c.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
  const set = new Set([c, c.toLowerCase(), title]);
  // Some networks store the geo as an ISO alpha-2 code (e.g. "de") rather than a
  // name, so when filtering by a name also match its code (both cases).
  const iso = nameToIso(c);
  if (iso) { set.add(iso); set.add(iso.toLowerCase()); }
  return { bool: { should: [...set].map((v) => ({ term: { [f]: v } })), minimum_should_match: 1 } };
}
// Filter to ads by one or more advertisers (the compared search terms), so every
// panel reflects the current search. Matches the network's advertiser-name field.
function advertiserClause(net, advCsv) {
  if (!advCsv) return null;
  const f = NET_ADV_MATCH[net];
  if (!f) return null;
  const terms = String(advCsv).split(',').map((s) => s.trim()).filter(Boolean);
  if (!terms.length) return null;
  return { bool: { should: terms.map((t) => ({ match: { [f]: t } })), minimum_should_match: 1 } };
}
// Build the extra-filter array for a network from optional country + advertiser.
function extraFilters(net, country, advertiser) {
  return [countryClause(net, country), advertiserClause(net, advertiser)].filter(Boolean);
}
const COUNTRY_ALIAS = {
  'Usa': 'United States', 'Us': 'United States', 'U.s.': 'United States', 'United States Of America': 'United States',
  'Uk': 'United Kingdom', 'U.k.': 'United Kingdom', 'Great Britain': 'United Kingdom',
  'The Netherlands': 'Netherlands', 'Uae': 'United Arab Emirates', 'Korea': 'South Korea',
};
// Some networks store the geo as an ISO alpha-2 code ("de", "gb") instead of a
// name. Convert those to full names (via ICU / Intl.DisplayNames — no data table)
// so the filter list shows names and merges duplicates; `nameToIso` is the reverse
// lookup so filtering by a name still matches ads stored as the code.
const ISO2_CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW').split(' ');
let _regionNames;
function regionNames() {
  if (_regionNames === undefined) {
    try { _regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }); }
    catch { _regionNames = null; }
  }
  return _regionNames;
}
function iso2ToName(code) {
  const rn = regionNames();
  if (!rn) return null;
  const up = String(code).toUpperCase();
  try { const n = rn.of(up); return (n && n.toUpperCase() !== up) ? n : null; } catch { return null; }
}
let _nameToIso;
function nameToIso(name) {
  if (_nameToIso === undefined) {
    _nameToIso = {};
    for (const code of ISO2_CODES) { const n = iso2ToName(code); if (n) _nameToIso[n.toLowerCase()] = code; }
  }
  return _nameToIso[String(name).trim().toLowerCase()] || null;
}
function normCountry(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (['all', 'unknown', 'n/a', 'na', 'none', 'worldwide', 'global'].includes(low)) return null;
  // ISO alpha-2 code (e.g. "de", "gb") → full country name.
  if (/^[a-z]{2}$/i.test(s)) { const iso = iso2ToName(s); if (iso) return COUNTRY_ALIAS[iso] || iso; }
  const title = low.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return COUNTRY_ALIAS[title] || title;
}
async function regionsForNet(net, days, advertiser, custom) {
  const es = getEs(net);
  if (!es) return {};
  const d = await resolveNetDate(es, net);
  const cf = NET_COUNTRY[net];
  if (!d || !cf) return {};
  const start = custom ? custom.fromMs : d.maxMs - days * 86400000;
  const end = custom ? custom.toMs : d.maxMs;
  const ac = advertiserClause(net, advertiser);
  try {
    const r = await es.search({
      index: es.indexName,
      request_cache: true,
      body: {
        size: 0,
        query: { bool: { filter: [{ range: { [d.field]: { gte: fmt(start), lte: fmt(end), format: DATE_FMT } } }, ...(ac ? [ac] : [])] } },
        aggs: { c: { terms: { field: cf, size: 80 } } },
      },
    });
    const out = {};
    for (const b of (esBody(r).aggregations?.c?.buckets || [])) {
      const name = normCountry(b.key);
      if (name) out[name] = (out[name] || 0) + b.doc_count;
    }
    return out;
  } catch { return {}; }
}
async function getRegions(req, res) {
  const raw = { ...req.query, ...req.body };
  const days = clampInt(raw.days, 30, 1, 365);
  const advertiser = String(raw.advertiser || '').trim();
  const custom = parseRange(raw);
  const list = parseNetList(raw.network);
  const nets = list ? list.filter((n) => GEO_NETWORKS.includes(n)) : GEO_NETWORKS;

  const merged = {}; const byNet = {}; // country → total, country → { net: count }
  const parts = await Promise.all(nets.map(async (net) => [net, await regionsForNet(net, days, advertiser, custom)]));
  for (const [net, p] of parts) for (const [k, v] of Object.entries(p)) {
    merged[k] = (merged[k] || 0) + v;
    (byNet[k] = byNet[k] || {})[net] = (byNet[k][net] || 0) + v;
  }

  const items = Object.entries(merged).map(([country, count]) => ({ country, count, byNet: byNet[country] || {} }))
    .sort((a, b) => b.count - a.count).slice(0, 40);
  const total = items.reduce((s, i) => s + i.count, 0);
  return res.status(200).json({ code: 200, data: { days, total, items }, message: 'Ads by country' });
}

// ── Manual search: an advertiser's ad-volume trend, per network ──────────────
// Advertiser NAME text field per network (matchable even where it isn't
// aggregatable, e.g. youtube/linkedin) — powers the "type a term → compare
// across networks" box (Google-Trends style).
const NET_ADV_MATCH = {
  facebook: 'facebook_ad_post_owners.post_owner_name',
  instagram: 'instagram_ad_post_owners.post_owner_name',
  native: 'native_ad_post_owners.post_owner_name',
  reddit: 'reddit_ad_post_owners.post_owner_name',
  quora: 'quora_ad_post_owners.post_owner_name',
  pinterest: 'pinterest_ad_post_owners.post_owner_name',
  google: 'post_owner_name',
  youtube: 'post_owner',
  linkedin: 'post_owner',
  gdn: 'gdn_ad_post_owners.post_owner_name',
};
async function searchDaily(net, q, days, country, custom) {
  const es = getEs(net);
  if (!es) return null;
  const d = await resolveNetDate(es, net);
  const advField = NET_ADV_MATCH[net];
  if (!d || !advField) return null;
  const start = custom ? custom.fromMs : d.maxMs - days * 86400000;
  const end = custom ? custom.toMs : d.maxMs;
  const cc = countryClause(net, country);
  try {
    const r = await es.search({
      index: es.indexName,
      request_cache: true,
      body: {
        size: 0,
        query: { bool: { filter: [{ range: { [d.field]: { gte: fmt(start), lte: fmt(end), format: DATE_FMT } } }, ...(cc ? [cc] : [])], must: [{ match: { [advField]: q } }] } },
        aggs: { dd: { date_histogram: { field: d.field, interval: 'day', format: 'yyyy-MM-dd' } } },
      },
    });
    const map = {};
    for (const b of (esBody(r).aggregations?.dd?.buckets || [])) map[b.key_as_string] = b.doc_count;
    return map;
  } catch { return null; }
}
async function getSearch(req, res) {
  const raw = { ...req.query, ...req.body };
  const q = String(raw.q || '').trim();
  const days = clampInt(raw.days, 30, 1, 365);
  if (!q) return res.status(200).json({ code: 200, data: { q: '', networks: [], series: [], total: 0 }, message: 'empty query' });

  const country = String(raw.country || '').trim();
  const custom = parseRange(raw);
  const list = parseNetList(raw.network);
  const nets = list ? list.filter((n) => NET_ADV_MATCH[n]) : Object.keys(NET_ADV_MATCH);
  const maps = {}; const present = [];
  await Promise.all(nets.map(async (net) => {
    const m = await searchDaily(net, q, days, country, custom);
    if (m && Object.keys(m).length) { maps[net] = m; present.push(net); }
  }));
  present.sort((a, b) => TREND_NETWORKS.indexOf(a) - TREND_NETWORKS.indexOf(b));

  const dateSet = new Set();
  for (const net of present) for (const dk of Object.keys(maps[net])) dateSet.add(dk);
  const series = [...dateSet].sort().map((date) => {
    const row = { date }; let tot = 0;
    for (const net of present) { const c = maps[net][date] || 0; row[net] = c; tot += c; }
    row.total = tot; return row;
  });
  const total = series.reduce((s, r) => s + r.total, 0);
  return res.status(200).json({ code: 200, data: { q, days, networks: present, series, total }, message: 'Search trend' });
}

// ── Top keywords ─────────────────────────────────────────────────────────────
// Search-keyword networks expose a `target_keyword` term (Google search ads).
const NET_KEYWORD = {
  google: { date: 'last_seen', field: 'target_keyword' },
  pinterest: { date: 'pinterest_ad.last_seen', field: 'pinterest_ad.target_keyword.keyword' },
};
async function keywordsForNet(net, cfg, days, size, country, advertiser, custom) {
  const es = getEs(net);
  if (!es) return [];
  try {
    const anchor = (await getCoalescedDateMax(es, cfg.date))?.value;
    if (!anchor) return [];
    const start = custom ? custom.fromMs : anchor - days * 86400000;
    const end = custom ? custom.toMs : anchor;
    const extra = extraFilters(net, country, advertiser);
    const r = await es.search({
      index: es.indexName,
      request_cache: true,
      body: { size: 0, query: { bool: { filter: [{ range: { [cfg.date]: { gte: fmt(start), lte: fmt(end), format: DATE_FMT } } }, ...extra] } }, aggs: { items: { terms: { field: cfg.field, size } } } },
    });
    return (esBody(r).aggregations?.items?.buckets || []).filter((b) => String(b.key).trim() !== '')
      .map((b) => ({ key: String(b.key), count: b.doc_count, net }));
  } catch { return []; }
}
async function getKeywords(req, res) {
  const raw = { ...req.query, ...req.body };
  const days = clampInt(raw.days, 30, 1, 365);
  const size = clampInt(raw.size, 15, 1, 50);
  const country = String(raw.country || '').trim();
  const advertiser = String(raw.advertiser || '').trim();
  const custom = parseRange(raw);
  const list = parseNetList(raw.network);
  const nets = (list ? list.filter((n) => NET_KEYWORD[n]) : Object.keys(NET_KEYWORD));
  const merged = {};
  const parts = await Promise.all(nets.map((n) => keywordsForNet(n, NET_KEYWORD[n], days, size, country, advertiser, custom)));
  for (const listx of parts) for (const b of listx) {
    if (!merged[b.key]) merged[b.key] = { keyword: b.key, count: 0, net: b.net };
    merged[b.key].count += b.count;
  }
  const items = Object.values(merged).sort((a, b) => b.count - a.count).slice(0, size);
  const supported = nets.length > 0;
  return res.status(200).json({ code: 200, data: { days, items }, message: 'Top keywords', ...(supported ? {} : { meta: { unsupported: true } }) });
}

// ─── Router ──────────────────────────────────────────────────────────────────
const router = Router();
const { requireCapability } = require('./planControl/registries/routeClassification');
const marketTrendsCapability = requireCapability('intelligence.market_trends', {
  network: (req) => req.query?.network || req.body?.network,
});
router.get('/health', (req, res) => res.status(200).json({ code: 200, message: 'market trends enabled', data: { ok: true } }));
router.get('/access', authMiddleware, asyncHandler(async (req, res) => {
  const [enabled, stage] = await Promise.all([hasMarketTrendsAccess(req), getMarketTrendsStage()]);
  // networks — resolved the exact same way restrictNetworkToPlan enforces it server-side,
  // so the frontend's chip list and the actual data returned are always in sync. null when
  // there's no plan_id to resolve against (frontend falls back to showing every network).
  let networks = null;
  try {
    const planId = req.user?.userSubscriptionType ?? req.user?.plan_id;
    if (planId !== undefined && planId !== null) {
      const planConfig = await planAccessService.getConfig();
      if (planConfig && planConfig.length > 0) networks = resolveMarketTrendsNetworks(planId, planConfig);
    }
  } catch (_e) {
    networks = null;
  }
  res.status(200).json({ code: 200, message: 'ok', data: { enabled, stage, networks } });
}));
router.get('/trends/overview', authMiddleware, accessGuard, restrictNetworkToPlan, asyncHandler(getOverview));
router.get('/trends/categories', authMiddleware, accessGuard, restrictNetworkToPlan, asyncHandler(getCategories));
router.get('/trends/top', authMiddleware, accessGuard, restrictNetworkToPlan, asyncHandler(getTop));
router.get('/trends/regions', authMiddleware, accessGuard, restrictNetworkToPlan, asyncHandler(getRegions));
router.get('/trends/keywords', authMiddleware, accessGuard, restrictNetworkToPlan, asyncHandler(getKeywords));
router.get('/trends/search', authMiddleware, accessGuard, restrictNetworkToPlan, asyncHandler(getSearch));

module.exports = router;
