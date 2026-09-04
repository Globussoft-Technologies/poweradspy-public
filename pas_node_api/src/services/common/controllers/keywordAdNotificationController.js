'use strict';

/**
 * Keyword-search → ad-count notification scan — NEW, additive feature.
 *
 * Runs on a cron (config.keywordSearch.notify.schedule, default every 15 min). For every
 * `keyword_searches` term that was scraped TODAY, it asks Elasticsearch how many ads
 * actually match that term on the network it was scraped for. When the count crosses the
 * configurable threshold (config.keywordSearch.notify.adsCountThreshold, default 20) a
 * notification is upserted — one per user who searched the term — into a dedicated
 * collection (config.keywordSearch.notify.collection) carrying the user's id/username +
 * the keyword details + the ad count, for downstream delivery.
 *
 * Purely read-only against the existing pipelines: it reads keyword_searches + ES and
 * writes ONLY to its own notification collection. Disabling it (notify.enabled:false or
 * keywordSearch.enabled:false) makes the scan a no-op.
 */

const { ObjectId } = require('mongodb');
const dbManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const config = require('../../../config');
const firebaseService = require('../../FirebaseService');
const { PLATFORM_FIELD_MAPPINGS } = require('../helpers/platformSearchFields');
const { withLimit, isEsUnderStress } = require('../helpers/esConcurrency');

const log = logger.createChild('keyword-ad-notify');

// FCM token lookup for the first-ad push (§4.3 of SEARCH_CRAWL_STATUS_MANIFEST.md) — same
// table/network as pushNotificationController.js's send flow, so a token registered for
// one push path works for the other.
const identSafe = (s, def) => (/^[A-Za-z0-9_]+$/.test(String(s || '')) ? String(s) : def);
const PUSH_TOKEN_NET = config.notifications?.tokenNetwork || 'facebook';
const PUSH_TOKEN_TBL = identSafe(config.notifications?.tokenTable, 'am_user_action');

// Both scan functions below call this once per (term, network) they check. With many
// users active at once, the SAME popular term (e.g. "myntra", "flipkart") is very
// commonly checked by several different users within the same minute — this cache
// collapses those into one ES hit. 5 min is safe: a threshold-crossing notification
// doesn't need sub-minute freshness. ES_MAX_CONCURRENT bounds how many of these count()
// calls can be in flight AT ONCE per network, PER PM2 WORKER PROCESS — kept low (not a
// real global budget) because isEsUnderStress() (checked first, below) is the actual
// cross-process guard. See esConcurrency.js's top comment for the full reasoning.
const COUNT_CACHE_TTL_MS = 5 * 60 * 1000;
const ES_MAX_CONCURRENT_PER_NETWORK = 2;
const countCache = new Map(); // cacheKey -> { count, expiresAt }

function countCacheGet(key) {
  const hit = countCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) { countCache.delete(key); return undefined; }
  return hit.count;
}

function countCacheSet(key, count) {
  if (countCache.size > 5000) countCache.delete(countCache.keys().next().value); // defensive cap
  countCache.set(key, { count, expiresAt: Date.now() + COUNT_CACHE_TTL_MS });
}

// Cached + concurrency-limited + stress-aware replacement for a bare `es.count()` —
// every caller of buildQuery() below goes through this instead of hitting ES directly.
// Returns `null` (never cached) when the cluster is already under real stress right
// now, so this purely-discretionary background scan backs off for a cycle instead of
// adding to it — the next poll (or the 15-min cron) simply tries that term again.
async function getAdsCountCached(lookupNet, index, query, cacheKey) {
  const cached = countCacheGet(cacheKey);
  if (cached !== undefined) return cached;

  if (await isEsUnderStress(lookupNet)) {
    log.debug('keyword ad-scan: skipping — ES already under stress this cycle', { network: lookupNet });
    return null;
  }

  const es = dbManager.getElastic(lookupNet);
  if (!es) return null;
  const count = await withLimit(lookupNet, async () => {
    const res = await es.count({ index, body: { query } });
    return readCount(res);
  }, ES_MAX_CONCURRENT_PER_NETWORK);
  countCacheSet(cacheKey, count);
  return count;
}

