'use strict';

/**
 * YouTube landers — data repository (raw parameterized SQL).
 *
 * Faithful port of the Laravel model methods used by the three youtube PHP endpoints
 * (api_youtube BlackhatControllerYoutube: getYoutubeAdsWithCounrty / uploadBlackhatContent /
 * inserHtmlContentToDB). Same shape as the facebook/google landers repository.
 *
 * Every function takes `exec` (an object with `query(sql, params) -> rows|ResultSetHeader`).
 *
 * Tables (DB pasdev_youtube):
 *   youtube_ad_meta_data        (PK youtube_ad_id)
 *   youtube_ad_domains
 *   youtube_ad_url
 *   youtube_ad_outgoing_links
 *   youtube_ad_html_lander_content
 *   youtube_ad                  (main ad; PK id)
 *   youtube_ad_countries_only / youtube_country_only / country_data (lookups)
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const stripNulls = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// ── youtube_ad_meta_data ────────────────────────────────────────────────────────

/**
 * PHP getDataForLanderWithCountry(): up to 100 ads at redirect_status with a non-null
 * destination_url, joined to country names. ad_url/destination_url wrapped in ANY_VALUE()
 * for only_full_group_by.
 *
 * NOTE (faithful to PHP): the join is `youtube_ad_countries_only.id = meta.youtube_ad_id`
 * exactly as the legacy Laravel query wrote it.
 */
async function getDataForLander(exec, redirectStatus) {
  const sql = `
    SELECT youtube_ad_meta_data.youtube_ad_id AS id,
           ANY_VALUE(youtube_ad_meta_data.ad_url) AS ad_url,
           ANY_VALUE(youtube_ad_meta_data.destination_url) AS destination_url,
           GROUP_CONCAT(youtube_country_only.country) AS country
      FROM youtube_ad_meta_data
      LEFT JOIN youtube_ad_countries_only
             ON youtube_ad_countries_only.id = youtube_ad_meta_data.youtube_ad_id
      LEFT JOIN youtube_country_only
             ON youtube_country_only.id = youtube_ad_countries_only.country_only_id
     WHERE youtube_ad_meta_data.redirect_status = ?
       AND youtube_ad_meta_data.destination_url IS NOT NULL
     GROUP BY youtube_ad_meta_data.youtube_ad_id
     ORDER BY youtube_ad_meta_data.youtube_ad_id DESC
     LIMIT 100`;
  return rows(await exec.query(sql, [redirectStatus]));
}

/** PHP getMetaDataDetails(): screenshot/zip/status snapshot used by insertHtml. */
async function getMetaDataDetails(exec, adId) {
  const sql = `
    SELECT youtube_ad_id AS id, white_ad_screenshot, png_file, white_ad_lander,
           blackhat_path, blackhat_status, white_ad_status
      FROM youtube_ad_meta_data
     WHERE youtube_ad_id = ?`;
  return rows(await exec.query(sql, [adId]));
}

