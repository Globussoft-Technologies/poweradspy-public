const databaseManager = require('../../../../database/DatabaseManager');

async function executeQuery(sql, params = []) {
  const pool = databaseManager.getSQL('native');
  const connection = await pool.getConnection();
  try {
    const [results] = await connection.execute(sql, params);
    return results;
  } finally {
    connection.release();
  }
}

class NativeAdUrl {
  static async insertMultipleUrls(adId, redirectUrls, destinationUrl, countryIso) {
    // Insert redirect URLs
    for (const redirectUrl of redirectUrls) {
      const sql = `
        INSERT INTO native_ad_url (native_ad_id, url_type, url, type, country_code, proxy_lander_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      await executeQuery(sql, [
        adId,
        'R',  // redirect
        redirectUrl || null,
        0,    // type integer
        countryIso ? (Array.isArray(countryIso) ? countryIso[0] : countryIso) : null,
        0     // proxy_lander_status default
      ]);
    }

    // Insert destination URL
    if (destinationUrl) {
      const destSql = `
        INSERT INTO native_ad_url (native_ad_id, url_type, url, type, country_code, proxy_lander_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      await executeQuery(destSql, [
        adId,
        'D',  // destination
        destinationUrl || null,
        0,    // type integer
        countryIso ? (Array.isArray(countryIso) ? countryIso[0] : countryIso) : null,
        0     // proxy_lander_status default
      ]);
    }
  }
}

module.exports = NativeAdUrl;
