'use strict';

/**
 * Facebook insertion — data repository (raw parameterized SQL).
 *
 * Faithful port of the Laravel model methods used by adsdata() / adsLibraryInsert()
 * (see docs/insertion/PHP-SPEC-internals.md §A–C). One function per DB operation,
 * grouped by table. No business logic here — the pipelines orchestrate.
 *
 * Every function takes `exec` as its first arg: an object with
 * `query(sql, params) -> rows | ResultSetHeader`. Pass `db.sql` for autocommit,
 * or a transaction wrapper (see makeTx) inside the INSERT path. This is what lets
 * the same writers run both standalone and inside a transaction.
 *
 * Return conventions mirror PHP where the pipeline branches on it:
 *   - getX  → { code: 200, data: rows } | { code: 400, data: null }
 *   - insertX → inserted id (number)
 *   - updateX → affected row count (number)
 */

// ── Transaction helper ────────────────────────────────────────────────────────
/**
 * Run `fn(tx)` inside a SQL transaction. `tx` exposes the same {query} interface
 * as db.sql, so repository functions work unchanged. Commits on success, rolls
 * back on throw, always releases the connection.
 */
async function withTransaction(sql, fn) {
  const conn = await sql.getConnection();
  const tx = { query: async (q, p) => { const [r] = await conn.execute(q, p); return r; } };
  try {
    // Match the legacy PHP server's relaxed sql_mode for this connection: drop the
    // strict flags so loose data (e.g. epoch-in-datetime, group-by) behaves as it did
    // in production. Localized to the insertion transaction — does not affect other code.
    await conn.query("SET SESSION sql_mode=(SELECT REPLACE(REPLACE(REPLACE(@@SESSION.sql_mode,'ONLY_FULL_GROUP_BY',''),'STRICT_TRANS_TABLES',''),'STRICT_ALL_TABLES',''))").catch(() => {});
    await conn.beginTransaction();
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    throw err;
  } finally {
    // Restore default sql_mode before returning the connection to the pool, so the
    // relaxed mode never leaks into other (existing) code sharing the pool.
    await conn.query('SET SESSION sql_mode=DEFAULT').catch(() => {});
    conn.release();
  }
}

const { truncateChars } = require('../../../insertion/helpers/util');

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);

/**
 * Drop null/undefined keys so the DB applies the column's own default instead of
 * receiving an explicit NULL (which a NOT NULL column rejects). Mirrors how the
 * legacy PHP let unset fields fall back to defaults.
 */
const stripNulls = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const found = (r) => (rows(r).length ? { code: 200, data: rows(r) } : { code: 400, data: null });

// ── facebook_ad ────────────────────────────────────────────────────────────────
async function getAdByAdId(exec, adId) {
  const r = await exec.query('SELECT id FROM facebook_ad WHERE ad_id = ? LIMIT 1', [adId]);
  return found(r);
}

