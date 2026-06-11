'use strict';

/**
 * Google (gtext) landers — data repository (raw parameterized SQL).
 *
 * Faithful port of the Laravel model methods used by the three gtext PHP endpoints
 * (api_gtext BlackhatController: getGoogleAdsWithCounrty / uploadBlackhatContent /
 * inserHtmlContentToDBO). One function per DB operation, grouped by table — same
 * shape as the facebook landers repository.
 *
 * Every function takes `exec` as its first arg: an object with
 * `query(sql, params) -> rows | ResultSetHeader`. Pass `db.sql` for autocommit.
 *
 * Tables (DB pasdev_gtext):
 *   google_text_ad_meta_data        (PK google_text_ad_id)
 *   google_text_ad_domains
 *   google_ad_url
 *   google_ad_outgoing_links
 *   google_ad_html_lander_content
 *   google_text_ad                  (main ad; PK id)
 *   google_text_ad_countries_only / google_text_country_only / country_data (lookups)
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const firstId = (r) => (r && r.insertId ? r.insertId : 0);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

// Drop null/undefined keys so the column default applies instead of an explicit NULL.
const stripNulls = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));

// ── google_text_ad_meta_data ────────────────────────────────────────────────────

/**
 * PHP getDataForLander(): up to 50 ads at the given redirect_status, joined to the
 * ad's own tracked countries. destination_url is wrapped in ANY_VALUE() so the
 * GROUP BY is valid under MySQL only_full_group_by (manifest §8 gotcha #2).
 * Returns [{ id, destination_url, country }] (country = comma-joined names).
 */
async function getDataForLander(exec, redirectStatus) {
  const sql = `
    SELECT google_text_ad_meta_data.google_text_ad_id AS id,
           ANY_VALUE(google_text_ad_meta_data.destination_url) AS destination_url,
           GROUP_CONCAT(google_text_country_only.country) AS country
      FROM google_text_ad_meta_data
      LEFT JOIN google_text_ad_countries_only
             ON google_text_ad_countries_only.google_text_ad_id = google_text_ad_meta_data.google_text_ad_id
      LEFT JOIN google_text_country_only
             ON google_text_country_only.id = google_text_ad_countries_only.country_only_id
     WHERE google_text_ad_meta_data.redirect_status = ?
     GROUP BY google_text_ad_meta_data.google_text_ad_id
     ORDER BY google_text_ad_meta_data.google_text_ad_id DESC
     LIMIT 50`;
  return rows(await exec.query(sql, [redirectStatus]));
}

/** PHP updateDataMultiple(): bulk redirect_status flip for the fetched ids. */
async function updateMetaMultiple(exec, adIds, data) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE google_text_ad_meta_data SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE google_text_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [...Object.values(data), ...ids]));
}

/** PHP getMetaDataDetails(): the screenshot/zip/status snapshot used by insertHtml. */
async function getMetaDataDetails(exec, adId) {
  const sql = `
    SELECT google_text_ad_id AS id, white_ad_screenshot, png_file, white_ad_lander,
           blackhat_path, blackhat_status, white_ad_status
      FROM google_text_ad_meta_data
     WHERE google_text_ad_id = ?`;
  return rows(await exec.query(sql, [adId]));
}

