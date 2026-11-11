#!/usr/bin/env node
'use strict';

/**
 * DEFAULT (--mode=date): delete EVERY ad whose last_seen is before --before (default 2024-01-01)
 * on all 9 networks (facebook, instagram, youtube, linkedin, reddit, tiktok, gdn, quora, google),
 * from Elasticsearch AND MySQL, in one resumable run. No other condition.
 *   ES:  each network's own last_seen field (ES_DATE_FIELD), one server-side _delete_by_query task.
 *   SQL: <main table>.last_seen < cutoff, the ad + its child rows (TikTok has no SQL).
 *
 * OLD rule (--mode=placeholder): placeholder media (pasimage/pasvideo/bydefault/DefaultImage, kept
 * when another media field is real) + Google organic search before --before.
 *
 * --mode=no-media (wrapper: scripts/delete-no-media-ads.js): delete media ads (IMAGE/VIDEO/STORIES/…
 * per network, NO_MEDIA below) that the search API never shows because they have no displayable
 * media — they fail the network's displayable-media gate (src/services/common/helpers/
 * displayableMediaFilters.js, the same gate the search uses). Every network except tiktok,
 * chatgptads and admob. Fail-safes: an ad whose SQL media column holds a NAS path
 * (--keep-sql-patterns) is kept in ES + SQL; a SQL ad is kept when another ES doc of it is visible.
 *
 *   node scripts/delete-placeholder-media.js              # dry run: every network — counts, sizes, time
 *   node scripts/delete-placeholder-media.js --apply      # delete from ES + SQL (live progress table)
 *   node scripts/delete-placeholder-media.js --apply=es   # ES only     (--apply=sql: SQL only)
 *   Runbook: docs/DELETE_PLACEHOLDER_MEDIA_SCRIPT.md
 *
 * Load / safety
 *   - Date mode: SQL walks the main ad table by id in bounded windows (50k ids per SELECT); ES runs
 *     one server-side _delete_by_query task per network, at most --dbq-parallel at once per cluster,
 *     sharing a speed that is re-throttled live from the node's load. Task ids are saved, so after a
 *     restart the script re-attaches to them instead of starting over.
 *   - Placeholder mode: matching ads are collected ONCE into an ID file; an ES lane (bulk delete by
 *     _id) and a SQL lane then work through it with their own saved cursors.
 *   - ES: per cluster, how many bulk requests run at once (1 → --es-parallel) and the batch size
 *     follow heap / CPU / write queue / rejections / latency; overload → halve + pause.
 *   - SQL: different hosts in parallel, networks on one host one after another; batch size follows
 *     batch time and the host's Threads_running. Plain (non-prepared) queries only, so the
 *     server's prepared-statement limit is never touched.
 *   - Outage → that lane waits and retries; crash → the supervisor restarts the worker, which
 *     continues from the saved cursors; Ctrl+C stops cleanly (re-run the same command).
 *   - This machine: low CPU priority, capped heap, one batch in memory, pause while it is busy.
 *
 * Connections come from config.json. To use a DIFFERENT ES / SQL, uncomment OVERRIDES below or
 * pass --overrides=<file.json> / --es-node=... (config.json < OVERRIDES < file < flags).
 */

// ── Connection overrides (uncomment what you need; empty = use config.json) ──
// ES for every network → these clusters (index names still come from config.json).
// SQL → config.json for every network. To go back to config.json ES, comment out `es` / `tiktokEs` below.
const ES_TARGET = { // facebook, instagram, youtube, linkedin, reddit, gdn, quora, google
  node: 'http://163.227.174.138:64201',
  auth: { username: 'elastic', password: '' }, // ← put the ES password here (or --es-pass=...)
};
const TIKTOK_ES_TARGET = { // tiktok
  node: 'http://163.227.174.149:64203',
  auth: { username: 'elastic', password: '' }, // ← put the TikTok ES password here (or --tiktok-es-pass=...)
};

const OVERRIDES = {
  // Main Elasticsearch (every network except TikTok):
  es: ES_TARGET,

  // Per-network index name on that ES:
  // esIndex: { facebook: 'search_mix', google: 'google_ads_data' },

  // TikTok's own Elasticsearch (index from config.json unless you set `index` here):
  tiktokEs: TIKTOK_ES_TARGET,

  // Per-network MySQL (only the keys you set are replaced):
  // sql: {
  //   facebook: { host: '10.0.0.208', port: 3306, user: 'facebook-dbusr', password: 'CHANGE_ME', database: 'facebook_sql' },
  //   google:   { host: '10.0.0.160' },
  // },
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

// ── what is deleted, per network ────────────────────────────────────────────
// mediaFields: ES fields the UI renders. idField: the SQL ad id in the ES doc.
// sqlMedia: [table, ad-id column, current media columns] (old_* / *_original are history, not checked).
const NETWORKS = {
  facebook: {
    idField: 'facebook_ad.id', mainTable: 'facebook_ad', mediaFields: ['new_nas_image_url.keyword', 'Thumbnail.keyword', 'othermedia.keyword'],
    sqlMedia: [['facebook_ad_variants', 'facebook_ad_id', ['image_url']], ['facebook_ad_image_video', 'facebook_ad_id', ['ad_image_video']]],
  },
  instagram: {
    idField: 'instagram_ad.id', mainTable: 'instagram_ad', mediaFields: ['new_nas_image_url.keyword', 'thumbnail.keyword', 'Thumbnail.keyword', 'othermedia.keyword'],
    sqlMedia: [['instagram_ad_variants', 'instagram_ad_id', ['image_url']], ['instagram_ad_image_video', 'instagram_ad_id', ['ad_image_video']]],
  },
  youtube: {
    idField: 'ad_id', mainTable: 'youtube_ad', mediaFields: ['new_nas_image_url.keyword', 'thumbnail_url.keyword'],
    sqlMedia: [['youtube_ad_variants', 'youtube_ad_id', ['thumbnail_url', 'video_url']], ['youtube_ad_image_video', 'youtube_ad_id', ['ad_image_video']]],
  },
  linkedin: {
    idField: 'ad_id', mainTable: 'linkedin_ad', mediaFields: ['new_nas_image_url.keyword', 'ad_video.keyword'],
    sqlMedia: [['linkedin_ad_variants', 'linkedin_ad_id', ['image_url']], ['linkedin_ad_image_video', 'linkedin_ad_id', ['ad_image_video']]],
  },
  reddit: {
    idField: 'reddit_ad.id', mainTable: 'reddit_ad', mediaFields: ['new_nas_image_url.keyword', 'Thumbnail.keyword'],
    sqlMedia: [['reddit_ad_variants', 'reddit_ad_id', ['image_url']], ['reddit_ad_image_video', 'reddit_ad_id', ['ad_image_video']]],
  },
  // realFields: fields that count as "real media" for the keep rule. TikTok's video_url is an
  // expiring tiktokcdn link, so only the stored cover counts.
  tiktok: { idField: 'sql_id', mainTable: null, mediaFields: ['video_cover.keyword', 'video_url'], realFields: ['video_cover'], sqlMedia: [], tiktok: true },
  gdn: {
    idField: 'gdn_ad.id', mainTable: 'gdn_ad', mediaFields: ['new_nas_image_url.keyword'],
    sqlMedia: [['gdn_ad_variants', 'gdn_ad_id', ['image_url']]],
  },
  quora: {
    idField: 'quora_ad.id', mainTable: 'quora_ad', mediaFields: ['new_nas_image_url.keyword', 'thumbnail.keyword'],
    sqlMedia: [['quora_ad_variants', 'quora_ad_id', ['image_url', 'video_url']], ['quora_ad_image_video', 'quora_ad_id', ['ad_image_video']]],
  },
  // Google: organic search ads last seen before --before. ES _id = google_text_ad.id.
  google: {
    rule: 'google-organic', idField: 'id', mainTable: 'google_text_ad', extraChildren: [['google_text_hidden_ads', 'ad_id']],
    mediaFields: ['new_nas_image_url.keyword'], sqlMedia: [['google_text_ad_variants', 'google_text_ad_id', ['image_url']]],
  },
  // --mode=no-media only (never part of the date / placeholder runs):
  pinterest: {
    noMediaOnly: true, idField: 'pinterest_ad.id', mainTable: 'pinterest_ad', mediaFields: ['new_nas_image_url.keyword', 'thumbnail.keyword'],
    sqlMedia: [['pinterest_ad_variants', 'pinterest_ad_id', ['image_url']]],
  },
  native: {
    noMediaOnly: true, idField: 'native_ad.id', mainTable: 'native_ad', mediaFields: ['native_ad.nas_url.keyword'],
    sqlMedia: [['native_ad_variants', 'native_ad_id', ['image_url']]],
  },
};

// ── --mode=no-media: which ads have no displayable media ────────────────────
// types: the media ad types of the network (an ad of these types is only shown with media).
// Types the search hides on purpose — Google organic search / text, YouTube BANNER / TEXT, … —
// are never touched. gates: the displayable-media gates that can show the ad (YouTube DISPLAY /
// IMAGE ads are also shown under GDN, so a YouTube ad is "visible" if EITHER gate passes it).
// Production 2026-11-11: each network's hidden ads carry only legacy pasimages/pasvideos paths
// (404 on the media host) or nothing at all, in ES and in SQL.
const NO_MEDIA = {
  facebook:  { typeField: 'facebook_ad.type.keyword', types: ['IMAGE', 'VIDEO'] },
  instagram: { typeField: 'instagram_ad.type.keyword', types: ['IMAGE', 'VIDEO', 'STORIES'] },
  youtube:   { typeField: 'ad_type.keyword', types: ['VIDEO', 'DISCOVERY', 'IMAGE', 'DISPLAY'], gates: ['youtube', 'youtubeDisplayUnderGdn'] },
  linkedin:  { typeField: 'ad_type.keyword', types: ['IMAGE', 'VIDEO'] },
  reddit:    { typeField: 'reddit_ad.type.keyword', types: ['IMAGE', 'VIDEO'] },
  gdn:       { typeField: 'gdn_ad.type.keyword', types: ['IMAGE', ''] },
  quora:     { typeField: 'quora_ad.type.keyword', types: ['IMAGE', 'VIDEO'] },
  google:    { typeField: 'type', types: ['image'] }, // `type` has a lowercase normalizer
  pinterest: { typeField: 'pinterest_ad.type.keyword', types: ['IMAGE', 'VIDEO'] },
  native:    { typeField: 'native_ad.type.keyword', types: ['IMAGE', 'VIDEO'] },
};
// SQL fail-safe: an ad whose SQL media column contains one of these is KEPT (its image exists on
// the NAS; only the ES doc is missing it). LIKE is case-insensitive; JSON-escaped paths match too.
const DEFAULT_KEEP_SQL_PATTERNS = ['PowerAdspy', 'pas-prod'];

/** Networks a mode works on (date / placeholder never include the no-media-only networks). */
function networksFor(mode) {
  return mode === 'no-media' ? Object.keys(NO_MEDIA) : Object.keys(NETWORKS).filter((n) => !NETWORKS[n].noMediaOnly);
}

function mediaGates() {
  const { getDisplayableMediaFilter, YOUTUBE_DISPLAY_UNDER_GDN } = require('../src/services/common/helpers/displayableMediaFilters');
  return (g) => (g === 'youtubeDisplayUnderGdn' ? YOUTUBE_DISPLAY_UNDER_GDN : getDisplayableMediaFilter(g));
}

/** ES: the ad is shown by the search (passes one of the network's displayable-media gates). */
function visibleQuery(network) {
  const gate = mediaGates();
  const gates = (NO_MEDIA[network].gates || [network]).map(gate);
  if (gates.some((g) => !Array.isArray(g) || !g.length)) throw Object.assign(new Error(`${network}: no displayable-media gate found`), { fatal: true });
  return { bool: { should: gates.map((g) => ({ bool: { filter: g } })), minimum_should_match: 1 } };
}

/** ES: a media ad of the network that the search never shows. */
function noMediaQuery(network) {
  const nm = NO_MEDIA[network];
  return { bool: { filter: [{ terms: { [nm.typeField]: nm.types } }], must_not: [visibleQuery(network)] } };
}

/**
 * The no-media rule is "fails the gate", so the gate must be the fixed one: the old FB/IG gate had a
 * duplicate `must_not` key (lost type exclusion) and hid video STORIES that only have a thumbnail —
 * running against it would delete ads the fixed search shows.
 */
function assertGateUpToDate() {
  const gate = mediaGates();
  const problems = [];
  for (const [n, types] of [['facebook', ['IMAGE', 'VIDEO']], ['instagram', ['IMAGE', 'VIDEO', 'STORIES']]]) {
    const branches = gate(n)?.[0]?.bool?.should || [];
    const last = branches[branches.length - 1]?.bool || {};
    const want = JSON.stringify({ terms: { [`${n}_ad.type.keyword`]: types } });
    if (!(last.must_not || []).some((c) => JSON.stringify(c) === want)) problems.push(`${n}: catch-all branch lost its type exclusion`);
  }
  const ig = JSON.stringify(gate('instagram'));
  if (!ig.includes('{"terms":{"instagram_ad.type.keyword":["VIDEO","STORIES"]}}')) problems.push('instagram: video STORIES with a thumbnail are not displayable');
  if (problems.length) {
    throw Object.assign(new Error(`displayableMediaFilters.js is the old gate (${problems.join('; ')}). Deploy the fixed src/services first.`), { fatal: true });
  }
}
// ES field holding each network's last_seen. All are `date` type (production check 2026-11-05;
// youtube/linkedin store epoch_second — the range query's own format handles that).
const ES_DATE_FIELD = {
  facebook: 'facebook_ad.last_seen', instagram: 'instagram_ad.last_seen', youtube: 'last_seen', linkedin: 'last_seen',
  reddit: 'reddit_ad.last_seen', tiktok: 'last_seen', gdn: 'gdn_ad.last_seen', quora: 'quora_ad.last_seen', google: 'last_seen',
};
for (const [n, field] of Object.entries(ES_DATE_FIELD)) NETWORKS[n].esDateField = field;

const DEFAULT_PATTERNS = ['pasimage', 'pasvideo', 'bydefault', 'DefaultImage'];
// SQL media columns ALWAYS hold the relative stored path ("pasimages/reddit/og62xv.jpg" is a real
// image), so "pasimage" / "pasvideo" are NOT placeholders there. Only real placeholder files count.
const DEFAULT_SQL_PATTERNS = ['DefaultImage', 'bydefault'];

// Child tables found by column name are NOT deleted when they are activity logs, user lists,
// queues or history (same rule as purge-before-date.js). Foreign-key children always are.
const SKIP_TABLE = /(activit|_logs?$|^logs?_|hidden|hide_|favou?rite|_queue|history|_audit)/i;
const SAFE_IDENT = /^[A-Za-z0-9_]+$/;

const EXIT = { OK: 0, FAILED: 1, FATAL: 2, STOPPED: 3 };

// ── small helpers ───────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unwrap = (res) => (res && res.body !== undefined ? res.body : res);
const rowsOf = (r) => (Array.isArray(r?.[0]) ? r[0] : (Array.isArray(r) ? r : []));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const num = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US'));
const totalOf = (res) => { const t = res?.hits?.total; return typeof t === 'number' ? t : Number(t?.value || 0); };

/** Plain (client-side escaped) query — never a server-side prepared statement. */
async function q(sql, text, params = []) {
  if (sql.pool?.query) return (await sql.pool.query(text, params))[0];
  return rowsOf(await sql.query(text, params));
}

/** 93784000 → "1d 2h 3m" (minutes and seconds only when short). */
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h ${m}m`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtBytes(b) {
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function getPath(obj, dotted) {
  if (obj && Object.prototype.hasOwnProperty.call(obj, dotted)) return obj[dotted];
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ── args ────────────────────────────────────────────────────────────────────
function usage() {
  return `
Dry run (read-only, every network):  node scripts/delete-placeholder-media.js
Delete from ES + SQL:                node scripts/delete-placeholder-media.js --apply
Delete from ES only / SQL only:      node scripts/delete-placeholder-media.js --apply=es   |   --apply=sql
The apply run prints a live progress table (in the terminal, or in the nohup log).

Optional
  --networks=a,b         default: all (${networksFor('date').join(',')})
  --patterns=a,b         ES media placeholder patterns. default: ${DEFAULT_PATTERNS.join(',')}
  --sql-patterns=a,b     SQL media placeholder patterns (ads whose ES doc has no media). default: ${DEFAULT_SQL_PATTERNS.join(',')}
                         (never pasimage/pasvideo: SQL stores real media as pasimages/... paths)
  --before=2024-01-01    delete EVERY ad whose last_seen is before this date (ES + SQL)
  --date-column=last_seen  SQL column on the main ad table (ES uses each network's last_seen field)
  --dbq-parallel=2       ES: max delete-by-query tasks at once per cluster (they share --es-dbq-rps)
  --mode=placeholder     the OLD rule instead (placeholder media + Google organic before --before)
  --mode=no-media        media ads the search never shows (no displayable media) on ${networksFor('no-media').join(',')}
                         (run it as scripts/delete-no-media-ads.js; state folder data/placeholder-media/no-media)
  --keep-sql-patterns=a,b  no-media: keep an ad whose SQL media has one of these. default: ${DEFAULT_KEEP_SQL_PATTERNS.join(',')}
  --run=name             state folder (data/placeholder-media/<run>). default: default
  --restart              forget saved progress and start again
  --recollect            collect the placeholder IDs again even if an ID file exists
  --id-max-age-hours=24  an unstarted / finished ID file older than this is collected again
  --quick                dry run: ES counts + sizes only (no ID collection, no SQL counts)

Connections (ES: ES_TARGET / TIKTOK_ES_TARGET at the top of the script; SQL: config.json)
  --overrides=file.json  same shape as the OVERRIDES block at the top of the script
  --es-node=URL  --es-user=U  --es-pass=P  --es-index=facebook:idx,google:idx
  --tiktok-es-node=URL  --tiktok-es-pass=P  --tiktok-es-index=idx

Elasticsearch load
  --es-batch=500 --es-max-batch=2000 --es-parallel=4 (max bulk requests at once per cluster)
  --es-target-ms=1000 --max-heap=80 --max-cpu=70 --max-write-queue=50
  --scan-slices=4        ID scan: parallel sliced scrolls per big network (>1M docs; 2 for >200k)
  --scan-parallel=8      ID scan: max ES scroll/count requests at once per cluster (all networks
                         together). Starts at 2, grows/shrinks from heap, cpu, search queue, page time
  --max-search-queue=100 --scan-target-ms=3000
  --es-dbq-rps=3000      Google _delete_by_query top speed (docs/s); scaled down under load

SQL load
  --sql-batch=300 --sql-max-batch=2000 --sql-target-ms=1500 --max-threads-running=16
  --exclude-tables=a,b   never delete from these child tables
  --sql-parallel=8       max delete batches at once PER SQL HOST (start 2, adapts to load)
  --sql-shards=16        the id range of a big table is split into this many parts worked in parallel
  --db-vcpus=16 | host:N,host:N   vCPUs of the DB host(s): caps Threads_running at --max-db-cpu % of them
  --max-db-cpu=60        MySQL CPU cap in %. Read live from INNODB_METRICS module_cpu when the DB user has PROCESS
                         and a DBA ran SET GLOBAL innodb_monitor_enable='module_cpu'; else via --db-vcpus / Threads_running
  --max-binlog-growth-gb=100  pause a host's deletes once its binary logs grew this much since the
                         start (deleted rows are written to the binlog — protects the DB disk)
  --no-binlog-minimal    do not ask MySQL for binlog_row_image=MINIMAL on the script's own sessions
  --allow-unindexed      also delete from big child tables WITHOUT an index on the ad column
                         (skipped by default: every batch would scan the whole table)

This machine / restarts
  --max-local-load=0.8 --max-heap-mb=512 --max-restarts=30 --no-supervise --progress-ms=5000
`.trim();
}

function parseArgs(argv) {
  const opts = {
    networks: null, patterns: [...DEFAULT_PATTERNS], sqlPatterns: [...DEFAULT_SQL_PATTERNS], keepSqlPatterns: [...DEFAULT_KEEP_SQL_PATTERNS], only: 'both',
    mode: 'date', apply: false, confirm: '', quick: false, before: '2024-01-01', dateColumn: 'last_seen', dbqParallel: 2,
    run: 'default', restart: false, recollect: false, idMaxAgeHours: 24,
    overridesFile: '', esNode: '', esUser: '', esPass: '', esIndex: {}, tiktokEsNode: '', tiktokEsIndex: '', tiktokEsPass: '',
    scanSlices: 4, scanParallel: 8, maxSearchQueue: 100, scanTargetMs: 3000,
    esBatch: 500, esMaxBatch: 2000, esParallel: 4, esTargetMs: 1000, maxHeap: 80, maxCpu: 70, maxWriteQueue: 50, esDbqRps: 3000,
    sqlBatch: 300, sqlMaxBatch: 2000, sqlTargetMs: 1500, maxThreadsRunning: 16, exclude: [], allowUnindexed: false,
    binlogMinimal: true, maxBinlogGrowthGb: 100, sqlParallel: 8, sqlShards: 16, maxDbCpu: 60, dbVcpus: {},
    maxLocalLoad: 0.8, maxHeapMb: 512, maxRestarts: 30, supervise: true, progressMs: 5000,
    status: false, worker: false, help: false,
  };
  const list = (v) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const int = (v, k, min) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`--${k} must be an integer >= ${min}.`);
    return n;
  };
  const numbers = {
    'id-max-age-hours': ['idMaxAgeHours', 1], 'scan-slices': ['scanSlices', 1], 'scan-parallel': ['scanParallel', 1], 'max-search-queue': ['maxSearchQueue', 0], 'scan-target-ms': ['scanTargetMs', 100], 'es-batch': ['esBatch', 10], 'es-max-batch': ['esMaxBatch', 10],
    'es-parallel': ['esParallel', 1], 'es-target-ms': ['esTargetMs', 100], 'max-heap': ['maxHeap', 1], 'max-cpu': ['maxCpu', 1],
    'max-write-queue': ['maxWriteQueue', 0], 'es-dbq-rps': ['esDbqRps', 100], 'sql-batch': ['sqlBatch', 10], 'sql-max-batch': ['sqlMaxBatch', 10],
    'sql-target-ms': ['sqlTargetMs', 100], 'max-threads-running': ['maxThreadsRunning', 1], 'max-heap-mb': ['maxHeapMb', 128],
    'max-restarts': ['maxRestarts', 0], 'max-binlog-growth-gb': ['maxBinlogGrowthGb', 1], 'sql-parallel': ['sqlParallel', 1], 'sql-shards': ['sqlShards', 1], 'max-db-cpu': ['maxDbCpu', 1], 'progress-ms': ['progressMs', 1000], 'dbq-parallel': ['dbqParallel', 1],
  };
  const flags = {
    quick: 'quick', restart: 'restart', recollect: 'recollect', 'allow-unindexed': 'allowUnindexed',
    status: 'status', worker: 'worker', help: 'help', h: 'help',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (!raw.startsWith('-')) throw new Error(`Unexpected argument: ${raw}`);
    const bare = raw.replace(/^--?/, '');
    const eq = bare.indexOf('=');
    const key = eq === -1 ? bare : bare.slice(0, eq);
    if (flags[key]) { opts[flags[key]] = true; continue; }
    if (key === 'apply') { // --apply | --apply=es | --apply sql
      opts.apply = true;
      if (eq !== -1) opts.only = bare.slice(eq + 1).toLowerCase();
      else if (['es', 'sql', 'both'].includes(String(argv[i + 1]).toLowerCase())) { opts.only = argv[i + 1].toLowerCase(); i += 1; }
      continue;
    }
    if (key === 'no-supervise') { opts.supervise = false; continue; }
    if (key === 'no-binlog-minimal') { opts.binlogMinimal = false; continue; }
    let value;
    if (eq !== -1) value = bare.slice(eq + 1);
    else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`--${key} requires a value.`);
      i += 1;
    }
    if (numbers[key]) opts[numbers[key][0]] = int(value, key, numbers[key][1]);
    else if (key === 'networks') opts.networks = value.toLowerCase() === 'all' ? null : list(value.toLowerCase());
    else if (key === 'only') opts.only = value.toLowerCase();
    else if (key === 'patterns') opts.patterns = list(value);
    else if (key === 'keep-sql-patterns') opts.keepSqlPatterns = list(value);
    else if (key === 'sql-patterns') opts.sqlPatterns = list(value);
    else if (key === 'before') opts.before = value;
    else if (key === 'google-date-column' || key === 'date-column') opts.dateColumn = value;
    else if (key === 'mode') opts.mode = value.toLowerCase();
    else if (key === 'confirm') opts.confirm = value;
    else if (key === 'run') opts.run = value;
    else if (key === 'overrides') opts.overridesFile = value;
    else if (key === 'es-node') opts.esNode = value;
    else if (key === 'es-user') opts.esUser = value;
    else if (key === 'es-pass') opts.esPass = value;
    else if (key === 'es-index') {
      for (const pair of list(value)) {
        const [n, idx] = pair.split(':');
        if (!n || !idx) throw new Error('--es-index expects network:index pairs, e.g. facebook:search_mix,google:google_ads_data');
        opts.esIndex[n.toLowerCase()] = idx;
      }
    } else if (key === 'tiktok-es-node') opts.tiktokEsNode = value;
    else if (key === 'tiktok-es-index') opts.tiktokEsIndex = value;
    else if (key === 'tiktok-es-pass') opts.tiktokEsPass = value;
    else if (key === 'exclude-tables') opts.exclude = list(value);
    else if (key === 'db-vcpus') { // "16" for every host, or "92.4.75.196:16,152.67.3.243:8"
      for (const part of list(value)) {
        const [h, n] = part.includes(':') ? part.split(':') : ['*', part];
        if (!(Number(n) > 0)) throw new Error('--db-vcpus expects N or host:N pairs, e.g. 92.4.75.196:16');
        opts.dbVcpus[h] = Number(n);
      }
    }
    else if (key === 'max-local-load') {
      opts.maxLocalLoad = Number(value);
      if (!(opts.maxLocalLoad > 0)) throw new Error('--max-local-load must be > 0.');
    } else throw new Error(`Unknown option: --${key}`);
  }
  if (!['date', 'placeholder', 'no-media'].includes(opts.mode)) throw new Error('--mode must be date, placeholder or no-media.');
  if (opts.mode === 'no-media' && opts.run === 'default') opts.run = 'no-media'; // never mixes with a date run's state
  const known = networksFor(opts.mode);
  if (!opts.networks) opts.networks = [...known];
  if (opts.help || opts.status) return opts;
  const unknown = opts.networks.filter((n) => !known.includes(n));
  if (unknown.length) throw new Error(`Unknown network(s) for --mode=${opts.mode}: ${unknown.join(', ')}. Known: ${known.join(', ')}`);
  opts.networks = [...new Set(opts.networks)];
  if (!opts.keepSqlPatterns.length) throw new Error('--keep-sql-patterns is empty.');
  if (!['es', 'sql', 'both'].includes(opts.only)) throw new Error('--apply takes es, sql or both (e.g. --apply=es).');
  opts.doEs = opts.only !== 'sql';
  opts.doSql = opts.only !== 'es';
  if (!opts.patterns.length) throw new Error('--patterns is empty.');
  if (!opts.sqlPatterns.length) throw new Error('--sql-patterns is empty.');
  const realPath = opts.sqlPatterns.filter((p) => /^pas(image|video)/i.test(p));
  if (realPath.length) throw new Error(`--sql-patterns must not contain ${realPath.join(', ')}: SQL media columns store real media as pasimages/... paths.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.before) || Number.isNaN(Date.parse(`${opts.before}T00:00:00Z`))) throw new Error('--before must be a date like 2023-01-01.');
  if (!SAFE_IDENT.test(opts.dateColumn)) throw new Error('--date-column must be a plain column name.');
  if (!/^[A-Za-z0-9_.-]+$/.test(opts.run)) throw new Error('--run may only contain letters, digits, _ . -');
  for (const t of opts.exclude) if (!SAFE_IDENT.test(t)) throw new Error(`Bad table name in --exclude-tables: ${t}`);
  opts.esBatch = Math.min(opts.esBatch, opts.esMaxBatch);
  opts.sqlBatch = Math.min(opts.sqlBatch, opts.sqlMaxBatch);
  return opts;
}