// Same as getAdsCountCached but skips the 5-min cache — used only by the first-ad push
// watcher (startFirstAdPushWatcher, below), whose whole point is a fresh read on every
// tick. Reusing the cache there would mean a watcher on a short check interval mostly
// re-reads a value up to 5 minutes stale. Safe to skip: a watcher only exists for a
// term that's actively being scraped right now, so the volume this adds is bounded by
// how many scrapes are in flight at once, not by how many users have ever searched a
// popular term — the scenario the cache exists for.
async function getAdsCountFresh(lookupNet, index, query) {
  if (await isEsUnderStress(lookupNet)) {
    log.debug('first-ad push watcher: skipping — ES already under stress this cycle', { network: lookupNet });
    return null;
  }
  const es = dbManager.getElastic(lookupNet);
  if (!es) return null;
  return withLimit(lookupNet, async () => {
    const res = await es.count({ index, body: { query } });
    return readCount(res);
  }, ES_MAX_CONCURRENT_PER_NETWORK);
}

// Per-network ES timestamp field used to scope the count to "today" (companion to the
// per-network search fields in helpers/platformSearchFields.js).
const TIMESTAMP_FIELD = {
  facebook: 'facebook_ad.last_seen',
  instagram: 'instagram_ad.last_seen',
  google: 'last_seen',
  gdn: 'gdn_ad.last_seen',
  youtube: 'last_seen',
  linkedin: 'last_seen',
  reddit: 'reddit_ad.last_seen',
  pinterest: 'pinterest_ad.last_seen',
  quora: 'quora_ad.last_seen',
  native: 'native_ad.last_seen',
  tiktok: 'last_seen',
};

// Google Transparency Ads share the SAME Elasticsearch index/schema as regular Google
// Search ads (discriminated only by a `platform` id inside the doc — see
// src/services/google/transparencyInsertion/pipeline.js). The scraper reports its
// network as the literal string "google_transparency" on scrapping_status[].network,
// which has no entry of its own in PLATFORM_FIELD_MAPPINGS / TIMESTAMP_FIELD / the ES
// client registry — normalize it onto 'google' for every ES-side lookup below. The
// notification doc itself still records the network AS SCRAPED ("google_transparency"),
// only the lookup key is normalized.
function normalizePlatformKey(net) {
  const n = String(net || '').toLowerCase();
  return n === 'google_transparency' ? 'google' : n;
}

// type → which PLATFORM_FIELD_MAPPINGS key to read. Reused below as the deep-link query
// param name too (?keyword=/?advertiser=/?domain=) — same three values either way.
const TYPE_FIELD_KEY = { 1: 'keyword', 2: 'advertiser', 3: 'domain' };

// Human-readable network name for the push notification body — proper casing for the
// handful that aren't just "capitalize the slug" (GDN, LinkedIn, TikTok, AdMob).
const NETWORK_LABEL = {
  facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', google: 'Google',
  google_transparency: 'Google Transparency', gdn: 'GDN', native: 'Native',
  linkedin: 'LinkedIn', reddit: 'Reddit', quora: 'Quora', pinterest: 'Pinterest',
  tiktok: 'TikTok', admob: 'AdMob',
};
function networkLabel(net) {
  const n = String(net || '').toLowerCase();
  return NETWORK_LABEL[n] || (n ? n.charAt(0).toUpperCase() + n.slice(1) : '');
}

