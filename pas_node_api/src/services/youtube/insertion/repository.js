'use strict';

/**
 * YouTube insertion — data repository (raw parameterized SQL).
 *
 * Faithful port of the model calls in YoutubeAdController::insertNewYoutubeAds() /
 * insertAdToMySqlDatabase() / updateAdsData() / deleteads() (api_youtube; see
 * ../../../../KT-YOUTUBE-MIGRATION.md §2-3). One fn per DB op, grouped by table.
 *
 * `exec` first arg = `db.sql` (autocommit, pooled) or a `withTransaction` tx.
 * Returns: getX → {code:200,data:rows}|{code:400,data:null}; insertX → id; updateX → affected.
 *
 * NOTE: `languages` is a SHARED table. `youtube_ad_post_owners.post_owner_lower` is a
 * GENERATED column — never insert it (query freely).
 */

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
// Strip out-of-latin1 code points so a value binds to a latin1 column without mysql2 throwing
// ER_IMPOSSIBLE_STRING_CONVERSION (used for the latin1 youtube_country geo cols — see facebook fix e5f819d9c).
const latin1Safe = (v) => (typeof v === 'string' ? v.replace(/[^\x00-\xFF]/g, '') : v);

// ── youtube_ad ──────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM youtube_ad WHERE ad_id = ? LIMIT 1', [adId]));
}
async function insertYoutubeAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO youtube_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateYoutubeAd(exec, data, internalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE youtube_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), internalId]
  ));
}

/** Big denormalized join for the flat ES doc. whereCol = 'youtube_ad.id' or 'youtube_ad.ad_id'. */
async function getJoinedAd(exec, whereCol, whereVal) {
  const sql = `
    SELECT youtube_ad.*,
           ANY_VALUE(youtube_ad_post_owners.post_owner_name)  AS post_owner_name,
           ANY_VALUE(youtube_ad_post_owners.id)               AS post_owner_table_id,
           ANY_VALUE(youtube_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(youtube_ad_post_owners.verified)         AS verified,
           ANY_VALUE(youtube_ad_variants.title)               AS title,
           ANY_VALUE(youtube_ad_variants.text)                AS text,
           ANY_VALUE(youtube_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(youtube_ad_variants.video_url)           AS video_url,
           ANY_VALUE(youtube_ad_variants.video_url_original)  AS video_url_original,
           ANY_VALUE(youtube_ad_variants.thumbnail_url)       AS thumbnail_url,
           ANY_VALUE(youtube_ad_variants.tags)                AS tags,
           ANY_VALUE(youtube_call_to_actions.action)          AS call_to_action,
           ANY_VALUE(youtube_ad_meta_data.ad_url)             AS ad_url,
           ANY_VALUE(youtube_ad_meta_data.destination_url)    AS destination_url,
           ANY_VALUE(youtube_ad_meta_data.platform)           AS platform,
           ANY_VALUE(youtube_country_only.country)            AS country,
           ANY_VALUE(languages.iso)                           AS ad_language,
           ANY_VALUE(youtube_ad_domains.domain_registered_date) AS domain_registered_date,
           ANY_VALUE(youtube_ad_image_video.ad_image_video)   AS ad_image_video
    FROM youtube_ad
    LEFT JOIN youtube_ad_post_owners ON youtube_ad.post_owner_id     = youtube_ad_post_owners.id
    LEFT JOIN youtube_ad_variants    ON youtube_ad.id                = youtube_ad_variants.youtube_ad_id
    LEFT JOIN youtube_call_to_actions ON youtube_ad.call_to_action_id = youtube_call_to_actions.id
    LEFT JOIN youtube_ad_meta_data   ON youtube_ad.id                = youtube_ad_meta_data.youtube_ad_id
    LEFT JOIN youtube_country_only   ON youtube_ad.country_only_id    = youtube_country_only.id
    LEFT JOIN languages              ON youtube_ad.language_id        = languages.id
    LEFT JOIN youtube_ad_domains     ON youtube_ad.domain_id          = youtube_ad_domains.id
    LEFT JOIN youtube_ad_image_video ON youtube_ad.id                = youtube_ad_image_video.youtube_ad_id
    WHERE ${whereCol} = ?
    GROUP BY youtube_ad.id`;
  return rows(await exec.query(sql, [whereVal]));
}

