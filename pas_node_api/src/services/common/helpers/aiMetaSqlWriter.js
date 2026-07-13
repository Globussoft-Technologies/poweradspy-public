'use strict';

/**
 * AI-Meta SQL dual-write (see docs/AI_META_SQL_STORAGE.md).
 *
 * ES stays the search store; SQL is the durable system-of-record copy. On every
 * AI-Meta write we upsert the validated `ai_meta` object into the per-network
 * `<net>_ad_ai_meta` table, and — when the payload carries a `category` — also
 * dual-write that category into the pre-existing category store
 * (`<net>_ad.category_id` → master `<net>_category`) so the feed/legacy readers
 * stay in lockstep. category/sub_category are sourced from the `ai_meta` object
 * (the top-level newCatInsertion category is being retired by the DS pipeline).
 *
 * Every write is wrapped in a single transaction and is NON-FATAL to the caller:
 * failures (missing table, ad not found in SQL, connection error) are caught and
 * returned as a status object, never thrown, so an ES success is never lost.
 */

/**
 * Per-network SQL layout. Table + FK names mirror the DDL in AI_META_SQL_STORAGE.md
 * exactly. `categoryTable` is null for the 4 networks that have NO SQL category
 * store (gdn, google, pinterest, tiktok — verified live: no `<net>_category` table
 * and no `<net>_ad.category_id` column); for those, category stays ES-only and the
 * category-table dual-write is skipped. All values are a fixed internal whitelist
 * (never user input), so interpolating them into SQL is injection-safe.
 */
const NET_SQL = {
  facebook:  { adTable: 'facebook_ad',    metaTable: 'facebook_ad_ai_meta',     fkCol: 'facebook_ad_id',     categoryTable: 'facebook_category'  },
  instagram: { adTable: 'instagram_ad',   metaTable: 'instagram_ad_ai_meta',    fkCol: 'instagram_ad_id',    categoryTable: 'instagram_category' },
  youtube:   { adTable: 'youtube_ad',     metaTable: 'youtube_ad_ai_meta',      fkCol: 'youtube_ad_id',      categoryTable: 'youtube_category'   },
  native:    { adTable: 'native_ad',      metaTable: 'native_ad_ai_meta',       fkCol: 'native_ad_id',       categoryTable: 'native_category'    },
  linkedin:  { adTable: 'linkedin_ad',    metaTable: 'linkedin_ad_ai_meta',     fkCol: 'linkedin_ad_id',     categoryTable: 'linkedin_category'  },
  reddit:    { adTable: 'reddit_ad',      metaTable: 'reddit_ad_ai_meta',       fkCol: 'reddit_ad_id',       categoryTable: 'reddit_category'    },
  quora:     { adTable: 'quora_ad',       metaTable: 'quora_ad_ai_meta',        fkCol: 'quora_ad_id',        categoryTable: 'quora_category'     },
  gdn:       { adTable: 'gdn_ad',         metaTable: 'gdn_ad_ai_meta',          fkCol: 'gdn_ad_id',          categoryTable: null                 },
  google:    { adTable: 'google_text_ad', metaTable: 'google_text_ad_ai_meta',  fkCol: 'google_text_ad_id',  categoryTable: null                 },
  pinterest: { adTable: 'pinterest_ad',   metaTable: 'pinterest_ad_ai_meta',    fkCol: 'pinterest_ad_id',    categoryTable: null                 },
  tiktok:    { adTable: 'tiktok_ads',     metaTable: 'tiktok_ads_ai_meta',      fkCol: 'ad_id',              categoryTable: null                 },
};

// Fields stored as MySQL JSON columns — bound as a JSON string (or SQL NULL when absent).
const JSON_FIELDS = ['intent', 'hook', 'colors', 'offers', 'roa'];
// Plain scalar (VARCHAR/TEXT) columns. category_id/subcategory_id are the v1.6 4/8-char
// taxonomy codes — kept here so the row is a faithful copy of the ai_meta object (the
// SQL→category linkage still goes through the category NAME, not these codes).
const SCALAR_FIELDS = ['ad_type', 'offering_type', 'offering', 'caption', 'category', 'category_id', 'sub_category', 'subcategory_id'];
const ALL_FIELDS = [...SCALAR_FIELDS, ...JSON_FIELDS];

/** Bind a value for a JSON column: a JSON string, or SQL NULL when the field is absent. */
function jsonBind(v) {
  return v === undefined || v === null ? null : JSON.stringify(v);
}

/** Bind a scalar: coerce undefined → null (mysql2 rejects undefined bind params). */
function scalarBind(v) {
  return v === undefined ? null : v;
}

