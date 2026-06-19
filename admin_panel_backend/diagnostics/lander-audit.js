/**
 * HTML-Lander Unwanted-Data Audit — ALL networks, one file.
 *
 *     cd admin_panel_backend
 *     node diagnostics/lander-audit.js                 # interactive (pick network)
 *     node diagnostics/lander-audit.js --network=instagram --run=both
 *     node diagnostics/lander-audit.js --network=all --run=both
 *
 * Finds UNWANTED html-lander content across BOTH stores and (optionally, when
 * explicitly enabled) deletes it. "Unwanted" = dummy/placeholder or junk lander
 * HTML that should never have been stored / served:
 *
 *   • EMPTY        — NULL or "" lander text
 *   • PLACEHOLDER  — exact dummy strings (e.g. "<html><body>Lander HTML content</body></html>")
 *   • TINY         — populated but < TINY_BYTES bytes (junk / error snippets)
 *   • TRUNCATED    — exactly 65,535 bytes = the TEXT column ceiling (data cut off)
 *
 * Per network (db + ES index from pas_node_api/config.json → NETWORKS below):
 *   • MySQL  — table <net>_ad_html_lander_content. Columns are discovered from
 *              information_schema, so EVERY field is reported (no hard-coded list).
 *   • Elasticsearch — same lander fields, keyed "<landerTable>.<column>".
 *
 * READ-ONLY by default. Deletion is an OPTION but hard-disabled
 * (ENABLE_DELETE = false) — see deleteFlow(). Never auto-run.
 *
 * Each run auto-saves to diagnostics/audit-reports/<net>-lander-<ts>.{json,xlsx}.
 *
 * Flags:
 *     --network=<slug|all>  which network (default: interactive / all for --run)
 *     --run=es|sql|both     run immediately, print + log, then exit
 *     --samples=N           sample rows/docs per factor (default 5)
 *     --tiny=N              "tiny" byte threshold (default 100)
 *     --timeout=MS          per-ES/MySQL-operation timeout (default 45000)
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const fs = require('fs');
const readline = require('readline');
const queryDatabase = require('../db-connections/connection');
const searchAllInstances = require('../es-connections/connection');
const { writeXlsx } = require('./xlsx-writer');

// ==== NETWORK CONFIG — database + esIndex mirror pas_node_api/config.json ====
const NETWORKS = {
  facebook:  { slug: 'facebook',  prefix: 'FB',   esId: 0, dbId: 0, database: process.env.FB_DATABASE   || 'pasdev_facebook',  esIndex: process.env.FB_INDEX   || 'search_mix',           landerTable: 'facebook_ad_html_lander_content',  esIdField: 'facebook_ad.id' },
  instagram: { slug: 'instagram', prefix: 'IG',   esId: 0, dbId: 0, database: process.env.IG_DATABASE   || 'pasdev_instagram', esIndex: process.env.IG_INDEX   || 'instagram_search_mix', landerTable: 'instagram_ad_html_lander_content', esIdField: 'instagram_ad.id' },
  gdn:       { slug: 'gdn',       prefix: 'GDN',  esId: 0, dbId: 0, database: process.env.GDN_DATABASE  || 'pasdev_gdn',       esIndex: process.env.GDN_INDEX  || 'gdn_search_mix',       landerTable: 'gdn_ad_html_lander_content',       esIdField: 'gdn_ad.id' },
  youtube:   { slug: 'youtube',   prefix: 'YT',   esId: 0, dbId: 0, database: process.env.YT_DATABASE   || 'pasdev_youtube',   esIndex: process.env.YT_INDEX   || 'youtube_ads_data',     landerTable: 'youtube_ad_html_lander_content',   esIdField: 'youtube_ad.id' },
  google:    { slug: 'google',    prefix: 'GOOG', esId: 0, dbId: 0, database: process.env.GOOG_DATABASE || 'pasdev_gtext',     esIndex: process.env.GOOG_INDEX || 'google_ads_data',      landerTable: 'google_ad_html_lander_content',    esIdField: 'google_ad.id' },
  native:    { slug: 'native',    prefix: 'NAT',  esId: 0, dbId: 0, database: process.env.NAT_DATABASE  || 'pasdev_native',    esIndex: process.env.NAT_INDEX  || 'native_search_mix',    landerTable: 'native_ad_html_lander_content',    esIdField: 'native_ad.id' },
  linkedin:  { slug: 'linkedin',  prefix: 'LI',   esId: 0, dbId: 0, database: process.env.LI_DATABASE   || 'pasdev_linkedin',  esIndex: process.env.LI_INDEX   || 'linkedin_ads_data',    landerTable: 'linkedin_ad_html_lander_content',  esIdField: 'linkedin_ad.id' },
  reddit:    { slug: 'reddit',    prefix: 'RED',  esId: 0, dbId: 0, database: process.env.RED_DATABASE  || 'pasdev_reddit',    esIndex: process.env.RED_INDEX  || 'reddit_search_mix',    landerTable: 'reddit_ad_html_lander_content',    esIdField: 'reddit_ad.id' },
  quora:     { slug: 'quora',     prefix: 'QR',   esId: 0, dbId: 0, database: process.env.QR_DATABASE   || 'pasdev_quora',     esIndex: process.env.QR_INDEX   || 'quora_search_mix',     landerTable: 'quora_ad_html_lander_content',     esIdField: 'quora_ad.id' },
  pinterest: { slug: 'pinterest', prefix: 'PIN',  esId: 0, dbId: 0, database: process.env.PIN_DATABASE  || 'pasdev_pinterest', esIndex: process.env.PIN_INDEX  || 'pinterest_search_mix', landerTable: 'pinterest_ad_html_lander_content', esIdField: 'pinterest_ad.id' },
};
const NETWORK_KEYS = Object.keys(NETWORKS);
// ==== END NETWORK CONFIG ====

// Active network — mutable; switched by the menu / --network flag / run-all loop.
let NET = NETWORKS.facebook;

// --------------------------------------------------------------------------
// HARD SAFETY SWITCH. Deletion is intentionally NOT enabled — audit-only.
const ENABLE_DELETE = false;

const PLACEHOLDERS = [
  '<html><body>Lander HTML content</body></html>',
];
const TEXT_CEILING = 65535; // MySQL TEXT max bytes — a value at exactly this is truncated

// --------------------------------------------------------------------------
// arg parser
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  })
);
const SAMPLE_SIZE = Math.max(1, parseInt(args.samples, 10) || 5);
const TINY_BYTES = Math.max(1, parseInt(args.tiny, 10) || 100);

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
const fmtBytes = (b) => {
  b = Number(b || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(2)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
};

let lastReport = null;
let runBase = null;

const OP_TIMEOUT_MS = Math.max(5000, parseInt(args.timeout, 10) || 45000);
function withTimeout(promise, label) {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${OP_TIMEOUT_MS}ms`)), OP_TIMEOUT_MS);
  });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

// ==========================================================================
// SCHEMA DISCOVERY (dynamic — every field captured automatically)
// ==========================================================================
const q = (sql, params) => withTimeout(queryDatabase(NET.dbId, NET.database, sql, params), 'MySQL query');

async function discoverColumns() {
  const cols = await q(
    `SELECT ORDINAL_POSITION pos, COLUMN_NAME name, COLUMN_TYPE type, DATA_TYPE dataType,
            CHARACTER_MAXIMUM_LENGTH charLen, IS_NULLABLE nullable, COLUMN_KEY kkey,
            COLUMN_DEFAULT dflt, EXTRA extra, COLUMN_COMMENT comment
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [NET.database, NET.landerTable]
  );
  if (!cols.length) throw new Error(`Table ${NET.database}.${NET.landerTable} not found / no columns`);
  const htmlCols = cols.filter((c) => /lander_text|html/i.test(c.name)).map((c) => c.name);
  const fkCol = (cols.find((c) => /_ad_id$/i.test(c.name)) || {}).name || null;
  return { cols, htmlCols, fkCol };
}

// ==========================================================================
// MySQL AUDIT
// ==========================================================================
async function runSqlAudit(schema) {
  sub(`MySQL audit — db "${NET.database}", table "${NET.landerTable}"`);
  const { cols, htmlCols, fkCol } = schema || (await discoverColumns());

  // ---- ONE-PASS per-column aggregate (light: single scan of the table) ----
  const frags = ['COUNT(*) AS total'];
  const params = [];
  for (const c of htmlCols) {
    const b = '`' + c + '`';
    frags.push(`SUM(${b} IS NOT NULL AND ${b} <> '') AS \`${c}__pop\``);
    const ph = PLACEHOLDERS.map(() => '?').join(',');
    frags.push(`SUM(${b} IN (${ph})) AS \`${c}__ph\``); params.push(...PLACEHOLDERS);
    frags.push(`SUM(${b} IS NOT NULL AND ${b} <> '' AND LENGTH(${b}) < ?) AS \`${c}__tiny\``); params.push(TINY_BYTES);
    frags.push(`SUM(LENGTH(${b}) = ${TEXT_CEILING}) AS \`${c}__trunc\``);
    frags.push(`MAX(LENGTH(${b})) AS \`${c}__max\``);
    frags.push(`ROUND(AVG(LENGTH(${b}))) AS \`${c}__avg\``);
    frags.push(`SUM(LENGTH(${b})) AS \`${c}__sum\``);
  }
  const [agg] = await q(`SELECT ${frags.join(', ')} FROM \`${NET.landerTable}\``, params);
  const total = Number(agg.total || 0);

  const columns = htmlCols.map((c) => {
    const pop = Number(agg[`${c}__pop`] || 0);
    const ph = Number(agg[`${c}__ph`] || 0);
    const tiny = Number(agg[`${c}__tiny`] || 0);
    const trunc = Number(agg[`${c}__trunc`] || 0);
    return {
      column: c,
      populated: pop,
      placeholder: ph,
      tiny,                                  // includes placeholder-length rows
      truncated: trunc,
      unwanted: Math.max(ph, 0) + Math.max(tiny - ph, 0), // placeholder + (tiny not already placeholder)
      maxBytes: Number(agg[`${c}__max`] || 0),
      avgBytes: Number(agg[`${c}__avg`] || 0),
      totalBytes: Number(agg[`${c}__sum`] || 0),
    };
  });

  // ---- samples of unwanted rows (placeholder OR tiny), capped + light ----
  let samples = [];
  if (fkCol && htmlCols.length) {
    const where = htmlCols.map((c) => {
      const b = '`' + c + '`';
      const ph = PLACEHOLDERS.map(() => '?').join(',');
      return `(${b} IN (${ph})) OR (${b} IS NOT NULL AND ${b} <> '' AND LENGTH(${b}) < ?)`;
    }).join(' OR ');
    const sParams = [];
    htmlCols.forEach(() => { sParams.push(...PLACEHOLDERS, TINY_BYTES); });
    const preview = htmlCols.map((c) => `LEFT(\`${c}\`, 60) AS \`${c}\``).join(', ');
    samples = await q(
      `SELECT \`${fkCol}\` AS ad_id, ${preview} FROM \`${NET.landerTable}\` WHERE ${where} LIMIT ?`,
      [...sParams, SAMPLE_SIZE]
    );
  }

  const unwantedTotal = columns.reduce((s, c) => s + c.unwanted, 0);
  const report = {
    store: 'mysql', database: NET.database, table: NET.landerTable, total,
    htmlColumns: htmlCols, allColumns: cols, fkColumn: fkCol, columns,
    unwantedTotal, tinyThreshold: TINY_BYTES, placeholders: PLACEHOLDERS, samples,
  };
  printSqlReport(report);
  return report;
}

function printSqlReport(r) {
  info(`Rows in ${r.table} .......... ${fmt(r.total)}`);
  info(`Lander HTML columns ......... ${r.htmlColumns.join(', ') || '(none detected)'}`);
  for (const c of r.columns) {
    sub(`[SQL] ${c.column}`);
    info(`populated ${fmt(c.populated)}  |  placeholder ${fmt(c.placeholder)}  |  tiny(<${r.tinyThreshold}B) ${fmt(c.tiny)}  |  truncated ${fmt(c.truncated)}`);
    info(`size: max ${fmtBytes(c.maxBytes)}  avg ${fmtBytes(c.avgBytes)}  total ${fmtBytes(c.totalBytes)}`);
    (c.unwanted ? bad : ok)(`unwanted (placeholder + tiny) ... ${fmt(c.unwanted)}  (${pct(c.unwanted, c.populated)})`);
  }
  if (r.samples.length) {
    sub('Sample unwanted rows:');
    r.samples.forEach((s) => info(`ad_id=${s.ad_id} | ${Object.entries(s).filter(([k]) => k !== 'ad_id').map(([k, v]) => `${k}=${trunc(v, 40)}`).join(' | ')}`));
  }
}

// ==========================================================================
// ELASTICSEARCH AUDIT
// ==========================================================================
async function esCount(query) {
  const res = await withTimeout(searchAllInstances(NET.esIndex, { query }, NET.esId, 'count'), 'ES count');
  if (!res || res.data === undefined) throw new Error('ES count returned no data (search failed — see log above)');
  return res.data;
}
async function esSamples(field, query, size = SAMPLE_SIZE) {
  const body = { size, _source: [NET.esIdField, field], query };
  const res = await withTimeout(searchAllInstances(NET.esIndex, body, NET.esId, 'search'), 'ES samples');
  const hits = res?.data?.hits?.hits || [];
  return hits.map((h) => ({ _id: h._id, value: trunc(h._source?.[field], 60) }));
}

async function runEsAudit(schema) {
  sub(`Elasticsearch audit — index "${NET.esIndex}" (es_id ${NET.esId})`);
  const { htmlCols } = schema || (await discoverColumns());

  const total = await esCount({ match_all: {} });
  const fields = htmlCols.map((c) => `${NET.landerTable}.${c}`);

  const out = [];
  for (const field of fields) {
    let populated = 0, placeholder = 0;
    try { populated = await esCount({ exists: { field } }); } catch (e) { populated = `ERR: ${e.message}`; }
    try {
      const should = PLACEHOLDERS.map((p) => ({ term: { [`${field}.keyword`]: p } }));
      placeholder = await esCount({ bool: { should, minimum_should_match: 1 } });
    } catch (e) { placeholder = `ERR: ${e.message}`; }
    const samples = (typeof populated === 'number' && populated > 0)
      ? await esSamples(field, { exists: { field } }).catch(() => [])
      : [];
    out.push({ field, populated, placeholder, samples });
  }

  const report = { store: 'elasticsearch', index: NET.esIndex, total, fields: out };
  printEsReport(report);
  return report;
}

function printEsReport(r) {
  info(`Total docs ............. ${fmt(r.total)}`);
  for (const f of r.fields) {
    sub(`[ES] ${f.field}`);
    info(`populated ${fmt(f.populated)}  |  placeholder ${fmt(f.placeholder)}`);
    (f.samples || []).forEach((s) => info(`_id=${s._id} | value=${s.value}`));
  }
}

// ==========================================================================
// REPORT ASSEMBLY / EXPORT
// ==========================================================================
async function runBoth() {
  head(`${NET.slug.toUpperCase()} HTML-LANDER UNWANTED-DATA AUDIT — FULL REPORT`);
  startRun();
  const schema = await discoverColumns().catch((e) => { bad(`Schema discovery failed: ${e.message}`); return null; });
  const sql = schema ? await runSqlAudit(schema).catch((e) => { bad(`SQL audit failed: ${e.message}`); return null; }) : null;
  recordSql(sql);
  const es = schema ? await runEsAudit(schema).catch((e) => { bad(`ES audit failed: ${e.message}`); return null; }) : null;
  recordEs(es);
  line('═');
  announceRun();
  return lastReport;
}

// Run the full audit for EVERY network, one report file pair per network.
async function runAll() {
  const bases = [];
  for (const key of NETWORK_KEYS) {
    NET = NETWORKS[key];
    lastReport = null; runBase = null;
    await runBoth().catch((e) => bad(`[${key}] failed: ${e.message}`));
    if (runBase) bases.push(runBase);
  }
  line('═');
  sub('All-network reports written:');
  bases.forEach((b) => info(`${b}.xlsx`));
  return bases;
}

function startRun() {
  try { fs.mkdirSync(REPORT_DIR, { recursive: true }); } catch (_) {}
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  runBase = path.join(REPORT_DIR, `${NET.slug}-lander-${stamp}`);
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
function recordSql(sql) {
  lastReport = { network: NET.slug, generatedAt: new Date().toISOString(), mysql: sql, elasticsearch: lastReport?.elasticsearch || null };
  writeReport();
}
function recordEs(es) {
  lastReport = { network: NET.slug, generatedAt: new Date().toISOString(), mysql: lastReport?.mysql || null, elasticsearch: es };
  writeReport();
}
function announceRun() {
  if (!runBase) { warn('No report on disk (audit produced nothing).'); return; }
  sub('Detailed report written to:');
  info(`${runBase}.json`);
  info(`${runBase}.xlsx`);
}
function exportReport() {
  if (!lastReport) { warn('No report in memory yet. Run an audit first.'); return null; }
  startRun(); writeReport(); announceRun();
  return runBase;
}

const pctNum = (n, d) => (d ? Number(((n / d) * 100).toFixed(1)) : 0);

// Sheets: Summary | DB Schema (all fields) | DB Lander Usage | ES Lander Fields | DB Samples | ES Samples
function buildSheets(rep) {
  const sheets = [];

  const summary = [
    [`${rep.network} — HTML-Lander Unwanted-Data Audit`],
    ['Generated', rep.generatedAt],
    ['Unwanted = EMPTY / PLACEHOLDER / TINY(<' + TINY_BYTES + 'B) / TRUNCATED(=65535B)'],
    [],
  ];
  if (rep.mysql) {
    const r = rep.mysql;
    summary.push(['MYSQL', `${r.database} / ${r.table}`]);
    summary.push(['Rows', r.total]);
    summary.push(['Unwanted (total across HTML cols)', r.unwantedTotal]);
    summary.push(['Column', 'populated', 'placeholder', 'tiny', 'truncated', 'unwanted', 'max B', 'avg B', 'total B']);
    r.columns.forEach((c) => summary.push([c.column, c.populated, c.placeholder, c.tiny, c.truncated, c.unwanted, c.maxBytes, c.avgBytes, c.totalBytes]));
    summary.push([]);
  }
  if (rep.elasticsearch) {
    const r = rep.elasticsearch;
    summary.push(['ELASTICSEARCH', r.index]);
    summary.push(['Total docs', r.total]);
    summary.push(['Field', 'populated', 'placeholder']);
    r.fields.forEach((f) => summary.push([f.field, f.populated, f.placeholder]));
  }
  sheets.push({ name: 'Summary', rows: summary });

  if (rep.mysql) {
    const rows = [['Pos', 'Column', 'Type (size)', 'DataType', 'CharMaxLen', 'Nullable', 'Key', 'Default', 'Extra', 'Comment']];
    rep.mysql.allColumns.forEach((c) => rows.push([
      c.pos, c.name, c.type, c.dataType, c.charLen == null ? '' : Number(c.charLen),
      c.nullable, c.kkey || '', c.dflt == null ? '' : String(c.dflt), c.extra || '', c.comment || '',
    ]));
    sheets.push({ name: 'DB Schema', rows });
  }

  if (rep.mysql) {
    const rows = [['Column', 'Populated', 'Placeholder', 'Tiny', 'Truncated', 'Unwanted', 'Unwanted %', 'Max bytes', 'Avg bytes', 'Total bytes']];
    rep.mysql.columns.forEach((c) => rows.push([
      c.column, c.populated, c.placeholder, c.tiny, c.truncated, c.unwanted, pctNum(c.unwanted, c.populated), c.maxBytes, c.avgBytes, c.totalBytes,
    ]));
    sheets.push({ name: 'DB Lander Usage', rows });
  }

  if (rep.elasticsearch) {
    const rows = [['Field', 'Populated', 'Placeholder']];
    rep.elasticsearch.fields.forEach((f) => rows.push([f.field, f.populated, f.placeholder]));
    sheets.push({ name: 'ES Lander Fields', rows });
  }

  if (rep.mysql && rep.mysql.samples.length) {
    const keys = Object.keys(rep.mysql.samples[0]);
    const rows = [keys];
    rep.mysql.samples.forEach((s) => rows.push(keys.map((k) => s[k])));
    sheets.push({ name: 'DB Samples', rows });
  }

  if (rep.elasticsearch) {
    const rows = [['Field', 'ES _id', 'value']];
    rep.elasticsearch.fields.forEach((f) => (f.samples || []).forEach((s) => rows.push([f.field, s._id, s.value])));
    sheets.push({ name: 'ES Samples', rows });
  }

  return sheets;
}

// ==========================================================================
// DELETE (scaffolded — disabled by default; this is the "delete option")
// ==========================================================================
function deleteFlow() {
  head(`DELETE UNWANTED LANDER DATA — ${NET.slug}`);
  warn('Deletion is DISABLED in this build (audit-only mode).');
  info('When enabled it will target the same rows/docs this audit flags as unwanted:');
  info(`  • SQL : UPDATE ${NET.landerTable} SET <html col> = NULL where placeholder/tiny`);
  info(`  • ES  : POST ${NET.esIndex}/_update_by_query removing the field on matching docs (this is what "Kibana" reads)`);
  info('');
  info('To enable later: set ENABLE_DELETE=true, connect with a write-capable user,');
  info('and implement the guarded deletion. It must re-audit, require the exact typed');
  info('confirmation + dry-run preview, then batch deletes and log every changed id.');
  if (!ENABLE_DELETE) { bad('ENABLE_DELETE is false → aborting without any writes.'); return; }
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
function setNetwork(slug) {
  if (!NETWORKS[slug]) { warn(`Unknown network "${slug}". Known: ${NETWORK_KEYS.join(', ')}`); return false; }
  NET = NETWORKS[slug];
  ok(`Active network → ${slug}  (db ${NET.database}, index ${NET.esIndex})`);
  return true;
}

// ==========================================================================
// interactive menu
// ==========================================================================
function menu(rl) {
  console.log(`
${'═'.repeat(78)}
  PAS — HTML-LANDER UNWANTED-DATA AUDIT   (read-only)   [all networks]
  Active: ${NET.slug}   |   DB: ${NET.database}   |   index: ${NET.esIndex}
  table: ${NET.landerTable}   |   samples: ${SAMPLE_SIZE}   |   tiny: ${TINY_BYTES}B
${'═'.repeat(78)}
  Reports auto-saved to diagnostics/audit-reports/ (JSON + Excel).
  n) Choose network    (${NETWORK_KEYS.join(', ')})
  1) Run SQL audit     (current network)
  2) Run ES audit      (current network)
  3) Run BOTH          (current network)
  4) Run BOTH for ALL networks
  5) Re-export last report
  6) Delete unwanted lander data   [DISABLED — audit-only]
  0) Exit
`);
  rl.question('Choose an option: ', async (choice) => {
    try {
      switch (choice.trim()) {
        case 'n': {
          rl.question(`Network (${NETWORK_KEYS.join('/')}): `, (slug) => { setNetwork(slug.trim()); menu(rl); });
          return;
        }
        case '1': { head('MYSQL AUDIT'); startRun(); recordSql(await runSqlAudit()); announceRun(); break; }
        case '2': { head('ELASTICSEARCH AUDIT'); startRun(); recordEs(await runEsAudit()); announceRun(); break; }
        case '3': await runBoth(); break;
        case '4': await runAll(); break;
        case '5': exportReport(); break;
        case '6': deleteFlow(); break;
        case '0': case 'q': case 'exit':
          rl.close(); console.log('Bye.'); process.exit(0); return;
        default: warn('Unknown option.');
      }
    } catch (e) {
      bad(`Operation failed: ${e.message}`);
    }
    menu(rl);
  });
}

// ==========================================================================
// entry
// ==========================================================================
async function main() {
  await new Promise((r) => setTimeout(r, 1200)); // let connection modules finish startup pings

  const wanted = args.network ? String(args.network).toLowerCase() : null;

  if (args.run) {
    const run = String(args.run).toLowerCase();
    const runOne = async () => {
      if (run === 'sql') { head('MYSQL AUDIT'); startRun(); recordSql(await runSqlAudit()); announceRun(); }
      else if (run === 'es') { head('ELASTICSEARCH AUDIT'); startRun(); recordEs(await runEsAudit()); announceRun(); }
      else await runBoth();
    };
    if (!wanted || wanted === 'all') {
      await runAll();
    } else if (setNetwork(wanted)) {
      await runOne();
    }
    process.exit(0);
  }

  if (wanted && wanted !== 'all') setNetwork(wanted);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  menu(rl);
}

process.on('SIGINT', () => {
  console.log('\n⚠️  Interrupted — flushing partial report…');
  if (writeReport()) announceRun();
  process.exit(130);
});

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