/** Distinct countries for an ad (PHP getCountries → comma list). */
async function getCountriesCsv(exec, internalId) {
  const r = rows(await exec.query(
    `SELECT GROUP_CONCAT(DISTINCT youtube_country_only.country) AS countries
       FROM youtube_ad_countries_only
       LEFT JOIN youtube_country_only ON youtube_ad_countries_only.country_only_id = youtube_country_only.id
      WHERE youtube_ad_countries_only.youtube_ad_id = ?`, [internalId]
  ));
  return r.length && r[0].countries ? r[0].countries : null;
}

/**
 * Cascade-delete by internal youtube_ad.id — EXACT list from YoutubeAdController@deleteads
 * (api_youtube), PLUS youtube_ad_categories (enforced FK child, NOT in the PHP list →
 * without it the main DELETE fails). Missing tables skipped. Run inside withTransaction.
 */
async function deleteAdCascade(exec, internalId) {
  const childDeletes = [
    ['youtube_ad_html_lander_content', 'youtube_ad_id'],
    ['youtube_ad_translation', 'youtube_ad_id'],
    ['youtube_ad_analytics', 'youtube_ad_id'],
    ['youtube_ad_bug_report', 'ad_id'],
    ['youtube_ad_countries', 'youtube_ad_id'],
    ['youtube_ad_countries_only', 'youtube_ad_id'],
    ['youtube_ad_image_video', 'youtube_ad_id'],
    ['youtube_ad_meta_data', 'youtube_ad_id'],
    ['youtube_ad_outgoing_links', 'youtube_ad_id'],
    ['youtube_ad_users', 'youtube_ad_id'],
    ['youtube_ad_variants', 'youtube_ad_id'],
    ['youtube_ad_url', 'youtube_ad_id'],
    ['youtube_comments', 'youtube_ad_id'],
    ['youtube_hidden_ads', 'ad_id'],
    ['youtube_ad_recommended_activity', 'ad_id'],
    ['youtube_ad_ocb', 'youtube_ad_id'],
    // enforced FK child, NOT in the PHP delete list (verified via information_schema):
    ['youtube_ad_categories', 'youtube_ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM youtube_ad WHERE id = ?', [internalId]));
}
async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); }
  catch (err) { if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return; throw err; }
}

// ── youtube_ad_post_owners (dedup by name, case-insensitive) ──────────────────
async function getPostOwner(exec, postOwnerLower) {
  return found(await exec.query(
    'SELECT id, ads_count, post_owner_image, image_updated FROM youtube_ad_post_owners WHERE LOWER(post_owner_name) = ? LIMIT 1',
    [postOwnerLower]
  ));
}
async function insertPostOwner(exec, d) {
  // post_owner_lower is GENERATED — never insert it.
  const clean = stripNulls({
    post_owner_name: d.post_owner_name,
    channal_url: d.channal_url ?? null,
    post_owner_image: d.post_owner_image ?? '/DefaultImage.jpg',
    original_post_owner_image: d.original_post_owner_image ?? d.post_owner_image ?? null,
    ads_count: d.ads_count ?? 1,
    image_updated: d.image_updated ?? 0,
    verified: d.verified ?? 0,
  });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO youtube_ad_post_owners (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE youtube_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── youtube_call_to_actions (dedup by action) ─────────────────────────────────
async function getCallToAction(exec, action) {
  return found(await exec.query('SELECT id, count FROM youtube_call_to_actions WHERE action = ? LIMIT 1', [action]));
}
async function insertCallToAction(exec, action) {
  return firstId(await exec.query('INSERT INTO youtube_call_to_actions (action, count) VALUES (?, 1)', [action]));
}
async function bumpCallToActionCount(exec, id) {
  return affected(await exec.query('UPDATE youtube_call_to_actions SET count = count + 1 WHERE id = ?', [id]));
}

// ── youtube_country_only ──────────────────────────────────────────────────────
async function getCountryOnly(exec, country) {
  return found(await exec.query('SELECT id FROM youtube_country_only WHERE country = ? LIMIT 1', [country]));
}
async function insertCountryOnly(exec, country) {
  return firstId(await exec.query('INSERT INTO youtube_country_only (country) VALUES (?)', [country]));
}

// ── youtube_country (city/state/country) ──────────────────────────────────────
async function getCountry(exec, where) {
  return found(await exec.query(
    'SELECT id FROM youtube_country WHERE city <=> ? AND state <=> ? AND country <=> ? LIMIT 1',
    [latin1Safe(where.city) ?? null, latin1Safe(where.state) ?? null, latin1Safe(where.country) ?? null]
  ));
}
async function insertCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO youtube_country (city, state, country, country_only_id, status) VALUES (?,?,?,?,1)',
    [latin1Safe(d.city) ?? null, latin1Safe(d.state) ?? null, latin1Safe(d.country) ?? null, d.country_only_id ?? null]
  ));
}