// ── connection overrides ────────────────────────────────────────────────────
function readOverrides(opts) {
  const merged = JSON.parse(JSON.stringify(OVERRIDES));
  if (opts.overridesFile) {
    const file = JSON.parse(fs.readFileSync(opts.overridesFile, 'utf8'));
    for (const k of ['es', 'tiktokEs']) if (file[k]) merged[k] = { ...(merged[k] || {}), ...file[k] };
    for (const k of ['esIndex', 'sql']) if (file[k]) merged[k] = { ...(merged[k] || {}), ...file[k] };
  }
  if (opts.esNode || opts.esUser) {
    merged.es = { ...(merged.es || {}) };
    if (opts.esNode) merged.es.node = opts.esNode;
    if (opts.esUser) merged.es.auth = { username: opts.esUser, password: opts.esPass };
  }
  // password only → fill it into the user already set in ES_TARGET / TIKTOK_ES_TARGET
  if (opts.esPass && !opts.esUser && merged.es?.auth) merged.es = { ...merged.es, auth: { ...merged.es.auth, password: opts.esPass } };
  if (opts.tiktokEsPass && merged.tiktokEs?.auth) merged.tiktokEs = { ...merged.tiktokEs, auth: { ...merged.tiktokEs.auth, password: opts.tiktokEsPass } };
  if (Object.keys(opts.esIndex).length) merged.esIndex = { ...(merged.esIndex || {}), ...opts.esIndex };
  if (opts.tiktokEsNode || opts.tiktokEsIndex) {
    merged.tiktokEs = { ...(merged.tiktokEs || {}) };
    if (opts.tiktokEsNode) merged.tiktokEs.node = opts.tiktokEsNode;
    if (opts.tiktokEsIndex) merged.tiktokEs.index = opts.tiktokEsIndex;
  }
  // no-media: an ES_TARGET left without a password (and no --es-* flag) means "use config.json"
  if (opts.mode === 'no-media' && !opts.esNode && !opts.esPass && merged.es?.auth?.username && !merged.es.auth.password) delete merged.es;
  // TikTok's ES is only needed when tiktok is one of the networks
  if (!(opts.networks || []).some((n) => NETWORKS[n]?.tiktok) && !opts.tiktokEsNode && !opts.tiktokEsPass) delete merged.tiktokEs;
  for (const k of ['es', 'tiktokEs']) {
    const a = merged[k]?.auth;
    if (a?.username && !a.password) {
      throw Object.assign(new Error(`ES override "${k}" (${merged[k].node}) has user "${a.username}" but no password — set it in ${k === 'es' ? 'ES_TARGET' : 'TIKTOK_ES_TARGET'} at the top of the script, or pass ${k === 'es' ? '--es-pass' : '--tiktok-es-pass'}=...`), { fatal: true });
    }
  }
  return merged;
}

/** One network's { elastic, sql } config: config.json values with the overrides on top. */
function applyOverrides(network, base, overrides) {
  const spec = NETWORKS[network];
  const esBase = spec.tiktok ? base?.elastic_tiktok : base?.elastic;
  const esOver = spec.tiktok ? overrides.tiktokEs : overrides.es;
  const elastic = { ...(esBase || {}), ...(esOver || {}), enabled: true };
  if (!spec.tiktok && overrides.esIndex?.[network]) elastic.index = overrides.esIndex[network];
  const sqlOver = overrides.sql?.[network];
  const sql = spec.mainTable ? { poolSize: 4, ...(base?.sql || {}), ...(sqlOver || {}), enabled: true } : null;
  return {
    elastic,
    sql,
    overridden: { es: Boolean(esOver || (!spec.tiktok && overrides.esIndex?.[network])), sql: Boolean(sqlOver) },
  };
}

// ── errors: wait-and-retry vs. fail ─────────────────────────────────────────
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST', 'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS',
  'ER_SERVER_SHUTDOWN', 'ER_QUERY_INTERRUPTED', 'POOL_CLOSED',
]);
function isTransient(err) {
  if (!err) return false;
  if (TRANSIENT_CODES.has(err.code)) return true;
  const status = err.meta?.statusCode ?? err.statusCode;
  if ([408, 429, 502, 503, 504].includes(status)) return true;
  const name = err.name || '';
  if (['ConnectionError', 'TimeoutError', 'NoLivingConnectionsError', 'RequestAbortedError'].includes(name)) return true;
  return /es_rejected_execution|circuit_breaking|too many requests|connection.*(lost|closed|refused)|socket hang up|read ECONNRESET|cluster.*red/i.test(err.message || '');
}

let stopping = false;

/** Runs fn; on a transient error waits (15s → 2m) and tries again until it works or the run stops. */
async function withRetry(fn, onWait) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransient(err) || stopping) throw err;
      const wait = Math.min(120000, 15000 * 2 ** Math.min(attempt, 3));
      onWait?.(`waiting ${fmtDuration(wait)}: ${String(err.message || err.code).slice(0, 60)}`);
      await sleepUnlessStopping(wait);
      if (stopping) throw err;
    }
  }
}

async function sleepUnlessStopping(ms) {
  const end = Date.now() + ms;
  while (!stopping && Date.now() < end) await sleep(Math.min(1000, end - Date.now()));
}

// ── adaptive control ────────────────────────────────────────────────────────
/** Counting semaphore whose size can change while running (FIFO). */
class Semaphore {
  constructor(capacity) { this.capacity = capacity; this.active = 0; this.queue = []; }

  acquire() {
    if (this.active < this.capacity) { this.active += 1; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.active -= 1;
    this.drain();
  }

  setCapacity(n) { this.capacity = n; this.drain(); }

  drain() {
    while (this.active < this.capacity && this.queue.length) { this.active += 1; this.queue.shift()(); }
  }
}

/**
 * One per ES cluster. Decides how many bulk requests may run at once (= how many networks
 * delete in parallel), the bulk size and the _delete_by_query speed, from node load + latency.
 */
class EsController {
  constructor(client, opts) {
    this.client = client;
    this.opts = opts;
    this.sem = new Semaphore(1);
    this.batch = opts.esBatch;
    this.latencies = [];
    this.load = null;
    this.loadReadable = true;
    this.lastRejected = null;
    this.state = 'starting';
    this.pausedUntil = 0;
  }

  recordLatency(ms) {
    this.latencies.push(ms);
    if (this.latencies.length > 20) this.latencies.shift();
  }

  avgLatency() {
    return this.latencies.length ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0;
  }

  /** _delete_by_query docs/s for the current load: share of --es-dbq-rps, ~nothing while paused. */
  dbqRps() {
    if (Date.now() < this.pausedUntil) return 50;
    return Math.max(100, Math.round((this.opts.esDbqRps * this.sem.capacity) / this.opts.esParallel));
  }

  async readLoad() {
    if (!this.loadReadable) return null;
    try {
      const health = unwrap(await this.client.cluster.health({}, { requestTimeout: 10000 }));
      const stats = unwrap(await this.client.nodes.stats({ metric: 'jvm,os,process,thread_pool' }, { requestTimeout: 10000 }));
      let heap = 0; let cpu = 0; let writeQueue = 0; let rejected = 0; let searchQueue = 0; let searchRejected = 0;
      for (const n of Object.values(stats.nodes || {})) {
        heap = Math.max(heap, n.jvm?.mem?.heap_used_percent ?? 0);
        cpu = Math.max(cpu, n.os?.cpu?.percent ?? n.process?.cpu?.percent ?? 0);
        const wp = n.thread_pool?.write || n.thread_pool?.bulk || {};
        writeQueue = Math.max(writeQueue, wp.queue ?? 0);
        rejected += wp.rejected ?? 0;
        searchQueue = Math.max(searchQueue, n.thread_pool?.search?.queue ?? 0);
        searchRejected += n.thread_pool?.search?.rejected ?? 0;
      }
      const newRejections = this.lastRejected === null ? 0 : Math.max(0, rejected - this.lastRejected);
      const newSearchRejections = this.lastSearchRejected == null ? 0 : Math.max(0, searchRejected - this.lastSearchRejected);
      this.lastRejected = rejected;
      this.lastSearchRejected = searchRejected;
      return { status: health.status, heap, cpu, writeQueue, newRejections, searchQueue, newSearchRejections };
    } catch (err) {
      if (isTransient(err)) return { status: 'unreachable', heap: 0, cpu: 0, writeQueue: 0, newRejections: 0, searchQueue: 0, newSearchRejections: 0 };
      this.loadReadable = false; // e.g. no monitor privilege: fall back to latency-only control
      return null;
    }
  }

  /** Pure decision step (tested): returns { capacity, batch, pauseMs, reasons }. */
  static decide({ capacity, batch, load, avgLatency, opts }) {
    const reasons = [];
    if (load) {
      if (load.status === 'red' || load.status === 'unreachable') reasons.push(`cluster ${load.status}`);
      if (load.heap > opts.maxHeap) reasons.push(`heap ${load.heap}%`);
      if (load.cpu > opts.maxCpu) reasons.push(`cpu ${load.cpu}%`);
      if (load.writeQueue > opts.maxWriteQueue) reasons.push(`write queue ${load.writeQueue}`);
      if (load.newRejections > 0) reasons.push(`${load.newRejections} write rejections`);
    }
    if (reasons.length) {
      return { capacity: Math.max(1, Math.floor(capacity / 2)), batch: Math.max(50, Math.floor(batch * 0.6)), pauseMs: 30000, reasons };
    }
    if (avgLatency > opts.esTargetMs * 2) {
      return { capacity: Math.max(1, capacity - 1), batch: Math.max(50, Math.floor(batch * 0.7)), pauseMs: 0, reasons: [`slow bulks ${Math.round(avgLatency)}ms`] };
    }
    const headroom = !load || (load.heap < opts.maxHeap - 10 && load.cpu < opts.maxCpu - 15 && load.writeQueue <= opts.maxWriteQueue / 2);
    // No bulk traffic yet (e.g. only a _delete_by_query runs): headroom alone may raise the level.
    if (headroom && (!avgLatency || avgLatency < opts.esTargetMs * 0.6)) {
      if (batch < opts.esMaxBatch) return { capacity, batch: Math.min(opts.esMaxBatch, Math.ceil(batch * 1.25)), pauseMs: 0, reasons };
      return { capacity: Math.min(opts.esParallel, capacity + 1), batch, pauseMs: 0, reasons };
    }
    return { capacity, batch, pauseMs: 0, reasons };
  }

  async tick() {
    this.load = await this.readLoad();
    const before = { capacity: this.sem.capacity, state: this.state };
    const d = EsController.decide({ capacity: this.sem.capacity, batch: this.batch, load: this.load, avgLatency: this.avgLatency(), opts: this.opts });
    this.batch = d.batch;
    this.sem.setCapacity(d.capacity);
    if (d.pauseMs) this.pausedUntil = Date.now() + d.pauseMs;
    this.state = d.reasons.length ? `${d.pauseMs ? 'paused' : 'slowing'}: ${d.reasons.join(', ')}` : 'ok';
    const first = before.state === 'starting' && before.capacity === d.capacity && this.state === 'ok';
    if (this.onDecision && !first && (before.capacity !== d.capacity || before.state.split(':')[0] !== this.state.split(':')[0])) {
      const why = d.reasons.length ? d.reasons.join(', ') : 'load has headroom';
      this.onDecision(`ES delete: parallel bulks ${before.capacity} → ${d.capacity}, batch ${d.batch}${d.pauseMs ? ', pause 30s' : ''} — ${why} (${describeLoad(this.load, this.avgLatency(), 'bulk')})`);
    }
  }

