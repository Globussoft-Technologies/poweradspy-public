'use strict';

const databaseManager = require('../../../database/DatabaseManager');

// Helper to execute queries
async function executeQuery(sql, params = []) {
  const pool = databaseManager.getSQL('quora');
  const connection = await pool.getConnection();
  try {
    // Filter out functions and other non-serializable values
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

async function getDataForLander(status = 0) {
  const sql = `
    SELECT quora_ad_meta_data.quora_ad_id as id,
           MAX(quora_ad_meta_data.destination_url) as destination_url,
           GROUP_CONCAT(quora_country_only.country) as country
    FROM quora_ad_meta_data
    LEFT JOIN quora_ad ON quora_ad.id = quora_ad_meta_data.quora_ad_id
    LEFT JOIN quora_country_only ON quora_country_only.id = quora_ad.country_only_id
    WHERE quora_ad_meta_data.redirect_status = ?
    GROUP BY quora_ad_meta_data.quora_ad_id
    ORDER BY quora_ad_meta_data.quora_ad_id DESC
    LIMIT 100
  `;
  const result = await executeQuery(sql, [status]);
  return result;
}

async function updateStatusByIds(ids, data) {
  if (!ids || ids.length === 0) return 0;

  const placeholders = ids.map(() => '?').join(',');
  const setClauses = Object.keys(data).map(k => `${k} = ?`).join(', ');
  const sql = `UPDATE quora_ad_meta_data SET ${setClauses} WHERE quora_ad_id IN (${placeholders})`;
  const params = [...Object.values(data), ...ids];

  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

async function getCountriesForAd(country) {
  if (!country) return [];

  const countryArray = country.split(',').map(c => c.trim());
  const placeholders = countryArray.map(() => '?').join(',');
  const sql = `SELECT iso FROM country_data WHERE nicename IN (${placeholders})`;

  const result = await executeQuery(sql, countryArray);
  return result;
}

async function getDomainIdByDomain(domain) {
  const sql = 'SELECT id FROM quora_ad_domain WHERE domain = ? LIMIT 1';
  const result = await executeQuery(sql, [domain]);
  return result && result.length ? result[0].id : null;
}

async function insertDomain(data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO quora_ad_domain (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, Object.values(data));
  return result.insertId;
}

async function updateDomain(id, domainRegisteredDate) {
  const sql = 'UPDATE quora_ad_domain SET domain_registered_date = ? WHERE id = ?';
  const result = await executeQuery(sql, [domainRegisteredDate, id]);
  return result.affectedRows;
}

async function updateAdDomainId(adId, domainId) {
  const sql = 'UPDATE quora_ad SET domain_id = ? WHERE id = ?';
  const result = await executeQuery(sql, [domainId, adId]);
  return result.affectedRows;
}

async function getAdMetaData(adId) {
  const sql = `
    SELECT quora_ad_id, white_ad_screenshot, png_file, white_ad_lander, blackhat_path,
           blackhat_status, white_ad_status
    FROM quora_ad_meta_data WHERE quora_ad_id = ? LIMIT 1
  `;
  const result = await executeQuery(sql, [adId]);
  return result && result.length ? result[0] : null;
}

async function updateAdMetaData(adId, data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined);
  if (cols.length === 0) return 0;

  const sql = `UPDATE quora_ad_meta_data SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE quora_ad_id = ?`;
  const params = [...cols.map(c => data[c]), adId];

  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

async function getAdUrlDestination(adId, url, status) {
  const sql = `
    SELECT quora_ad_id FROM quora_ad_url
    WHERE quora_ad_id = ? AND url_type = 'D' AND url = ? AND proxy_lander_status = ?
  `;
  const result = await executeQuery(sql, [adId, url, status]);
  return result;
}

async function insertAdUrl(data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO quora_ad_url (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, Object.values(data));
  return result.insertId;
}

async function updateAdUrl(adId, data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined);
  const sql = `UPDATE quora_ad_url SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE quora_ad_id = ? AND url_type = 'D'`;
  const params = [...cols.map(c => data[c]), adId];

  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

async function getAdOutgoingDetails(whereObj) {
  const cols = Object.keys(whereObj);
  const sql = `SELECT country_code, id FROM quora_ad_outgoing_links WHERE ${cols.map(c => `${c} = ?`).join(' AND ')}`;
  const result = await executeQuery(sql, Object.values(whereObj));
  return result;
}

async function insertAdOutgoing(data) {
  const cols = Object.keys(data);
  const sql = `INSERT INTO quora_ad_outgoing_links (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, Object.values(data));
  return result.insertId;
}

async function updateAdOutgoing(id, countryCode) {
  const sql = 'UPDATE quora_ad_outgoing_links SET country_code = ? WHERE id = ?';
  const result = await executeQuery(sql, [countryCode, id]);
  return result.affectedRows;
}

async function getHtmlLander(adId) {
  const sql = `SELECT id FROM quora_ad_html_lander_content WHERE quora_ad_id = ? LIMIT 1`;
  const result = await executeQuery(sql, [adId]);
  return result && result.length ? result[0] : null;
}

async function insertHtmlLander(data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined && typeof data[k] !== 'function');
  if (cols.length === 0) return null;
  const sql = `INSERT INTO quora_ad_html_lander_content (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  const result = await executeQuery(sql, cols.map(c => data[c]));
  return result.insertId;
}

async function updateHtmlLander(adId, data) {
  const cols = Object.keys(data).filter(k => data[k] !== undefined);
  const sql = `UPDATE quora_ad_html_lander_content SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE quora_ad_id = ?`;
  const params = [...cols.map(c => data[c]), adId];

  const result = await executeQuery(sql, params);
  return result.affectedRows;
}

async function getCountryCodeList(adId) {
  const sql = `SELECT DISTINCT country_code FROM quora_ad_url WHERE quora_ad_id = ? AND country_code IS NOT NULL`;
  const result = await executeQuery(sql, [adId]);
  return result;
}

async function getCountryNames(isoList) {
  if (!isoList || isoList.length === 0) return [];
  const placeholders = isoList.map(() => '?').join(',');
  const sql = `SELECT nicename FROM country_data WHERE iso IN (${placeholders})`;
  const result = await executeQuery(sql, isoList);
  return result;
}

module.exports = {
  getDataForLander,
  updateStatusByIds,
  getCountriesForAd,
  getDomainIdByDomain,
  insertDomain,
  updateDomain,
  updateAdDomainId,
  getAdMetaData,
  updateAdMetaData,
  getAdUrlDestination,
  insertAdUrl,
  updateAdUrl,
  getAdOutgoingDetails,
  insertAdOutgoing,
  updateAdOutgoing,
  getHtmlLander,
  insertHtmlLander,
  updateHtmlLander,
  getCountryCodeList,
  getCountryNames,
};
