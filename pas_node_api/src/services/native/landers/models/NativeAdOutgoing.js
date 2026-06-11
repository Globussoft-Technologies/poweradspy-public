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

class NativeAdOutgoing {
  static async processOutgoingUrls(adId, outgoingUrls, countryIso) {
    if (!outgoingUrls || outgoingUrls.length === 0) return;

    for (const urlObj of outgoingUrls) {
      // Handle redirect_urls array - insert each one
      const redirectUrls = urlObj.redirect_urls || urlObj.redirectUrls || [];
      const destinationUrl = urlObj.destination_url || urlObj.destinationUrl || null;

      for (const redirectUrl of redirectUrls) {
        const sql = `
          INSERT INTO native_ad_outgoing_links (native_ad_id, source_url, redirect_url, final_url, country_code, proxy_lander_status)
          VALUES (?, ?, ?, ?, ?, ?)
        `;
        await executeQuery(sql, [
          adId,
          destinationUrl || null,
          redirectUrl || null,
          destinationUrl || null,
          countryIso ? countryIso.join('|') : null,
          0  // default proxy_lander_status
        ]);
      }
    }
  }
}

module.exports = NativeAdOutgoing;
