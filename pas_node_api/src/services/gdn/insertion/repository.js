'use strict';

/**
 * GDN insertion — data repository (raw parameterized SQL).
 *
 * Faithful port of the Eloquent model calls used by insertNewGdnAds() / processAd()
 * / updateAdsData() / deleteads() (see ../../../../PHP-SPEC-gdn.md §3–5). One function
 * per DB operation, grouped by table. No business logic — the pipelines orchestrate.
 *
 * Every function takes `exec` first: an object with `query(sql, params)`. Pass
 * `db.sql` for autocommit, or a transaction wrapper (withTransaction) in the INSERT
 * path. Return conventions:
 *   - getX    → { code:200, data:rows } | { code:400, data:null }
 *   - insertX → inserted id (number)
 *   - updateX → affected row count (number)
 */

const { latin1Safe } = require('../../../insertion/helpers/util');

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

// ── gdn_ad ────────────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM gdn_ad WHERE ad_id = ? LIMIT 1', [adId]));
}
// Near-duplicate dedup on the perceptual hash. Does THIS advertiser already have a creative whose dhash
// is within `maxHam` bits of the new one? Exact ad_id (SHA-256) dedup misses re-renders of the same ad;
// hamming-match the 64-bit dhash stored in gdn_ad.phash, scoped to one post_owner so distinct advertisers
// never collapse. `phashHex` is the new ad's 16-hex dhash; converted to the BIGINT the column stores.
async function getNearHashAd(exec, postOwnerName, phashHex, maxHam) {
  const lower = String(postOwnerName || '').toLowerCase().trim();
  if (!lower || !/^[0-9a-f]{16}$/i.test(String(phashHex || ''))) return { code: 400, data: null };
  const po = rows(await exec.query('SELECT id FROM gdn_ad_post_owners WHERE LOWER(post_owner_name) = ? LIMIT 1', [lower]));
  if (!po.length) return { code: 400, data: null };   // new advertiser -> no possible dupe
  const phashDec = BigInt('0x' + phashHex).toString();
  return found(await exec.query(
    'SELECT id FROM gdn_ad WHERE post_owner_id = ? AND phash IS NOT NULL ' +
    'AND BIT_COUNT(phash ^ ?) <= ? LIMIT 1',
    [po[0].id, phashDec, maxHam]));
}
async function insertGdnAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO gdn_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
async function updateGdnAd(exec, data, internalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE gdn_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), internalId]
  ));
}

// Big denormalized join for the ES doc (PHP insertAdToElasticSearch query).
// Joined columns are aliased to bare FIELD names (what esDocBuilder reads) and wrapped
// in ANY_VALUE() for only_full_group_by compatibility.
async function getJoinedAd(exec, whereCol, whereVal) {
  const sql = `
    SELECT gdn_ad.*,
           ANY_VALUE(gdn_country_only.country)            AS country,
           ANY_VALUE(gdn_ad_variants.title)               AS title,
           ANY_VALUE(gdn_ad_variants.text)                AS text,
           ANY_VALUE(gdn_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(gdn_ad_variants.ad_image_size)       AS ad_image_size,
           ANY_VALUE(gdn_ad_variants.image_object)        AS image_object,
           ANY_VALUE(gdn_ad_variants.image_celebrity)     AS image_celebrity,
           ANY_VALUE(gdn_ad_variants.image_brand_logo)    AS image_brand_logo,
           ANY_VALUE(gdn_ad_variants.image_ocr)           AS image_ocr,
           ANY_VALUE(gdn_ad_variants.image_url)           AS image_url,
           ANY_VALUE(gdn_ad_variants.image_url_original)  AS image_url_original,
           ANY_VALUE(gdn_ad_url.url)                      AS url,
           ANY_VALUE(gdn_ad_post_owners.post_owner_name)  AS post_owner_name,
           ANY_VALUE(gdn_ad_post_owners.post_owner_lower) AS post_owner_lower,
           ANY_VALUE(gdn_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(gdn_ad_meta_data.affiliate_data)     AS affiliate_data,
           ANY_VALUE(gdn_ad_meta_data.destination_url)    AS destination_url,
           ANY_VALUE(gdn_ad_meta_data.redirect_url)       AS redirect_url,
           ANY_VALUE(gdn_ad_meta_data.ad_url)             AS ad_url,
           ANY_VALUE(gdn_ad_meta_data.firstSeenOnDesktop) AS firstSeenOnDesktop,
           ANY_VALUE(gdn_ad_meta_data.built_with)         AS built_with,
           ANY_VALUE(gdn_ad_meta_data.built_with_analytics_tracking) AS built_with_analytics_tracking,
           ANY_VALUE(gdn_ad_meta_data.platform)           AS platform,
           ANY_VALUE(gdn_target_site.target_site)         AS target_site,
           ANY_VALUE(gdn_placement_url.placement_url)     AS placement_url,
           ANY_VALUE(gdn_ad_domains.domain_registered_date) AS domain_registered_date,
           ANY_VALUE(gdn_ad_translation.ad_text)          AS ad_text,
           ANY_VALUE(gdn_ad_translation.news_feed_description) AS news_feed_description,
           ANY_VALUE(gdn_ad_translation.ad_title)         AS ad_title
    FROM gdn_ad
    LEFT JOIN gdn_country_only   ON gdn_ad.country_only_id = gdn_country_only.id
    LEFT JOIN gdn_ad_meta_data   ON gdn_ad.id = gdn_ad_meta_data.gdn_ad_id
    LEFT JOIN gdn_ad_post_owners ON gdn_ad.post_owner_id = gdn_ad_post_owners.id
    LEFT JOIN gdn_ad_variants    ON gdn_ad.id = gdn_ad_variants.gdn_ad_id
    LEFT JOIN gdn_ad_domains     ON gdn_ad.domain_id = gdn_ad_domains.id
    LEFT JOIN gdn_ad_url         ON gdn_ad.id = gdn_ad_url.gdn_ad_id
    LEFT JOIN gdn_target_site    ON gdn_ad.target_site_id = gdn_target_site.id
    LEFT JOIN gdn_placement_url  ON gdn_placement_url.gdn_ad_id = gdn_ad.id
    LEFT JOIN gdn_ad_translation ON gdn_ad.id = gdn_ad_translation.gdn_ad_id
    WHERE ${whereCol} = ?
    GROUP BY gdn_ad.id`;
  return rows(await exec.query(sql, [whereVal]));
}

