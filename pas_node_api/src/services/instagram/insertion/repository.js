'use strict';

/**
 * Instagram insertion — data repository (raw parameterized SQL).
 * Mirrors the Facebook repository pattern with instagram_* table/column names.
 * Conventions: getX → {code,data}; insertX → id; updateX → affected. `exec` is db.sql or a tx.
 */

const { truncateChars } = require('../../../insertion/helpers/util');

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

// ── instagram_ad ────────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  return found(await exec.query('SELECT id FROM instagram_ad WHERE ad_id = ? LIMIT 1', [adId]));
}
async function insertInstagramAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO instagram_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateInstagramAd(exec, data, adInternalId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE instagram_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), adInternalId]
  ));
}

// Denormalized join for ES doc. Joined cols aliased to the leaf names esColumns expects.
async function getJoinedAd(exec, whereVal) {
  const sql = `
    SELECT instagram_ad.*,
           ANY_VALUE(instagram_ad_image_video.ad_image_video) AS ad_image_video,
           ANY_VALUE(instagram_ad_domain.domain) AS domain,
           ANY_VALUE(instagram_ad_domain.domain_registered_date) AS domain_registered_date,
           ANY_VALUE(instagram_call_to_action.call_to_action) AS call_to_action,
           ANY_VALUE(instagram_country.country) AS country_row,
           ANY_VALUE(instagram_user.gender) AS gender,
           ANY_VALUE(instagram_ad_meta_data.destination_url) AS destination_url,
           -- initial_url temporarily disabled: column not yet on prod DB (FULLTEXT-index
           -- table needs a blocking COPY to add it). Re-enable after the column exists.
           -- ANY_VALUE(instagram_ad_meta_data.initial_url) AS initial_url,
           ANY_VALUE(instagram_ad_meta_data.built_with) AS built_with,
           ANY_VALUE(instagram_ad_meta_data.built_with_analytics_tracking) AS built_with_analytics_tracking,
           ANY_VALUE(instagram_ad_meta_data.affiliate_data) AS affiliate_data,
           ANY_VALUE(instagram_ad_meta_data.firstSeenOnDesktop) AS firstSeenOnDesktop,
           ANY_VALUE(instagram_ad_meta_data.firstSeenOnAndroid) AS firstSeenOnAndroid,
           ANY_VALUE(instagram_ad_meta_data.firstSeenOnIos) AS firstSeenOnIos,
           ANY_VALUE(instagram_ad_meta_data.platform) AS platform,
           ANY_VALUE(instagram_ad_post_owners.post_owner_name) AS post_owner_name,
           ANY_VALUE(instagram_ad_post_owners.post_owner_lower) AS post_owner_lower,
           ANY_VALUE(instagram_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(instagram_ad_post_owners.verified) AS verified,
           ANY_VALUE(instagram_ad_post_owners.page_created_date) AS page_created_date,
           ANY_VALUE(instagram_ad_variants.title) AS title,
           ANY_VALUE(instagram_ad_variants.text) AS text,
           ANY_VALUE(instagram_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(instagram_ad_variants.image_object) AS image_object,
           ANY_VALUE(instagram_ad_variants.image_celebrity) AS image_celebrity,
           ANY_VALUE(instagram_ad_variants.image_brand_logo) AS image_brand_logo,
           ANY_VALUE(instagram_ad_variants.image_ocr) AS image_ocr,
           ANY_VALUE(instagram_ad_variants.image_url) AS image_url,
           ANY_VALUE(instagram_ad_variants.image_url_original) AS image_url_original,
           ANY_VALUE(instagram_category.category_name) AS category_name,
           ANY_VALUE(languages.iso) AS iso,
           ANY_VALUE(instagram_meta_ad_budget.lowerBudget) AS lowerBudget,
           ANY_VALUE(instagram_meta_ad_budget.upperBudget) AS upperBudget,
           ANY_VALUE(instagram_ad_cost_usage_benefit_analysis.est_audience_size_low) AS est_audience_size_low,
           ANY_VALUE(instagram_ad_cost_usage_benefit_analysis.est_audience_size_high) AS est_audience_size_high,
           ANY_VALUE(instagram_ad_cost_usage_benefit_analysis.EUT) AS EUT,
           ANY_VALUE(instagram_ad_cost_usage_benefit_analysis.meta_ad_url) AS meta_ad_url,
           ANY_VALUE(instagram_ad_cost_usage_benefit_analysis.ad_run_platforms) AS ad_run_platforms
    FROM instagram_ad
    LEFT JOIN instagram_ad_image_video ON instagram_ad.id = instagram_ad_image_video.instagram_ad_id
    LEFT JOIN instagram_ad_domain      ON instagram_ad.domain_id = instagram_ad_domain.id
    LEFT JOIN instagram_call_to_action ON instagram_ad.call_to_action_id = instagram_call_to_action.id
    LEFT JOIN instagram_country        ON instagram_country.id = instagram_ad.country_id
    LEFT JOIN instagram_user           ON instagram_ad.discoverer_user_id = instagram_user.id
    LEFT JOIN instagram_ad_meta_data   ON instagram_ad.id = instagram_ad_meta_data.instagram_ad_id
    LEFT JOIN instagram_ad_post_owners ON instagram_ad.post_owner_id = instagram_ad_post_owners.id
    LEFT JOIN instagram_ad_variants    ON instagram_ad.id = instagram_ad_variants.instagram_ad_id
    LEFT JOIN instagram_category       ON instagram_category.id = instagram_ad.category_id
    LEFT JOIN languages                ON instagram_ad.language_id = languages.id
    LEFT JOIN instagram_meta_ad_budget ON instagram_ad.id = instagram_meta_ad_budget.instagram_ad_id
    LEFT JOIN instagram_ad_cost_usage_benefit_analysis ON instagram_ad.id = instagram_ad_cost_usage_benefit_analysis.instagram_ad_id
    WHERE instagram_ad.id = ?
    GROUP BY instagram_ad.id`;
  return rows(await exec.query(sql, [whereVal]));
}

