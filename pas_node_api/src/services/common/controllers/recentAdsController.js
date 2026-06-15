'use strict';

/**
 * Recent Ads controller — returns the most recently-seen ads across ALL
 * networks (Facebook, Instagram, Google, GDN, YouTube, Pinterest, …) in one
 * call, with FULL ad content (images, text, title, advertiser, URLs).
 *
 * "Recent" = ads whose `last_seen` falls within the last N days.
 *   - default window is 1 day (ads seen in the last 24h-ish, day-granular)
 *   - pass `days` to widen it (days=2 → last 2 days, days=3 → last 3 days, …)
 *
 * How it works:
 *   Rather than hitting Elasticsearch directly (which only yields the raw,
 *   dotted-key `_source` — no rendered image/text/advertiser fields), this
 *   reuses each network's own `searchAds` pipeline — the SAME one
 *   commonSearchController.searchAllNetworks uses. That pipeline runs the ES
 *   query, hydrates the hits from SQL, and passes them through `cleanAdsData`,
 *   so every ad comes back in the exact frontend-ready shape the search grid
 *   renders.
 *
 *   The recency window is injected via `seen_btn_sort` — the shared
 *   [endTs, startTs] unix-second date-range param every network's searchAds
 *   already understands — plus `newest_sort: desc` (newest first).
 *
 * Usage:
 *   POST /api/v1/common/recent-ads   { days?: 1, network?: 'all', limit?: 20 }
 *   GET  /api/v1/common/recent-ads?days=2&network=facebook,google&limit=30
 *
 *   Body / query:
 *     days     optional — look-back window in days (default 1, max 90)
 *     network  optional — 'all' (default), CSV ('facebook,google'), or array.
 *                         Unknown names are ignored (meta.ignoredNetworks).
 *     limit    optional — max ads PER network (default 20, max 100)
 *
 *   Response:
 *     {
 *       code: 200,
 *       data: [ { ...fullAdContent, network }, ... ],   // merged, newest first
 *       meta: {
 *         days, limit, from, to,
 *         total:    { facebook: <recent ad count>, ... },  // ES match count
 *         returned: { facebook: <ads in data>,     ... },
 *         networks: [ ... queried ... ],
 *         ignoredNetworks?: [ ... ],
 *         errors?: { network: msg }
 *       }
 *     }
 */

const serviceRegistry = require('../../ServiceRegistry');
const config = require('../../../config');
const logger = require('../../../logger');
const ResponseFormatter = require('../../../utils/responseFormatter');

const { searchAds: fbSearchAds }   = require('../../facebook/controllers/adSearchController');
const { searchAds: igSearchAds }   = require('../../instagram/controllers/adSearchController');
const { searchAds: ytSearchAds }   = require('../../youtube/controllers/adSearchController');
const { searchAds: gdnSearchAds }  = require('../../gdn/controllers/adSearchController');
const { searchAds: liSearchAds }   = require('../../linkedin/controllers/adSearchController');
const { searchAds: natSearchAds }  = require('../../native/controllers/adSearchController');
const { searchAds: redSearchAds }  = require('../../reddit/controllers/adSearchController');
const { searchAds: qrSearchAds }   = require('../../quora/controllers/adSearchController');
const { searchAds: pinSearchAds }  = require('../../pinterest/controllers/adSearchController');
const { searchAds: googSearchAds } = require('../../google/controllers/adSearchController');
const { searchAds: ttSearchAds }   = require('../../tiktok/controllers/adSearchController');

const log = logger.createChild('recent-ads');

// Network → its per-network search handler (same set commonSearchController fans
// out to). Keys here ARE the supported network list.
const SEARCH_FNS = {
  facebook:  fbSearchAds,
  instagram: igSearchAds,
  youtube:   ytSearchAds,
  gdn:       gdnSearchAds,
  linkedin:  liSearchAds,
  native:    natSearchAds,
  reddit:    redSearchAds,
  quora:     qrSearchAds,
  pinterest: pinSearchAds,
  google:    googSearchAds,
  tiktok:    ttSearchAds,
};
const SUPPORTED_NETWORKS = Object.keys(SEARCH_FNS);

const DEFAULT_DAYS = 1;
const MAX_DAYS = 90;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Format a unix-second timestamp as "YYYY-MM-DD HH:mm:ss" (UTC) — mirrors the
// tsToDate the per-network controllers use when applying seen_btn_sort, so the
// `from`/`to` we report matches the window actually queried.
function tsToDateTime(sec, time) {
  return `${new Date(sec * 1000).toISOString().slice(0, 10)} ${time}`;
}

// Comparable epoch-ms for the cross-network sort. Cleaned ads expose a uniform
// `last_seen` (Date, epoch number, or "YYYY-MM-DD HH:mm:ss" string).
function lastSeenMs(v) {
  if (v == null || v === '') return 0;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v; // seconds → ms
  const ms = Date.parse(String(v).replace(' ', 'T'));
  return isNaN(ms) ? 0 : ms;
}

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n > max ? max : n;
}

