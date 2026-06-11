'use strict';

/**
 * Facebook landers (destination-lander / blackhat) — data repository.
 *
 * Faithful port of the Laravel model methods used by the three PHP endpoints in
 * BlackHatController (api app):
 *   - getAdwithCountryCode      → fetch ads for lander, ES check, status update
 *   - uploadFileToServer        → (no SQL — NAS upload only)
 *   - insertHtmlRedirectCountry → store lander HTML / domains / urls / outgoing / meta
 *
 * One function per DB operation. No business logic here — the services orchestrate.
 * Every function takes `exec` (an object with `query(sql, params) -> rows|ResultSetHeader`)
 * as its first arg, so the same writers run standalone (db.sql) or inside a transaction.
 *
 * Tables (verified against the PHP models' $table):
 *   facebook_ad_meta_data            (PK facebook_ad_id)
 *   facebook_ad_domains
 *   facebook_ad_url
 *   facebook_ad_outgoing_links       (PHP model Facebook_ad_outgoing → table *_links)
 *   facebook_ad_html_lander_content  (PHP model Facebook_html_content)
 *   facebook_ad                      (main ad table; PK id = facebook_ad_id)
 *   facebook_ad_users, facebook_users, country_only, country_data  (lookups)
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

// Drop null/undefined keys so the column default applies instead of an explicit NULL.
const stripNulls = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// ── facebook_ad_meta_data ───────────────────────────────────────────────────────

/**
 * PHP getDataForLander(): up to 50 ads at redirect_status, joined to their users'
 * current country (group_concat). Mirrors the Laravel query exactly.
 */
async function getDataForLander(exec, redirectStatus) {
  const sql = `
    SELECT facebook_ad_meta_data.facebook_ad_id AS id,
           facebook_ad_meta_data.ad_url,
           facebook_ad_meta_data.destination_url,
           GROUP_CONCAT(country_only.country) AS country
      FROM facebook_ad_meta_data
      LEFT JOIN facebook_ad_users ON facebook_ad_users.facebook_ad_id = facebook_ad_meta_data.facebook_ad_id
      LEFT JOIN facebook_users    ON facebook_users.id = facebook_ad_users.user_id
      LEFT JOIN country_only      ON country_only.id = facebook_users.current_country_id
      LEFT JOIN facebook_ad       ON facebook_ad.id = facebook_ad_meta_data.facebook_ad_id
     WHERE facebook_ad_meta_data.redirect_status = ?
     GROUP BY facebook_ad_meta_data.facebook_ad_id
     ORDER BY facebook_ad_meta_data.facebook_ad_id DESC
     LIMIT 50`;
  return rows(await exec.query(sql, [redirectStatus]));
}

/** PHP getMetaDataDetails(): the screenshot/zip/status snapshot used by insertHtml. */
async function getMetaDataDetails(exec, facebookAdId) {
  const sql = `
    SELECT facebook_ad_id AS id, white_ad_screenshot, png_file, white_ad_lander,
           blackhat_path, blackhat_status, white_ad_status
      FROM facebook_ad_meta_data
     WHERE facebook_ad_id = ?`;
  return rows(await exec.query(sql, [facebookAdId]));
}

/** PHP updateData(): UPDATE facebook_ad_meta_data ... WHERE facebook_ad_id = ?. */
async function updateMeta(exec, facebookAdId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE facebook_ad_meta_data SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE facebook_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), facebookAdId]));
}

// ── facebook_ad_domains ─────────────────────────────────────────────────────────

