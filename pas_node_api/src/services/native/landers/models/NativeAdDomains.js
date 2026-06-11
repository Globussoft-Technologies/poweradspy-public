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

class NativeAdDomains {
  static async getOrCreate(domain, registeredDate) {
    const checkSql = `SELECT id FROM native_ad_domains WHERE domain = ?`;
    const result = await executeQuery(checkSql, [domain]);
    if (result.length > 0) return result[0].id;

    const insertSql = `INSERT INTO native_ad_domains (domain, domain_registered_date) VALUES (?, ?)`;
    const insertResult = await executeQuery(insertSql, [domain, registeredDate || new Date().toISOString().split('T')[0]]);
    return insertResult.insertId;
  }
}

module.exports = NativeAdDomains;
