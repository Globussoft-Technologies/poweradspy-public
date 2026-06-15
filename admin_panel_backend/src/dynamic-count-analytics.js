require('dotenv').config();
const queryDatabase = require('../db-connections/connection');

/**
 * Centralized dynamic ad-count API.
 *
 *   POST /admin-panel/network-name/get-count
 *
 * Counts ads in the per-network main table (`<net>_ad`) with a flexible set of
 * filters. v1 supports: network, date range (12am->12am window on a selectable
 * date column), and platform/plugin code(s). Optionally returns a group-by
 * breakdown instead of a single total.
 *
 * Request body:
 *   network    required — facebook | instagram | google | gdn | native |
 *                         pinterest | quora | reddit | youtube | bing | linkedin
 *   range      optional — { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }. Inclusive
 *                         day window, applied as [from 00:00:00, (to+1) 00:00:00)
 *                         — i.e. DS's "12am to 12am" semantics. Omit for lifetime.
 *   dateField  optional — which date column `range` filters. One of
 *                         first_seen (default) | last_seen | created_date.
 *                         (LinkedIn has no created_date — created_date maps to
 *                         created_at automatically.)
 *   platform   optional — plugin code (int) or array of codes, e.g. 3 / [3,10,12,15].
 *                         3=User, 10=Scroll, 12=Python, 15=Meta. Platform lives in
 *                         <net>_ad_meta_data for all networks except Facebook (main
 *                         table), so for the rest it's matched via the ad's meta rows.
 *   groupBy    optional — return per-bucket counts instead of one total. One of
 *                         platform | source | type | ad_position.
 *
 * Response:
 *   { code, message, data: { total } }                         // no groupBy
 *   { code, message, data: { total, groupBy, buckets:[{key,count}] } }  // groupBy
 *
 * SQL-safety: table/column names are never interpolated from user input — they
 * come from the fixed config maps / allow-lists below. Only values are bound (?).
 */

// db_id = production server index (see db-connections/connection.js); index = DB
// name env var. `platformOnMain` flags Facebook, whose main table carries
// `platform` directly. `createdCol` resolves the `created_date` dateField
// per-network (LinkedIn stores it as `created_at`).
const DB_DATA = {
    bing:      { mainTable: 'bing_text_ad',   metaTable: 'bing_text_ad_meta_data',   fk: 'bing_text_ad_id',   platformOnMain: false, createdCol: 'created_date', db_id: 10, index: process.env.BING_DATABASE },
    facebook:  { mainTable: 'facebook_ad',    metaTable: 'facebook_ad_meta_data',    fk: 'facebook_ad_id',    platformOnMain: true,  createdCol: 'created_date', db_id: 0,  index: process.env.FB_DATABASE },
    gdn:       { mainTable: 'gdn_ad',         metaTable: 'gdn_ad_meta_data',         fk: 'gdn_ad_id',         platformOnMain: false, createdCol: 'created_date', db_id: 5,  index: process.env.GDN_DATABASE },
    google:    { mainTable: 'google_text_ad', metaTable: 'google_text_ad_meta_data', fk: 'google_text_ad_id', platformOnMain: false, createdCol: 'created_date', db_id: 9,  index: process.env.GT_DATABASE },
    instagram: { mainTable: 'instagram_ad',   metaTable: 'instagram_ad_meta_data',   fk: 'instagram_ad_id',   platformOnMain: false, createdCol: 'created_date', db_id: 8,  index: process.env.INSTA_DATABASE },
    linkedin:  { mainTable: 'linkedin_ad',    metaTable: 'linkedin_ad_meta_data',    fk: 'linkedin_ad_id',    platformOnMain: false, createdCol: 'created_at',   db_id: 2,  index: process.env.LINKEDIN_DATABASE },
    native:    { mainTable: 'native_ad',      metaTable: 'native_ad_meta_data',      fk: 'native_ad_id',      platformOnMain: false, createdCol: 'created_date', db_id: 3,  index: process.env.NATIVE_DATABASE },
    pinterest: { mainTable: 'pinterest_ad',   metaTable: 'pinterest_ad_meta_data',   fk: 'pinterest_ad_id',   platformOnMain: false, createdCol: 'created_date', db_id: 6,  index: process.env.PINT_DATABASE },
    quora:     { mainTable: 'quora_ad',       metaTable: 'quora_ad_meta_data',       fk: 'quora_ad_id',       platformOnMain: false, createdCol: 'created_date', db_id: 7,  index: process.env.QUORA_DATABASE },
    reddit:    { mainTable: 'reddit_ad',      metaTable: 'reddit_ad_meta_data',      fk: 'reddit_ad_id',      platformOnMain: false, createdCol: 'created_date', db_id: 4,  index: process.env.REDDIT_DATABASE },
    youtube:   { mainTable: 'youtube_ad',     metaTable: 'youtube_ad_meta_data',     fk: 'youtube_ad_id',     platformOnMain: false, createdCol: 'created_date', db_id: 1,  index: process.env.YT_DATABASE },
};

