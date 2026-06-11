'use strict';

/**
 * GTEXT (Google Text) insertion — data repository (raw parameterized SQL).
 *
 * Faithful port of the model calls in insertAdToMySqlDatabaseO / updateAdsDataO /
 * UserController@deleteads (see ../../../../KT-GTEXT-MIGRATION.md). One fn per DB op.
 * `exec` = `db.sql` (autocommit) or a `withTransaction` tx.
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

// ── google_text_ad ──────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM google_text_ad WHERE ad_id = ? LIMIT 1', [adId]));
}
async function insertGoogleTextAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO google_text_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateGoogleTextAd(exec, data, internalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE google_text_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), internalId]
  ));
}

// Joined row for the UPDATE path (PHP getJoindAds select, lines 439-454). Aliased to bare names.
async function getJoinedAd(exec, adId) {
  const sql = `
    SELECT google_text_ad.id, google_text_ad.type, google_text_ad.status, google_text_ad.ad_position,
           google_text_ad.domain_id, google_text_ad.ad_id, google_text_ad.ad_ranking,
           google_text_ad.country_only_id, google_text_ad.post_date, google_text_ad.first_seen,
           google_text_ad.last_seen, google_text_ad.days_running,
           ANY_VALUE(google_text_country.city)    AS city,
           ANY_VALUE(google_text_country.state)   AS state,
           ANY_VALUE(google_text_country.country) AS country,
           ANY_VALUE(google_text_country.id)      AS country_id,
           ANY_VALUE(google_text_ad_meta_data.platform)        AS platform,
           ANY_VALUE(google_text_ad_meta_data.destination_url) AS destination_url,
           ANY_VALUE(google_text_ad_meta_data.screenshot_url)  AS screenshot_url,
           ANY_VALUE(google_text_ad_meta_data.redirect_destination_url_source) AS redirect_destination_url_source,
           ANY_VALUE(google_text_ad_meta_data.version)         AS version,
           ANY_VALUE(google_text_ad_meta_data.destination_scraper_status) AS destination_scraper_status,
           ANY_VALUE(google_text_ad_variants.image_url)        AS image_url,
           ANY_VALUE(google_text_ad_variants.title)            AS title,
           ANY_VALUE(google_text_ad_variants.text)             AS text,
           ANY_VALUE(google_text_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(google_text_ad_variants.target_keyword)   AS target_keyword,
           ANY_VALUE(google_text_ad_post_owners.post_owner_name)  AS post_owner_name,
           ANY_VALUE(google_text_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(google_text_ad_domains.domain)                AS domain,
           ANY_VALUE(google_text_ad_domains.domain_registered_date) AS domain_registered_date,
           ANY_VALUE(google_ad_translation.ad_text)            AS tr_ad_text,
           ANY_VALUE(google_ad_translation.news_feed_description) AS tr_news_feed_description,
           ANY_VALUE(google_ad_translation.ad_title)           AS tr_ad_title
    FROM google_text_ad
    LEFT JOIN google_text_country        ON google_text_country.id = google_text_ad.country_id
    LEFT JOIN google_text_ad_meta_data   ON google_text_ad.id = google_text_ad_meta_data.google_text_ad_id
    LEFT JOIN google_text_ad_variants    ON google_text_ad.id = google_text_ad_variants.google_text_ad_id
    LEFT JOIN google_text_ad_post_owners ON google_text_ad.post_owner_id = google_text_ad_post_owners.id
    LEFT JOIN google_text_ad_domains     ON google_text_ad.domain_id = google_text_ad_domains.id
    LEFT JOIN google_ad_translation      ON google_text_ad.id = google_ad_translation.google_ad_id
    WHERE google_text_ad.ad_id = ?
    GROUP BY google_text_ad.id`;
  return rows(await exec.query(sql, [adId]));
}

/**
 * Cascade-delete by internal google_text_ad.id — EXACT list from UserController@deleteads.
 * Wrapped in withTransaction by the caller for atomicity. Missing tables skipped.
 */
