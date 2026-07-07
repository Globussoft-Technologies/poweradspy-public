/**
 * Shared engine for the per-network "Unhealthy-Ads Audit" CLIs.
 *
 * This is a generalization of diagnostics/facebook-ads-audit.js (the proven
 * reference). Each network ships a thin file that builds a CONFIG object and
 * calls runAuditCli(config) — see diagnostics/instagram-ads-audit.js.
 *
 * The engine audits, per network, how many ads are UNHEALTHY across two stores:
 *
 *   • Elasticsearch (cfg.es.index on cfg.es.esId)
 *       Source of truth = the network's displayable-media filter
 *       (utils/displayable-media-filters.js → passed in as cfg.es.displayableFilter).
 *       An ad is "unhealthy" when it FAILS that filter. Per-type failure modes are
 *       broken out via cfg.es.mediaFactors.
 *       ALSO flagged: DUPLICATE documents (>1 doc sharing cfg.es.idField) and
 *       documents with NO id value at all.
 *
 *   • MySQL (cfg.sql.database on cfg.sql.dbId)
 *       Source of truth = cfg.sql.mediaTable (e.g. <net>_ad_image_video). An ad is
 *       "unhealthy" when it has NO row there (missing media) or its row's
 *       cfg.sql.contentColumn JSON is empty / "[]" (empty media).
 *
 * READ-ONLY. The delete option is scaffolded but HARD-DISABLED (ENABLE_DELETE =
 * false) for every network — see deleteFlow().
 *
 * Reports auto-save (incrementally) to diagnostics/audit-reports/
 * <cfg.reportPrefix>-<timestamp>.{json,xlsx}.
 *
 * Flags (optional, for non-interactive / cron use) — identical across networks:
 *     --run=es|sql|both     run that audit immediately, print + log, then exit
 *     --samples=N           number of sample rows/docs per factor (default 5)
 *     --timeout=MS          per-ES/MySQL-operation timeout (default 45000)
 *     --noDup               skip the ES duplicate-document scan (faster ES audit)
 *     --dupPageSize=N       composite page size for the duplicate scan (default 10000)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const queryDatabase = require('../../db-connections/connection');
const searchAllInstances = require('../../es-connections/connection');
const { writeXlsx } = require('../xlsx-writer');
const { writeMarkdown, CENTRAL_LOG } = require('./markdown-writer');

// --------------------------------------------------------------------------
// HARD SAFETY SWITCH. Deletion is intentionally not enabled — every network's
// audit is read-only. Flipping this to true is NOT enough on its own; deleteFlow()
// also requires an explicit typed confirmation and a non-readonly DB user.
const ENABLE_DELETE = false;

// --------------------------------------------------------------------------
// arg parser (same shape as diagnostics/healthcheck.js)
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const SAMPLE_SIZE = Math.max(1, parseInt(args.samples, 10) || 5);
const SCAN_DUPLICATES = !args.noDup;
const DUP_PAGE_SIZE = Math.min(10000, Math.max(100, parseInt(args.dupPageSize, 10) || 10000));

// Where detailed reports are written (committed-visible, not git-ignored logs/).
const REPORT_DIR = path.join(__dirname, '..', 'audit-reports');

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
const pctNum = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : 0);

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
// Engine — all functions take the per-network `cfg` so nothing is hardcoded.
// ==========================================================================

function makeEngine(cfg) {
  const ES = cfg.es;
  const SQL = cfg.sql;
  const NET = cfg.network;
  const REPORT_PREFIX = cfg.reportPrefix || `${NET}-audit`;

  // ES transport: networks on the legacy 6.8 cluster use searchAllInstances; a
  // network on a different cluster/version (tiktok = ES 8.x, separate node) supplies
  // its own cfg.es.transport(index, body, esId, mode) with the same {data} return
  // shape (data = count for mode 'count', else the full response body).
  const esTransport = (ES && ES.transport) || searchAllInstances;
  // SQL audit is opt-out: a network whose ad media lives only in ES (tiktok — media
  // is video_cover/video_url in ES, no SQL media table) passes sql:{enabled:false}
  // (or omits sql entirely) and gets an ES-only audit.
  const sqlEnabled = !!(SQL && SQL.enabled !== false);

  // holds the most recent report so the "export" menu option can write it out
  let lastReport = null;
  // the log file base path for the CURRENT run — persisted incrementally.
  let runBase = null;

  // ── ES helpers ──────────────────────────────────────────────────────────

  // searchAllInstances swallows errors and returns {} — treat a missing `.data`
  // as a failure so we never silently report 0.
  async function esCount(query) {
    const res = await withTimeout(esTransport(ES.index, { query }, ES.esId, 'count'), 'ES count');
    if (!res || res.data === undefined) throw new Error('ES count returned no data (search failed — see log above)');
    return res.data;
  }

  // Raw search/agg passthrough — returns the full ES response body.
  async function esAgg(body, label) {
    const res = await withTimeout(esTransport(ES.index, body, ES.esId, 'search'), label);
    if (!res || res.data === undefined) throw new Error(`${label} returned no data (search failed — see log above)`);
    return res.data;
  }

  // Generic sample fetch — projects cfg.es.sampleSource fields into `src`.
  async function esSamples(query, size = SAMPLE_SIZE) {
    const body = { size, _source: ES.sampleSource, query };
    const res = await withTimeout(esTransport(ES.index, body, ES.esId, 'search'), 'ES samples');
    const hits = (res && res.data && res.data.hits && res.data.hits.hits) || [];
    return hits.map((h) => {
      const src = {};
      for (const f of ES.sampleSource) src[f] = (h._source && h._source[f]) ?? null;
      return { _id: h._id, src };
    });
  }

  // Composite-paginate every cfg.es.idField bucket to find ids backed by more
  // than one document. Exact + memory-flat (one page at a time). A `terms` source
  // skips docs with no value for idField — those are counted separately as
  // missingAdId so (total = scannedDocs + missingAdId) reconciles.
  async function findDuplicates() {
    let after = null;
    let pages = 0;
    let scannedDocs = 0;   // sum of doc_count over ALL ids (docs that HAVE an id)
    let distinctIds = 0;
    let extraDocs = 0;     // sum(doc_count − 1) over duplicated ids — what deletion removes
    let docsInvolved = 0;
    const duplicatedIds = []; // [{ id, count }] for every id with count > 1 (full set)

    for (;;) {
      const body = {
        size: 0,
        aggs: {
          dup: {
            composite: {
              size: DUP_PAGE_SIZE,
              sources: [{ grp: { terms: { field: ES.idField } } }],
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
          duplicatedIds.push({ id: b.key.grp, count: b.doc_count });
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

    return { scannedDocs, distinctIds, duplicatedIdCount: duplicatedIds.length, extraDocs, docsInvolved, duplicatedIds };
  }

  // Pull the actual docs for a few duplicated ids so the report shows the
  // colliding copies (same id on multiple ES _id rows).
  async function esDuplicateSamples(ids) {
    if (!ids || !ids.length) return [];
    const body = {
      size: Math.max(50, ids.length * 10),
      _source: ES.sampleSource,
      sort: [{ [ES.idField]: 'asc' }],
      query: { terms: { [ES.idField]: ids } },
    };
    const res = await withTimeout(esTransport(ES.index, body, ES.esId, 'search'), 'ES duplicate samples');
    const hits = (res && res.data && res.data.hits && res.data.hits.hits) || [];
    return hits.map((h) => {
      const src = {};
      for (const f of ES.sampleSource) src[f] = (h._source && h._source[f]) ?? null;
      return { _id: h._id, src };
    });
  }

  async function runEsAudit() {
    sub(`Elasticsearch audit — index "${ES.index}" (es_id ${ES.esId})`);

    const hasFilter = Array.isArray(ES.displayableFilter) && ES.displayableFilter.length > 0;
    const Q_DISPLAYABLE = hasFilter ? { bool: { filter: ES.displayableFilter } } : { match_all: {} };

    const typeBuckets = ES.typeBuckets || [];
    const failureGroups = ES.failureGroups || [];
    const mediaFactors = ES.mediaFactors || [];

    const [total, displayableRaw] = await Promise.all([
      esCount({ match_all: {} }),
      hasFilter ? esCount(Q_DISPLAYABLE) : Promise.resolve(null),
    ]);
    const displayable = hasFilter ? displayableRaw : total;
    const unhealthy = total - displayable;

    // Type distribution (informational).
    const typeCounts = await Promise.all(typeBuckets.map((t) => esCount(t.query)));
    const typeDistribution = {};
    let typeSum = 0;
    typeBuckets.forEach((t, idx) => { typeDistribution[t.label] = typeCounts[idx]; typeSum += typeCounts[idx]; });
    if (typeBuckets.length) typeDistribution.OTHER = total - typeSum;

    // Failure breakdown — two supported models:
    //   failureGroups (preferred): failing = count(group) − count(group ∧ displayable).
    //     Sums EXACTLY to `unhealthy` when the groups partition all docs — correct
    //     even when the displayable filter has blocked-value rules a hand-written
    //     negation would miss (youtube / linkedin / reddit-video / tiktok).
    //   mediaFactors (simple): direct count of a negation query — fine when the
    //     displayable filter is exists-only (instagram).
    let factors = [];
    if (failureGroups.length) {
      const gc = await Promise.all(failureGroups.flatMap((g) => [
        esCount(g.query),
        hasFilter ? esCount({ bool: { filter: [g.query, ...ES.displayableFilter] } }) : Promise.resolve(0),
      ]));
      factors = await Promise.all(failureGroups.map(async (g, idx) => {
        const groupTotal = gc[idx * 2];
        const groupOk = hasFilter ? gc[idx * 2 + 1] : groupTotal;
        const failing = groupTotal - groupOk;
        const sampleQ = { bool: { filter: [g.query], must_not: [Q_DISPLAYABLE] } };
        return { key: g.key, label: g.label, count: failing, samples: failing ? await esSamples(sampleQ) : [] };
      }));
    } else if (mediaFactors.length) {
      const fc = await Promise.all(mediaFactors.map((f) => esCount(f.query)));
      factors = await Promise.all(mediaFactors.map(async (f, idx) => ({
        key: f.key, label: f.label, count: fc[idx], samples: await esSamples(f.query),
      })));
    }

    // ── Duplicate-document factor (same idField on >1 doc) ───────────────────
    let duplicates = null;
    if (SCAN_DUPLICATES) {
      sub(`Scanning for duplicate documents (same ${ES.idField}) — composite sweep…`);
      const dup = await findDuplicates();
      const dupSampleIds = dup.duplicatedIds.slice(0, SAMPLE_SIZE).map((d) => d.id);

      // Docs the composite sweep can't see: a `terms` source skips docs with NO
      // value for idField. They ARE in match_all (total) but NOT in scannedDocs,
      // so they explain any (total − scanned) gap and are their own defect (an ad
      // doc with no id can't collapse or join to SQL). Surfaced, NOT auto-deleted.
      const missingAdId = await esCount({ bool: { must_not: [{ exists: { field: ES.idField } }] } });

      factors.push({
        key: 'DUPLICATE_DOC',
        label: `Redundant duplicate doc (same ${ES.idField} — keep 1, remove the rest)`,
        count: dup.extraDocs,
        samples: await esDuplicateSamples(dupSampleIds),
      });
      duplicates = {
        scannedDocs: dup.scannedDocs,   // docs WITH an id = distinctIds + extraDocs
        distinctIds: dup.distinctIds,
        duplicatedIds: dup.duplicatedIdCount,
        extraDocs: dup.extraDocs,
        docsInvolved: dup.docsInvolved,
        missingAdId,                     // docs with NO id (total = scannedDocs + missingAdId)
        ids: dup.duplicatedIds,          // full [{id,count}] set — the delete target
      };
    }

    const report = {
      store: 'elasticsearch',
      network: NET,
      index: ES.index,
      total,
      displayable,
      unhealthy,
      // Upper bound (non-displayable ∪ duplicate copies may overlap).
      deletable: unhealthy + (duplicates ? duplicates.extraDocs : 0),
      typeDistribution,
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
    const td = r.typeDistribution;
    if (Object.keys(td).length) {
      info(`Type split ............. ${Object.entries(td).map(([k, v]) => `${k} ${fmt(v)}`).join(' | ')}`);
    }
    for (const f of r.factors) {
      sub(`[ES] ${f.label}: ${fmt(f.count)}`);
      if (!f.samples.length) { info('(no sample docs)'); continue; }
      f.samples.forEach((s) => info(
        `_id=${s._id} | ` + ES.sampleSource.map((c) => `${c}=${trunc(s.src[c])}`).join(' | ')
      ));
    }
  }

  // ── SQL helpers ─────────────────────────────────────────────────────────

  const q = (sql, params) => withTimeout(queryDatabase(SQL.dbId, SQL.database, sql, params), 'MySQL query');

  // ── SQL media model — one or more "specs" ───────────────────────────────
  // A spec says: for ads of these `types`, the media lives in
  // `mediaTable.contentColumn` and is "good" when `goodMediaExpr` holds (default =
  // non-empty/non-"[]"). Most networks have ONE spec (the legacy single-table
  // config, synthesized below). Split-media networks pass cfg.sql.mediaSpecs — e.g.
  // quora: IMAGE→quora_ad_variants.image_url, VIDEO→quora_ad_image_video.ad_image_video.
  // Types not covered by any spec are counted healthy (no media required) — e.g.
  // google IMAGE-only, or TEXT on quora. Values come from trusted config (not request
  // input), so type literals are inlined (same trust model as table/column names).
  const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const mediaSpecs = (SQL && Array.isArray(SQL.mediaSpecs) && SQL.mediaSpecs.length)
    ? SQL.mediaSpecs
    : [{
        mediaTable: SQL && SQL.mediaTable,
        fkColumn: SQL && SQL.fkColumn,
        contentColumn: SQL && SQL.contentColumn,
        goodMediaExpr: SQL && SQL.goodMediaExpr,
        unusableDesc: SQL && SQL.unusableDesc,
        types: SQL && SQL.mediaRequiredTypes,
      }];
  const specGood = (spec) => spec.goodMediaExpr
    ? spec.goodMediaExpr
    : `(${spec.contentColumn} IS NOT NULL AND ${spec.contentColumn} <> '' AND ${spec.contentColumn} <> '[]')`;
  const specGuard = (spec) => {
    const t = Array.isArray(spec.types) && spec.types.length ? spec.types : null;
    return t ? `a.type IN (${t.map(sqlStr).join(', ')})` : '1=1';
  };

  async function runSqlAudit() {
    const multi = mediaSpecs.length > 1;
    sub(`MySQL audit — db "${SQL.database}" (db_id ${SQL.dbId})` +
        (multi ? ` — ${mediaSpecs.length} media specs` : `, media table "${mediaSpecs[0].mediaTable}"`));

    // Total ads per type — counted once on the main table.
    const typeRows = await q(`SELECT a.type AS type, COUNT(*) AS total FROM ${SQL.mainTable} a GROUP BY a.type`);
    const byType = {};
    let total = 0;
    for (const r of typeRows) {
      const t = r.type;
      byType[t] = { total: Number(r.total || 0), missing_row: 0, empty_content: 0, unhealthy: 0 };
      total += Number(r.total || 0);
    }

    const factors = [];
    let missingRow = 0, emptyContent = 0;

    // Each spec: a per-type breakdown restricted to the spec's types (WHERE guard);
    // other types are absent → stay healthy. Specs are assumed type-disjoint.
    for (const spec of mediaSpecs) {
      const GOOD = specGood(spec);
      const guard = specGuard(spec);
      const bd = await q(`
        SELECT a.type,
               SUM(CASE WHEN iv.${spec.fkColumn} IS NULL THEN 1 ELSE 0 END)                          AS missing_row,
               SUM(CASE WHEN iv.${spec.fkColumn} IS NOT NULL AND iv.nonempty = 0 THEN 1 ELSE 0 END)  AS empty_content
        FROM ${SQL.mainTable} a
        LEFT JOIN (
          SELECT ${spec.fkColumn},
                 SUM(CASE WHEN ${GOOD} THEN 1 ELSE 0 END) AS nonempty
          FROM ${spec.mediaTable}
          GROUP BY ${spec.fkColumn}
        ) iv ON iv.${spec.fkColumn} = a.id
        WHERE ${guard}
        GROUP BY a.type`);

      let specMissing = 0, specEmpty = 0;
      for (const row of bd) {
        const t = row.type;
        const mr = Number(row.missing_row || 0);
        const ec = Number(row.empty_content || 0);
        if (!byType[t]) byType[t] = { total: 0, missing_row: 0, empty_content: 0, unhealthy: 0 };
        byType[t].missing_row += mr; byType[t].empty_content += ec; byType[t].unhealthy += mr + ec;
        specMissing += mr; specEmpty += ec;
      }
      missingRow += specMissing; emptyContent += specEmpty;

      const typeNote = (multi && Array.isArray(spec.types)) ? ` (${spec.types.join('/')})` : '';
      const unusable = spec.unusableDesc || 'empty / "[]"';
      factors.push({
        key: multi ? `MISSING_ROW_${spec.mediaTable}` : 'MISSING_MEDIA_ROW',
        label: `Ad with NO row in ${spec.mediaTable}${typeNote}`,
        count: specMissing,
        sampleSql: `SELECT a.id, a.ad_id, a.type, a.last_seen
                    FROM ${SQL.mainTable} a
                    WHERE ${guard}
                      AND NOT EXISTS (SELECT 1 FROM ${spec.mediaTable} iv WHERE iv.${spec.fkColumn} = a.id)
                    LIMIT ?`,
      });
      factors.push({
        key: multi ? `UNUSABLE_${spec.mediaTable}` : 'EMPTY_MEDIA_CONTENT',
        label: `Ad whose ${spec.mediaTable}.${spec.contentColumn} is ${unusable}`,
        count: specEmpty,
        sampleSql: `SELECT a.id, a.ad_id, a.type, a.last_seen
                    FROM ${SQL.mainTable} a
                    WHERE ${guard}
                      AND EXISTS (SELECT 1 FROM ${spec.mediaTable} iv WHERE iv.${spec.fkColumn} = a.id)
                      AND NOT EXISTS (SELECT 1 FROM ${spec.mediaTable} iv WHERE iv.${spec.fkColumn} = a.id AND ${GOOD})
                    LIMIT ?`,
      });
    }

    for (const f of factors) {
      f.samples = f.count ? await q(f.sampleSql, [SAMPLE_SIZE]) : [];
    }

    const unhealthy = missingRow + emptyContent;
    // "Media required" types = union across specs, but only when EVERY spec is
    // type-restricted (otherwise some spec checks all types → no restriction).
    const restricted = mediaSpecs.every((s) => Array.isArray(s.types) && s.types.length);
    const reqTypes = restricted ? [...new Set(mediaSpecs.flatMap((s) => s.types))] : null;

    const report = {
      store: 'mysql',
      network: NET,
      database: SQL.database,
      mediaTable: mediaSpecs.map((s) => s.mediaTable).join(', '),
      mediaRequiredTypes: reqTypes,
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
    if (r.mediaRequiredTypes) info(`Media required for ..... ${r.mediaRequiredTypes.join(', ')} only — other types counted healthy`);
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

  // ── Backfill analysis (READ-ONLY) ────────────────────────────────────────
  // Cross-store: how many currently NON-displayable ES ads could be made
  // displayable by copying a GOOD SQL media value into the ES field that gates
  // display. A candidate = an ad that (a) has good media of a media-requiring type
  // in SQL, and (b) is currently non-displayable in ES. Writing that good NAS value
  // into the ES field clears the displayable filter's media requirement (and the
  // frontend's blocked-path regex), so the ad is certain to become displayable —
  // for networks where media is the only always-on gate on that type (the type
  // restriction already excludes ads blocked for other reasons, e.g. youtube DISPLAY).
  // Config: cfg.es.backfillFields = { <type>: '<ES field to write>' }; the SQL
  // good-media source is the same mediaSpec the SQL audit uses. Writes NOTHING.

  async function sqlGoodIdsForType(spec, type) {
    const good = specGood(spec);
    const rows = await q(`
      SELECT a.id AS id
      FROM ${SQL.mainTable} a
      WHERE a.type = ${sqlStr(type)}
        AND EXISTS (SELECT 1 FROM ${spec.mediaTable} iv WHERE iv.${spec.fkColumn} = a.id AND ${good})`);
    return rows.map((r) => r.id).filter((v) => v !== null && v !== undefined);
  }

  // Distinct non-displayable ES ads among a set of ids. cardinality on idField is
  // exact for ≤ precision_threshold; chunks are ≤ 1000 (each exact), and an id lands
  // in exactly one chunk, so the sum is the exact distinct count (robust for
  // collapse networks where one id can have several docs).
  async function esNonDisplayableDistinct(ids, Q_DISPLAYABLE) {
    if (!ids.length) return 0;
    const CHUNK = 1000;
    let count = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const data = await esAgg({
        size: 0,
        query: { bool: { filter: [{ terms: { [ES.idField]: chunk } }], must_not: [Q_DISPLAYABLE] } },
        aggs: { d: { cardinality: { field: ES.idField, precision_threshold: 40000 } } },
      }, 'ES backfill count');
      count += (data.aggregations && data.aggregations.d && data.aggregations.d.value) || 0;
    }
    return count;
  }

  async function runBackfillAnalysis() {
    const fields = ES.backfillFields;
    const hasFilter = Array.isArray(ES.displayableFilter) && ES.displayableFilter.length > 0;
    if (!sqlEnabled || !fields || !Object.keys(fields).length || !mediaSpecs.length || !hasFilter) return null;

    sub('Backfill analysis — currently non-displayable ES ads that have GOOD media in SQL…');
    const Q_DISPLAYABLE = { bool: { filter: ES.displayableFilter } };
    const specByType = {};
    let defaultSpec = null; // a spec with no `types` covers ALL types (legacy single-table config)
    for (const spec of mediaSpecs) {
      if (Array.isArray(spec.types) && spec.types.length) for (const t of spec.types) specByType[t] = spec;
      else defaultSpec = spec;
    }

    const byType = [];
    let totalBackfillable = 0;
    let totalSqlGood = 0;
    for (const [type, esField] of Object.entries(fields)) {
      const spec = specByType[type] || defaultSpec;
      if (!spec) continue;
      const goodIds = await sqlGoodIdsForType(spec, type);
      const backfillable = await esNonDisplayableDistinct(goodIds, Q_DISPLAYABLE);

      // samples: a few backfillable ads — current ES field value vs the good SQL value.
      let samples = [];
      if (backfillable && goodIds.length) {
        const probe = goodIds.slice(0, 500);
        const data = await esAgg({
          size: SAMPLE_SIZE,
          _source: [ES.idField, esField],
          query: { bool: { filter: [{ terms: { [ES.idField]: probe } }], must_not: [Q_DISPLAYABLE] } },
        }, 'ES backfill samples');
        const hits = (data.hits && data.hits.hits) || [];
        const ndIds = hits.map((h) => h._source && h._source[ES.idField]).filter((v) => v != null);
        const sqlVals = {};
        if (ndIds.length) {
          const ph = ndIds.map(() => '?').join(',');
          const good = specGood(spec);
          const vrows = await q(
            `SELECT a.id AS id, (SELECT MAX(iv.${spec.contentColumn}) FROM ${spec.mediaTable} iv WHERE iv.${spec.fkColumn} = a.id AND ${good}) AS good_val
             FROM ${SQL.mainTable} a WHERE a.id IN (${ph})`, ndIds);
          for (const r of vrows) sqlVals[String(r.id)] = r.good_val;
        }
        samples = hits.map((h) => {
          const id = h._source && h._source[ES.idField];
          return { id, type, esField, currentEs: (h._source && h._source[esField]) ?? null, sqlValue: sqlVals[String(id)] ?? null };
        });
      }

      byType.push({ type, esField, sqlColumn: spec.contentColumn, mediaTable: spec.mediaTable, sqlGood: goodIds.length, backfillable, samples });
      totalBackfillable += backfillable;
      totalSqlGood += goodIds.length;
    }

    const report = { network: NET, idField: ES.idField, totalBackfillable, totalSqlGood, byType };
    printBackfillReport(report);
    return report;
  }

  function printBackfillReport(r) {
    sub(`Backfill opportunity — ${fmt(r.totalBackfillable)} non-displayable ad(s) can be SAFELY made displayable from SQL`);
    for (const g of r.byType) {
      info(`${g.type}: ${fmt(g.backfillable)} backfillable  (write ES \`${g.esField}\` ← SQL ${g.mediaTable}.${g.sqlColumn}; ${fmt(g.sqlGood)} ${g.type} ads have good SQL media)`);
      g.samples.forEach((s) => info(`   e.g. id=${s.id}: ES ${s.esField}=${trunc(s.currentEs)}  →  would write ${trunc(s.sqlValue)}`));
    }
  }

  // ── Report assembly / export ────────────────────────────────────────────

  async function runBoth() {
    head(`${NET.toUpperCase()} UNHEALTHY-ADS AUDIT — FULL REPORT`);
    startRun();
    const es = await runEsAudit().catch((e) => { bad(`ES audit failed: ${e.message}`); return null; });
    recordEs(es);
    const sql = await runSqlAudit().catch((e) => { bad(`SQL audit failed: ${e.message}`); return null; });
    recordSql(sql);
    if (es && sql) {
      const bf = await runBackfillAnalysis().catch((e) => { bad(`Backfill analysis failed: ${e.message}`); return null; });
      recordBackfill(bf);
    }
    line('═');
    announceRun();
    return lastReport;
  }

  function startRun() {
    try { fs.mkdirSync(REPORT_DIR, { recursive: true }); } catch (_) {}
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    runBase = path.join(REPORT_DIR, `${REPORT_PREFIX}-${stamp}`);
  }

  function writeReport() {
    if (!lastReport) return null;
    if (!runBase) startRun();
    try {
      fs.writeFileSync(`${runBase}.json`, JSON.stringify(lastReport, null, 2), 'utf8');
      fs.writeFileSync(`${runBase}.xlsx`, writeXlsx(buildSheets(lastReport)));
      const mdPath = writeMarkdown(runBase, lastReport);
      if (mdPath) {
        // expose the md path in the report so callers / logs can reference it
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
    lastReport = { generatedAt: new Date().toISOString(), network: NET, elasticsearch: es, mysql: lastReport?.mysql || null };
    writeReport();
  }
  function recordSql(sql) {
    lastReport = { generatedAt: new Date().toISOString(), network: NET, elasticsearch: lastReport?.elasticsearch || null, mysql: sql, backfill: lastReport?.backfill || null };
    writeReport();
  }
  function recordBackfill(bf) {
    lastReport = { ...(lastReport || { generatedAt: new Date().toISOString(), network: NET }), backfill: bf };
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

  function exportReport() {
    if (!lastReport) { warn('No report in memory yet. Run an audit first (option 1/2/3).'); return null; }
    startRun();
    writeReport();
    announceRun();
    return runBase;
  }

  function buildSheets(rep) {
    const sheets = [];

    // ---- Summary ----
    const summary = [
      [`${NET.toUpperCase()} Unhealthy-Ads Audit`],
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
        // Self-reconciling: Total = with-id + no-id; with-id = distinct + dup copies.
        summary.push(['Docs with an ad id (scanned)', r.duplicates.scannedDocs]);
        summary.push(['Docs with NO ad id', r.duplicates.missingAdId]);
        summary.push(['Distinct ad ids', r.duplicates.distinctIds]);
        summary.push(['Duplicated ad ids (count>1)', r.duplicates.duplicatedIds]);
        summary.push(['Duplicate copies (extra docs)', r.duplicates.extraDocs]);
      }
      if (typeof r.deletable === 'number') summary.push(['Total deletable', r.deletable]);
      Object.entries(r.typeDistribution).forEach(([k, v]) => summary.push([`Type: ${k}`, v]));
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

    // ---- ES Samples (columns are the network's sampleSource) ----
    if (rep.elasticsearch) {
      const rows = [['Factor', 'ES _id', ...ES.sampleSource]];
      rep.elasticsearch.factors.forEach((f) =>
        (f.samples || []).forEach((s) =>
          rows.push([f.key, s._id, ...ES.sampleSource.map((c) => s.src[c])])));
      sheets.push({ name: 'ES Samples', rows });
    }

    // ---- ES Duplicates (full deletable id set: keep 1 per id, remove extra_copies)
    if (rep.elasticsearch && rep.elasticsearch.duplicates && rep.elasticsearch.duplicates.ids.length) {
      const rows = [[ES.idField, 'doc_count', 'extra_copies (deletable)']];
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

  // ── Delete (scaffolded, hard-disabled) ──────────────────────────────────

  function deleteFlow() {
    head(`DELETE UNHEALTHY ADS — ${NET.toUpperCase()}`);
    warn('Deletion is DISABLED in this build (audit-only mode).');
    info('When enabled it will target the same ads this audit flags:');
    info(`  • ES : docs in "${ES.index}" failing the displayable-media filter`);
    info(`  • ES : duplicate docs (same ${ES.idField}) — keep 1 per id, remove the extra copies`);
    info(`  • SQL: ${SQL.mainTable} rows with no / empty ${SQL.mediaTable} media (+ cascading child rows)`);
    info('');
    info('To enable later: set ENABLE_DELETE=true, connect with a write-capable DB');
    info('user, and implement the guarded deletion in deleteFlow(). It must:');
    info('  1) re-run the audit to get a fresh target set,');
    info('  2) require typing the exact confirmation phrase + dry-run preview,');
    info('  3) batch deletes and log every removed id,');
    info('  4) for duplicates, keep exactly one doc per id (the newest by last_seen)');
    info('     and delete only the others.');
    if (!ENABLE_DELETE) { bad('ENABLE_DELETE is false → aborting without any writes.'); return; }
    bad('Delete path not implemented. Aborting.');
  }

  // ── interactive menu ────────────────────────────────────────────────────

  function menu(rl) {
    console.log(`
${'═'.repeat(78)}
  PAS — ${NET.toUpperCase()} UNHEALTHY-ADS AUDIT   (read-only)
  ES index: ${ES.index}   |   DB: ${SQL.database}   |   samples/factor: ${SAMPLE_SIZE}
${'═'.repeat(78)}
  Every audit is auto-saved to diagnostics/audit-reports/ (JSON + Excel).
  1) Run ES audit       (displayable-media filter + duplicate-doc scan${SCAN_DUPLICATES ? '' : ' [--noDup: off]'})
  2) Run SQL audit      (${SQL.mainTable} / ${SQL.mediaTable})
  3) Run BOTH           (full report + backfill analysis)
  4) Backfill analysis  (non-displayable ES ads that have good SQL media — READ-ONLY)
  5) Re-export last report (audit-reports/)
  6) Delete unhealthy ads   [DISABLED — audit-only]
  0) Exit
`);
    rl.question('Choose an option: ', async (choice) => {
      try {
        switch (choice.trim()) {
          case '1': { head('ELASTICSEARCH AUDIT'); startRun(); recordEs(await runEsAudit()); announceRun(); break; }
          case '2': { head('MYSQL AUDIT'); startRun(); recordSql(await runSqlAudit()); announceRun(); break; }
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

  async function main() {
    // give the connection modules a moment to finish their startup health pings
    await new Promise((r) => setTimeout(r, 1200));

    if (args.run) {
      const run = String(args.run).toLowerCase();
      if (run === 'es') {
        head('ELASTICSEARCH AUDIT'); startRun(); recordEs(await runEsAudit()); announceRun();
      } else if (run === 'sql') {
        head('MYSQL AUDIT'); startRun(); recordSql(await runSqlAudit()); announceRun();
      } else if (run === 'backfill') {
        head('BACKFILL ANALYSIS'); startRun(); recordBackfill(await runBackfillAnalysis()); announceRun();
      } else {
        await runBoth();
      }
      process.exit(0);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    menu(rl);
  }

  // Last-resort flush on Ctrl-C: persist whatever portion we already have.
  process.on('SIGINT', () => {
    console.log('\n⚠️  Interrupted — flushing partial report…');
    if (writeReport()) announceRun();
    process.exit(130);
  });

  return { main };
}

// --------------------------------------------------------------------------
// Public entry. Validates the config so a typo fails loudly, not silently.
function runAuditCli(cfg) {
  const required = [
    ['network', cfg.network],
    ['es.index', cfg.es && cfg.es.index],
    ['es.esId', cfg.es && cfg.es.esId !== undefined ? cfg.es.esId : undefined],
    ['es.idField', cfg.es && cfg.es.idField],
    ['es.sampleSource', cfg.es && cfg.es.sampleSource],
    ['sql.dbId', cfg.sql && cfg.sql.dbId !== undefined ? cfg.sql.dbId : undefined],
    ['sql.database', cfg.sql && cfg.sql.database],
    ['sql.mainTable', cfg.sql && cfg.sql.mainTable],
  ];
  // Media model: either the legacy single-table fields, or a mediaSpecs array
  // (split-media networks). Require the per-spec fields in each case.
  const specs = cfg.sql && Array.isArray(cfg.sql.mediaSpecs) && cfg.sql.mediaSpecs.length
    ? cfg.sql.mediaSpecs
    : (cfg.sql ? [{ mediaTable: cfg.sql.mediaTable, fkColumn: cfg.sql.fkColumn, contentColumn: cfg.sql.contentColumn }] : []);
  specs.forEach((s, i) => {
    const tag = (cfg.sql && cfg.sql.mediaSpecs) ? `sql.mediaSpecs[${i}]` : 'sql';
    required.push(
      [`${tag}.mediaTable`, s && s.mediaTable],
      [`${tag}.fkColumn`, s && s.fkColumn],
      [`${tag}.contentColumn`, s && s.contentColumn],
    );
  });
  const missing = required.filter(([, v]) => v === undefined || v === null || v === '').map(([k]) => k);
  if (missing.length) {
    console.error(`FATAL: ads-audit config is missing required field(s): ${missing.join(', ')}`);
    process.exit(1);
  }
  const { main } = makeEngine(cfg);
  main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
}

module.exports = { runAuditCli, ENABLE_DELETE };