  async gate() {
    while (!stopping && Date.now() < this.pausedUntil) await sleep(1000);
  }
}

function describeLoad(load, avgMs, what) {
  if (!load) return `load not readable, avg ${what} ${Math.round(avgMs)}ms`;
  return `status ${load.status}, heap ${load.heap}%, cpu ${load.cpu}%, search queue ${load.searchQueue ?? '-'}, write queue ${load.writeQueue}, avg ${what} ${Math.round(avgMs)}ms`;
}

/**
 * One per ES cluster for the ID scans (all networks share it): how many scroll/count requests may
 * run at once. Starts low, adds a slot while the cluster has headroom, halves + pauses on pressure.
 * Every change is reported through onDecision with the reason.
 */
class ScanGovernor {
  constructor(client, opts, name, onDecision) {
    this.opts = opts;
    this.name = name;
    this.onDecision = onDecision;
    this.reader = new EsController(client, opts); // reuses readLoad()
    this.sem = new Semaphore(Math.min(2, opts.scanParallel));
    this.latencies = [];
    this.load = null;
    this.state = 'starting';
    this.pausedUntil = 0;
  }

  recordLatency(ms) { this.latencies.push(ms); if (this.latencies.length > 30) this.latencies.shift(); }

  avgLatency() { return this.latencies.length ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0; }

  /** Pure decision step: { capacity, pauseMs, reasons, grow }. */
  static decide({ capacity, load, avgLatency, waiting, opts }) {
    const reasons = [];
    if (load) {
      if (load.status === 'red' || load.status === 'unreachable') reasons.push(`cluster ${load.status}`);
      if (load.heap > opts.maxHeap) reasons.push(`heap ${load.heap}% > ${opts.maxHeap}%`);
      if (load.cpu > opts.maxCpu) reasons.push(`cpu ${load.cpu}% > ${opts.maxCpu}%`);
      if (load.searchQueue > opts.maxSearchQueue) reasons.push(`search queue ${load.searchQueue} > ${opts.maxSearchQueue}`);
      if (load.newSearchRejections > 0) reasons.push(`${load.newSearchRejections} search rejections`);
    }
    if (reasons.length) return { capacity: Math.max(1, Math.floor(capacity / 2)), pauseMs: 20000, reasons };
    if (avgLatency > opts.scanTargetMs * 2) return { capacity: Math.max(1, capacity - 1), pauseMs: 0, reasons: [`slow scroll pages ${Math.round(avgLatency)}ms > ${opts.scanTargetMs * 2}ms`] };
    const headroom = !load || (load.heap < opts.maxHeap - 10 && load.cpu < opts.maxCpu - 15 && load.searchQueue <= opts.maxSearchQueue / 4);
    if (headroom && waiting > 0 && capacity < opts.scanParallel && (!avgLatency || avgLatency < opts.scanTargetMs)) {
      return { capacity: capacity + 1, pauseMs: 0, reasons: [], grow: true };
    }
    return { capacity, pauseMs: 0, reasons: [] };
  }

  async tick() {
    this.load = await this.reader.readLoad();
    const before = this.sem.capacity;
    const d = ScanGovernor.decide({ capacity: before, load: this.load, avgLatency: this.avgLatency(), waiting: this.sem.queue.length, opts: this.opts });
    this.sem.setCapacity(d.capacity);
    if (d.pauseMs) this.pausedUntil = Date.now() + d.pauseMs;
    const prevState = this.state;
    this.state = d.reasons.length ? `${d.pauseMs ? 'paused' : 'slowing'}: ${d.reasons.join(', ')}` : 'ok';
    const first = prevState === 'starting' && before === d.capacity && this.state === 'ok';
    if (!first && (before !== d.capacity || prevState.split(':')[0] !== this.state.split(':')[0])) {
      const why = d.reasons.length ? d.reasons.join(', ') : (d.grow ? `headroom and ${this.sem.queue.length} requests waiting` : 'back to normal');
      this.onDecision?.(`ES ${this.name}: scan slots ${before} → ${d.capacity}${d.pauseMs ? ', pause 20s' : ''} — ${why} (${describeLoad(this.load, this.avgLatency(), 'page')})`);
    }
  }

  async gate() { while (!stopping && Date.now() < this.pausedUntil) await sleep(1000); }

  /** Runs one ES request inside the gate + a slot, recording its latency. */
  async run(fn) {
    await this.gate();
    await this.sem.acquire();
    const t0 = Date.now();
    try { return await fn(); } finally { this.recordLatency(Date.now() - t0); this.sem.release(); }
  }
}

/** SQL batch size: grows while batches are fast, shrinks + pauses when slow or the host is busy. */
class Throttle {
  constructor({ initial = 300, min = 50, max = 2000, targetMs = 1500 } = {}) {
    Object.assign(this, { size: initial, min, max, targetMs, pauseMs: 100 });
  }

  next(durationMs, hostBusy) {
    if (hostBusy) {
      this.size = Math.max(this.min, Math.floor(this.size / 2));
      this.pauseMs = 3000;
    } else if (durationMs > this.targetMs * 1.5) {
      this.size = Math.max(this.min, Math.floor(this.size * 0.6));
      this.pauseMs = 500;
    } else if (durationMs < this.targetMs * 0.6) {
      this.size = Math.min(this.max, Math.ceil(this.size * 1.4));
      this.pauseMs = 100;
    } else {
      this.pauseMs = 150;
    }
    return this;
  }
}

/** One per SQL host: Threads_running, sampled at most every 3 s. */
/**
 * MySQL's own CPU use from information_schema.INNODB_METRICS (module_cpu): cpu_utime_abs + cpu_stime_abs
 * between two samples, divided by wall time and cpu_n = % of the whole machine used by mysqld.
 * Needs the PROCESS privilege and `SET GLOBAL innodb_monitor_enable = 'module_cpu'` (one time, by a DBA).
 * The counters' unit (ms or µs) is detected from the ratio to wall time.
 */
function cpuPercent(prev, cur) {
  if (!prev || !cur || !cur.n) return null;
  const wallMs = cur.at - prev.at;
  const used = (cur.u + cur.s) - (prev.u + prev.s);
  if (wallMs <= 0 || used < 0) return null;
  let perMs = used / wallMs; // CPU units used per wall millisecond
  if (perMs > cur.n * 1.5) perMs /= 1000; // counters are in microseconds
  return Math.max(0, Math.min(100, (perMs / cur.n) * 100));
}

class HostMonitor {
  constructor(sql, limit, maxBinlogGrowthGb = 0, cpuLimit = 0) {
    Object.assign(this, { sql, limit, threadsRunning: null, at: 0, binlogLimit: maxBinlogGrowthGb * 1073741824, binlogStart: null, binlogNow: null, binlogAt: 0, reason: '',
      cpuLimit, cpu: null, cpuN: null, cpuSample: null, cpuAt: 0, cpuMode: cpuLimit ? 'unknown' : 'off' });
  }

  /** Reads MySQL CPU % every 10 s (null until two samples, or when the metric is not available). */
  async readCpu() {
    if (this.cpuMode === 'off' || this.cpuMode === 'unavailable' || Date.now() - this.cpuAt < 10000) return;
    this.cpuAt = Date.now();
    try {
      const rows = await q(this.sql, "SELECT NAME AS n, COUNT AS c, STATUS AS st FROM information_schema.INNODB_METRICS WHERE NAME IN ('cpu_utime_abs','cpu_stime_abs','cpu_n')");
      const by = Object.fromEntries(rows.map((r) => [r.n || r.NAME, r]));
      const on = rows.length === 3 && rows.every((r) => String(r.st || r.STATUS).toLowerCase() === 'enabled');
      if (!on) {
        this.cpuMode = 'unavailable';
        this.onDecision?.(`SQL ${this.name}: MySQL CPU % not readable (module_cpu not enabled) — speed follows Threads_running + batch time instead`);
        return;
      }
      const cur = { at: Date.now(), u: Number(by.cpu_utime_abs.c ?? by.cpu_utime_abs.COUNT), s: Number(by.cpu_stime_abs.c ?? by.cpu_stime_abs.COUNT), n: Number(by.cpu_n.c ?? by.cpu_n.COUNT) };
      this.cpuN = cur.n;
      const pctNow = cpuPercent(this.cpuSample, cur);
      if (pctNow != null) {
        if (this.cpuMode !== 'on') this.onDecision?.(`SQL ${this.name}: reading MySQL CPU % (${cur.n} vCPUs) — deletes keep the host under ${this.cpuLimit}%`);
        this.cpuMode = 'on';
        this.cpu = pctNow;
      }
      this.cpuSample = cur;
    } catch (e) {
      this.cpuMode = 'unavailable';
      this.onDecision?.(`SQL ${this.name}: MySQL CPU % not readable (${e.code || e.message}; needs PROCESS privilege) — speed follows Threads_running + batch time instead`);
    }
  }

  binlogGrowth() { return this.binlogStart == null || this.binlogNow == null ? 0 : Math.max(0, this.binlogNow - this.binlogStart); }

  async busy() {
    if (Date.now() - this.at > 3000) {
      this.at = Date.now();
      try {
        const r = await q(this.sql, "SHOW GLOBAL STATUS LIKE 'Threads_running'");
        this.threadsRunning = Number(r[0]?.Value ?? r[0]?.value ?? 0);
      } catch { /* keep last value */ }
    }
    if (this.binlogLimit && Date.now() - this.binlogAt > 60000) {
      this.binlogAt = Date.now();
      const b = await binlogBytes(this.sql);
      if (b != null) { this.binlogNow = b; if (this.binlogStart == null) this.binlogStart = b; }
    }
    await this.readCpu();
    const reasons = [];
    if (this.cpu != null && this.cpu > this.cpuLimit) reasons.push(`MySQL CPU ${Math.round(this.cpu)}% > ${this.cpuLimit}%`);
    if (this.threadsRunning !== null && this.threadsRunning > this.limit) reasons.push(`Threads_running ${this.threadsRunning} > ${this.limit} (production load)`);
    if (this.binlogLimit && this.binlogGrowth() > this.binlogLimit) {
      reasons.push(`binlog grew ${fmtBytes(this.binlogGrowth())} since start > --max-binlog-growth-gb=${this.binlogLimit / 1073741824} — waiting for binlog expiry/PURGE BINARY LOGS (or raise the limit if the disk has room)`);
    }
    const busy = reasons.length > 0;
    const reason = reasons.join('; ');
    if (this.onDecision && (busy !== Boolean(this.wasBusy) || (busy && reason.split(' ')[0] !== this.reason.split(' ')[0]))) {
      this.onDecision(busy ? `SQL ${this.name}: pausing deletes — ${reason}` : `SQL ${this.name}: resuming — ${this.cpu != null ? `MySQL CPU ${Math.round(this.cpu)}%, ` : ''}Threads_running ${this.threadsRunning} ≤ ${this.limit}${this.binlogLimit ? `, binlog growth ${fmtBytes(this.binlogGrowth())}` : ''}`);
    }
    this.wasBusy = busy;
    this.reason = reason;
    return busy;
  }
}

/** This machine: pause while the load average per CPU is above the limit (no-op on Windows). */
function localBusy(maxLoad) {
  const cpus = os.cpus().length || 1;
  return os.loadavg()[0] / cpus > maxLoad;
}

async function waitLocal(opts, setState) {
  while (!stopping && localBusy(opts.maxLocalLoad)) {
    setState?.(`paused: this machine busy (load ${os.loadavg()[0].toFixed(1)})`);
    await sleep(5000);
  }
}

/** Units/s over the last 2 minutes. */
class RateMeter {
  constructor() { this.samples = []; }

  add(done) {
    const now = Date.now();
    this.samples.push([now, done]);
    while (this.samples.length > 2 && now - this.samples[0][0] > 120000) this.samples.shift();
  }

  rate() {
    if (this.samples.length < 2) return 0;
    const [t0, d0] = this.samples[0];
    const [t1, d1] = this.samples[this.samples.length - 1];
    return t1 > t0 ? ((d1 - d0) * 1000) / (t1 - t0) : 0;
  }
}

// ── state (resumable) ───────────────────────────────────────────────────────
function runDir(opts) {
  const d = path.resolve(process.cwd(), 'data', 'placeholder-media', opts.run);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function freshState(target) {
  return {
    target,
    // placeholder networks: ID file
    collected: false, collectedAt: null, total: 0, uniqueAds: 0, fromEs: 0, fromSql: 0,
    // ES lane (offset = byte offset in the ID file; google: _delete_by_query task)
    es: { offset: 0, done: 0, deleted: 0, notFound: 0, finished: false, rate: null, taskId: null, prevDeleted: 0, taskTotal: 0 },
    // SQL lane (offset = byte offset; google: cursor/hi over google_text_ad.id)
    sql: { offset: 0, done: 0, ads: 0, rows: 0, kept: 0, noSqlId: 0, cursor: 0, hi: 0, estAds: 0, finished: false, rate: null },
    failures: 0, lastError: null,
  };
}

function loadState(dir, network, target, restart) {
  const f = path.join(dir, `${network}.state.json`);
  if (restart || !fs.existsSync(f)) return freshState(target);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  const untouched = !s.es?.offset && !s.sql?.offset && !s.es?.taskId && !s.sql?.cursor && !s.es?.deleted && !s.sql?.ads;
  if (JSON.stringify(s.target) !== JSON.stringify(target) && untouched) {
    // nothing deleted yet: an ID file collected with other rules is simply collected again
    for (const x of [`${network}.ids.jsonl`, `${network}.ids.jsonl.tmp`]) fs.rmSync(path.join(dir, x), { force: true });
    return freshState(target);
  }
  if (JSON.stringify(s.target) !== JSON.stringify(target)) {
    throw Object.assign(new Error(`${network}: saved progress in ${f} is for a different target/patterns/date `
      + `(${JSON.stringify(s.target)}). Use --restart, or a different --run name.`), { fatal: true });
  }
  return s;
}

function saveState(dir, network, state) {
  const f = path.join(dir, `${network}.state.json`);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(`${f}.tmp`, f); // atomic: a crash never leaves a half-written state
}

/**
 * Reads up to maxLines JSONL records starting at byte `offset`. Returns the records
 * and the byte offset after the last one — only one batch is ever held in memory.
 */
function readChunk(file, offset, maxLines) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(256 * 1024);
  const records = [];
  let pos = offset;
  let next = offset;
  let pending = [];
  try {
    while (records.length < maxLines) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (!n) break;
      let start = 0;
      for (let i = 0; i < n && records.length < maxLines; i += 1) {
        if (buf[i] !== 10) continue;
        pending.push(buf.subarray(start, i));
        const line = Buffer.concat(pending).toString('utf8').trim();
        pending = [];
        start = i + 1;
        next = pos + i + 1;
        if (line) records.push(JSON.parse(line));
      }
      if (records.length >= maxLines) break;
      pending.push(Buffer.from(buf.subarray(start, n))); // copy: buf is reused
      pos += n;
    }
  } finally {
    fs.closeSync(fd);
  }
  return { records, next };
}

// ── Elasticsearch: placeholder ──────────────────────────────────────────────
const baseField = (f) => f.replace(/\.keyword$/, '');

function buildQuery(spec, patterns) {
  const should = [];
  for (const field of spec.mediaFields) for (const p of patterns) should.push({ wildcard: { [field]: { value: `*${p}*` } } });
  return { bool: { should, minimum_should_match: 1 } };
}

/** ES docs with none of the network's media fields (their media may live only in SQL). */
function missingMediaQuery(spec) {
  return { bool: { must_not: spec.mediaFields.map((f) => ({ exists: { field: baseField(f) } })) } };
}

/** Same test as the ES wildcard query, in JS: is any media field a placeholder? */
function isPlaceholderDoc(source, spec, patterns) {
  const hit = (v) => {
    if (typeof v === 'string') return patterns.some((p) => v.includes(p));
    if (Array.isArray(v)) return v.some(hit);
    if (v && typeof v === 'object') return Object.values(v).some(hit);
    return false;
  };
  return spec.mediaFields.some((f) => hit(getPath(source, baseField(f))));
}

/**
 * Does this doc show real media (a media field that is set and not a placeholder)?
 * Production (2026-11-05): many docs have a real NAS image in new_nas_image_url while an old
 * field (instagram thumbnail, linkedin ad_video, one othermedia entry) still says pasimages/... or
 * /DefaultImage.jpg — those ads render fine and are NOT deleted.
 */
function hasRealMedia(source, spec, patterns) {
  const real = (v) => {
    if (typeof v === 'string') return v.trim() !== '' && !patterns.some((p) => v.includes(p));
    if (Array.isArray(v)) return v.some(real);
    if (v && typeof v === 'object') return Object.values(v).some(real);
    return false;
  };
  return (spec.realFields || spec.mediaFields).some((f) => real(getPath(source, baseField(f))));
}

async function esCount(elastic, query) {
  const res = unwrap(await elastic.client.count({ index: elastic.indexName, body: { query } }, { requestTimeout: 300000 }));
  return Number(res?.count || 0);
}

/** Average primary-store bytes per doc of the index (for the size estimate). */
async function esBytesPerDoc(elastic) {
  const s = unwrap(await elastic.client.indices.stats({ index: elastic.indexName, metric: 'store,docs' }));
  const p = s?._all?.primaries || {};
  const docs = Number(p.docs?.count || 0);
  return docs ? Number(p.store?.size_in_bytes || 0) / docs : 0;
}

/** Slices for a scan of `total` docs: big scans are split into parallel sliced scrolls. */
function scanSlices(total, max) {
  if (total >= 1000000) return max;
  if (total >= 200000) return Math.min(2, max);
  return 1;
}

/**
 * Scrolls `query` (ids only), calling onPage(hits) per page. With slices > 1 it runs that many
 * sliced scrolls at once. Every ES request waits for the cluster gate (paused on high heap/CPU)
 * and holds one slot of the cluster's scan semaphore, so all networks together stay bounded.
 */
async function scrollIds(elastic, spec, query, onPage, { slices = 1, gov = null, source = null } = {}) {
  const call = async (fn) => unwrap(await (gov ? gov.run(fn) : fn()));
  const one = async (slice) => {
    let res = await call(() => elastic.client.search({
      index: elastic.indexName, scroll: '10m', size: 2000,
      body: { query, sort: ['_doc'], _source: source || [spec.idField], ...(slice ? { slice } : {}) },
    }, { requestTimeout: 300000 }));
    let scrollId = res?._scroll_id;
    try {
      while (res?.hits?.hits?.length && !stopping) {
        await onPage(res.hits.hits);
        res = await call(() => elastic.client.scroll({ scroll_id: scrollId, scroll: '10m' }, { requestTimeout: 300000 }));
        scrollId = res?._scroll_id;
      }
    } finally {
      if (scrollId) await elastic.client.clearScroll({ scroll_id: scrollId }).catch(() => {});
    }
  };
  if (slices <= 1) return one(null);
  await Promise.all(Array.from({ length: slices }, (_, id) => one({ id, max: slices })));
}

/**
 * Placeholder IDs → <network>.ids.jsonl (written to .tmp, renamed when complete):
 *   src "es"  — an ES media field is a placeholder;
 *   src "sql" — the ES doc has no media fields and the ad's SQL media is a placeholder.
 */
