'use strict';

/**
 * Google Adversuite API Controller — Node port of legacy PHP endpoints.
 *
 * Mirrors:
 *   - UserController.php@getLocation (api_gtext) — GET/POST /getLocation.
 *     Returns the distinct list of countries from `google_text_country_only`.
 *
 * DB connection pattern matches every other Google controller: the route
 * hands us `service.db` ({ sql, elastic }).
 */

/**
 * PHP UserController@getLocation flow:
 *   1. SELECT DISTINCT country FROM google_text_country_only WHERE country IS NOT NULL
 *   2. Rows found → { code: 202, message: 'data retrieved successfully', data: rows }
 *   3. Otherwise  → { code: 400, message: 'no data found', data: [] }
 */
async function getLocation(req, db, logger) {
  try {
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: [] };
    }

    const rows = await db.sql.query(
      'SELECT DISTINCT country FROM google_text_country_only WHERE country IS NOT NULL'
    );

    if (Array.isArray(rows) && rows.length > 0) {
      return { code: 202, message: 'data retrieved successfully', data: rows };
    }
    return { code: 400, message: 'no data found', data: [] };
  } catch (err) {
    logger.error('Error in getLocation (google)', { error: err.message });
    return { code: 401, message: err.message, data: [] };
  }
}

module.exports = { getLocation };
