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
const { PLATFORM_FIELD_MAPPINGS } = require('../helpers/platformSearchFields');

const log = logger.createChild('keyword-ad-notify');

// Per-network ES timestamp field used to scope the count to "today" (companion to the
// per-network search fields in helpers/platformSearchFields.js).
const TIMESTAMP_FIELD = {
  facebook: 'facebook_ad.last_seen',
  instagram: 'instagram_ad.last_seen',
  google: 'google_ad.last_seen',
  gdn: 'gdn_ad.last_seen',
  youtube: 'last_seen',
  linkedin: 'linkedin_ad.last_seen',
  reddit: 'reddit_ad.last_seen',
  pinterest: 'pinterest_ad.last_seen',
  quora: 'quora_ad.last_seen',
  native: 'native_ad.last_seen',
  tiktok: 'last_seen',
};

// type → which PLATFORM_FIELD_MAPPINGS key to read.
const TYPE_FIELD_KEY = { 1: 'keyword', 2: 'advertiser', 3: 'domain' };

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
    must.push({ wildcard: { [domainField]: `*${domain}*` } });
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

  const docs = await source.find(
    { scrapping_status: { $elemMatch: { date: today, status: { $in: ['completed', 'no_ads_found'] } } } },
    { projection: { type: 1, value: 1, valueNorm: 1, networks: 1, users: 1, userInfos: 1, scrapping_status: 1, notifyDismissed: 1 } }
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
        const query = buildQuery(net, type, value, dateScoped, today);
        if (!query) continue;

        const es = dbManager.getElastic(net);
        if (!es) { log.debug('no ES client for network', { network: net }); continue; }
        const index = es.indexName || config.networks?.[net]?.elastic?.index;
        if (!index) continue;

        const res = await es.count({ index, body: { query } });
        const adsCount = readCount(res);
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
    {
      $and: [
        { $or: orUser },
        { scrapping_status: { $elemMatch: { date: today, status: { $in: ['completed', 'no_ads_found'] } } } },
      ],
    },
    { projection: { type: 1, value: 1, valueNorm: 1, networks: 1, scrapping_status: 1, notifyDismissed: 1 } }
  ).sort({ lastSearchedAt: -1 }).limit(ks.notify.userScanLimit).toArray();

  let scanned = 0, matched = 0, notified = 0;

  for (const doc of docs) {
    scanned++;
    if (!doc.value || !doc.type) continue;

    for (const net of networksScrapedToday(doc, today)) {
      // Caller already dismissed this term+network today → skip before any ES work.
      if (isDismissedToday(doc, user, net, today)) continue;
      try {
        const query = buildQuery(net, doc.type, doc.value, dateScoped, today);
        if (!query) continue;

        const es = dbManager.getElastic(net);
        if (!es) continue;
        const index = es.indexName || config.networks?.[net]?.elastic?.index;
        if (!index) continue;

        const res = await es.count({ index, body: { query } });
        const adsCount = readCount(res);
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
};