async function insertFacebookAd(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO facebook_ad (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}

async function updateFacebookAd(exec, data, adInternalId) {
  const cols = Object.keys(data);
  const sql = `UPDATE facebook_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adInternalId]));
}

/**
 * Cascade-delete an ad and all its child rows by internal facebook_ad.id.
 * Faithful port of PHP deleteads() table list. Run inside withTransaction for atomicity.
 */
async function deleteAdCascade(exec, internalId) {
  // Child tables keyed by facebook_ad_id. Some may not exist in every environment
  // (e.g. facebook_html_content), so a missing-table error is skipped — only the
  // main facebook_ad delete is mandatory.
  const childDeletes = [
    ['facebook_html_content', 'facebook_ad_id'],
    ['facebook_translation', 'facebook_ad_id'],
    ['facebook_ad_analytics', 'facebook_ad_id'],
    ['facebook_ad_countries', 'facebook_ad_id'],
    ['facebook_ad_countries_only', 'facebook_ad_id'],
    ['facebook_ad_image_video', 'facebook_ad_id'],
    ['facebook_ad_meta_data', 'facebook_ad_id'],
    ['facebook_ad_outgoing', 'facebook_ad_id'],
    ['facebook_ad_users', 'facebook_ad_id'],
    ['facebook_ad_variants', 'facebook_ad_id'],
    ['facebook_comments', 'facebook_ad_id'],
    ['facebook_ad_bug_report', 'ad_id'], // bug report keyed by ad_id (PHP passes the internal id)
  ];
  for (const [table, col] of childDeletes) {
    await deleteIgnoringMissingTable(exec, `DELETE FROM ${table} WHERE ${col} = ?`, [internalId]);
  }
  // Main row — must exist/succeed.
  return affected(await exec.query('DELETE FROM facebook_ad WHERE id = ?', [internalId]));
}

// Run a delete, swallowing only the "table doesn't exist" error (errno 1146) so a
// child table that isn't present in this environment doesn't abort the whole delete.
async function deleteIgnoringMissingTable(exec, sql, params) {
  try {
    await exec.query(sql, params);
  } catch (err) {
    if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) return;
    throw err;
  }
}

// Big denormalized join for ES doc (PHP getJoindAds). `whereCol`/`whereVal` e.g. 'facebook_ad.id'.
async function getJoinedAd(exec, whereCol, whereVal) {
  // NOTE: joined columns are wrapped in ANY_VALUE() so the query is compatible with
  // MySQL's only_full_group_by mode (some servers enable it, others don't). facebook_ad.*
  // is safe because it is functionally dependent on the GROUP BY key (the PK id).
  const sql = `
    SELECT facebook_ad.*,
           ANY_VALUE(facebook_ad_image_video.ad_image_video) AS ad_image_video,
           ANY_VALUE(facebook_ad_domains.domain) AS domain,
           ANY_VALUE(facebook_ad_domains.domain_registered_date) AS domain_registered_date,
           ANY_VALUE(facebook_call_to_actions.action) AS action,
           ANY_VALUE(country.country) AS country_row,
           ANY_VALUE(facebook_users.Gender) AS Gender,
           ANY_VALUE(facebook_ad_meta_data.destination_url) AS destination_url,
           ANY_VALUE(facebook_ad_meta_data.initial_url) AS initial_url,
           ANY_VALUE(facebook_ad_meta_data.built_with) AS built_with,
           ANY_VALUE(facebook_ad_meta_data.built_with_analytics_tracking) AS built_with_analytics_tracking,
           ANY_VALUE(facebook_ad_meta_data.affiliate_data) AS affiliate_data,
           ANY_VALUE(facebook_ad_meta_data.firstSeenOnDesktop) AS firstSeenOnDesktop,
           ANY_VALUE(facebook_ad_meta_data.firstSeenOnAndroid) AS firstSeenOnAndroid,
           ANY_VALUE(facebook_ad_meta_data.firstSeenOnIos) AS firstSeenOnIos,
           ANY_VALUE(facebook_ad_meta_data.est_audience_size_low) AS est_audience_size_low,
           ANY_VALUE(facebook_ad_meta_data.est_audience_size_high) AS est_audience_size_high,
           ANY_VALUE(facebook_ad_meta_data.EUT) AS EUT,
           ANY_VALUE(facebook_ad_meta_data.meta_ad_url) AS meta_ad_url,
           ANY_VALUE(facebook_ad_meta_data.ad_run_platforms) AS ad_run_platforms,
           ANY_VALUE(facebook_ad_post_owners.post_owner_name) AS post_owner_name,
           ANY_VALUE(facebook_ad_post_owners.post_owner_lower) AS post_owner_lower,
           ANY_VALUE(facebook_ad_post_owners.post_owner_image) AS post_owner_image,
           ANY_VALUE(facebook_ad_post_owners.verified) AS verified,
           ANY_VALUE(facebook_ad_post_owners.page_created_date) AS page_created_date,
           ANY_VALUE(facebook_ad_variants.title) AS title,
           ANY_VALUE(facebook_ad_variants.text) AS text,
           ANY_VALUE(facebook_ad_variants.newsfeed_description) AS newsfeed_description,
           ANY_VALUE(facebook_ad_variants.image_object) AS image_object,
           ANY_VALUE(facebook_ad_variants.image_celebrity) AS image_celebrity,
           ANY_VALUE(facebook_ad_variants.image_brand_logo) AS image_brand_logo,
           ANY_VALUE(facebook_ad_variants.image_ocr) AS image_ocr,
           ANY_VALUE(facebook_ad_variants.image_url) AS image_url,
           ANY_VALUE(facebook_ad_variants.image_url_original) AS image_url_original,
           ANY_VALUE(facebook_category.category_name) AS category_name,
           ANY_VALUE(languages.iso) AS iso,
           ANY_VALUE(facebook_meta_ad_budget.lowerBudget) AS lowerBudget,
           ANY_VALUE(facebook_meta_ad_budget.upperBudget) AS upperBudget,
           ANY_VALUE(facebook_lib_page_details.gender_details) AS gender_details,
           ANY_VALUE(facebook_lib_page_details.age_details) AS age_details,
           ANY_VALUE(facebook_lib_page_details.page_category) AS page_category
    FROM facebook_ad
    LEFT JOIN facebook_ad_image_video  ON facebook_ad.id = facebook_ad_image_video.facebook_ad_id
    LEFT JOIN facebook_ad_domains      ON facebook_ad.domain_id = facebook_ad_domains.id
    LEFT JOIN facebook_call_to_actions ON facebook_ad.call_to_action_id = facebook_call_to_actions.id
    LEFT JOIN country                  ON country.id = facebook_ad.country_id
    LEFT JOIN facebook_users           ON facebook_ad.discoverer_user_id = facebook_users.id
    LEFT JOIN facebook_ad_meta_data    ON facebook_ad.id = facebook_ad_meta_data.facebook_ad_id
    LEFT JOIN facebook_ad_post_owners  ON facebook_ad.post_owner_id = facebook_ad_post_owners.id
    LEFT JOIN facebook_ad_variants     ON facebook_ad.id = facebook_ad_variants.facebook_ad_id
    LEFT JOIN facebook_category        ON facebook_category.id = facebook_ad.category_id
    LEFT JOIN languages                ON facebook_ad.language_id = languages.id
    LEFT JOIN facebook_meta_ad_budget  ON facebook_ad.id = facebook_meta_ad_budget.facebook_ad_id
    LEFT JOIN facebook_lib_page_details ON facebook_ad.id = facebook_lib_page_details.facebook_ad_id
    WHERE ${whereCol} = ?
    GROUP BY facebook_ad.id`;
  return rows(await exec.query(sql, [whereVal]));
}

// ── facebook_ad_post_owners (dedup post_owner_lower) ────────────────────────────
async function getPostOwner(exec, postOwnerLower) {
  const r = await exec.query(
    'SELECT id, ads_count, post_owner_image, original_post_owner_image, image_updated FROM facebook_ad_post_owners WHERE post_owner_lower = ? LIMIT 1',
    [postOwnerLower]
  );
  return found(r);
}
async function insertPostOwner(exec, d) {
  // post_owner_lower is a GENERATED column (DB derives it from post_owner_name) — never insert it.
  return firstId(await exec.query(
    'INSERT INTO facebook_ad_post_owners (post_owner_name, post_owner_image, original_post_owner_image, ads_count, verified) VALUES (?,?,?,?,?)',
    [d.post_owner_name, d.post_owner_image, d.original_post_owner_image, d.ads_count ?? 1, d.verified ?? 0]
  ));
}
async function updatePostOwner(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE facebook_ad_post_owners SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}

// ── facebook_call_to_actions (dedup action) ─────────────────────────────────────
async function getCallToAction(exec, action) {
  return found(await exec.query('SELECT id, count FROM facebook_call_to_actions WHERE action = ? LIMIT 1', [action]));
}
async function insertCallToAction(exec, action) {
  return firstId(await exec.query('INSERT INTO facebook_call_to_actions (action, count) VALUES (?, 1)', [action]));
}
async function bumpCallToActionCount(exec, id) {
  return affected(await exec.query('UPDATE facebook_call_to_actions SET count = count + 1 WHERE id = ?', [id]));
}

// ── facebook_category (dedup category_name) ─────────────────────────────────────
async function getCategory(exec, name) {
  return found(await exec.query('SELECT id FROM facebook_category WHERE category_name = ? LIMIT 1', [name]));
}
async function insertCategory(exec, name) {
  return firstId(await exec.query('INSERT INTO facebook_category (category_name) VALUES (?)', [name]));
}

// ── country_only (dedup country) — PHP upsertData(names[]) → [{country_only_id}] ─
async function upsertCountryOnly(exec, names) {
  const list = (Array.isArray(names) ? names : [names]).filter((n) => n !== undefined && n !== null && n !== '');
  if (!list.length) return [];
  for (const country of list) {
    const existing = rows(await exec.query('SELECT id FROM country_only WHERE country = ? LIMIT 1', [country]));
    if (!existing.length) {
      await exec.query('INSERT INTO country_only (country) VALUES (?)', [country]);
    }
  }
  const placeholders = list.map(() => '?').join(',');
  const found2 = rows(await exec.query(`SELECT id FROM country_only WHERE country IN (${placeholders})`, list));
  return found2.map((row) => ({ country_only_id: row.id, count: 1 }));
}

// ── country (city/state/country) ────────────────────────────────────────────────
async function getCountry(exec, where) {
  // where: { city, state, country }
  return found(await exec.query(
    'SELECT id FROM country WHERE city <=> ? AND state <=> ? AND country <=> ? LIMIT 1',
    [where.city ?? null, where.state ?? null, where.country ?? null]
  ));
}
async function insertCountry(exec, d) {
  const country = Array.isArray(d.country) ? d.country.join(',') : d.country;
  return firstId(await exec.query(
    'INSERT INTO country (city, state, country, country_only_id) VALUES (?,?,?,?)',
    [d.city ?? null, d.state ?? null, country ?? null, d.country_only_id ?? null]
  ));
}

// ── facebook_ad_domains (dedup domain) ──────────────────────────────────────────
async function getDomain(exec, domain) {
  return found(await exec.query('SELECT id FROM facebook_ad_domains WHERE domain = ? LIMIT 1', [domain]));
}
async function insertDomain(exec, domain) {
  return firstId(await exec.query('INSERT INTO facebook_ad_domains (domain) VALUES (?)', [domain]));
}

// ── facebook_ad_variants ────────────────────────────────────────────────────────
async function insertVariant(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO facebook_ad_variants (facebook_ad_id, title, text, newsfeed_description, image_url_original) VALUES (?,?,?,?,?)',
    [d.facebook_ad_id, d.title ?? '', d.text ?? '', d.newsfeed_description ?? '', d.image_url_original ?? null]
  ));
}
async function updateVariant(exec, data, variantId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE facebook_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), variantId]
  ));
}
// PHP updates the variant by facebook_ad_id on the UPDATE path.
async function updateVariantByAdId(exec, data, facebookAdId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE facebook_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE facebook_ad_id = ?`,
    [...Object.values(data), facebookAdId]
  ));
}

