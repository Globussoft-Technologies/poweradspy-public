'use strict';

/**
 * Adversuite API Controller — Node port of legacy PHP functions.
 *
 * Mirrors:
 *   - Userv2Controller.php@insert_free_plan — POST /insert_free_plan.
 *     Checks free_plan for an existing user_id row; returns Search_count +
 *     expiry_date if found, otherwise inserts a new row and returns the fresh
 *     select.
 *   - adsDataController.php@insert_user_data — GET/POST /insert_user_data.
 *     Upserts the caller's { user_id, email, updated_at } row in `user_socket`.
 *     Row exists → UPDATE email + updated_at; else → INSERT and return the id.
 *   - AdDetails.php@checkIfAdExists — POST /checkIfAdExists/{ad_id}.
 *     Returns whether a given facebook_ad.id exists in the `facebook_ad` table.
 *   - Userv2Controller.php@getLocation — GET/POST /getLocation.
 *     Returns the distinct list of countries from country_only.
 *   - Userv2Controller.php@getCalltoAction — GET/POST /getCalltoAction.
 *     Returns a hardcoded list of ad call-to-action labels (no DB read).
 *   - Userv2Controller.php@getAvailableTags — GET /get-available-tags.
 *     Returns the niche list from facebook_niche.
 *   - Userv2Controller.php@get_all_language — POST /get_all_language.
 *     Returns { iso, name } for every row in `languages` ordered by name.
 *
 * DB connection pattern matches hideAdsController: the route hands us
 * `service.db` ({ sql, elastic }) so the controller stays test-friendly and
 * consistent with every other Facebook controller.
 */

/**
 * PHP flow:
 *   1. SELECT Search_count, expiry_date FROM free_plan WHERE user_id = ?
 *   2. Row found (code 200) → return { code: 200, data: rows }
 *   3. No row (code 400)    → INSERT the request body; on success re-select
 *                             and return { code: 200, data: rows };
 *                             on failure return { code: 400, data: [] }
 */
async function insertFreePlan(req, db, logger) {
  try {
    const body = req.body || {};
    const userId = body.user_id;

    if (!userId) {
      return { code: 400, message: 'user_id is required', data: [] };
    }

    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: null };
    }

    // 1) SELECT existing free_plan row for this user
    const existing = await db.sql.query(
      'SELECT Search_count, expiry_date FROM free_plan WHERE user_id = ?',
      [userId]
    );

    if (Array.isArray(existing) && existing.length > 0) {
      return { code: 200, data: existing };
    }

    // 2) No row — INSERT. PHP forwards $request->all(); we restrict to the
    // free_plan columns actually used so a hostile client can't inject arbitrary columns.
    const insertPayload = { user_id: userId };
    const allowedCols = ['Search_count', 'expiry_date', 'status', 'facebook_user_id', 'created', 'updated'];
    for (const col of allowedCols) {
      if (body[col] !== undefined) insertPayload[col] = body[col];
    }

    const cols = Object.keys(insertPayload);
    const placeholders = cols.map(() => '?').join(', ');
    const values = cols.map((c) => insertPayload[c]);

    const insertResult = await db.sql.query(
      `INSERT INTO free_plan (${cols.join(', ')}) VALUES (${placeholders})`,
      values
    );

    const insertId = insertResult?.insertId ?? insertResult?.[0]?.insertId ?? 0;

    if (insertId > 0 || insertResult?.affectedRows > 0) {
      // Re-select so we return the same shape as the "row already exists" branch.
      const rows = await db.sql.query(
        'SELECT Search_count, expiry_date FROM free_plan WHERE user_id = ?',
        [userId]
      );
      return { code: 200, data: rows };
    }

    return { code: 400, data: [] };
  } catch (err) {
    logger.error('Error in insertFreePlan', { error: err.message });
    return { code: 401, message: err.message, data: null };
  }
}




/**
 * PHP adsDataController@insert_user_data flow:
 *   1. SELECT * FROM user_socket WHERE user_id = ?
 *   2. Row found (code 200) → UPDATE user_socket SET email=?, updated_at=? WHERE user_id=?
 *                             return the model's update result (json_encode of the update code/data)
 *   3. No row               → INSERT { user_id, email, updated_at } and return the insertId
 *
 * updated_at in PHP is time() (Unix seconds). We keep that so downstream code
 * that treats the column as an INT keeps working.
 */
