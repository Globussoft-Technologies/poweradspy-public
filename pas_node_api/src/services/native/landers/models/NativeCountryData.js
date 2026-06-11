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

class NativeCountryData {
  static async getIsoByCountryName(countryName) {
    const sql = `SELECT iso FROM country_data WHERE nicename = ?`;
    const result = await executeQuery(sql, [countryName]);
    return result.length > 0 ? result[0].iso : null;
  }

  static async getIsoByMultipleCountries(countryNames) {
    if (!Array.isArray(countryNames) || countryNames.length === 0) {
      return [];
    }

    const placeholders = countryNames.map(() => '?').join(',');
    const sql = `SELECT DISTINCT iso FROM country_data WHERE nicename IN (${placeholders})`;

    const result = await executeQuery(sql, countryNames);
    return result.map((row) => row.iso);
  }

  static async batchGetIso(countryNames) {
    if (!Array.isArray(countryNames) || countryNames.length === 0) {
      return new Map();
    }

    const isoMap = new Map();

    for (const countryName of countryNames) {
      const iso = await this.getIsoByCountryName(countryName);
      if (iso) {
        isoMap.set(countryName, iso);
      }
    }

    return isoMap;
  }
}

module.exports = NativeCountryData;