// ── facebook_ad_analytics ───────────────────────────────────────────────────────
async function insertAnalytics(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO facebook_ad_analytics (facebook_ad_id, likes, comments, shares, popularity, impression, engagement_rate, date, hits) VALUES (?,?,?,?,?,?,?,?,?)',
    [d.facebook_ad_id, d.likes ?? 0, d.comments ?? 0, d.shares ?? 0, d.popularity ?? 0, d.impression ?? 0, d.engagement_rate ?? 0, d.date, d.hits ?? 1]
  ));
}
async function updateAnalytics(exec, data, id) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE facebook_ad_analytics SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    [...Object.values(data), id]
  ));
}
// Latest analytics row for an ad (PHP: order by id desc limit 1).
async function getLastAnalytics(exec, facebookAdId) {
  return found(await exec.query(
    'SELECT id, likes, comments, shares, hits, date FROM facebook_ad_analytics WHERE facebook_ad_id = ? ORDER BY id DESC LIMIT 1',
    [facebookAdId]
  ));
}
async function getTodayAnalytics(exec, facebookAdId, date) {
  return found(await exec.query(
    'SELECT id, likes, comments, shares, hits FROM facebook_ad_analytics WHERE facebook_ad_id = ? AND date = ? LIMIT 1',
    [facebookAdId, date]
  ));
}
async function sumHits(exec, facebookAdId) {
  const r = rows(await exec.query('SELECT SUM(hits) AS total FROM facebook_ad_analytics WHERE facebook_ad_id = ?', [facebookAdId]));
  return r.length ? Number(r[0].total) || 0 : 0;
}

