require('dotenv').config();
const queryDatabase = require('../db-connections/connection');

/**
 * Centralized dynamic ad-count API — one endpoint that powers BOTH the admin
 * panel's crawler-insight cards AND the DS team's daily Telegram report, so the
 * two stay in sync.
 *
 *   POST /admin-panel/network-name/get-count
 *
 * Every metric reproduces the matching DS query (see
 * C:\Users\Admin\Downloads\Telegram Desktop\DU_queries_latest\<net>.py) exactly,
 * but with an explicit 12am->12am window so it's correct for any range / call
 * time (DS's daily cron leaves the upper bound implicit at "now ≈ midnight").
 *
 * Request body:
 *   network   required — facebook | instagram | google | gdn | native |
 *                        pinterest | quora | reddit | youtube | bing | linkedin
 *   metric    optional — default "range". One of:
 *       range     → { newCount, activeCount }  — Unique + Total cards in one call
 *       new       → { total }, or with `groupBy` { total, groupBy, buckets:[{key,count}] }
 *                   — Unique Ads card / DS "Yesterday Ads" + "New Ads based on
 *                   Type/Position/Source"
 *       active    → { total }                  — Total Ads card / DS "Yesterday Total Ads"
 *       platform  → { total } (with `platform`) or { total, buckets:[{platform,count}] }
 *                   — plugin cards / DS "New Ads per Platform"
 *       processed → { total } — requires `stage` — DS "Destination URLs / Google
 *                   ScreenShot / Builtwith Processed"
 *   range     { from, to } (YYYY-MM-DD) — required. Applied as
 *             [from 00:00:00, (to+1) 00:00:00) = 12am->12am.
 *   platform  optional, metric=platform only — plugin code (int) or array, e.g.
 *             3 / [3,10,12,15]. 3=User, 10=Scroll, 12=Python, 15=Meta. Omit to
 *             get every platform as buckets.
 *   groupBy   optional, metric=new only — type | ad_position | source. Returns the
 *             per-bucket breakdown (always on first_seen, matching DS).
 *   stage     required for metric=processed — destination | screenshot | builtwith
 *             (DS white_lander_date / screenshot_date / built_with_date).
 *
 *   NOTE: the lifetime whole-table "Total Ads" count is NOT served here — it
 *   comes from Elasticsearch (fast, with the displayable-media filter) via
 *   POST /admin-panel/network-name/get-ads-count (src/total-ad-count-analytics.js).
 *   DS should use that endpoint for their daily "Total Ads" line.
 *
 * Response: { code, message, data: <shape per metric above> }
 *
 * SQL-safety: table/column names come only from the fixed config + metric
 * allow-list below; never from request input. Only values are bound (?).
 */