/**
 * Cascade-delete an ad and all child rows by internal gdn_ad.id (PHP deleteads list).
 * Run inside withTransaction for atomicity. Tables that don't exist in this env are skipped.
 */
async function deleteAdCascade(exec, internalId) {
  const childDeletes = [
    ['gdn_ad_html_lander_content', 'gdn_ad_id'],
    ['gdn_ad_translation', 'gdn_ad_id'],
    ['gdn_placement_url', 'gdn_ad_id'],
    ['gdn_ad_target_site', 'gdn_ad_id'],
    ['gdn_ad_url', 'gdn_ad_id'],
    ['gdn_ad_countries', 'gdn_ad_id'],
    ['gdn_ad_countries_only', 'gdn_ad_id'],
    ['gdn_ad_meta_data', 'gdn_ad_id'],
    ['gdn_ad_variants', 'gdn_ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM gdn_ad WHERE id = ?', [internalId]));
}
async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); }
  catch (err) { if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return; throw err; }
}

// ── gdn_ad_post_owners (dedup by name, case-insensitive) ────────────────────────
// PHP looks up post_owner_name = strtolower(post_owner). On a case-SENSITIVE column
// collation that misses an original-case stored value (e.g. 'Acme Corp'), so the next
// insert hits the UNIQUE key → "Duplicate entry". Using LOWER(col) matches regardless
// of how the existing row was cased, so we bump the count instead of re-inserting.
async function getPostOwner(exec, postOwnerLower) {
  return found(await exec.query(
    'SELECT id, ads_count, post_owner_image FROM gdn_ad_post_owners WHERE LOWER(post_owner_name) = ? LIMIT 1',
    [postOwnerLower]
  ));
}
async function insertPostOwner(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_ad_post_owners (post_owner_name, ads_count, post_owner_image) VALUES (?,?,?)',
    [d.post_owner_name, d.ads_count ?? 1, d.post_owner_image ?? '/DefaultImage.jpg']
  ));
}
async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE gdn_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── gdn_country_only (dedup country) ────────────────────────────────────────────
async function getCountryOnly(exec, country) {
  return found(await exec.query('SELECT id FROM gdn_country_only WHERE country = ? LIMIT 1', [country]));
}
async function insertCountryOnly(exec, country) {
  return firstId(await exec.query('INSERT INTO gdn_country_only (country) VALUES (?)', [country]));
}

