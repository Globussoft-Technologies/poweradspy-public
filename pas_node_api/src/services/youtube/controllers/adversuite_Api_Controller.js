'use strict';

/**
 * YouTube Adversuite API Controller — Node port of legacy PHP endpoints.
 *
 * Mirrors:
 *   - UserController.php@getLocation (api_youtube) — GET/POST /getLocation.
 *     Returns the distinct list of countries from `youtube_country_only`.
 *   - UserController.php@getCallToActions (api_youtube) — GET/POST /get-call-to-actions.
 *     Returns a hardcoded list of ad call-to-action labels (no DB read). Note the
 *     PHP list is SHORTER than the Facebook one (60 items vs 88).
 *
 * DB connection pattern matches every other YouTube controller: the route
 * hands us `service.db` ({ sql, elastic }).
 */

/**
 * PHP UserController@getLocation flow:
 *   1. SELECT DISTINCT country FROM youtube_country_only WHERE country IS NOT NULL
 *   2. Rows found → { code: 202, message: 'data retrieved successfully', data: rows }
 *   3. Otherwise  → { code: 400, message: 'no data found', data: [] }
 */
async function getLocation(req, db, logger) {
  try {
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available', data: [] };
    }

    const rows = await db.sql.query(
      'SELECT DISTINCT country FROM youtube_country_only WHERE country IS NOT NULL'
    );

    if (Array.isArray(rows) && rows.length > 0) {
      return { code: 202, message: 'data retrieved successfully', data: rows };
    }
    return { code: 400, message: 'no data found', data: [] };
  } catch (err) {
    logger.error('Error in getLocation (youtube)', { error: err.message });
    return { code: 401, message: err.message, data: [] };
  }
}

// Hardcoded CTA list — YouTube-specific (60 items, shorter than Facebook's 88).
// Copied verbatim from api_youtube/UserController.php@getCallToActions.
const YOUTUBE_CALL_TO_ACTIONS = [
  'Add', 'Apply Now', 'Book Now', 'Buy Now', 'Buy Tickets', 'Call', 'Call Now',
  'Check', 'Contact Us', 'Continue', 'Contribute', 'Directions', 'Donate',
  'Donate Now', 'Download', 'Email Now', 'Find More', 'Follow', 'Get Access',
  'Get Coupon', 'Get Deal', 'Get Offer', 'Get Quote', 'Get Tickets', 'Give Now',
  'Go Now', 'Install', 'Install Now', 'Interested', 'Join', 'Know More',
  'Learn More', 'Like Page', 'Listen Now', 'Look More', 'Menu', 'Message',
  'More', 'More on This', 'Open Link', 'Order Now', 'Play Game', 'Play Now',
  'Purchase', 'Schedule', 'Search', 'See Menu', 'See More', 'Sell Now', 'Send',
  'Shop Now', 'Sign Up', 'Subscribe', 'Try It', 'Use App', 'View', 'View Event',
  'Visit Website', 'Vote Now', 'Watch More',
];

/**
 * PHP UserController@getCallToActions — returns the static CTA list wrapped as
 * [{ action: '<label>' }, ...] with code 202.
 * PHP uses key `msg` (not `message`) — preserved for compatibility.
 */
async function getCallToActions(req, db, logger) {
  try {
    return {
      code: 202,
      msg: 'data retrieved successfully',
      data: YOUTUBE_CALL_TO_ACTIONS.map((action) => ({ action })),
    };
  } catch (err) {
    logger.error('Error in getCallToActions (youtube)', { error: err.message });
    return { code: 401, msg: err.message, data: [] };
  }
}

module.exports = { getLocation, getCallToActions };
