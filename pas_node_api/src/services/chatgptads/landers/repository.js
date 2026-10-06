'use strict';

/**
 * ChatGPT Ads landers (destination-lander) — data repository.
 *
 * Mirrors facebook/landers/repository.js, reshaped for this network's schema
 * (scripts/chatgptads/chatgptads_schema.sql):
 *   - lander progress lives on chatgptads_ad.lander_status (no _meta_data table);
 *   - the captured lander lives in chatgptads_ad_landers (ONE row per ad, upserted),
 *     and its page text in chatgptads_ad_html_lander_content (ONE row per ad, upserted);
 *   - countries come from chatgptads_ad_countries → chatgptads_country_only (names);
 *   - the domain registration date lives on chatgptads_ad_domains.domain_registered_date.
 *
 * One function per DB operation. No business logic here — the services orchestrate.
 * Every function takes `exec` (an object with `query(sql, params) -> rows|ResultSetHeader`)
 * as its first arg, so the same writers run standalone (db.sql) or inside a transaction.
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

// ── chatgptads_ad ───────────────────────────────────────────────────────────────

/**
 * Up to 50 ads at lander_status, with their tracked country names (group_concat).
 *
 * `excludeServedToday` skips ads whose updated_at is today (already handed out today by
 * markServedMultiple) — used for the IN_PROCESSING fallback so an ad is re-served at most once a day.
 * Ads with an unusable destination_url (NULL, blank, or the literal 'null'/'undefined')
 * are excluded so they are never leased.
 */
async function getDataForLander(exec, landerStatus, { excludeServedToday = false } = {}) {
  const statuses = Array.isArray(landerStatus) ? landerStatus : [landerStatus];
  const placeholders = statuses.map(() => '?').join(',');
  const servedTodayFilter = excludeServedToday
    ? 'AND (chatgptads_ad.updated_at IS NULL OR chatgptads_ad.updated_at < CURDATE())'
    : '';
  const sql = `
    SELECT chatgptads_ad.id,
           chatgptads_ad.ad_id AS ad_url,
           chatgptads_ad.destination_url,
           GROUP_CONCAT(DISTINCT chatgptads_country_only.country) AS country
      FROM chatgptads_ad
      LEFT JOIN chatgptads_ad_countries ON chatgptads_ad_countries.chatgptads_ad_id = chatgptads_ad.id
      LEFT JOIN chatgptads_country_only ON chatgptads_country_only.id = chatgptads_ad_countries.country_only_id
     WHERE chatgptads_ad.lander_status IN (${placeholders})
       AND chatgptads_ad.destination_url IS NOT NULL
       AND TRIM(chatgptads_ad.destination_url) <> ''
       AND LOWER(TRIM(chatgptads_ad.destination_url)) NOT IN ('null', 'undefined')
       ${servedTodayFilter}
     GROUP BY chatgptads_ad.id
     ORDER BY chatgptads_ad.id DESC
     LIMIT 50`;
  return rows(await exec.query(sql, statuses));
}

/**
 * Claim ads for the lander worker: lander_status = status and updated_at = NOW().
 * updated_at is set explicitly because ON UPDATE CURRENT_TIMESTAMP does not fire when an
 * already-IN_PROCESSING ad is re-served (no column value changes).
 */
async function markServedMultiple(exec, adIds, status) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return affected(await exec.query(
    `UPDATE chatgptads_ad SET lander_status = ?, updated_at = NOW() WHERE id IN (${placeholders})`,
    [status, ...ids]
  ));
}

/** Bulk lander_status update: one UPDATE ... WHERE id IN (...). */
async function updateLanderStatusMultiple(exec, adIds, status) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  return affected(await exec.query(
    `UPDATE chatgptads_ad SET lander_status = ? WHERE id IN (${placeholders})`,
    [status, ...ids]
  ));
}

/** Single-ad lander_status update. */
async function updateLanderStatus(exec, adId, status) {
  return affected(await exec.query(
    'UPDATE chatgptads_ad SET lander_status = ? WHERE id = ?',
    [status, adId]
  ));
}

// ── chatgptads_ad_landers ────────────────────────────────────────────────

/**
 * Insert or replace the ad's single lander row (UNIQUE chatgptads_ad_id). A re-crawl
 * overwrites every captured field, so the row always reflects the latest crawl.
 */
async function upsertLanderContent(exec, data) {
  const sql = `
    INSERT INTO chatgptads_ad_landers
           (chatgptads_ad_id, html_path, screenshot_url, out_going_url, redirect_url, scrapper_name)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
           html_path      = VALUES(html_path),
           screenshot_url = VALUES(screenshot_url),
           out_going_url  = VALUES(out_going_url),
           redirect_url   = VALUES(redirect_url),
           scrapper_name  = VALUES(scrapper_name)`;
  return affected(await exec.query(sql, [
    data.chatgptads_ad_id, data.html_path ?? null,
    data.screenshot_url ?? null, data.out_going_url ?? null, data.redirect_url ?? null,
    data.scrapper_name ?? null,
  ]));
}

// ── chatgptads_ad_html_lander_content ───────────────────────────────────────────

/** Insert or replace the ad's lander page text (UNIQUE chatgptads_ad_id). */
async function upsertHtmlLanderContent(exec, chatgptadsAdId, htmlContent) {
  const sql = `
    INSERT INTO chatgptads_ad_html_lander_content (chatgptads_ad_id, html_content)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE html_content = VALUES(html_content)`;
  return affected(await exec.query(sql, [chatgptadsAdId, htmlContent ?? null]));
}

// ── chatgptads_ad_domains ───────────────────────────────────────────────────────

/**
 * Find-or-create the domain row (UNIQUE domain) and record its registration date.
 * A NULL date never overwrites a date already stored (COALESCE keeps the old value).
 */
async function upsertDomainRegisteredDate(exec, domain, registeredDate) {
  const sql = `
    INSERT INTO chatgptads_ad_domains (domain, domain_registered_date)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
           domain_registered_date = COALESCE(VALUES(domain_registered_date), domain_registered_date)`;
  return affected(await exec.query(sql, [domain, registeredDate ?? null]));
}

module.exports = {
  // chatgptads_ad
  getDataForLander, markServedMultiple, updateLanderStatusMultiple, updateLanderStatus,
  // lander content
  upsertLanderContent, upsertHtmlLanderContent,
  // domains
  upsertDomainRegisteredDate,
};
