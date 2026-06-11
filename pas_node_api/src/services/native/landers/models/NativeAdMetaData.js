const databaseManager = require('../../../../database/DatabaseManager');

// Helper to execute queries (using DatabaseManager directly)
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

class NativeAdMetaData {
  // Get all ads with status = 0 (pending)
  static async getAdsByStatus(status) {
    const sql = `
      SELECT
        native_ad_meta_data.native_ad_id as id,
        MAX(native_ad_meta_data.destination_url) as destination_url,
        GROUP_CONCAT(native_country_only.country) as countries
      FROM native_ad_meta_data
      LEFT JOIN native_ad ON native_ad.id = native_ad_meta_data.native_ad_id
      LEFT JOIN native_country_only ON native_country_only.id = native_ad.country_only_id
      WHERE native_ad_meta_data.redirect_status = ?
      GROUP BY native_ad_meta_data.native_ad_id
      ORDER BY native_ad_meta_data.native_ad_id DESC
      LIMIT 100
    `;
    const result = await executeQuery(sql, [status]);
    return result;
  }

  // Update redirect status
  static async updateRedirectStatus(adId, status) {
    const sql = `
      UPDATE native_ad_meta_data
      SET redirect_status = ?
      WHERE native_ad_id = ?
    `;
    const result = await executeQuery(sql, [status, adId]);
    return result.affectedRows > 0;
  }

  // Batch update redirect statuses
  static async batchUpdateRedirectStatus(updates) {
    if (!updates || updates.length === 0) {
      return;
    }

    // Build CASE statement for batch update
    const adIds = updates.map(u => u.adId);
    const caseStatement = updates
      .map(u => `WHEN ${u.adId} THEN ${u.status}`)
      .join(' ');

    const sql = `
      UPDATE native_ad_meta_data
      SET redirect_status = CASE native_ad_id
        ${caseStatement}
      END
      WHERE native_ad_id IN (${adIds.map(() => '?').join(',')})
    `;

    return await executeQuery(sql, adIds);
  }

  // Get metadata details for an ad
  static async getMetaDataDetails(adId) {
    const sql = `
      SELECT
        native_ad_id as id,
        white_ad_screenshot,
        png_file,
        white_ad_lander,
        blackhat_path,
        blackhat_status,
        white_ad_status
      FROM native_ad_meta_data
      WHERE native_ad_id = ?
    `;
    const result = await executeQuery(sql, [adId]);
    return result;
  }

  // Update multiple fields
  static async updateData(adId, data) {
    const fields = [];
    const values = [];

    // Build dynamic UPDATE query - skip domain_id (goes to native_ad table)
    if (data.redirect_status !== undefined) {
      fields.push('redirect_status = ?');
      values.push(data.redirect_status);
    }
    if (data.outgoing_status !== undefined) {
      fields.push('outgoing_status = ?');
      values.push(data.outgoing_status);
    }
    if (data.white_ad_screenshot !== undefined) {
      fields.push('white_ad_screenshot = ?');
      values.push(JSON.stringify(data.white_ad_screenshot));
    }
    if (data.white_ad_lander !== undefined) {
      fields.push('white_ad_lander = ?');
      values.push(JSON.stringify(data.white_ad_lander));
    }
    if (data.white_lander_date !== undefined) {
      fields.push('white_lander_date = ?');
      values.push(data.white_lander_date);
    }
    if (data.png_file !== undefined) {
      fields.push('png_file = ?');
      values.push(JSON.stringify(data.png_file));
    }
    if (data.blackhat_path !== undefined) {
      fields.push('blackhat_path = ?');
      values.push(JSON.stringify(data.blackhat_path));
    }
    if (data.blackhat_date !== undefined) {
      fields.push('blackhat_date = ?');
      values.push(data.blackhat_date);
    }
    if (data.white_ad_status !== undefined) {
      fields.push('white_ad_status = ?');
      values.push(data.white_ad_status);
    }
    if (data.blackhat_status !== undefined) {
      fields.push('blackhat_status = ?');
      values.push(data.blackhat_status);
    }

    if (fields.length === 0) return false;

    values.push(adId);
    const sql = `UPDATE native_ad_meta_data SET ${fields.join(', ')} WHERE native_ad_id = ?`;

    const result = await executeQuery(sql, values);
    return result.affectedRows > 0;
  }
}

module.exports = NativeAdMetaData;
