'use strict';

/**
 * google_audit_keywords — MongoDB repository (replaces the old SQL google_keyword_search).
 *
 * One document per UNIQUE keyword, case-insensitive: identity = `keywordNorm`
 * (value.trim().toLowerCase()), enforced by a unique index — so dedupe is a single
 * indexed upsert, never a read-before-write. Backs:
 *   - GET  get-search-audit-keywords   → getCrawlBatch (cursored pull of crawlable rows)
 *   - POST insert-search-audit-keywords → bulkUpsertKeywords + enforceCap
 *   - cron googleKeywordAudit           → importGoogleUserSearches + enforceCap
 *
 * The collection is capped at config.googleKeywordAudit.maxCount; the oldest rows
 * (by _id, i.e. insertion order) are deleted once the count exceeds it.
 *
 * Self-resolves its Mongo handle via dbManager + config (works in both request and
 * cron contexts), mirroring keywordSearchController.getCollection.
 */

const { ObjectId } = require('mongodb');
const dbManager = require('../../../database/DatabaseManager');
const config = require('../../../config');

const cfg = () => config.googleKeywordAudit;

/** normalized dedupe key — 'Cat', 'cat ', ' CAT' → 'cat'. */
function normalize(keyword) {
  return String(keyword == null ? '' : keyword).trim().toLowerCase();
}

function getDb() {
  const c = cfg();
  const conn = dbManager.getMongo(c.mongoSlug);
  if (!conn) return null;
  return c.database ? conn.client.db(c.database) : conn.db;
}

function getCollection() {
  const db = getDb();
  return db ? db.collection(cfg().collection) : null;
}
function getMetaCollection() {
  const db = getDb();
  return db ? db.collection(cfg().metaCollection) : null;
}
function getSourceCollection() {
  const db = getDb();
  return db ? db.collection(cfg().sourceCollection) : null;
}

let indexesReady = null;
async function ensureIndexes(col) {
  if (!indexesReady) {
    indexesReady = col.createIndexes([
      // dedupe + exact case-insensitive lookup
      { key: { keywordNorm: 1 }, name: 'uniq_keyword_norm', unique: true },
      // crawl pull: crawlable statuses, cursored by _id ascending
      { key: { status: 1, _id: 1 }, name: 'crawl_status_id' },
    ]).catch((err) => { indexesReady = null; throw err; });
  }
  return indexesReady;
}

// ── cursor (crawl + import) stored in the meta collection ────────────────────────
async function readCursor(name) {
  const meta = getMetaCollection();
  if (!meta) return null;
  const doc = await meta.findOne({ _id: `cursor:${name}` });
  return doc && doc.lastId ? doc.lastId : null;
}
async function writeCursor(name, lastId) {
  const meta = getMetaCollection();
  if (!meta) return;
  await meta.updateOne({ _id: `cursor:${name}` }, { $set: { lastId, updatedAt: new Date() } }, { upsert: true });
}

// ── bulk upsert (dedupe via unique index) ────────────────────────────────────────
/**
 * @param {Array<{keyword:string,country?:any,user_id?:any,status?:number}>} items
 * @param {string} source  provenance tag ('upload' | 'user_search')
 * @returns {{received:number, unique:number, inserted:number, alreadyPresent:number}}
 */
