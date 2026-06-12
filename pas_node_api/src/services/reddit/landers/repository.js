'use strict';

const databaseManager = require('../../../database/DatabaseManager');

// Helper to execute queries
async function executeQuery(sql, params = []) {
  const pool = databaseManager.getSQL('reddit');
  const connection = await pool.getConnection();
  try {
    const cleanParams = params.map(p => {
      if (typeof p === 'function' || (typeof p === 'object' && p !== null && typeof p.execute === 'function')) {
        return null;
      }
      return p;
    });
    const [results] = await connection.execute(sql, cleanParams);
    return results;
  } finally {
    connection.release();
  }
}

// ─── getAdsForBlackhat ─────────────────────────────────────────
async function getDataForLander(status = 0) {
  const sql = `
    SELECT reddit_ad_meta_data.reddit_ad_id as id,
           MAX(reddit_ad_meta_data.destination_url) as destination_url,
           GROUP_CONCAT(reddit_country_only.country) as country
    FROM reddit_ad_meta_data
    LEFT JOIN reddit_ad ON reddit_ad.id = reddit_ad_meta_data.reddit_ad_id
    LEFT JOIN reddit_country_only ON reddit_country_only.id = reddit_ad.country_only_id
    WHERE reddit_ad_meta_data.redirect_status = ?
    GROUP BY reddit_ad_meta_data.reddit_ad_id
    ORDER BY reddit_ad_meta_data.reddit_ad_id DESC
    LIMIT 100
  `;
  return executeQuery(sql, [status]);
}