function resolveNetworks(reqNet) {
  if (!reqNet || reqNet === 'all') {
    return { networks: [...SUPPORTED_NETWORKS], ignored: [] };
  }
  let requested;
  if (Array.isArray(reqNet)) {
    requested = reqNet.map(n => String(n).toLowerCase().trim());
  } else {
    requested = String(reqNet).split(',').map(n => n.toLowerCase().trim());
  }
  requested = requested.filter(Boolean);
  const networks = requested.filter(n => SEARCH_FNS[n]);
  const ignored = requested.filter(n => !SEARCH_FNS[n]);
  return { networks, ignored };
}

// Per-network timeout wrapper (same shape commonSearchController uses).
function withTimeout(promise, ms, network) {
  let handle;
  const timer = new Promise(resolve => {
    handle = setTimeout(
      () => resolve({ network, code: 504, message: 'Timeout', data: [], total: 0 }),
      ms
    );
  });
  return Promise.race([
    promise
      .then(r => { clearTimeout(handle); return { ...r, network }; })
      .catch(e => { clearTimeout(handle); return { network, code: 500, message: e.message, data: [], total: 0 }; }),
    timer,
  ]);
}

// ─── Handler ──────────────────────────────────────────────────────────────────
async function getRecentAds(req, res) {
  const raw = { ...req.query, ...req.body };

  const days = clampInt(raw.days, DEFAULT_DAYS, 1, MAX_DAYS);
  const limit = clampInt(raw.limit ?? raw.size ?? raw.take ?? raw.page_size, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const { networks, ignored } = resolveNetworks(raw.network);

  if (networks.length === 0) {
    return ResponseFormatter.error(
      res,
      `No valid network requested. Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      400
    );
  }

  // searchAds requires user_id; authMiddleware injects it into req.body.
  const userId = req.body?.user_id || req.user?.id || raw.user_id;
  if (!userId) {
    return ResponseFormatter.error(res, 'Unauthorized: user_id missing', 401);
  }

  // Recency window as the shared [endTs, startTs] seen_btn_sort range.
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - days * 86400;
  const seenBtnSort = [nowSec, startSec];

  const ms = config.apiTimeouts?.networkSearchTimeoutMs || 15000;

  const tasks = networks.map(net => {
    const service = serviceRegistry.getService(net);
    if (!service || !service.db) {
      return Promise.resolve({ network: net, code: 503, message: `Service not available for "${net}"`, data: [], total: 0 });
    }
    // Build a minimal per-network search request carrying ONLY the recency
    // window + sort + pagination. query is cleared so each searchAds' internal
    // `{ ...req.body, ...req.query }` merge can't reintroduce stray params.
    const netReq = {
      ...req,
      query: {},
      body: {
        user_id: userId,
        network: net,
        seen_btn_sort: seenBtnSort,
        newest_sort: 'desc',
        take: limit,
        skip: 0,
      },
    };
    return withTimeout(
      SEARCH_FNS[net](netReq, service.db, service.log),
      ms,
      net
    );
  });

  const settled = await Promise.allSettled(tasks);

  const totals = {};
  const returned = {};
  const errors = {};
  let merged = [];

  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const r = s.value;
    const ads = Array.isArray(r.data) ? r.data : [];
    totals[r.network] = r.code === 200 ? (r.total ?? ads.length) : 0;
    returned[r.network] = ads.length;
    if (r.code !== 200) errors[r.network] = r.message || `error (${r.code})`;

    // Tag each ad with its network (mutate in place — these ad objects came
    // straight from the per-network controller and aren't shared elsewhere).
    for (let i = 0; i < ads.length; i++) ads[i].network = r.network;
    if (ads.length) merged = merged.concat(ads);
  }

  // Cross-network sort by recency (newest first). Schwartzian transform —
  // compute each ad's epoch-ms once instead of inside the comparator.
  const decorated = new Array(merged.length);
  for (let i = 0; i < merged.length; i++) {
    decorated[i] = [lastSeenMs(merged[i].last_seen), merged[i]];
  }
  decorated.sort((a, b) => b[0] - a[0]);
  const data = decorated.map(d => d[1]);

  return res.status(200).json({
    code: 200,
    data,
    message: data.length ? 'Recent ads fetched successfully' : 'No recent ads found',
    meta: {
      days,
      limit,
      from: tsToDateTime(startSec, '00:00:00'),
      to: tsToDateTime(nowSec, '23:59:59'),
      total: totals,
      returned,
      networks,
      ...(ignored.length ? { ignoredNetworks: ignored } : {}),
      ...(Object.keys(errors).length ? { errors } : {}),
    },
  });
}

module.exports = { getRecentAds };