// Per-network mapping, verified against the dev DB schema + the DS queries:
//   firstSeen        → column for "new ads" (created_date for youtube/pinterest;
//                      first_seen elsewhere) — matches DS "Yesterday Ads".
//   created          → date column for the per-platform breakdown on the
//                      platform table (created_at for linkedin; created_date else).
//   platformOnMain   → Facebook keeps `platform` on its main table; everyone else
//                      keeps it on <net>_ad_meta_data.
//   platformCountCol → COUNT() column for the per-platform query (DS counts the FK
//                      for bing/linkedin, `id` for the rest / facebook-on-main).
//   metaCountCol     → COUNT() column for the meta-table "processed" queries (DS
//                      counts the FK for bing/facebook/linkedin, `id` for the rest).
//   db_id            → prod server index (see db-connections/connection.js).
const DB_DATA = {
    bing:      { main: 'bing_text_ad',   meta: 'bing_text_ad_meta_data',   firstSeen: 'first_seen',   created: 'created_date', platformOnMain: false, platformCountCol: 'bing_text_ad_id', metaCountCol: 'bing_text_ad_id', db_id: 10, index: process.env.BING_DATABASE },
    facebook:  { main: 'facebook_ad',    meta: 'facebook_ad_meta_data',    firstSeen: 'first_seen',   created: 'created_date', platformOnMain: true,  platformCountCol: 'id',              metaCountCol: 'facebook_ad_id',  db_id: 0,  index: process.env.FB_DATABASE },
    gdn:       { main: 'gdn_ad',         meta: 'gdn_ad_meta_data',         firstSeen: 'first_seen',   created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 5,  index: process.env.GDN_DATABASE },
    google:    { main: 'google_text_ad', meta: 'google_text_ad_meta_data', firstSeen: 'first_seen',   created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 9,  index: process.env.GT_DATABASE },
    instagram: { main: 'instagram_ad',   meta: 'instagram_ad_meta_data',   firstSeen: 'first_seen',   created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 8,  index: process.env.INSTA_DATABASE },
    linkedin:  { main: 'linkedin_ad',    meta: 'linkedin_ad_meta_data',    firstSeen: 'first_seen',   created: 'created_at',   platformOnMain: false, platformCountCol: 'linkedin_ad_id',  metaCountCol: 'linkedin_ad_id',  db_id: 2,  index: process.env.LINKEDIN_DATABASE },
    native:    { main: 'native_ad',      meta: 'native_ad_meta_data',      firstSeen: 'first_seen',   created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 3,  index: process.env.NATIVE_DATABASE },
    pinterest: { main: 'pinterest_ad',   meta: 'pinterest_ad_meta_data',   firstSeen: 'created_date', created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 6,  index: process.env.PINT_DATABASE },
    quora:     { main: 'quora_ad',       meta: 'quora_ad_meta_data',       firstSeen: 'first_seen',   created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 7,  index: process.env.QUORA_DATABASE },
    reddit:    { main: 'reddit_ad',      meta: 'reddit_ad_meta_data',      firstSeen: 'first_seen',   created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 4,  index: process.env.REDDIT_DATABASE },
    youtube:   { main: 'youtube_ad',     meta: 'youtube_ad_meta_data',     firstSeen: 'created_date', created: 'created_date', platformOnMain: false, platformCountCol: 'id',              metaCountCol: 'id',              db_id: 1,  index: process.env.YT_DATABASE },
};

const METRICS = new Set(['range', 'new', 'active', 'platform', 'processed']);

// metric=new breakdowns — DS groups these on the MAIN table by first_seen (all networks).
const GROUP_FIELDS = new Set(['type', 'ad_position', 'source']);

// metric=processed — DS counts meta-table rows whose <dateCol> falls in the window.
const PROCESSED_DATE = {
    destination: 'white_lander_date', // "Destination URLs Processed"
    screenshot:  'screenshot_date',   // "Google ScreenShot Processed"
    builtwith:   'built_with_date',   // "Builtwith Processed"
};

// LinkedIn splits the processed stages across dedicated tables; every other
// network keeps all three on <net>_ad_meta_data (the cfg.meta default).
const LINKEDIN_PROCESSED_TABLES = {
    destination: 'linkedin_ad_lander',
    screenshot:  'linkedin_ad_meta_data',
    builtwith:   'linkedin_ad_built_with',
};