async function deleteAdCascade(exec, internalId) {
  // All children must be removed before instagram_ad (FK ON DELETE RESTRICT). The first
  // group are the FK-constrained tables (verified via information_schema); the rest are
  // additional child data. Missing tables are skipped.
  const childDeletes = [
    // FK → instagram_ad (RESTRICT) — mandatory before the main row
    ['instagram_ad_analytics', 'instagram_ad_id'],
    ['instagram_ad_categories', 'instagram_ad_id'],
    ['instagram_ad_image_video', 'instagram_ad_id'],
    ['instagram_ad_meta_data', 'instagram_ad_id'],
    ['instagram_ad_translation', 'instagram_ad_id'],
    ['instagram_ad_url', 'instagram_ad_id'],
    ['instagram_ad_variants', 'instagram_ad_id'],
    ['instagram_hidden_ads', 'ad_id'],
    ['instagram_user_affiliate_ads', 'instagram_ad_id'],
    // other child data (no FK / best-effort)
    ['instagram_ad_html_lander_content', 'instagram_ad_id'],
    ['instagram_ad_countries', 'instagram_ad_id'],
    ['instagram_ad_countries_only', 'instagram_ad_id'],
    ['instagram_ad_outgoing_links', 'instagram_ad_id'],
    ['instagram_ad_users', 'instagram_ad_id'],
    ['instagram_comments', 'instagram_ad_id'],
    ['instagram_ad_cost_usage_benefit_analysis', 'instagram_ad_id'],
    ['instagram_page_details', 'instagram_ad_id'],
    ['instagram_ad_bug_report', 'ad_id'],
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  return affected(await exec.query('DELETE FROM instagram_ad WHERE id = ?', [internalId]));
}
async function deleteIgnoringMissingTable(exec, sql, params) {
  try { await exec.query(sql, params); }
  catch (err) { if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return; throw err; }
}

// ── instagram_ad_post_owners (PHP dedups by post_owner_name) ────────────────────
async function getPostOwner(exec, postOwnerName) {
  return found(await exec.query(
    'SELECT id, ads_count, post_owner_image, original_post_owner_image, image_updated FROM instagram_ad_post_owners WHERE post_owner_name = ? LIMIT 1',
    [postOwnerName]
  ));
}
async function insertPostOwner(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO instagram_ad_post_owners (post_owner_name, post_owner_image, original_post_owner_image, ads_count, verified) VALUES (?,?,?,?,?)',
    [d.post_owner_name, d.post_owner_image, d.original_post_owner_image, d.ads_count ?? 1, d.verified ?? 0]
  ));
}
async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE instagram_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── instagram_call_to_action (dedup call_to_action) ─────────────────────────────
async function getCallToAction(exec, action) {
  return found(await exec.query('SELECT id, count FROM instagram_call_to_action WHERE call_to_action = ? LIMIT 1', [action]));
}
async function insertCallToAction(exec, action) {
  return firstId(await exec.query('INSERT INTO instagram_call_to_action (call_to_action, count) VALUES (?, 1)', [action]));
}
async function bumpCallToActionCount(exec, id) {
  return affected(await exec.query('UPDATE instagram_call_to_action SET count = count + 1 WHERE id = ?', [id]));
}

