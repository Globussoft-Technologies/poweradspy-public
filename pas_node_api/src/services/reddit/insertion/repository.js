'use strict';

/**
 * Reddit insertion — data repository (raw parameterized SQL).
 * Mirrors the Quora/Facebook pattern with reddit_* table/column names.
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });
const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

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

// ── reddit_ad ───────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM reddit_ad WHERE ad_id = ? LIMIT 1', [adId]));
}

async function insertRedditAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO reddit_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateRedditAd(exec, data, adInternalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE reddit_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), adInternalId]
  ));
}

// Cascade-delete an ad and all its child rows
async function deleteAdCascade(exec, internalId) {
  const childDeletes = [
    ['reddit_ad_translation', 'reddit_ad_id'],
    ['reddit_ad_analytics', 'reddit_ad_id'],
    ['reddit_ad_countries', 'reddit_ad_id'],
    ['reddit_ad_countries_only', 'reddit_ad_id'],
    ['reddit_ad_image_video', 'reddit_ad_id'],
    ['reddit_ad_meta_data', 'reddit_ad_id'],
    ['reddit_ad_url', 'reddit_ad_id'],
    ['reddit_ad_users', 'reddit_ad_id'],
    ['reddit_ad_variants', 'reddit_ad_id'],
    ['reddit_comments', 'reddit_ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM reddit_ad WHERE id = ?', [internalId]));
}

async function deleteIgnoringMissingTable(exec, sql, params) {
  try {
    await exec.query(sql, params);
  } catch (err) {
    if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return;
    throw err;
  }
}

// Denormalized join for ES doc
async function getJoinedAd(exec, whereVal) {
  const sql = `
    SELECT reddit_ad.*,
           ANY_VALUE(reddit_ad_image_video.ad_image_video) AS ad_image_video,
           ANY_VALUE(reddit_ad_domain.domain) AS domain,
           ANY_VALUE(reddit_ad_domain.domain_registered_date) AS domain_registered_date,
           ANY_VALUE(reddit_call_to_action.call_to_action) AS call_to_action,
           ANY_VALUE(reddit_country.country) AS country_row,
           ANY_VALUE(reddit_user.Gender) AS gender,
           ANY_VALUE(reddit_ad_meta_data.destination_url) AS destination_url,
           ANY_VALUE(reddit_ad_meta_data.built_with) AS built_with,
           ANY_VALUE(reddit_ad_meta_data.built_with_analytics_tracking) AS built_with_analytics_tracking,
           ANY_VALUE(reddit_ad_post_owners.post_owner_name) AS post_owner_name,
           ANY_VALUE(reddit_ad_post_owners.post_owner_lower) AS post_owner_lower,
           ANY_VALUE(reddit_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(reddit_ad_variants.title) AS title,
           ANY_VALUE(reddit_ad_variants.text) AS text,
           ANY_VALUE(reddit_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(reddit_ad_variants.image_object) AS image_object,
           ANY_VALUE(reddit_ad_variants.image_url) AS image_url,
           ANY_VALUE(reddit_ad_variants.image_url_original) AS image_url_original,
           ANY_VALUE(reddit_category.category_name) AS category_name,
           ANY_VALUE(languages.iso) AS iso
    FROM reddit_ad
    LEFT JOIN reddit_ad_image_video ON reddit_ad.id = reddit_ad_image_video.reddit_ad_id
    LEFT JOIN reddit_ad_domain ON reddit_ad.domain_id = reddit_ad_domain.id
    LEFT JOIN reddit_call_to_action ON reddit_ad.call_to_action_id = reddit_call_to_action.id
    LEFT JOIN reddit_country ON reddit_country.id = reddit_ad.country_id
    LEFT JOIN reddit_user ON reddit_ad.discoverer_user_id = reddit_user.id
    LEFT JOIN reddit_ad_meta_data ON reddit_ad.id = reddit_ad_meta_data.reddit_ad_id
    LEFT JOIN reddit_ad_post_owners ON reddit_ad.post_owner_id = reddit_ad_post_owners.id
    LEFT JOIN reddit_ad_variants ON reddit_ad.id = reddit_ad_variants.reddit_ad_id
    LEFT JOIN reddit_category ON reddit_ad.category_id = reddit_category.id
    LEFT JOIN languages ON reddit_ad.language_id = languages.id
    WHERE reddit_ad.id = ?
    GROUP BY reddit_ad.id
  `;
  return found(await exec.query(sql, [whereVal]));
}

// ── reddit_ad_variants ──────────────────────────────────────────────────
async function insertRedditAdVariants(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO reddit_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateRedditAdVariants(exec, data, adInternalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE reddit_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE reddit_ad_id = ?`,
    [...Object.values(data), adInternalId]
  ));
}

// ── reddit_ad_image_video (carousel / other_multimedia) ──────────────────
// One row per ad holding the JSON array of NAS paths for extra images/videos.
// Mirrors facebook_ad_image_video upsert. ES reads ad_image_video → othermedia.
async function upsertAdImageVideo(exec, d) {
  if (!d || !d.reddit_ad_id) return 0;
  const existing = rows(await exec.query(
    'SELECT id FROM reddit_ad_image_video WHERE reddit_ad_id = ? LIMIT 1', [d.reddit_ad_id]
  ));
  if (existing.length) {
    return affected(await exec.query(
      'UPDATE reddit_ad_image_video SET ad_type = ?, ad_image_video = ? WHERE reddit_ad_id = ?',
      [d.ad_type ?? null, d.ad_image_video ?? null, d.reddit_ad_id]
    ));
  }
  return affected(await exec.query(
    'INSERT INTO reddit_ad_image_video (reddit_ad_id, ad_type, ad_image_video) VALUES (?, ?, ?)',
    [d.reddit_ad_id, d.ad_type ?? null, d.ad_image_video ?? null]
  ));
}

// ── reddit_ad_post_owners ───────────────────────────────────────────────
async function getPostOwnerByName(exec, name) {
  return found(await exec.query('SELECT id, ads_count, post_owner_image, original_post_owner_image, image_updated FROM reddit_ad_post_owners WHERE post_owner_name = ? LIMIT 1', [name]));
}

async function upsertPostOwner(exec, data) {
  const name = String(data.post_owner_name).trim();
  const existing = await getPostOwnerByName(exec, name);

  if (existing.code === 200) {
    const po = existing.data[0];
    // Bump count
    await exec.query('UPDATE reddit_ad_post_owners SET ads_count = ads_count + 1 WHERE id = ?', [po.id]);
    return { postOwnerId: po.id };
  }

  const id = await exec.query(
    'INSERT INTO reddit_ad_post_owners (post_owner_name, ads_count) VALUES (?, 1)',
    [name]
  );
  return { postOwnerId: firstId(id) };
}

async function updatePostOwnerImagePath(exec, postOwnerId, imagePath) {
  return affected(await exec.query(
    'UPDATE reddit_ad_post_owners SET post_owner_image = ? WHERE id = ?',
    [imagePath, postOwnerId]
  ));
}

// ── reddit_ad_meta_data ────────────────────────────────────────────────
async function insertMetaData(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO reddit_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateMetaData(exec, data, adInternalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE reddit_ad_meta_data SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE reddit_ad_id = ?`,
    [...Object.values(data), adInternalId]
  ));
}

// ── reddit_user ───────────────────────────────────────────────────────────
async function getUserByRedditId(exec, redditUsername) {
  return found(await exec.query('SELECT id FROM reddit_user WHERE reddit_username = ? LIMIT 1', [redditUsername]));
}

// ── reddit_ad_translation ────────────────────────────────────────────
async function upsertTranslation(exec, data) {
  const { reddit_ad_id, ...updateData } = data;
  const clean = stripNulls(updateData);

  if (!reddit_ad_id) return 0;

  // Try update first
  const cols = Object.keys(clean);
  if (cols.length === 0) return 0;

  const updateCols = cols.map((c) => `${c} = ?`).join(', ');
  const result = await exec.query(
    `UPDATE reddit_ad_translation SET ${updateCols} WHERE reddit_ad_id = ? LIMIT 1`,
    [...Object.values(clean), reddit_ad_id]
  );

  if (affected(result) > 0) return 1;

  // If no update, insert
  const insertData = { reddit_ad_id, ...clean };
  const insertCols = Object.keys(insertData);
  return firstId(await exec.query(
    `INSERT INTO reddit_ad_translation (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
    Object.values(insertData)
  ));
}

// ── reddit_ad_analytics ────────────────────────────────────────────
async function insertAnalytics(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO reddit_ad_analytics (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateAnalytics(exec, data, adInternalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE reddit_ad_analytics SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE reddit_ad_id = ?`,
    [...Object.values(data), adInternalId]
  ));
}

// ── reddit_call_to_action ─────────────────────────────────────────
async function getCallToAction(exec, cta) {
  return found(await exec.query('SELECT id FROM reddit_call_to_action WHERE call_to_action = ? LIMIT 1', [cta]));
}

async function insertCallToAction(exec, cta) {
  return firstId(await exec.query('INSERT INTO reddit_call_to_action (call_to_action) VALUES (?)', [cta]));
}

// ── reddit_category ───────────────────────────────────────────────
async function insertCategory(exec, categoryName) {
  return firstId(await exec.query('INSERT INTO reddit_category (category_name) VALUES (?)', [categoryName]));
}

async function getCategory(exec, categoryName) {
  return found(await exec.query('SELECT id FROM reddit_category WHERE category_name = ? LIMIT 1', [categoryName]));
}

// ── reddit_ad_users ───────────────────────────────────────────────
async function insertAdUser(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO reddit_ad_users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── reddit_domain ────────────────────────────────────────────────────
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO reddit_ad_domain (domain) VALUES (?)', [domain]));
}

async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id FROM reddit_ad_domain WHERE domain = ? LIMIT 1', [domain]));
}

// ── reddit_country ────────────────────────────────────────────────────
async function getCountry(exec, { city, state, country }) {
  return found(await exec.query(
    'SELECT id FROM reddit_country WHERE country = ? AND (city = ? OR city IS NULL) AND (state = ? OR state IS NULL) LIMIT 1',
    [country, city || null, state || null]
  ));
}

async function insertCountry(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO reddit_country (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── reddit_country_only ──────────────────────────────────────────────
async function upsertCountryOnly(exec, country) {
  const existing = await exec.query(
    'SELECT country_only_id FROM reddit_country_only WHERE country_only = ? LIMIT 1',
    [country]
  );
  if (existing.length) return existing;
  return await exec.query('INSERT INTO reddit_country_only (country_only) VALUES (?)', [country]);
}

// ── reddit_ad_countries ──────────────────────────────────────────────
async function insertAdCountries(exec, rows) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const placeholders = rows.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
  const values = rows.flatMap(row => Object.values(stripNulls(row)));
  return affected(await exec.query(
    `INSERT INTO reddit_ad_countries (${cols.join(', ')}) VALUES ${placeholders}`,
    values
  ));
}

// ── reddit_ad_countries_only ─────────────────────────────────────────
async function insertAdCountriesOnly(exec, rows) {
  if (!rows.length) return 0;
  const cols = ['reddit_ad_id', 'country_only_id'];
  const placeholders = rows.map(() => '(?, ?)').join(', ');
  const values = rows.flatMap(row => [row.reddit_ad_id, row.country_only_id]);
  return affected(await exec.query(
    `INSERT INTO reddit_ad_countries_only (${cols.join(', ')}) VALUES ${placeholders}`,
    values
  ));
}

module.exports = {
  withTransaction, stripNulls,
  getAdByAdId, insertRedditAd, updateRedditAd, deleteAdCascade, getJoinedAd,
  insertRedditAdVariants, updateRedditAdVariants,
  upsertAdImageVideo,
  getPostOwnerByName, upsertPostOwner, updatePostOwnerImagePath,
  insertMetaData, updateMetaData,
  getUserByRedditId,
  upsertTranslation,
  insertAnalytics, updateAnalytics,
  getCallToAction, insertCallToAction,
  insertCategory, getCategory,
  insertAdUser,
  insertDomain, getDomain,
  getCountry, insertCountry,
  upsertCountryOnly,
  insertAdCountries, insertAdCountriesOnly,
};