/** PHP updateDataO(): UPDATE ... WHERE google_text_ad_id = ?. Returns affectedRows (0 = no change). */
async function updateMeta(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE google_text_ad_meta_data SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE google_text_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

/** PHP GoogleTextAd.updateData(): set domain_id on the main google_text_ad row (WHERE id = ?). */
async function updateMainAdDomainId(exec, adId, domainId) {
  return affected(await exec.query('UPDATE google_text_ad SET domain_id = ? WHERE id = ?', [domainId, adId]));
}

// ── google_text_ad_domains ──────────────────────────────────────────────────────
// Note: the gtext lander does NOT stamp a dod_date (the facebook one did).

async function getDomainId(exec, domain) {
  return rows(await exec.query('SELECT id FROM google_text_ad_domains WHERE domain = ?', [domain]));
}
async function updateDomainRegisterDate(exec, id, date) {
  return affected(await exec.query('UPDATE google_text_ad_domains SET domain_registered_date = ? WHERE id = ?', [date, id]));
}
async function insertDomainName(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO google_text_ad_domains (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}

// ── google_ad_outgoing_links ────────────────────────────────────────────────────

/** PHP getOutgoingDetails(): match on the full URL tuple + proxy_lander_status. */
async function getOutgoingDetails(exec, w) {
  const sql = `
    SELECT country_code, id
      FROM google_ad_outgoing_links
     WHERE google_text_ad_id = ?
       AND source_url <=> ?
       AND redirect_url <=> ?
       AND final_url <=> ?
       AND proxy_lander_status <=> ?`;
  return rows(await exec.query(sql, [
    w.google_text_ad_id, w.source_url ?? null, w.redirect_url ?? null,
    w.final_url ?? null, w.proxy_lander_status ?? null,
  ]));
}
async function insertOutgoing(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO google_ad_outgoing_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/**
 * PHP updateOutgoingUrls($where,$data): UPDATE ... SET country_code = ? WHERE google_text_ad_id = ?.
 * The PHP controller passes the matched row's `id` as $where (legacy quirk) — replicated verbatim.
 */
async function updateOutgoingCountry(exec, adIdWhere, countryCode) {
  return affected(await exec.query(
    'UPDATE google_ad_outgoing_links SET country_code = ? WHERE google_text_ad_id = ?',
    [countryCode, adIdWhere]
  ));
}

// ── google_ad_url ───────────────────────────────────────────────────────────────

/** PHP getDestinationDetails(): match on url_type + google_text_ad_id + url + proxy_lander_status. */
async function getDestinationDetails(exec, w, select) {
  const cols = Array.isArray(select) ? select.join(', ') : (select || '*');
  const sql = `
    SELECT ${cols}
      FROM google_ad_url
     WHERE url_type <=> ?
       AND google_text_ad_id = ?
       AND url <=> ?
       AND proxy_lander_status <=> ?`;
  return rows(await exec.query(sql, [
    w.url_type ?? null, w.google_text_ad_id, w.url ?? null, w.proxy_lander_status ?? null,
  ]));
}
async function insertAdUrl(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO google_ad_url (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
/** PHP updateData(): UPDATE google_ad_url ... WHERE google_text_ad_id = ?. */
async function updateAdUrl(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE google_ad_url SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE google_text_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}
/** PHP getCountryCode(): every stored country_code for this ad's urls. */
async function getCountryCodes(exec, adId) {
  return rows(await exec.query('SELECT country_code FROM google_ad_url WHERE google_text_ad_id = ?', [adId]));
}

// ── google_ad_html_lander_content ───────────────────────────────────────────────

async function getHtmlLanderDetails(exec, adId) {
  return rows(await exec.query('SELECT id FROM google_ad_html_lander_content WHERE google_text_ad_id = ?', [adId]));
}
async function insertHtmlFile(exec, data) {
  const clean = stripNulls(data);
  const cols = Object.keys(clean);
  const sql = `INSERT INTO google_ad_html_lander_content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return firstId(await exec.query(sql, Object.values(clean)));
}
async function updateHtmlFile(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE google_ad_html_lander_content SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE google_text_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

// ── country_data (ISO ↔ nicename lookups) ───────────────────────────────────────

/** PHP: ISO codes for a list of country nicenames (country_data.nicename → iso). */
async function getIsoByNicenames(exec, nicenames) {
  const list = (Array.isArray(nicenames) ? nicenames : [nicenames]).filter((n) => n !== undefined && n !== null && n !== '');
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  const r = rows(await exec.query(`SELECT iso FROM country_data WHERE nicename IN (${placeholders})`, list));
  return r.map((row) => row.iso).filter((v) => v !== undefined && v !== null);
}
/** PHP: nicename for an ISO code (insert_html country_code resolution). */
async function getNicenameByIso(exec, iso) {
  const r = rows(await exec.query('SELECT nicename FROM country_data WHERE iso = ?', [iso]));
  return r.length ? r[0].nicename : null;
}

module.exports = {
  // meta (+ main ad)
  getDataForLander, updateMetaMultiple, getMetaDataDetails, updateMeta, updateMainAdDomainId,
  // domains
  getDomainId, updateDomainRegisterDate, insertDomainName,
  // outgoing
  getOutgoingDetails, insertOutgoing, updateOutgoingCountry,
  // ad_url
  getDestinationDetails, insertAdUrl, updateAdUrl, getCountryCodes,
  // html lander
  getHtmlLanderDetails, insertHtmlFile, updateHtmlFile,
  // lookups
  getIsoByNicenames, getNicenameByIso,
};