// DS uses an exclusive next-midnight upper bound (`col < day+1`). Add one calendar
// day to a YYYY-MM-DD string; UTC-safe so there's no local-offset drift.
function nextDay(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

// Snapshot timezone — MUST match the pas_node_api cron's config.crons.timezone so
// "today" lines up on both sides. (SNAPSHOT_TODAY overrides today — tests only.)
const SNAPSHOT_TZ = process.env.SNAPSHOT_TZ || 'Asia/Kolkata';

function tzToday() {
    if (process.env.SNAPSHOT_TODAY) return process.env.SNAPSHOT_TODAY;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: SNAPSHOT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

function addDays(dateStr, n) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

const num = (rows) => Number(rows?.[0]?.cnt || 0);
const ok = (res, data) => res.status(200).json({ code: 200, message: 'success', data });

// "new" / Unique Ads — COUNT(id) FROM main WHERE <firstSeen> in window.
const newAdsSql = (cfg) =>
    `SELECT COUNT(id) AS cnt FROM ${cfg.main} WHERE ${cfg.firstSeen} >= ? AND ${cfg.firstSeen} < ?`;

// "active" / Total Ads — ads whose last sighting falls in the window:
//   last_seen >= from  AND  last_seen < (to+1)     (same 12am->12am bound, both on last_seen)
// This is the single agreed definition shared with the DS team — DS calls this
// API instead of their own query, so the admin panel and the daily report run the
// identical SQL. NOTE: last_seen is a moving field (active ads get re-crawled and
// roll out of the window), so the same date can read slightly differently at
// different times of day; for exact admin<->DS agreement, query at a consistent
// time (or snapshot daily). See docs/get-count-api.md.
const activeAdsSql = (cfg) =>
    `SELECT COUNT(id) AS cnt FROM ${cfg.main} WHERE last_seen >= ? AND last_seen < ?`;

// "active" / Total Ads — reads the FROZEN per-day snapshot for past days (so the
// number stays consistent instead of shrinking as last_seen moves), live-counts
// TODAY (window still open), and SUMS the daily snapshots across a multi-day range.
// Falls back to a live bounded count if a past day's snapshot is missing or the
// snapshots table doesn't exist yet — so it's never blank. The nightly snapshot
// job lives in pas_node_api (src/jobs/activeCountSnapshotJob.js).
async function computeActiveCount(run, cfg, range) {
    const { from, to } = range;
    const today = tzToday();
    const yesterday = addDays(today, -1);
    const pastTo = to < yesterday ? to : yesterday;   // last past day inside the range
    const includesToday = from <= today && to >= today;

    let total = 0;

    if (from <= pastTo) {
        let rows = null;
        try {
            rows = await run(
                `SELECT snapshot_date, active_count FROM active_count_snapshots WHERE snapshot_date >= ? AND snapshot_date <= ?`,
                [from, pastTo],
            );
        } catch (_) {
            rows = null; // table not created yet → live fallback below
        }
        if (rows && rows.length) {
            total += rows.reduce((s, r) => s + Number(r.active_count || 0), 0);
        } else {
            // no snapshots for the past portion → live bounded count for [from, pastTo]
            total += num(await run(activeAdsSql(cfg), [`${from} 00:00:00`, `${nextDay(pastTo)} 00:00:00`]));
        }
    }

    if (includesToday) {
        total += num(await run(activeAdsSql(cfg), [`${today} 00:00:00`, `${nextDay(today)} 00:00:00`]));
    }

    return total;
}

const dynamicCountFilter = async (req, res) => {
    try {
        const { network, range, metric = 'range', platform, groupBy, stage } = req.body || {};

        const cfg = DB_DATA[network];
        if (!network || !cfg) {
            return res.status(400).json({ message: 'Please provide a valid network' });
        }
        if (!METRICS.has(metric)) {
            return res.status(400).json({ message: `Invalid metric. Allowed: ${[...METRICS].join(', ')}` });
        }
        if (groupBy && !GROUP_FIELDS.has(groupBy)) {
            return res.status(400).json({ message: `Invalid groupBy. Allowed: ${[...GROUP_FIELDS].join(', ')}` });
        }
        if (metric === 'processed' && !PROCESSED_DATE[stage]) {
            return res.status(400).json({ message: `metric "processed" requires stage. Allowed: ${Object.keys(PROCESSED_DATE).join(', ')}` });
        }

        const hasRange = Boolean(range && range.from && range.to);
        if (!hasRange) {
            return res.status(400).json({ message: `metric "${metric}" requires range { from, to }` });
        }

        const fromTs = hasRange ? `${range.from} 00:00:00` : null;
        const toTs = hasRange ? `${nextDay(range.to)} 00:00:00` : null;
        const win = [fromTs, toTs];

        const { db_id, index } = cfg;
        const run = (sql, params) => queryDatabase(db_id, index, sql, params);

        switch (metric) {
            case 'new': {
                // DS "New Ads based on Type/Position/Source" — group on the main
                // table by first_seen (DS uses first_seen here for every network,
                // even youtube/pinterest whose plain "new" total uses created_date).
                if (groupBy) {
                    const sql = `SELECT ${groupBy} AS bucket, COUNT(id) AS cnt FROM ${cfg.main}
                                 WHERE first_seen >= ? AND first_seen < ?
                                 GROUP BY ${groupBy} ORDER BY cnt DESC`;
                    const rows = await run(sql, win);
                    const buckets = (rows || []).map((r) => ({ key: r.bucket, count: Number(r.cnt || 0) }));
                    const total = buckets.reduce((acc, b) => acc + b.count, 0);
                    return ok(res, { total, groupBy, buckets });
                }
                const rows = await run(newAdsSql(cfg), win);
                return ok(res, { total: num(rows) });
            }
            case 'active': {
                const total = await computeActiveCount(run, cfg, range);
                return ok(res, { total });
            }
            case 'range': {
                const [newRows, activeTotal] = await Promise.all([
                    run(newAdsSql(cfg), win),
                    computeActiveCount(run, cfg, range),
                ]);
                return ok(res, { newCount: num(newRows), activeCount: activeTotal });
            }
            case 'platform': {
                // Plugin cards / DS "New Ads per Platform". Platform lives on the
                // main table for Facebook, on <net>_ad_meta_data for everyone else.
                const table = cfg.platformOnMain ? cfg.main : cfg.meta;
                const col = cfg.platformCountCol;
                const dateCol = cfg.created;

                // Normalize platform → integer list (or null for "all → buckets").
                let platforms = null;
                if (platform !== undefined && platform !== null && platform !== '') {
                    platforms = (Array.isArray(platform) ? platform : [platform])
                        .map((p) => Number(p))
                        .filter((p) => Number.isInteger(p));
                    if (!platforms.length) {
                        return res.status(400).json({ message: 'platform must be an integer or array of integers' });
                    }
                }

                if (platforms) {
                    const inList = platforms.map(() => '?').join(', ');
                    const sql = `SELECT COUNT(${col}) AS cnt FROM ${table}
                                 WHERE ${dateCol} >= ? AND ${dateCol} < ? AND platform IN (${inList})`;
                    const rows = await run(sql, [...win, ...platforms]);
                    return ok(res, { total: num(rows) });
                }

                const sql = `SELECT platform, COUNT(${col}) AS cnt FROM ${table}
                             WHERE ${dateCol} >= ? AND ${dateCol} < ?
                             GROUP BY platform ORDER BY cnt DESC`;
                const rows = await run(sql, win);
                const buckets = (rows || []).map((r) => ({ platform: r.platform, count: Number(r.cnt || 0) }));
                const total = buckets.reduce((acc, b) => acc + b.count, 0);
                return ok(res, { total, buckets });
            }
            case 'processed': {
                // DS pipeline-stage counts: COUNT(<fk>) FROM <meta> WHERE <stageDate> in window.
                // LinkedIn keeps each stage on its own table; everyone else uses cfg.meta.
                const dateCol = PROCESSED_DATE[stage];
                const table = (network === 'linkedin')
                    ? LINKEDIN_PROCESSED_TABLES[stage]
                    : cfg.meta;
                const sql = `SELECT COUNT(${cfg.metaCountCol}) AS cnt FROM ${table}
                             WHERE ${dateCol} >= ? AND ${dateCol} < ?`;
                const rows = await run(sql, win);
                return ok(res, { total: num(rows) });
            }
            default:
                return res.status(400).json({ message: 'Unsupported metric' });
        }
    } catch (error) {
        console.error('Error fetching dynamic count:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { dynamicCountFilter, DB_DATA, METRICS };