async function deleteAdCascade(exec, internalId) {
  const childDeletes = [
    ['google_text_html_content', 'google_text_ad_id'],
    ['google_text_ad_countries', 'google_text_ad_id'],
    ['google_text_ad_countries_only', 'google_text_ad_id'],
    ['google_text_hidden_ads', 'ad_id'],
    ['google_text_ad_meta_data', 'google_text_ad_id'],
    ['google_text_user_affiliate_ads', 'google_text_ad_id'],
    ['google_text_outgoing_url', 'google_text_ad_id'],
    ['google_text_ad_url', 'google_text_ad_id'],
    ['google_text_ad_variants', 'google_text_ad_id'],
    // FK children with ON DELETE RESTRICT (confirmed via information_schema) — NOT in the
    // legacy PHP delete list, so the main delete fails without these. col = google_ad_id.
    ['google_ad_translation', 'google_ad_id'],
    ['google_ad_categories', 'google_ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM google_text_ad WHERE id = ?', [internalId]));
}
async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); }
  catch (err) { if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return; throw err; }
}

// ── google_text_ad_post_owners (dedup by generated post_owner_lower) ──────────
async function getPostOwner(exec, postOwnerLower) {
  return found(await exec.query(
    'SELECT id, ads_count, post_owner_image FROM google_text_ad_post_owners WHERE post_owner_lower = ? LIMIT 1',
    [postOwnerLower]
  ));
}
async function insertPostOwner(exec, d) {
  // post_owner_lower is GENERATED from post_owner_name — never insert it.
  const clean = stripNulls({ post_owner_name: d.post_owner_name, ads_count: d.ads_count ?? 1, post_owner_image: d.post_owner_image });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO google_text_ad_post_owners (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE google_text_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── google_text_country_only ─────────────────────────────────────────────────
async function getCountryOnly(exec, country) {
  return found(await exec.query('SELECT id FROM google_text_country_only WHERE country = ? LIMIT 1', [country]));
}
async function insertCountryOnly(exec, country) {
  return firstId(await exec.query('INSERT INTO google_text_country_only (country) VALUES (?)', [country]));
}

// ── google_text_country ──────────────────────────────────────────────────────
async function getCountry(exec, where) {
  return found(await exec.query(
    'SELECT id FROM google_text_country WHERE city <=> ? AND state <=> ? AND country <=> ? LIMIT 1',
    [where.city ?? null, where.state ?? null, where.country ?? null]
  ));
}
async function insertCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO google_text_country (city, state, country, country_only_id, status) VALUES (?,?,?,?,1)',
    [d.city ?? null, d.state ?? null, d.country ?? null, d.country_only_id ?? null]
  ));
}

// ── google_text_ad_domains ───────────────────────────────────────────────────
async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id, domain, domain_registered_date FROM google_text_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO google_text_ad_domains (domain) VALUES (?)', [domain]));
}
async function getDomainRegisteredDate(exec, domainId) {
  const r = rows(await exec.query('SELECT domain, domain_registered_date FROM google_text_ad_domains WHERE id = ? LIMIT 1', [domainId]));
  return r.length ? r[0] : null;
}

