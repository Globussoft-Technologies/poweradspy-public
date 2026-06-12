'use strict';

/**
 * LinkedIn landers — data repository (raw parameterized SQL).
 *
 * Same shape + function names as youtube/landers/repository.js, adapted to the LinkedIn
 * schema (verified live against pasdev_linkedin). Faithful port of the model methods used by
 * api_linkedin BlackhatController (getAdsForBlackHat / uploadBlackhatContent / inserHtmlContentToDB).
 *
 * Every function takes `exec` (`query(sql, params) -> rows|ResultSetHeader`); pass `db.sql`.
 * getX → rows, insertX → insertId, updateX → affected — exactly like the youtube landers repo.
 *
 * DB-verified LinkedIn facts (differ from youtube only here):
 *   - lander columns (png_file, white_ad_x, blackhat_x, redirect_status, outgoing_status) live on
 *     linkedin_ad_meta_data — same as youtube_ad_meta_data.
 *   - country lookup uses the SHARED `country_only` (not a linkedin_country_only).
 *   - linkedin_ad_domains has NO dod_date column (so no setDomainDodDate).
 *   - linkedin_ad_outgoing_links.{country_code,proxy_lander_status,*_final_url} and
 *     linkedin_ad_html_lander_content.html_* are NOT NULL → caller passes '' / defaults.
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);
const stripNulls = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// ── linkedin_ad_meta_data ────────────────────────────────────────────────────────
async function getDataForLander(exec, redirectStatus) {
  const sql = `
    SELECT linkedin_ad_meta_data.linkedin_ad_id AS id,
           ANY_VALUE(linkedin_ad_meta_data.ad_url) AS ad_url,
           ANY_VALUE(linkedin_ad_meta_data.destination_url) AS destination_url,
           GROUP_CONCAT(country_only.country) AS country
      FROM linkedin_ad_meta_data
      LEFT JOIN linkedin_ad_countries_only
             ON linkedin_ad_countries_only.linkedin_ad_id = linkedin_ad_meta_data.linkedin_ad_id
      LEFT JOIN country_only
             ON country_only.id = linkedin_ad_countries_only.country_only_id
     WHERE linkedin_ad_meta_data.redirect_status = ?
       AND linkedin_ad_meta_data.destination_url IS NOT NULL
     GROUP BY linkedin_ad_meta_data.linkedin_ad_id
     ORDER BY linkedin_ad_meta_data.linkedin_ad_id DESC
     LIMIT 100`;
  return rows(await exec.query(sql, [redirectStatus]));
}

async function getMetaDataDetails(exec, adId) {
  const sql = `
    SELECT linkedin_ad_id AS id, white_ad_screenshot, png_file, white_ad_lander,
           blackhat_path, blackhat_status, white_ad_status
      FROM linkedin_ad_meta_data
     WHERE linkedin_ad_id = ?`;
  return rows(await exec.query(sql, [adId]));
}

async function updateMeta(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE linkedin_ad_meta_data SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE linkedin_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

async function updateMainAdDomainId(exec, adId, domainId) {
  return affected(await exec.query('UPDATE linkedin_ad SET domain_id = ? WHERE id = ?', [domainId, adId]));
}

// ── linkedin_ad_domains (no dod_date) ────────────────────────────────────────────
async function getDomainId(exec, domain) {
  return rows(await exec.query('SELECT id FROM linkedin_ad_domains WHERE domain = ?', [domain]));
}
async function updateDomainRegisterDate(exec, id, date) {
  return affected(await exec.query('UPDATE linkedin_ad_domains SET domain_registered_date = ? WHERE id = ?', [date, id]));
}
async function insertDomainName(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO linkedin_ad_domains (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}

// ── linkedin_ad_outgoing_links (*_final_url NOT NULL → default '') ────────────────
async function getOutgoingDetails(exec, w) {
  const sql = `
    SELECT country_code, id
      FROM linkedin_ad_outgoing_links
     WHERE linkedin_ad_id = ?
       AND source_url <=> ?
       AND redirect_url <=> ?
       AND final_url <=> ?`;
  return rows(await exec.query(sql, [w.linkedin_ad_id, w.source_url ?? null, w.redirect_url ?? null, w.final_url ?? null]));
}
async function insertOutgoing(exec, data) {
  const clean = stripNulls({
    html_content_final_url: '', white_ad_lander_final_url: '', white_ad_screenshot_final_url: '',
    ...data,
  });
  const cols = Object.keys(clean);
  const sql = `INSERT INTO linkedin_ad_outgoing_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
async function updateOutgoingCountry(exec, rowId, countryCode) {
  return affected(await exec.query('UPDATE linkedin_ad_outgoing_links SET country_code = ? WHERE id = ?', [countryCode, rowId]));
}

// ── linkedin_ad_url ──────────────────────────────────────────────────────────────
async function getDestinationDetails(exec, w, select) {
  const cols = Array.isArray(select) ? select.join(', ') : (select || '*');
  const sql = `
    SELECT ${cols}
      FROM linkedin_ad_url
     WHERE url_type <=> ?
       AND linkedin_ad_id = ?
       AND url <=> ?
       AND proxy_lander_status <=> ?`;
  return rows(await exec.query(sql, [w.url_type ?? null, w.linkedin_ad_id, w.url ?? null, w.proxy_lander_status ?? null]));
}
async function insertAdUrl(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO linkedin_ad_url (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
async function updateAdUrl(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE linkedin_ad_url SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE linkedin_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}
async function getCountryCodes(exec, adId) {
  return rows(await exec.query('SELECT country_code FROM linkedin_ad_url WHERE linkedin_ad_id = ?', [adId]));
}

// ── linkedin_ad_html_lander_content (html_* NOT NULL → caller passes '') ──────────
async function getHtmlLanderDetails(exec, adId) {
  return rows(await exec.query('SELECT id FROM linkedin_ad_html_lander_content WHERE linkedin_ad_id = ?', [adId]));
}
async function insertHtmlFile(exec, data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO linkedin_ad_html_lander_content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(data)));
}
async function updateHtmlFile(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE linkedin_ad_html_lander_content SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE linkedin_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

// ── country_data ─────────────────────────────────────────────────────────────────
async function getIsoByNicenames(exec, nicenames) {
  const list = (Array.isArray(nicenames) ? nicenames : [nicenames]).filter((n) => n !== undefined && n !== null && n !== '');
  if (!list.length) return [];
  const r = rows(await exec.query(`SELECT iso FROM country_data WHERE nicename IN (${list.map(() => '?').join(',')})`, list));
  return r.map((row) => row.iso).filter((v) => v !== undefined && v !== null);
}
async function getNicenameByIso(exec, iso) {
  const r = rows(await exec.query('SELECT nicename FROM country_data WHERE iso = ?', [iso]));
  return r.length ? r[0].nicename : null;
}

module.exports = {
  getDataForLander, getMetaDataDetails, updateMeta, updateMainAdDomainId,
  getDomainId, updateDomainRegisterDate, insertDomainName,
  getOutgoingDetails, insertOutgoing, updateOutgoingCountry,
  getDestinationDetails, insertAdUrl, updateAdUrl, getCountryCodes,
  getHtmlLanderDetails, insertHtmlFile, updateHtmlFile,
  getIsoByNicenames, getNicenameByIso,
};