// ── instagram_category ──────────────────────────────────────────────────────────
async function getCategory(exec, name) {
  return found(await exec.query('SELECT id FROM instagram_category WHERE category_name = ? LIMIT 1', [name]));
}
async function insertCategory(exec, name) {
  return firstId(await exec.query('INSERT INTO instagram_category (category_name) VALUES (?)', [name]));
}

// ── instagram_country_only / instagram_country ──────────────────────────────────
async function upsertCountryOnly(exec, names) {
  const list = (Array.isArray(names) ? names : [names]).filter((n) => n !== undefined && n !== null && n !== '');
  if (!list.length) return [];
  for (const country of list) {
    const existing = rows(await exec.query('SELECT id FROM instagram_country_only WHERE country = ? LIMIT 1', [country]));
    if (!existing.length) await exec.query('INSERT INTO instagram_country_only (country) VALUES (?)', [country]);
  }
  const placeholders = list.map(() => '?').join(',');
  const f = rows(await exec.query(`SELECT id FROM instagram_country_only WHERE country IN (${placeholders})`, list));
  return f.map((row) => ({ country_only_id: row.id, count: 1 }));
}
async function getCountry(exec, where) {
  // coalesce to '' to match insertCountry's NOT NULL '' values, so the dedup lookup finds the
  // existing row (else a city-less ad re-inserts → UNIQUE instagram_country.triple).
  return found(await exec.query(
    'SELECT id FROM instagram_country WHERE city <=> ? AND state <=> ? AND country <=> ? LIMIT 1',
    [where.city ?? '', where.state ?? '', where.country ?? '']
  ));
}
async function insertCountry(exec, d) {
  const country = Array.isArray(d.country) ? d.country.join(',') : d.country;
  // instagram_country.city/state/country are NOT NULL with no default — coalesce to '' so a
  // city/state-less ad can't throw "Column 'city' cannot be null".
  return firstId(await exec.query(
    'INSERT INTO instagram_country (city, state, country, country_only_id) VALUES (?,?,?,?)',
    [d.city ?? '', d.state ?? '', country ?? '', d.country_only_id ?? null]
  ));
}

// ── instagram_ad_domain (singular) ──────────────────────────────────────────────
async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id FROM instagram_ad_domain WHERE domain = ? LIMIT 1', [domain]));
}
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO instagram_ad_domain (domain) VALUES (?)', [domain]));
}