async function updateStatusByIds(ids, data) {
  if (!ids || ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const setClauses = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const sql = `UPDATE reddit_ad_meta_data SET ${setClauses} WHERE reddit_ad_id IN (${placeholders})`;
  const params = [...Object.values(data), ...ids];
  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

async function getCountriesForAd(country) {
  if (!country) return [];
  const countryArray = country.split(',').map(c => c.trim());
  const placeholders = countryArray.map(() => '?').join(',');
  const sql = `SELECT iso FROM country_data WHERE nicename IN (${placeholders})`;
  return executeQuery(sql, countryArray);
}

async function getCountryNames(isoList) {
  if (!isoList || isoList.length === 0) return [];
  const placeholders = isoList.map(() => '?').join(',');
  const sql = `SELECT nicename FROM country_data WHERE iso IN (${placeholders})`;
  return executeQuery(sql, isoList);
}

// ─── Domain management ─────────────────────────────────────────
async function getDomainIdByDomain(domain) {
  const sql = 'SELECT id FROM reddit_ad_domain WHERE domain = ? LIMIT 1';
  const result = await executeQuery(sql, [domain]);
  return result && result.length ? result[0].id : null;
}

async function insertDomain(data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO reddit_ad_domain (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, Object.values(data));
  return result.insertId;
}

async function updateDomain(id, domainRegisteredDate) {
  const sql = 'UPDATE reddit_ad_domain SET domain_registered_date = ? WHERE id = ?';
  const result = await executeQuery(sql, [domainRegisteredDate, id]);
  return result.affectedRows;
}

async function updateAdDomainId(adId, domainId) {
  const sql = 'UPDATE reddit_ad SET domain_id = ? WHERE id = ?';
  const result = await executeQuery(sql, [domainId, adId]);
  return result.affectedRows;
}

// ─── Meta data ─────────────────────────────────────────────────
async function getAdMetaData(adId) {
  const sql = `
    SELECT reddit_ad_id, white_ad_screenshot, png_file, white_ad_lander, blackhat_path,
           blackhat_status, white_ad_status, redirect_status, blackhat_date, white_lander_date,
           outgoing_status
    FROM reddit_ad_meta_data WHERE reddit_ad_id = ? LIMIT 1
  `;
  const result = await executeQuery(sql, [adId]);
  return result && result.length ? result[0] : null;
}

async function updateAdMetaData(adId, data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined);
  if (cols.length === 0) return 0;
  const sql = `UPDATE reddit_ad_meta_data SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE reddit_ad_id = ?`;
  const params = [...cols.map(c => data[c]), adId];
  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

// ─── Ad URL ────────────────────────────────────────────────────
async function getAdUrlDestination(adId, url, status) {
  const sql = `
    SELECT reddit_ad_id, cat_status FROM reddit_ad_url
    WHERE reddit_ad_id = ? AND url_type = 'D' AND url = ? AND proxy_lander_status = ?
  `;
  return executeQuery(sql, [adId, url, status]);
}

async function getAdUrlRedirect(adId, url, status) {
  const sql = `
    SELECT reddit_ad_id FROM reddit_ad_url
    WHERE reddit_ad_id = ? AND url_type = 'R' AND url = ? AND proxy_lander_status = ?
  `;
  return executeQuery(sql, [adId, url, status]);
}

async function insertAdUrl(data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO reddit_ad_url (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, Object.values(data));
  return result.insertId;
}

async function updateAdUrl(adId, data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined);
  const sql = `UPDATE reddit_ad_url SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE reddit_ad_id = ? AND url_type = 'D'`;
  const params = [...cols.map(c => data[c]), adId];
  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

// ─── Outgoing links ────────────────────────────────────────────
async function getAdOutgoingDetails(whereObj) {
  const cols = Object.keys(whereObj);
  const sql = `SELECT country_code, id FROM reddit_ad_outgoing_links WHERE ${cols.map(c => `${c} = ?`).join(' AND ')}`;
  return executeQuery(sql, Object.values(whereObj));
}

async function insertAdOutgoing(data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO reddit_ad_outgoing_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, Object.values(data));
  return result.insertId;
}

async function updateAdOutgoing(id, countryCode) {
  const sql = 'UPDATE reddit_ad_outgoing_links SET country_code = ? WHERE id = ?';
  const result = await executeQuery(sql, [countryCode, id]);
  return result.affectedRows;
}

// ─── HTML lander content ───────────────────────────────────────
async function getHtmlLander(adId) {
  const sql = `SELECT id FROM reddit_ad_html_lander_content WHERE reddit_ad_id = ? LIMIT 1`;
  const result = await executeQuery(sql, [adId]);
  return result && result.length ? result[0] : null;
}

async function insertHtmlLander(data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined && typeof data[k] !== 'function');
  if (cols.length === 0) return null;
  const sql = `INSERT INTO reddit_ad_html_lander_content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, cols.map(c => data[c]));
  return result.insertId;
}

async function updateHtmlLander(adId, data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined);
  if (cols.length === 0) return 0;
  const sql = `UPDATE reddit_ad_html_lander_content SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE reddit_ad_id = ?`;
  const params = [...cols.map(c => data[c]), adId];
  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

// ─── Country code list (for ES update) ─────────────────────────
async function getCountryCodeList(adId) {
  const sql = `SELECT DISTINCT country_code FROM reddit_ad_url WHERE reddit_ad_id = ? AND country_code IS NOT NULL`;
  return executeQuery(sql, [adId]);
}

// ─── Ad Categories ─────────────────────────────────────────────
async function checkCategoryExist(adId) {
  const sql = 'SELECT * FROM reddit_ad_categories WHERE reddit_ad_id = ? LIMIT 1';
  const result = await executeQuery(sql, [adId]);
  return result && result.length ? result[0] : null;
}

async function insertAdCategory(data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO reddit_ad_categories (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, Object.values(data));
  return result.insertId;
}

async function updateCategory(adId, categoriesJson) {
  const sql = 'UPDATE reddit_ad_categories SET ad_categories = ? WHERE reddit_ad_id = ?';
  const result = await executeQuery(sql, [categoriesJson, adId]);
  return result.affectedRows;
}

async function getAllCategories() {
  const sql = 'SELECT category FROM ad_categories';
  const result = await executeQuery(sql, []);
  return result.map(r => r.category);
}

async function insertCategory(category) {
  const sql = 'INSERT INTO ad_categories (category) VALUES (?)';
  return executeQuery(sql, [category]);
}

module.exports = {
  getDataForLander,
  updateStatusByIds,
  getCountriesForAd,
  getCountryNames,
  getDomainIdByDomain,
  insertDomain,
  updateDomain,
  updateAdDomainId,
  getAdMetaData,
  updateAdMetaData,
  getAdUrlDestination,
  getAdUrlRedirect,
  insertAdUrl,
  updateAdUrl,
  getAdOutgoingDetails,
  insertAdOutgoing,
  updateAdOutgoing,
  getHtmlLander,
  insertHtmlLander,
  updateHtmlLander,
  getCountryCodeList,
  checkCategoryExist,
  insertAdCategory,
  updateCategory,
  getAllCategories,
  insertCategory,
};