async function collectPlaceholderIds(job, opts, onProgress) {
  if (opts.mode === 'no-media') return collectNoMediaIds(job, opts, onProgress);
  const { elastic, spec } = job;
  const tmp = `${job.idsFile}.tmp`;
  const out = fs.createWriteStream(tmp);
  const ads = new Set();
  const counts = { total: 0, fromEs: 0, fromSql: 0, keptReal: 0 };
  const checkSql = Boolean(job.sqlRead && job.mediaPlan?.length);
  // totals for progress / ETA (the dry run has counted them already)
  const gov = job.scanGov || null;
  const count = (query) => withRetry(() => (gov ? gov.run(() => esCount(elastic, query)) : esCount(elastic, query)));
  if (!job.counts) {
    job.counts = {
      esHits: await count(buildQuery(spec, opts.patterns)),
      noMedia: checkSql ? await count(missingMediaQuery(spec)) : 0,
    };
  }
  const p = { phase: 'ES media scan', scanned: 0, total: job.counts.esHits + (checkSql ? job.counts.noMedia : 0), found: 0, fromEs: 0, fromSql: 0, ads: 0 };
  const report = () => onProgress?.({ ...p });
  const write = async (hits, src) => {
    let chunk = '';
    for (const h of hits) {
      const adId = getPath(h._source, spec.idField) ?? null;
      chunk += `${JSON.stringify({ _id: h._id, _index: h._index, _type: h._type, ad_id: adId, src })}\n`;
      if (adId != null) ads.add(String(adId));
    }
    counts.total += hits.length;
    counts[src === 'es' ? 'fromEs' : 'fromSql'] += hits.length;
    p.found = counts.total; p.fromEs = counts.fromEs; p.fromSql = counts.fromSql; p.ads = ads.size;
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
  };
  const scan = { gov };
  let hostWasBusy = false;
  const waitHost = async () => { // the SQL check shares the host with production: back off while it is busy
    const mon = job.hostMon;
    if (!mon) return;
    while (!stopping && await mon.busy()) {
      if (!hostWasBusy) { hostWasBusy = true; job.onDecision?.(`SQL ${job.host}: ${job.network} media check paused — Threads_running ${mon.threadsRunning} > ${mon.limit}`); }
      p.phase = `SQL check paused (host busy)`;
      report();
      await sleep(3000);
    }
    if (hostWasBusy) { hostWasBusy = false; p.phase = 'SQL media check'; job.onDecision?.(`SQL ${job.host}: ${job.network} media check resumed — Threads_running ${mon.threadsRunning} ≤ ${mon.limit}`); }
  };
  try {
    report();
    const mediaSource = [...new Set([spec.idField, ...spec.mediaFields.map(baseField), ...(spec.realFields || [])])];
    await scrollIds(elastic, spec, buildQuery(spec, opts.patterns), async (hits) => {
      p.scanned += hits.length;
      // a placeholder in one field is not enough: the ad is deleted only when NO media field is real
      const del = hits.filter((h) => !hasRealMedia(h._source || {}, spec, opts.patterns));
      counts.keptReal += hits.length - del.length;
      p.keptReal = counts.keptReal;
      if (del.length) await write(del, 'es');
      report();
    }, { ...scan, slices: scanSlices(job.counts.esHits, opts.scanSlices), source: mediaSource });
    if (!stopping && checkSql) {
      p.phase = 'SQL media check';
      report();
      await scrollIds(elastic, spec, missingMediaQuery(spec), async (hits) => {
        const ids = hits.map((h) => Number(getPath(h._source, spec.idField))).filter((id) => Number.isSafeInteger(id) && id > 0);
        await waitHost();
        const bad = ids.length ? await withRetry(() => sqlPlaceholderAds(job.sqlRead, job.mediaPlan, opts.sqlPatterns, ids)) : new Set();
        const matched = hits.filter((h) => bad.has(Number(getPath(h._source, spec.idField))));
        if (matched.length) await write(matched, 'sql');
        p.scanned += hits.length;
        report();
      }, { ...scan, slices: scanSlices(job.counts.noMedia, opts.scanSlices) });
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (stopping) { fs.rmSync(tmp, { force: true }); return null; }
  fs.renameSync(tmp, job.idsFile);
  return { ...counts, uniqueAds: ads.size };
}

/**
 * --mode=no-media IDs → <network>.ids.jsonl: every ES doc matching noMediaQuery, EXCEPT ads whose
 * SQL media column holds a NAS path (--keep-sql-patterns) — those are written to
 * <network>.kept-sql-media.jsonl instead (image exists, only the ES doc lacks it). One sliced scroll;
 * the SQL check is one indexed IN (...) lookup per page, paused while the SQL host is busy.
 */
async function collectNoMediaIds(job, opts, onProgress) {
  const { elastic, spec, network } = job;
  const tmp = `${job.idsFile}.tmp`;
  const keptFile = path.join(job.dir, `${network}.kept-sql-media.jsonl`);
  const out = fs.createWriteStream(tmp);
  const kept = fs.createWriteStream(keptFile); // rewritten with the ID file
  const ads = new Set();
  const counts = { total: 0, fromEs: 0, fromSql: 0, keptReal: 0 };
  const gov = job.scanGov || null;
  const query = noMediaQuery(network);
  if (!job.counts) job.counts = { esHits: await withRetry(() => (gov ? gov.run(() => esCount(elastic, query)) : esCount(elastic, query))), noMedia: 0 };
  const p = { phase: 'ES scan (no displayable media)', scanned: 0, total: job.counts.esHits, found: 0, fromEs: 0, fromSql: 0, ads: 0, keptReal: 0 };
  const report = () => onProgress?.({ ...p });
  const checkSql = Boolean(job.sqlRead && job.mediaPlan?.length);
  const write = async (stream, text) => { if (text && !stream.write(text)) await new Promise((r) => stream.once('drain', r)); };
  const waitHost = async () => {
    const mon = job.hostMon;
    if (!mon) return;
    let paused = false;
    while (!stopping && await mon.busy()) {
      if (!paused) { paused = true; job.onDecision?.(`SQL ${job.host}: ${network} SQL media check paused — Threads_running ${mon.threadsRunning} > ${mon.limit}`); }
      p.phase = 'SQL check paused (host busy)';
      report();
      await sleep(3000);
    }
    if (paused) { p.phase = 'ES scan (no displayable media)'; job.onDecision?.(`SQL ${job.host}: ${network} SQL media check resumed`); }
  };
  try {
    report();
    await scrollIds(elastic, spec, query, async (hits) => {
      p.scanned += hits.length;
      const ids = [...new Set(hits.map((h) => Number(getPath(h._source, spec.idField))).filter((id) => Number.isSafeInteger(id) && id > 0))];
      let keep = new Set();
      if (checkSql && ids.length) {
        await waitHost();
        keep = await withRetry(() => sqlPlaceholderAds(job.sqlRead, job.mediaPlan, opts.keepSqlPatterns, ids));
      }
      let chunk = '';
      let keptChunk = '';
      for (const h of hits) {
        const adId = getPath(h._source, spec.idField) ?? null;
        if (adId != null && keep.has(Number(adId))) {
          keptChunk += `${JSON.stringify({ _id: h._id, ad_id: adId, reason: 'SQL media has a NAS path' })}\n`;
          counts.keptReal += 1;
          continue;
        }
        chunk += `${JSON.stringify({ _id: h._id, _index: h._index, _type: h._type, ad_id: adId, src: 'es' })}\n`;
        if (adId != null) ads.add(String(adId));
        counts.total += 1;
        counts.fromEs += 1;
      }
      await write(kept, keptChunk);
      await write(out, chunk);
      Object.assign(p, { found: counts.total, fromEs: counts.fromEs, ads: ads.size, keptReal: counts.keptReal });
      report();
    }, { gov, slices: scanSlices(job.counts.esHits, opts.scanSlices) });
  } finally {
    await new Promise((r) => out.end(r));
    await new Promise((r) => kept.end(r));
  }
  if (stopping) { fs.rmSync(tmp, { force: true }); return null; }
  fs.renameSync(tmp, job.idsFile);
  return { ...counts, uniqueAds: ads.size };
}

/**
 * --mode=no-media SQL fail-safe: of these SQL ad ids, the ones that still have an ES doc the search
 * SHOWS (passes the gate) — e.g. one variant doc without media, another with. Those stay in SQL.
 * Unsure (too many docs to read) → keep.
 */
async function adsVisibleInEs(elastic, network, spec, ids) {
  const keep = new Set();
  const visible = visibleQuery(network);
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const res = unwrap(await elastic.client.search({
      index: elastic.indexName,
      body: { size: 10000, _source: [spec.idField], query: { bool: { filter: [{ terms: { [spec.idField]: part } }, visible] } } },
    }, { requestTimeout: 120000 }));
    if (totalOf(res) > 10000) { for (const id of part) keep.add(id); continue; }
    for (const h of res?.hits?.hits || []) keep.add(Number(getPath(h._source || {}, spec.idField)));
  }
  return keep;
}

/** Bulk delete by _id. 404 = already gone. Rejections (429) are retried by the caller. */
async function esBulkDelete(elastic, records) {
  const needsType = elastic.esMajor && elastic.esMajor < 7;
  const body = records.map((r) => {
    const action = { _index: r._index || elastic.indexName, _id: r._id };
    if (needsType) action._type = r._type || 'doc';
    return { delete: action };
  });
  const res = unwrap(await elastic.client.bulk({ body, refresh: false }, { requestTimeout: 120000 }));
  const out = { deleted: 0, notFound: 0, failed: [] };
  for (const item of res?.items || []) {
    const d = item.delete || {};
    if (d.status === 404) out.notFound += 1;
    else if (d.status >= 300) out.failed.push(d);
    else out.deleted += 1;
  }
  if (out.failed.length) {
    const err = new Error(`${out.failed.length} bulk delete failures: ${JSON.stringify(out.failed[0].error || out.failed[0]).slice(0, 200)}`);
    if (out.failed.every((f) => f.status === 429)) err.statusCode = 429; // rejected execution → retry
    throw err;
  }
  return out;
}

/**
 * Ads (of these SQL ids) that keep an ES doc which is NOT being deleted (no placeholder in any
 * media field) and shows real media — those stay in SQL. Checked in JS on the media fields
 * (no wildcard query); unsure → keep.
 */
async function adsWithRealMedia(elastic, spec, patterns, ids) {
  const keep = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const res = unwrap(await elastic.client.search({
      index: elastic.indexName,
      body: { size: 10000, _source: [...new Set([spec.idField, ...spec.mediaFields.map(baseField)])], query: { terms: { [spec.idField]: part } } },
    }, { requestTimeout: 120000 }));
    if (totalOf(res) > 10000) { for (const id of part) keep.add(id); continue; }
    for (const h of res?.hits?.hits || []) {
      const src = h._source || {};
      if (!isPlaceholderDoc(src, spec, patterns) && hasRealMedia(src, spec, patterns)) keep.add(Number(getPath(src, spec.idField)));
    }
  }
  return keep;
}

// ── SQL ─────────────────────────────────────────────────────────────────────
/** Ids are validated integers, so they are inlined. */
const idList = (ids) => ids.map((id) => Number(id)).filter((id) => Number.isSafeInteger(id) && id > 0).join(',');

/** The network's SQL media columns that really exist: [{ table, col, cols }]. */
async function sqlMediaPlan(sql, spec) {
  const plan = [];
  for (const [table, col, cols] of spec.sqlMedia || []) {
    const have = new Set((await q(sql, `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]))
      .map((r) => r.c || r.COLUMN_NAME));
    const present = cols.filter((c) => have.has(c));
    if (have.has(col) && present.length) plan.push({ table, col, cols: present });
  }
  return plan;
}

/** Of these ad ids, the ones whose SQL media column holds a placeholder (indexed lookup by ad id). */
async function sqlPlaceholderAds(sql, mediaPlan, patterns, ids) {
  const found = new Set();
  const list = idList(ids);
  if (!list) return found;
  for (const { table, col, cols } of mediaPlan) {
    const likes = cols.flatMap((c) => patterns.map(() => `\`${c}\` LIKE ?`)).join(' OR ');
    const params = cols.flatMap(() => patterns.map((p) => `%${p}%`));
    for (const r of await q(sql, `SELECT DISTINCT \`${col}\` AS id FROM \`${table}\` WHERE \`${col}\` IN (${list}) AND (${likes})`, params)) {
      found.add(Number(r.id));
    }
  }
  return found;
}

/** Child tables deleted with the ad: foreign keys + "<main>_id" columns + bug-report + spec extras. */
async function discoverChildTables(sql, network, mainTable, extraExclude = [], extraChildren = []) {
  const tables = new Map((await q(sql,
    `SELECT TABLE_NAME AS t, TABLE_ROWS AS r, DATA_LENGTH AS d, INDEX_LENGTH AS i
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`
  )).map((x) => [x.t || x.TABLE_NAME, { rows: Number(x.r || 0), bytes: Number(x.d || 0) + Number(x.i || 0) }]));
  if (!tables.has(mainTable)) throw Object.assign(new Error(`table ${mainTable} not found in this database`), { fatal: true });
  const exclude = new Set(extraExclude.map((t) => t.toLowerCase()));
  const children = new Map();
  const skipped = [];
  const add = (table, col, source) => {
    if (!table || table === mainTable || !tables.has(table) || !SAFE_IDENT.test(table) || !SAFE_IDENT.test(col)) return;
    if (exclude.has(table.toLowerCase())) { skipped.push({ table, reason: '--exclude-tables' }); return; }
    if (source === 'name' && SKIP_TABLE.test(table)) { skipped.push({ table, reason: 'log/activity/user-list table' }); return; }
    const key = `${table}.${col}`;
    if (!children.has(key)) children.set(key, { table, col, source });
  };
  for (const r of await q(sql,
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?`, [mainTable]
  )) add(r.t || r.TABLE_NAME, r.c || r.COLUMN_NAME, 'foreign-key');
  for (const r of await q(sql,
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = ? AND TABLE_NAME <> ?`, [`${mainTable}_id`, mainTable]
  )) add(r.t || r.TABLE_NAME, r.c || r.COLUMN_NAME, 'name');
  for (const r of await q(sql,
    `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'ad_id' AND TABLE_NAME IN (?, ?)`,
    [`${mainTable}_bug_report`, `${network}_ad_bug_report`]
  )) add(r.t || r.TABLE_NAME, 'ad_id', 'bug-report');
  for (const [table, col] of extraChildren) add(table, col, 'cascade');

  const indexed = new Set((await q(sql,
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND SEQ_IN_INDEX = 1`
  )).map((r) => `${r.t || r.TABLE_NAME}.${r.c || r.COLUMN_NAME}`));
  const list = [...children.values()].map((c) => {
    const t = tables.get(c.table);
    return { ...c, indexed: indexed.has(`${c.table}.${c.col}`), tableRows: t.rows, tableBytes: t.bytes, bytesPerRow: t.rows ? t.bytes / t.rows : 0 };
  });
  const main = tables.get(mainTable);
  return { children: list, skipped, mainBytesPerRow: main.rows ? main.bytes / main.rows : 0, mainRows: main.rows };
}

// Without an index on the ad column every batch scans the whole table, so "big" is by
// rows OR size (youtube_comments: 149k rows but 854 MB).
const isBigTable = (c, rows, bytes) => c.tableRows > rows || c.tableBytes > bytes;
const unsafeUnindexed = (plan) => plan.children.filter((c) => !c.indexed && isBigTable(c, 1000000, 200 * 1048576));

/** Row counts for a sample of ad ids, scaled by `factor` to the full set. */
async function probeSql(sql, mainTable, plan, ids, factor) {
  const counts = { main: 0, children: {} };
  const key = (c) => `${c.table}.${c.col}`;
  for (let i = 0; i < ids.length; i += 1000) {
    const list = idList(ids.slice(i, i + 1000));
    if (!list) continue;
    counts.main += Number((await q(sql, `SELECT COUNT(*) AS n FROM \`${mainTable}\` WHERE id IN (${list})`))[0]?.n || 0);
    for (const c of plan.children) {
      // An unindexed column on a big table would be a full scan per query: not counted.
      if (!c.indexed && isBigTable(c, 200000, 50 * 1048576)) { counts.children[key(c)] = null; continue; }
      const r = (await q(sql, `SELECT COUNT(*) AS n FROM \`${c.table}\` WHERE \`${c.col}\` IN (${list})`))[0];
      counts.children[key(c)] = (counts.children[key(c)] || 0) + Number(r?.n || 0);
    }
    await sleep(20);
  }
  const scale = (n) => (n == null ? null : Math.round(n * factor));
  const result = { ads: scale(counts.main), bytes: scale(counts.main) * plan.mainBytesPerRow, rows: scale(counts.main), perTable: [] };
  for (const c of plan.children) {
    const rows = scale(counts.children[key(c)]);
    const bytes = rows == null ? null : rows * c.bytesPerRow;
    if (rows) { result.rows += rows; result.bytes += bytes; }
    result.perTable.push({ table: c.table, col: c.col, indexed: c.indexed, rows, bytes });
  }
  return result;
}

/**
 * Binary-log facts of one SQL host (read-only). Every deleted row is written to the binlog; with
 * binlog_row_image=FULL that is the WHOLE row (google_ad_html_lander_content alone is ~1.8 TB), so
 * the disk can fill up. The script asks for MINIMAL on its OWN sessions (only the primary key is
 * logged per deleted row) and pauses a host when its binlogs grow past --max-binlog-growth-gb.
 */
async function binlogInfo(sql) {
  const vars = {};
  for (const r of await q(sql, "SHOW VARIABLES WHERE Variable_name IN ('log_bin','binlog_format','binlog_row_image','binlog_expire_logs_seconds')")) {
    vars[r.Variable_name || r.variable_name] = r.Value ?? r.value;
  }
  const out = { logBin: String(vars.log_bin || '').toUpperCase() === 'ON', format: vars.binlog_format, rowImage: vars.binlog_row_image, expireSec: Number(vars.binlog_expire_logs_seconds || 0), bytes: null, minimalOk: false, minimalErr: null };
  out.bytes = await binlogBytes(sql);
  if (typeof sql.getConnection === 'function') {
    const conn = await sql.getConnection();
    try { await conn.query("SET SESSION binlog_row_image = 'MINIMAL'"); out.minimalOk = true; } catch (e) { out.minimalErr = String(e.code || e.message).slice(0, 60); }
    finally { await conn.query('SET SESSION binlog_row_image = DEFAULT').catch(() => {}); conn.release(); }
  }
  return out;
}

/** Total size of the host's binary logs, or null when not readable (no privilege / binlog off). */
async function binlogBytes(sql) {
  try { return (await q(sql, 'SHOW BINARY LOGS')).reduce((t, r) => t + Number(r.File_size ?? r.file_size ?? 0), 0); } catch { return null; }
}

/** One short transaction: children first, then the ad rows. */
async function deleteSqlBatch(sql, mainTable, children, ids, { binlogMinimal = false } = {}) {
  const list = idList(ids);
  if (!list) return { ads: 0, rows: 0 };
  const conn = await sql.getConnection();
  try {
    await conn.query('SET SESSION innodb_lock_wait_timeout = 10');
    // only the primary key of each deleted row goes to the binlog (needs SESSION_VARIABLES_ADMIN; ignored if denied)
    if (binlogMinimal) await conn.query("SET SESSION binlog_row_image = 'MINIMAL'").catch(() => {});
    await conn.beginTransaction();
    let rows = 0;
    for (const { table, col } of children) {
      try {
        const [r] = await conn.query(`DELETE FROM \`${table}\` WHERE \`${col}\` IN (${list})`);
        rows += Number(r?.affectedRows || 0);
      } catch (e) {
        if (!(e && (e.errno === 1146 || e.code === 'ER_NO_SUCH_TABLE'))) throw e;
      }
    }
    const [res] = await conn.query(`DELETE FROM \`${mainTable}\` WHERE id IN (${list})`);
    await conn.commit();
    const ads = Number(res?.affectedRows || 0);
    return { ads, rows: rows + ads };
  } catch (e) {
    try { await conn.rollback(); } catch { /* keep original error */ }
    throw e;
  } finally {
    conn.release();
  }
}

