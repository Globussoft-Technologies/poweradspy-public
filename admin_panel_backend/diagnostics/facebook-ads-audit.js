/**
 * Facebook Unhealthy-Ads Audit — interactive CLI.
 *
 *     cd admin_panel_backend
 *     node diagnostics/facebook-ads-audit.js
 *
 * Audits how many Facebook ads do NOT comply with the displayable-media filters
 * that gate what the frontend shows, across BOTH stores:
 *
 *   • Elasticsearch (index = FB_INDEX, e.g. "search_mix")
 *       Source of truth = utils/displayable-media-filters.js (the exact filter the
 *       new-ui-react frontend applies). An ad is "unhealthy" when it FAILS that
 *       filter, i.e. it is IMAGE with no `new_nas_image_url`, or VIDEO with no
 *       `Thumbnail`.
 *
 *       ALSO flagged unhealthy: DUPLICATE documents — two or more docs sharing the
 *       same `facebook_ad.id`. The search query collapses on `facebook_ad.id`, so
 *       the extra copies are invisible in the result rows, but `hits.total`
 *       (which the UI shows as the ad count) counts them pre-collapse. That makes
 *       the displayed count run ahead of the rendered cards. The redundant copies
 *       (doc_count − 1 per id) are deletable; one doc per id is kept.
 *
 *   • MySQL (db = FB_DATABASE, tables facebook_ad + facebook_ad_variants)
 *       Source of truth = facebook_ad_variants.image_url — the primary stored image
 *       that ES new_nas_image_url (IMAGE) / Thumbnail (VIDEO) are built from. Only
 *       IMAGE/VIDEO require media (other types pass the displayable filter → healthy).
 *       An ad is "unhealthy" when it has NO variant row, or its image_url is empty /
 *       a default or legacy non-NAS path (bydefault/DefaultImage/pasimage/pasvideo).
 *       (NOT facebook_ad_image_video — that's the sparse carousel/otherMedia field.)
 *
 * The two are reported as INDEPENDENT audits of equal weight — each gets its own
 * counts, per-factor breakdown and samples.
 *
 * READ-ONLY by default. A "delete" option is scaffolded but hard-disabled
 * (ENABLE_DELETE = false) — see deleteFlow() — so for now this only reports.
 *
 * Every audit run is ALSO written to
 * diagnostics/audit-reports/facebook-audit-<timestamp>.{json,xlsx}
 * automatically — incrementally, so the ES portion is on disk before the SQL
 * audit even starts, and a hang / Ctrl-C still leaves whatever finished. A
 * per-operation timeout means a stuck ES/MySQL connection errors out (and gets
 * logged) instead of hanging the CLI forever.
 *
 * Flags (optional, for non-interactive / cron use):
 *     --run=es|sql|both     run that audit immediately, print + log, then exit
 *     --samples=N           number of sample rows/docs per factor (default 5)
 *     --timeout=MS          per-ES/MySQL-operation timeout (default 45000)
 *     --noDup               skip the ES duplicate-document scan (faster ES audit)
 *     --dupPageSize=N       composite page size for the duplicate scan (default 10000)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const readline = require('readline');
const queryDatabase = require('../db-connections/connection');
const searchAllInstances = require('../es-connections/connection');
const { getDisplayableMediaFilter } = require('../utils/displayable-media-filters');
const { writeXlsx } = require('./xlsx-writer');
const { writeMarkdown, CENTRAL_LOG } = require('./lib/markdown-writer');
const { nasGoodMediaExpr } = require('./lib/media-good-expr');

// --------------------------------------------------------------------------
// HARD SAFETY SWITCH. Deletion is intentionally not enabled yet — this run is
// audit-only. Flipping this to true is NOT enough on its own; deleteFlow() also
// requires an explicit typed confirmation and a non-readonly DB user.
const ENABLE_DELETE = false;

// Facebook store coordinates. es_id / db_id match the live mappings
// (src/total-ad-count-analytics.js + src/dynamic-count-analytics.js). In DEV the
// connection modules force index 0 regardless, so these only matter in PROD.
const FB = {
  esId: 0,
  esIndex: process.env.FB_INDEX || 'search_mix',
  dbId: 0,
  database: process.env.FB_DATABASE || 'pasdev_facebook',
  mainTable: 'facebook_ad',
  // Media source-of-truth is the VARIANT image (image_url) — what ES
  // new_nas_image_url (IMAGE) / Thumbnail (VIDEO) are derived from at insert. NOT
  // facebook_ad_image_video: that's the sparse carousel / "otherMedia" field
  // (~80-94% of ads have no row there), so it over-reported "missing media".
  mediaTable: 'facebook_ad_variants',
  contentColumn: 'image_url',
};

// --------------------------------------------------------------------------
// arg parser (same shape as diagnostics/healthcheck.js)
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const SAMPLE_SIZE = Math.max(1, parseInt(args.samples, 10) || 5);

// Duplicate-document scan controls. The scan composite-paginates every
// facebook_ad.id bucket — heavier than the plain counts — so it can be skipped
// with --noDup. Page size is capped at 10000 (ES composite/max_buckets ceiling);
// lower it if a cluster rejects the page with a "too_many_buckets" error.
const SCAN_DUPLICATES = !args.noDup;
const DUP_PAGE_SIZE = Math.min(10000, Math.max(100, parseInt(args.dupPageSize, 10) || 10000));

// Where detailed reports are written. Deliberately NOT logs/ — that folder is
// git-ignored, so VS Code hides the files. This folder is committed-visible.
const REPORT_DIR = path.join(__dirname, 'audit-reports');

// --------------------------------------------------------------------------
// pretty logging
const line = (c = '─') => console.log(c.repeat(78));
const head = (t) => { line('═'); console.log('  ' + t); line('═'); };
const sub = (t) => console.log('\n• ' + t);
const info = (m) => console.log('   •  ' + m);
const ok = (m) => console.log('   ✅ ' + m);
const bad = (m) => console.log('   ❌ ' + m);
const warn = (m) => console.log('   ⚠️  ' + m);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');
const fmt = (n) => Number(n).toLocaleString('en-US');

// holds the most recent report so the "export" menu option can write it out
let lastReport = null;
// the log file base path for the CURRENT run — set when an audit starts so we can
// persist incrementally to the SAME file (ES portion is on disk before the SQL
// audit even begins, so a hang/Ctrl-C can never lose an already-finished store).
let runBase = null;

// Per-operation timeout so a stuck ES/MySQL connection turns into an error the
// flow can recover from + log, instead of hanging the CLI forever.
const OP_TIMEOUT_MS = Math.max(5000, parseInt(args.timeout, 10) || 45000);
function withTimeout(promise, label) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${OP_TIMEOUT_MS}ms`)), OP_TIMEOUT_MS);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// ==========================================================================
// ELASTICSEARCH AUDIT
// ==========================================================================

// searchAllInstances swallows errors and returns {} — treat a missing `.data`
// as a failure so we never silently report 0.
async function esCount(query) {
  const res = await withTimeout(searchAllInstances(FB.esIndex, { query }, FB.esId, 'count'), 'ES count');
  if (!res || res.data === undefined) throw new Error('ES count returned no data (search failed — see log above)');
  return res.data;
}

async function esSamples(query, size = SAMPLE_SIZE) {
  const body = {
    size,
    _source: ['facebook_ad.id', 'facebook_ad.type', 'facebook_ad.last_seen',
      'new_nas_image_url', 'Thumbnail', 'facebook_ad_url.url'],
    query,
  };
  const res = await withTimeout(searchAllInstances(FB.esIndex, body, FB.esId, 'search'), 'ES samples');
  const hits = res?.data?.hits?.hits || [];
  return hits.map((h) => ({
    _id: h._id,
    ad_id: h._source?.['facebook_ad.id'],
    type: h._source?.['facebook_ad.type'],
    last_seen: h._source?.['facebook_ad.last_seen'],
    new_nas_image_url: h._source?.['new_nas_image_url'] ?? null,
    Thumbnail: h._source?.['Thumbnail'] ?? null,
    url: h._source?.['facebook_ad_url.url'] ?? null,
  }));
}

// Raw aggregation/search passthrough — returns the full ES response body so the
// caller can read `.aggregations` / `.hits`. (searchAllInstances swallows errors
// and returns {}, so a missing `.data` means the search failed.)
async function esAgg(body, label) {
  const res = await withTimeout(searchAllInstances(FB.esIndex, body, FB.esId, 'search'), label);
  if (!res || res.data === undefined) throw new Error(`${label} returned no data (search failed — see log above)`);
  return res.data;
}

// Composite-paginate every `facebook_ad.id` bucket to find ids backed by more
// than one document. Each redundant copy (doc_count − 1 per id) is a deletable
// duplicate: the search collapses on facebook_ad.id so the extras never render,
// but they inflate the pre-collapse hits.total the UI shows as the ad count.
// Composite pagination keeps memory flat (one page at a time) and is exact —
// unlike a cardinality agg, which is approximate above 40k distinct values.
async function findDuplicates() {
  let after = null;
  let pages = 0;
  let scannedDocs = 0;   // sum of doc_count over ALL ids (should equal index total)
  let distinctIds = 0;   // number of distinct facebook_ad.id values
  let extraDocs = 0;     // sum(doc_count − 1) over duplicated ids — what deletion removes
  let docsInvolved = 0;  // sum(doc_count) over duplicated ids only
  const duplicatedIds = []; // [{ id, count }] for every id with count > 1 (full set, for deletion)

  for (;;) {
    const body = {
      size: 0,
      aggs: {
        dup: {
          composite: {
            size: DUP_PAGE_SIZE,
            sources: [{ fbid: { terms: { field: 'facebook_ad.id' } } }],
            ...(after ? { after } : {}),
          },
        },
      },
    };
    const data = await esAgg(body, `ES duplicate scan (page ${pages + 1})`);
    const agg = data.aggregations && data.aggregations.dup;
    const buckets = (agg && agg.buckets) || [];
    if (!buckets.length) break;

    for (const b of buckets) {
      distinctIds += 1;
      scannedDocs += b.doc_count;
      if (b.doc_count > 1) {
        duplicatedIds.push({ id: b.key.fbid, count: b.doc_count });
        extraDocs += b.doc_count - 1;
        docsInvolved += b.doc_count;
      }
    }

    pages += 1;
    if (pages % 20 === 0) {
      info(`…scanned ${fmt(scannedDocs)} docs / ${fmt(distinctIds)} distinct ids — ${fmt(extraDocs)} duplicate copies so far`);
    }

    after = agg.after_key;
    if (!after) break;
  }

  return {
    scannedDocs,
    distinctIds,
    duplicatedIdCount: duplicatedIds.length,
    extraDocs,
    docsInvolved,
    duplicatedIds,
  };
}

// Pull the actual docs for a few duplicated ids so the report shows the colliding
// copies (same fbId on multiple ES _id rows). Mapped to the standard ES-sample
// shape so it flows through the existing print + "ES Samples" sheet unchanged.
async function esDuplicateSamples(ids) {
  if (!ids || !ids.length) return [];
  const body = {
    size: Math.max(50, ids.length * 10), // headroom for each id's copies
    _source: ['facebook_ad.id', 'facebook_ad.type', 'facebook_ad.last_seen',
      'new_nas_image_url', 'Thumbnail', 'facebook_ad_url.url'],
    sort: [{ 'facebook_ad.id': 'asc' }, { 'facebook_ad.last_seen': 'desc' }],
    query: { terms: { 'facebook_ad.id': ids } },
  };
  const res = await withTimeout(searchAllInstances(FB.esIndex, body, FB.esId, 'search'), 'ES duplicate samples');
  const hits = (res && res.data && res.data.hits && res.data.hits.hits) || [];
  return hits.map((h) => ({
    _id: h._id,
    ad_id: h._source && h._source['facebook_ad.id'],
    type: h._source && h._source['facebook_ad.type'],
    last_seen: h._source && h._source['facebook_ad.last_seen'],
    new_nas_image_url: (h._source && h._source['new_nas_image_url']) ?? null,
    Thumbnail: (h._source && h._source['Thumbnail']) ?? null,
    url: (h._source && h._source['facebook_ad_url.url']) ?? null,
  }));
}

// The exact filter the frontend applies, plus the two failure modes that make
// an ad non-displayable.
const Q_DISPLAYABLE = { bool: { filter: getDisplayableMediaFilter('facebook') } };
const Q_IMAGE = { term: { 'facebook_ad.type.keyword': 'IMAGE' } };
const Q_VIDEO = { term: { 'facebook_ad.type.keyword': 'VIDEO' } };
const Q_IMG_NO_URL = { bool: { filter: [Q_IMAGE], must_not: [{ exists: { field: 'new_nas_image_url' } }] } };
const Q_VID_NO_THUMB = { bool: { filter: [Q_VIDEO], must_not: [{ exists: { field: 'Thumbnail' } }] } };

async function runEsAudit() {
  sub(`Elasticsearch audit — index "${FB.esIndex}" (es_id ${FB.esId})`);

  const [total, displayableCount, typeImage, typeVideo, imgNoUrl, vidNoThumb] = await Promise.all([
    esCount({ match_all: {} }),
    esCount(Q_DISPLAYABLE),
    esCount(Q_IMAGE),
    esCount(Q_VIDEO),
    esCount(Q_IMG_NO_URL),
    esCount(Q_VID_NO_THUMB),
  ]);

  const unhealthy = total - displayableCount;

  const factors = [
    { key: 'IMAGE_NO_IMAGE', label: 'IMAGE ad with no new_nas_image_url', count: imgNoUrl, query: Q_IMG_NO_URL },
    { key: 'VIDEO_NO_THUMBNAIL', label: 'VIDEO ad with no Thumbnail', count: vidNoThumb, query: Q_VID_NO_THUMB },
  ];

  // samples per factor
  for (const f of factors) f.samples = await esSamples(f.query);

  // ── Duplicate-document factor (same facebook_ad.id on >1 doc) ───────────────
  // Independent of the displayable-media filter: a duplicate copy may itself be
  // displayable or not. It's flagged unhealthy because the extra copies inflate
  // the pre-collapse count and are redundant. Skippable with --noDup.
  let duplicates = null;
  if (SCAN_DUPLICATES) {
    sub('Scanning for duplicate documents (same facebook_ad.id) — composite sweep…');
    const dup = await findDuplicates();
    const dupSampleIds = dup.duplicatedIds.slice(0, SAMPLE_SIZE).map((d) => d.id);

    // Docs the composite sweep can't see: a `terms` source skips documents with
    // NO value for facebook_ad.id (it has no missing_bucket). They ARE in
    // match_all (total) but NOT in scannedDocs, so they explain any
    // (total − scanned) gap. They're their own defect — an ad doc with no id
    // can't be collapsed and can't join to SQL — so we surface them, but do NOT
    // fold them into `deletable` (their nature is unknown without inspection).
    const missingAdId = await esCount({ bool: { must_not: [{ exists: { field: 'facebook_ad.id' } }] } });

    factors.push({
      key: 'DUPLICATE_DOC',
      label: 'Redundant duplicate doc (same facebook_ad.id — keep 1, remove the rest)',
      count: dup.extraDocs,
      samples: await esDuplicateSamples(dupSampleIds),
    });
    duplicates = {
      scannedDocs: dup.scannedDocs,   // docs WITH an ad id = distinctIds + extraDocs
      distinctIds: dup.distinctIds,
      duplicatedIds: dup.duplicatedIdCount,
      extraDocs: dup.extraDocs,
      docsInvolved: dup.docsInvolved,
      missingAdId,                     // docs with NO ad id (total = scannedDocs + missingAdId)
      ids: dup.duplicatedIds, // full [{id,count}] set — the delete target
    };
  }

  const report = {
    store: 'elasticsearch',
    network: 'facebook',
    index: FB.esIndex,
    total,
    displayable: displayableCount,
    unhealthy,
    // Total docs deletion would remove: non-displayable + redundant duplicate
    // copies. The two sets can overlap (a duplicate copy may also be
    // non-displayable), so this is an upper bound, not a strict sum.
    deletable: unhealthy + (duplicates ? duplicates.extraDocs : 0),
    typeDistribution: { IMAGE: typeImage, VIDEO: typeVideo, OTHER: total - typeImage - typeVideo },
    duplicates,
    factors,
  };

  printEsReport(report);
  return report;
}

function printEsReport(r) {
  info(`Total docs ............. ${fmt(r.total)}`);
  info(`Displayable (passes) ... ${fmt(r.displayable)}  (${pct(r.displayable, r.total)})`);
  (r.unhealthy ? bad : ok)(`Non-displayable ........ ${fmt(r.unhealthy)}  (${pct(r.unhealthy, r.total)})`);
  if (r.duplicates) {
    const d = r.duplicates;
    info(`Docs with an ad id ..... ${fmt(d.scannedDocs)}  (= ${fmt(d.distinctIds)} distinct ids + ${fmt(d.extraDocs)} duplicate copies)`);
    (d.missingAdId ? bad : ok)(`Docs with NO ad id ..... ${fmt(d.missingAdId)}  (skipped by the dup sweep; total = with-id + no-id)`);
    (d.extraDocs ? bad : ok)(`Duplicate copies ....... ${fmt(d.extraDocs)}  across ${fmt(d.duplicatedIds)} ad id(s) that have >1 doc`);
    info(`Total deletable ........ ${fmt(r.deletable)}  (non-displayable + duplicate copies; sets may overlap)`);
  } else {
    warn('Duplicate scan skipped (--noDup).');
  }
  info(`Type split ............. IMAGE ${fmt(r.typeDistribution.IMAGE)} | VIDEO ${fmt(r.typeDistribution.VIDEO)} | OTHER ${fmt(r.typeDistribution.OTHER)}`);
  for (const f of r.factors) {
    sub(`[ES] ${f.label}: ${fmt(f.count)}`);
    if (!f.samples.length) { info('(no sample docs)'); continue; }
    f.samples.forEach((s) => info(
      `_id=${s._id} | fbId=${s.ad_id} | type=${s.type} | img=${trunc(s.new_nas_image_url)} | thumb=${trunc(s.Thumbnail)}`
    ));
  }
}

// ==========================================================================
// MySQL AUDIT
// ==========================================================================

const q = (sql, params) => withTimeout(queryDatabase(FB.dbId, FB.database, sql, params), 'MySQL query');

// A variant row carries usable media only if image_url is a real NAS path — an
// ALLOWLIST of the canonical mount prefixes (facebook also allows a bare
// `PowerAdspy`, so bare:true), mirroring paramParser's withCdn() strip. A blocklist
// would wrongly pass test/asset/raw-CDN paths (getMedia/PowerAdspy-test/…, /assets/img/…).
const GOOD = nasGoodMediaExpr('image_url', { bare: true });
// Only IMAGE/VIDEO require media; other facebook types pass the displayable filter.
const MEDIA_TYPES_SQL = `a.type IN ('IMAGE','VIDEO')`;

async function runSqlAudit() {
  sub(`MySQL audit — db "${FB.database}" (db_id ${FB.dbId}), media table "${FB.mediaTable}"`);

  // One pass: per type, classify every IMAGE/VIDEO ad as missing-row / unusable / healthy.
  // (Non IMAGE/VIDEO types contribute 0 to missing/empty → counted healthy.)
  const breakdown = await q(`
    SELECT a.type,
           COUNT(*) AS total,
           SUM(CASE WHEN ${MEDIA_TYPES_SQL} AND iv.facebook_ad_id IS NULL THEN 1 ELSE 0 END)                          AS missing_row,
           SUM(CASE WHEN ${MEDIA_TYPES_SQL} AND iv.facebook_ad_id IS NOT NULL AND iv.nonempty = 0 THEN 1 ELSE 0 END)  AS empty_content
    FROM ${FB.mainTable} a
    LEFT JOIN (
      SELECT facebook_ad_id,
             SUM(CASE WHEN ${GOOD} THEN 1 ELSE 0 END) AS nonempty
      FROM ${FB.mediaTable}
      GROUP BY facebook_ad_id
    ) iv ON iv.facebook_ad_id = a.id
    GROUP BY a.type`);

  let total = 0, missingRow = 0, emptyContent = 0;
  const byType = {};
  for (const row of breakdown) {
    const t = row.type;
    const mr = Number(row.missing_row || 0);
    const ec = Number(row.empty_content || 0);
    const tt = Number(row.total || 0);
    byType[t] = { total: tt, missing_row: mr, empty_content: ec, unhealthy: mr + ec };
    total += tt; missingRow += mr; emptyContent += ec;
  }
  const unhealthy = missingRow + emptyContent;

  const factors = [
    {
      key: 'MISSING_MEDIA_ROW',
      label: `IMAGE/VIDEO ad with NO row in ${FB.mediaTable}`,
      count: missingRow,
      sampleSql: `SELECT a.id, a.ad_id, a.type, a.last_seen
                  FROM ${FB.mainTable} a
                  WHERE ${MEDIA_TYPES_SQL}
                    AND NOT EXISTS (SELECT 1 FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id)
                  LIMIT ?`,
    },
    {
      key: 'EMPTY_MEDIA_CONTENT',
      label: `IMAGE/VIDEO ad whose ${FB.mediaTable}.${FB.contentColumn} is missing / a default or legacy non-NAS path`,
      count: emptyContent,
      sampleSql: `SELECT a.id, a.ad_id, a.type, a.last_seen
                  FROM ${FB.mainTable} a
                  WHERE ${MEDIA_TYPES_SQL}
                    AND EXISTS (SELECT 1 FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id)
                    AND NOT EXISTS (SELECT 1 FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id AND ${GOOD})
                  LIMIT ?`,
    },
  ];
  for (const f of factors) {
    f.samples = f.count ? await q(f.sampleSql, [SAMPLE_SIZE]) : [];
  }

  const report = {
    store: 'mysql',
    network: 'facebook',
    database: FB.database,
    mediaTable: FB.mediaTable,
    total,
    healthy: total - unhealthy,
    unhealthy,
    byType,
    factors,
  };

  printSqlReport(report);
  return report;
}

function printSqlReport(r) {
  info(`Total ads .............. ${fmt(r.total)}`);
  ok(`Healthy ................ ${fmt(r.healthy)}  (${pct(r.healthy, r.total)})`);
  (r.unhealthy ? bad : ok)(`Unhealthy .............. ${fmt(r.unhealthy)}  (${pct(r.unhealthy, r.total)})`);
  for (const [t, b] of Object.entries(r.byType)) {
    info(`  ${t}: ${fmt(b.unhealthy)} / ${fmt(b.total)} unhealthy  (missing_row ${fmt(b.missing_row)}, empty ${fmt(b.empty_content)})`);
  }
  for (const f of r.factors) {
    sub(`[SQL] ${f.label}: ${fmt(f.count)}`);
    if (!f.samples.length) { info('(no sample rows)'); continue; }
    f.samples.forEach((s) => info(`id=${s.id} | ad_id=${s.ad_id} | type=${s.type} | last_seen=${fmtDate(s.last_seen)}`));
  }
}

// ==========================================================================
// BACKFILL ANALYSIS (READ-ONLY) — mirrors the shared core's runBackfillAnalysis.
// How many currently non-displayable ES ads have GOOD media in SQL and could be
// safely made displayable by writing it into the ES field that gates display.
// ==========================================================================

const FB_BACKFILL_FIELDS = { IMAGE: 'new_nas_image_url', VIDEO: 'Thumbnail' };

async function runBackfillAnalysis() {
  sub('Backfill analysis — currently non-displayable ES ads that have GOOD media in SQL…');
  const Q_DISPLAYABLE = { bool: { filter: getDisplayableMediaFilter('facebook') } };
  const byType = [];
  let totalBackfillable = 0, totalSqlGood = 0;

  for (const [type, esField] of Object.entries(FB_BACKFILL_FIELDS)) {
    const idRows = await q(
      `SELECT a.id AS id FROM ${FB.mainTable} a
       WHERE a.type = ? AND EXISTS (SELECT 1 FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id AND ${GOOD})`,
      [type]
    );
    const ids = idRows.map((r) => r.id).filter((v) => v !== null && v !== undefined);

    let backfillable = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const res = await withTimeout(searchAllInstances(FB.esIndex, {
        size: 0,
        query: { bool: { filter: [{ terms: { 'facebook_ad.id': chunk } }], must_not: [Q_DISPLAYABLE] } },
        aggs: { d: { cardinality: { field: 'facebook_ad.id', precision_threshold: 40000 } } },
      }, FB.esId, 'search'), 'ES backfill count');
      backfillable += (res && res.data && res.data.aggregations && res.data.aggregations.d && res.data.aggregations.d.value) || 0;
    }

    let samples = [];
    if (backfillable && ids.length) {
      const probe = ids.slice(0, 500);
      const res = await withTimeout(searchAllInstances(FB.esIndex, {
        size: SAMPLE_SIZE,
        _source: ['facebook_ad.id', esField],
        query: { bool: { filter: [{ terms: { 'facebook_ad.id': probe } }], must_not: [Q_DISPLAYABLE] } },
      }, FB.esId, 'search'), 'ES backfill samples');
      const hits = (res && res.data && res.data.hits && res.data.hits.hits) || [];
      const ndIds = hits.map((h) => h._source && h._source['facebook_ad.id']).filter((v) => v != null);
      const vals = {};
      if (ndIds.length) {
        const ph = ndIds.map(() => '?').join(',');
        const vr = await q(`SELECT a.id AS id, (SELECT MAX(iv.image_url) FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id AND ${GOOD}) AS good_val FROM ${FB.mainTable} a WHERE a.id IN (${ph})`, ndIds);
        for (const r of vr) vals[String(r.id)] = r.good_val;
      }
      samples = hits.map((h) => {
        const id = h._source && h._source['facebook_ad.id'];
        return { id, type, esField, currentEs: (h._source && h._source[esField]) ?? null, sqlValue: vals[String(id)] ?? null };
      });
    }

    byType.push({ type, esField, sqlColumn: FB.contentColumn, mediaTable: FB.mediaTable, sqlGood: ids.length, backfillable, samples });
    totalBackfillable += backfillable;
    totalSqlGood += ids.length;
  }

  const report = { network: 'facebook', idField: 'facebook_ad.id', totalBackfillable, totalSqlGood, byType };
  sub(`Backfill opportunity — ${fmt(totalBackfillable)} non-displayable ad(s) can be SAFELY made displayable from SQL`);
  for (const g of byType) {
    info(`${g.type}: ${fmt(g.backfillable)} backfillable  (write ES \`${g.esField}\` ← SQL ${g.mediaTable}.${g.sqlColumn}; ${fmt(g.sqlGood)} ${g.type} ads have good SQL media)`);
    g.samples.forEach((s) => info(`   e.g. id=${s.id}: ES ${s.esField}=${trunc(s.currentEs)}  →  would write ${trunc(s.sqlValue)}`));
  }
  return report;
}

// ==========================================================================
// REPORT ASSEMBLY / EXPORT
// ==========================================================================

async function runBoth() {
  head('FACEBOOK UNHEALTHY-ADS AUDIT — FULL REPORT');
  startRun(); // open the log file for this run
  const es = await runEsAudit().catch((e) => { bad(`ES audit failed: ${e.message}`); return null; });
  recordEs(es);  // persist the ES portion NOW, before SQL runs
  const sql = await runSqlAudit().catch((e) => { bad(`SQL audit failed: ${e.message}`); return null; });
  recordSql(sql); // persist the full report
  if (es && sql) {
    const bf = await runBackfillAnalysis().catch((e) => { bad(`Backfill analysis failed: ${e.message}`); return null; });
    recordBackfill(bf);
  }
  line('═');
  announceRun();
  return lastReport;
}

// ---- incremental persistence ----------------------------------------------
// Each run writes to ONE timestamped file pair (runBase). We rewrite that pair
// after every store finishes, so whatever has completed is always on disk even
// if a later step hangs / is interrupted.
function startRun() {
  try { fs.mkdirSync(REPORT_DIR, { recursive: true }); } catch (_) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  runBase = path.join(REPORT_DIR, `facebook-audit-${stamp}`);
}

function writeReport() {
  if (!lastReport) return null;
  if (!runBase) startRun();
  try {
    fs.writeFileSync(`${runBase}.json`, JSON.stringify(lastReport, null, 2), 'utf8');
    fs.writeFileSync(`${runBase}.xlsx`, writeXlsx(buildSheets(lastReport)));
    const mdPath = writeMarkdown(runBase, lastReport);
    if (mdPath) {
      lastReport.markdownPath = mdPath;
      lastReport.centralLogPath = path.join(REPORT_DIR, 'central-audit-log.md');
    }
  } catch (e) {
    bad(`Failed to write report file: ${e.message}`);
    return null;
  }
  return runBase;
}

function recordEs(es) {
  lastReport = { generatedAt: new Date().toISOString(), network: 'facebook', elasticsearch: es, mysql: lastReport?.mysql || null };
  writeReport();
}
function recordSql(sql) {
  lastReport = { generatedAt: new Date().toISOString(), network: 'facebook', elasticsearch: lastReport?.elasticsearch || null, mysql: sql, backfill: lastReport?.backfill || null };
  writeReport();
}
function recordBackfill(bf) {
  lastReport = { ...(lastReport || { generatedAt: new Date().toISOString(), network: 'facebook' }), backfill: bf };
  writeReport();
}

function announceRun() {
  if (!runBase) { warn('No report on disk (audit produced nothing).'); return; }
  sub('Detailed report written to:');
  info(`${runBase}.json`);
  info(`${runBase}.xlsx`);
  info(`${runBase}.md`);
  info(`Central log: ${CENTRAL_LOG}`);
}

// Manual re-export from the menu — writes the in-memory report to a fresh file.
function exportReport() {
  if (!lastReport) { warn('No report in memory yet. Run an audit first (option 1/2/3).'); return null; }
  startRun();
  writeReport();
  announceRun();
  return runBase;
}

// Numeric percentage (1 dp) for spreadsheet cells, e.g. 76.8.
const pctNum = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : 0);

// Build the workbook as an array of { name, rows } sheets:
//   Summary     — headline counts for each store
//   Factors     — every unhealthy factor + its count
//   ES Samples  — one row per Elasticsearch sample doc
//   SQL Samples — one row per MySQL sample row
function buildSheets(rep) {
  const sheets = [];

  // ---- Summary ----
  const summary = [
    ['Facebook Unhealthy-Ads Audit'],
    ['Generated', rep.generatedAt],
    [],
  ];
  if (rep.elasticsearch) {
    const r = rep.elasticsearch;
    summary.push(['ELASTICSEARCH', r.index]);
    summary.push(['Metric', 'Value']);
    summary.push(['Total docs', r.total]);
    summary.push(['Displayable (passes)', r.displayable]);
    summary.push(['Non-displayable', r.unhealthy]);
    summary.push(['Non-displayable %', pctNum(r.unhealthy, r.total)]);
    if (r.duplicates) {
      // Self-reconciling: Total docs = Docs with an ad id + Docs with NO ad id;
      // Docs with an ad id = Distinct ad ids + Duplicate copies.
      summary.push(['Docs with an ad id (scanned)', r.duplicates.scannedDocs]);
      summary.push(['Docs with NO ad id', r.duplicates.missingAdId]);
      summary.push(['Distinct ad ids', r.duplicates.distinctIds]);
      summary.push(['Duplicated ad ids (count>1)', r.duplicates.duplicatedIds]);
      summary.push(['Duplicate copies (extra docs)', r.duplicates.extraDocs]);
    }
    if (typeof r.deletable === 'number') summary.push(['Total deletable', r.deletable]);
    summary.push(['Type: IMAGE', r.typeDistribution.IMAGE]);
    summary.push(['Type: VIDEO', r.typeDistribution.VIDEO]);
    summary.push(['Type: OTHER', r.typeDistribution.OTHER]);
    summary.push([]);
  }
  if (rep.mysql) {
    const r = rep.mysql;
    summary.push(['MYSQL', `${r.database} / ${r.mediaTable}`]);
    summary.push(['Metric', 'Value']);
    summary.push(['Total ads', r.total]);
    summary.push(['Healthy', r.healthy]);
    summary.push(['Unhealthy', r.unhealthy]);
    summary.push(['Unhealthy %', pctNum(r.unhealthy, r.total)]);
    Object.entries(r.byType).forEach(([t, b]) => {
      summary.push([`${t}: unhealthy`, b.unhealthy]);
      summary.push([`${t}: missing_row`, b.missing_row]);
      summary.push([`${t}: empty_content`, b.empty_content]);
    });
  }
  if (rep.backfill && rep.backfill.byType && rep.backfill.byType.length) {
    const bf = rep.backfill;
    summary.push([]);
    summary.push(['BACKFILL OPPORTUNITY', '(non-displayable ES ads that have good SQL media)']);
    summary.push(['Metric', 'Value']);
    summary.push(['Total backfillable', bf.totalBackfillable]);
    if (rep.elasticsearch && typeof rep.elasticsearch.displayable === 'number') {
      summary.push(['ES displayable now', rep.elasticsearch.displayable]);
      summary.push(['Projected displayable after backfill', rep.elasticsearch.displayable + bf.totalBackfillable]);
    }
    bf.byType.forEach((g) => summary.push([`Backfillable ${g.type} (→ ES ${g.esField})`, g.backfillable]));
  }
  sheets.push({ name: 'Summary', rows: summary });

  // ---- Factors ----
  const factors = [['Store', 'Factor', 'Description', 'Count']];
  if (rep.elasticsearch) rep.elasticsearch.factors.forEach((f) => factors.push(['ES', f.key, f.label, f.count]));
  if (rep.mysql) rep.mysql.factors.forEach((f) => factors.push(['SQL', f.key, f.label, f.count]));
  sheets.push({ name: 'Factors', rows: factors });

  // ---- ES Samples ----
  if (rep.elasticsearch) {
    const rows = [['Factor', 'ES _id', 'facebook_ad.id', 'type', 'last_seen', 'new_nas_image_url', 'Thumbnail', 'url']];
    rep.elasticsearch.factors.forEach((f) =>
      (f.samples || []).forEach((s) =>
        rows.push([f.key, s._id, s.ad_id, s.type, s.last_seen, s.new_nas_image_url, s.Thumbnail, s.url])));
    sheets.push({ name: 'ES Samples', rows });
  }

  // ---- ES Duplicates (full deletable id set: keep 1 per id, remove extra_copies)
  if (rep.elasticsearch && rep.elasticsearch.duplicates && rep.elasticsearch.duplicates.ids.length) {
    const rows = [['facebook_ad.id', 'doc_count', 'extra_copies (deletable)']];
    rep.elasticsearch.duplicates.ids.forEach((d) => rows.push([d.id, d.count, d.count - 1]));
    sheets.push({ name: 'ES Duplicates', rows });
  }

  // ---- SQL Samples ----
  if (rep.mysql) {
    const rows = [['Factor', 'id', 'ad_id', 'type', 'last_seen']];
    rep.mysql.factors.forEach((f) =>
      (f.samples || []).forEach((s) =>
        rows.push([f.key, s.id, s.ad_id, s.type, fmtDate(s.last_seen)])));
    sheets.push({ name: 'SQL Samples', rows });
  }

  // ---- Backfill (opportunity + samples) ----
  if (rep.backfill && rep.backfill.byType && rep.backfill.byType.length) {
    const rows = [['Type', 'Backfillable', 'Write ES field', 'SQL source', 'SQL ads w/ good media']];
    rep.backfill.byType.forEach((g) => rows.push([g.type, g.backfillable, g.esField, `${g.mediaTable}.${g.sqlColumn}`, g.sqlGood]));
    sheets.push({ name: 'Backfill', rows });

    const srows = [['Type', 'Ad id', 'Current ES value', 'Value to write (from SQL)']];
    rep.backfill.byType.forEach((g) => (g.samples || []).forEach((s) =>
      srows.push([g.type, s.id, (s.currentEs == null || s.currentEs === '') ? '(empty)' : s.currentEs, s.sqlValue])));
    if (srows.length > 1) sheets.push({ name: 'Backfill Samples', rows: srows });
  }

  return sheets;
}

// ==========================================================================
// DELETE (scaffolded, hard-disabled)
// ==========================================================================

function deleteFlow() {
  head('DELETE UNHEALTHY ADS');
  warn('Deletion is DISABLED in this build (audit-only mode).');
  info('When enabled it will target the same ads this audit flags:');
  info(`  • ES : docs in "${FB.esIndex}" failing the displayable-media filter`);
  info(`  • ES : duplicate docs (same facebook_ad.id) — keep 1 per id, remove the extra copies`);
  info(`  • SQL: ${FB.mainTable} rows with no / empty ${FB.mediaTable} media (+ cascading child rows)`);
  info('');
  info('To enable later: set ENABLE_DELETE=true, connect with a write-capable DB');
  info('user, and implement the guarded deletion in deleteFlow(). It must:');
  info('  1) re-run the audit to get a fresh target set,');
  info('  2) require typing the exact confirmation phrase + dry-run preview,');
  info('  3) batch deletes and log every removed id,');
  info('  4) for duplicates, keep exactly one doc per facebook_ad.id (the newest by');
  info('     last_seen — the copy collapse surfaces) and delete only the others.');
  if (!ENABLE_DELETE) { bad('ENABLE_DELETE is false → aborting without any writes.'); return; }
  // NOTE: real deletion intentionally not implemented yet.
  bad('Delete path not implemented. Aborting.');
}

// ==========================================================================
// helpers
// ==========================================================================
function trunc(v, n = 40) {
  if (v === null || v === undefined) return '∅';
  const s = String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function fmtDate(d) {
  if (!d) return '∅';
  try { return new Date(d).toISOString().slice(0, 19).replace('T', ' '); } catch { return String(d); }
}

// ==========================================================================
// interactive menu
// ==========================================================================
function menu(rl) {
  console.log(`
${'═'.repeat(78)}
  PAS — FACEBOOK UNHEALTHY-ADS AUDIT   (read-only)
  ES index: ${FB.esIndex}   |   DB: ${FB.database}   |   samples/factor: ${SAMPLE_SIZE}
${'═'.repeat(78)}
  Every audit is auto-saved to diagnostics/audit-reports/ (JSON + Excel).
  1) Run ES audit       (displayable-media filter + duplicate-doc scan${SCAN_DUPLICATES ? '' : ' [--noDup: off]'})
  2) Run SQL audit      (${FB.mainTable} / ${FB.mediaTable})
  3) Run BOTH           (full report + backfill analysis)
  4) Backfill analysis  (non-displayable ES ads that have good SQL media — READ-ONLY)
  5) Re-export last report (audit-reports/)
  6) Delete unhealthy ads   [DISABLED — audit-only]
  0) Exit
`);
  rl.question('Choose an option: ', async (choice) => {
    try {
      switch (choice.trim()) {
        case '1': {
          head('ELASTICSEARCH AUDIT');
          startRun();
          const es = await runEsAudit();
          recordEs(es);
          announceRun();
          break;
        }
        case '2': {
          head('MYSQL AUDIT');
          startRun();
          const sql = await runSqlAudit();
          recordSql(sql);
          announceRun();
          break;
        }
        case '3': await runBoth(); break;
        case '4': { head('BACKFILL ANALYSIS'); startRun(); recordBackfill(await runBackfillAnalysis()); announceRun(); break; }
        case '5': exportReport(); break;
        case '6': deleteFlow(); break;
        case '0': case 'q': case 'exit':
          rl.close();
          console.log('Bye.');
          process.exit(0);
          return;
        default: warn('Unknown option.');
      }
    } catch (e) {
      bad(`Operation failed: ${e.message}`);
    }
    menu(rl); // loop
  });
}

// ==========================================================================
// entry
// ==========================================================================
async function main() {
  // give the connection modules a moment to finish their startup health pings
  await new Promise((r) => setTimeout(r, 1200));

  // non-interactive mode
  if (args.run) {
    const run = String(args.run).toLowerCase();
    if (run === 'es') {
      head('ELASTICSEARCH AUDIT');
      startRun();
      const es = await runEsAudit();
      recordEs(es);
      announceRun();
    } else if (run === 'sql') {
      head('MYSQL AUDIT');
      startRun();
      const sql = await runSqlAudit();
      recordSql(sql);
      announceRun();
    } else if (run === 'backfill') {
      head('BACKFILL ANALYSIS');
      startRun();
      recordBackfill(await runBackfillAnalysis());
      announceRun();
    } else {
      await runBoth();
    }
    process.exit(0);
  }

  // interactive
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  menu(rl);
}

// Last-resort flush: if the process is interrupted (Ctrl-C) mid-audit, write
// whatever portion of the report we already have before exiting.
process.on('SIGINT', () => {
  console.log('\n⚠️  Interrupted — flushing partial report…');
  if (writeReport()) announceRun();
  process.exit(130);
});

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
