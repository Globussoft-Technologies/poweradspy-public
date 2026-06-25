'use strict';

/**
 * Keyword-Search Tracking store (MongoDB) — NEW, additive feature.
 *
 * One deduplicated document per (type, valueNorm). Tracks the users who searched a
 * term + a per-session scraping status. Designed to stay fast at any data size:
 *   - dedupe via a UNIQUE index + a single upsert (no read-before-write)
 *   - bounded arrays (capped searchDates, $setUnion users + userCount counter)
 *   - concurrency-safe scraper claims via atomic findOneAndUpdate + per-session scrapeId
 *
 * Fully controlled by config.keywordSearch (config.json). Disabling it (enabled:false)
 * makes every endpoint a no-op 503 and touches nothing else in the app.
 *
 * See docs/KEYWORD_SEARCH_REVAMP_MANIFEST.md for the full design.
 */

const fs = require('fs');
const { ObjectId } = require('mongodb');
const dbManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const config = require('../../../config');
const { parseJsonKeywords, parseCsvFile } = require('../helpers/keywordInput');

const log = logger.createChild('keyword-search');

// type: 1=keyword, 2=advertiser, 3=domain (accepts numbers or words)
const TYPE_MAP = { keyword: 1, advertiser: 2, domain: 3, '1': 1, '2': 2, '3': 3 };
function normType(t) {
  const k = String(t ?? '').trim().toLowerCase();
  return TYPE_MAP[k] || null;
}

// Resolve a store request's network(s) → array of valid slugs.
// 'all' (allToken) expands to the full configured list; a specific/comma list is
// validated against config. Returns [] when nothing valid is supplied.
function resolveNetworks(raw) {
  const { networks: allowed, allToken } = config.keywordSearch;
  if (raw == null || raw === '') return [];
  let list = Array.isArray(raw) ? raw : String(raw).split(',');
  list = list.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  if (list.includes(allToken) || list.includes('all')) return [...allowed];
  const set = new Set(allowed);
  return list.filter(n => set.has(n));
}

// Resolve + validate the single concrete network a scraper claims for.
// (Still used by the explicit results[] completion path.)
function resolveClaimNetwork(raw) {
  const { networks: allowed, allToken } = config.keywordSearch;
  const net = String(raw ?? '').trim().toLowerCase();
  if (!net) return { error: "query param 'network' is required (a single network slug)" };
  if (net === allToken || net === 'all') return { error: "claim requires ONE concrete network, not 'all'" };
  if (!allowed.includes(net)) return { error: `unknown network '${net}'` };
  return { net };
}

// Resolve + validate the concrete network(s) a scraper claims for. Accepts a single
// slug, a comma list, or an array — e.g. "facebook" | "facebook,instagram" |
// ["facebook","instagram"]. Never 'all' (work must name concrete networks). The pool
// draws from ANY listed network, so one claimed term may come from any of them.
function resolveClaimNetworks(raw) {
  const { networks: allowed, allToken } = config.keywordSearch;
  if (raw == null || raw === '') return { error: "'network' is required (a network slug, comma list, or array — never 'all')" };
  let list = Array.isArray(raw) ? raw : String(raw).split(',');
  list = list.map(s => String(s).trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) return { error: "'network' is required (a network slug, comma list, or array — never 'all')" };
  if (list.includes(allToken) || list.includes('all')) return { error: "claim requires concrete network(s), not 'all'" };
  const set = new Set(allowed);
  const unknown = list.filter(n => !set.has(n));
  if (unknown.length) return { error: `unknown network(s): ${unknown.join(', ')}` };
  return { nets: [...new Set(list)] }; // dedupe, preserve order
}

// Resolve one or many types from a single value, comma list, or array — e.g.
// "keyword" | "keyword,advertiser" | ["keyword","advertiser"] | [1,2]. The pool draws
// from ANY listed type, so one claimed term may be a keyword or an advertiser, etc.
function resolveTypes(raw) {
  if (raw == null || raw === '') return { error: "'type' is required: keyword|advertiser|domain (or 1|2|3), single or array" };
  const list = (Array.isArray(raw) ? raw : String(raw).split(',')).map(normType).filter(Boolean);
  if (list.length === 0) return { error: "'type' is invalid: use keyword|advertiser|domain (or 1|2|3)" };
  return { types: [...new Set(list)] }; // dedupe, preserve order
}