// YYYY-MM-DD in the configured timezone (same formatter as keywordSearchController).
function todayStr() {
  const tz = config.notifications?.timezone || 'Asia/Kolkata';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

// Resolve a mongo collection on the keyword-search connection (slug/db from config).
function getMongoCollection(name) {
  const ks = config.keywordSearch;
  const conn = dbManager.getMongo(ks.mongoSlug);
  if (!conn) return null;
  const db = ks.database ? conn.client.db(ks.database) : conn.db;
  return db.collection(name);
}

// One-time index bootstrap on the notification collection (dedup per user+term+net+day).
let notifyIndexesReady = null;
function ensureNotifyIndexes(col) {
  if (!notifyIndexesReady) {
    notifyIndexesReady = col.createIndexes([
      { key: { userId: 1, email: 1, valueNorm: 1, type: 1, network: 1, date: 1 }, name: 'uniq_user_term_net_day', unique: true },
      { key: { date: -1 }, name: 'recency' },
      { key: { notified: 1, date: -1 }, name: 'pending' },
    ]).catch((err) => { notifyIndexesReady = null; throw err; });
  }
  return notifyIndexesReady;
}

// Read the count out of an ES count() response across client major versions.
function readCount(res) {
  if (res == null) return 0;
  if (typeof res.count === 'number') return res.count;
  if (typeof res.body?.count === 'number') return res.body.count;
  return 0;
}

// Build the ES query for one (type, value) on one network; null = nothing to query.
function buildQuery(net, type, value, dateScoped, today) {
  const mapping = PLATFORM_FIELD_MAPPINGS[net];
  if (!mapping) return null;
  const fieldKey = TYPE_FIELD_KEY[type];
  if (!fieldKey) return null;

  const must = [];
  if (fieldKey === 'domain') {
    const domainField = mapping.domain;
    if (!domainField) return null;
    let domain;
    try {
      const parsed = new URL(value.startsWith('http') ? value : `http://${value}`);
      domain = parsed.hostname;
    } catch {
      domain = String(value).split('/')[0];
    }
    domain = String(domain || '').replace(/^www\./i, '').toLowerCase().trim();
    if (!domain) return null;

    // Prefer the clean keyword field (term/prefix) over a leading-wildcard scan
    // of the raw URL field — see platformSearchFields.js for the measured cost.
    const keywordField = mapping.domainKeywordField;
    if (keywordField) {
      must.push({
        bool: {
          should: [
            { term: { [keywordField]: domain } },
            { prefix: { [keywordField]: domain } },
          ],
          minimum_should_match: 1,
        },
      });
    } else if (net === 'instagram') {
      // instagram has no dedicated domain-only keyword field yet (its
      // instagram_ad_domain doc only indexes domain_registered_date — see
      // platformSearchFields.js). destination_url.keyword holds the
      // untokenized full URL, so match it against the real-world
      // protocol/www prefixes instead of a leading-wildcard scan of the
      // analyzed field — same "does this ad go to domain X" result without
      // walking the whole term dictionary (2026-08-19 incident: this exact
      // wildcard, fired from this cron AND from live user domain search,
      // pinned the ES search thread pool and starved the write pool).
      must.push({
        bool: {
          should: [
            { prefix: { [`${domainField}.keyword`]: `http://${domain}` } },
            { prefix: { [`${domainField}.keyword`]: `https://${domain}` } },
            { prefix: { [`${domainField}.keyword`]: `http://www.${domain}` } },
            { prefix: { [`${domainField}.keyword`]: `https://www.${domain}` } },
          ],
          minimum_should_match: 1,
        },
      });
    } else {
      must.push({ wildcard: { [domainField]: `*${domain}*` } });
    }
  } else {
    const fields = mapping[fieldKey];
    if (!fields || fields.length === 0) return null;
    must.push({ multi_match: { query: value, type: 'phrase', fields } });
  }

  const bool = { must };
  if (dateScoped) {
    const tsField = TIMESTAMP_FIELD[net];
    if (tsField) {
      bool.filter = [{ range: { [tsField]: { gte: `${today} 00:00:00`, lte: `${today} 23:59:59` } } }];
    }
  }
  return { bool };
}

// Distinct networks (lowercased) scraped TODAY for a doc, from its scrapping_status.
function networksScrapedToday(doc, today) {
  const out = new Set();
  for (const s of doc.scrapping_status || []) {
    if (s && s.date === today && s.network) out.add(String(s.network).toLowerCase());
  }
  return [...out];
}

// Users who searched the term → [{ userId, username, email }]. Prefer the richer
// userInfos[]; fall back to the plain users[] (emails only).
function resolveUsers(doc) {
  if (Array.isArray(doc.userInfos) && doc.userInfos.length) {
    return doc.userInfos
      .map(u => ({
        userId: u?.id ?? u?.userId ?? null,
        username: u?.username ?? null,
        email: u?.email ?? null,
      }))
      .filter(u => u.userId != null || u.email);
  }
  return (doc.users || [])
    .filter(Boolean)
    .map(email => ({ userId: null, username: null, email: String(email) }));
}

/**
 * Run one full scan. Safe to call from a cron or manually. Never throws — every term /
 * network is isolated so one ES/Mongo hiccup can't abort the whole run.
 * @returns {Promise<{scanned:number, matched:number, notified:number}>}
 */
async function runKeywordAdNotificationScan() {
  const ks = config.keywordSearch;
  if (!ks.enabled || !ks.notify?.enabled) {
    log.debug('keyword ad-notification scan skipped (feature disabled)');
    return { scanned: 0, matched: 0, notified: 0 };
  }

  const source = getMongoCollection(ks.collection);
  const notifyCol = getMongoCollection(ks.notify.collection);
  if (!source || !notifyCol) {
    log.warn('Mongo unavailable for keyword ad-notification scan', { slug: ks.mongoSlug });
    return { scanned: 0, matched: 0, notified: 0 };
  }
  await ensureNotifyIndexes(notifyCol);

  const today = todayStr();
  const threshold = ks.notify.adsCountThreshold;
  const dateScoped = ks.notify.dateScoped;

  // Any status today — not just completed/no_ads_found. A term still mid-scrape
  // (status: 'scrapping') needs to be scanned too, so the first-ad push (below) can
  // fire the moment ads start appearing instead of waiting for the session to close.
  // Side effect (intentional): the 20-ad bell notification, which runs off this same
  // doc set, can now also fire slightly earlier — mid-scrape, the moment its threshold
  // is crossed — rather than only after the session finishes.
  const docs = await source.find(
    { scrapping_status: { $elemMatch: { date: today } } },
    { projection: { type: 1, value: 1, valueNorm: 1, networks: 1, users: 1, userInfos: 1, scrapping_status: 1, notifyDismissed: 1, adFoundPushed: 1 } }
  ).limit(ks.notify.scanBatch).toArray();

  let scanned = 0, matched = 0, notified = 0;

  for (const doc of docs) {
    scanned++;
    const value = doc.value;
    const type = doc.type;
    if (!value || !type) continue;

    const users = resolveUsers(doc);
    if (users.length === 0) continue;

    for (const net of networksScrapedToday(doc, today)) {
      try {
        const lookupNet = normalizePlatformKey(net);
        const query = buildQuery(lookupNet, type, value, dateScoped, today);
        if (!query) continue;

        const es = dbManager.getElastic(lookupNet);
        if (!es) { log.debug('no ES client for network', { network: net }); continue; }
        const index = es.indexName || config.networks?.[lookupNet]?.elastic?.index;
        if (!index) continue;

        const cacheKey = `${lookupNet}:${type}:${doc.valueNorm}:${today}`;
        const adsCount = await getAdsCountCached(lookupNet, index, query, cacheKey);
        if (adsCount == null) continue; // skipped this cycle (cache miss + cluster stressed) — retried next run

        // First-ad push no longer sent from here — the per-claim watcher
        // (startFirstAdPushWatcher, spawned from scraperWork()) is now the only thing
        // that sends it, so it goes out close to when ads actually appear instead of
        // waiting for this scan's 15-min cadence. This scan still exists purely for the
        // 20-ad bell threshold below.

        if (adsCount < threshold) continue;
        matched++;

        const now = new Date();
        for (const u of users) {
          // Skip users who already dismissed this term+network today (no resurrection).
          if (isDismissedToday(doc, u, net, today)) continue;
          try {
            const r = await notifyCol.updateOne(
              { userId: u.userId, email: u.email, valueNorm: doc.valueNorm, type, network: net, date: today },
              {
                $set: { username: u.username, value, adsCount, threshold, updatedAt: now },
                $setOnInsert: { createdAt: now, notified: false },
              },
              { upsert: true }
            );
            if (r.upsertedCount) notified++;
          } catch (uErr) {
            log.warn('notification upsert failed', { network: net, value, user: u.email, error: uErr.message });
          }
        }
      } catch (netErr) {
        log.warn('network scan failed', { network: net, value, error: netErr.message });
      }
    }
  }

  log.info('keyword ad-notification scan complete', { date: today, scanned, matched, notified, threshold });
  return { scanned, matched, notified };
}

// ─── Frontend "primary" read API ────────────────────────────────────────────
// The cron (above) scans the WHOLE collection for everyone. The frontend polls the
// endpoints below every `notify.pollIntervalSec` for the LOGGED-IN user only: each
// poll runs a tiny per-user scan (just that user's recently-searched terms scraped
// today), upserts any threshold-crossing matches, and returns the user's pending
// notifications. "Mark read" deletes the doc(s) for that user. See §7 of the manifest.

// Coerce any client-supplied id into an ObjectId; null when it isn't a valid one.
function toObjectId(v) {
  if (v instanceof ObjectId) return v;
  try { return new ObjectId(String(v)); } catch { return null; }
}

// Identify the caller from the JWT, mirroring keywordSearchController.
function callerFrom(req) {
  return {
    userId: req.user?.id ?? req.user?.user_id ?? null,
    email: req.user?.email ?? null,
    username: req.user?.login ?? req.user?.name ?? null,
  };
}

// `notified:false` docs that belong to this caller (matched by userId and/or email).
function userMatchOr(user) {
  const or = [];
  if (user.userId != null) or.push({ userId: user.userId });
  if (user.email) or.push({ email: user.email });
  return or;
}

// True if this user already dismissed (marked-read) a notification for this term+network
// TODAY. markKeywordAdNotificationRead records the dismissal on the source keyword_searches
// doc's `notifyDismissed[]`, so neither scan resurrects a notification the user cleared.
// Date-scoped: a new day has a new dedup date, so the term can notify again fresh.
function isDismissedToday(doc, user, net, today) {
  const list = doc.notifyDismissed || [];
  return list.some((d) =>
    d && d.network === net && d.date === today &&
    ((user.userId != null && d.userId === user.userId) || (user.email && d.email === user.email))
  );
}

// ─── First-ad push (independent of the 20-ad bell threshold) ───────────────
// Fires once per (user, term, network, day) the first time adsCount >= 1. Driven by a
// per-claim watcher (startFirstAdPushWatcher, below), spawned from scraperWork() the
// moment the scraper claims a term — not by the slower 15-min bell scan, which never
// checks ES more than once every 15 min and only for terms that are already scraped.
// Dedup marker lives on the source keyword_searches doc, mirroring notifyDismissed[]'s
// pattern. See SEARCH_CRAWL_STATUS_MANIFEST.md §4.

// True if this user was already pushed a "first ad found" notification for this
// term+network TODAY. Marked only on a successful send (sendFirstAdPushSafe below), so a
// failed send (no token, dead token, FCM error) can still retry on the next tick.
function isAdFoundPushedToday(doc, user, net, today) {
  const list = doc.adFoundPushed || [];
  return list.some((d) =>
    d && d.network === net && d.date === today &&
    ((user.userId != null && d.userId === user.userId) || (user.email && d.email === user.email))
  );
}

// Best-effort FCM token lookup — same table/pattern as pushNotificationController.js's
// batch lookup, just single-row since this fires per (user, term, network) event.
async function lookupFcmToken(userId) {
  if (userId == null) return null;
  const sql = dbManager.getSQL(PUSH_TOKEN_NET);
  if (!sql) return null;
  try {
    const rows = await sql.query(
      `SELECT fcm_token FROM ${PUSH_TOKEN_TBL} WHERE am_id = ? AND fcm_token IS NOT NULL LIMIT 1`,
      [userId]
    );
    const row = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
    return row?.fcm_token || null;
  } catch (err) {
    log.warn('first-ad push: token lookup failed', { userId, error: err.message });
    return null;
  }
}

// Send the "first ad found" push for one (doc, user, network) and record the dedup
// marker on success only. Never throws — every failure just means "try again next tick,"
// matching the never-throw contract both scan functions already hold.
async function sendFirstAdPushSafe(source, doc, user, net, today) {
  if (config.keywordSearch?.notify?.firstAdPushEnabled === false) return;
  try {
    const fcmToken = await lookupFcmToken(user.userId);
    if (!fcmToken) return; // no token on file yet — retried automatically next tick

    // typeParam doubles as both the human label source and the deep-link query param
    // name (?keyword=/?advertiser=/?domain=) the frontend's deep-link effect (App.jsx)
    // already reads. platform in the URL is always the ES-lookup-normalized network
    // (google_transparency → google) — the frontend has no notion of "google_transparency"
    // as a selectable platform, only the underlying network + a separate GT filter flag,
    // so passing the raw scraped value through unmodified would silently not match any
    // known platform.
    const typeParam = TYPE_FIELD_KEY[doc.type] || 'keyword';
    const typeLabel = typeParam.charAt(0).toUpperCase() + typeParam.slice(1);
    const actionUrl = `/?${typeParam}=${encodeURIComponent(doc.value)}&platform=${encodeURIComponent(normalizePlatformKey(net))}`;

    await firebaseService.sendNotification(
      fcmToken,
      'New Ads Found!',
      `We found new ads for "${doc.value}" (${typeLabel} · ${networkLabel(net)}). Tap to view.`,
      '',
      actionUrl
    );

    await source.updateOne(
      { type: doc.type, valueNorm: doc.valueNorm },
      { $addToSet: { adFoundPushed: { userId: user.userId ?? null, email: user.email ?? null, network: net, date: today } } }
    );
    log.info('First-ad push sent', { network: net, value: doc.value, type: doc.type, user: user.email || user.userId });
  } catch (err) {
    log.warn('first-ad push failed', { network: net, value: doc.value, user: user.email || user.userId, error: err.message });
  }
}

// Called when a caller already KNOWS the ad count at report time — e.g. Google
// Transparency reports ads_count directly in its addScrapingHistory() call
// (keywordSearchController.js), rather than leaving this feature to find out by polling
// ES later. Sends immediately to every pending searcher instead of spawning a watcher for
// something we already have the answer to. Never throws, matching every other push path
// here; a failure just means the next report (or a watcher, if one is also running for
// this session) gets another chance.
async function sendFirstAdPushForKnownCount({ docId, value, network, adsCount }) {
  if (adsCount == null || adsCount < 1) return;
  const ks = config.keywordSearch;
  if (!ks.enabled || !ks.notify?.enabled || ks.notify?.firstAdPushEnabled === false) return;
  try {
    const source = getMongoCollection(ks.collection);
    if (!source) return;
    const today = todayStr();
    const doc = await source.findOne(
      { _id: docId },
      { projection: { type: 1, value: 1, valueNorm: 1, users: 1, userInfos: 1, adFoundPushed: 1 } }
    );
    if (!doc) return;
    const pendingUsers = resolveUsers(doc).filter((u) => !isAdFoundPushedToday(doc, u, network, today));
    for (const u of pendingUsers) {
      await sendFirstAdPushSafe(source, doc, u, network, today);
    }
  } catch (err) {
    log.warn('first-ad push (known count) failed', { docId: String(docId), network, value, error: err.message });
  }
}

// Per-claim watcher — one of these is spawned (fire-and-forget, from scraperWork() in
// keywordSearchController.js) for every term a scraper claims. Waits 1 minute, then checks
// ES every config.keywordSearch.notify.firstAdPushCheckIntervalSec (default 300s = 5 min)
// until either ads show up (push sent, watcher stops) or the session closes (nothing
// left to check, watcher stops) — matching "from the moment the scraper takes the term
// until it's done, keep checking; the moment ads are found, push and disconnect."
//
// Lives entirely in memory: if this process restarts mid-scrape, an in-flight watcher is
// lost and that specific claim won't be checked again (a deliberately accepted trade-off
// — see SEARCH_CRAWL_STATUS_MANIFEST.md §4 for the reasoning). No cron, no cross-worker
// lock needed: each watcher only ever runs in the same process that served the claim it
// belongs to, so there's nothing for two workers to duplicate.
function startFirstAdPushWatcher({ docId, scrapeId, type, value, network }) {
  const ks = config.keywordSearch;
  if (!ks.enabled || !ks.notify?.enabled || ks.notify?.firstAdPushEnabled === false) return;

  const dateScoped = ks.notify.dateScoped;
  const intervalMs = (ks.notify.firstAdPushCheckIntervalSec || 300) * 1000;
  const lookupNet = normalizePlatformKey(network);

  const tick = async () => {
    let stillOpen = true;
    try {
      const source = getMongoCollection(ks.collection);
      if (!source) return; // Mongo unavailable — give up silently, this is one watcher among many

      const today = todayStr(); // re-derived each tick in case a watcher spans midnight
      const doc = await source.findOne(
        { _id: docId },
        { projection: { type: 1, value: 1, valueNorm: 1, users: 1, userInfos: 1, scrapping_status: 1, adFoundPushed: 1 } }
      );
      if (!doc) return; // doc gone — nothing to watch anymore

      const session = (doc.scrapping_status || []).find((s) => String(s._id) === String(scrapeId));
      // Both count as "still in progress" — matches keywordSearchController.js's own
      // STALE_RECOVERABLE_STATUSES (kept as a separate literal here, not imported, to
      // avoid a circular require: that file already imports startFirstAdPushWatcher from
      // this one). 'scrapping' is scraperWork()'s claim status; 'processing' is
      // addScrapingHistory()'s own non-terminal report — a session reported via THAT
      // endpoint never has a 'scrapping' status at all, so checking only for 'scrapping'
      // made the watcher give up after just one check for every session reported that
      // way, even while it was genuinely still running.
      stillOpen = !!session && (session.status === 'scrapping' || session.status === 'processing');

      const pendingUsers = resolveUsers(doc).filter((u) => !isAdFoundPushedToday(doc, u, network, today));
      if (pendingUsers.length > 0) {
        const query = buildQuery(lookupNet, type, value, dateScoped, today);
        const es = query ? dbManager.getElastic(lookupNet) : null;
        const index = es?.indexName || config.networks?.[lookupNet]?.elastic?.index;
        if (query && es && index) {
          const adsCount = await getAdsCountFresh(lookupNet, index, query);
          if (adsCount != null && adsCount >= 1) {
            for (const u of pendingUsers) {
              await sendFirstAdPushSafe(source, doc, u, network, today);
            }
            return; // found + pushed — done watching this claim
          }
        }
      } else {
        return; // everyone who searched this has already been pushed today — nothing left to do
      }
    } catch (err) {
      log.warn('first-ad push watcher tick failed', { docId: String(docId), scrapeId: String(scrapeId), network, value, error: err.message });
      // fall through to reschedule — a transient Mongo/ES hiccup shouldn't permanently
      // stop watching a term that's still actively being scraped.
    }

    if (stillOpen) scheduleTick(intervalMs);
    // else: session closed with no ads found for the remaining pending users — stop.
  };

  // tick() is async; setTimeout never looks at (let alone awaits) what its callback
  // returns, so a bare `setTimeout(tick, ms)` would leave any rejection that somehow
  // escaped the try/catch above unhandled. In practice nothing outside that try/catch
  // can realistically throw, and this app's global unhandledRejection handler
  // (server.js) only logs rather than crashing the process either way — but wrapping
  // it costs nothing and keeps the error, with this watcher's own context (docId/
  // network/value), inside tick()'s own log line instead of a bare global one.
  const scheduleTick = (ms) => setTimeout(() => { tick().catch((err) => {
    log.warn('first-ad push watcher tick threw unexpectedly', { docId: String(docId), scrapeId: String(scrapeId), network, value, error: err.message });
  }); }, ms);

  scheduleTick(60000); // first check 1 min after the claim
}

/**
 * Per-user variant of the scan — scoped to ONE user's searched terms (by id/email)
 * instead of the whole collection. For every term this user searched that was scraped
 * today, it asks ES how many ads match per network and upserts a notification for THIS
 * user when the count crosses the threshold. Never throws individual term/network
 * errors; returns the scan summary.
 */
async function runUserKeywordAdScan(user, source, notifyCol) {
  const ks = config.keywordSearch;
  const today = todayStr();
  const threshold = ks.notify.adsCountThreshold;
  const dateScoped = ks.notify.dateScoped;

  const orUser = [];
  if (user.userId != null) orUser.push({ 'userInfos.id': user.userId });
  if (user.email) { orUser.push({ users: user.email }); orUser.push({ 'userInfos.email': user.email }); }
  if (orUser.length === 0) return { scanned: 0, matched: 0, notified: 0 };

  const docs = await source.find(
    // Same broadening as runKeywordAdNotificationScan above — any status today, so a
    // term still mid-scrape gets checked too, not just ones whose session already closed.
    {
      $and: [
        { $or: orUser },
        { scrapping_status: { $elemMatch: { date: today } } },
      ],
    },
    { projection: { type: 1, value: 1, valueNorm: 1, networks: 1, scrapping_status: 1, notifyDismissed: 1, adFoundPushed: 1 } }
  ).sort({ lastSearchedAt: -1 }).limit(ks.notify.userScanLimit).toArray();

  let scanned = 0, matched = 0, notified = 0;

  for (const doc of docs) {
    scanned++;
    if (!doc.value || !doc.type) continue;

    for (const net of networksScrapedToday(doc, today)) {
      // Caller already dismissed this term+network today → skip before any ES work.
      if (isDismissedToday(doc, user, net, today)) continue;
      try {
        const lookupNet = normalizePlatformKey(net);
        const query = buildQuery(lookupNet, doc.type, doc.value, dateScoped, today);
        if (!query) continue;

        const es = dbManager.getElastic(lookupNet);
        if (!es) continue;
        const index = es.indexName || config.networks?.[lookupNet]?.elastic?.index;
        if (!index) continue;

        const cacheKey = `${lookupNet}:${doc.type}:${doc.valueNorm}:${today}`;
        const adsCount = await getAdsCountCached(lookupNet, index, query, cacheKey);
        if (adsCount == null) continue; // skipped this cycle (cache miss + cluster stressed) — retried next run

        // First-ad push no longer sent from here — see the matching comment in
        // runKeywordAdNotificationScan above. This poll now only feeds the 20-ad bell.

        if (adsCount < threshold) continue;
        matched++;

        const now = new Date();
        const r = await notifyCol.updateOne(
          { userId: user.userId, email: user.email, valueNorm: doc.valueNorm, type: doc.type, network: net, date: today },
          {
            $set: { username: user.username, value: doc.value, adsCount, threshold, updatedAt: now },
            $setOnInsert: { createdAt: now, notified: false },
          },
          { upsert: true }
        );
        if (r.upsertedCount) notified++;
      } catch (netErr) {
        log.warn('user scan network failed', { network: net, value: doc.value, error: netErr.message });
      }
    }
  }

  return { scanned, matched, notified };
}

/**
 * GET /api/v1/common/keyword-ad-notifications  (auth) — the frontend "primary" API.
 *
 * Polled every `notify.pollIntervalSec` (env-tunable, echoed back as meta.pollIntervalMs
 * so the UI can self-pace). Runs a per-user scan then returns the caller's pending
 * notifications. The scan is best-effort: a scan failure still returns whatever is
 * already pending.
 */
async function getUserKeywordAdNotifications(req, res) {
  const ks = config.keywordSearch;
  const pollIntervalMs = (ks.notify?.pollIntervalSec || 60) * 1000;
  try {
    const user = callerFrom(req);
    if (user.userId == null && !user.email) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    if (!ks.enabled || !ks.notify?.enabled) {
      return res.json({ code: 200, message: 'notifications disabled', data: [], meta: { unreadCount: 0, pollIntervalMs } });
    }

    const source = getMongoCollection(ks.collection);
    const notifyCol = getMongoCollection(ks.notify.collection);
    if (!source || !notifyCol) {
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }
    await ensureNotifyIndexes(notifyCol);

    let scan = { scanned: 0, matched: 0, notified: 0 };
    try {
      scan = await runUserKeywordAdScan(user, source, notifyCol);
    } catch (scanErr) {
      log.warn('per-user keyword ad-scan failed', { user: user.userId ?? user.email, error: scanErr.message });
    }

    const data = await notifyCol
      .find({ $or: userMatchOr(user), notified: false })
      .sort({ date: -1, updatedAt: -1 })
      .limit(50)
      .toArray();

    return res.json({
      code: 200,
      message: 'ok',
      data,
      meta: { unreadCount: data.length, pollIntervalMs, scan },
    });
  } catch (err) {
    log.error('getUserKeywordAdNotifications error', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

/**
 * POST /api/v1/common/keyword-ad-notifications/read  (auth) — the "mark read" API.
 *
 * Body: `{ id }` or `{ ids: [...] }`. DELETES the caller's matching notification doc(s) AND
 * records a per-user, per-network, per-day dismissal on the source keyword_searches doc
 * (`notifyDismissed[]`). Ownership is enforced by userId/email, so a user can never touch
 * someone else's. No ids → `400` (never a delete-all footgun).
 *
 * Why the dismissal flag: both scans re-run on every poll/cron tick and would re-INSERT a
 * deleted notification for a term still over-threshold + scraped today (resurrection). The
 * `notifyDismissed[]` entry makes `isDismissedToday()` skip re-creating it, so the row stays
 * gone from keyword_ad_notifications. It is date-scoped (only today's entries are kept), so a
 * new day notifies fresh and the array never grows unbounded.
 */
async function markKeywordAdNotificationRead(req, res) {
  try {
    const user = callerFrom(req);
    if (user.userId == null && !user.email) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const ks = config.keywordSearch;
    const notifyCol = getMongoCollection(ks.notify.collection);
    const source = getMongoCollection(ks.collection);
    if (!notifyCol || !source) return res.status(503).json({ code: 503, message: 'Database unavailable' });

    const body = req.body || {};
    const rawIds = Array.isArray(body.ids) ? body.ids : (body.id != null ? [body.id] : []);
    const objIds = rawIds.map(toObjectId).filter(Boolean);
    if (objIds.length === 0) {
      return res.status(400).json({ code: 400, message: 'id or ids[] required' });
    }

    // Load the caller's OWN matching notifications first — we need each one's term/network
    // to record the dismissal on the source doc before deleting it.
    const owned = await notifyCol.find({ _id: { $in: objIds }, $or: userMatchOr(user) }).toArray();

    // Record today's dismissal on each source keyword_searches doc so neither scan re-creates
    // it. Prune stale (not-today) entries first so notifyDismissed only ever holds today's.
    const today = todayStr();
    for (const n of owned) {
      try {
        await source.updateOne(
          { type: n.type, valueNorm: n.valueNorm },
          { $pull: { notifyDismissed: { date: { $ne: today } } } }
        );
        await source.updateOne(
          { type: n.type, valueNorm: n.valueNorm },
          { $addToSet: { notifyDismissed: { userId: n.userId ?? null, email: n.email ?? null, network: n.network, date: today } } }
        );
      } catch (dErr) {
        log.warn('failed to record notification dismissal on source', { id: String(n._id), error: dErr.message });
      }
    }

    // Hard-delete the notification doc(s) — they will not resurrect (the flag above blocks it).
    const r = await notifyCol.deleteMany({ _id: { $in: objIds }, $or: userMatchOr(user) });
    return res.json({ code: 200, message: 'notification(s) removed', data: { deleted: r.deletedCount } });
  } catch (err) {
    log.error('markKeywordAdNotificationRead error', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

module.exports = {
  runKeywordAdNotificationScan,
  runUserKeywordAdScan,
  getUserKeywordAdNotifications,
  markKeywordAdNotificationRead,
  // called from keywordSearchController.js's scraperWork(), once per claimed term
  startFirstAdPushWatcher,
  // called from keywordSearchController.js's addScrapingHistory() when ads_count is
  // already known at report time (e.g. Google Transparency)
  sendFirstAdPushForKnownCount,
  // exported for tests (SEARCH_CRAWL_STATUS_MANIFEST.md §4)
  isAdFoundPushedToday,
  sendFirstAdPushSafe,
};
