'use strict';

/**
 * LinkedIn insertion — data repository (raw parameterized SQL).
 *
 * Faithful port of the Eloquent model calls in adsDataController::adsdata() and
 * UserController@deleteads (api_linkedin; see ../../../../KT-LINKEDIN-MIGRATION.md §3-6).
 * One function per DB op, grouped by table. No business logic — the pipelines orchestrate.
 *
 * Every function takes `exec` first: an object with `query(sql, params)`. Pass `db.sql`
 * for autocommit (pooled), or a `withTransaction` tx for the INSERT path. Returns:
 *   - getX    → { code:200, data:rows } | { code:400, data:null }
 *   - insertX → inserted id (number)
 *   - updateX → affected row count (number)
 *
 * NOTE: `country_only` and `languages` are SHARED tables (no linkedin_ prefix), matching
 * the LinkedIn schema (CountryOnly model → `country_only`).
 */

// ── Transaction helper (relaxes strict sql_mode for the insertion connection) ──
async function withTransaction(sql, fn) {
  const conn = await sql.getConnection();
  const tx = { query: async (q, p) => { const [r] = await conn.execute(q, p); return r; } };
  try {
    await conn.query("SET SESSION sql_mode=(SELECT REPLACE(REPLACE(REPLACE(@@SESSION.sql_mode,'ONLY_FULL_GROUP_BY',''),'STRICT_TRANS_TABLES',''),'STRICT_ALL_TABLES',''))").catch(() => {});
    await conn.beginTransaction();
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    await conn.query('SET SESSION sql_mode=DEFAULT').catch(() => {});
    conn.release();
  }
}

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });
const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// latin1 guard — linkedin_ad_variants.image_url_original / image_url are latin1 (verified on the live
// linkedin DB; the linkedin_ad_meta_data URL cols are utf8mb4 so they need no guard). Strip out-of-latin1
// code points so a CJK/emoji image URL can't throw ER_IMPOSSIBLE_STRING_CONVERSION and roll back the whole
// ad txn. Kept local because this repo is self-contained. See fb fix e5f819d9c / #669.
const latin1Safe = (v) => (typeof v === 'string' ? v.replace(/[^\x00-\xFF]/g, '') : v);
const LATIN1_VARIANT_COLS = ['image_url_original', 'image_url', 'old_image_url', 'image_object', 'image_celebrity', 'image_brand_logo', 'ad_image_size'];
const latin1SafeCols = (obj, cols = LATIN1_VARIANT_COLS) => { if (obj && typeof obj === 'object') for (const k of cols) if (typeof obj[k] === 'string') obj[k] = latin1Safe(obj[k]); return obj; };

// ── linkedin_ad ───────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM linkedin_ad WHERE ad_id = ? LIMIT 1', [adId]));
}
async function insertLinkedinAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO linkedin_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateLinkedinAd(exec, data, internalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE linkedin_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), internalId]
  ));
}

/**
 * Big denormalized join for the ES doc (PHP getInsertDataForES select). Joined columns
 * are aliased to the bare names esDocBuilder reads, wrapped in ANY_VALUE() for
 * only_full_group_by compatibility. whereCol = 'linkedin_ad.id' or 'linkedin_ad.ad_id'.
 */