// YYYY-MM-DD in the configured timezone (same tz as the notification crons).
function todayStr() {
  const tz = config.notifications?.timezone || 'Asia/Kolkata';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// ── Collection + one-time index bootstrap ───────────────────────────────────
let indexesReady = null;

function getCollection() {
  const ks = config.keywordSearch;
  const conn = dbManager.getMongo(ks.mongoSlug);
  if (!conn) return null;
  const db = ks.database ? conn.client.db(ks.database) : conn.db;
  return db.collection(ks.collection);
}

async function ensureIndexes(col) {
  if (!indexesReady) {
    indexesReady = col.createIndexes([
      { key: { type: 1, valueNorm: 1 }, name: 'uniq_type_value', unique: true },
      // Both claim modes filter type + networks (applicability) then sort updatedAt;
      // the per-network gate (networkState.<net>.*) is applied as a residual on the
      // already-sorted candidates, and findOneAndUpdate stops at the first match.
      { key: { type: 1, networks: 1, updatedAt: -1 }, name: 'network_claim' },
      { key: { updatedAt: -1 }, name: 'recency' },
    ]).catch((err) => {
      indexesReady = null; // allow a retry on next request
      throw err;
    });
  }
  return indexesReady;
}

function featureGuard(res) {
  if (!config.keywordSearch.enabled) {
    res.status(503).json({ code: 503, message: 'keyword-search feature disabled', data: null });
    return false;
  }
  return true;
}

// ── POST /api/v1/common/keyword-search — store a frontend search ────────────
async function storeKeywordSearch(req, res) {
  try {
    if (!featureGuard(res)) return;
    const col = getCollection();
    if (!col) return res.status(503).json({ code: 503, message: `Mongo unavailable for slug '${config.keywordSearch.mongoSlug}'`, data: null });
    await ensureIndexes(col);

    const body = req.body || {};
    const email = body.email || req.user?.email || '';
    const userSubscriptionType = String(req.user?.userSubscriptionType || body.userSubscriptionType || '');

    // Full searcher identity (id + username + email) so the scraper /work response can tell
    // WHOSE request a term is. id/username come from the JWT (req.user) — username is the
    // aMember `login`, falling back to display `name`. body.* are accepted as overrides.
    const userId = req.user?.id ?? req.user?.user_id ?? body.user_id ?? null;
    const username = String(req.user?.login || req.user?.name || body.username || '').trim();
    // build a user object only when we can identify someone (an id or an email)
    const userObj = (userId != null || email)
      ? { id: userId != null ? userId : null, username, email: email || '' }
      : null;
    // Dedupe key for the rich list: id when present, else email (store is JWT-protected so
    // id is normally set; this guards the id-less edge so distinct users don't collapse).
    const userKey = userObj ? (userObj.id != null ? 'id' : 'email') : null;

    // realTimeStore gate — parity with the legacy controller (config.dailyKeyword)
    const realTimeStore = String(config.dailyKeyword.realTimeStore || 'on').trim().toLowerCase();
    if (realTimeStore === 'off') {
      return res.json({ code: 200, message: 'store disabled', data: { status: 'skip' } });
    }
    const threshold = Number(realTimeStore);
    if (!isNaN(threshold) && realTimeStore !== 'on' && Number(body.ads_count ?? 0) >= threshold) {
      return res.json({ code: 200, message: 'ads count sufficient', data: { status: 'skip' } });
    }

    // optional plan gate (off by default — config.keywordSearch.applyPlanGate)
    if (config.keywordSearch.applyPlanGate && !config.dailyKeyword.newPlanUser.includes(userSubscriptionType)) {
      return res.json({ code: 200, message: 'plan not eligible', data: { status: 'skip' } });
    }

    // resolve value + type — accept {value,type} or legacy {keyword,advertiser,domain}
    let value, type;
    const explicitType = normType(body.type);
    if (body.value && explicitType) {
      value = String(body.value).trim();
      type = explicitType;
    } else if (body.keyword && body.keyword !== 'NA' && body.keyword !== '') {
      value = String(body.keyword).trim(); type = 1;
    } else if (body.advertiser && body.advertiser !== 'NA' && body.advertiser !== '') {
      value = String(body.advertiser).trim(); type = 2;
    } else if (body.domain && body.domain !== 'NA' && body.domain !== '') {
      value = String(body.domain).trim(); type = 3;
    } else {
      return res.json({ code: 200, message: 'no search term', data: { status: 'skip' } });
    }
    if (!value) return res.json({ code: 200, message: 'empty term', data: { status: 'skip' } });

    // resolve network(s) — 'all' expands to the configured list (§ network tracking)
    const netList = resolveNetworks(body.network);
    if (netList.length === 0) {
      return res.json({ code: 200, message: 'no valid network', data: { status: 'skip' } });
    }

    const valueNorm = value.toLowerCase();
    const now = new Date();
    const cap = config.keywordSearch.searchDatesCap;
    const emailToAdd = email ? [email] : [];

    // Per-network: mark each searched network active (re-enters the priority queue for
    // that network) without touching other networks' scrape state.
    const netActiveSet = {};
    for (const net of netList) netActiveSet[`networkState.${net}.isActive`] = true;

    // Single atomic pipeline upsert: dedupe, reactivate, bounded arrays, exact userCount.
    const result = await col.updateOne(
      { type, valueNorm },
      [
        {
          $set: {
            type, value, valueNorm,
            createdAt: { $ifNull: ['$createdAt', now] },
            updatedAt: now,
            lastSearchedAt: now,
            searchCount: { $add: [{ $ifNull: ['$searchCount', 0] }, 1] },
            users: { $setUnion: [{ $ifNull: ['$users', []] }, emailToAdd] },
            // Rich searcher list — one { id, username, email } per user. Deduped BY id
            // (drop any existing entry with the same id, then append the fresh one) so a
            // user appears once and stays current even if their name changes. Skipped when
            // we can't identify the searcher. $literal keeps the values from being parsed
            // as field paths.
            userInfos: userObj == null
              ? { $ifNull: ['$userInfos', []] }
              : {
                  $concatArrays: [
                    { $filter: {
                        input: { $ifNull: ['$userInfos', []] },
                        as: 'u',
                        cond: { $ne: [`$$u.${userKey}`, userObj[userKey]] },
                    } },
                    [{ $literal: userObj }],
                  ],
                },
            searchDates: { $slice: [{ $concatArrays: [{ $ifNull: ['$searchDates', []] }, [now]] }, -cap] },
            networks: { $setUnion: [{ $ifNull: ['$networks', []] }, netList] },
            ...netActiveSet, // networkState.<net>.isActive = true for each searched network
          },
        },
        { $set: { userCount: { $size: '$users' } } },
      ],
      { upsert: true }
    );

    const status = result.upsertedCount ? 'new' : 'existing';

    // Auto-deletion on insert: only when this store created a NEW doc (count grew) — repeat
    // searches (the common case) skip it, so the hot path is untouched. Non-fatal: a cleanup
    // error never affects the store response.
    if (result.upsertedCount) {
      try { await enforceCap('user'); }
      catch (e) { log.warn('user cap enforcement failed', { error: e.message }); }
    }

    return res.json({ code: 200, message: 'keyword search stored', data: { status, type, value, networks: netList } });
  } catch (err) {
    log.error('storeKeywordSearch failed', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

// ── GET /api/v1/common/keyword-search/next — scraper claims work ────────────
// Query: type (required), priority (1/true → priority mode), size (default cfg)

// Real (user-searched) docs always carry users/userInfos arrays; synthetic carry both null.
const USER_SEARCHED_FILTER = { $or: [{ users: { $ne: null } }, { userInfos: { $ne: null } }] };
const SYNTHETIC_FILTER = { users: null, userInfos: null };

// Build the ORDERED list of atomic claim attempts for one (type, net) pair. Each attempt is
// its own findOneAndUpdate; the slot takes the first that yields. This is where the
// GOOGLE-specific ordering lives — every other network / explicit-priority request keeps the
// exact single-attempt behaviour it had before.
function buildClaimAttempts({ type, net, isPriority, today, syntheticOnly }) {
  const activePath = `networkState.${net}.isActive`;
  const dailyPath = `networkState.${net}.dailyClaimDate`;
  const prioritySort = config.keywordSearch.prioritySortDir === 'asc' ? 1 : -1;

  const priority = (extra) => ({
    mode: 'priority', sortDir: prioritySort,
    filter: { type, networks: net, [activePath]: true, ...extra },
    setOut: { [activePath]: false },
  });
  const daily = (extra) => ({
    mode: 'daily', sortDir: -1,
    filter: { type, networks: net, [dailyPath]: { $ne: today }, ...extra },
    setOut: { [dailyPath]: today },
  });

  // Explicit priority mode → unchanged single priority attempt.
  if (isPriority) return [priority(syntheticOnly ? { userInfos: null } : {})];

  // GOOGLE daily (and not an explicit synthetic-only request): on EVERY hit serve
  // priority terms first (isActive:true), then user-searched, then synthetic — each with
  // the SAME status transitions as the existing flow (priority flips isActive; daily sets
  // dailyClaimDate). Per-network independence + atomicity are preserved (each tier is its
  // own atomic claim).
  if (net === 'google' && !syntheticOnly) {
    return [priority({}), daily(USER_SEARCHED_FILTER), daily(SYNTHETIC_FILTER)];
  }

  // Every other network (and an explicit synthetic-only request): unchanged single daily
  // attempt. syntheticOnly narrows to manually-inserted terms (users/userInfos null).
  return [daily(syntheticOnly ? { userInfos: null } : {})];
}

// ── internal: claim ONE term (atomic) for a network — tries the ordered attempts ──
async function claimOne(col, { type, net, isPriority, owner, today, now, syntheticOnly }) {
  const lastScrapePath = `networkState.${net}.lastScrape`;
  const attempts = buildClaimAttempts({ type, net, isPriority, today, syntheticOnly });

  for (const a of attempts) {
    const scrapeId = new ObjectId();
    // Atomic claim: the per-network gate field is flipped in the same op, so two concurrent
    // scrapers (same network) can never grab the same doc. A failed attempt (no match)
    // writes nothing, so we just fall through to the next tier.
    const doc = await col.findOneAndUpdate(
      a.filter,
      {
        $set: { ...a.setOut, [lastScrapePath]: { date: today, status: 'scrapping', owner } },
        $push: { scrapping_status: { _id: scrapeId, network: net, type, mode: a.mode, owner, date: today, startTime: now, status: 'scrapping' } },
      },
      { sort: { updatedAt: a.sortDir }, returnDocument: 'after' }
    );
    if (doc) {
      // `users` = the rich searcher list ({ id, username, email }) so the scraper knows WHOSE
      // request this term is. Falls back to emails-only (legacy `users`) if userInfos is absent.
      return {
        docId: doc._id, type: doc.type, value: doc.value, network: net, scrapeId, mode: a.mode,
        users: Array.isArray(doc.userInfos) && doc.userInfos.length
          ? doc.userInfos
          : (doc.users || []).map(e => ({ id: null, username: '', email: e })),
      };
    }
  }
  return null;
}

// ── internal: complete ONE session by scrapeId (owner-checked) ──────────────
async function completeOne(col, { docId, scrapeId, owner, status, adsCount, net, today, now }) {
  const allowed = ['completed', 'no_ads_found', 'failed'];
  const finalStatus = allowed.includes(status) ? status : 'completed';

  const set = {
    'scrapping_status.$[s].endTime': now,
    'scrapping_status.$[s].status': finalStatus,
  };
  if (adsCount != null) set['scrapping_status.$[s].adsCount'] = adsCount;
  if (net) {
    const lastScrape = { date: today, status: finalStatus, owner };
    if (adsCount != null) lastScrape.adsCount = adsCount;
    set[`networkState.${net}.lastScrape`] = lastScrape;
  }

  // Ownership is enforced in the MAIN query via $elemMatch — a wrong owner matches
  // NOTHING (so even the lastScrape denorm is not touched). arrayFilters then targets
  // the EXACT session by scrapeId for the positional update — never "the latest entry".
  const sessionMatch = { _id: scrapeId };
  if (owner) sessionMatch.owner = owner;
  const query = { _id: docId, scrapping_status: { $elemMatch: sessionMatch } };

  const r = await col.updateOne(query, { $set: set }, { arrayFilters: [{ 's._id': scrapeId }] });
  return { matched: r.matchedCount, modified: r.modifiedCount, status: finalStatus };
}

// ── internal: auto-close THIS scraper's still-open session(s) by owner name ──
// The scraper doesn't track docId/scrapeId — on its next /work hit it just signals it
// finished; we find its open session(s) for this owner+network (any of `types`) BY OWNER
// NAME and close them (endTime + status). No adsCount needed. Default status =
// 'completed'; the scraper may send 'no_ads_found' / 'failed'. Works for BOTH daily and
// priority modes. Called once per network so each net's lastScrape denorm stays correct.
async function autoCloseOwnerSessions(col, { owner, net, types, status, today, now }) {
  const allowed = ['completed', 'no_ads_found', 'failed'];
  const finalStatus = allowed.includes(status) ? status : 'completed';

  const set = {
    'scrapping_status.$[s].endTime': now,
    'scrapping_status.$[s].status': finalStatus,
    [`networkState.${net}.lastScrape`]: { date: today, status: finalStatus, owner },
  };

  // Match docs that have an open session for this owner+network for any requested type.
  const r = await col.updateMany(
    { scrapping_status: { $elemMatch: { owner, network: net, type: { $in: types }, status: 'scrapping' } } },
    { $set: set },
    { arrayFilters: [{ 's.owner': owner, 's.network': net, 's.type': { $in: types }, 's.status': 'scrapping' }] }
  );
  return r.modifiedCount;
}

// ── POST /api/v1/common/keyword-search/work — the SINGLE scraper endpoint ────
// One call does BOTH: (1) submit results of previously-scraped terms, and
// (2) claim the next batch. The scraper identifies itself via the configured
// header (config.keywordSearch.scraperHeader). All state is in Mongo, so a server
// or scraper restart never breaks the flow; crashed sessions self-heal (§stale).
//
// Body: {
//   type, network,                     // REQUIRED — the work stream. Each accepts a single
//                                      //   value, a comma list, OR an array, e.g.
//                                      //   network: ["facebook","instagram"], type: ["keyword","advertiser"].
//                                      //   The pool draws from ANY listed type+network, so a
//                                      //   single claimed term may come from any of them
//                                      //   (each item still carries its own type+network).
//   priority?: true,                   // priority mode (default daily) — multi-value too
//   size?: N,                          // how many to claim (default cfg, clamped)
//   results?: [ { docId, scrapeId, status, adsCount } ]   // finished terms (optional)
// }
async function scraperWork(req, res) {
  try {
    if (!featureGuard(res)) return;
    const col = getCollection();
    if (!col) return res.status(503).json({ code: 503, message: `Mongo unavailable for slug '${config.keywordSearch.mongoSlug}'`, data: null });
    await ensureIndexes(col);

    const ks = config.keywordSearch;
    const owner = String(req.get(ks.scraperHeader) || req.body?.scraper || '').trim();
    if (!owner) {
      return res.status(400).json({ code: 400, message: `header '${ks.scraperHeader}' (your unique scraper/plugin name) is required`, data: null });
    }

    const body = req.body || {};
    // type + network each accept a single value, a comma list, or an array. The claim
    // pool is the union over every (type × network) pair (see the per-slot loop below).
    const { types, error: typeError } = resolveTypes(body.type ?? req.query.type);
    if (typeError) return res.status(400).json({ code: 400, message: typeError, data: null });
    const { nets, error: netError } = resolveClaimNetworks(body.network ?? req.query.network);
    if (netError) return res.status(400).json({ code: 400, message: netError, data: null });

    const isPriority = ['1', 'true', 'yes', 'on', true].includes(
      typeof body.priority === 'boolean' ? body.priority : String(body.priority ?? req.query.priority ?? '').toLowerCase()
    );

    // Synthetic-only mode: the caller asks for manually-inserted (not-yet-user-searched)
    // keywords by passing users:null or userInfos:null. Absent / non-null → normal pool
    // (existing behaviour, fully unchanged).
    const syntheticOnly = body.users === null || body.userInfos === null;
    let size = parseInt(body.size ?? req.query.size, 10);
    if (isNaN(size) || size < 1) size = ks.defaultClaimSize;
    size = Math.min(size, ks.maxClaimSize);

    const today = todayStr();
    const now = new Date();
    // (sort direction is decided per claim attempt inside claimOne/buildClaimAttempts.)

    // Opportunistic, throttled stale recovery — keeps the flow self-healing across
    // server/scraper restarts without a dedicated cron.
    await maybeRecoverStale(col);

    // ── 1) close this scraper's previous work ──
    // DEFAULT (auto): the scraper just sends the outcome (status/adsCount) of the term it
    // finished; we find its open session for this type+network BY OWNER NAME and close it
    // (endTime + status). The scraper never tracks docId/scrapeId. Same for daily & priority.
    // ADVANCED (explicit): if the scraper sends results[] with docId+scrapeId (needed when
    // size>1 to map different adsCounts), we use those precisely instead.
    let completed = 0;
    const completionErrors = [];
    const explicitResults = Array.isArray(body.results) ? body.results : [];

    if (explicitResults.length > 0) {
      for (const r of explicitResults) {
        try {
          const _id = new ObjectId(r.docId);
          const _sid = new ObjectId(r.scrapeId);
          const rnet = resolveClaimNetwork(r.network).net || nets[0]; // default to the first stream network
          const out = await completeOne(col, { docId: _id, scrapeId: _sid, owner, status: r.status, adsCount: r.adsCount != null ? Number(r.adsCount) : null, net: rnet, today, now });
          if (out.modified) completed++;
          else completionErrors.push({ scrapeId: r.scrapeId, reason: out.matched ? 'not your session / already closed' : 'document not found' });
        } catch {
          completionErrors.push({ scrapeId: r.scrapeId, reason: 'invalid docId/scrapeId' });
        }
      }
    } else {
      // Auto-close per network (each net keeps its own lastScrape denorm) across all
      // requested types. In the normal size-1 loop there's exactly one open session.
      for (const net of nets) {
        completed += await autoCloseOwnerSessions(col, {
          owner, net, types,
          status: body.status, // optional: no_ads_found | failed (default completed)
          today, now,
        });
      }
    }

    // ── 2) claim the next batch ──
    // The pool is the union over every (type × network) pair. For each slot we try the
    // pairs in order and take the first that yields a term — so one claimed value may come
    // from any requested network/type. Each claim stays atomic & per-network, so concurrent
    // scrapers never collide and per-network independence holds. Same for priority & daily.
    const pairs = [];
    for (const type of types) for (const net of nets) pairs.push({ type, net });
    const exhausted = new Set(); // pair index → drained for this request (won't refill mid-call)

    const claimed = [];
    for (let i = 0; i < size; i++) {
      let item = null;
      for (let pi = 0; pi < pairs.length; pi++) {
        if (exhausted.has(pi)) continue;
        const { type, net } = pairs[pi];
        item = await claimOne(col, { type, net, isPriority, owner, today, now, syntheticOnly });
        if (item) break;
        exhausted.add(pi);
      }
      if (!item) break; // every pair exhausted
      claimed.push(item);
    }

    return res.json({
      code: 200,
      message: claimed.length ? 'claimed' : 'no terms available',
      scraper: owner,
      mode: isPriority ? 'priority' : 'daily',
      synthetic: syntheticOnly, // true when this claim was restricted to synthetic keywords
      // echo what was requested; each data[] item carries its own concrete type+network.
      networks: nets,
      network: nets.length === 1 ? nets[0] : nets, // back-compat: single value when one network
      types,
      completed,
      completionErrors,
      count: claimed.length,
      data: claimed,
    });
  } catch (err) {
    log.error('scraperWork failed', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

/**
 * Reclaim crashed scrape sessions (status 'scrapping' older than staleClaimMinutes):
 * mark them 'failed' (set endTime), and for priority sessions re-activate that
 * session's network. Batched (config.keywordSearch.staleSweepBatch) to stay cheap.
 * Exported for a cron/admin trigger; also called opportunistically by scraperWork.
 */
async function recoverStaleClaims() {
  if (!config.keywordSearch.enabled) return { recovered: 0 };
  const col = getCollection();
  if (!col) return { recovered: 0 };
  const cutoff = new Date(Date.now() - config.keywordSearch.staleClaimMinutes * 60 * 1000);
  const now = new Date();

  const stale = await col.find(
    { scrapping_status: { $elemMatch: { status: 'scrapping', startTime: { $lt: cutoff } } } },
    { projection: { scrapping_status: 1 } }
  ).limit(config.keywordSearch.staleSweepBatch).toArray();

  let recovered = 0;
  for (const doc of stale) {
    const sessions = (doc.scrapping_status || []).filter(s => s.status === 'scrapping' && s.startTime < cutoff);
    const setFields = {
      'scrapping_status.$[s].status': 'failed',
      'scrapping_status.$[s].endTime': now,
    };
    // Re-activate each stuck PRIORITY session's own network so it can be re-claimed.
    for (const s of sessions) {
      if (s.mode === 'priority' && s.network) setFields[`networkState.${s.network}.isActive`] = true;
    }
    await col.updateOne(
      { _id: doc._id },
      { $set: setFields },
      { arrayFilters: [{ 's.status': 'scrapping', 's.startTime': { $lt: cutoff } }] }
    );
    recovered += sessions.length;
  }
  return { recovered };
}

// Throttled wrapper so a busy work endpoint sweeps at most once per interval/process.
let _lastSweepMs = 0;
async function maybeRecoverStale() {
  const ks = config.keywordSearch;
  if (!ks.autoRecoverStale) return;
  const nowMs = Date.now();
  if (nowMs - _lastSweepMs < ks.staleSweepIntervalSec * 1000) return;
  _lastSweepMs = nowMs;
  try { await recoverStaleClaims(); }
  catch (err) { log.warn('stale-claim sweep failed', { error: err.message }); }
}

// ── Capacity cap (auto-deletion on insert) ───────────────────────────────────
// Hard cap: keeps a category (user-searched OR synthetic) at ≤ its configured cap. When over
// cap it deletes the OLDEST docs (lowest _id ⇒ creation order), but PREFERS already-scraped
// docs first (they've done their job): phase 1 deletes the oldest scraped docs; if that's not
// enough to reach the cap, phase 2 deletes the oldest of the remaining (not-yet-scraped) docs
// too — so the category is always brought down to exactly the cap. Called inline after an
// insert that actually added a new doc; safe to call anytime (no-op when under cap / out of scope).
const CAP_SPEC = {
  // real docs always carry users/userInfos arrays; synthetic carry both null.
  user: { filter: { $or: [{ users: { $ne: null } }, { userInfos: { $ne: null } }] }, capKey: 'userCap' },
  synthetic: { filter: { users: null, userInfos: null }, capKey: 'syntheticCap' },
};
// Preferred-for-deletion = already scraped (has at least one scrapping_status entry).
const SCRAPED_FILTER = { 'scrapping_status.0': { $exists: true } };

// Delete the oldest docs matching `filter`, up to `limit`. Returns the count deleted.
async function deleteOldest(col, filter, limit) {
  if (limit <= 0) return 0;
  const docs = await col
    .find(filter, { projection: { _id: 1 } })
    .sort({ _id: 1 })
    .limit(limit)
    .toArray();
  if (!docs.length) return 0;
  return (await col.deleteMany({ _id: { $in: docs.map((d) => d._id) } })).deletedCount || 0;
}

async function enforceCap(category) {
  const ks = config.keywordSearch;
  if (!ks.enabled || !ks.cleanup) return { skipped: 'disabled' };
  // config.json controls scope: applyTo = 'both' | 'user' | 'synthetic' | 'none'.
  const applyTo = ks.cleanup.applyTo;
  if (applyTo !== 'both' && applyTo !== category) return { skipped: `cleanup not applied to '${category}' (applyTo='${applyTo}')` };
  const spec = CAP_SPEC[category];
  if (!spec) return { skipped: `unknown category '${category}'` };
  const col = getCollection();
  if (!col) return { skipped: 'no mongo connection' };

  const cap = ks.cleanup[spec.capKey];
  const total = await col.countDocuments(spec.filter);
  if (total <= cap) return { category, total, deleted: 0 };

  const overflow = total - cap;
  // Phase 1 — prefer the oldest already-scraped docs.
  const deletedScraped = await deleteOldest(col, { $and: [spec.filter, SCRAPED_FILTER] }, overflow);
  // Phase 2 — hard cap: if scraped weren't enough, delete the oldest remaining docs too
  // (the scraped-oldest are already gone, so these are the oldest not-yet-scraped ones).
  const deletedUnscraped = await deleteOldest(col, spec.filter, overflow - deletedScraped);

  const deleted = deletedScraped + deletedUnscraped;
  return { category, totalBefore: total, deleted, deletedScraped, deletedUnscraped, remaining: total - deleted };
}

// ── POST /api/v1/common/keyword-search/synthetic — bulk-insert synthetic keywords ──
// Manually-inserted keywords from a CSV file (field "file", ≤ syntheticMaxUploadMb) or a
// JSON body. Stored in the SAME collection + doc shape as user searches, but with
// users=null + userInfos=null (the synthetic marker — real docs always carry arrays).
// Deduped by the unique (type,valueNorm) index via $setOnInsert, so an existing doc (user
// OR synthetic) is NEVER modified. A later user search enriches a synthetic doc through the
// unchanged store flow ($ifNull turns null→[]→[user]). NO JWT (internal bulk-load, like
// creative-score / keyword-search/work).
async function insertSyntheticKeywords(req, res) {
  const filePath = req.file ? req.file.path : null;
  try {
    if (!featureGuard(res)) return;
    const col = getCollection();
    if (!col) return res.status(503).json({ code: 503, message: `Mongo unavailable for slug '${config.keywordSearch.mongoSlug}'`, data: null });
    await ensureIndexes(col);

    const ks = config.keywordSearch;
    const body = req.body || {};

    // Batch defaults (CSV sends these as multipart text fields; JSON as top-level keys).
    // `network` is MANDATORY — no default. Each keyword must resolve to ≥1 valid network from
    // its own `network` (per-item / CSV column) or the batch `network`.
    const batchType = normType(body.type) || ks.syntheticDefaultType;
    const batchNetwork = (body.network != null && body.network !== '') ? body.network : null;

    const rawItems = filePath ? await parseCsvFile(filePath) : parseJsonKeywords(body);
    if (!rawItems || rawItems.length === 0) {
      return res.status(400).json({
        code: 400,
        message: 'No keywords found. Send a CSV file (field "file") or JSON keywords.',
        hint: 'JSON: {"keywords":["cat","dog"],"network":"facebook"} or [{"value":"cat","network":"facebook"}]. CSV: a "keyword" column (+ a "network" column, or a batch "network"). network is required.',
      });
    }

    // Resolve + dedupe by (type, valueNorm), merging networks within the batch.
    const received = rawItems.length;
    let skippedNoNetwork = 0; // items dropped because no valid network was supplied
    const byKey = new Map();
    for (const it of rawItems) {
      const value = String(it.value || '').trim();
      if (!value) continue;
      const type = normType(it.type) || batchType;
      const networkRaw = (it.network != null && it.network !== '') ? it.network : batchNetwork;
      if (networkRaw == null) { skippedNoNetwork++; continue; }   // network is mandatory
      const nets = resolveNetworks(networkRaw);
      if (!nets.length) { skippedNoNetwork++; continue; }          // unknown/invalid network slug(s)
      const valueNorm = value.toLowerCase();
      const key = `${type}::${valueNorm}`;
      const existing = byKey.get(key);
      if (existing) existing.networks = [...new Set([...existing.networks, ...nets])];
      else byKey.set(key, { type, value, valueNorm, networks: nets });
    }

    const unique = byKey.size;
    if (unique === 0) {
      return res.status(400).json({
        code: 400,
        message: 'A valid network is required for every synthetic keyword — set a batch "network" or a per-item/CSV network. None of the supplied keywords had a valid network.',
        data: { received, skippedNoNetwork },
      });
    }

    const now = new Date();
    const ops = [...byKey.values()].map((d) => {
      const networkState = {};
      for (const net of d.networks) networkState[net] = { isActive: false }; // daily-crawlable, not in the priority queue
      return {
        updateOne: {
          filter: { type: d.type, valueNorm: d.valueNorm },
          // $setOnInsert ONLY → an existing doc (user OR synthetic) is left untouched.
          update: {
            $setOnInsert: {
              type: d.type, value: d.value, valueNorm: d.valueNorm,
              createdAt: now, updatedAt: now,
              lastSearchedAt: null,
              searchCount: 0,
              users: null,       // synthetic marker
              userInfos: null,   // synthetic marker
              userCount: 0,
              searchDates: [],
              networks: d.networks,
              networkState,
            },
          },
          upsert: true,
        },
      };
    });

    const chunk = ks.syntheticInsertChunk || 2000;
    let inserted = 0;
    for (let i = 0; i < ops.length; i += chunk) {
      const r = await col.bulkWrite(ops.slice(i, i + chunk), { ordered: false });
      inserted += r.upsertedCount || 0;
    }

    // Auto-deletion on insert: only when new docs were actually added (count grew). Non-fatal
    // — a cleanup error must never fail an insert that already succeeded.
    let cleanup;
    if (inserted > 0) {
      try { cleanup = await enforceCap('synthetic'); }
      catch (e) { log.warn('synthetic cap enforcement failed', { error: e.message }); }
    }

    return res.json({
      code: 200,
      message: 'synthetic keywords stored',
      data: { received, unique, inserted, duplicatesIgnored: unique - inserted, skippedNoNetwork, cleanup },
    });
  } catch (err) {
    log.error('insertSyntheticKeywords failed', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  } finally {
    if (filePath) fs.promises.unlink(filePath).catch(() => {});
  }
}

module.exports = {
  storeKeywordSearch,
  scraperWork,
  insertSyntheticKeywords,
  enforceCap,
  recoverStaleClaims,
};