/** Threads_running limit for a host: --max-db-cpu % of its vCPUs when known, else --max-threads-running. */
function threadsLimitFor(host, opts) {
  const ip = String(host || '').split(':')[0];
  const vcpus = opts.dbVcpus?.[ip] ?? opts.dbVcpus?.[host] ?? opts.dbVcpus?.['*'];
  return vcpus ? Math.max(2, Math.floor((vcpus * opts.maxDbCpu) / 100)) : opts.maxThreadsRunning;
}

/**
 * One per SQL host: how many delete batches may run at once (all networks/shards on the host share it).
 * Starts at 2; adds one every 15 s while Threads_running stays under 60% of the host limit and batches are
 * fast; drops one when batches get slow; halves when the host is busy. Every change is logged with why.
 */
class SqlGovernor {
  constructor(host, monitor, opts, onDecision) {
    Object.assign(this, { host, monitor, opts, onDecision, latencies: [] });
    this.sem = new Semaphore(Math.min(2, opts.sqlParallel));
  }

  recordLatency(ms) { this.latencies.push(ms); if (this.latencies.length > 30) this.latencies.shift(); }

  avgLatency() { return this.latencies.length ? this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length : 0; }

  /** Pure decision step (tested). */
  static decide({ capacity, busy, threads, limit, avgLatency, waiting, opts, cpu = null }) {
    if (busy) return { capacity: Math.max(1, Math.floor(capacity / 2)), why: 'host busy' };
    if (cpu != null && cpu > opts.maxDbCpu - 5) return { capacity: Math.max(1, capacity - 1), why: `MySQL CPU ${Math.round(cpu)}% near the ${opts.maxDbCpu}% cap` };
    if (avgLatency > opts.sqlTargetMs * 2) return { capacity: Math.max(1, capacity - 1), why: `slow batches ${Math.round(avgLatency)}ms > ${opts.sqlTargetMs * 2}ms` };
    const roomy = cpu != null ? cpu < opts.maxDbCpu - 15 : (threads == null || threads <= limit * 0.6);
    if (waiting > 0 && capacity < opts.sqlParallel && roomy && (!avgLatency || avgLatency < opts.sqlTargetMs)) {
      return { capacity: capacity + 1, why: cpu != null ? `MySQL CPU ${Math.round(cpu)}% < ${opts.maxDbCpu - 15}%, batches ${Math.round(avgLatency)}ms` : `headroom (Threads_running ${threads ?? '?'} ≤ 60% of ${limit}, batches ${Math.round(avgLatency)}ms)` };
    }
    return { capacity, why: '' };
  }

  async tick() {
    const busy = await this.monitor.busy();
    const before = this.sem.capacity;
    const d = SqlGovernor.decide({ capacity: before, busy, threads: this.monitor.threadsRunning, limit: this.monitor.limit, avgLatency: this.avgLatency(), waiting: this.sem.queue.length, opts: this.opts, cpu: this.monitor.cpu });
    if (d.capacity !== before) {
      this.sem.setCapacity(d.capacity);
      this.onDecision?.(`SQL ${this.host}: parallel delete batches ${before} → ${d.capacity} — ${d.why}`);
    }
  }
}

// ── delete by date (every network in --mode=date; Google organic in --mode=placeholder) ──
const GOOGLE_WINDOW = 50000; // ids per SELECT window: every query stays short
const dateCutoff = (opts) => `${opts.before} 00:00:00`;
// Google's organic-only filter applies in the old placeholder mode only.
const organicOnly = (spec, opts) => opts.mode !== 'date' && spec.rule === 'google-organic';
const dateWhere = (spec, opts) => `${organicOnly(spec, opts) ? "type = 'ORGANIC SEARCH' AND " : ''}\`${opts.dateColumn}\` < ?`;

/** ES side: last_seen before the cutoff (the range's own format parses the date for any stored format). */
function dateEsQuery(spec, opts) {
  const field = opts.mode === 'date' ? spec.esDateField : opts.dateColumn;
  const filter = [{ range: { [field]: { lt: opts.before, format: 'yyyy-MM-dd' } } }];
  if (organicOnly(spec, opts)) filter.unshift({ term: { type: 'organic search' } }); // lowercase-normalized keyword
  return { bool: { filter } };
}

/** Fast SQL estimate: 40 evenly spaced id windows → density × id range. Also returns sample ids. */
async function dateSqlEstimate(sql, spec, opts) {
  const table = spec.mainTable;
  const r = (await q(sql, `SELECT MIN(id) AS lo, MAX(id) AS hi FROM \`${table}\``))[0] || {};
  const lo = Number(r.lo || 0);
  const hi = Number(r.hi || 0);
  if (!hi) return { lo, hi, est: 0, sample: [] };
  const windows = 40;
  const size = 20000;
  const step = Math.max(size, Math.floor((hi - lo) / windows));
  let matched = 0;
  let scanned = 0;
  const sample = [];
  for (let a = lo; a <= hi; a += step) {
    const rows = await q(sql, `SELECT id FROM \`${table}\` WHERE id BETWEEN ? AND ? AND ${dateWhere(spec, opts)}`, [a, a + size - 1, dateCutoff(opts)]);
    matched += rows.length;
    scanned += Math.min(size, hi - a + 1);
    for (const x of rows) if (sample.length < 3000 && Math.random() < 0.1) sample.push(Number(x.id));
    await sleep(20);
  }
  return { lo, hi, est: scanned ? Math.round((matched / scanned) * (hi - lo + 1)) : 0, sample };
}

/**
 * SQL lane: the main table's id range is split into --sql-shards parts, each walked by id in bounded
 * windows (matches + children deleted in one short transaction per batch). The shards run in
 * parallel, but only as many batches as the host's SqlGovernor allows are in flight at once.
 * Each shard's cursor is saved, so a restart continues every part where it stopped.
 */
async function runDateSqlLane(job, opts, monitor, gov) {
  const { network, sql, state, status, plan, dir, spec } = job;
  const table = spec.mainTable;
  const lane = status.sql;
  if (state.sql.finished) { lane.state = 'done'; return; }
  if (!state.sql.hi) {
    const r = (await withRetry(() => q(sql, `SELECT MIN(id) AS lo, MAX(id) AS hi FROM \`${table}\``)))[0] || {};
    Object.assign(state.sql, { hi: Number(r.hi || 0), lo: Math.max(0, Number(r.lo || 1) - 1), cursor: Math.max(0, Number(r.lo || 1) - 1) });
    saveState(dir, network, state); // hi is fixed: newer ads are recent, never "before" the cutoff
  }
  if (state.sql.lo == null) state.sql.lo = 0;
  if (!Array.isArray(state.sql.shards)) {
    // first run, or an older single-cursor run: split what is left into shards
    const from = state.sql.cursor || state.sql.lo;
    const n = Math.max(1, Math.min(opts.sqlShards, Math.ceil((state.sql.hi - from) / GOOGLE_WINDOW)));
    const span = Math.ceil((state.sql.hi - from) / n);
    state.sql.base = from;
    state.sql.shards = Array.from({ length: n }, (_, i) => {
      const lo = from + i * span;
      return { start: lo, cursor: lo, end: Math.min(state.sql.hi, from + (i + 1) * span) };
    });
    saveState(dir, network, state);
  }
  // ids walked so far = everything before the split + each part's own progress (drives progress / ETA)
  const showCursor = () => {
    state.sql.cursor = Math.min(state.sql.hi, state.sql.base + state.sql.shards.reduce((t, sh) => t + (sh.cursor - sh.start), 0));
  };
  let busyNote = '';

  const worker = async (sh) => {
    const throttle = new Throttle({ initial: opts.sqlBatch, max: opts.sqlMaxBatch, targetMs: opts.sqlTargetMs });
    while (!stopping && sh.cursor < sh.end) {
      await waitLocal(opts, (x) => { lane.state = x; });
      if (await monitor.busy()) {
        busyNote = `paused: ${monitor.reason}`.slice(0, 60);
        throttle.next(0, true);
        await sleepUnlessStopping(throttle.pauseMs);
        continue;
      }
      busyNote = '';
      await gov.sem.acquire();
      let ids = [];
      let r = { ads: 0, rows: 0 };
      const t0 = Date.now();
      try {
        if (stopping) break;
        const winEnd = Math.min(sh.end, sh.cursor + GOOGLE_WINDOW);
        ids = (await withRetry(() => q(sql,
          `SELECT id FROM \`${table}\` WHERE id > ? AND id <= ? AND ${dateWhere(spec, opts)} ORDER BY id LIMIT ${throttle.size}`,
          [sh.cursor, winEnd, dateCutoff(opts)]), (m) => { lane.state = m; })).map((x) => Number(x.id));
        if (ids.length) r = await withRetry(() => deleteSqlBatch(sql, table, plan.children, ids, opts), (m) => { lane.state = m; });
        // a full batch may have more matches in this window; otherwise the window is done
        sh.cursor = ids.length === throttle.size ? ids[ids.length - 1] : winEnd;
      } finally {
        gov.sem.release();
      }
      if (ids.length) gov.recordLatency(Date.now() - t0);
      Object.assign(state.sql, { ads: state.sql.ads + r.ads, rows: state.sql.rows + r.rows, done: state.sql.ads + r.ads });
      showCursor();
      lane.meter.add(state.sql.cursor);
      state.sql.rate = lane.meter.rate() || state.sql.rate;
      saveState(dir, network, state);
      if (ids.length) throttle.next(Date.now() - t0, false);
      await sleepUnlessStopping(ids.length ? Math.min(throttle.pauseMs, 100) : 10);
    }
  };
  const stateTimer = setInterval(() => {
    const active = state.sql.shards.filter((sh) => sh.cursor < sh.end).length;
    lane.state = busyNote || `deleting · ${gov.sem.active}/${gov.sem.capacity} batches · ${active} parts left`;
  }, 1000);
  try {
    await Promise.all(state.sql.shards.map((sh) => worker(sh)));
  } finally {
    clearInterval(stateTimer);
  }
  showCursor();
  if (stopping) { lane.state = 'stopped (resumable)'; saveState(dir, network, state); return; }
  state.sql.finished = true;
  state.sql.cursor = state.sql.hi;
  saveState(dir, network, state);
  lane.state = 'done';
}

/**
 * ES lane: one server-side _delete_by_query task. The task id is saved: after a restart the
 * script re-attaches to it; a task lost with an ES restart is simply started again (the query
 * only matches what is left). Speed follows the cluster controller via _rethrottle.
 */
async function runDateEsLane(job, opts) {
  const { state, status, ctl } = job;
  if (state.es.finished) { status.es.state = 'done'; return; }
  const sem = ctl.dbqSem;
  if (sem) {
    status.es.state = `queued: ${sem.active}/${sem.capacity} delete-by-query tasks busy`;
    await sem.acquire();
  }
  try {
    if (!stopping) await runDateEsTask(job, opts);
  } finally {
    sem?.release();
  }
}

/** One task's share of the cluster's delete-by-query speed (tasks running at once split it). */
const dbqShare = (ctl) => Math.max(100, Math.round(ctl.dbqRps() / Math.max(1, ctl.dbqSem?.active || 1)));

async function runDateEsTask(job, opts) {
  const { network, elastic, state, status, ctl, dir, spec } = job;
  const lane = status.es;
  const client = elastic.client;
  let rps = dbqShare(ctl);
  let restarts = 0;
  while (!stopping) {
    if (!state.es.taskId) {
      const res = unwrap(await withRetry(() => client.deleteByQuery({
        index: elastic.indexName, conflicts: 'proceed', refresh: false, wait_for_completion: false,
        slices: 'auto', scroll_size: 1000, requests_per_second: rps, body: { query: dateEsQuery(spec, opts) },
      }), (m) => { lane.state = m; }));
      if (!res?.task) { state.es.prevDeleted += Number(res?.deleted || 0); break; }
      state.es.taskId = res.task;
      saveState(dir, network, state);
    }
    lane.state = `task ${state.es.taskId}`;
    await sleepUnlessStopping(5000);
    if (stopping) break;
    let t;
    try {
      t = unwrap(await client.tasks.get({ task_id: state.es.taskId }));
    } catch (e) {
      if ((e.meta?.statusCode ?? e.statusCode) === 404) { // task gone (ES restarted) → start again
        state.es.prevDeleted = state.es.deleted; // keep what the lost task had already deleted
        state.es.taskTotal = 0;
        state.es.taskId = null;
        if (++restarts > 20) throw new Error('delete-by-query task lost 20 times');
        continue;
      }
      if (isTransient(e)) { lane.state = `waiting: ${e.message.slice(0, 40)}`; continue; }
      throw e;
    }
    const st = t?.task?.status || {};
    // A sliced task (slices: 'auto') reports 0 on the parent until it ends (ES 6.8): add up the
    // finished slices from the parent and the running slices from its child tasks instead.
    let live = { total: Number(st.total || 0), deleted: Number(st.deleted || 0) };
    if (!t?.completed && Array.isArray(st.slices)) {
      live = { total: 0, deleted: 0 };
      for (const sl of st.slices) if (sl) { live.total += Number(sl.total || 0); live.deleted += Number(sl.deleted || 0); }
      const kids = await client.tasks.list({ parent_task_id: state.es.taskId, detailed: true }).then(unwrap).catch(() => null);
      for (const node of Object.values(kids?.nodes || {})) {
        for (const k of Object.values(node.tasks || {})) { live.total += Number(k.status?.total || 0); live.deleted += Number(k.status?.deleted || 0); }
      }
    }
    state.es.taskTotal = live.total;
    state.es.deleted = state.es.prevDeleted + live.deleted;
    state.es.done = state.es.deleted;
    lane.meter.add(state.es.deleted);
    state.es.rate = lane.meter.rate() || state.es.rate;
    if (t?.completed) {
      const failures = t.response?.failures || [];
      state.es.prevDeleted += Number(t.response?.deleted ?? st.deleted ?? 0);
      state.es.deleted = state.es.prevDeleted;
      state.es.taskId = null;
      state.es.taskTotal = 0; // counted in prevDeleted now
      saveState(dir, network, state);
      if (!failures.length) break;
      lane.state = `task had ${failures.length} failures — starting again`;
      if (++restarts > 20) throw new Error(`delete-by-query failures: ${JSON.stringify(failures[0]).slice(0, 200)}`);
      await sleepUnlessStopping(30000);
      continue;
    }
    saveState(dir, network, state);
    const want = dbqShare(ctl);
    if (Math.abs(want - rps) / rps > 0.2) {
      await client.deleteByQueryRethrottle({ task_id: state.es.taskId, requests_per_second: want }).catch(() => {});
      rps = want;
    }
  }
  if (stopping) {
    // Stop means stop: cancel the server-side task (the next run starts a new one on what is left).
    if (state.es.taskId) {
      await client.tasks.cancel({ task_id: state.es.taskId }).catch(() => {});
      state.es.prevDeleted = state.es.deleted;
      state.es.taskId = null;
      state.es.taskTotal = 0;
      saveState(dir, network, state);
    }
    lane.state = 'stopped (resumable)';
    return;
  }
  state.es.finished = true;
  saveState(dir, network, state);
  lane.state = 'done';
}

// ── placeholder lanes ───────────────────────────────────────────────────────
async function runEsLane(job, opts) {
  const { network, elastic, state, status, ctl, dir } = job;
  const lane = status.es;
  if (state.es.finished) { lane.state = 'done'; return; }
  while (!stopping) {
    await waitLocal(opts, (s) => { lane.state = s; });
    await ctl.gate();
    lane.state = 'waiting for slot';
    await ctl.sem.acquire();
    try {
      if (stopping) break;
      lane.state = 'deleting';
      const { records, next } = readChunk(job.idsFile, state.es.offset, ctl.batch);
      if (!records.length) break;
      const t0 = Date.now();
      const r = await withRetry(() => esBulkDelete(elastic, records), (msg) => { lane.state = msg; });
      ctl.recordLatency(Date.now() - t0);
      Object.assign(state.es, {
        offset: next, done: state.es.done + records.length,
        deleted: state.es.deleted + r.deleted, notFound: state.es.notFound + r.notFound,
      });
      lane.meter.add(state.es.done);
      state.es.rate = lane.meter.rate() || state.es.rate;
      saveState(dir, network, state);
    } finally {
      ctl.sem.release();
    }
  }
  if (stopping) { lane.state = 'stopped (resumable)'; return; }
  state.es.finished = true;
  saveState(dir, network, state);
  lane.state = 'done';
}

async function runSqlLane(job, opts, monitor) {
  const { network, spec, elastic, sql, state, status, plan, dir } = job;
  const lane = status.sql;
  if (state.sql.finished) { lane.state = 'done'; return; }
  const throttle = new Throttle({ initial: opts.sqlBatch, max: opts.sqlMaxBatch, targetMs: opts.sqlTargetMs });
  const keptLog = path.join(dir, `${network}.sql-kept.jsonl`);
  while (!stopping) {
    await waitLocal(opts, (s) => { lane.state = s; });
    if (await monitor.busy()) {
      lane.state = `paused: ${monitor.reason}`.slice(0, 60);
      throttle.next(0, true);
      await sleepUnlessStopping(throttle.pauseMs);
      continue;
    }
    lane.state = 'deleting';
    const { records, next } = readChunk(job.idsFile, state.sql.offset, throttle.size);
    if (!records.length) break;
    const valid = (r) => Number.isSafeInteger(Number(r.ad_id)) && Number(r.ad_id) > 0;
    const ids = [...new Set(records.filter(valid).map((r) => Number(r.ad_id)))];
    const noId = records.length - records.filter(valid).length;

    const t0 = Date.now();
    const keep = ids.length ? await withRetry(() => adsWithRealMedia(elastic, spec, opts.patterns, ids), (m) => { lane.state = m; }) : new Set();
    const del = ids.filter((id) => !keep.has(id));
    const r = await withRetry(() => deleteSqlBatch(sql, spec.mainTable, plan.children, del, opts), (m) => { lane.state = m; });
    if (keep.size) fs.appendFileSync(keptLog, `${[...keep].map((id) => JSON.stringify({ ad_id: id, reason: 'another ES doc has real media' })).join('\n')}\n`);

    Object.assign(state.sql, {
      offset: next, done: state.sql.done + records.length, ads: state.sql.ads + r.ads, rows: state.sql.rows + r.rows,
      kept: state.sql.kept + keep.size, noSqlId: state.sql.noSqlId + noId,
    });
    lane.meter.add(state.sql.done);
    state.sql.rate = lane.meter.rate() || state.sql.rate;
    saveState(dir, network, state);
    throttle.next(Date.now() - t0, false);
    await sleepUnlessStopping(throttle.pauseMs);
  }
  if (stopping) { lane.state = 'stopped (resumable)'; return; }
  state.sql.finished = true;
  saveState(dir, network, state);
  lane.state = 'done';
}

// ── parallel lanes (--mode=no-media) ────────────────────────────────────────
/**
 * Works through the ID file with up to `workers` batches in flight (each holds one slot of the
 * cluster / host semaphore, so the load controllers still decide the real concurrency). Chunks are
 * handed out in file order; onCommit (= saved offset) runs in file order only, once a chunk and all
 * chunks before it are done — a restart redoes at most the batches that were in flight, and deletes
 * are idempotent. The first error stops handing out work and is thrown after the others finish.
 */