/**
 * Resolve a category name to its id in `<net>_category`, inserting it if new.
 * category_name is not consistently UNIQUE across networks (facebook/native only),
 * so we SELECT-then-INSERT rather than rely on ON DUPLICATE KEY. Runs inside the
 * caller's transaction. Timestamp columns default to CURRENT_TIMESTAMP.
 */
async function resolveCategoryId(conn, categoryTable, categoryName) {
  const [rows] = await conn.execute(
    `SELECT id FROM \`${categoryTable}\` WHERE category_name = ? ORDER BY id LIMIT 1`,
    [categoryName],
  );
  if (rows.length) return rows[0].id;
  const [ins] = await conn.execute(
    `INSERT INTO \`${categoryTable}\` (category_name) VALUES (?)`,
    [categoryName],
  );
  return ins.insertId;
}

/**
 * Upsert the AI-Meta row + optional category dual-write for one ad.
 *
 * @param {object}  args
 * @param {object}  args.sql        the network's SQL connection wrapper (service.db.sql) — { getConnection, ... }
 * @param {string}  args.network    network slug (key of NET_SQL)
 * @param {string|number} args.adId the ad's PUBLIC ad_id (resolved here to the internal PK)
 * @param {object}  args.normalized the validated ai_meta object (from validateAiMeta)
 * @param {object}  [args.logger]   optional logger ({ info, warn })
 * @returns {Promise<object>} status object — never throws. Shapes:
 *   { sql_status:'stored', sql_ad_row_id, category_synced }
 *   { sql_status:'skipped', reason }        (no SQL conn / unknown network)
 *   { sql_status:'ad_not_found' }           (public ad_id has no SQL row)
 *   { sql_status:'error', sql_error }
 */
async function persistAiMeta({ sql, network, adId, normalized, logger }) {
  const cfg = NET_SQL[network];
  if (!cfg) return { sql_status: 'skipped', reason: `unknown network: ${network}` };
  if (!sql || typeof sql.getConnection !== 'function') {
    return { sql_status: 'skipped', reason: 'SQL not available for network' };
  }
  if (!normalized || typeof normalized !== 'object') {
    return { sql_status: 'skipped', reason: 'no normalized ai_meta' };
  }

  let conn;
  try {
    conn = await sql.getConnection();
  } catch (err) {
    return { sql_status: 'error', sql_error: `getConnection: ${err.message}` };
  }

  try {
    await conn.beginTransaction();

    // 1) Resolve the internal PK from the public ad_id (FK target).
    const [adRows] = await conn.execute(
      `SELECT id FROM \`${cfg.adTable}\` WHERE ad_id = ? LIMIT 1`,
      [String(adId)],
    );
    if (!adRows.length) {
      await conn.rollback();
      return { sql_status: 'ad_not_found' };
    }
    const adRowId = adRows[0].id;

    // 2) Upsert the AI-Meta row (whole-object replace, mirroring the ES write).
    const cols   = [cfg.fkCol, ...ALL_FIELDS];
    const params = [
      adRowId,
      ...SCALAR_FIELDS.map(f => scalarBind(normalized[f])),
      ...JSON_FIELDS.map(f => jsonBind(normalized[f])),
    ];
    const placeholders = cols.map(() => '?').join(', ');
    const updateClause = ALL_FIELDS.map(f => `\`${f}\`=VALUES(\`${f}\`)`).join(', ');
    await conn.execute(
      `INSERT INTO \`${cfg.metaTable}\` (${cols.map(c => `\`${c}\``).join(', ')}) ` +
      `VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updateClause}`,
      params,
    );

    // 3) Category dual-write — only where a SQL category store exists and the
    //    payload carries a category. sub_category has no SQL category-table home
    //    (it lives only in the AI-Meta table column written above).
    let categorySynced = false;
    if (cfg.categoryTable && normalized.category) {
      const catId = await resolveCategoryId(conn, cfg.categoryTable, normalized.category);
      await conn.execute(
        `UPDATE \`${cfg.adTable}\` SET category_id = ? WHERE id = ?`,
        [catId, adRowId],
      );
      categorySynced = true;
    }

    await conn.commit();
    logger?.info?.(`[aiMetaSql] ${network} upserted ai_meta for ad_id=${adId} (row=${adRowId}, category_synced=${categorySynced})`);
    return { sql_status: 'stored', sql_ad_row_id: adRowId, category_synced: categorySynced };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore rollback failure */ }
    logger?.warn?.(`[aiMetaSql] ${network} write failed for ad_id=${adId}: ${err.message}`);
    return { sql_status: 'error', sql_error: err.message };
  } finally {
    try { conn.release(); } catch (_) { /* ignore */ }
  }
}

module.exports = { persistAiMeta, NET_SQL };
