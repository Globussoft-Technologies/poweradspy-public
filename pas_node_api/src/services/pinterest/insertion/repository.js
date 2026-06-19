'use strict';

/**
 * Pinterest insertion — data repository (raw parameterized SQL).
 * All table names use pinterest_ prefix. Mirrors the native repository pattern.
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

const rows      = (r) => (Array.isArray(r) ? r : []);
const firstId   = (r) => (r && r.insertId ? r.insertId : 0);
const affected  = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found     = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });
const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// ── pinterest_ad ───────────────────────────────────────────────────────────────

async function getAdByAdId(exec, adId) {
  const r = await exec.query('SELECT id, domain_id, first_seen, post_owner_id FROM pinterest_ad WHERE ad_id = ? LIMIT 1', [adId]);
  return found(r);
}

async function insertPinterestAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO pinterest_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updatePinterestAd(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE pinterest_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

async function getJoinedAd(exec, id) {
  const sql = `
    SELECT
      pinterest_ad.id, pinterest_ad.post_date, pinterest_ad.first_seen,
      pinterest_ad.last_seen, pinterest_ad.days_running, pinterest_ad.ad_position,
      pinterest_ad.ad_sub_position, pinterest_ad.type, pinterest_ad.domain_id,
      pinterest_ad.post_owner_id, pinterest_ad.language_id,
      ANY_VALUE(pinterest_country_only.country)                   AS country,
      ANY_VALUE(pinterest_ad_post_owners.post_owner_name)         AS post_owner_name,
      ANY_VALUE(pinterest_ad_post_owners.post_owner_lower)        AS post_owner_lower,
      ANY_VALUE(pinterest_ad_post_owners.post_owner_image)        AS post_owner_image,
      ANY_VALUE(pinterest_ad_meta_data.destination_url)           AS destination_url,
      ANY_VALUE(pinterest_ad_meta_data.firstSeenOnDesktop)        AS firstSeenOnDesktop,
      ANY_VALUE(pinterest_ad_meta_data.built_with)                AS built_with,
      ANY_VALUE(pinterest_ad_meta_data.affiliate_data)            AS affiliate_data,
      ANY_VALUE(pinterest_ad_meta_data.built_with_analytics_tracking) AS built_with_analytics_tracking,
      ANY_VALUE(pinterest_ad_meta_data.platform)                  AS platform,
      ANY_VALUE(pinterest_ad_variants.title)                      AS title,
      ANY_VALUE(pinterest_ad_variants.text)                       AS text,
      ANY_VALUE(pinterest_ad_variants.newsfeed_description)       AS newsfeed_description,
      ANY_VALUE(pinterest_ad_variants.image_url)                  AS image_url,
      ANY_VALUE(pinterest_ad_variants.image_url_original)         AS image_url_original,
      ANY_VALUE(pinterest_ad_variants.target_keyword)             AS target_keyword,
      ANY_VALUE(pinterest_ad_variants.image_object)               AS image_object,
      ANY_VALUE(pinterest_ad_variants.image_celebrity)            AS image_celebrity,
      ANY_VALUE(pinterest_ad_variants.image_brand_logo)           AS image_brand_logo,
      ANY_VALUE(pinterest_ad_variants.image_ocr)                  AS image_ocr,
      ANY_VALUE(pinterest_ad_url.url)                             AS url,
      ANY_VALUE(pinterest_ad_domains.domain_registered_date)      AS domain_registered_date,
      ANY_VALUE(pinterest_ad_domains.domain)                      AS domain
    FROM pinterest_ad
    LEFT JOIN pinterest_country_only   ON pinterest_ad.country_only_id = pinterest_country_only.id
    LEFT JOIN pinterest_ad_meta_data   ON pinterest_ad.id = pinterest_ad_meta_data.pinterest_ad_id
    LEFT JOIN pinterest_ad_post_owners ON pinterest_ad.post_owner_id = pinterest_ad_post_owners.id
    LEFT JOIN pinterest_ad_variants    ON pinterest_ad.id = pinterest_ad_variants.pinterest_ad_id
    LEFT JOIN pinterest_ad_domains     ON pinterest_ad.domain_id = pinterest_ad_domains.id
    LEFT JOIN pinterest_ad_url         ON pinterest_ad.id = pinterest_ad_url.pinterest_ad_id
    WHERE pinterest_ad.id = ?
    GROUP BY pinterest_ad.id`;
  return rows(await exec.query(sql, [id]));
}

async function deleteAdCascade(exec, id) {
  const childDeletes = [
    ['pinterest_ad_html_lander_content', 'pinterest_ad_id'],
    ['pinterest_ad_translation',         'pinterest_ad_id'],
    ['pinterest_ad_countries',           'pinterest_ad_id'],
    ['pinterest_ad_countries_only',      'pinterest_ad_id'],
    ['pinterest_hidden_ads',             'ad_id'],
    ['pinterest_ad_image_video',         'pinterest_ad_id'],
    ['pinterest_ad_meta_data',           'pinterest_ad_id'],
    ['pinterest_ad_outgoing_links',      'pinterest_ad_id'],
    ['pinterest_ad_url',                 'pinterest_ad_id'],
    ['pinterest_ad_variants',            'pinterest_ad_id'],
    ['pinterest_ad_recommended_activity','ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [id]);
  }
  return affected(await exec.query('DELETE FROM pinterest_ad WHERE id = ?', [id]));
}

async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); }
  catch (err) { if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return; throw err; }
}

// ── pinterest_ad_post_owners ───────────────────────────────────────────────────

async function getPostOwner(exec, postOwnerName) {
  const r = await exec.query(
    'SELECT id, ads_count, post_owner_image FROM pinterest_ad_post_owners WHERE post_owner_name = ? LIMIT 1',
    [postOwnerName]
  );
  return found(r);
}

async function insertPostOwner(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO pinterest_ad_post_owners (post_owner_name, post_owner_image, ads_count) VALUES (?,?,?)',
    [d.post_owner_name, d.post_owner_image ?? '/DefaultImage.jpg', d.ads_count ?? 1]
  ));
}

async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE pinterest_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── pinterest_country_only ────────────────────────────────────────────────────

async function getCountryOnly(exec, country) {
  return found(await exec.query('SELECT id FROM pinterest_country_only WHERE country = ? LIMIT 1', [country]));
}

async function insertCountryOnly(exec, country) {
  return firstId(await exec.query('INSERT INTO pinterest_country_only (country) VALUES (?)', [country]));
}

// ── pinterest_country ─────────────────────────────────────────────────────────

async function getCountry(exec, city, state, country) {
  return found(await exec.query(
    'SELECT id FROM pinterest_country WHERE city <=> ? AND state <=> ? AND country <=> ? LIMIT 1',
    [city ?? null, state ?? null, country ?? null]
  ));
}

async function insertCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO pinterest_country (city, state, country, country_only_id, status) VALUES (?,?,?,?,?)',
    [d.city ?? null, d.state ?? null, d.country ?? null, d.country_only_id ?? null, 1]
  ));
}

// ── pinterest_ad_domains ──────────────────────────────────────────────────────

async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id FROM pinterest_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}

async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO pinterest_ad_domains (domain) VALUES (?)', [domain]));
}

// ── pinterest_ad_variants ─────────────────────────────────────────────────────

async function insertPinterestAdVariant(exec, d) {
  const clean = stripNulls({
    pinterest_ad_id:      d.pinterest_ad_id,
    title:                d.title                ?? '',
    text:                 d.text                 ?? '',
    newsfeed_description: d.newsfeed_description ?? '',
    image_url:            d.image_url            ?? null,
    image_url_original:   d.image_url_original   ?? null,
    target_keyword:       d.target_keyword       ?? null,
  });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO pinterest_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updatePinterestAdVariant(exec, data, adId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE pinterest_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE pinterest_ad_id = ?`,
    [...Object.values(data), adId]
  ));
}

// ── pinterest_ad_countries ────────────────────────────────────────────────────

async function getPinterestAdCountry(exec, adId, countryId) {
  return found(await exec.query(
    'SELECT id, count FROM pinterest_ad_countries WHERE pinterest_ad_id = ? AND country_id = ? LIMIT 1',
    [adId, countryId]
  ));
}

async function insertPinterestAdCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO pinterest_ad_countries (pinterest_ad_id, country_id, country_only_id, count) VALUES (?,?,?,?)',
    [d.pinterest_ad_id, d.country_id ?? null, d.country_only_id, d.count ?? 1]
  ));
}

async function updatePinterestAdCountryCount(exec, id) {
  return affected(await exec.query('UPDATE pinterest_ad_countries SET count = count + 1 WHERE id = ?', [id]));
}

// ── pinterest_ad_countries_only ───────────────────────────────────────────────

async function getPinterestAdCountryOnly(exec, adId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM pinterest_ad_countries_only WHERE pinterest_ad_id = ? AND country_only_id = ? LIMIT 1',
    [adId, countryOnlyId]
  ));
}

async function insertPinterestAdCountryOnly(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO pinterest_ad_countries_only (pinterest_ad_id, country_only_id, count, ip_address) VALUES (?,?,?,?)',
    [d.pinterest_ad_id, d.country_only_id, d.count ?? 1, d.ip_address ?? '']
  ));
}

async function updatePinterestAdCountryOnlyCount(exec, id) {
  return affected(await exec.query('UPDATE pinterest_ad_countries_only SET count = count + 1 WHERE id = ?', [id]));
}

// ── pinterest_ad_meta_data ────────────────────────────────────────────────────

async function insertPinterestAdMetaData(exec, d) {
  const clean = stripNulls(d);
  const cols  = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO pinterest_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── languages (shared) ────────────────────────────────────────────────────────

async function getLanguageId(exec, iso) {
  const r = await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [String(iso).toUpperCase()]);
  return rows(r).length ? rows(r)[0].id : 0;
}

// ── pinterest_account_activities (platform 10) ────────────────────────────────

async function insertPinterestAccountActivity(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO pinterest_account_activities (system_id, pinterest_ad_id, account_id, platform, is_unique) VALUES (?,?,?,?,?)',
    [d.system_id, d.pinterest_ad_id, d.account_id ?? null, d.platform, d.is_unique ?? 0]
  ));
}

// ── ES aggregate helpers ──────────────────────────────────────────────────────

async function getAdCountriesList(exec, adId) {
  const r = await exec.query(
    `SELECT pinterest_country_only.country FROM pinterest_ad_countries_only
     LEFT JOIN pinterest_country_only ON pinterest_ad_countries_only.country_only_id = pinterest_country_only.id
     WHERE pinterest_ad_countries_only.pinterest_ad_id = ?`,
    [adId]
  );
  return rows(r).map((row) => row.country).filter(Boolean);
}

module.exports = {
  withTransaction,
  getAdByAdId, insertPinterestAd, updatePinterestAd, getJoinedAd, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getCountryOnly, insertCountryOnly,
  getCountry, insertCountry,
  getDomain, insertDomain,
  insertPinterestAdVariant, updatePinterestAdVariant,
  getPinterestAdCountry, insertPinterestAdCountry, updatePinterestAdCountryCount,
  getPinterestAdCountryOnly, insertPinterestAdCountryOnly, updatePinterestAdCountryOnlyCount,
  insertPinterestAdMetaData,
  getLanguageId,
  insertPinterestAccountActivity,
  getAdCountriesList,
};