/** PHP updateData()/updateYoutubeAdMetaData(): UPDATE ... WHERE youtube_ad_id = ?. */
async function updateMeta(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE youtube_ad_meta_data SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE youtube_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

/** PHP YoutubeAd.updateData1(): set domain_id on the main youtube_ad row (WHERE id = ?). */
async function updateMainAdDomainId(exec, adId, domainId) {
  return affected(await exec.query('UPDATE youtube_ad SET domain_id = ? WHERE id = ?', [domainId, adId]));
}

// ── youtube_ad_domains ──────────────────────────────────────────────────────────

async function getDomainId(exec, domain) {
  return rows(await exec.query('SELECT id FROM youtube_ad_domains WHERE domain = ?', [domain]));
}
async function updateDomainRegisterDate(exec, id, date) {
  return affected(await exec.query('UPDATE youtube_ad_domains SET domain_registered_date = ? WHERE id = ?', [date, id]));
}
async function insertDomainName(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO youtube_ad_domains (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/** PHP: UPDATE youtube_ad_domains SET dod_date = now() WHERE domain = ? (insertHtml ACK). */
async function setDomainDodDate(exec, domain, dodDate) {
  return affected(await exec.query('UPDATE youtube_ad_domains SET dod_date = ? WHERE domain = ?', [dodDate, domain]));
}

// ── youtube_ad_outgoing_links ───────────────────────────────────────────────────

/** PHP getOutgoingDetails(): match on youtube_ad_id + source/redirect/final url (NO proxy_lander_status). */
async function getOutgoingDetails(exec, w) {
  const sql = `
    SELECT country_code, id
      FROM youtube_ad_outgoing_links
     WHERE youtube_ad_id = ?
       AND source_url <=> ?
       AND redirect_url <=> ?
       AND final_url <=> ?`;
  return rows(await exec.query(sql, [
    w.youtube_ad_id, w.source_url ?? null, w.redirect_url ?? null, w.final_url ?? null,
  ]));
}
async function insertOutgoing(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO youtube_ad_outgoing_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/** PHP updateOutgoingUrls(): UPDATE ... SET country_code = ? WHERE youtube_ad_id = ? (legacy: id passed as where). */
async function updateOutgoingCountry(exec, adIdWhere, countryCode) {
  return affected(await exec.query(
    'UPDATE youtube_ad_outgoing_links SET country_code = ? WHERE youtube_ad_id = ?',
    [countryCode, adIdWhere]
  ));
}

// ── youtube_ad_url ──────────────────────────────────────────────────────────────

/** PHP getDestinationDetails(): match on url_type + youtube_ad_id + url + proxy_lander_status. */
async function getDestinationDetails(exec, w, select) {
  const cols = Array.isArray(select) ? select.join(', ') : (select || '*');
  const sql = `
    SELECT ${cols}
      FROM youtube_ad_url
     WHERE url_type <=> ?
       AND youtube_ad_id = ?
       AND url <=> ?
       AND proxy_lander_status <=> ?`;
  return rows(await exec.query(sql, [
    w.url_type ?? null, w.youtube_ad_id, w.url ?? null, w.proxy_lander_status ?? null,
  ]));
}
async function insertAdUrl(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO youtube_ad_url (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/** PHP updateData(): UPDATE youtube_ad_url ... WHERE youtube_ad_id = ?. */
async function updateAdUrl(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE youtube_ad_url SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE youtube_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}
/** PHP getCountryCode(): every stored country_code for this ad's urls. */
async function getCountryCodes(exec, adId) {
  return rows(await exec.query('SELECT country_code FROM youtube_ad_url WHERE youtube_ad_id = ?', [adId]));
}

// ── youtube_ad_html_lander_content ──────────────────────────────────────────────

async function getHtmlLanderDetails(exec, adId) {
  return rows(await exec.query('SELECT id FROM youtube_ad_html_lander_content WHERE youtube_ad_id = ?', [adId]));
}
async function insertHtmlFile(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO youtube_ad_html_lander_content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
async function updateHtmlFile(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE youtube_ad_html_lander_content SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE youtube_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

// ── country_data (ISO ↔ nicename lookups) ───────────────────────────────────────

async function getIsoByNicenames(exec, nicenames) {
  const list = (Array.isArray(nicenames) ? nicenames : [nicenames]).filter((n) => n !== undefined && n !== null && n !== '');
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  const r = rows(await exec.query(`SELECT iso FROM country_data WHERE nicename IN (${placeholders})`, list));
  return r.map((row) => row.iso).filter((v) => v !== undefined && v !== null);
}
async function getNicenameByIso(exec, iso) {
  const r = rows(await exec.query('SELECT nicename FROM country_data WHERE iso = ?', [iso]));
  return r.length ? r[0].nicename : null;
}

module.exports = {
  getDataForLander, getMetaDataDetails, updateMeta, updateMainAdDomainId,
  getDomainId, updateDomainRegisterDate, insertDomainName, setDomainDodDate,
  getOutgoingDetails, insertOutgoing, updateOutgoingCountry,
  getDestinationDetails, insertAdUrl, updateAdUrl, getCountryCodes,
  getHtmlLanderDetails, insertHtmlFile, updateHtmlFile,
  getIsoByNicenames, getNicenameByIso,
};