// ── youtube_ad_domains ────────────────────────────────────────────────────────
async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id, domain, domain_registered_date FROM youtube_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO youtube_ad_domains (domain) VALUES (?)', [domain]));
}
async function getDomainRegisteredDate(exec, domainId) {
  const r = rows(await exec.query('SELECT domain, domain_registered_date FROM youtube_ad_domains WHERE id = ? LIMIT 1', [domainId]));
  return r.length ? r[0] : null;
}

// ── youtube_ad_variants ───────────────────────────────────────────────────────
async function insertVariant(exec, d) {
  const clean = stripNulls({
    youtube_ad_id: d.youtube_ad_id,
    title: d.title ?? null, text: d.text ?? null, newsfeed_description: d.newsfeed_description ?? null,
    video_url_original: d.video_url_original ?? null, video_url: d.video_url ?? null,
    channal_url: d.channal_url ?? null, tags: d.tags ?? null,
    thumbnail_url_original: d.thumbnail_url_original ?? null, thumbnail_url: d.thumbnail_url ?? null,
  });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO youtube_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateVariantById(exec, data, variantId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE youtube_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), variantId]
  ));
}
async function updateVariantByAdId(exec, data, youtubeAdId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE youtube_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE youtube_ad_id = ?`,
    [...Object.values(data), youtubeAdId]
  ));
}

// ── youtube_ad_analytics ──────────────────────────────────────────────────────
async function insertAnalytics(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO youtube_ad_analytics (youtube_ad_id, views, likes, dislike, comments, date) VALUES (?,?,?,?,?,?)',
    [d.youtube_ad_id, d.views ?? 0, d.likes ?? 0, d.dislike ?? 0, d.comments ?? 0, d.date]
  ));
}

// ── youtube_ad_countries / _only ──────────────────────────────────────────────
async function getAdCountry(exec, youtubeAdId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM youtube_ad_countries WHERE youtube_ad_id = ? AND country_only_id = ? LIMIT 1',
    [youtubeAdId, countryOnlyId]
  ));
}
async function insertAdCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO youtube_ad_countries (youtube_ad_id, country_id, country_only_id, count) VALUES (?,?,?,?)',
    [d.youtube_ad_id, d.country_id ?? null, d.country_only_id ?? null, d.count ?? 1]
  ));
}
async function bumpAdCountryCount(exec, id) {
  return affected(await exec.query('UPDATE youtube_ad_countries SET count = count + 1 WHERE id = ?', [id]));
}
async function getAdCountryOnly(exec, youtubeAdId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM youtube_ad_countries_only WHERE youtube_ad_id = ? AND country_only_id = ? LIMIT 1',
    [youtubeAdId, countryOnlyId]
  ));
}
async function insertAdCountryOnly(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO youtube_ad_countries_only (youtube_ad_id, country_only_id, count) VALUES (?,?,?)',
    [d.youtube_ad_id, d.country_only_id ?? null, d.count ?? 1]
  ));
}
async function bumpAdCountryOnlyCount(exec, id) {
  return affected(await exec.query('UPDATE youtube_ad_countries_only SET count = count + 1 WHERE id = ?', [id]));
}

// ── youtube_ad_meta_data ──────────────────────────────────────────────────────
async function insertMetaData(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO youtube_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── youtube_ad_translation (upsert on youtube_ad_id) ──────────────────────────
async function upsertTranslation(exec, d) {
  const existing = rows(await exec.query('SELECT youtube_ad_id FROM youtube_ad_translation WHERE youtube_ad_id = ? LIMIT 1', [d.youtube_ad_id]));
  if (existing.length) {
    await exec.query(
      'UPDATE youtube_ad_translation SET ad_text = ?, ad_title = ?, news_feed_description = ? WHERE youtube_ad_id = ?',
      [d.ad_text ?? '', d.ad_title ?? '', d.news_feed_description ?? '', d.youtube_ad_id]
    );
  } else {
    await exec.query(
      'INSERT INTO youtube_ad_translation (youtube_ad_id, ad_text, ad_title, news_feed_description) VALUES (?,?,?,?)',
      [d.youtube_ad_id, d.ad_text ?? '', d.ad_title ?? '', d.news_feed_description ?? '']
    );
  }
  return true;
}

// ── youtube_ad_image_video (carousel — VIDEO + SIDE) ──────────────────────────
async function insertAdImageVideo(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO youtube_ad_image_video (youtube_ad_id, ad_type, ad_image_video) VALUES (?,?,?)',
    [d.youtube_ad_id, d.ad_type ?? null, d.ad_image_video ?? null]
  ));
}

// ── youtube_users / youtube_account_activities (platform 12 = python plugin) ──
async function getSystemUser(exec, systemId) {
  return found(await exec.query('SELECT id, ads_count FROM youtube_users WHERE system_id = ? LIMIT 1', [systemId]));
}
async function insertSystemUser(exec, d) {
  return firstId(await exec.query('INSERT INTO youtube_users (system_id, ads_count) VALUES (?,?)', [d.system_id, d.ads_count ?? 1]));
}
async function bumpSystemUserCount(exec, id) {
  return affected(await exec.query('UPDATE youtube_users SET ads_count = ads_count + 1 WHERE id = ?', [id]));
}
async function insertAccountActivity(exec, d) {
  return affected(await exec.query(
    'INSERT INTO youtube_account_activities (system_id, youtube_ad_id, platform, is_unique) VALUES (?,?,?,?)',
    [d.system_id ?? null, d.youtube_ad_id, d.platform ?? null, d.is_unique ?? 0]
  ));
}

// ── languages (shared) ────────────────────────────────────────────────────────
async function getLanguageId(exec, iso) {
  const r = rows(await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [String(iso).toUpperCase()]));
  return r.length ? r[0].id : null;
}

module.exports = {
  withTransaction,
  getAdByAdId, insertYoutubeAd, updateYoutubeAd, getJoinedAd, getCountriesCsv, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getCallToAction, insertCallToAction, bumpCallToActionCount,
  getCountryOnly, insertCountryOnly,
  getCountry, insertCountry,
  getDomain, insertDomain, getDomainRegisteredDate,
  insertVariant, updateVariantById, updateVariantByAdId,
  insertAnalytics,
  getAdCountry, insertAdCountry, bumpAdCountryCount,
  getAdCountryOnly, insertAdCountryOnly, bumpAdCountryOnlyCount,
  insertMetaData,
  upsertTranslation,
  insertAdImageVideo,
  getSystemUser, insertSystemUser, bumpSystemUserCount, insertAccountActivity,
  getLanguageId,
};