async function bulkUpsertKeywords(items, source) {
  const col = getCollection();
  if (!col) throw new Error('Mongo collection unavailable');
  await ensureIndexes(col);

  const received = items.length;
  // intra-batch dedupe by normalized key (keep the first occurrence's metadata)
  const byNorm = new Map();
  for (const it of items) {
    const keyword = it && it.keyword != null ? String(it.keyword).trim() : '';
    if (!keyword) continue;
    const keywordNorm = normalize(keyword);
    if (!keywordNorm || byNorm.has(keywordNorm)) continue;
    byNorm.set(keywordNorm, { keyword, keywordNorm, country: it.country ?? null, user_id: it.user_id ?? null, status: Number.isFinite(it.status) ? it.status : 0 });
  }
  const unique = byNorm.size;
  if (unique === 0) return { received, unique: 0, inserted: 0, alreadyPresent: 0 };

  const now = new Date();
  const ops = [...byNorm.values()].map((d) => ({
    updateOne: {
      filter: { keywordNorm: d.keywordNorm },
      update: {
        $setOnInsert: {
          keyword: d.keyword,
          keywordNorm: d.keywordNorm,
          status: d.status,
          country: d.country,
          user_id: d.user_id,
          hit_count: 0,
          process_date: null,
          source,
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      upsert: true,
    },
  }));

  const chunk = cfg().insertChunkSize || 2000;
  let inserted = 0;
  for (let i = 0; i < ops.length; i += chunk) {
    const res = await col.bulkWrite(ops.slice(i, i + chunk), { ordered: false });
    inserted += res.upsertedCount || 0;
  }
  return { received, unique, inserted, alreadyPresent: unique - inserted };
}

// ── count + cap enforcement ──────────────────────────────────────────────────────
async function countAll() {
  const col = getCollection();
  if (!col) throw new Error('Mongo collection unavailable');
  return col.countDocuments();
}

/**
 * Trim to at most `maxCount` by deleting the oldest rows (lowest _id = oldest inserted).
 * @returns {{total:number, deleted:number}} total is the post-trim count.
 */
async function enforceCap(maxCount) {
  const col = getCollection();
  if (!col) throw new Error('Mongo collection unavailable');
  const cap = Number.isFinite(maxCount) ? maxCount : cfg().maxCount;
  const total = await col.countDocuments();
  if (total <= cap) return { total, deleted: 0 };

  const overflow = total - cap;
  const oldest = await col.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(overflow).toArray();
  if (!oldest.length) return { total, deleted: 0 };
  const res = await col.deleteMany({ _id: { $in: oldest.map((d) => d._id) } });
  const deleted = res.deletedCount || 0;
  return { total: total - deleted, deleted };
}

// ── GET: cursored batch of crawlable keywords ────────────────────────────────────
/**
 * Returns up to `batchSize` crawlable docs (status in crawlStatuses) after the stored
 * cursor, oldest first; loops back to the start when the cursor runs dry. Advances the
 * cursor to the last returned _id. Mirrors the old SQL crawler exactly.
 */
async function getCrawlBatch(batchSize, statuses) {
  const col = getCollection();
  if (!col) throw new Error('Mongo collection unavailable');
  const base = { status: { $in: statuses } };

  const lastId = await readCursor('crawl');
  const query = lastId ? { ...base, _id: { $gt: lastId } } : base;
  let docs = await col.find(query).sort({ _id: 1 }).limit(batchSize).toArray();

  if (!docs.length && lastId) {
    // cursor reached the end → loop back to the beginning
    docs = await col.find(base).sort({ _id: 1 }).limit(batchSize).toArray();
  }
  if (!docs.length) return { data: [] };

  await writeCursor('crawl', docs[docs.length - 1]._id);
  return { data: docs };
}

// ── import google user-searched keywords from keyword_searches ───────────────────
/**
 * Incrementally pulls keyword_searches docs of `importType` whose `networks` include
 * `importNetwork`, and upserts their value into google_audit_keywords (deduped). Tracks
 * an _id cursor so each run only scans new source docs.
 * @returns {{scanned:number, inserted:number, batches:number, caughtUp:boolean}}
 */
async function importGoogleUserSearches() {
  const src = getSourceCollection();
  const col = getCollection();
  if (!src || !col) throw new Error('Mongo collection unavailable');
  await ensureIndexes(col);

  const c = cfg();
  const batch = c.importBatch || 2000;
  const maxBatches = c.importMaxBatches || 50;

  let scanned = 0;
  let inserted = 0;
  let batches = 0;
  let lastId = await readCursor('import');
  let caughtUp = false;

  for (let b = 0; b < maxBatches; b++) {
    const filter = { type: c.importType, networks: c.importNetwork };
    if (lastId) filter._id = { $gt: lastId };
    const docs = await src.find(filter, { projection: { value: 1, valueNorm: 1 } })
      .sort({ _id: 1 }).limit(batch).toArray();
    if (!docs.length) { caughtUp = true; break; }

    const items = docs.map((d) => ({ keyword: d.value != null ? d.value : d.valueNorm }));
    const r = await bulkUpsertKeywords(items, 'user_search');
    inserted += r.inserted;
    scanned += docs.length;
    batches += 1;
    lastId = docs[docs.length - 1]._id;
    await writeCursor('import', lastId);

    if (docs.length < batch) { caughtUp = true; break; }
  }
  return { scanned, inserted, batches, caughtUp };
}

module.exports = {
  normalize,
  getCollection, getMetaCollection, getSourceCollection, ensureIndexes,
  readCursor, writeCursor,
  bulkUpsertKeywords, countAll, enforceCap,
  getCrawlBatch, importGoogleUserSearches,
  _ObjectId: ObjectId,
};
