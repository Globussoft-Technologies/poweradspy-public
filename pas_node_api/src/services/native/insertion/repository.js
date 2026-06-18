'use strict';

/**
 * Native insertion — data repository (raw parameterized SQL).
 * Mirrors the Facebook repository pattern with native table names.
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

const rows     = (r) => (Array.isArray(r) ? r : []);
const firstId  = (r) => (r && r.insertId ? r.insertId : 0);
const affected  = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found    = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });
const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// ── native_ad ──────────────────────────────────────────────────────────────────

async function getAdByAdId(exec, adId) {
  const r = await exec.query('SELECT id, domain_id, first_seen FROM native_ad WHERE ad_id = ? LIMIT 1', [adId]);
  return found(r);
}

async function insertNativeAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO native_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}

async function updateNativeAd(exec, data, id) {
  const cols = Object.keys(data);
  const sql = `UPDATE native_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), id]));
}

async function getJoinedAd(exec, id) {
  const sql = `
    SELECT
      native_ad.id, native_ad.source, native_ad.post_date, native_ad.first_seen,
      native_ad.last_seen, native_ad.days_running, native_ad.ad_position, native_ad.type,
      native_ad.domain_id, native_ad.post_owner_id, native_ad.language_id,
      native_ad.network_id, native_ad.target_site_id,
      ANY_VALUE(native_country_only.country)                   AS country,
      ANY_VALUE(native_ad_post_owners.post_owner_name)         AS post_owner_name,
      ANY_VALUE(native_ad_post_owners.post_owner_lower)        AS post_owner_lower,
      ANY_VALUE(native_ad_post_owners.post_owner_image)        AS post_owner_image,
      ANY_VALUE(native_ad_meta_data.destination_url)           AS destination_url,
      ANY_VALUE(native_ad_meta_data.redirect_url)              AS redirect_url,
      ANY_VALUE(native_ad_meta_data.ad_url)                    AS ad_url,
      ANY_VALUE(native_ad_meta_data.tracker_url)               AS tracker_url,
      ANY_VALUE(native_ad_meta_data.firstSeenOnDesktop)        AS firstSeenOnDesktop,
      ANY_VALUE(native_ad_meta_data.built_with)                AS built_with,
      ANY_VALUE(native_ad_meta_data.affiliate_data)            AS affiliate_data,
      ANY_VALUE(native_ad_meta_data.built_with_analytics_tracking) AS built_with_analytics_tracking,
      ANY_VALUE(native_ad_variants.title)                      AS title,
      ANY_VALUE(native_ad_variants.text)                       AS text,
      ANY_VALUE(native_ad_variants.newsfeed_description)       AS newsfeed_description,
      ANY_VALUE(native_ad_variants.image_url)                  AS image_url,
      ANY_VALUE(native_ad_variants.image_url_original)         AS image_url_original,
      ANY_VALUE(native_ad_variants.image_object)               AS image_object,
      ANY_VALUE(native_ad_variants.image_celebrity)            AS image_celebrity,
      ANY_VALUE(native_ad_variants.image_brand_logo)           AS image_brand_logo,
      ANY_VALUE(native_ad_variants.image_ocr)                  AS image_ocr,
      ANY_VALUE(native_ad_url.url)                             AS url,
      ANY_VALUE(networks.network)                              AS network,
      ANY_VALUE(target_site.target_site)                       AS target_site,
      ANY_VALUE(native_placement_url.placement_url)            AS placement_url,
      ANY_VALUE(native_ad_domains.domain)                      AS domain,
      ANY_VALUE(native_ad_domains.domain_registered_date)      AS domain_registered_date,
      ANY_VALUE(native_ad_translation.ad_text)                 AS ad_text,
      ANY_VALUE(native_ad_translation.news_feed_description)   AS news_feed_description,
      ANY_VALUE(native_ad_translation.ad_title)                AS ad_title
    FROM native_ad
    LEFT JOIN native_country_only       ON native_ad.country_only_id = native_country_only.id
    LEFT JOIN native_ad_meta_data       ON native_ad.id = native_ad_meta_data.native_ad_id
    LEFT JOIN native_ad_post_owners     ON native_ad.post_owner_id = native_ad_post_owners.id
    LEFT JOIN native_ad_variants        ON native_ad.id = native_ad_variants.native_ad_id
    LEFT JOIN native_ad_domains         ON native_ad.domain_id = native_ad_domains.id
    LEFT JOIN native_ad_url             ON native_ad.id = native_ad_url.native_ad_id
    LEFT JOIN networks                  ON native_ad.network_id = networks.id
    LEFT JOIN target_site               ON native_ad.target_site_id = target_site.id
    LEFT JOIN native_placement_url      ON native_placement_url.native_ad_id = native_ad.id
    LEFT JOIN native_ad_translation     ON native_ad.id = native_ad_translation.native_ad_id
    WHERE native_ad.id = ?
    GROUP BY native_ad.id`;
  return rows(await exec.query(sql, [id]));
}

async function deleteAdCascade(exec, id) {
  const childDeletes = [
    ['native_ad_html_lander_content',   'native_ad_id'],
    ['native_ad_translation',           'native_ad_id'],
    ['native_ad_countries',             'native_ad_id'],
    ['native_ad_countries_only',        'native_ad_id'],
    ['native_hidden_ads',               'ad_id'],
    ['native_ad_image_video',           'facebook_ad_id'],
    ['native_ad_meta_data',             'native_ad_id'],
    ['native_ad_network',               'native_ad_id'],
    ['native_ad_outgoing_links',        'native_ad_id'],
    ['native_ad_url',                   'native_ad_id'],
    ['native_ad_variants',              'native_ad_id'],
    ['native_placement_url',            'native_ad_id'],
    ['native_ad_target_site',           'native_ad_id'],
    ['native_ad_recommended_activity',  'ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [id]);
  }
  return affected(await exec.query('DELETE FROM native_ad WHERE id = ?', [id]));
}

async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); }
  catch (err) { if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return; throw err; }
}

// ── native_ad_post_owners ──────────────────────────────────────────────────────

async function getPostOwner(exec, postOwnerLower) {
  const r = await exec.query(
    'SELECT id, ads_count, post_owner_image, image_updated FROM native_ad_post_owners WHERE post_owner_lower = ? OR post_owner_name = ? LIMIT 1',
    [postOwnerLower, postOwnerLower]
  );
  return found(r);
}

async function insertPostOwner(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_ad_post_owners (post_owner_name, post_owner_image, ads_count, image_updated) VALUES (?,?,?,?)',
    [d.post_owner_name, d.post_owner_image ?? '/DefaultImage.jpg', d.ads_count ?? 1, d.image_updated ?? 0]
  ));
}

async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE native_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// Perceptual near-duplicate lookup: does THIS post owner already have a creative whose dhash is within
// `maxHam` bits of phashHex? native_ad.phash stores the 64-bit dhash as BIGINT UNSIGNED; hamming = BIT_COUNT(XOR).
// Scoped to one post_owner so distinct advertisers' similar creatives never collapse. Native ad_id stays MD5.
async function getNearHashAd(exec, postOwnerName, phashHex, maxHam) {
  const owner = typeof postOwnerName === 'string' ? postOwnerName.trim().toLowerCase() : '';
  if (!owner) return { code: 400, data: null };
  if (typeof phashHex !== 'string' || !/^[0-9a-f]{16}$/i.test(phashHex.trim())) return { code: 400, data: null };
  const phashDec = BigInt('0x' + phashHex.trim().toLowerCase()).toString();
  const ham = Number.isInteger(maxHam) ? maxHam : 4;
  const po = found(await exec.query(
    'SELECT id FROM native_ad_post_owners WHERE post_owner_lower = ? OR post_owner_name = ? LIMIT 1',
    [owner, owner]
  ));
  if (po.code !== 200 || !po.data || !po.data[0]) return { code: 400, data: null };
  const ownerId = po.data[0].id;
  return found(await exec.query(
    'SELECT id FROM native_ad WHERE post_owner_id = ? AND phash IS NOT NULL AND BIT_COUNT(phash ^ ?) <= ? LIMIT 1',
    [ownerId, phashDec, ham]
  ));
}

// ── native_country_only ────────────────────────────────────────────────────────

async function getCountryOnly(exec, country) {
  return found(await exec.query('SELECT id FROM native_country_only WHERE country = ? LIMIT 1', [country]));
}

async function insertCountryOnly(exec, country) {
  return firstId(await exec.query('INSERT INTO native_country_only (country) VALUES (?)', [country]));
}

// ── native_country ─────────────────────────────────────────────────────────────

async function getCountry(exec, city, state, country) {
  return found(await exec.query(
    'SELECT id FROM native_country WHERE city <=> ? AND state <=> ? AND country <=> ? LIMIT 1',
    [city ?? null, state ?? null, country ?? null]
  ));
}

async function insertCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_country (city, state, country, country_only_id, status) VALUES (?,?,?,?,?)',
    [d.city ?? null, d.state ?? null, d.country ?? null, d.country_only_id ?? null, 1]
  ));
}

// ── native_ad_domains ──────────────────────────────────────────────────────────

async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id FROM native_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}

async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO native_ad_domains (domain) VALUES (?)', [domain]));
}

// ── networks (shared) ──────────────────────────────────────────────────────────

async function getNetwork(exec, network) {
  return found(await exec.query('SELECT id FROM networks WHERE network = ? LIMIT 1', [network]));
}

async function insertNetwork(exec, network) {
  return firstId(await exec.query('INSERT INTO networks (network) VALUES (?)', [network]));
}

// ── target_site (shared) ──────────────────────────────────────────────────────

async function getTargetSite(exec, targetSite) {
  return found(await exec.query('SELECT id FROM target_site WHERE target_site = ? LIMIT 1', [targetSite]));
}

async function insertTargetSite(exec, targetSite) {
  return firstId(await exec.query('INSERT INTO target_site (target_site) VALUES (?)', [targetSite]));
}

// ── native_ad_target_site ─────────────────────────────────────────────────────

async function getNativeAdTargetSite(exec, adId, targetSiteId) {
  return found(await exec.query(
    'SELECT id, count, date, created_date FROM native_ad_target_site WHERE native_ad_id = ? AND target_site_id = ? ORDER BY created_date DESC LIMIT 1',
    [adId, targetSiteId]
  ));
}

async function insertNativeAdTargetSite(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_ad_target_site (native_ad_id, target_site_id, count, date) VALUES (?,?,?,?)',
    [d.native_ad_id, d.target_site_id, d.count ?? 1, d.date]
  ));
}

async function updateNativeAdTargetSiteCount(exec, id) {
  return affected(await exec.query('UPDATE native_ad_target_site SET count = count + 1 WHERE id = ?', [id]));
}

// ── native_ad_network ─────────────────────────────────────────────────────────

async function getNativeAdNetwork(exec, adId, networkId) {
  return found(await exec.query(
    'SELECT id, count, created_date FROM native_ad_network WHERE native_ad_id = ? AND network_id = ? ORDER BY created_date DESC LIMIT 1',
    [adId, networkId]
  ));
}

async function insertNativeAdNetwork(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_ad_network (native_ad_id, network_id, count) VALUES (?,?,?)',
    [d.native_ad_id, d.network_id, d.count ?? 1]
  ));
}

async function updateNativeAdNetworkCount(exec, id) {
  return affected(await exec.query('UPDATE native_ad_network SET count = count + 1 WHERE id = ?', [id]));
}

// ── native_placement_url ──────────────────────────────────────────────────────

async function getNativePlacementUrl(exec, adId, placementUrl) {
  return found(await exec.query(
    'SELECT id, count, created_date FROM native_placement_url WHERE native_ad_id = ? AND placement_url = ? ORDER BY created_date DESC LIMIT 1',
    [adId, placementUrl]
  ));
}

async function insertNativePlacementUrl(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_placement_url (native_ad_id, placement_url, count) VALUES (?,?,?)',
    [d.native_ad_id, d.placement_url, d.count ?? 1]
  ));
}

async function updateNativePlacementUrlCount(exec, id) {
  return affected(await exec.query('UPDATE native_placement_url SET count = count + 1 WHERE id = ?', [id]));
}

// ── native_ad_variants ────────────────────────────────────────────────────────

async function insertNativeAdVariant(exec, d) {
  const clean = stripNulls({
    native_ad_id:         d.native_ad_id,
    title:                d.title                ?? '',
    text:                 d.text                 ?? '',
    newsfeed_description: d.newsfeed_description ?? '',
    image_url_original:   d.image_url_original   ?? null,
    image_url:            d.image_url            ?? null,
  });
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO native_ad_variants (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

async function updateNativeAdVariant(exec, data, adId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE native_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE native_ad_id = ?`,
    [...Object.values(data), adId]
  ));
}

// ── native_ad_countries ───────────────────────────────────────────────────────

async function getNativeAdCountry(exec, adId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM native_ad_countries WHERE native_ad_id = ? AND country_only_id = ? LIMIT 1',
    [adId, countryOnlyId]
  ));
}

async function insertNativeAdCountry(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_ad_countries (native_ad_id, country_id, country_only_id, count) VALUES (?,?,?,?)',
    [d.native_ad_id, d.country_id ?? null, d.country_only_id, d.count ?? 1]
  ));
}

async function updateNativeAdCountryCount(exec, id) {
  return affected(await exec.query('UPDATE native_ad_countries SET count = count + 1 WHERE id = ?', [id]));
}

// ── native_ad_countries_only ──────────────────────────────────────────────────

async function getNativeAdCountryOnly(exec, adId, countryOnlyId) {
  return found(await exec.query(
    'SELECT id, count FROM native_ad_countries_only WHERE native_ad_id = ? AND country_only_id = ? LIMIT 1',
    [adId, countryOnlyId]
  ));
}

async function insertNativeAdCountryOnly(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_ad_countries_only (native_ad_id, country_only_id, count, ip_address) VALUES (?,?,?,?)',
    [d.native_ad_id, d.country_only_id, d.count ?? 1, d.ip_address ?? null]
  ));
}

async function updateNativeAdCountryOnlyCount(exec, id) {
  return affected(await exec.query('UPDATE native_ad_countries_only SET count = count + 1 WHERE id = ?', [id]));
}

// ── native_ad_meta_data ───────────────────────────────────────────────────────

async function insertNativeAdMetaData(exec, d) {
  const clean = stripNulls(d);
  const cols  = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO native_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── native_ad_translation ─────────────────────────────────────────────────────

async function upsertNativeTranslation(exec, d) {
  return firstId(await exec.query(
    `INSERT INTO native_ad_translation (native_ad_id, ad_text, news_feed_description, ad_title)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE
       ad_text = VALUES(ad_text),
       news_feed_description = VALUES(news_feed_description),
       ad_title = VALUES(ad_title)`,
    [d.native_ad_id, d.ad_text ?? '', d.news_feed_description ?? '', d.ad_title ?? '']
  ));
}

// ── languages (shared) ────────────────────────────────────────────────────────

async function getLanguageId(exec, iso) {
  const r = await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [String(iso).toUpperCase()]);
  return rows(r).length ? rows(r)[0].id : 0;
}

// ── native_ad_users (platform 12) ────────────────────────────────────────────

async function getNativeAdUser(exec, systemId) {
  return found(await exec.query('SELECT id, ads_count FROM native_ad_users WHERE system_id = ? LIMIT 1', [systemId]));
}

async function insertNativeAdUser(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_ad_users (system_id, ads_count) VALUES (?,?)',
    [d.system_id, d.ads_count ?? 1]
  ));
}

async function updateNativeAdUserCount(exec, id) {
  return affected(await exec.query('UPDATE native_ad_users SET ads_count = ads_count + 1 WHERE id = ?', [id]));
}

// ── native_account_activities (platform 12) ───────────────────────────────────

async function insertNativeAccountActivity(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO native_account_activities (system_id, native_ad_id, platform, is_unique) VALUES (?,?,?,?)',
    [d.system_id, d.native_ad_id, d.platform, d.is_unique ?? 0]
  ));
}

// ── ES helpers (country arrays for search_mix update) ─────────────────────────

async function getAdCountriesList(exec, adId) {
  const r = await exec.query(
    `SELECT native_country_only.country FROM native_ad_countries_only
     LEFT JOIN native_country_only ON native_ad_countries_only.country_only_id = native_country_only.id
     WHERE native_ad_countries_only.native_ad_id = ?`,
    [adId]
  );
  return rows(r).map((row) => row.country).filter(Boolean);
}

async function getTargetSitesList(exec, adId) {
  const r = await exec.query(
    `SELECT target_site.target_site FROM native_ad_target_site
     LEFT JOIN target_site ON native_ad_target_site.target_site_id = target_site.id
     WHERE native_ad_target_site.native_ad_id = ?`,
    [adId]
  );
  return [...new Set(rows(r).map((row) => row.target_site).filter(Boolean))];
}

async function getNetworksList(exec, adId) {
  const r = await exec.query(
    `SELECT networks.network FROM native_ad_network
     LEFT JOIN networks ON native_ad_network.network_id = networks.id
     WHERE native_ad_network.native_ad_id = ?`,
    [adId]
  );
  return [...new Set(rows(r).map((row) => row.network).filter(Boolean))];
}

async function getPlacementUrlsList(exec, adId) {
  const r = await exec.query(
    'SELECT placement_url FROM native_placement_url WHERE native_ad_id = ?',
    [adId]
  );
  return [...new Set(rows(r).map((row) => row.placement_url).filter(Boolean))];
}

module.exports = {
  withTransaction,
  getAdByAdId, insertNativeAd, updateNativeAd, getJoinedAd, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner, getNearHashAd,
  getCountryOnly, insertCountryOnly,
  getCountry, insertCountry,
  getDomain, insertDomain,
  getNetwork, insertNetwork,
  getTargetSite, insertTargetSite,
  getNativeAdTargetSite, insertNativeAdTargetSite, updateNativeAdTargetSiteCount,
  getNativeAdNetwork, insertNativeAdNetwork, updateNativeAdNetworkCount,
  getNativePlacementUrl, insertNativePlacementUrl, updateNativePlacementUrlCount,
  insertNativeAdVariant, updateNativeAdVariant,
  getNativeAdCountry, insertNativeAdCountry, updateNativeAdCountryCount,
  getNativeAdCountryOnly, insertNativeAdCountryOnly, updateNativeAdCountryOnlyCount,
  insertNativeAdMetaData,
  upsertNativeTranslation,
  getLanguageId,
  getNativeAdUser, insertNativeAdUser, updateNativeAdUserCount,
  insertNativeAccountActivity,
  getAdCountriesList, getTargetSitesList, getNetworksList, getPlacementUrlsList,
};
