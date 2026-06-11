'use strict';

/**
 * Pinterest hide/favorite ads controller.
 * Uses pinterest_hidden_ads table.
 * type=1 → hidden advertiser (post_owner_id)
 * type=2 → hidden ad (ad_id)
 * type=3 → favorite ad (ad_id)
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
          'DELETE FROM pinterest_hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 3',
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
          'DELETE FROM pinterest_hidden_ads WHERE user_id = ? AND ad_id = ? AND type = 3',
          [user_id, ad_id]
        );
      } catch (err) {
        logger.warn('Auto-unfavorite on hide failed', { error: err.message });
      }
    }

    const result = await db.sql.query(
      `INSERT INTO pinterest_hidden_ads (user_id, post_owner_id, ad_id, type)
       VALUES (?, ?, ?, ?)`,
      [user_id, post_owner_id || null, ad_id || null, type]
    );

    const insertId = result.insertId;
    if (insertId > 0) {
      return { code: 200, message: 'data inserted successfully', data: insertId };
    }
    return { code: 400, message: 'data not inserted', data: null };

  } catch (err) {
    logger.error('Error in Pinterest hideAds', { error: err.message });
    return { code: 401, message: err.message, data: null };
  }
}

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
      'SELECT post_owner_id, ad_id, type FROM pinterest_hidden_ads WHERE user_id = ?',
      [user_id]
    );

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'no data found', data: null, addata: null, favorite: null };
    }

    const postOwnerArray = [];
    const adIdArray      = [];
    const favorite       = [];

    for (const row of rows) {
      if (row.type === 1)      postOwnerArray.push(row.post_owner_id);
      else if (row.type === 2) adIdArray.push(row.ad_id);
      else if (row.type === 3) favorite.push(row.ad_id);
    }

    return {
      code: 200,
      message: 'data retrieved',
      data: postOwnerArray,
      addata: adIdArray,
      favorite,
    };
  } catch (err) {
    logger.error('Error in Pinterest getHiddenPostOwners', { error: err.message });
    return { code: 401, message: 'Error occurred in getHiddenPostOwners', data: null };
  }
}

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
      sql    = 'DELETE FROM pinterest_hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 1';
      params = [user_id, post_owner_id];
    } else if (t === 2 || t === 3) {
      if (!ad_id) return { code: 400, message: 'Missing ad_id for type=2/3' };
      sql    = 'DELETE FROM pinterest_hidden_ads WHERE user_id = ? AND ad_id = ? AND type = ?';
      params = [user_id, ad_id, t];
    } else {
      return { code: 400, message: 'Invalid type. Must be 1, 2, or 3' };
    }

    const result   = await db.sql.query(sql, params);
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
    logger.error('Error in Pinterest unHide', { error: err.message });
    return { code: 500, message: 'Error in Pinterest unHide', error: err.message };
  }
}

module.exports = { hideAds, getHiddenPostOwners, unHide };
