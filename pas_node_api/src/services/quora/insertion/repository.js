'use strict';

/**
 * Quora insertion — data repository (raw parameterized SQL).
 * Mirrors the Facebook repository pattern with quora_* table/column names.
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

// ── quora_ad ───────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM quora_ad WHERE ad_id = ? LIMIT 1', [adId]));
}

async function insertQuoraAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateQuoraAd(exec, data, adInternalId) {
  const clean = stripNulls(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `UPDATE quora_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(clean), adInternalId]
  ));
}

// Cascade-delete an ad and all its child rows
async function deleteAdCascade(exec, internalId) {
  const childDeletes = [
    ['quora_ad_translation', 'quora_ad_id'],
    ['quora_ad_analytics', 'quora_ad_id'],
    ['quora_ad_countries', 'quora_ad_id'],
    ['quora_ad_countries_only', 'quora_ad_id'],
    ['quora_ad_image_video', 'quora_ad_id'],
    ['quora_ad_meta_data', 'quora_ad_id'],
    ['quora_ad_url', 'quora_ad_id'],
    ['quora_ad_users', 'quora_ad_id'],
    ['quora_ad_variants', 'quora_ad_id'],
    ['quora_comments', 'quora_ad_id'],
    ['quora_ad_bug_report', 'ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM quora_ad WHERE id = ?', [internalId]));
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
    SELECT quora_ad.*,
           ANY_VALUE(quora_ad_image_video.ad_image_video) AS ad_image_video,
           ANY_VALUE(quora_ad_domain.domain) AS domain,
           ANY_VALUE(quora_ad_domain.domain_registered_date) AS domain_registered_date,
           ANY_VALUE(quora_call_to_action.call_to_action) AS call_to_action,
           ANY_VALUE(quora_country.country) AS country_row,
           ANY_VALUE(quora_user.Gender) AS gender,
           ANY_VALUE(quora_ad_meta_data.destination_url) AS destination_url,
           ANY_VALUE(quora_ad_meta_data.built_with) AS built_with,
           ANY_VALUE(quora_ad_meta_data.built_with_analytics_tracking) AS built_with_analytics_tracking,
           ANY_VALUE(quora_ad_meta_data.affiliate_data) AS affiliate_data,
           ANY_VALUE(quora_ad_post_owners.post_owner_name) AS post_owner_name,
           ANY_VALUE(quora_ad_post_owners.post_owner_lower) AS post_owner_lower,
           ANY_VALUE(quora_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(quora_ad_variants.title) AS title,
           ANY_VALUE(quora_ad_variants.text) AS text,
           ANY_VALUE(quora_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(quora_ad_variants.image_object) AS image_object,
           ANY_VALUE(quora_ad_variants.image_celebrity) AS image_celebrity,
           ANY_VALUE(quora_ad_variants.image_brand_logo) AS image_brand_logo,
           ANY_VALUE(quora_ad_variants.image_ocr) AS image_ocr,
           ANY_VALUE(quora_ad_variants.image_url) AS image_url,
           ANY_VALUE(quora_ad_variants.image_url_original) AS image_url_original,
           ANY_VALUE(quora_category.category_name) AS category_name,
           ANY_VALUE(languages.iso) AS iso
    FROM quora_ad
    LEFT JOIN quora_ad_image_video ON quora_ad.id = quora_ad_image_video.quora_ad_id
    LEFT JOIN quora_ad_domain ON quora_ad.domain_id = quora_ad_domain.id
    LEFT JOIN quora_call_to_action ON quora_ad.call_to_action_id = quora_call_to_action.id
    LEFT JOIN quora_country ON quora_country.id = quora_ad.country_id
    LEFT JOIN quora_user ON quora_ad.discoverer_user_id = quora_user.id
    LEFT JOIN quora_ad_meta_data ON quora_ad.id = quora_ad_meta_data.quora_ad_id
    LEFT JOIN quora_ad_post_owners ON quora_ad.post_owner_id = quora_ad_post_owners.id
    LEFT JOIN quora_ad_variants ON quora_ad.id = quora_ad_variants.quora_ad_id
    LEFT JOIN quora_category ON quora_ad.category_id = quora_category.id
    LEFT JOIN languages ON quora_ad.language_id = languages.id
    WHERE quora_ad.id = ?
    GROUP BY quora_ad.id
  `;
  return found(await exec.query(sql, [whereVal]));
}

// ── quora_ad_variants ──────────────────────────────────────────────────────
async function insertQuoraAdVariants(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateQuoraAdVariants(exec, data, adInternalId) {
  const clean = stripNulls(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `UPDATE quora_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE quora_ad_id = ?`,
    [...Object.values(clean), adInternalId]
  ));
}

// ── quora_ad_post_owners ───────────────────────────────────────────────────
async function getPostOwnerByName(exec, name) {
  return found(await exec.query('SELECT id, ads_count, post_owner_image, original_post_owner_image, image_updated FROM quora_ad_post_owners WHERE post_owner_name = ? LIMIT 1', [name]));
}

async function insertQuoraAdPostOwner(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad_post_owners (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateQuoraAdPostOwner(exec, data, postOwnerId) {
  const clean = stripNulls(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `UPDATE quora_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(clean), postOwnerId]
  ));
}

// ── quora_ad_meta_data ─────────────────────────────────────────────────────
async function insertQuoraAdMetaData(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateQuoraAdMetaData(exec, data, adInternalId) {
  const clean = stripNulls(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `UPDATE quora_ad_meta_data SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE quora_ad_id = ?`,
    [...Object.values(clean), adInternalId]
  ));
}

// ── quora_ad_countries ─────────────────────────────────────────────────────
async function insertQuoraAdCountries(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad_countries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── quora_ad_countries_only ────────────────────────────────────────────────
async function insertQuoraAdCountriesOnly(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad_countries_only (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── quora_ad_users ─────────────────────────────────────────────────────────
async function insertQuoraAdUsers(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad_users (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── quora_ad_image_video ───────────────────────────────────────────────────
async function upsertAdImageVideo(exec, data, adInternalId) {
  const clean = stripNulls(data);
  clean.quora_ad_id = adInternalId;
  const cols = Object.keys(clean);
  const updates = cols.filter(c => c !== 'quora_ad_id').map(c => `${c} = VALUES(${c})`).join(', ');
  const placeholders = cols.map(() => '?').join(', ');
  const sql = `INSERT INTO quora_ad_image_video (${cols.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
  return affected(await exec.query(sql, Object.values(clean)));
}

// ── quora_ad_translation ───────────────────────────────────────────────────
async function insertQuoraAdTranslation(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO quora_ad_translation (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── quora_user ─────────────────────────────────────────────────────────────
async function getUserByQuoraId(exec, quoraId) {
  return found(await exec.query('SELECT id FROM quora_user WHERE quora_id = ? LIMIT 1', [quoraId]));
}

module.exports = {
  withTransaction,
  getAdByAdId,
  insertQuoraAd,
  updateQuoraAd,
  deleteAdCascade,
  getJoinedAd,
  insertQuoraAdVariants,
  updateQuoraAdVariants,
  getPostOwnerByName,
  insertQuoraAdPostOwner,
  updateQuoraAdPostOwner,
  insertQuoraAdMetaData,
  updateQuoraAdMetaData,
  insertQuoraAdCountries,
  insertQuoraAdCountriesOnly,
  insertQuoraAdUsers,
  upsertAdImageVideo,
  insertQuoraAdTranslation,
  getUserByQuoraId,
  stripNulls,
};