async function runOrderedPool({ file, offset, workers, size, acquire, release, process: work, onCommit }) {
  let readPos = offset;
  let seq = 0;
  let nextCommit = 0;
  let eof = false;
  let failed = null;
  const done = new Map();
  const worker = async () => {
    while (!stopping && !eof && !failed) {
      await acquire();
      let mine = null;
      try {
        if (stopping || eof || failed) break;
        const { records, next } = readChunk(file, readPos, Math.max(1, size())); // sync: no other worker runs in between
        if (!records.length) { eof = true; break; }
        readPos = next;
        mine = seq;
        seq += 1;
        done.set(mine, { pending: true });
        const result = await work(records);
        done.set(mine, { next, records, result });
      } catch (e) {
        if (mine != null) done.delete(mine);
        failed = failed || e;
        break;
      } finally {
        release();
      }
      while (done.has(nextCommit) && !done.get(nextCommit).pending) {
        const d = done.get(nextCommit);
        done.delete(nextCommit);
        nextCommit += 1;
        onCommit(d);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
  if (failed) throw failed;
}

const laneFinished = (job, laneName) => {
  const { network, state, status, dir } = job;
  if (stopping) { status[laneName].state = 'stopped (resumable)'; saveState(dir, network, state); return; }
  state[laneName].finished = true;
  saveState(dir, network, state);
  status[laneName].state = 'done';
};

/** ES lane with up to --es-parallel bulk deletes of this network in flight (cluster-wide cap: ctl.sem). */
async function runPooledEsLane(job, opts) {
  const { network, elastic, state, status, ctl, dir } = job;
  const lane = status.es;
  if (state.es.finished) { lane.state = 'done'; return; }
  lane.state = 'deleting';
  await runOrderedPool({
    file: job.idsFile, offset: state.es.offset, workers: opts.esParallel, size: () => ctl.batch,
    acquire: async () => { await waitLocal(opts, (s) => { lane.state = s; }); await ctl.gate(); await ctl.sem.acquire(); },
    release: () => ctl.sem.release(),
    process: async (records) => {
      const t0 = Date.now();
      const r = await withRetry(() => esBulkDelete(elastic, records), (m) => { lane.state = m; });
      ctl.recordLatency(Date.now() - t0);
      lane.state = `deleting · ${ctl.sem.active}/${ctl.sem.capacity} bulks on the cluster`;
      return r;
    },
    onCommit: ({ next, records, result }) => {
      Object.assign(state.es, { offset: next, done: state.es.done + records.length, deleted: state.es.deleted + result.deleted, notFound: state.es.notFound + result.notFound });
      lane.meter.add(state.es.done);
      state.es.rate = lane.meter.rate() || state.es.rate;
      saveState(dir, network, state);
    },
  });
  laneFinished(job, 'es');
}

/**
 * SQL lane with up to --sql-parallel delete batches in flight (host-wide cap: the SqlGovernor, which
 * grows / shrinks with Threads_running, MySQL CPU and batch time). An ad stays in SQL when another
 * ES doc of it is still shown by the search (adsVisibleInEs).
 */
async function runPooledSqlLane(job, opts, monitor, gov) {
  const { network, spec, elastic, sql, state, status, plan, dir } = job;
  const lane = status.sql;
  if (state.sql.finished) { lane.state = 'done'; return; }
  const throttle = new Throttle({ initial: opts.sqlBatch, max: opts.sqlMaxBatch, targetMs: opts.sqlTargetMs });
  const keptLog = path.join(dir, `${network}.sql-kept.jsonl`);
  lane.state = 'deleting';
  await runOrderedPool({
    file: job.idsFile, offset: state.sql.offset, workers: opts.sqlParallel, size: () => throttle.size,
    acquire: async () => {
      await waitLocal(opts, (s) => { lane.state = s; });
      while (!stopping && await monitor.busy()) {
        lane.state = `paused: ${monitor.reason}`.slice(0, 60);
        throttle.next(0, true);
        await sleepUnlessStopping(throttle.pauseMs);
      }
      await gov.sem.acquire();
    },
    release: () => gov.sem.release(),
    process: async (records) => {
      const valid = (r) => Number.isSafeInteger(Number(r.ad_id)) && Number(r.ad_id) > 0;
      const ids = [...new Set(records.filter(valid).map((r) => Number(r.ad_id)))];
      const t0 = Date.now();
      const keep = ids.length ? await withRetry(() => adsVisibleInEs(elastic, network, spec, ids), (m) => { lane.state = m; }) : new Set();
      const del = ids.filter((id) => !keep.has(id));
      const r = del.length ? await withRetry(() => deleteSqlBatch(sql, spec.mainTable, plan.children, del, opts), (m) => { lane.state = m; }) : { ads: 0, rows: 0 };
      const ms = Date.now() - t0;
      gov.recordLatency(ms);
      throttle.next(ms, false);
      if (keep.size) fs.appendFileSync(keptLog, `${[...keep].map((id) => JSON.stringify({ ad_id: id, reason: 'another ES doc of this ad is shown by the search' })).join('\n')}\n`);
      lane.state = `deleting · ${gov.sem.active}/${gov.sem.capacity} batches on the host`;
      return { ...r, kept: keep.size, noId: records.length - records.filter(valid).length };
    },
    onCommit: ({ next, records, result }) => {
      Object.assign(state.sql, {
        offset: next, done: state.sql.done + records.length, ads: state.sql.ads + result.ads, rows: state.sql.rows + result.rows,
        kept: state.sql.kept + result.kept, noSqlId: state.sql.noSqlId + result.noId,
      });
      lane.meter.add(state.sql.done);
      state.sql.rate = lane.meter.rate() || state.sql.rate;
      saveState(dir, network, state);
    },
  });
  laneFinished(job, 'sql');
}

// ── progress table ──────────────────────────────────────────────────────────
/** "12.3% of 35,387,601" — share of the whole index / table that would be deleted. */
function shareOf(part, whole, approx = false) {
  if (part == null || !whole) return '-';
  const v = (part / whole) * 100;
  return `${approx ? '~' : ''}${v < 0.1 && v > 0 ? '<0.1' : v.toFixed(1)}% of ${approx ? '~' : ''}${num(whole)}`;
}

function pct(done, total) { return total ? `${Math.min(100, (done / total) * 100).toFixed(1)}%` : '-'; }

/** Remaining ms for a lane (0 when finished, null when unknown yet). */
function laneEtaMs(meter, done, total, finished) {
  if (finished) return 0;
  const rate = meter.rate();
  return rate > 0 && total > done ? ((total - done) / rate) * 1000 : null;
}

function laneEta(meter, done, total, finished) {
  if (finished) return '0';
  const rate = meter.rate();
  return rate > 0 && total > done ? fmtDuration(((total - done) / rate) * 1000) : '-';
}

/**
 * Every decision the script takes about speed / parallelism, with the reason: appended to
 * <run dir>/decisions.log, the last few shown under the live table (printed directly without a TTY).
 */
function makeDecisionLog(dir, tty) {
  const file = path.join(dir, 'decisions.log');
  const recent = [];
  const note = (msg) => {
    const line = `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}`;
    recent.push(line);
    if (recent.length > 12) recent.shift();
    try { fs.appendFileSync(file, `${line}\n`); } catch { /* best effort */ }
    if (!tty) console.log(line);
  };
  return { file, recent, note };
}

/** Live dry-run table: one row per network + ES / SQL load + recent decisions. */
function printDryProgress({ jobs, govs, monitors, decisions, startedAt, tty, opts }) {
  const out = [];
  const scanJobs = jobs.filter((j) => j.dp && j.dp.total);
  const sumTotal = scanJobs.reduce((t, j) => t + j.dp.total, 0);
  const sumDone = scanJobs.reduce((t, j) => t + Math.min(j.dp.scanned, j.dp.total), 0);
  const etas = jobs.map((j) => {
    const rate = j.dp?.meter.rate() || 0;
    const left = Math.max(0, (j.dp?.total || 0) - (j.dp?.scanned || 0));
    return left && rate ? (left / rate) * 1000 : (left ? Infinity : 0);
  });
  const finite = etas.filter((x) => Number.isFinite(x));
  out.push(`DRY RUN PROBE — elapsed ${fmtDuration(Date.now() - startedAt)} · overall ${pct(sumDone, sumTotal)} (${num(sumDone)}/${num(sumTotal)} docs scanned)`
    + ` · ETA ${etas.some((x) => x === Infinity) ? 'measuring…' : (finite.length ? fmtDuration(Math.max(0, ...finite)) : '-')} · nothing is deleted`);
  for (const g of govs.values()) {
    const l = g.load;
    out.push(`ES ${g.name}: scan slots ${g.sem.active}/${g.sem.capacity} busy (max ${opts.scanParallel}), ${g.sem.queue.length} waiting · ${l ? `heap ${l.heap}% cpu ${l.cpu}% search queue ${l.searchQueue} ${l.status}` : 'load n/a'} · avg page ${Math.round(g.avgLatency())}ms · ${g.state}`);
  }
  const sqlLine = [...monitors.entries()].map(([h, m]) => `${h} threads ${m.threadsRunning ?? '-'}`).join(' · ');
  if (sqlLine) out.push(`SQL Threads_running (pause > ${opts.maxThreadsRunning}): ${sqlLine}`);
  out.push(`This machine: load ${os.loadavg()[0].toFixed(2)} · script heap ${fmtBytes(process.memoryUsage().heapUsed)}`);
  out.push('');
  out.push(renderTable(
    ['NETWORK', 'INDEX', 'PHASE', 'SCANNED / TOTAL', '%', 'ES DOCS TO DELETE', '% OF INDEX', '(ES media / SQL media)', 'KEPT: REAL MEDIA', 'SQL ADS TO DELETE', '% OF SQL TABLE', 'DOCS/S', 'ETA', 'SQL HOST'],
    jobs.map((j, i) => {
      const d = j.dp || {};
      const rate = d.meter?.rate() || 0;
      const eta = etas[i] === Infinity ? 'measuring…' : (etas[i] ? fmtDuration(etas[i]) : (/done/.test(d.phase) ? '0m' : '-'));
      return [
        j.network, j.elastic?.indexName || j.targets?.elastic?.index || '-', String(d.phase || '-').slice(0, 36),
        d.total ? `${num(Math.min(d.scanned, d.total))} / ${num(d.total)}` : '-', d.total ? pct(d.scanned, d.total) : '-',
        num(d.found || 0), shareOf(d.found || 0, j.esTotal), j.isDate ? `last_seen < ${opts.before}` : `${num(d.fromEs || 0)} / ${num(d.fromSql || 0)}`,
        j.isDate ? '-' : num(d.keptReal || 0),
        !j.spec.mainTable ? '(ES only)' : (d.ads == null ? (j.isDate ? 'after SQL estimate' : '-') : `${j.isDate || j.probe ? '~' : ''}${num(d.ads)}`),
        !j.spec.mainTable ? '-' : shareOf(d.ads, j.plan?.mainRows, true),
        rate ? rate.toFixed(0) : '-', eta, j.host || '(ES only)',
      ];
    }),
  ));
  if (tty && decisions.recent.length) {
    out.push('', 'Decisions (why speed / parallelism changed — full list in decisions.log):');
    for (const l of decisions.recent.slice(-8)) out.push(`  ${l}`);
  }
  const text = out.join('\n');
  if (tty) process.stdout.write(`\x1b[H\x1b[2J${text}\n`);
  else console.log(`\n${text}`);
}

function renderTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join(' │ ');
  return [line(headers), widths.map((w) => '─'.repeat(w)).join('─┼─'), ...rows.map(line)].join('\n');
}

/** One row per network; google shows the delete-by-query task (ES) and id-range progress (SQL). */
function progressRow(j) {
  const { state, status, isDate } = j;
  const es = isDate
    ? { done: state.es.deleted, total: Math.max(j.esPlanned || 0, state.es.taskTotal + state.es.prevDeleted, state.es.deleted) || null }
    : { done: state.es.done, total: state.total };
  const sql = isDate
    ? { done: state.sql.cursor, total: state.sql.hi, ads: state.sql.ads, rows: state.sql.rows, kept: 0 }
    : { done: state.sql.done, total: state.total, ads: state.sql.ads, rows: state.sql.rows, kept: state.sql.kept };
  return {
    network: j.network,
    es: j.esSelected ? {
      state: status.es.state, done: es.done, total: es.total, rate: status.es.meter.rate(),
      eta: laneEta(status.es.meter, es.done, es.total, state.es.finished),
      etaMs: laneEtaMs(status.es.meter, es.done, es.total, state.es.finished), finished: state.es.finished,
    } : null,
    sql: j.wantSql ? {
      host: j.host, state: status.sql.state, ...sql, unit: isDate ? 'id' : 'doc',
      eta: laneEta(status.sql.meter, sql.done, sql.total, state.sql.finished),
      etaMs: laneEtaMs(status.sql.meter, sql.done, sql.total, state.sql.finished), finished: state.sql.finished,
    } : null,
  };
}

function progressSnapshot(jobs, controllers, monitors, startedAt) {
  return {
    at: new Date().toISOString(),
    elapsed: fmtDuration(Date.now() - startedAt),
    clusters: [...controllers.entries()].map(([key, c]) => ({ key, parallel: `${c.sem.active}/${c.sem.capacity}`, batch: c.batch, dbqRps: c.dbqRps(), state: c.state, load: c.load })),
    hosts: [...monitors.entries()].map(([host, m]) => ({ host, cpu: m.cpu, cpuN: m.cpuN, cpuLimit: m.cpuLimit, threadsRunning: m.threadsRunning, limit: m.limit, parallel: m.gov ? `${m.gov.sem.active}/${m.gov.sem.capacity}` : null, binlogGrowth: m.binlogLimit ? m.binlogGrowth() : null, binlogNow: m.binlogNow, paused: m.wasBusy ? m.reason : '' })),
    local: { load: os.loadavg()[0].toFixed(2), cpus: os.cpus().length, rssMb: Math.round(process.memoryUsage().rss / 1048576) },
    rows: jobs.map(progressRow),
  };
}

/** Whole-run totals: ES docs done/planned, SQL ads/rows deleted, overall ETA (slowest lane; SQL lanes on one host add up). */
function progressSummary(snap, jobs) {
  const sum = { esDone: 0, esTotal: 0, sqlAds: 0, sqlRows: 0, unknown: false, etaMs: 0 };
  const hostEta = new Map();
  snap.rows.forEach((r, i) => {
    if (r.es) {
      sum.esDone += r.es.done || 0;
      sum.esTotal += r.es.total || 0;
      if (r.es.etaMs == null && !r.es.finished) sum.unknown = true; else sum.etaMs = Math.max(sum.etaMs, r.es.etaMs || 0);
    }
    if (r.sql) {
      sum.sqlAds += r.sql.ads || 0;
      sum.sqlRows += r.sql.rows || 0;
      if (r.sql.etaMs == null && !r.sql.finished) sum.unknown = true;
      else hostEta.set(r.sql.host, (hostEta.get(r.sql.host) || 0) + (r.sql.etaMs || 0));
    }
    void jobs[i];
  });
  for (const ms of hostEta.values()) sum.etaMs = Math.max(sum.etaMs, ms);
  return sum;
}

function printProgress(snap, tty) {
  const out = [];
  out.push(`Delete old ads — APPLY — ${snap.at.slice(0, 19).replace('T', ' ')} UTC — running ${snap.elapsed}`);
  for (const c of snap.clusters) {
    const l = c.load ? `heap ${c.load.heap}% cpu ${c.load.cpu}% write-queue ${c.load.writeQueue} status ${c.load.status}` : 'load: n/a';
    out.push(`ES ${c.key}: parallel bulks ${c.parallel} · batch ${c.batch} · delete-by-query ${c.dbqRps}/s · ${l} · ${c.state}`);
  }
  for (const h of snap.hosts) {
    out.push(`SQL ${h.host}: ${h.cpu != null ? `MySQL CPU ${Math.round(h.cpu)}% of ${h.cpuN} vCPUs (cap ${h.cpuLimit}%) · ` : ''}Threads_running ${h.threadsRunning ?? '-'} (pause above ${h.limit})${h.parallel ? ` · delete batches ${h.parallel}` : ''}`
      + `${h.binlogGrowth != null ? ` · binlog +${fmtBytes(h.binlogGrowth)} since start (now ${h.binlogNow != null ? fmtBytes(h.binlogNow) : '-'})` : ''}${h.paused ? ` · PAUSED: ${h.paused}` : ''}`);
  }
  if (snap.summary) {
    const t = snap.summary;
    const eta = t.etaMs ? `~${fmtDuration(t.etaMs)}${t.unknown ? '+' : ''} → done ~${new Date(Date.parse(snap.at) + t.etaMs).toISOString().slice(0, 16).replace('T', ' ')} UTC` : (t.unknown ? 'measuring…' : '0');
    out.push(`TOTAL — ES deleted ${num(t.esDone)} / ${num(t.esTotal)} (${pct(t.esDone, t.esTotal)}) · SQL ads deleted ${num(t.sqlAds)} (${num(t.sqlRows)} rows incl. child tables) · ETA ${eta}`);
  }
  out.push(`This machine: load ${snap.local.load} on ${snap.local.cpus} CPUs · script memory ${snap.local.rssMb} MB`);
  out.push('');
  out.push(renderTable(
    ['NETWORK', 'ES STATE', 'ES DONE', 'ES %', 'ES /S', 'ES ETA', 'SQL HOST', 'SQL STATE', 'SQL PROGRESS', 'SQL %', 'ADS DEL', 'ROWS DEL', 'KEPT', 'SQL ETA'],
    snap.rows.map((r) => [
      r.network,
      r.es ? r.es.state.slice(0, 34) : '(not selected)', r.es ? `${num(r.es.done)}/${num(r.es.total)}` : '-', r.es ? pct(r.es.done, r.es.total) : '-',
      r.es?.rate ? r.es.rate.toFixed(0) : '-', r.es ? r.es.eta : '-',
      r.sql ? r.sql.host : '-', r.sql ? r.sql.state.slice(0, 34) : (r.network === 'tiktok' ? '(ES only)' : '(not selected)'),
      r.sql ? `${num(r.sql.done)}/${num(r.sql.total)} ${r.sql.unit}` : '-', r.sql ? pct(r.sql.done, r.sql.total) : '-',
      r.sql ? num(r.sql.ads) : '-', r.sql ? num(r.sql.rows) : '-', r.sql ? num(r.sql.kept) : '-', r.sql ? r.sql.eta : '-',
    ]),
  ));
  if (tty && snap.decisions?.length) {
    out.push('', 'Decisions (why speed / parallelism changed — full list in decisions.log):');
    for (const l of snap.decisions) out.push(`  ${l}`);
  }
  const text = out.join('\n');
  if (tty) process.stdout.write(`\x1b[H\x1b[2J${text}\n`);
  else console.log(`\n${text}`);
}

// ── setup shared by dry run and apply ───────────────────────────────────────
async function connect(opts) {
  const networksConfig = require('../src/config/networks');
  const dbManager = require('../src/database/DatabaseManager');
  const overrides = readOverrides(opts);
  const scoped = {};
  const targets = {};
  for (const network of opts.networks) {
    const o = applyOverrides(network, networksConfig[network]?.database, overrides);
    const database = NETWORKS[network].tiktok ? { elastic_tiktok: o.elastic } : { elastic: o.elastic };
    if (o.sql) database.sql = o.sql; // also read for the placeholder SQL check with --only=es
    scoped[network] = { enabled: true, database };
    targets[network] = o;
  }
  await dbManager.connectAll(scoped);
  return { dbManager, targets };
}

function buildJobs(opts, dbManager, targets, dir) {
  const jobs = [];
  for (const network of opts.networks) {
    const spec = NETWORKS[network];
    const isDate = opts.mode === 'date' || (opts.mode === 'placeholder' && spec.rule === 'google-organic');
    const t = targets[network];
    const conns = dbManager.getConnections(network) || {};
    const wantSql = opts.doSql && Boolean(spec.mainTable);
    let rule;
    if (isDate) rule = { rule: opts.mode === 'date' ? 'before-date' : 'google-organic', before: opts.before, column: opts.dateColumn, esField: opts.mode === 'date' ? spec.esDateField : opts.dateColumn };
    else if (opts.mode === 'no-media') rule = { rule: 'no-media-v1', types: NO_MEDIA[network].types, keepSqlPatterns: opts.keepSqlPatterns };
    else rule = { rule: 'no-real-media-v2', patterns: opts.patterns, sqlPatterns: opts.sqlPatterns };
    const target = {
      es: `${t.elastic.node}|${t.elastic.index}`, sql: spec.mainTable ? `${t.sql.host}:${t.sql.port || 3306}/${t.sql.database}` : null,
      ...rule,
    };
    jobs.push({
      network, spec, dir, isDate,
      elastic: conns.elastic,
      sql: wantSql ? conns.sql : null,
      sqlRead: conns.sql || null,
      wantSql,
      esSelected: opts.doEs,
      host: spec.mainTable ? `${t.sql.host}:${t.sql.port || 3306}` : null,
      esKey: String(t.elastic.node),
      target, overridden: t.overridden, targets: t,
      idsFile: path.join(dir, `${network}.ids.jsonl`),
      state: loadState(dir, network, target, opts.restart),
      status: { es: { state: 'waiting', meter: new RateMeter() }, sql: { state: 'waiting', meter: new RateMeter() } },
      plan: null, mediaPlan: null,
    });
  }
  return jobs;
}

const safeUrl = (u) => String(u || '').replace(/\/\/[^@/]*@/, '//'); // never print credentials

/** Live check of every network's ES + SQL, asked from the server itself (cluster name/version, @@hostname, DATABASE()). */
async function checkConnection(j) {
  const t = j.targets;
  const out = {
    esNode: safeUrl(t.elastic.node), esIndex: t.elastic.index, esFrom: j.overridden.es ? 'script override' : 'config.json',
    sqlAddr: j.target.sql, sqlFrom: j.overridden.sql ? 'script override' : 'config.json',
  };
  if (!j.elastic) out.es = 'NOT CONNECTED';
  else {
    try {
      const info = unwrap(await j.elastic.client.info({}, { requestTimeout: 15000 }));
      const docs = await esCount(j.elastic, { match_all: {} });
      j.esTotal = docs;
      out.es = `OK · cluster "${info?.cluster_name}" v${info?.version?.number} · index ${j.elastic.indexName}: ${num(docs)} docs`;
    } catch (e) { out.es = `FAILED: ${String(e.message).slice(0, 120)}`; }
  }
  if (!j.spec.mainTable) out.sql = '(ES only — no SQL)';
  else if (!j.sqlRead) out.sql = 'NOT CONNECTED';
  else {
    try {
      const [r] = await q(j.sqlRead, 'SELECT @@hostname AS h, @@port AS p, DATABASE() AS d, VERSION() AS v');
      out.sql = `OK · server ${r.h}:${r.p} · db ${r.d} · MySQL ${r.v}${j.wantSql ? '' : ' · read only (not deleting SQL)'}`;
    } catch (e) { out.sql = `FAILED: ${String(e.message).slice(0, 120)}`; }
  }
  return out;
}

async function printTargets(jobs) {
  const checks = await Promise.all(jobs.map((j) => checkConnection(j).catch((e) => ({ es: `FAILED: ${e.message}`, sql: '' }))));
  console.log('\nConnections (checked live — confirm these before --apply)');
  jobs.forEach((j, i) => {
    const c = checks[i];
    let what = 'placeholder media';
    if (j.isDate) what = `${j.target.rule === 'google-organic' ? 'organic search, ' : 'ALL ads, '}ES ${j.target.esField} / SQL ${j.target.column} < ${j.target.before}`;
    else if (j.target.rule === 'no-media-v1') what = `no displayable media, types ${j.target.types.map((x) => x || '(empty)').join('/')}`;
    console.log(`  ${j.network.toUpperCase()}  (${what})`);
    console.log(`    ES   ${c.esNode} / index ${c.esIndex}   [from ${c.esFrom}]`);
    console.log(`         ${c.es}`);
    if (j.spec.mainTable) {
      console.log(`    SQL  ${c.sqlAddr}   [from ${c.sqlFrom}]`);
      console.log(`         ${c.sql}`);
    } else console.log(`    SQL  ${c.sql}`);
  });
  const bad = jobs.filter((j, i) => /FAILED|NOT CONNECTED/.test(`${checks[i].es} ${checks[i].sql}`)).map((j) => j.network);
  console.log(bad.length ? `  ⚠ connection problem: ${bad.join(', ')}` : '  all connections OK');
}

/**
 * Ensures the placeholder ID file exists and is current. Returns false when stopped.
 * A half-done run always keeps its file (the cursors point into it). A finished or
 * unstarted one is collected again when it is stale or with --recollect.
 */
async function ensureCollected(job, opts, onProgress) {
  const { state } = job;
  const started = state.es.offset > 0 || state.sql.offset > 0;
  const finished = (state.es.finished || !job.esSelected) && (state.sql.finished || !job.wantSql);
  const inProgress = started && !finished;
  const ageH = state.collectedAt ? (Date.now() - Date.parse(state.collectedAt)) / 3600000 : Infinity;
  const usable = state.collected && fs.existsSync(job.idsFile);
  if (inProgress && !usable) throw Object.assign(new Error(`${job.network}: run already started but ${job.idsFile} is missing. Use --restart.`), { fatal: true });
  if (usable && (inProgress || (!opts.recollect && ageH <= opts.idMaxAgeHours))) return true;
  if (job.sqlRead && job.spec.sqlMedia?.length && !job.mediaPlan) job.mediaPlan = await withRetry(() => sqlMediaPlan(job.sqlRead, job.spec));
  const r = await withRetry(() => collectPlaceholderIds(job, opts, onProgress), onProgress);
  if (!r) return false;
  const fresh = freshState();
  Object.assign(state, {
    collected: true, collectedAt: new Date().toISOString(), total: r.total, uniqueAds: r.uniqueAds,
    fromEs: r.fromEs, fromSql: r.fromSql, keptReal: r.keptReal, es: fresh.es, sql: fresh.sql,
  });
  saveState(job.dir, job.network, state);
  return true;
}

/** Child tables to delete from. Big tables with no index on the ad column are skipped unless --allow-unindexed. */
async function planSql(job, opts) {
  const plan = await withRetry(() => discoverChildTables(job.sqlRead, job.network, job.spec.mainTable, opts.exclude, job.spec.extraChildren));
  if (!opts.allowUnindexed) {
    const bad = new Set(unsafeUnindexed(plan));
    plan.children = plan.children.filter((c) => !bad.has(c));
    for (const c of bad) plan.skipped.push({ table: c.table, reason: `no index on ${c.col}, ${fmtBytes(c.tableBytes)} — whole-table scan per batch` });
  }
  job.plan = plan;
}

function sampleIds(job, max) {
  const ids = new Set();
  let offset = 0;
  while (ids.size < max) {
    const { records, next } = readChunk(job.idsFile, offset, 5000);
    if (!records.length) break;
    for (const r of records) {
      const id = Number(r.ad_id);
      if (Number.isSafeInteger(id) && id > 0) ids.add(id);
      if (ids.size >= max) break;
    }
    offset = next;
  }
  return [...ids];
}

// assumed speeds for the dry-run estimate until a run has measured them
const ASSUMED = { esDocsPerSec: 1000, sqlAdsPerSec: 150, dbqDocsPerSec: 2000, googleSqlAdsPerSec: 500 };

// ── dry run ─────────────────────────────────────────────────────────────────
async function dryRun(opts) {
  const dir = runDir(opts);
  console.log(`DRY RUN (nothing is deleted) — networks: ${opts.networks.join(', ')} — deletes from: ${opts.only === 'both' ? 'ES + SQL' : opts.only.toUpperCase()}`);
  if (opts.mode === 'date') console.log(`MODE: delete EVERY ad with last_seen before ${opts.before} (ES + SQL, all selected networks, no other condition)${opts.quick ? ' · quick mode' : ''}`);
  else if (opts.mode === 'no-media') console.log(`MODE no-media — media ads the search never shows (fail the displayable-media gate) · kept when SQL media contains: ${opts.keepSqlPatterns.join(', ')}${opts.quick ? ' · quick mode' : ''}`);
  else console.log(`MODE placeholder — ES patterns: ${opts.patterns.join(', ')} · SQL patterns: ${opts.sqlPatterns.join(', ')} · Google: organic search with ${opts.dateColumn} < ${opts.before}`);
  const { dbManager, targets } = await connect(opts);
  try {
    const jobs = buildJobs(opts, dbManager, targets, dir);
    await printTargets(jobs);
    for (const j of jobs) {
      if (!j.elastic) j.error = 'Elasticsearch not connected';
      else if (j.spec.mainTable && !j.sqlRead) j.error = 'SQL not connected';
    }

    // ── every network in parallel; the shared ES cluster and shared SQL hosts are governed by load ──
    const tty = Boolean(process.stdout.isTTY);
    const decisions = makeDecisionLog(dir, tty);
    const govs = new Map();
    for (const j of jobs.filter((x) => x.elastic)) {
      if (!govs.has(j.esKey)) govs.set(j.esKey, new ScanGovernor(j.elastic.client, opts, safeUrl(j.esKey), decisions.note));
      j.scanGov = govs.get(j.esKey);
    }
    const monitors = new Map();
    const hostSems = new Map();
    for (const j of jobs.filter((x) => x.sqlRead)) {
      if (!monitors.has(j.host)) { monitors.set(j.host, new HostMonitor(j.sqlRead, opts.maxThreadsRunning, 0)); hostSems.set(j.host, new Semaphore(2)); }
      j.hostMon = monitors.get(j.host);
      j.onDecision = decisions.note;
    }
    for (const [k, list] of groupBy(jobs.filter((x) => x.elastic), (j) => j.esKey)) {
      decisions.note(`ES ${safeUrl(k)}: ${list.length} networks (${list.map((j) => j.network).join(', ')}) scan in parallel — start with ${govs.get(k).sem.capacity} request slots, up to --scan-parallel=${opts.scanParallel} while heap < ${opts.maxHeap - 10}%, cpu < ${opts.maxCpu - 15}%, search queue ≤ ${opts.maxSearchQueue / 4}`);
    }
    for (const [h, list] of groupBy(jobs.filter((x) => x.sqlRead), (j) => j.host)) {
      decisions.note(`SQL ${h}: ${list.map((j) => j.network).join(' + ')}${list.length > 1 ? ' share this host — media checks run together, SQL probes max 2 at once' : ''}; pause while Threads_running > ${opts.maxThreadsRunning}`);
    }

    const startedAt = Date.now();
    for (const j of jobs) j.dp = { phase: j.error ? 'ERROR' : 'waiting', scanned: 0, total: 0, found: 0, meter: new RateMeter() };
    const setP = (j, p) => { Object.assign(j.dp, p); if (typeof p.scanned === 'number') j.dp.meter.add(p.scanned); };
    const draw = () => printDryProgress({ jobs, govs, monitors, decisions, startedAt, tty, opts });
    const govTick = setInterval(() => { for (const g of govs.values()) g.tick().catch(() => {}); }, 10000);
    await Promise.all([...govs.values()].map((g) => g.tick().catch(() => {})));
    const drawTimer = setInterval(draw, tty ? opts.progressMs : Math.max(30000, opts.progressMs));

    const sqlPart = async (j) => {
      if (!j.sqlRead) return;
      const sem = hostSems.get(j.host);
      setP(j, { phase: 'SQL probe (waiting for host slot)' });
      await sem.acquire();
      try {
        setP(j, { phase: 'SQL: table plan' });
        await planSql(j, opts);
        if (opts.quick) return;
        if (j.isDate) {
          setP(j, { phase: 'SQL: estimate (sampling id windows)' });
          const g = await withRetry(() => dateSqlEstimate(j.sqlRead, j.spec, opts));
          j.dry.sqlAds = g.est;
          setP(j, { phase: 'SQL: counting child rows', ads: g.est });
          j.probe = await probeSql(j.sqlRead, j.spec.mainTable, j.plan, g.sample, g.sample.length ? g.est / g.sample.length : 0);
          j.probe.sampled = g.sample.length;
        } else if (j.state.collected && j.state.total) {
          setP(j, { phase: 'SQL: counting child rows' });
          const ids = sampleIds(j, 5000);
          j.probe = await probeSql(j.sqlRead, j.spec.mainTable, j.plan, ids, ids.length ? Math.max(1, j.state.uniqueAds / ids.length) : 0);
          j.probe.sampled = ids.length;
          setP(j, { ads: j.probe.ads });
        }
      } finally { sem.release(); }
    };

    try {
      draw();
      await Promise.all(jobs.filter((x) => !x.error).map(async (j) => {
        try {
          setP(j, { phase: 'ES: counting' });
          const bpd = await esBytesPerDoc(j.elastic).catch(() => 0);
          if (j.isDate) {
            const docs = await withRetry(() => j.scanGov.run(() => esCount(j.elastic, dateEsQuery(j.spec, opts))));
            j.dry = { esDocs: docs, esBytes: docs * bpd };
            setP(j, { total: docs, scanned: docs, found: docs, fromEs: docs, fromSql: 0, ads: null });
            decisions.note(`${j.network}: ${num(docs)} ES docs match ${j.target.esField} < ${opts.before} — ES side is one server-side _delete_by_query task, no ID scan needed`);
          } else {
            const noMediaMode = opts.mode === 'no-media';
            const checkSql = !noMediaMode && Boolean(j.sqlRead && j.spec.sqlMedia.length);
            const esHits = await withRetry(() => j.scanGov.run(() => esCount(j.elastic, noMediaMode ? noMediaQuery(j.network) : buildQuery(j.spec, opts.patterns))));
            const noMedia = checkSql ? await withRetry(() => j.scanGov.run(() => esCount(j.elastic, missingMediaQuery(j.spec)))) : 0;
            j.dry = { esHits, noMedia, bpd };
            j.counts = { esHits, noMedia };
            setP(j, { total: esHits + noMedia });
            const sl = [scanSlices(esHits, opts.scanSlices), scanSlices(noMedia, opts.scanSlices)];
            if (noMediaMode) decisions.note(`${j.network}: ${num(esHits)} ES docs (types ${NO_MEDIA[j.network].types.map((x) => x || '(empty)').join('/')}) the search never shows → scroll slices ${sl[0]}; each page's SQL media is checked (keep if it contains ${opts.keepSqlPatterns.join(' / ')})`);
            else decisions.note(`${j.network}: ${num(esHits)} placeholder docs + ${num(noMedia)} docs without media fields to check in SQL → scroll slices ${sl[0]} / ${sl[1]}${sl[1] > 1 ? ` (big scan split into ${sl[1]} parallel slices)` : ''}`);
            if (!opts.quick && (esHits || noMedia)) {
              const ok = await ensureCollected(j, opts, (p) => {
                if (typeof p === 'object') setP(j, { phase: p.phase, scanned: p.scanned, total: p.total, found: p.found, fromEs: p.fromEs, fromSql: p.fromSql, ads: p.ads, keptReal: p.keptReal });
                else setP(j, { phase: String(p).slice(0, 40) });
              });
              if (!ok) return;
              setP(j, { scanned: j.dp.total, found: j.state.total, fromEs: j.state.fromEs, fromSql: j.state.fromSql, ads: j.state.uniqueAds, keptReal: j.state.keptReal });
              decisions.note(noMediaMode
                ? `${j.network}: ID scan done — ${num(j.state.total)} docs to delete; ${num(j.state.keptReal || 0)} docs KEPT because their SQL media has a NAS path (list: ${j.network}.kept-sql-media.jsonl); in ${fmtDuration(Date.now() - startedAt)}`
                : `${j.network}: ID scan done — ${num(j.state.total)} docs to delete (${num(j.state.fromEs)} ES media, ${num(j.state.fromSql)} SQL media); ${num(j.state.keptReal || 0)} pattern matches KEPT because another media field is real; in ${fmtDuration(Date.now() - startedAt)}`);
            } else {
              setP(j, { scanned: j.dp.total });
            }
          }
          await sqlPart(j);
          setP(j, { phase: 'done' });
        } catch (e) {
          j.error = e.message;
          setP(j, { phase: `ERROR: ${e.message}`.slice(0, 60) });
          decisions.note(`✗ ${j.network}: ${e.message}`);
        }
      }));
    } finally {
      clearInterval(govTick);
      clearInterval(drawTimer);
    }
    draw();
    console.log(`\nDecisions log: ${decisions.file}`);
    console.log('\nConnections used');
    for (const j of jobs) {
      console.log(`  ${j.network.padEnd(10)} ES ${safeUrl(j.targets.elastic.node)} / ${j.targets.elastic.index}   SQL ${j.target.sql || '(none)'}`);
    }

    // report
    const rows = jobs.map((j) => {
      const d = j.dry || {};
      const esDocs = j.isDate ? d.esDocs : (j.state.collected ? j.state.total : (d.esHits || 0));
      const esBytes = j.isDate ? d.esBytes : esDocs * (d.bpd || 0);
      const sqlAds = j.isDate ? d.sqlAds : j.probe?.ads;
      j.esMs = opts.doEs && esDocs ? (esDocs / (j.state.es.rate || (j.isDate ? ASSUMED.dbqDocsPerSec : ASSUMED.esDocsPerSec))) * 1000 : 0;
      j.sqlMs = opts.doSql && j.spec.mainTable && sqlAds ? (sqlAds / (j.isDate ? ASSUMED.googleSqlAdsPerSec : (j.state.sql.rate || ASSUMED.sqlAdsPerSec))) * 1000 : 0;
      j.esBytes = esBytes;
      return [
        j.network, j.isDate ? `before ${opts.before}` : (opts.mode === 'no-media' ? 'no media' : 'placeholder'), num(esDocs), j.isDate ? '-' : num(j.state.keptReal || 0), shareOf(esDocs, j.esTotal), esBytes ? `~${fmtBytes(esBytes)}` : '-',
        j.spec.mainTable ? (sqlAds != null ? `~${num(sqlAds)}` : '?') : '(ES only)',
        j.spec.mainTable ? shareOf(sqlAds, j.plan?.mainRows, true) : '-',
        j.probe ? `~${num(j.probe.rows)}` : '-', j.probe ? `~${fmtBytes(j.probe.bytes)}` : '-',
        j.esMs ? `~${fmtDuration(j.esMs)}` : '-', j.sqlMs ? `~${fmtDuration(j.sqlMs)}` : '-',
        (j.error || '').slice(0, 50),
      ];
    });
    console.log(`\n${renderTable(['NETWORK', 'WHAT', 'ES DOCS', 'KEPT: REAL MEDIA', 'ES % OF INDEX', 'ES SIZE', 'SQL ADS', 'SQL % OF TABLE', 'SQL ROWS', 'SQL SIZE', 'ES TIME', 'SQL TIME', 'ERROR'], rows)}`);
    const tot = jobs.reduce((t, j) => ({
      esBytes: t.esBytes + (j.esBytes || 0), sqlRows: t.sqlRows + (j.probe?.rows || 0), sqlBytes: t.sqlBytes + (j.probe?.bytes || 0),
    }), { esBytes: 0, sqlRows: 0, sqlBytes: 0 });
    console.log(`\nTotal: ~${fmtBytes(tot.esBytes)} in ES · ~${num(tot.sqlRows)} SQL rows (~${fmtBytes(tot.sqlBytes)})`);
    console.log(opts.mode === 'no-media'
      ? '"KEPT: REAL MEDIA" = docs without displayable media in ES whose SQL media has a NAS path — not deleted (counted by the full dry run, not --quick).'
      : '"KEPT: REAL MEDIA" = docs that matched a placeholder pattern in one field but have a real NAS/http image in another field — not deleted.');
    console.log('"% OF INDEX" = share of all docs in that ES index. "% OF SQL TABLE" = share of the main ad table (row count is the MySQL estimate, ~).');
    console.log('Sizes are estimates (average doc/row size × count). Disk is freed later: ES on segment merge, MySQL only after OPTIMIZE TABLE.');

    for (const j of jobs.filter((x) => x.plan)) {
      const per = new Map((j.probe?.perTable || []).map((p) => [`${p.table}.${p.col}`, p]));
      console.log(`\n${j.network} — SQL: ${j.spec.mainTable} + ${j.plan.children.length} child tables${j.probe ? ` (rows counted for ${num(j.probe.sampled)} sample ads, scaled)` : ''}`);
      for (const c of j.plan.children) {
        const p = per.get(`${c.table}.${c.col}`);
        const rowsTxt = p ? (p.rows == null ? 'not counted (no index)' : `~${num(p.rows)} rows ~${fmtBytes(p.bytes)}`) : '';
        console.log(`    ${`${c.table}.${c.col}`.padEnd(52)} ${c.indexed ? 'indexed  ' : 'NO INDEX '} ${rowsTxt}`);
      }
      for (const s of j.plan.skipped) console.log(`    skipped: ${s.table} (${s.reason})`);
    }

    // binary logs per SQL host (read-only; the MINIMAL test only changes this script's own session)
    const hostJobs = groupBy(jobs.filter((x) => x.sqlRead && x.wantSql), (j) => j.host);
    const binlogs = new Map();
    await Promise.all([...hostJobs.entries()].map(async ([h, list]) => { binlogs.set(h, await binlogInfo(list[0].sqlRead).catch((e) => ({ error: e.message }))); }));
    if (binlogs.size) {
      console.log('\nBinary logs per SQL host (every deleted row is written there — check the DB disk)');
      console.log(renderTable(['SQL HOST', 'NETWORKS', 'BINLOG', 'FORMAT / ROW IMAGE', 'NOW', 'EXPIRE', 'SCRIPT USES', 'EST. BINLOG GROWTH'], [...hostJobs.entries()].map(([h, list]) => {
        const b = binlogs.get(h) || {};
        const rows = list.reduce((t, j) => t + (j.probe?.rows || 0), 0);
        const bytes = list.reduce((t, j) => t + (j.probe?.bytes || 0), 0);
        const minimal = b.logBin && opts.binlogMinimal && b.minimalOk;
        const growth = !b.logBin ? '0 (binlog off)' : (minimal ? `~${fmtBytes(rows * 60)} (keys only)` : (b.rowImage === 'MINIMAL' ? `~${fmtBytes(rows * 60)}` : `~${fmtBytes(bytes)} ⚠ FULL rows`));
        return [h, list.map((j) => j.network).join(' + '), b.error ? `? ${b.error.slice(0, 30)}` : (b.logBin ? 'ON' : 'OFF'), `${b.format || '-'} / ${b.rowImage || '-'}`,
          b.bytes == null ? 'not readable' : fmtBytes(b.bytes), b.expireSec ? fmtDuration(b.expireSec * 1000) : '-',
          !b.logBin ? '-' : (minimal ? 'MINIMAL' : (opts.binlogMinimal ? `FULL (${b.minimalErr || 'MINIMAL denied'})` : 'server default')), growth];
      })));
      console.log(`Deletes on a host pause once its binlogs grow ${opts.maxBinlogGrowthGb} GB since the start (--max-binlog-growth-gb); "not readable" = no REPLICATION CLIENT privilege, guard off there.`);
    }

    // plan + finish-by (ES clusters and SQL hosts run in parallel; networks on one SQL host one after another)
    const now = Date.now();
    const at = (ms) => new Date(now + ms).toISOString().slice(0, 16).replace('T', ' ');
    const hostStart = new Map();
    const planRows = jobs.map((j) => {
      const sqlStart = j.host ? (hostStart.get(j.host) || 0) : 0;
      if (j.host) hostStart.set(j.host, sqlStart + (j.sqlMs || 0));
      const sqlEnd = j.sqlMs ? sqlStart + j.sqlMs : 0;
      j.finishMs = Math.max(j.esMs || 0, sqlEnd);
      return [j.network, num(j.dry?.esDocs ?? (j.state.collected ? j.state.total : j.dry?.esHits) ?? 0), j.esMs ? fmtDuration(j.esMs) : '-',
        j.spec.mainTable ? (j.probe ? num(j.probe.ads) : (j.dry?.sqlAds != null ? num(j.dry.sqlAds) : '-')) : '(ES only)',
        j.sqlMs ? fmtDuration(j.sqlMs) : '-', sqlStart ? `after ${fmtDuration(sqlStart)}` : (j.sqlMs ? 'now' : '-'),
        j.finishMs ? `~${fmtDuration(j.finishMs)}` : '-', j.finishMs ? at(j.finishMs) : '-', j.host || '(ES only)'];
    });
    console.log(`\nPlan — when will it be done? (if --apply started now: ${at(0)} UTC)`);
    console.log(renderTable(['NETWORK', 'ES DOCS', 'ES TIME', 'SQL ADS', 'SQL TIME', 'SQL STARTS', 'DONE IN', 'DONE AT (UTC)', 'SQL HOST'], planRows));

    // time: ES clusters and SQL hosts run in parallel
    const esClusters = new Map();
    for (const j of jobs) esClusters.set(j.esKey, (esClusters.get(j.esKey) || 0) + (j.esMs || 0));
    const sqlHosts = new Map();
    for (const j of jobs.filter((x) => x.host)) sqlHosts.set(j.host, (sqlHosts.get(j.host) || 0) + (j.sqlMs || 0));
    console.log('\nTime estimate (ES clusters and SQL hosts run in parallel; networks on one SQL host one after another)');
    for (const [k, ms] of esClusters) console.log(`  ES  ${k}: ~${fmtDuration(ms)}`);
    for (const [h, ms] of sqlHosts) console.log(`  SQL ${h}: ~${fmtDuration(ms)}  (${jobs.filter((x) => x.host === h).map((x) => x.network).join(' → ')})`);
    const overall = Math.max(0, ...esClusters.values(), ...sqlHosts.values());
    console.log(`  Overall: ~${fmtDuration(overall)} — estimated from typical speeds; the live run shows the real ETA (assumed speeds: SQL ~${ASSUMED.googleSqlAdsPerSec} ads/s per host, ES ~${ASSUMED.dbqDocsPerSec} docs/s per cluster). Excludes pauses.`);
    console.log(`  Finish (if --apply started now): ~${at(overall)} UTC`);
    const cmd = opts.mode === 'no-media' ? 'node scripts/delete-no-media-ads.js' : 'node scripts/delete-placeholder-media.js';
    console.log(`\nNothing was deleted. To delete: ${cmd} --apply   (or --apply=es / --apply=sql)`);
    return jobs.some((j) => j.error) ? EXIT.FAILED : EXIT.OK;
  } finally {
    await dbManager.disconnectAll().catch(() => {});
  }
}

function groupBy(list, keyOf) {
  const m = new Map();
  for (const x of list) {
    const k = keyOf(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

// ── apply (worker) ──────────────────────────────────────────────────────────
async function applyRun(opts) {
  try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted: fine */ }
  const dir = runDir(opts);
  const { dbManager, targets } = await connect(opts);
  const startedAt = Date.now();
  let timer = null;
  try {
    const jobs = buildJobs(opts, dbManager, targets, dir);
    await printTargets(jobs);
    const missing = jobs.filter((j) => !j.elastic || (j.spec.mainTable && !j.sqlRead));
    if (missing.length) {
      // likely down right now → exit non-fatal so the supervisor retries later
      throw new Error(`not connected: ${missing.map((j) => `${j.network} ${!j.elastic ? 'ES' : 'SQL'}`).join(', ')}`);
    }
    const active = jobs.filter((j) => {
      if (!j.esSelected && !j.wantSql) return false; // --only=sql and this network has no SQL
      if (j.state.failures >= 3) { log(`skipping ${j.network}: failed 3 times (${j.state.lastError}). Fix it, then --restart.`); return false; }
      return true;
    });

    const tty = process.stdout.isTTY;
    const decisions = makeDecisionLog(dir, tty);
    const controllers = new Map();
    const govs = new Map();
    for (const j of active) {
      if (!controllers.has(j.esKey)) {
        const c = new EsController(j.elastic.client, opts);
        c.onDecision = (m) => decisions.note(`${safeUrl(j.esKey)} ${m}`);
        c.dbqSem = new Semaphore(opts.dbqParallel);
        controllers.set(j.esKey, c);
        govs.set(j.esKey, new ScanGovernor(j.elastic.client, opts, safeUrl(j.esKey), decisions.note));
      }
      j.ctl = controllers.get(j.esKey);
      j.scanGov = govs.get(j.esKey);
      j.onDecision = decisions.note;
    }
    for (const [k, list] of groupBy(active, (j) => j.esKey)) {
      if (list.some((j) => j.isDate)) decisions.note(`ES ${safeUrl(k)}: ${list.filter((j) => j.isDate).length} delete-by-query tasks — max ${opts.dbqParallel} at once (--dbq-parallel), sharing --es-dbq-rps=${opts.esDbqRps} docs/s, lowered by the load controller on heap/cpu/queue pressure`);
      decisions.note(`ES ${safeUrl(k)}: ${list.map((j) => j.network).join(', ')} delete in parallel — bulk slots start at 1, grow to --es-parallel=${opts.esParallel} while heap < ${opts.maxHeap - 10}%, cpu < ${opts.maxCpu - 15}%, write queue ≤ ${opts.maxWriteQueue / 2}; halve + pause 30s on pressure`);
    }
    const monitors = new Map();
    const sqlGovs = new Map();
    for (const j of active.filter((x) => x.wantSql)) {
      if (!monitors.has(j.host)) {
        const m = new HostMonitor(j.sql, threadsLimitFor(j.host, opts), opts.maxBinlogGrowthGb, opts.maxDbCpu);
        m.name = j.host;
        m.onDecision = decisions.note;
        monitors.set(j.host, m);
        const on = active.filter((x) => x.wantSql && x.host === j.host).map((x) => x.network);
        const bl = await binlogInfo(j.sql).catch(() => null);
        if (bl) {
          decisions.note(`SQL ${j.host}: binlog ${bl.logBin ? `ON (${bl.format}, row image ${bl.rowImage}, ${bl.bytes == null ? 'size not readable — growth guard OFF for this host' : `now ${fmtBytes(bl.bytes)}`})` : 'OFF'}`
            + `${bl.logBin && opts.binlogMinimal ? (bl.minimalOk ? ' · script sessions use MINIMAL (only primary keys logged)' : ` · MINIMAL not allowed (${bl.minimalErr}) — FULL rows logged`) : ''}`);
        }
        sqlGovs.set(j.host, new SqlGovernor(j.host, m, opts, decisions.note));
        m.gov = sqlGovs.get(j.host);
        decisions.note(`SQL ${j.host}: ${on.join(' → ')}${on.length > 1 ? ' share this host (one network after another)' : ''}; up to ${opts.sqlParallel} delete batches at once over ${opts.sqlShards} id ranges (starts at 2, adapts); pause while Threads_running > ${m.limit}${threadsLimitFor(j.host, opts) !== opts.maxThreadsRunning ? ` (= ${opts.maxDbCpu}% of the host's vCPUs)` : ''}`);
      }
      j.hostMon = monitors.get(j.host);
      await planSql(j, opts);
      for (const s of j.plan.skipped) log(`${j.network}: skipping ${s.table} (${s.reason})`);
    }

    // planned totals so the live table shows "done / total" and an ETA from the first minute
    await Promise.all(active.filter((j) => j.isDate && j.esSelected && !j.state.es.finished).map(async (j) => {
      j.status.es.state = 'counting';
      j.esPlanned = await withRetry(() => j.scanGov.run(() => esCount(j.elastic, dateEsQuery(j.spec, opts)))).catch(() => 0);
      j.esPlanned += j.state.es.deleted || 0; // a resumed run: already deleted + still matching
      j.status.es.state = 'queued';
      decisions.note(`${j.network}: ${num(j.esPlanned)} ES docs to delete (${j.target.esField} < ${opts.before})`);
    }));

    const tick = async () => {
      await Promise.all([...controllers.values(), ...govs.values()].map((c) => c.tick().catch(() => {})));
      const snap = progressSnapshot(active, controllers, monitors, startedAt);
      snap.summary = progressSummary(snap, active);
      snap.decisions = decisions.recent.slice(-8);
      fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(snap, null, 2));
      printProgress(snap, tty);
    };
    await Promise.all([...controllers.values()].map((c) => c.tick().catch(() => {})));
    timer = setInterval(() => { tick().catch(() => {}); }, opts.progressMs);
    const sqlTimer = setInterval(() => { for (const g of sqlGovs.values()) g.tick().catch(() => {}); }, 15000);

    const failures = [];
    const guard = async (job, fn) => {
      try {
        await fn();
      } catch (e) {
        if (e.fatal) throw e;
        if (stopping) return; // interrupted while waiting/retrying: not a failure
        job.state.failures += 1;
        job.state.lastError = String(e.message).slice(0, 300);
        saveState(dir, job.network, job.state);
        failures.push(`${job.network}: ${e.message}`);
        for (const l of ['es', 'sql']) if (job.status[l].state !== 'done') job.status[l].state = `FAILED: ${e.message}`.slice(0, 60);
      }
    };

    // placeholder IDs: every network collects in parallel (bounded per ES cluster by the scan
    // semaphore + load gate); each network's lanes start as soon as its own IDs are ready
    const ready = new Map();
    for (const j of active) {
      if (j.isDate) { ready.set(j.network, Promise.resolve(true)); continue; }
      ready.set(j.network, (async () => {
        if (stopping) return false;
        const show = (s) => { if (j.esSelected) j.status.es.state = s; if (j.wantSql) j.status.sql.state = s; };
        show('collecting ids');
        const ok = await ensureCollected(j, opts, (p) => show(typeof p === 'object'
          ? `collecting: ${p.phase} ${pct(p.scanned, p.total)} (${num(p.found)} found)` : String(p)));
        if (ok) show('queued');
        return ok;
      })().catch((e) => { if (e.fatal) throw e; failures.push(`${j.network}: ${e.message}`); return false; }));
    }

    const esWork = active.filter((j) => j.esSelected).map((j) => (async () => {
      if (!(await ready.get(j.network))) return;
      if (j.isDate) await guard(j, () => runDateEsLane(j, opts));
      else await guard(j, () => (opts.mode === 'no-media' ? runPooledEsLane(j, opts) : runEsLane(j, opts)));
    })());
    const sqlWork = [...groupBy(active.filter((x) => x.wantSql), (j) => j.host).entries()].map(async ([host, list]) => {
      if (opts.mode === 'no-media') {
        // every network on the host at once: the host's SqlGovernor caps the batches in flight
        await Promise.all(list.map(async (j) => {
          if (stopping || !(await ready.get(j.network))) return;
          await guard(j, () => runPooledSqlLane(j, opts, monitors.get(host), sqlGovs.get(host)));
        }));
        return;
      }
      for (const j of list) {
        if (stopping) break;
        if (!(await ready.get(j.network))) continue;
        await guard(j, () => (j.isDate ? runDateSqlLane(j, opts, monitors.get(host), sqlGovs.get(host)) : runSqlLane(j, opts, monitors.get(host))));
      }
    });
    await Promise.all([...esWork, ...sqlWork]);
    clearInterval(sqlTimer);
    clearInterval(timer);
    timer = null;
    await tick();

    const report = { finishedAt: new Date().toISOString(), opts: { ...opts, esPass: opts.esPass ? '***' : '' }, networks: active.map((j) => ({ network: j.network, target: j.target, ...j.state })) };
    const reportFile = path.join(dir, `report-apply-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`\nReport → ${reportFile}`);
    if (stopping) { console.log('Stopped. Re-run the same command to continue from here.'); return EXIT.STOPPED; }
    if (failures.length) { console.log(`Failures:\n  ${failures.join('\n  ')}`); return EXIT.FAILED; }
    console.log('All done.');
    return EXIT.OK;
  } finally {
    if (timer) clearInterval(timer);
    await dbManager.disconnectAll().catch(() => {});
  }
}

// ── supervisor: restarts the worker after a crash / outage ──────────────────
async function supervise(argv, opts) {
  let userStop = false;
  let restarts = 0;
  let child = null;
  process.on('SIGINT', () => {
    if (userStop) { child?.kill('SIGKILL'); process.exit(130); }
    userStop = true;
    console.log('\n[supervisor] stopping after the current batch… (Ctrl+C again to force)');
    // In a terminal the worker gets Ctrl+C itself; forwarding it would count as a second
    // (force) Ctrl+C. Without a terminal (nohup / kill -INT) it must be passed on.
    if (!process.stdout.isTTY) child?.kill('SIGINT');
  });
  process.on('SIGTERM', () => { userStop = true; child?.kill('SIGTERM'); });
  for (;;) {
    const started = Date.now();
    const code = await new Promise((resolve) => {
      child = spawn(process.execPath, [`--max-old-space-size=${opts.maxHeapMb}`, __filename, ...argv, '--worker'], { stdio: 'inherit' });
      child.on('exit', (c, sig) => resolve(c ?? (sig ? 128 : EXIT.FAILED)));
      child.on('error', () => resolve(EXIT.FAILED));
    });
    child = null;
    if (code === EXIT.OK || code === EXIT.STOPPED || code === EXIT.FATAL || userStop) return code;
    if (Date.now() - started > 10 * 60000) restarts = 0; // it ran for a while: a fresh failure, not a crash loop
    restarts += 1;
    if (restarts > opts.maxRestarts) {
      console.log(`[supervisor] worker failed ${restarts - 1} times in a row — giving up. Re-run to continue; progress is saved.`);
      return code;
    }
    const wait = Math.min(300000, 10000 * 2 ** Math.min(restarts - 1, 5));
    console.log(`[supervisor] worker exited with code ${code} — restart ${restarts}/${opts.maxRestarts} in ${fmtDuration(wait)} (continues from saved progress)`);
    const end = Date.now() + wait;
    while (!userStop && Date.now() < end) await sleep(500);
    if (userStop) return EXIT.STOPPED;
  }
}

function printStatus(opts) {
  const f = path.join(path.resolve(process.cwd(), 'data', 'placeholder-media', opts.run), 'progress.json');
  if (!fs.existsSync(f)) { console.log(`No progress file yet: ${f}`); return EXIT.OK; }
  printProgress(JSON.parse(fs.readFileSync(f, 'utf8')), false);
  return EXIT.OK;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`${e.message}\n\n${usage()}`);
    return EXIT.FATAL;
  }
  if (opts.help) { console.log(usage()); return EXIT.OK; }
  if (opts.status) return printStatus(opts);
  if (opts.mode === 'no-media') {
    try { assertGateUpToDate(); } catch (e) { console.error(`FATAL: ${e.message}`); return EXIT.FATAL; }
  }
  if (!opts.apply) return dryRun(opts);
  if (opts.supervise && !opts.worker) return supervise(argv, opts);

  process.on('SIGINT', () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log('\nStopping after the current batch (progress is saved)…');
  });
  process.on('SIGTERM', () => { stopping = true; });
  try {
    return await applyRun(opts);
  } catch (e) {
    console.error(`${e.fatal ? 'FATAL' : 'ERROR'}: ${e.message}`);
    return e.fatal ? EXIT.FATAL : EXIT.FAILED;
  }
}

if (require.main === module) {
  main().then(
    (code) => { process.exit(code); },
    (e) => { console.error(e); process.exit(EXIT.FAILED); },
  );
}

module.exports = {
  NETWORKS, parseArgs, fmtDuration, fmtBytes, applyOverrides, readOverrides, isTransient, Semaphore, EsController, ScanGovernor, scanSlices,
  Throttle, readChunk, isPlaceholderDoc, hasRealMedia, buildQuery, missingMediaQuery, dateEsQuery, idList, sqlMediaPlan, sqlPlaceholderAds,
  discoverChildTables, unsafeUnindexed, deleteSqlBatch, HostMonitor, SqlGovernor, cpuPercent, threadsLimitFor, runDateSqlLane, binlogInfo, adsWithRealMedia, main,
  NO_MEDIA, networksFor, visibleQuery, noMediaQuery, assertGateUpToDate, collectNoMediaIds, adsVisibleInEs, runOrderedPool,
  runPooledEsLane, runPooledSqlLane,
};