// dateField values the client may pass (mapped to a real column per network).
const DATE_FIELDS = new Set(['first_seen', 'last_seen', 'created_date']);
// groupBy values → main-table columns (platform handled specially).
const GROUP_FIELDS = new Set(['platform', 'source', 'type', 'ad_position']);

// DS uses an exclusive next-midnight upper bound (`col < day+1`). Add one calendar
// day to a YYYY-MM-DD string; UTC-safe so there's no local-offset drift.
function nextDay(dateStr) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

// Resolve the dateField the client passed to the actual column for this network.
function resolveDateCol(dateField, cfg) {
    return dateField === 'created_date' ? cfg.createdCol : dateField; // first_seen | last_seen unchanged
}

const dynamicCountFilter = async (req, res) => {
    try {
        const { network, range, dateField = 'first_seen', platform, groupBy } = req.body || {};

        const cfg = DB_DATA[network];
        if (!network || !cfg) {
            return res.status(400).json({ message: 'Please provide a valid network' });
        }
        if (!DATE_FIELDS.has(dateField)) {
            return res.status(400).json({ message: `Invalid dateField. Allowed: ${[...DATE_FIELDS].join(', ')}` });
        }
        if (groupBy && !GROUP_FIELDS.has(groupBy)) {
            return res.status(400).json({ message: `Invalid groupBy. Allowed: ${[...GROUP_FIELDS].join(', ')}` });
        }

        // Normalize platform → array of integers (drops non-integers).
        let platforms = null;
        if (platform !== undefined && platform !== null && platform !== '') {
            platforms = (Array.isArray(platform) ? platform : [platform])
                .map((p) => Number(p))
                .filter((p) => Number.isInteger(p));
            if (!platforms.length) {
                return res.status(400).json({ message: 'platform must be an integer or array of integers' });
            }
        }

        const { mainTable, metaTable, fk, platformOnMain, db_id, index } = cfg;
        const dateCol = resolveDateCol(dateField, cfg);

        // Date predicate on the main alias `a` (shared by every branch).
        const dateWhere = [];
        const dateParams = [];
        if (range && range.from && range.to) {
            dateWhere.push(`a.${dateCol} >= ? AND a.${dateCol} < ?`);
            dateParams.push(`${range.from} 00:00:00`, `${nextDay(range.to)} 00:00:00`);
        }
        const inList = platforms ? platforms.map(() => '?').join(', ') : '';

        // ── group-by branch ────────────────────────────────────────────────
        if (groupBy) {
            let sql;
            const params = [];

            if (groupBy === 'platform' && !platformOnMain) {
                // Platform lives in the meta table → join, count distinct ads.
                const where = [...dateWhere, 'm.platform IS NOT NULL'];
                params.push(...dateParams);
                if (platforms) { where.push(`m.platform IN (${inList})`); params.push(...platforms); }
                sql = `SELECT m.platform AS bucket, COUNT(DISTINCT a.id) AS cnt
                       FROM ${mainTable} a
                       JOIN ${metaTable} m ON m.${fk} = a.id
                       WHERE ${where.join(' AND ')}
                       GROUP BY m.platform ORDER BY cnt DESC`;
            } else {
                // platform-on-main (Facebook) or source/type/ad_position — all on `a`.
                const col = `a.${groupBy}`;
                const where = [...dateWhere];
                params.push(...dateParams);
                if (platforms) { where.push(`a.platform IN (${inList})`); params.push(...platforms); }
                const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
                sql = `SELECT ${col} AS bucket, COUNT(DISTINCT a.id) AS cnt
                       FROM ${mainTable} a ${whereSql}
                       GROUP BY ${col} ORDER BY cnt DESC`;
            }

            const rows = await queryDatabase(db_id, index, sql, params);
            const buckets = (rows || []).map((r) => ({ key: r.bucket, count: Number(r.cnt || 0) }));
            const total = buckets.reduce((acc, b) => acc + b.count, 0);
            return res.status(200).json({ code: 200, message: 'success', data: { total, groupBy, buckets } });
        }

        // ── total branch ───────────────────────────────────────────────────
        const where = [...dateWhere];
        const params = [...dateParams];
        if (platforms) {
            if (platformOnMain) {
                where.push(`a.platform IN (${inList})`);
                params.push(...platforms);
            } else {
                where.push(`EXISTS (SELECT 1 FROM ${metaTable} m WHERE m.${fk} = a.id AND m.platform IN (${inList}))`);
                params.push(...platforms);
            }
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sql = `SELECT COUNT(DISTINCT a.id) AS cnt FROM ${mainTable} a ${whereSql}`;

        const rows = await queryDatabase(db_id, index, sql, params);
        return res.status(200).json({ code: 200, message: 'success', data: { total: Number(rows?.[0]?.cnt || 0) } });
    } catch (error) {
        console.error('Error fetching dynamic count:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = { dynamicCountFilter, DB_DATA, DATE_FIELDS, GROUP_FIELDS };