async function getJoinedAd(exec, whereCol, whereVal) {
  const sql = `
    SELECT linkedin_ad.*,
           ANY_VALUE(linkedin_ad_post_owners.post_owner_name)   AS post_owner_name,
           ANY_VALUE(linkedin_ad_post_owners.id)                AS post_owner_table_id,
           ANY_VALUE(linkedin_ad_post_owners.post_owner_image)  AS post_owner_image,
           ANY_VALUE(linkedin_ad_post_owners.verified)          AS verified,
           ANY_VALUE(linkedin_ad_variants.title)                AS title,
           ANY_VALUE(linkedin_ad_variants.text)                 AS text,
           ANY_VALUE(linkedin_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(linkedin_ad_variants.image_url)            AS image_url,
           ANY_VALUE(linkedin_ad_variants.image_url_original)   AS image_url_original,
           ANY_VALUE(linkedin_call_to_actions.action)           AS call_to_action,
           ANY_VALUE(linkedin_ad_meta_data.ad_url)              AS ad_url,
           ANY_VALUE(linkedin_ad_meta_data.destination_url)     AS destination_url,
           ANY_VALUE(linkedin_ad_meta_data.platform)            AS platform,
           ANY_VALUE(linkedin_ad_meta_data.firstSeenOnDesktop)  AS firstSeenOnDesktop,
           ANY_VALUE(linkedin_ad_image_video.ad_image_video)    AS ad_image_video,
           ANY_VALUE(linkedin_ad_built_with.affiliate_data)             AS affiliate_data,
           ANY_VALUE(linkedin_ad_built_with.built_with)                 AS built_with,
           ANY_VALUE(linkedin_ad_built_with.built_with_analytics_tracking) AS built_with_analytics_tracking,
           ANY_VALUE(linkedin_ad_html_lander_content.html_whitehat_lander_text) AS html_whitehat_lander_text,
           ANY_VALUE(linkedin_ad_ocr_ocb_details.image_ocr)      AS image_ocr,
           ANY_VALUE(linkedin_ad_ocr_ocb_details.image_object)   AS image_object,
           ANY_VALUE(linkedin_ad_ocr_ocb_details.image_brand_logo) AS image_brand_logo,
           ANY_VALUE(linkedin_ad_ocr_ocb_details.image_celebrity) AS image_celebrity,
           ANY_VALUE(country_only.country)                       AS country,
           ANY_VALUE(languages.iso)                              AS ad_language,
           ANY_VALUE(linkedin_ad_domains.domain)                 AS domain,
           ANY_VALUE(linkedin_ad_domains.domain_registered_date) AS domain_registered_date
    FROM linkedin_ad
    LEFT JOIN linkedin_ad_post_owners        ON linkedin_ad.post_owner_id   = linkedin_ad_post_owners.id
    LEFT JOIN linkedin_ad_variants           ON linkedin_ad.id              = linkedin_ad_variants.linkedin_ad_id
    LEFT JOIN linkedin_call_to_actions       ON linkedin_ad.call_to_action_id = linkedin_call_to_actions.id
    LEFT JOIN linkedin_ad_meta_data          ON linkedin_ad.id              = linkedin_ad_meta_data.linkedin_ad_id
    LEFT JOIN linkedin_ad_image_video        ON linkedin_ad.id              = linkedin_ad_image_video.linkedin_ad_id
    LEFT JOIN linkedin_ad_built_with         ON linkedin_ad.id              = linkedin_ad_built_with.linkedin_ad_id
    LEFT JOIN linkedin_ad_html_lander_content ON linkedin_ad.id             = linkedin_ad_html_lander_content.linkedin_ad_id
    LEFT JOIN linkedin_ad_ocr_ocb_details    ON linkedin_ad.id              = linkedin_ad_ocr_ocb_details.linkedin_ad_id
    LEFT JOIN country_only                   ON linkedin_ad.country_only_id = country_only.id
    LEFT JOIN languages                      ON linkedin_ad.language_id     = languages.id
    LEFT JOIN linkedin_ad_domains            ON linkedin_ad.domain_id       = linkedin_ad_domains.id
    WHERE ${whereCol} = ?
    GROUP BY linkedin_ad.id`;
  return rows(await exec.query(sql, [whereVal]));
}

/** Redirect urls (linkedin_ad_url WHERE url_type='R') for the ES redirect_urls field. */
async function getRedirectUrls(exec, internalId) {
  const r = rows(await exec.query(
    "SELECT url FROM linkedin_ad_url WHERE linkedin_ad_id = ? AND url_type = 'R'", [internalId]
  ));
  return r.map((x) => x.url).filter(Boolean);
}