// ── instagram_ad_variants (FK instagram_ad_id) ──────────────────────────────────
async function insertVariant(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO instagram_ad_variants (instagram_ad_id, title, text, newsfeed_description, image_url_original) VALUES (?,?,?,?,?)',
    [d.instagram_ad_id, d.title ?? '', d.text ?? '', d.newsfeed_description ?? '', d.image_url_original ?? null]
  ));
}
async function updateVariantByAdId(exec, data, adId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE instagram_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE instagram_ad_id = ?`,
    [...Object.values(data), adId]
  ));
}

// ── instagram_ad_analytics ──────────────────────────────────────────────────────
async function insertAnalytics(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO instagram_ad_analytics (instagram_ad_id, likes, comments, shares, popularity, impression, engagement_rate, date, hits) VALUES (?,?,?,?,?,?,?,?,?)',
    [d.instagram_ad_id, d.likes ?? 0, d.comments ?? 0, d.shares ?? 0, d.popularity ?? 0, d.impression ?? 0, d.engagement_rate ?? 0, d.date, d.hits ?? 1]
  ));
}
async function updateAnalytics(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE instagram_ad_analytics SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}
async function getLastAnalytics(exec, adId) {
  return found(await exec.query(
    'SELECT id, likes, comments, shares, hits, date FROM instagram_ad_analytics WHERE instagram_ad_id = ? ORDER BY id DESC LIMIT 1',
    [adId]
  ));
}
async function getTodayAnalytics(exec, adId, date) {
  return found(await exec.query(
    'SELECT id, likes, comments, shares, hits FROM instagram_ad_analytics WHERE instagram_ad_id = ? AND date = ? LIMIT 1',
    [adId, date]
  ));
}
async function sumHits(exec, adId) {
  const r = rows(await exec.query('SELECT SUM(hits) AS total FROM instagram_ad_analytics WHERE instagram_ad_id = ?', [adId]));
  return r.length ? Number(r[0].total) || 0 : 0;
}

// ── instagram_comments / image_video ────────────────────────────────────────────
async function insertComment(exec, adId, commentData) {
  return firstId(await exec.query(
    'INSERT INTO instagram_comments (instagram_ad_id, comment_data) VALUES (?, ?)',
    [adId, typeof commentData === 'string' ? commentData : JSON.stringify(commentData)]
  ));
}
async function upsertAdImageVideo(exec, d) {
  // shared mediaUpload.uploadMultimedia returns the id under `facebook_ad_id` — accept either.
  const adId = (d && (d.instagram_ad_id ?? d.facebook_ad_id)) || null;
  if (!adId) return 0;
  const existing = rows(await exec.query('SELECT instagram_ad_id FROM instagram_ad_image_video WHERE instagram_ad_id = ? LIMIT 1', [adId]));
  if (existing.length) {
    return affected(await exec.query('UPDATE instagram_ad_image_video SET ad_type = ?, ad_image_video = ? WHERE instagram_ad_id = ?', [d.ad_type ?? null, d.ad_image_video ?? null, adId]));
  }
  return affected(await exec.query('INSERT INTO instagram_ad_image_video (instagram_ad_id, ad_type, ad_image_video) VALUES (?,?,?)', [adId, d.ad_type ?? null, d.ad_image_video ?? null]));
}

// ── instagram_ad_countries / _countries_only ────────────────────────────────────
async function insertAdCountries(exec, list) {
  if (!list.length) return 0;
  const values = list.map((c) => [c.instagram_ad_id, c.country_id ?? null, c.country_only_id ?? null, c.count ?? 1]);
  return affected(await exec.query(
    `INSERT INTO instagram_ad_countries (instagram_ad_id, country_id, country_only_id, count) VALUES ${values.map(() => '(?,?,?,?)').join(', ')}`,
    values.flat()
  ));
}
async function insertAdCountriesOnly(exec, list) {
  if (!list.length) return 0;
  const values = list.map((c) => [c.instagram_ad_id, c.country_only_id ?? null, c.count ?? 1]);
  return affected(await exec.query(
    `INSERT INTO instagram_ad_countries_only (instagram_ad_id, country_only_id, count) VALUES ${values.map(() => '(?,?,?)').join(', ')}`,
    values.flat()
  ));
}
async function upsertAdCountriesOnly(exec, list) {
  for (const c of list) {
    const existing = rows(await exec.query(
      'SELECT id FROM instagram_ad_countries_only WHERE country_only_id = ? AND instagram_ad_id = ? LIMIT 1',
      [c.country_only_id, c.instagram_ad_id]
    ));
    if (!existing.length) {
      await exec.query('INSERT INTO instagram_ad_countries_only (instagram_ad_id, country_only_id, count) VALUES (?,?,?)', [c.instagram_ad_id, c.country_only_id ?? null, c.count ?? 1]);
    }
  }
}

// ── instagram_ad_users (FK instagram_ad_id, + userid_status) ────────────────────
async function getAdUser(exec, adId, userId) {
  return found(await exec.query('SELECT id, count FROM instagram_ad_users WHERE instagram_ad_id = ? AND user_id = ? LIMIT 1', [adId, userId]));
}
async function insertAdUser(exec, d) {
  return firstId(await exec.query('INSERT INTO instagram_ad_users (instagram_ad_id, user_id, count) VALUES (?,?,?)', [d.instagram_ad_id, d.user_id, d.count ?? 1]));
}
async function bumpAdUserCount(exec, id) {
  return affected(await exec.query('UPDATE instagram_ad_users SET count = count + 1 WHERE id = ?', [id]));
}
async function setAdUserIdStatus(exec, id, status) {
  return affected(await exec.query('UPDATE instagram_ad_users SET userid_status = ? WHERE id = ?', [status, id]));
}

// ── instagram_ad_meta_data (own id PK + FK instagram_ad_id) ─────────────────────
async function getMetaData(exec, adId) {
  return found(await exec.query('SELECT id FROM instagram_ad_meta_data WHERE instagram_ad_id = ? LIMIT 1', [adId]));
}
async function insertMetaData(exec, data) {
  const clean = stripNulls(data);
  // initial_url column not yet present on prod DB → drop it so the INSERT never
  // references a missing column. (Remove this once the column is added.)
  delete clean.initial_url;
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO instagram_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateMetaBuiltWith(exec, adId, builtWithStatus) {
  return affected(await exec.query('UPDATE instagram_ad_meta_data SET built_with_status = ? WHERE instagram_ad_id = ?', [builtWithStatus, adId]));
}
async function updateMetaInitialUrl(exec, adId, initialUrl) {
  // No-op until the initial_url column exists on prod DB (FULLTEXT-index table
  // needs a blocking COPY to add it). Restore the UPDATE once the column is added.
  return 0;
}

// ── instagram_meta_ad_budget (dedup meta_ad_id) ─────────────────────────────────
async function budgetExists(exec, metaAdId) {
  return rows(await exec.query('SELECT instagram_ad_id FROM instagram_meta_ad_budget WHERE meta_ad_id = ? LIMIT 1', [metaAdId])).length > 0;
}
async function insertBudget(exec, d) {
  return affected(await exec.query(
    'INSERT INTO instagram_meta_ad_budget (instagram_ad_id, meta_ad_id, lowerBudget, upperBudget) VALUES (?,?,?,?)',
    [d.instagram_ad_id, d.meta_ad_id, d.lowerBudget ?? 0, d.upperBudget ?? 0]
  ));
}

// ── instagram_ad_translation (upsert by instagram_ad_id) ────────────────────────
async function upsertTranslation(exec, d) {
  // ad_title is varchar(255) NOT NULL — cap to 255 chars (multibyte-safe), and coalesce the three
  // NOT NULL text columns to '' (never null) so an over-length OR missing translation can't throw
  // ER_DATA_TOO_LONG (1406) or "Column 'ad_title'/'ad_text' cannot be null".
  const adTitle = truncateChars(d.ad_title, 255) ?? '';
  const existing = rows(await exec.query('SELECT instagram_ad_id FROM instagram_ad_translation WHERE instagram_ad_id = ? LIMIT 1', [d.instagram_ad_id]));
  if (existing.length) {
    await exec.query('UPDATE instagram_ad_translation SET news_feed_description = ?, ad_title = ?, ad_text = ? WHERE instagram_ad_id = ?',
      [d.news_feed_description ?? '', adTitle, d.ad_text ?? '', d.instagram_ad_id]);
  } else {
    await exec.query('INSERT INTO instagram_ad_translation (instagram_ad_id, news_feed_description, ad_title, ad_text) VALUES (?,?,?,?)',
      [d.instagram_ad_id, d.news_feed_description ?? '', adTitle, d.ad_text ?? '']);
  }
  return true;
}

// ── instagram_user (discoverer, lookup by instagram_id) ─────────────────────────
async function getUserByInstagramId(exec, instagramId) {
  return found(await exec.query('SELECT id FROM instagram_user WHERE instagram_id = ? LIMIT 1', [instagramId]));
}
async function getUserInstagramIdByCountry(exec, country) {
  const r = rows(await exec.query('SELECT instagram_id FROM instagram_user WHERE current_country = ? LIMIT 1', [country]));
  return r.length ? r[0].instagram_id : null;
}
async function updateUser(exec, data, instagramId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE instagram_user SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE instagram_id = ?`,
    [...Object.values(data), instagramId]
  ));
}