async function insertUserData(req, db, logger) {
  try {
    // PHP allowed both GET and POST; body OR query params carry the fields.
    const src = { ...(req.query || {}), ...(req.body || {}) };
    const userId = src.user_id;
    const email = src.email;

    if (!userId) {
      return { code: 400, message: 'user_id is required', data: null };
    }

    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: null };
    }

    const updatedAt = Math.floor(Date.now() / 1000); // PHP time() = Unix seconds

    // 1) SELECT existing row for this user_id
    const existing = await db.sql.query(
      'SELECT * FROM user_socket WHERE user_id = ?',
      [userId]
    );

    if (Array.isArray(existing) && existing.length > 0) {
      // 2) Row exists → UPDATE email + updated_at (mirrors PHP updateUser_socket)
      const updateResult = await db.sql.query(
        'UPDATE user_socket SET email = ?, updated_at = ? WHERE user_id = ?',
        [email ?? null, updatedAt, userId]
      );
      const affected = updateResult?.affectedRows ?? updateResult?.[0]?.affectedRows ?? 0;

      if (affected > 0) {
        return { code: 200, message: 'data updated successfully', data: affected };
      }
      return { code: 400, message: 'data not updated', data: null };
    }

    // 3) No row → INSERT. `socket_id`, `paypal_id`, `paypal_id_list` are legacy
    // NOT NULL columns with no default — every existing row has them empty, so we
    // insert '' to satisfy the constraint. Accept client-supplied values if sent.
    const socketId = src.socket_id ?? '';
    const paypalId = src.paypal_id ?? '';
    const paypalIdList = src.paypal_id_list ?? '';
    const insertResult = await db.sql.query(
      'INSERT INTO user_socket (user_id, socket_id, email, paypal_id, paypal_id_list, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, socketId, email ?? null, paypalId, paypalIdList, updatedAt]
    );
    const insertId = insertResult?.insertId ?? insertResult?.[0]?.insertId ?? 0;

    if (insertId > 0 || insertResult?.affectedRows > 0) {
      // PHP returned just the id (json_encode($id)). We wrap it in the standard shape.
      return { code: 200, message: 'data inserted successfully', data: insertId };
    }

    return { code: 400, message: 'data not inserted', data: null };
  } catch (err) {
    logger.error('Error in insertUserData', { error: err.message });
    return { code: 401, message: err.message, data: null };
  }
}

/**
 * PHP AdDetails@checkIfAdExists flow:
 *   1. Read ad_id — PHP took it from BOTH the URL path (/checkIfAdExists/{ad_id}) AND
 *      the request body ($postData["ad_id"]). The body value was actually used for the
 *      lookup; the path param was accepted but not read. We accept either.
 *   2. SELECT * FROM facebook_ad WHERE facebook_ad.id = ?
 *   3. Row found (Facebook_ad::getAd returns code 200) → { code: 200, message: 'ad found', data: <row(s)> }
 *   4. No row                                          → { code: 402, message: 'No ad found', data: null }
 *
 * PHP wrapped the model's return object under `data.data`, so the response looks like:
 *   { code, message, data: { code, message, data: [row] } }
 * We preserve that shape so any existing consumer keeps working.
 */
async function checkIfAdExists(req, db, logger) {
  try {
    // PHP read ad_id from the body (`$postData["ad_id"]`). Path param is also accepted for URL-only callers.
    const adId = req.body?.ad_id ?? req.query?.ad_id ?? req.params?.ad_id;

    if (!adId) {
      return { code: 400, message: 'ad_id is required', data: null };
    }

    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: null };
    }

    // SELECT * FROM facebook_ad WHERE facebook_ad.id = ? — mirrors Facebook_ad::getAd
    const rows = await db.sql.query(
      'SELECT * FROM facebook_ad WHERE facebook_ad.id = ?',
      [adId]
    );

    if (Array.isArray(rows) && rows.length > 0) {
      // Preserve PHP's nested shape: outer envelope + Facebook_ad::getAd's envelope.
      return {
        code: 200,
        message: 'ad found',
        data: {
          code: 200,
          message: 'FacebookAd details.',
          data: rows,
        },
      };
    }

    return { code: 402, message: 'No ad found', data: null };
  } catch (err) {
    logger.error('Error in checkIfAdExists', { error: err.message });
    return { code: 401, message: err.message, data: null };
  }
}

/**
 * PHP Userv2Controller@getLocation flow:
 *   1. SELECT country FROM country_only WHERE 1 AND country IS NOT NULL
 *   2. Rows found → { code: 202, message: 'data retrieved successfully', data: rows }
 *      No rows     → { code: 400, message: 'no data found', data: [] }
 *      DB error    → { code: 401, message: <err>, data: [] }
 *
 * Note: PHP returns 202 (not 200) on success. Kept for parity so any consumer
 * checking `code === 202` keeps working.
 */