/** All distinct countries for an ad (PHP getCountries → comma list). */
async function getCountriesCsv(exec, internalId) {
  const r = rows(await exec.query(
    `SELECT GROUP_CONCAT(DISTINCT country_only.country) AS countries
       FROM linkedin_ad_countries_only
       LEFT JOIN country_only ON linkedin_ad_countries_only.country_only_id = country_only.id
      WHERE linkedin_ad_countries_only.linkedin_ad_id = ?`, [internalId]
  ));
  return r.length && r[0].countries ? r[0].countries : null;
}

/**
 * Cascade-delete by internal linkedin_ad.id — EXACT list from UserController@deleteads
 * (api_linkedin 1757-1774), plus defensive children (comments) that share an FK. Missing
 * tables are skipped. Run inside withTransaction for atomicity.
 */
async function deleteAdCascade(exec, internalId) {
  const childDeletes = [
    ['linkedin_ad_analytics', 'linkedin_ad_id'],
    ['linkedin_ad_built_with', 'linkedin_ad_id'],
    ['linkedin_ad_lander', 'linkedin_ad_id'],
    ['linkedin_ad_html_lander_content', 'linkedin_ad_id'],
    ['linkedin_ad_ocr_ocb_details', 'linkedin_ad_id'],
    ['linkedin_ad_outgoing_links', 'linkedin_ad_id'],
    ['linkedin_ad_image_video', 'linkedin_ad_id'],
    ['linkedin_ad_bug_report', 'ad_id'],
    ['linkedin_ad_countries_only', 'linkedin_ad_id'],
    ['linkedin_ad_url', 'linkedin_ad_id'],
    ['hidden_ads', 'ad_id'],
    ['linkedin_ad_users', 'linkedin_ad_id'],
    ['linkedin_ad_meta_data', 'linkedin_ad_id'],
    ['linkedin_ad_variants', 'linkedin_ad_id'],
    ['linkedin_user_affiliate_ads', 'linkedin_ad_id'],
    // NOT in the PHP delete list, but linkedin_ad_categories is an ENFORCED FK child
    // (ON DELETE RESTRICT) of linkedin_ad — verified via information_schema. Without
    // this the main DELETE fails when any category row exists. col = linkedin_ad_id.
    ['linkedin_ad_categories', 'linkedin_ad_id'],
    // also FK children sharing linkedin_ad_id — safe (skipped if absent):
    ['linkedin_ad_comments', 'linkedin_ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM linkedin_ad WHERE id = ?', [internalId]));
}
async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); }
  catch (err) { if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return; throw err; }
}

