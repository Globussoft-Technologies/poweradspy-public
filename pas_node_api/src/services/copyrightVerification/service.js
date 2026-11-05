'use strict';

/**
 * Copyright verification — two crons on top of the EXISTING insertion flow.
 *
 *   copyrightVerification  pending ads (status 0) -> blocklist check -> 1 (approved) or 2 (failed)
 *                          + NEW blocklist entries -> the existing ads they cover (status 0/1) -> 2
 *   copyrightCleanup       failed ads  (status 2) -> blocklist ad -> takedown run + snapshot -> delete NAS + SQL + ES -> steps + audit rows
 *
 * Load control (all from config.json, see compliance.copyrightVerification):
 *  - One page per network per tick (batchSize), read through the (copyright_status, id) index.
 *  - The blocklist and its image hashes come from the B1 in-memory cache: no blocklist SQL per tick.
 *  - Image hashing calls run with hashConcurrency; hash comparison runs in `workers` worker threads.
 *  - SQL status changes are one UPDATE ... WHERE id IN (...) per outcome; ES is one search + one bulk.
 *  - Each network runs at most once at a time; a slow tick is skipped, never stacked.
 */

const crypto = require('node:crypto');
const config = require('../../config');
const logger = require('../../logger');
const databaseManager = require('../../database/DatabaseManager');
const blocklist = require('../../compliance/blocklist/service');
const { ImageHashClient } = require('../../compliance/imagematch/client');
const nas = require('../../insertion/helpers/nasClient');
const { mapWithConcurrency } = require('../../insertion/InsertionEngine');
const { NETWORKS, PENDING, APPROVED, FAILED } = require('./status');
const { matchBatch } = require('./hashWorker');
const sources = require('../../compliance/imagematch/sources'); // checked owner/ad table map per network (B2)