// ── facebook_comments ───────────────────────────────────────────────────────────
// facebook_ad_image_video — stores the carousel / other-multimedia paths (PHP insertFacebook_ad_image_video).
// Upsert on facebook_ad_id so re-inserts refresh rather than duplicate.
async function upsertAdImageVideo(exec, d) {
  if (!d || !d.facebook_ad_id) return 0;
  const existing = rows(await exec.query('SELECT facebook_ad_id FROM facebook_ad_image_video WHERE facebook_ad_id = ? LIMIT 1', [d.facebook_ad_id]));
  if (existing.length) {
    return affected(await exec.query(
      'UPDATE facebook_ad_image_video SET ad_type = ?, ad_image_video = ? WHERE facebook_ad_id = ?',
      [d.ad_type ?? null, d.ad_image_video ?? null, d.facebook_ad_id]
    ));
  }
  return affected(await exec.query(
    'INSERT INTO facebook_ad_image_video (facebook_ad_id, ad_type, ad_image_video) VALUES (?,?,?)',
    [d.facebook_ad_id, d.ad_type ?? null, d.ad_image_video ?? null]
  ));
}

async function insertComment(exec, facebookAdId, commentData) {
  return firstId(await exec.query(
    'INSERT INTO facebook_comments (facebook_ad_id, comment_data) VALUES (?, ?)',
    [facebookAdId, typeof commentData === 'string' ? commentData : JSON.stringify(commentData)]
  ));
}

