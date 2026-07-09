'use strict';

/**
 * Instagram Adversuite API Controller — Node port of legacy PHP endpoints.
 *
 * Mirrors:
 *   - UserController.php@getLocation (api_instagram) — GET/POST /getLocation.
 *     Returns the distinct list of countries from `instagram_country_only`.
 *
 * DB connection pattern matches every other Instagram controller: the route
 * hands us `service.db` ({ sql, elastic }).
 */

/**
 * PHP UserController@getLocation flow:
 *   1. SELECT country FROM instagram_country_only WHERE country != ""
 *   2. Rows → { code: 202, message: 'data retrieved successfully', data: rows }
 *      Empty → { code: 400, message: 'no data found', data: [] }
 *      Error → { code: 401, message: <err>, data: [] }
 *
 * Note: PHP returns 202 (not 200) on success. Preserved for parity.
 */
async function getLocation(req, db, logger) {
  try {
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: [] };
    }

    const rows = await db.sql.query(
      "SELECT country FROM instagram_country_only WHERE country != ''"
    );

    if (Array.isArray(rows) && rows.length > 0) {
      return { code: 202, message: 'data retrieved successfully', data: rows };
    }
    return { code: 400, message: 'no data found', data: [] };
  } catch (err) {
    logger.error('Error in getLocation (instagram)', { error: err.message });
    return { code: 401, message: err.message, data: [] };
  }
}

module.exports = { getLocation };