const log = logger.createChild('copyright-verification');
const ADDED_BY = 'copyright-verification';
const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|bmp|avif)(?:[?#].*)?$/i;

const running = new Set();
const cursors = new Map();   // network -> last verified id (walks the pending index, wraps at the end)
const attempts = new Map();  // `${network}:${id}` -> failed hash / NAS attempts (in memory; reset on restart)
const held = new Set();      // near-match ads kept pending for manual review (not re-hashed until restart)
let hashClient = null;

const settings = () => config.compliance?.copyrightVerification || {};

// ─── Reading ads (per-network table names) ──────────────────────────────

function tables(network) {
  const prefix = network === 'google' ? 'google_text' : network;
  if (network === 'admob') {
    return { owner: 'LEFT JOIN mob_post_owners o ON o.id = a.post_owner_id', ownerName: 'o.name',
      meta: 'LEFT JOIN mob_ad_urls m ON m.ad_id = a.id', destination: 'm.destination_url',
      media: { table: 'mob_ad_media', ad: 'ad_id', cols: ['nas_path'] } };
  }
  return {
    owner: `LEFT JOIN ${prefix}_ad_post_owners o ON o.id = a.post_owner_id`, ownerName: 'o.post_owner_name',
    meta: network === 'chatgptads' ? '' : `LEFT JOIN ${prefix}_ad_meta_data m ON m.${prefix}_ad_id = a.id`,
    destination: network === 'chatgptads' ? 'a.destination_url' : 'm.destination_url',
    media: { table: `${prefix}_ad_variants`, ad: `${prefix}_ad_id`,
      cols: network === 'youtube' ? ['thumbnail_url', 'video_url'] : ['image_url'] },
    carousel: ['gdn', 'pinterest', 'native', 'google'].includes(network) ? null
      : { table: `${prefix}_ad_image_video`, ad: `${prefix}_ad_id`, col: 'ad_image_video' },
  };
}

function jsonList(value) {
  try { const list = JSON.parse(value); return Array.isArray(list) ? list.filter((v) => typeof v === 'string') : []; }
  catch { return []; }
}

// Stored NAS path ("/<bucket>/stream/...") of a media value, or null.
function storedPath(value) {
  if (typeof value !== 'string' || !value.trim() || /DefaultImage/i.test(value)) return null;
  const v = value.trim();
  const path = /^https?:\/\//i.test(v) ? nas.storedPathFromUrl(v) : v;
  return path ? (path.startsWith('/') ? path : `/${path}`) : null;
}

/** One page of ads in `status`, with metadata for the B1 check and their stored media paths. */
async function loadAds(sql, network, status, afterId, limit) {
  const [table] = NETWORKS[network];
  const t = tables(network);
  const rows = await sql.query(
    `SELECT a.id, a.ad_id, ${t.ownerName} AS post_owner, ${t.destination} AS destination_url
       FROM ${table} a ${t.owner} ${t.meta}
      WHERE a.copyright_status = ? AND a.id > ?
      ORDER BY a.id LIMIT ${Number(limit)}`, [status, afterId]);
  // A child table with 2 rows for one ad would repeat it; keep the first.
  const ads = [...new Map(rows.map((r) => [String(r.id), { id: String(r.id), adId: r.ad_id, ad: r, paths: new Set() }])).values()];
  if (!ads.length) return ads;
  const byId = new Map(ads.map((ad) => [ad.id, ad]));
  const ids = ads.map((ad) => ad.id);
  const marks = ids.map(() => '?').join(',');
  const media = await sql.query(`SELECT ${t.media.ad} AS ad, ${t.media.cols.join(', ')} FROM ${t.media.table} WHERE ${t.media.ad} IN (${marks})`, ids);
  for (const row of media) for (const col of t.media.cols) { const p = storedPath(row[col]); if (p) byId.get(String(row.ad))?.paths.add(p); }
  if (t.carousel) {
    const list = await sql.query(`SELECT ${t.carousel.ad} AS ad, ${t.carousel.col} AS v FROM ${t.carousel.table} WHERE ${t.carousel.ad} IN (${marks})`, ids);
    for (const row of list) for (const item of jsonList(row.v)) { const p = storedPath(item); if (p) byId.get(String(row.ad))?.paths.add(p); }
  }
  return ads;
}

// ─── Writing status ─────────────────────────────────────────────────────

async function setSqlStatus(sql, network, ids, to, from = [PENDING]) {
  if (!ids.length) return 0;
  const [table] = NETWORKS[network];
  const res = await sql.query(`UPDATE ${table} SET copyright_status = ? WHERE id IN (${ids.map(() => '?').join(',')})
    AND copyright_status IN (${from.map(() => '?').join(',')})`, [to, ...ids, ...from]);
  return Number(res?.affectedRows) || 0;
}

/** One search + one bulk request for the whole batch. */
async function setEsStatus(elastic, network, ids, to) {
  if (!ids.length || !elastic) return;
  const [, field, defaultIndex] = NETWORKS[network];
  const index = elastic.indexName || defaultIndex;
  const found = await elastic.search({ index, body: { size: Math.min(ids.length * 5, 10000), _source: false,
    query: { terms: { [field]: ids } } } });
  const hits = (found?.body || found)?.hits?.hits || [];
  if (!hits.length) return;
  const old = Number(elastic.esMajor) <= 6;
  const body = hits.flatMap((h) => [
    { update: { _index: h._index || index, _id: h._id, ...(old ? { _type: h._type || 'doc' } : {}) } },
    { doc: { copyright_status: to } },
  ]);
  const res = await elastic.bulk({ body, refresh: false });
  if ((res?.body || res)?.errors) throw new Error(`${network}: some ES status updates failed`);
}

// ─── Cron 1: verify pending ads ─────────────────────────────────────────

function client() {
  if (!hashClient) hashClient = new ImageHashClient({ config: config.compliance.imageMatch, log });
  return hashClient;
}

// Hashes from another model version cannot be compared; check once a minute.
let healthAt = 0;
let healthOk = false;
async function hashServiceReady() {
  if (Date.now() - healthAt < 60000) return healthOk;
  healthAt = Date.now();
  try {
    const h = await client().health();
    healthOk = h?.ok === true && h.ready === true && h.hashVersion === config.compliance.imageMatch.hashVersion;
  } catch { healthOk = false; }
  return healthOk;
}

async function hashImages(urls, s) {
  const out = new Map();
  await mapWithConcurrency(urls, s.hashConcurrency, async (url) => {
    try {
      const r = await client().hashUrl(url);
      if (r?.ok) out.set(url, { sha256: r.sha256, phash: r.sscdHash });
    } catch { /* not hashed -> ad stays pending */ }
  });
  return out;
}

/** internal ad id -> blocklist id, for active 'internal' ad_id entries among `ids`. */
async function internalBlocks(sql, network, ids) {
  if (!ids.length) return new Map();
  const rows = await sql.query(`SELECT id, value FROM copyright_blocklist
    WHERE network IN (?, 'all') AND status = 'active' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
      AND entry_type = 'ad_id' AND identifier_namespace = 'internal' AND value IN (${ids.map(() => '?').join(',')})`, [network, ...ids]);
  return new Map(rows.map((r) => [String(r.value).trim(), r.id]));
}

// ─── Existing ads hit by a NEW blocklist entry ──────────────────────────
// The pending check only sees new ads. When an entry is added later (an advertiser blocked by hand, or the
// image hashes the B2 job adds for that advertiser's ads), the ads that already exist must go too: they are
// set to 2 here and the cleanup cron removes them. Handled entry types: ad_id, advertiser, image_hash
// (exact copies, found through copyright_image_hashes). url / domain / page / image_url columns have no
// index, so those entries still apply only to new ads.

const LIVE = [PENDING, APPROVED];
const recheckCursors = new Map(); // network -> { entryId, page: { entryId, afterId } | null }

// Where to start after a restart: entries added in the last recheckLookbackHours (marking is idempotent).
async function recheckStart(sql, s) {
  const [row] = await sql.query(`SELECT (SELECT MIN(id) FROM copyright_blocklist WHERE created_at >= UTC_TIMESTAMP() - INTERVAL ? HOUR) AS first,
    (SELECT COALESCE(MAX(id), 0) FROM copyright_blocklist) AS last`, [s.recheckLookbackHours]);
  return row?.first ? Number(row.first) - 1 : Number(row?.last) || 0;
}

/** Live (status 0/1) ads an entry covers, as { id, adId }. `next` is set when more pages of an advertiser remain. */
async function adsOfEntry(sql, network, entry, afterId, limit) {
  const [table] = NETWORKS[network];
  const live = `copyright_status IN (${LIVE.join(',')})`;
  const value = String(entry.value || '').trim();
  const idsOf = (rows) => rows.map((r) => ({ id: String(r.id), adId: r.ad_id ?? null }));
  if (entry.entry_type === 'ad_id') {
    const col = entry.identifier_namespace === 'internal' ? 'id' : 'ad_id';
    return { ids: idsOf(await sql.query(`SELECT id, ad_id FROM ${table} WHERE ${col} = ? AND ${live} LIMIT 50`, [value])), next: null };
  }
  if (entry.entry_type === 'image_hash') {
    const ids = new Set();
    try { const d = JSON.parse(entry.details || '{}'); if (/^\d+$/.test(String(d.internal_ad_id ?? ''))) ids.add(String(d.internal_ad_id)); } catch { /* no details */ }
    const sha = String(entry.image_sha256 || value).toLowerCase();
    if (/^[0-9a-f]{64}$/.test(sha)) {
      for (const r of await sql.query('SELECT internal_ad_id AS id FROM copyright_image_hashes WHERE sha256 = ? AND network = ? LIMIT 1000', [sha, network])) {
        if (r.id != null) ids.add(String(r.id));
      }
    }
    if (!ids.size) return { ids: [], next: null };
    const list = [...ids];
    return { ids: idsOf(await sql.query(`SELECT id, ad_id FROM ${table} WHERE id IN (${list.map(() => '?').join(',')}) AND ${live}`, list)), next: null };
  }
  // advertiser: owners by their indexed lowercase name, through B2's checked table map (same lookup as the hash job).
  const names = sources.nameCandidates(value);
  if (!names.length) return { ids: [], next: null };
  let source;
  try { source = sources.sourceFor(network); } catch { return { ids: [], next: null }; } // network not in the map yet
  const owners = await sources.findOwners(sql, source, names);
  if (!owners.length) return { ids: [], next: null };
  const ownerIds = owners.map((o) => o.id);
  const rows = await sql.query(`SELECT id, ad_id FROM ${table} WHERE post_owner_id IN (${ownerIds.map(() => '?').join(',')}) AND id > ? AND ${live}
    ORDER BY id LIMIT ${Number(limit)}`, [...ownerIds, afterId]);
  return { ids: idsOf(rows), next: rows.length === Number(limit) ? Number(rows[rows.length - 1].id) : null };
}

async function recheckExisting(db, network, s) {
  let cur = recheckCursors.get(network);
  if (!cur) { cur = { entryId: await recheckStart(db.sql, s), page: null }; recheckCursors.set(network, cur); }
  // Our own ad_id entries are for ads the cleanup cron is already removing.
  const entries = await db.sql.query(`SELECT id, entry_type, identifier_namespace, value, image_sha256, details FROM copyright_blocklist
    WHERE id > ? AND network IN (?, 'all') AND status = 'active' AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
      AND entry_type IN ('ad_id', 'advertiser', 'image_hash') AND NOT (entry_type = 'ad_id' AND added_by = ?)
    ORDER BY id LIMIT ${Number(s.recheckEntries)}`, [cur.entryId, network, ADDED_BY]);
  const found = new Map(); // internal id -> { adId, entry }: the first entry that covers the ad
  let lastEntry = cur.entryId;
  for (const entry of entries) {
    let afterId = cur.page?.entryId === entry.id ? cur.page.afterId : 0;
    let done = false;
    while (found.size < s.recheckAds) {
      const page = await adsOfEntry(db.sql, network, entry, afterId, Math.min(500, s.recheckAds - found.size));
      for (const ad of page.ids) if (!found.has(ad.id)) found.set(ad.id, { adId: ad.adId, entry });
      if (page.next == null) { done = true; break; }
      afterId = page.next;
    }
    // Per-tick limit reached in the middle of an advertiser: continue from this page next tick.
    if (!done) { cur.page = { entryId: entry.id, afterId }; break; }
    lastEntry = entry.id;
    cur.page = null;
  }
  cur.entryId = lastEntry;
  const list = [...found.keys()];
  const failed = await setSqlStatus(db.sql, network, list, FAILED, LIVE);
  // Hide them in search now; the cleanup cron deletes them shortly. An ES error is only logged (cleanup still deletes).
  if (failed) {
    try { await setEsStatus(db.elastic, network, list, FAILED); }
    catch (error) { log.warn('copyright recheck: ES hide failed', { network, error: error.message }); }
    log.info('copyright recheck: existing ads failed by new blocklist entries', { network, failed, upToEntry: cur.entryId });
    // Why each ad failed, for the monitor's Rejected ads tab (copyright_blocked_attempts).
    for (const { adId, entry } of found.values()) {
      blocklist.recordAttempt({ network, platformAdId: adId, advertiser: entry.entry_type === 'advertiser' ? entry.value : null, blocklistId: Number(entry.id),
        matchType: entry.entry_type === 'image_hash' ? 'sha256' : entry.entry_type, source: 'verification-recheck' });
    }
  }
  return { entries: entries.length, failed };
}

async function verifyNetwork(network) {
  const s = settings();
  const db = databaseManager.getConnections(network);
  if (!db?.sql || !db?.elastic) return { skipped: 'SQL or ES not connected' };
  const banned = blocklist.getImageHashes(network);
  if (!banned.available) return { skipped: 'blocklist not loaded' };

  let rechecked = null;
  if (s.recheckExisting) {
    try { rechecked = await recheckExisting(db, network, s); }
    catch (error) { rechecked = { error: error.message }; log.error('copyright recheck failed', { network, error: error.message }); }
  }

  const ads = await loadAds(db.sql, network, PENDING, cursors.get(network) || 0, s.batchSize);
  if (!ads.length) { cursors.set(network, 0); return { scanned: 0, ...(rechecked ? { rechecked } : {}) }; }
  cursors.set(network, Number(ads[ads.length - 1].id));

  // B1 matches only platform ad ids; ads blocked by our internal row id
  // (identifier_namespace = 'internal') are found here, for this page only.
  const internal = await internalBlocks(db.sql, network, ads.map((ad) => ad.id));
  const failed = [];  // { ad, blocklistId, matchType, distance }
  const toHash = [];
  for (const ad of ads) {
    if (held.has(`${network}:${ad.id}`)) continue;
    if (internal.has(ad.id)) { failed.push({ ad, blocklistId: internal.get(ad.id), matchType: 'ad_id' }); continue; }
    // Metadata (platform ad id / advertiser / url / domain) against the B1 in-memory list.
    const hit = blocklist.match({ ad_id: ad.adId, post_owner: ad.ad.post_owner, destination_url: ad.ad.destination_url }, network);
    if (hit) failed.push({ ad, blocklistId: hit.hit.entry.id, matchType: hit.hit.entry.entryType });
    else toHash.push(ad);
  }

  // Images: hash only what can be compared, and only when there is something to compare against.
  const approved = [];
  const imageUrls = (ad) => [...ad.paths].filter((p) => IMAGE_EXT.test(p)).map(nas.resolveMediaUrl).filter((u) => /^https?:\/\//i.test(u));
  if (!banned.hashes.length) approved.push(...toHash);
  else if (!await hashServiceReady()) {
    // Without the hash service nothing can be proved clear; metadata failures are still recorded.
    log.warn('copyright verification: image hash service not ready, images retried later', { network });
  } else {
    const urls = [...new Set(toHash.flatMap(imageUrls))];
    const hashed = await hashImages(urls, s);
    const list = [...hashed.entries()];
    const decisions = await matchBatch(list.map(([, h]) => h), banned.hashes,
      { hashVersion: config.compliance.imageMatch.hashVersion, perceptual: config.compliance.imageMatch.perceptual }, s.workers);
    const byUrl = new Map(list.map(([url], i) => [url, decisions[i]]));
    for (const ad of toHash) {
      const urlsOfAd = imageUrls(ad);
      const results = urlsOfAd.map((u) => byUrl.get(u));
      const at = results.findIndex((r) => r?.action === 'reject');
      if (at >= 0) { const r = results[at]; failed.push({ ad, blocklistId: r.blocklistId, matchType: r.kind, distance: r.distance, imageUrl: urlsOfAd[at] }); continue; }
      const key = `${network}:${ad.id}`;
      // Close to a blocked image but not close enough to reject: keep it hidden for a person to decide.
      if (results.some((r) => r?.action === 'review')) { held.add(key); log.warn('copyright review needed', { network, id: ad.id }); continue; }
      if (results.every(Boolean)) { attempts.delete(key); approved.push(ad); continue; }
      // Image not reachable yet (e.g. NAS upload still queued): retry on a later pass.
      const n = (attempts.get(key) || 0) + 1;
      attempts.set(key, n);
      if (n >= s.maxHashAttempts && s.afterMaxAttempts === 'approve') { attempts.delete(key); approved.push(ad); }
    }
  }

  // Approve: ES first, then SQL. If ES fails the row stays pending and is retried.
  const approvedIds = approved.map((ad) => ad.id);
  await setEsStatus(db.elastic, network, approvedIds, APPROVED);
  const nApproved = await setSqlStatus(db.sql, network, approvedIds, APPROVED);
  // Fail: SQL only. ES already hides pending docs; the cleanup cron deletes them.
  const nFailed = await setSqlStatus(db.sql, network, failed.map((f) => f.ad.id), FAILED);
  for (const f of failed) {
    // Audit of the match, through B1's batched attempts writer (copyright_blocked_attempts).
    blocklist.recordAttempt({ network, platformAdId: f.ad.adId, advertiser: f.ad.ad.post_owner, blocklistId: f.blocklistId,
      imageUrl: f.imageUrl ?? null, matchType: f.matchType || 'unknown', distance: f.distance ?? null, source: 'verification' });
  }
  return { scanned: ads.length, approved: nApproved, failed: nFailed, pending: ads.length - nApproved - nFailed, ...(rechecked ? { rechecked } : {}) };
}

// ─── Cron 2: remove failed ads ──────────────────────────────────────────

// Only the ad's own creative files: never a post-owner image or another ad's file.
function ownFile(path, ad) {
  if (/\/postowner\//i.test(path) || !/\/(?:adImage|adVideo)\//i.test(path)) return false;
  const name = path.split('/').pop();
  return [ad.id, ad.adId].filter(Boolean).some((id) => name.startsWith(`${id}.`) || name.startsWith(`${id}_`));
}

// B3 takedown run, saved BEFORE any delete: its preflight_snapshot holds every id and
// NAS path, so the Takedown Monitor (src/compliance/monitor) shows the run and its steps.
// A run left 'running' by a crash would show as Running forever; its ads are still at status 2 and are retried by a later run.
// Called on EVERY cleanup tick (also when there is nothing to delete), so the last stuck runs are closed too.
async function closeStaleRuns(sql, network) {
  await sql.query(`UPDATE copyright_takedown_runs SET status = 'failed', items_planned = items_succeeded + items_failed, finished_at = UTC_TIMESTAMP(),
    details = 'process stopped before the run finished; its ads are retried by a later run'
    WHERE network = ? AND status = 'running' AND trigger_type = 'verification' AND operator = ? AND started_at < UTC_TIMESTAMP() - INTERVAL 1 HOUR`,
  [network, ADDED_BY]);
}

async function startRun(sql, network, ads) {
  const runId = crypto.randomUUID();
  const snapshot = { snapshotVersion: 1, capturedAt: new Date().toISOString(),
    ads: ads.map((ad) => ({ internalId: ad.id, platformAdId: ad.adId ?? null, storagePaths: [...ad.paths].filter((p) => ownFile(p, ad)) })) };
  await sql.query(`INSERT INTO copyright_takedown_runs (run_id, network, trigger_type, mode, status, started_at, items_planned, items_succeeded,
    items_failed, operator, preflight_snapshot, created_at) VALUES (?, ?, 'verification', 'execute', 'running', UTC_TIMESTAMP(), ?, 0, 0, ?, ?, UTC_TIMESTAMP())`,
  [runId, network, ads.length, ADDED_BY, JSON.stringify(snapshot)]);
  return runId;
}

// Steps of the run (storage + sql per ad), the run's final counts, and the B6 findings.
// `system` is a reserved word in MySQL 8, so the column is always quoted with backticks.
// The run is closed even when a step or audit write fails, so it never stays 'running'.
async function finishRun(sql, network, runId, steps, removed, refused) {
  const errors = [];
  if (steps.length) {
    const rows = steps.map((st) => [runId, network, 'ad', st.ad.adId == null ? null : String(st.ad.adId), st.ad.id, st.system, st.status,
      st.error ?? null, JSON.stringify(st.details)]);
    try {
      await sql.query(`INSERT INTO copyright_takedown_actions (run_id, network, target_type, target_id, internal_ad_id, \`system\`, operation, status,
        error_message, details, attempts, started_at, finished_at, created_at)
        VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, 'delete', ?, ?, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())").join(', ')}`, rows.flat());
    } catch (error) { errors.push(`steps: ${error.message}`); }
  }
  // An ad waiting for a NAS retry is planned again by the next run (its 'retry' storage step stays in this run's log),
  // so it is not counted here: otherwise the monitor's "Waiting" would count it twice and never go down.
  // 'succeeded' / 'failed' are the words the admin Takedown Monitor filters on (react_admin TakedownMonitor.jsx RUN_FILTERS).
  await sql.query(`UPDATE copyright_takedown_runs SET status = ?, items_planned = ?, items_succeeded = ?, items_failed = ?, finished_at = UTC_TIMESTAMP(),
    details = ? WHERE run_id = ? AND network = ?`,
  [refused ? 'failed' : 'succeeded', removed.length + refused, removed.length, refused, errors.length ? `log not fully saved: ${errors.join('; ')}`.slice(0, 2000) : null, runId, network]);
  if (removed.length) {
    try {
      const auditId = crypto.randomUUID();
      await sql.query(`INSERT INTO copyright_audit_runs (audit_id, network, audit_type, status, started_at, finished_at, expected_count, found_count,
        takedown_run_id, created_at) VALUES (?, ?, 'verification_cleanup', 'completed', UTC_TIMESTAMP(), UTC_TIMESTAMP(), ?, ?, ?, UTC_TIMESTAMP())`,
      [auditId, network, removed.length, removed.length, runId]);
      const rows = removed.map((r) => [auditId, network, 'blocklist_hit', 'sql', NETWORKS[network][0], r.ad.id, r.ad.adId ?? null,
        'ad_id', r.ad.adId ?? null, JSON.stringify({ nasDeleted: r.nasDeleted, nasFailed: r.nasFailed }), 'resolved', 'removed', runId]);
      await sql.query(`INSERT INTO copyright_audit_findings (audit_id, network, finding_type, \`system\`, location, internal_ad_id, platform_ad_id,
        target_type, target_value, details, status, resolution, takedown_run_id, resolved_at, created_at)
        VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())').join(', ')}`, rows.flat());
    } catch (error) { errors.push(`audit: ${error.message}`); }
  }
  if (errors.length) throw new Error(errors.join('; '));
}

async function cleanupNetwork(network) {
  const s = settings();
  const db = databaseManager.getConnections(network);
  if (!db?.sql) return { skipped: 'SQL not connected' };
  if (s.audit !== false) {
    try { await closeStaleRuns(db.sql, network); }
    catch (error) { log.warn('copyright cleanup: could not close stale runs', { network, error: error.message }); }
  }
  const ads = await loadAds(db.sql, network, FAILED, 0, s.cleanupBatchSize);
  if (!ads.length) return { scanned: 0 };

  // 1. Blocklist first, so a re-scraped copy is refused at insertion (B1 guard) from now on.
  const entries = ads.filter((ad) => ad.adId).map((ad) => ({ entryType: 'ad_id', identifierNamespace: 'platform', value: String(ad.adId), network, addedBy: ADDED_BY,
    source: 'verification', reason: 'failed copyright verification' }));
  if (s.blockAdvertiser) {
    for (const name of new Set(ads.map((ad) => ad.ad.post_owner).filter(Boolean))) {
      entries.push({ entryType: 'advertiser', value: String(name), network, addedBy: ADDED_BY, source: 'verification', reason: 'failed copyright verification' });
    }
  }
  if (entries.length) await blocklist.add(entries);

  // 2. Takedown run + snapshot. If it cannot be saved, nothing is deleted (retried next tick).
  const runId = s.audit === false ? null : await startRun(db.sql, network, ads);

  // 3. NAS, then SQL + ES through the network's existing delete pipeline. SQL goes last,
  //    so a failure leaves the row at status 2 and the next tick retries it.
  const { processDelete } = require(`../${network}/insertion/deletePipeline`);
  const removed = [];
  const steps = [];
  let refused = 0;
  for (const ad of ads) {
    const files = [...ad.paths].filter((p) => ownFile(p, ad));
    const results = await mapWithConcurrency(files, s.nasConcurrency, async (p) => ({ p, ok: await nas.deleteFromNas(p, { adId: ad.id }) }));
    const nasFailed = results.filter((r) => !r.ok).map((r) => r.p);
    const key = `${network}:nas:${ad.id}`;
    const retry = nasFailed.length && (attempts.get(key) || 0) + 1 < s.maxNasAttempts;
    steps.push({ ad, system: 'storage', status: !files.length ? 'not_applicable' : nasFailed.length ? (retry ? 'retry' : 'failed') : 'succeeded',
      error: nasFailed.length ? 'NAS delete failed' : null, details: { deleted: files.filter((p) => !nasFailed.includes(p)), failed: nasFailed } });
    if (retry) { attempts.set(key, (attempts.get(key) || 0) + 1); continue; }
    attempts.delete(key);
    const res = await processDelete({ id: ad.id, body: { id: ad.id } }, { db, log, network });
    const ok = res?.code === 200;
    steps.push({ ad, system: 'sql', status: ok ? 'succeeded' : 'failed', error: ok ? null : String(res?.message || 'delete refused').slice(0, 2000),
      details: { via: `${network} deletePipeline (SQL + ES)`, code: res?.code ?? null } });
    if (ok) removed.push({ ad, nasDeleted: files.length - nasFailed.length, nasFailed });
    else { refused += 1; log.warn('copyright cleanup: delete pipeline refused', { network, id: ad.id, code: res?.code, message: res?.message }); }
  }

  // 4. Steps, run status and B6 findings. The ads are gone already, so a write error here is logged, not retried as a delete.
  if (runId) {
    try { await finishRun(db.sql, network, runId, steps, removed, refused); }
    catch (error) { log.error('copyright cleanup: audit write failed', { network, runId, error: error.message, ids: removed.map((r) => r.ad.id) }); }
  }
  return { scanned: ads.length, removed: removed.length, ...(runId ? { runId } : {}) };
}

// ─── Cron entry points (src/jobs/cronManager.js) ────────────────────────

function selectedNetworks(jobCfg) {
  const list = Array.isArray(jobCfg?.networks) && jobCfg.networks.length ? jobCfg.networks : settings().networks;
  const all = Object.keys(NETWORKS);
  return list?.length ? list.filter((n) => all.includes(n)) : all;
}

async function runAll(kind, task, jobCfg) {
  if (!settings().enabled) return { skipped: 'compliance.copyrightVerification.enabled is false' };
  const results = {};
  for (const network of selectedNetworks(jobCfg)) {
    const key = `${kind}:${network}`;
    if (running.has(key)) { results[network] = { skipped: 'previous run still active' }; continue; }
    running.add(key);
    try { results[network] = await task(network); }
    catch (error) { results[network] = { error: error.message }; log.error(`copyright ${kind} failed`, { network, error: error.message }); }
    finally { running.delete(key); }
  }
  log.info(`copyright ${kind} tick`, results);
  return results;
}

const runVerification = (jobCfg) => runAll('verification', verifyNetwork, jobCfg);
const runCleanup = (jobCfg) => runAll('cleanup', cleanupNetwork, jobCfg);

module.exports = { runVerification, runCleanup, verifyNetwork, cleanupNetwork, recheckExisting, recheckCursors, loadAds, ownFile };
