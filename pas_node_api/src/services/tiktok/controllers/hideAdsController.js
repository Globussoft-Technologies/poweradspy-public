'use strict';

/**
 * Insert a hide/favorite record into the  hide_favourite_ads table.
 * Mirrors Facebook hideAdsController structure.
 *
 * type=1 → hide advertiser (post_owner_id)
 * type=2 → hide ad        (ad_id)
 * type=3 → favorite ad    (ad_id)
 */
async function hideAds(req, db, logger) {
  try {
    const { user_id, post_owner_id, ad_id, type } = req.body;

    if (!user_id || !type) {
      return { code: 400, message: 'Missing required params: user_id, type' };
    }

    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available' };
    }

    // If the user hides an advertiser (type=1), unfavourite all of that
    // advertiser's ads too, so none linger in the Favourites section.
    if (parseInt(type, 10) === 1 && post_owner_id) {
      try {
        await db.sql.query(
          'DELETE FROM hide_favourite_ads WHERE user_id = ? AND post_owner_id = ? AND type = 3',
          [user_id, post_owner_id]
        );
      } catch (err) {
        logger.warn('Auto-unfavorite advertiser ads on hide failed', { error: err.message });
      }
    }

    // If the user is hiding an ad (type=2) they had previously favorited (type=3),
    // auto-unfavorite it so the ad shows only in the hidden section, not both.
    if (parseInt(type, 10) === 2 && ad_id) {
      try {
        await db.sql.query(
          'DELETE FROM hide_favourite_ads WHERE user_id = ? AND ad_id = ? AND type = 3',
          [user_id, ad_id]
        );
      } catch (err) {
        logger.warn('Auto-unfavorite on hide failed', { error: err.message });
      }
    }

    // Check for existing record to avoid duplicates (table has no unique constraint)
    const existing = await db.sql.query(
      'SELECT id FROM hide_favourite_ads WHERE user_id = ? AND ad_id = ? AND type = ? LIMIT 1',
      [user_id, ad_id || null, type]
    );
    if (existing && existing.length > 0) {
      return { code: 200, message: 'data inserted successfully', data: existing[0].id };
    }

    const result = await db.sql.query(
      `INSERT INTO hide_favourite_ads (user_id, post_owner_id, ad_id, type, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [user_id, post_owner_id || null, ad_id || null, type]
    );

    const insertId = result.insertId;

    if (insertId > 0) {
      return { code: 200, message: 'data inserted successfully', data: insertId };
    }
    return { code: 400, message: 'data not inserted', data: null };

  } catch (err) {
    logger.error('Error in hideAds (tiktok)', { error: err.message });
    return { code: 500, message: err.message, data: null };
  }
}

/**
 * Get hidden post owners, hidden ads, and favorites for a user.
 * Mirrors Facebook getHiddenPostOwners structure.
 */
async function getHiddenPostOwners(req, db, logger) {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return { code: 400, message: 'Missing required param: user_id' };
    }

    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available' };
    }

    const rows = await db.sql.query(
      'SELECT post_owner_id, ad_id, type FROM  hide_favourite_ads WHERE user_id = ?',
      [user_id]
    );

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'no data found', data: null, addata: null, favorite: null };
    }

    const postOwnerArray = []; // type=1: hidden advertisers
    const adIdArray = [];      // type=2: hidden ads
    const favorite = [];       // type=3: favorite ads

    for (const row of rows) {
      if (row.type === 1) {
        postOwnerArray.push(row.post_owner_id);
      } else if (row.type === 2) {
        adIdArray.push(row.ad_id);
      } else if (row.type === 3) {
        favorite.push(row.ad_id);
      }
    }

    return {
      code: 200,
      message: 'data retrieved',
      data: postOwnerArray,
      addata: adIdArray,
      favorite,
    };

  } catch (err) {
    logger.error('Error in getHiddenPostOwners (tiktok)', { error: err.message });
    return { code: 500, message: 'Error occurred in getHiddenPostOwners', data: null };
  }
}

/**
 * Un-hide or un-favorite an ad.
 * Mirrors Facebook unHide structure.
 *
 * type=1 → un-hide advertiser (needs post_owner_id)
 * type=2 → un-hide ad        (needs ad_id)
 * type=3 → un-favorite ad    (needs ad_id)
 */
async function unHide(req, db, logger) {
  try {
    const { user_id, post_owner_id, ad_id, type } = req.body;

    if (!user_id || !type) {
      return { code: 400, message: 'Missing required params: user_id, type' };
    }
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const t = parseInt(type, 10);
    let sql, params;

    if (t === 1) {
      if (!post_owner_id) return { code: 400, message: 'Missing post_owner_id for type=1' };
      sql = 'DELETE FROM  hide_favourite_ads WHERE user_id = ? AND post_owner_id = ? AND type = 1';
      params = [user_id, post_owner_id];
    } else if (t === 2 || t === 3) {
      if (!ad_id) return { code: 400, message: 'Missing ad_id for type=2/3' };
      sql = 'DELETE FROM  hide_favourite_ads WHERE user_id = ? AND ad_id = ? AND type = ?';
      params = [user_id, ad_id, t];
    } else {
      return { code: 400, message: 'Invalid type. Must be 1, 2, or 3' };
    }

    const result = await db.sql.query(sql, params);
    const affected = result?.affectedRows ?? 0;

    if (affected > 0) {
      return { code: 200, message: 'data deleted successfully', data: affected };
    }
    // Un-favouriting is idempotent: the row may already be gone because the ad
    // (or its advertiser) was auto-unfavourited when hidden. Treat that as
    // success so the UI doesn't show a spurious "failed to update favourite".
    if (t === 3) {
      return { code: 200, message: 'already not favourited', data: 0 };
    }
    return { code: 400, message: 'data not deleted', data: null };

  } catch (err) {
    logger.error('Error in unHide (tiktok)', { error: err.message });
    return { code: 500, message: 'Error in unHide', error: err.message };
  }
}

module.exports = { hideAds, getHiddenPostOwners, unHide };