async function getLocation(req, db, logger) {
  try {
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: [] };
    }

    const rows = await db.sql.query(
      'SELECT country FROM country_only WHERE country IS NOT NULL'
    );

    if (Array.isArray(rows) && rows.length > 0) {
      return { code: 202, message: 'data retrieved successfully', data: rows };
    }
    return { code: 400, message: 'no data found', data: [] };
  } catch (err) {
    logger.error('Error in getLocation', { error: err.message });
    return { code: 401, message: err.message, data: [] };
  }
}

// Hardcoded CTA list — mirrors the PHP array verbatim so the frontend dropdown
// order is preserved. No DB read.
const CALL_TO_ACTIONS = [
  'Add', 'Add to Cart', 'Apply Now', 'Ask', 'Assist', 'Book Now', 'Buy', 'Buy Now',
  'Buy Tickets', 'Call', 'Call Now', 'Chat with Us', 'Check', 'Contact Us', 'Continue',
  'Contribute', 'Donate', 'Donate Now', 'Download', 'Email Now', 'Find More', 'Follow',
  'Get Access', 'Get Coupon', 'Get Deal', 'Get Directions', 'Get Offer', 'Get Quote',
  'Get Showtimes', 'Get Tickets', 'Get Trends', 'Get Your Code', 'Give Now', 'Go Now',
  'Go Shopping', 'Grab a bid', 'Hear', 'Install', 'Install App', 'Install Now',
  'Interested', 'Join', 'Know More', 'Learn More', 'Like Page', 'Like This Page',
  'Listen Now', 'Look More', 'Make an Order', 'Menu', 'Message', 'More', 'More on This',
  'Obtain Offer', 'Offer', 'Open Link', 'Order Now', 'Play Game', 'Play Now', 'Purchase',
  'Read', 'Register Now', 'Request Time', 'Reserve Now', 'Save', 'Save Offer', 'Schedule',
  'Search', 'See Details', 'See Menu', 'See More', 'Sell Now', 'Send', 'Send Message',
  'Shop Now', 'Sign Up', 'Start Order', 'Subscribe', 'try in camera', 'Try It',
  'turn on us', 'Use App', 'use the offer', 'View', 'View Event', 'Visit Website',
  'Vote Now', 'Watch More', 'Watch Others', 'Watch Video',
];

/**
 * PHP Userv2Controller@getCalltoAction — returns the static CTA list wrapped as
 * [{ action: '<label>' }, ...] with code 202. No DB read.
 */
async function getCalltoAction(req, db, logger) {
  try {
    return {
      code: 202,
      message: 'data retrieved successfully',
      data: CALL_TO_ACTIONS.map((action) => ({ action })),
    };
  } catch (err) {
    logger.error('Error in getCalltoAction', { error: err.message });
    return { code: 401, message: err.message, data: [] };
  }
}

/**
 * PHP Userv2Controller@getAvailableTags flow:
 *   1. SELECT niche FROM facebook_niche
 *   2. Any result (even []) → { code: 200, message: 'Niche data fetched', data: rows }
 *      (PHP's `if ($tagsData)` treats an empty Collection as truthy, so the
 *      400 branch is only reachable via exception.)
 *   3. Exception → { code: 400, message: 'Exception: in getAvailableTags function' }
 */
async function getAvailableTags(req, db, logger) {
  try {
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: null };
    }

    const rows = await db.sql.query('SELECT niche FROM facebook_niche');
    return { code: 200, message: 'Niche data fetched', data: rows || [] };
  } catch (err) {
    logger.error('Error in getAvailableTags', { error: err.message });
    return { code: 400, message: 'Exception: in getAvailableTags function' };
  }
}

/**
 * PHP Userv2Controller@get_all_language flow:
 *   SELECT iso, name FROM languages ORDER BY name
 *   Returns the raw array directly (no envelope). We preserve that shape.
 */
async function getAllLanguage(req, db, logger) {
  try {
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: [] };
    }

    const rows = await db.sql.query('SELECT iso, name FROM languages ORDER BY name');
    // PHP returned the raw array directly — no { code, data } envelope.
    return rows || [];
  } catch (err) {
    logger.error('Error in getAllLanguage', { error: err.message });
    return { code: 401, message: err.message, data: [] };
  }
}

module.exports = {
  insertFreePlan,
  insertUserData,
  checkIfAdExists,
  getLocation,
  getCalltoAction,
  getAvailableTags,
  getAllLanguage,
};