// ── facebook_ad_countries / _countries_only (bulk) ──────────────────────────────
async function insertAdCountries(exec, list) {
  if (!list.length) return 0;
  const values = list.map((c) => [c.facebook_ad_id, c.country_id ?? null, c.country_only_id ?? null, c.count ?? 1]);
  const sql = `INSERT INTO facebook_ad_countries (facebook_ad_id, country_id, country_only_id, count) VALUES ${values.map(() => '(?,?,?,?)').join(', ')}`;
  return affected(await exec.query(sql, values.flat()));
}
async function insertAdCountriesOnly(exec, list) {
  if (!list.length) return 0;
  const values = list.map((c) => [c.facebook_ad_id, c.country_only_id ?? null, c.count ?? 1]);
  const sql = `INSERT INTO facebook_ad_countries_only (facebook_ad_id, country_only_id, count) VALUES ${values.map(() => '(?,?,?)').join(', ')}`;
  return affected(await exec.query(sql, values.flat()));
}
async function upsertAdCountriesOnly(exec, list) {
  for (const c of list) {
    const existing = rows(await exec.query(
      'SELECT id FROM facebook_ad_countries_only WHERE country_only_id = ? AND facebook_ad_id = ? LIMIT 1',
      [c.country_only_id, c.facebook_ad_id]
    ));
    if (!existing.length) {
      await exec.query(
        'INSERT INTO facebook_ad_countries_only (facebook_ad_id, country_only_id, count) VALUES (?,?,?)',
        [c.facebook_ad_id, c.country_only_id ?? null, c.count ?? 1]
      );
    }
  }
}

// ── facebook_ad_users ───────────────────────────────────────────────────────────
async function getAdUser(exec, facebookAdId, userId) {
  return found(await exec.query(
    'SELECT id, count FROM facebook_ad_users WHERE facebook_ad_id = ? AND user_id = ? LIMIT 1',
    [facebookAdId, userId]
  ));
}
async function insertAdUser(exec, d) {
  return firstId(await exec.query(
    'INSERT INTO facebook_ad_users (facebook_ad_id, user_id, count, platform) VALUES (?,?,?,?)',
    [d.facebook_ad_id, d.user_id, d.count ?? 1, d.platform ?? 0]
  ));
}
async function bumpAdUserCount(exec, id) {
  return affected(await exec.query('UPDATE facebook_ad_users SET count = count + 1 WHERE id = ?', [id]));
}
async function setAdUserIdStatus(exec, id, status) {
  return affected(await exec.query('UPDATE facebook_ad_users SET userid_status = ? WHERE id = ?', [status, id]));
}