// ── languages (shared) ──────────────────────────────────────────────────────────
async function getLanguageId(exec, iso) {
  const r = rows(await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [String(iso).toUpperCase()]));
  return r.length ? r[0].id : null;
}
async function insertLanguage(exec, iso, name) {
  return firstId(await exec.query('INSERT INTO languages (iso, name) VALUES (?, ?)', [iso, name ?? iso]));
}

// ── instagram_page_details (lib; dedup ad_id) ───────────────────────────────────
async function libPageExists(exec, adId) {
  return rows(await exec.query('SELECT id FROM instagram_page_details WHERE ad_id = ? LIMIT 1', [adId])).length > 0;
}
async function insertLibPage(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO instagram_page_details (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function setLibPageAdId(exec, adId, instagramAdId) {
  return affected(await exec.query('UPDATE instagram_page_details SET instagram_ad_id = ? WHERE ad_id = ?', [instagramAdId, adId]));
}

// ── instagram_ad_cost_usage_benefit_analysis (lib) ──────────────────────────────
async function insertCostUsage(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO instagram_ad_cost_usage_benefit_analysis (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}

// ── country_data (shared) — ISO lookups ─────────────────────────────────────────
async function getIsoByNames(exec, names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (!list.length) return [];
  const upper = list.map((n) => String(n).toUpperCase());
  const placeholders = upper.map(() => '?').join(',');
  const r = rows(await exec.query(`SELECT iso FROM country_data WHERE UPPER(name) IN (${placeholders})`, upper));
  return r.map((row) => row.iso).filter(Boolean);
}
async function getNamesByIso(exec, isoCodes) {
  const list = (Array.isArray(isoCodes) ? isoCodes : [isoCodes]).filter(Boolean);
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  const r = rows(await exec.query(`SELECT name FROM country_data WHERE iso IN (${placeholders})`, list));
  return r.map((row) => row.name).filter(Boolean);
}

// ── instagram_accounts_activities (platform 10) ─────────────────────────────────
async function insertAccountActivity(exec, d) {
  return affected(await exec.query(
    'INSERT INTO instagram_accounts_activities (account_id, system_id, instagram_ad_id, platform, is_unique) VALUES (?,?,?,?,?)',
    [d.account_id ?? null, d.system_id ?? null, d.instagram_ad_id, d.platform ?? null, d.is_unique ?? 0]
  ));
}

// ── ES synthetic-field SQL ──────────────────────────────────────────────────────
async function getUserCountries(exec, adId) {
  const r = rows(await exec.query(
    `SELECT GROUP_CONCAT(instagram_country_only.country) AS country
       FROM instagram_ad_countries_only
       LEFT JOIN instagram_country_only ON instagram_country_only.id = instagram_ad_countries_only.country_only_id
      WHERE instagram_ad_countries_only.instagram_ad_id = ?`,
    [adId]
  ));
  const csv = r.length ? r[0].country : null;
  return csv ? String(csv).split(',') : [];
}
async function getAdCountries(exec, adId) {
  const r = rows(await exec.query(
    `SELECT instagram_country_only.country AS country
       FROM instagram_ad_countries
       LEFT JOIN instagram_country_only ON instagram_ad_countries.country_only_id = instagram_country_only.id
      WHERE instagram_ad_countries.instagram_ad_id = ?`,
    [adId]
  ));
  return r.map((row) => row.country).filter(Boolean);
}

module.exports = {
  withTransaction,
  getAdByAdId, insertInstagramAd, updateInstagramAd, getJoinedAd, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getCallToAction, insertCallToAction, bumpCallToActionCount,
  getCategory, insertCategory,
  upsertCountryOnly, getCountry, insertCountry,
  getDomain, insertDomain,
  insertVariant, updateVariantByAdId,
  insertAnalytics, updateAnalytics, getLastAnalytics, getTodayAnalytics, sumHits,
  insertComment, upsertAdImageVideo,
  insertAdCountries, insertAdCountriesOnly, upsertAdCountriesOnly,
  getAdUser, insertAdUser, bumpAdUserCount, setAdUserIdStatus,
  getMetaData, insertMetaData, updateMetaBuiltWith, updateMetaInitialUrl,
  budgetExists, insertBudget,
  upsertTranslation,
  getUserByInstagramId, getUserInstagramIdByCountry, updateUser,
  getLanguageId, insertLanguage,
  libPageExists, insertLibPage, setLibPageAdId, insertCostUsage,
  getIsoByNames, getNamesByIso,
  insertAccountActivity,
  getUserCountries, getAdCountries,
};