async function getDomainId(exec, domain) {
  return rows(await exec.query('SELECT id FROM facebook_ad_domains WHERE domain = ?', [domain]));
}
async function updateDomainRegisterDate(exec, id, date) {
  return affected(await exec.query(
    'UPDATE facebook_ad_domains SET domain_registered_date = ? WHERE id = ?',
    [date, id]
  ));
}
async function insertDomainName(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO facebook_ad_domains (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/** PHP: UPDATE facebook_ad_domains SET dod_date = now() WHERE domain = ? (insertHtml ACK). */
async function setDomainDodDate(exec, domain, dodDate) {
  return affected(await exec.query(
    'UPDATE facebook_ad_domains SET dod_date = ? WHERE domain = ?',
    [dodDate, domain]
  ));
}

// ── facebook_ad_outgoing_links ──────────────────────────────────────────────────

/** PHP getOutgoingDetails(): match on the full URL tuple + proxy_lander_status. */
async function getOutgoingDetails(exec, w) {
  const sql = `
    SELECT country_code, id
      FROM facebook_ad_outgoing_links
     WHERE facebook_ad_id = ?
       AND source_url <=> ?
       AND redirect_url <=> ?
       AND final_url <=> ?
       AND proxy_lander_status <=> ?`;
  return rows(await exec.query(sql, [
    w.facebook_ad_id, w.source_url ?? null, w.redirect_url ?? null,
    w.final_url ?? null, w.proxy_lander_status ?? null,
  ]));
}
async function insertOutgoing(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO facebook_ad_outgoing_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/**
 * PHP updateOutgoingUrls($where,$data): UPDATE ... SET country_code = ? WHERE facebook_ad_id = ?.
 * NOTE: the PHP controller passes the matched row's `id` as $where, so the legacy query
 * filters facebook_ad_outgoing_links by facebook_ad_id = <that id value>. Replicated verbatim
 * to preserve behaviour — see BlackHatController@insertHtmlRedirectCountry.
 */
async function updateOutgoingCountry(exec, facebookAdIdWhere, countryCode) {
  return affected(await exec.query(
    'UPDATE facebook_ad_outgoing_links SET country_code = ? WHERE facebook_ad_id = ?',
    [countryCode, facebookAdIdWhere]
  ));
}

// ── facebook_ad_url ─────────────────────────────────────────────────────────────

/** PHP getDestinationDetails(): match on url_type + facebook_ad_id + url + proxy_lander_status. */
async function getDestinationDetails(exec, w, select) {
  const cols = Array.isArray(select) ? select.join(', ') : (select || '*');
  const sql = `
    SELECT ${cols}
      FROM facebook_ad_url
     WHERE url_type <=> ?
       AND facebook_ad_id = ?
       AND url <=> ?
       AND proxy_lander_status <=> ?`;
  return rows(await exec.query(sql, [
    w.url_type ?? null, w.facebook_ad_id, w.url ?? null, w.proxy_lander_status ?? null,
  ]));
}
async function insertAdUrl(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO facebook_ad_url (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/** PHP updateData(): UPDATE facebook_ad_url ... WHERE facebook_ad_id = ?. */
async function updateAdUrl(exec, facebookAdId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE facebook_ad_url SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE facebook_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), facebookAdId]));
}
/** PHP getCountryCode(): every stored country_code for this ad's urls. */
async function getCountryCodes(exec, facebookAdId) {
  return rows(await exec.query(
    'SELECT country_code FROM facebook_ad_url WHERE facebook_ad_id = ?',
    [facebookAdId]
  ));
}

// ── facebook_ad_html_lander_content ─────────────────────────────────────────────

async function getHtmlLanderDetails(exec, facebookAdId) {
  return rows(await exec.query(
    'SELECT id FROM facebook_ad_html_lander_content WHERE facebook_ad_id = ?',
    [facebookAdId]
  ));
}
async function insertHtmlFile(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO facebook_ad_html_lander_content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
async function updateHtmlFile(exec, facebookAdId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE facebook_ad_html_lander_content SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE facebook_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), facebookAdId]));
}

// ── facebook_ad (main) ──────────────────────────────────────────────────────────

/** PHP facebook_ad updateData(): WHERE id = facebook_ad_id (the internal/meta ad id). */
async function updateFacebookAd(exec, facebookAdId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE facebook_ad SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), facebookAdId]));
}

// ── lookups: facebook_ad_users / facebook_users / country_data ───────────────────

/** PHP: discoverers of an ad (type = 2), grouped by user. */
async function getAdUserIds(exec, facebookAdId) {
  return rows(await exec.query(
    'SELECT user_id FROM facebook_ad_users WHERE facebook_ad_id = ? AND type = 2 GROUP BY user_id',
    [facebookAdId]
  ));
}
async function getUserCurrentCountryId(exec, userId) {
  const r = rows(await exec.query(
    'SELECT current_country_id FROM facebook_users WHERE id = ?',
    [userId]
  ));
  return r.length ? r[0].current_country_id : null;
}
/** PHP: ISO codes for a list of country nicenames (country_data.nicename → iso). */
async function getIsoByNicenames(exec, nicenames) {
  const list = (Array.isArray(nicenames) ? nicenames : [nicenames]).filter((n) => n !== undefined && n !== null && n !== '');
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  const r = rows(await exec.query(`SELECT iso FROM country_data WHERE nicename IN (${placeholders})`, list));
  return r.map((row) => row.iso).filter((v) => v !== undefined && v !== null);
}
/** PHP: ISO for a single country_data row id. */
async function getIsoById(exec, id) {
  const r = rows(await exec.query('SELECT iso FROM country_data WHERE id = ?', [id]));
  return r.length ? r[0].iso : null;
}
/** PHP: nicename for an ISO code (insertHtml ES country_code resolution). */
async function getNicenameByIso(exec, iso) {
  const r = rows(await exec.query('SELECT nicename FROM country_data WHERE iso = ?', [iso]));
  return r.length ? r[0].nicename : null;
}

module.exports = {
  // meta
  getDataForLander, getMetaDataDetails, updateMeta,
  // domains
  getDomainId, updateDomainRegisterDate, insertDomainName, setDomainDodDate,
  // outgoing
  getOutgoingDetails, insertOutgoing, updateOutgoingCountry,
  // ad_url
  getDestinationDetails, insertAdUrl, updateAdUrl, getCountryCodes,
  // html lander
  getHtmlLanderDetails, insertHtmlFile, updateHtmlFile,
  // main ad
  updateFacebookAd,
  // lookups
  getAdUserIds, getUserCurrentCountryId, getIsoByNicenames, getIsoById, getNicenameByIso,
};