// ── linkedin_ad_post_owners (dedup by name, case-insensitive) ──────────────────
async function getPostOwner(exec, postOwnerLower) {
  return found(await exec.query(
    'SELECT id, ads_count, post_owner_image FROM linkedin_ad_post_owners WHERE LOWER(post_owner_name) = ? LIMIT 1',
    [postOwnerLower]
  ));
}
async function insertPostOwner(exec, d) {
  const clean = stripNulls({
    post_owner_name: d.post_owner_name,
    post_owner_image: d.post_owner_image ?? '/DefaultImage.jpg',
    original_post_owner_image: d.original_post_owner_image ?? d.post_owner_image ?? null,
    ads_count: d.ads_count ?? 1,
    verified: d.verified,
  });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO linkedin_ad_post_owners (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE linkedin_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── linkedin_call_to_actions (dedup by action) ─────────────────────────────────
async function getCallToAction(exec, action) {
  return found(await exec.query('SELECT id, count FROM linkedin_call_to_actions WHERE action = ? LIMIT 1', [action]));
}
async function insertCallToAction(exec, action) {
  return firstId(await exec.query('INSERT INTO linkedin_call_to_actions (action, count) VALUES (?, 1)', [action]));
}
async function bumpCallToActionCount(exec, id) {
  return affected(await exec.query('UPDATE linkedin_call_to_actions SET count = count + 1 WHERE id = ?', [id]));
}

// ── linkedin_category (dedup by category_name) ─────────────────────────────────
async function getCategory(exec, name) {
  return found(await exec.query('SELECT id FROM linkedin_category WHERE category_name = ? LIMIT 1', [name]));
}
async function insertCategory(exec, name) {
  return firstId(await exec.query('INSERT INTO linkedin_category (category_name) VALUES (?)', [name]));
}

// ── country_only (SHARED table — dedup country) ────────────────────────────────
async function getCountryOnly(exec, country) {
  return found(await exec.query('SELECT id FROM country_only WHERE country = ? LIMIT 1', [country]));
}
async function insertCountryOnly(exec, country) {
  return firstId(await exec.query('INSERT INTO country_only (country) VALUES (?)', [country]));
}

// ── linkedin_ad_domains (dedup by domain) ──────────────────────────────────────
async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id, domain, domain_registered_date FROM linkedin_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO linkedin_ad_domains (domain) VALUES (?)', [domain]));
}
async function getDomainRegisteredDate(exec, domainId) {
  const r = rows(await exec.query('SELECT domain, domain_registered_date FROM linkedin_ad_domains WHERE id = ? LIMIT 1', [domainId]));
  return r.length ? r[0] : null;
}

// ── linkedin_ad_variants ───────────────────────────────────────────────────────
async function insertVariant(exec, d) {
  const clean = latin1SafeCols(stripNulls({
    linkedin_ad_id: d.linkedin_ad_id,
    title: d.title ?? '', text: d.text ?? '', newsfeed_description: d.newsfeed_description ?? '',
    image_url_original: d.image_url_original ?? null, image_url: d.image_url ?? null,
  })); // guard latin1 image_url_original
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO linkedin_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateVariantByAdId(exec, data, linkedinAdId) {
  latin1SafeCols(data); // guard latin1 image_url_original on the update path
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE linkedin_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE linkedin_ad_id = ?`,
    [...Object.values(data), linkedinAdId]
  ));
}

// ── linkedin_ad_analytics ──────────────────────────────────────────────────────
async function insertAnalytics(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO linkedin_ad_analytics (linkedin_ad_id, likes, comments, followers, date, hits) VALUES (?,?,?,?,?,?)',
    [d.linkedin_ad_id, d.likes ?? 0, d.comments ?? 0, d.followers ?? 0, d.date, d.hits ?? 1]
  ));
}

// ── linkedin_ad_countries_only ─────────────────────────────────────────────────
async function getAdCountryOnly(exec, linkedinAdId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM linkedin_ad_countries_only WHERE linkedin_ad_id = ? AND country_only_id = ? LIMIT 1',
    [linkedinAdId, countryOnlyId]
  ));
}
async function insertAdCountryOnly(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO linkedin_ad_countries_only (linkedin_ad_id, country_only_id, count) VALUES (?,?,?)',
    [d.linkedin_ad_id, d.country_only_id ?? null, d.count ?? 1]
  ));
}
async function bumpAdCountryOnlyCount(exec, id) {
  return affected(await exec.query('UPDATE linkedin_ad_countries_only SET count = count + 1 WHERE id = ?', [id]));
}

// ── linkedin_ad_users ──────────────────────────────────────────────────────────
async function getAdUser(exec, linkedinAdId, userId) {
  return found(await exec.query(
    'SELECT id, count FROM linkedin_ad_users WHERE linkedin_ad_id = ? AND user_id = ? LIMIT 1',
    [linkedinAdId, userId]
  ));
}
async function insertAdUser(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO linkedin_ad_users (linkedin_ad_id, user_id, count, platform) VALUES (?,?,?,?)',
    [d.linkedin_ad_id, d.user_id ?? null, d.count ?? 1, d.platform ?? null]
  ));
}
async function bumpAdUserCount(exec, id) {
  return affected(await exec.query('UPDATE linkedin_ad_users SET count = count + 1 WHERE id = ?', [id]));
}

// ── linkedin_ad_meta_data ──────────────────────────────────────────────────────
async function insertMetaData(exec, data) {
  const clean = stripNulls(data); // linkedin_ad_meta_data ad_url/destination_url are utf8mb4 (verified) — no latin1 guard needed
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO linkedin_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── linkedin_ad_built_with ─────────────────────────────────────────────────────
async function insertBuiltWith(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO linkedin_ad_built_with (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── linkedin_ad_html_lander_content / linkedin_ad_lander (skeleton rows) ───────
async function insertLanderContent(exec, linkedinAdId) {
  return affected(await exec.query('INSERT INTO linkedin_ad_html_lander_content (linkedin_ad_id) VALUES (?)', [linkedinAdId]));
}
async function insertLander(exec, linkedinAdId) {
  return affected(await exec.query('INSERT INTO linkedin_ad_lander (linkedin_ad_id) VALUES (?)', [linkedinAdId]));
}

// ── linkedin_ad_ocr_ocb_details ────────────────────────────────────────────────
async function getOcr(exec, linkedinAdId) {
  return found(await exec.query('SELECT id FROM linkedin_ad_ocr_ocb_details WHERE linkedin_ad_id = ? LIMIT 1', [linkedinAdId]));
}
async function insertOcr(exec, linkedinAdId) {
  return affected(await exec.query('INSERT INTO linkedin_ad_ocr_ocb_details (linkedin_ad_id) VALUES (?)', [linkedinAdId]));
}

// ── linkedin_ad_image_video (multi-image / multi-video) ────────────────────────
async function insertAdImageVideo(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO linkedin_ad_image_video (linkedin_ad_id, ad_type, ad_image_video) VALUES (?,?,?)',
    [d.linkedin_ad_id, d.ad_type ?? null, d.ad_image_video ?? null]
  ));
}

// ── linkedin_ad_comments (only when comments_data present) ─────────────────────
async function insertComments(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO linkedin_ad_comments (linkedin_ad_id, comment_data) VALUES (?,?)',
    [d.linkedin_ad_id, d.comment_data ?? null]
  ));
}

// ── linkedin_account_activities (platform 10) ──────────────────────────────────
async function insertAccountActivity(exec, d) {
  return affected(await exec.query(
    'INSERT INTO linkedin_account_activities (system_id, linkedin_ad_id, account_id, platform, is_unique) VALUES (?,?,?,?,?)',
    [d.system_id ?? null, d.linkedin_ad_id, d.account_id ?? null, d.platform ?? null, d.is_unique ?? 0]
  ));
}

// ── linkedin_users (discoverer resolution) ─────────────────────────────────────
async function getUserByLinkedinId(exec, linkedinId) {
  return found(await exec.query('SELECT id FROM linkedin_users WHERE linkedin_id = ? LIMIT 1', [linkedinId]));
}
async function getUserLinkedinIdByCountry(exec, country) {
  return found(await exec.query('SELECT linkedin_id FROM linkedin_users WHERE current_country = ? LIMIT 1', [country]));
}

// ── languages ───────────────────────────────────────────────────────────────────
async function getLanguageId(exec, iso) {
  const r = rows(await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [String(iso).toUpperCase()]));
  return r.length ? r[0].id : null;
}

module.exports = {
  withTransaction,
  getAdByAdId, insertLinkedinAd, updateLinkedinAd, getJoinedAd, getRedirectUrls, getCountriesCsv, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getCallToAction, insertCallToAction, bumpCallToActionCount,
  getCategory, insertCategory,
  getCountryOnly, insertCountryOnly,
  getDomain, insertDomain, getDomainRegisteredDate,
  insertVariant, updateVariantByAdId,
  insertAnalytics,
  getAdCountryOnly, insertAdCountryOnly, bumpAdCountryOnlyCount,
  getAdUser, insertAdUser, bumpAdUserCount,
  insertMetaData,
  insertBuiltWith,
  insertLanderContent, insertLander,
  getOcr, insertOcr,
  insertAdImageVideo,
  insertComments,
  insertAccountActivity,
  getUserByLinkedinId, getUserLinkedinIdByCountry,
  getLanguageId,
};