// ── facebook_ad_meta_data (PK facebook_ad_id) ───────────────────────────────────
async function getMetaData(exec, facebookAdId) {
  return found(await exec.query('SELECT facebook_ad_id FROM facebook_ad_meta_data WHERE facebook_ad_id = ? LIMIT 1', [facebookAdId]));
}
async function insertMetaData(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return affected(await exec.query(
    `INSERT INTO facebook_ad_meta_data (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function updateMetaBuiltWith(exec, facebookAdId, builtWithStatus) {
  return affected(await exec.query(
    'UPDATE facebook_ad_meta_data SET built_with_status = ? WHERE facebook_ad_id = ?',
    [builtWithStatus, facebookAdId]
  ));
}
async function updateMetaInitialUrl(exec, facebookAdId, initialUrl) {
  return affected(await exec.query(
    'UPDATE facebook_ad_meta_data SET initial_url = ? WHERE facebook_ad_id = ?',
    [initialUrl, facebookAdId]
  ));
}

// ── facebook_meta_ad_budget (dedup meta_ad_id) ──────────────────────────────────
async function budgetExists(exec, metaAdId) {
  return rows(await exec.query('SELECT facebook_ad_id FROM facebook_meta_ad_budget WHERE meta_ad_id = ? LIMIT 1', [metaAdId])).length > 0;
}
async function insertBudget(exec, d) {
  return affected(await exec.query(
    'INSERT INTO facebook_meta_ad_budget (facebook_ad_id, meta_ad_id, lowerBudget, upperBudget) VALUES (?,?,?,?)',
    [d.facebook_ad_id, d.meta_ad_id, d.lowerBudget ?? 0, d.upperBudget ?? 0]
  ));
}

// ── facebook_translation (upsert on facebook_ad_id) ─────────────────────────────
async function upsertTranslation(exec, d) {
  // facebook_translation.ad_title is varchar(255) — cap to 255 chars (multibyte-safe)
  // so an over-length (machine-translated) title can't throw ER_DATA_TOO_LONG (errno 1406).
  const adTitle = truncateChars(d.ad_title, 255) ?? null;
  const existing = rows(await exec.query('SELECT facebook_ad_id FROM facebook_translation WHERE facebook_ad_id = ? LIMIT 1', [d.facebook_ad_id]));
  if (existing.length) {
    await exec.query(
      'UPDATE facebook_translation SET news_feed_description = ?, ad_title = ?, ad_text = ? WHERE facebook_ad_id = ?',
      [d.news_feed_description ?? null, adTitle, d.ad_text ?? null, d.facebook_ad_id]
    );
  } else {
    await exec.query(
      'INSERT INTO facebook_translation (facebook_ad_id, news_feed_description, ad_title, ad_text) VALUES (?,?,?,?)',
      [d.facebook_ad_id, d.news_feed_description ?? null, adTitle, d.ad_text ?? null]
    );
  }
  return true;
}

// ── facebook_users ──────────────────────────────────────────────────────────────
async function getUserByFacebookId(exec, facebookId) {
  return found(await exec.query('SELECT id, ads_info_status FROM facebook_users WHERE facebook_id = ? LIMIT 1', [facebookId]));
}
async function getUserFacebookIdByCountry(exec, country) {
  const r = rows(await exec.query('SELECT facebook_id FROM facebook_users WHERE current_country = ? LIMIT 1', [country]));
  return r.length ? r[0].facebook_id : null;
}
async function updateUser(exec, data, facebookId) {
  const cols = Object.keys(data);
  return affected(await exec.query(
    `UPDATE facebook_users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE facebook_id = ?`,
    [...Object.values(data), facebookId]
  ));
}

// ── languages ───────────────────────────────────────────────────────────────────
async function getLanguageId(exec, iso) {
  const r = rows(await exec.query('SELECT id FROM languages WHERE iso = ? LIMIT 1', [String(iso).toUpperCase()]));
  return r.length ? r[0].id : null;
}
async function insertLanguage(exec, iso, name) {
  return firstId(await exec.query('INSERT INTO languages (iso, name) VALUES (?, ?)', [iso, name ?? iso]));
}

// ── facebook_lib_page_details (dedup ad_id; INVERTED exists semantics) ──────────
async function libPageExists(exec, adId) {
  return rows(await exec.query('SELECT id FROM facebook_lib_page_details WHERE ad_id = ? LIMIT 1', [adId])).length > 0;
}
async function insertLibPage(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  return firstId(await exec.query(
    `INSERT INTO facebook_lib_page_details (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    Object.values(clean)
  ));
}
async function setLibPageAdId(exec, adId, facebookAdId) {
  return affected(await exec.query('UPDATE facebook_lib_page_details SET facebook_ad_id = ? WHERE ad_id = ?', [facebookAdId, adId]));
}

// ── country_data (ISO lookup) ───────────────────────────────────────────────────
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

// ── facebook_accounts_activities (platform 10) ──────────────────────────────────
async function insertAccountActivity(exec, d) {
  return affected(await exec.query(
    'INSERT INTO facebook_accounts_activities (account_id, system_id, facebook_ad_id, platform, is_unique) VALUES (?,?,?,?,?)',
    [d.account_id ?? null, d.system_id ?? null, d.facebook_ad_id, d.platform ?? null, d.is_unique ?? 0]
  ));
}

// ── ES synthetic-field SQL (for esDocBuilder) ───────────────────────────────────
async function getUserCountries(exec, facebookAdId) {
  const r = rows(await exec.query(
    `SELECT GROUP_CONCAT(country_only.country) AS country
       FROM facebook_ad_countries_only
       LEFT JOIN country_only ON country_only.id = facebook_ad_countries_only.country_only_id
      WHERE facebook_ad_countries_only.facebook_ad_id = ?`,
    [facebookAdId]
  ));
  const csv = r.length ? r[0].country : null;
  return csv ? String(csv).split(',') : [];
}
async function getAdCountries(exec, facebookAdId) {
  const r = rows(await exec.query(
    `SELECT country_only.country AS country
       FROM facebook_ad_countries
       LEFT JOIN country_only ON facebook_ad_countries.country_only_id = country_only.id
      WHERE facebook_ad_countries.facebook_ad_id = ?`,
    [facebookAdId]
  ));
  return r.map((row) => row.country).filter(Boolean);
}

// ── Users_Request (updateRequestedStatus) ───────────────────────────────────────
async function getUserRequest(exec, id) {
  return rows(await exec.query(
    'SELECT id, user_id, sent_status, keyword_status, advertiser_status, url_status, meta_sync_count FROM Users_Request WHERE id = ? LIMIT 1',
    [id]
  ));
}
async function setUserRequestColumn(exec, column, value, id) {
  // column is from a fixed allow-list (keyword_status/advertiser_status/url_status) — safe to interpolate.
  return affected(await exec.query(`UPDATE Users_Request SET ${column} = ? WHERE id = ?`, [value, id]));
}
async function bumpMetaSyncCount(exec, id) {
  return affected(await exec.query('UPDATE Users_Request SET meta_sync_count = meta_sync_count + 1 WHERE id = ?', [id]));
}
async function setSentStatus(exec, status, id) {
  return affected(await exec.query('UPDATE Users_Request SET sent_status = ? WHERE id = ?', [status, id]));
}

module.exports = {
  withTransaction,
  getAdByAdId, insertFacebookAd, updateFacebookAd, getJoinedAd, deleteAdCascade,
  getPostOwner, insertPostOwner, updatePostOwner,
  getCallToAction, insertCallToAction, bumpCallToActionCount,
  getCategory, insertCategory,
  upsertCountryOnly,
  getCountry, insertCountry,
  getDomain, insertDomain,
  insertVariant, updateVariant, updateVariantByAdId,
  insertAnalytics, updateAnalytics, getTodayAnalytics, getLastAnalytics, sumHits,
  insertComment, upsertAdImageVideo,
  insertAdCountries, insertAdCountriesOnly, upsertAdCountriesOnly,
  getAdUser, insertAdUser, bumpAdUserCount, setAdUserIdStatus,
  getMetaData, insertMetaData, updateMetaBuiltWith, updateMetaInitialUrl,
  budgetExists, insertBudget,
  upsertTranslation,
  getUserByFacebookId, getUserFacebookIdByCountry, updateUser,
  getLanguageId, insertLanguage,
  libPageExists, insertLibPage, setLibPageAdId,
  getIsoByNames, getNamesByIso,
  insertAccountActivity,
  getUserCountries, getAdCountries,
  getUserRequest, setUserRequestColumn, bumpMetaSyncCount, setSentStatus,
};