// ── google_text_ad_variants ──────────────────────────────────────────────────
async function insertVariant(exec, d) {
  const clean = stripNulls({
    google_text_ad_id: d.google_text_ad_id,
    title: d.title ?? '', text: d.text ?? '', newsfeed_description: d.newsfeed_description ?? '',
    image_url_original: d.image_url_original ?? null, image_url: d.image_url ?? null,
    target_keyword: d.target_keyword ?? '', target_page: d.target_page ?? null,
  });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO google_text_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateVariantByAdId(exec, data, googleTextAdId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE google_text_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE google_text_ad_id = ?`,
    [...Object.values(data), googleTextAdId]
  ));
}
async function getVariantByAdId(exec, googleTextAdId) {
  return found(await exec.query('SELECT id, target_keyword FROM google_text_ad_variants WHERE google_text_ad_id = ? LIMIT 1', [googleTextAdId]));
}

// ── google_text_ad_countries / _only ─────────────────────────────────────────
async function getAdCountry(exec, googleTextAdId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM google_text_ad_countries WHERE google_text_ad_id = ? AND country_only_id = ? LIMIT 1',
    [googleTextAdId, countryOnlyId]
  ));
}
async function insertAdCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO google_text_ad_countries (google_text_ad_id, country_id, country_only_id, count) VALUES (?,?,?,?)',
    [d.google_text_ad_id, d.country_id ?? null, d.country_only_id ?? null, d.count ?? 1]
  ));
}
async function bumpAdCountryCount(exec, id) {
  return affected(await exec.query('UPDATE google_text_ad_countries SET count = count + 1 WHERE id = ?', [id]));
}
async function getAdCountryOnly(exec, googleTextAdId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM google_text_ad_countries_only WHERE google_text_ad_id = ? AND country_only_id = ? LIMIT 1',
    [googleTextAdId, countryOnlyId]
  ));
}
async function insertAdCountryOnly(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO google_text_ad_countries_only (google_text_ad_id, country_only_id, count) VALUES (?,?,?)',
    [d.google_text_ad_id, d.country_only_id ?? null, d.count ?? 1]
  ));
}
async function bumpAdCountryOnlyCount(exec, id) {
  return affected(await exec.query('UPDATE google_text_ad_countries_only SET count = count + 1 WHERE id = ?', [id]));
}

// ── google_text_ad_meta_data ─────────────────────────────────────────────────
async function insertMetaData(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO google_text_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── google_ad_translation (upsert on google_ad_id) ───────────────────────────
async function upsertTranslation(exec, d) {
  const existing = rows(await exec.query('SELECT google_ad_id FROM google_ad_translation WHERE google_ad_id = ? LIMIT 1', [d.google_ad_id]));
  if (existing.length) {
    await exec.query(
      'UPDATE google_ad_translation SET ad_text = ?, ad_title = ?, news_feed_description = ? WHERE google_ad_id = ?',
      [d.ad_text ?? null, d.ad_title ?? null, d.news_feed_description ?? null, d.google_ad_id]
    );
  } else {
    await exec.query(
      'INSERT INTO google_ad_translation (google_ad_id, ad_text, ad_title, news_feed_description) VALUES (?,?,?,?)',
      [d.google_ad_id, d.ad_text ?? null, d.ad_title ?? null, d.news_feed_description ?? null]
    );
  }
  return true;
}

// ── gtext_ad_users (platform 10 = system) ────────────────────────────────────
async function getGtextUser(exec, systemId) {
  return found(await exec.query('SELECT id, ads_count FROM gtext_ad_users WHERE system_id = ? LIMIT 1', [systemId]));
}
async function insertGtextUser(exec, d) {
  return firstId(await exec.query('INSERT INTO gtext_ad_users (system_id, ads_count) VALUES (?,?)', [d.system_id, d.ads_count ?? 1]));
}
async function bumpGtextUserCount(exec, id) {
  return affected(await exec.query('UPDATE gtext_ad_users SET ads_count = ads_count + 1 WHERE id = ?', [id]));
}

// ── google_accout_activities (platform 10) ───────────────────────────────────
async function insertAccountActivity(exec, d) {
  return affected(await exec.query(
    'INSERT INTO google_accout_activities (system_id, google_ad_id, platform, is_unique) VALUES (?,?,?,?)',
    [d.system_id ?? null, d.google_ad_id, d.platform ?? null, d.is_unique ?? 0]
  ));
}

module.exports = {
  withTransaction,
  getAdByAdId, insertGoogleTextAd, updateGoogleTextAd, getJoinedAd, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getCountryOnly, insertCountryOnly,
  getCountry, insertCountry,
  getDomain, insertDomain, getDomainRegisteredDate,
  insertVariant, updateVariantByAdId, getVariantByAdId,
  getAdCountry, insertAdCountry, bumpAdCountryCount,
  getAdCountryOnly, insertAdCountryOnly, bumpAdCountryOnlyCount,
  insertMetaData,
  upsertTranslation,
  getGtextUser, insertGtextUser, bumpGtextUserCount,
  insertAccountActivity,
};
