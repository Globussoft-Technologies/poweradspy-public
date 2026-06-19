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
 *   • MySQL (db = FB_DATABASE, tables facebook_ad + facebook_ad_image_video)
 *       Source of truth = facebook_ad_image_video (per audit decision). An ad is
 *       "unhealthy" when it has NO row there (missing media) or its row's
 *       `ad_image_video` JSON is empty / "[]" (empty media).
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
  mediaTable: 'facebook_ad_image_video',
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

  const report = {
    store: 'elasticsearch',
    index: FB.esIndex,
    total,
    displayable: displayableCount,
    unhealthy,
    typeDistribution: { IMAGE: typeImage, VIDEO: typeVideo, OTHER: total - typeImage - typeVideo },
    factors,
  };

  printEsReport(report);
  return report;
}

function printEsReport(r) {
  info(`Total docs ............. ${fmt(r.total)}`);
  info(`Displayable (passes) ... ${fmt(r.displayable)}  (${pct(r.displayable, r.total)})`);
  (r.unhealthy ? bad : ok)(`Unhealthy (fails) ...... ${fmt(r.unhealthy)}  (${pct(r.unhealthy, r.total)})`);
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

// A media row counts as real content only if ad_image_video is a non-empty,
// non-"[]" string.
const NONEMPTY = `(ad_image_video IS NOT NULL AND ad_image_video <> '' AND ad_image_video <> '[]')`;

async function runSqlAudit() {
  sub(`MySQL audit — db "${FB.database}" (db_id ${FB.dbId}), media table "${FB.mediaTable}"`);

  // One pass: per type, classify every ad as missing-row / empty-content / healthy.
  // iv.cnt = how many media rows; iv.nonempty = how many carry real content.
  const breakdown = await q(`
    SELECT a.type,
           COUNT(*) AS total,
           SUM(CASE WHEN iv.facebook_ad_id IS NULL THEN 1 ELSE 0 END)                       AS missing_row,
           SUM(CASE WHEN iv.facebook_ad_id IS NOT NULL AND iv.nonempty = 0 THEN 1 ELSE 0 END) AS empty_content
    FROM ${FB.mainTable} a
    LEFT JOIN (
      SELECT facebook_ad_id,
             COUNT(*) AS cnt,
             SUM(CASE WHEN ${NONEMPTY} THEN 1 ELSE 0 END) AS nonempty
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
      label: `Ad with NO row in ${FB.mediaTable}`,
      count: missingRow,
      sampleSql: `SELECT a.id, a.ad_id, a.type, a.last_seen
                  FROM ${FB.mainTable} a
                  WHERE NOT EXISTS (SELECT 1 FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id)
                  LIMIT ?`,
    },
    {
      key: 'EMPTY_MEDIA_CONTENT',
      label: `Ad whose ${FB.mediaTable}.ad_image_video is empty / "[]"`,
      count: emptyContent,
      sampleSql: `SELECT a.id, a.ad_id, a.type, a.last_seen
                  FROM ${FB.mainTable} a
                  WHERE EXISTS (SELECT 1 FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id)
                    AND NOT EXISTS (SELECT 1 FROM ${FB.mediaTable} iv WHERE iv.facebook_ad_id = a.id AND ${NONEMPTY})
                  LIMIT ?`,
    },
  ];
  for (const f of factors) {
    f.samples = f.count ? await q(f.sampleSql, [SAMPLE_SIZE]) : [];
  }

  const report = {
    store: 'mysql',
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
// REPORT ASSEMBLY / EXPORT
// ==========================================================================

async function runBoth() {
  head('FACEBOOK UNHEALTHY-ADS AUDIT — FULL REPORT');
  startRun(); // open the log file for this run
  const es = await runEsAudit().catch((e) => { bad(`ES audit failed: ${e.message}`); return null; });
  recordEs(es);  // persist the ES portion NOW, before SQL runs
  const sql = await runSqlAudit().catch((e) => { bad(`SQL audit failed: ${e.message}`); return null; });
  recordSql(sql); // persist the full report
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
  } catch (e) {
    bad(`Failed to write report file: ${e.message}`);
    return null;
  }
  return runBase;
}

function recordEs(es) {
  lastReport = { generatedAt: new Date().toISOString(), elasticsearch: es, mysql: lastReport?.mysql || null };
  writeReport();
}
function recordSql(sql) {
  lastReport = { generatedAt: new Date().toISOString(), elasticsearch: lastReport?.elasticsearch || null, mysql: sql };
  writeReport();
}

function announceRun() {
  if (!runBase) { warn('No report on disk (audit produced nothing).'); return; }
  sub('Detailed report written to:');
  info(`${runBase}.json`);
  info(`${runBase}.xlsx`);
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
    summary.push(['Unhealthy (fails)', r.unhealthy]);
    summary.push(['Unhealthy %', pctNum(r.unhealthy, r.total)]);
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

  // ---- SQL Samples ----
  if (rep.mysql) {
    const rows = [['Factor', 'id', 'ad_id', 'type', 'last_seen']];
    rep.mysql.factors.forEach((f) =>
      (f.samples || []).forEach((s) =>
        rows.push([f.key, s.id, s.ad_id, s.type, fmtDate(s.last_seen)])));
    sheets.push({ name: 'SQL Samples', rows });
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
  info(`  • SQL: ${FB.mainTable} rows with no / empty ${FB.mediaTable} media (+ cascading child rows)`);
  info('');
  info('To enable later: set ENABLE_DELETE=true, connect with a write-capable DB');
  info('user, and implement the guarded deletion in deleteFlow(). It must:');
  info('  1) re-run the audit to get a fresh target set,');
  info('  2) require typing the exact confirmation phrase + dry-run preview,');
  info('  3) batch deletes and log every removed id.');
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
  1) Run ES audit       (Elasticsearch displayable-media filter)
  2) Run SQL audit      (facebook_ad / facebook_ad_image_video)
  3) Run BOTH           (full report)
  4) Re-export last report (audit-reports/)
  5) Delete unhealthy ads   [DISABLED — audit-only]
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
        case '4': exportReport(); break;
        case '5': deleteFlow(); break;
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
