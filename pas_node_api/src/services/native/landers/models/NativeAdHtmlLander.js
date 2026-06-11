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

class NativeAdHtmlLander {
  static async insertHtmlContent(adId, htmlContent, status) {
    const column = status === 1 ? 'html_res_blackhat_lander_text' : 'html_whitehat_lander_text';
    const sql = `
      INSERT INTO native_ad_html_lander_content (native_ad_id, ${column})
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE ${column} = ?
    `;
    await executeQuery(sql, [adId, htmlContent, htmlContent]);
  }
}

module.exports = NativeAdHtmlLander;