// ── gdn_country (city/state/country) ────────────────────────────────────────────
async function getCountry(exec, where) {
  return found(await exec.query(
    'SELECT id FROM gdn_country WHERE city <=> ? AND state <=> ? AND country <=> ? LIMIT 1',
    [where.city ?? null, where.state ?? null, where.country ?? null]
  ));
}
async function insertCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_country (city, state, country, country_only_id, status) VALUES (?,?,?,?,1)',
    [d.city ?? null, d.state ?? null, d.country ?? null, d.country_only_id ?? null]
  ));
}

// ── gdn_ad_domains (dedup domain) ───────────────────────────────────────────────
async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id FROM gdn_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO gdn_ad_domains (domain) VALUES (?)', [domain]));
}
async function getDomainRegisteredDate(exec, domainId) {
  const r = rows(await exec.query('SELECT domain_registered_date FROM gdn_ad_domains WHERE id = ? LIMIT 1', [domainId]));
  return r.length ? r[0].domain_registered_date : null;
}

// ── gdn_target_site (dedup target_site) ─────────────────────────────────────────
async function getTargetSite(exec, targetSite) {
  return found(await exec.query('SELECT id FROM gdn_target_site WHERE target_site = ? LIMIT 1', [targetSite]));
}
async function insertTargetSite(exec, targetSite) {
  return firstId(await exec.query('INSERT INTO gdn_target_site (target_site) VALUES (?)', [targetSite]));
}

// ── gdn_ad_target_site (one row per ad+site+day) ────────────────────────────────
async function getAdTargetSiteForDay(exec, gdnAdId, targetSiteId, date) {
  return found(await exec.query(
    'SELECT id FROM gdn_ad_target_site WHERE gdn_ad_id = ? AND target_site_id = ? AND DATE(created_date) = ? LIMIT 1',
    [gdnAdId, targetSiteId, date]
  ));
}
async function insertAdTargetSite(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_ad_target_site (gdn_ad_id, target_site_id, count, date) VALUES (?,?,?,?)',
    [d.gdn_ad_id, d.target_site_id, d.count ?? 1, d.date]
  ));
}
async function getTargetSitesCsv(exec, gdnAdId) {
  const r = rows(await exec.query(
    `SELECT GROUP_CONCAT(gdn_target_site.target_site) AS target_site
       FROM gdn_ad_target_site
       LEFT JOIN gdn_target_site ON gdn_ad_target_site.target_site_id = gdn_target_site.id
      WHERE gdn_ad_target_site.gdn_ad_id = ?`,
    [gdnAdId]
  ));
  const csv = r.length ? r[0].target_site : null;
  return csv ? [...new Set(String(csv).split(','))] : [];
}

// ── gdn_placement_url (one row per ad+url+day) ──────────────────────────────────
async function getPlacementForDay(exec, gdnAdId, placementUrl, date) {
  return found(await exec.query(
    'SELECT id FROM gdn_placement_url WHERE gdn_ad_id = ? AND placement_url = ? AND DATE(created_date) = ? LIMIT 1',
    [gdnAdId, placementUrl, date]
  ));
}
async function insertPlacementUrl(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_placement_url (gdn_ad_id, placement_url, count) VALUES (?,?,?)',
    [d.gdn_ad_id, d.placement_url, d.count ?? 1]
  ));
}

// ── gdn_ad_variants ─────────────────────────────────────────────────────────────
async function insertVariant(exec, d) {
  const clean = stripNulls({
    gdn_ad_id: d.gdn_ad_id,
    title: d.title ?? '',
    text: d.text ?? '',
    newsfeed_description: d.newsfeed_description ?? '',
    image_url_original: latin1Safe(d.image_url_original) ?? null,
    ad_image_size: d.ad_image_size ?? null,
    image_url: d.image_url ?? '/bydefault_ads.jpg',
  });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO gdn_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateVariantByAdId(exec, data, gdnAdId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE gdn_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE gdn_ad_id = ?`,
    [...Object.values(data), gdnAdId]
  ));
}

// ── gdn_ad_countries / _countries_only ──────────────────────────────────────────
async function getAdCountry(exec, gdnAdId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM gdn_ad_countries WHERE gdn_ad_id = ? AND country_only_id = ? LIMIT 1',
    [gdnAdId, countryOnlyId]
  ));
}
async function insertAdCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_ad_countries (gdn_ad_id, country_id, country_only_id, count) VALUES (?,?,?,?)',
    [d.gdn_ad_id, d.country_id ?? null, d.country_only_id ?? null, d.count ?? 1]
  ));
}
async function bumpAdCountryCount(exec, id) {
  return affected(await exec.query('UPDATE gdn_ad_countries SET count = count + 1 WHERE id = ?', [id]));
}
async function getAdCountryOnly(exec, gdnAdId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM gdn_ad_countries_only WHERE gdn_ad_id = ? AND country_only_id = ? LIMIT 1',
    [gdnAdId, countryOnlyId]
  ));
}
async function insertAdCountryOnly(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_ad_countries_only (gdn_ad_id, country_only_id, count, ip_address) VALUES (?,?,?,?)',
    [d.gdn_ad_id, d.country_only_id ?? null, d.count ?? 1, d.ip_address ?? null]
  ));
}
async function bumpAdCountryOnlyCount(exec, id) {
  return affected(await exec.query('UPDATE gdn_ad_countries_only SET count = count + 1 WHERE id = ?', [id]));
}

// ── gdn_ad_meta_data ────────────────────────────────────────────────────────────
async function insertMetaData(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO gdn_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── gdn_ad_url ──────────────────────────────────────────────────────────────────
async function insertAdUrl(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_ad_url (gdn_ad_id, url_type, url) VALUES (?,?,?)',
    [d.gdn_ad_id, d.url_type ?? 'D', d.url ?? null]
  ));
}

// ── gdn_ad_translation (upsert on gdn_ad_id) ────────────────────────────────────
// ad_text / ad_title / news_feed_description are NOT NULL in the DB; coalesce to '' so a null from a
// caller can never raise "Column 'ad_text' cannot be null" and roll back the ad (defensive guard).
async function upsertTranslation(exec, d) {
  const txt = d.ad_text ?? '';
  const ttl = d.ad_title ?? '';
  const nfd = d.news_feed_description ?? '';
  const existing = rows(await exec.query('SELECT gdn_ad_id FROM gdn_ad_translation WHERE gdn_ad_id = ? LIMIT 1', [d.gdn_ad_id]));
  if (existing.length) {
    await exec.query(
      'UPDATE gdn_ad_translation SET ad_text = ?, ad_title = ?, news_feed_description = ? WHERE gdn_ad_id = ?',
      [txt, ttl, nfd, d.gdn_ad_id]
    );
  } else {
    await exec.query(
      'INSERT INTO gdn_ad_translation (gdn_ad_id, ad_text, ad_title, news_feed_description) VALUES (?,?,?,?)',
      [d.gdn_ad_id, txt, ttl, nfd]
    );
  }
  return true;
}

// ── gdn_ad_users (gtext / platform 12) ──────────────────────────────────────────
async function getGtextUser(exec, systemId) {
  return found(await exec.query('SELECT id, ads_count FROM gdn_ad_users WHERE system_id = ? LIMIT 1', [systemId]));
}
async function insertGtextUser(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO gdn_ad_users (system_id, ads_count) VALUES (?,?)',
    [d.system_id, d.ads_count ?? 1]
  ));
}
async function bumpGtextUserCount(exec, id) {
  return affected(await exec.query('UPDATE gdn_ad_users SET ads_count = ads_count + 1 WHERE id = ?', [id]));
}

// ── gdn_account_activities (platform 12) ────────────────────────────────────────
async function insertAccountActivity(exec, d) {
  return affected(await exec.query(
    'INSERT INTO gdn_account_activities (system_id, gdn_ad_id, platform, is_unique) VALUES (?,?,?,?)',
    [d.system_id ?? null, d.gdn_ad_id, d.platform ?? null, d.is_unique ?? 0]
  ));
}

// ── languages ───────────────────────────────────────────────────────────────────
async function getLanguageId(exec, iso) {
  const r = rows(await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [String(iso).toUpperCase()]));
  return r.length ? r[0].id : null;
}

module.exports = {
  withTransaction,
  getAdByAdId, getNearHashAd, insertGdnAd, updateGdnAd, getJoinedAd, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getCountryOnly, insertCountryOnly,
  getCountry, insertCountry,
  getDomain, insertDomain, getDomainRegisteredDate,
  getTargetSite, insertTargetSite,
  getAdTargetSiteForDay, insertAdTargetSite, getTargetSitesCsv,
  getPlacementForDay, insertPlacementUrl,
  insertVariant, updateVariantByAdId,
  getAdCountry, insertAdCountry, bumpAdCountryCount,
  getAdCountryOnly, insertAdCountryOnly, bumpAdCountryOnlyCount,
  insertMetaData,
  insertAdUrl,
  upsertTranslation,
  getGtextUser, insertGtextUser, bumpGtextUserCount,
  insertAccountActivity,
  getLanguageId,
};
