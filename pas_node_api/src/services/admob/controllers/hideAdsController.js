'use strict';

/**
 * AdMob hide / favourite storage.
 * Mirrors the same API shape used by other networks, but stores state in the
 * AdMob-specific `mob_hidden_ads` table under `pasdev_admob`.
 */

function normalizeAdId(value) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str : null;
}

async function hideAds(req, db, logger) {
  try {
    const { user_id, post_owner_id, ad_id, type } = req.body || {};
    const hideType = parseInt(type, 10);

    if (!user_id || !hideType) {
      return { code: 400, message: 'Missing required params: user_id, type' };
    }
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available' };
    }

    const normalizedAdId = normalizeAdId(ad_id);

    if (hideType === 1) {
      if (!post_owner_id) return { code: 400, message: 'Missing post_owner_id for type=1' };
      try {
        await db.sql.query(
          'DELETE FROM mob_hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 3',
          [user_id, post_owner_id]
        );
      } catch (err) {
        logger.warn('Auto-unfavorite advertiser ads on hide failed', { error: err.message });
      }
    }

    if ((hideType === 2 || hideType === 3) && normalizedAdId) {
      try {
        await db.sql.query(
          'DELETE FROM mob_hidden_ads WHERE user_id = ? AND ad_id = ? AND type = 3',
          [user_id, normalizedAdId]
        );
      } catch (err) {
        logger.warn('Auto-unfavorite on hide failed', { error: err.message });
      }
    }

    if (hideType === 2 || hideType === 3) {
      if (!normalizedAdId) return { code: 400, message: 'Missing ad_id for type=2/3' };
    }

    const result = await db.sql.query(
      `INSERT INTO mob_hidden_ads (user_id, post_owner_id, ad_id, type)
       VALUES (?, ?, ?, ?)`,
      [user_id, post_owner_id || null, normalizedAdId, hideType]
    );

    if (result.insertId > 0) {
      return { code: 200, message: 'data inserted successfully', data: result.insertId };
    }
    return { code: 400, message: 'data not inserted', data: null };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      return { code: 200, message: 'already hidden/favourited', data: 0 };
    }
    logger.error('Error in AdMob hideAds', { error: err.message });
    return { code: 500, message: err.message, data: null };
  }
}

async function getHiddenPostOwners(req, db, logger) {
  try {
    const { user_id } = req.body || {};

    if (!user_id) {
      return { code: 400, message: 'Missing required param: user_id' };
    }
    if (!db.sql) {
      return { code: 503, message: 'SQL connection not available' };
    }

    const rows = await db.sql.query(
      'SELECT post_owner_id, ad_id, type FROM mob_hidden_ads WHERE user_id = ?',
      [user_id]
    );

    if (!rows || rows.length === 0) {
      return { code: 200, message: 'no data found', data: [], addata: [], favorite: [] };
    }

    const postOwnerArray = [];
    const adIdArray = [];
    const favorite = [];

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
    logger.error('Error in getHiddenPostOwners (AdMob)', { error: err.message });
    return { code: 500, message: 'Error occurred in getHiddenPostOwners', data: null };
  }
}

async function unHide(req, db, logger) {
  try {
    const { user_id, post_owner_id, ad_id, type } = req.body || {};
    const hideType = parseInt(type, 10);

    if (!user_id || !hideType) {
      return { code: 400, message: 'Missing required params: user_id, type' };
    }
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const normalizedAdId = normalizeAdId(ad_id);
    let sql;
    let params;

    if (hideType === 1) {
      if (!post_owner_id) return { code: 400, message: 'Missing post_owner_id for type=1' };
      sql = 'DELETE FROM mob_hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 1';
      params = [user_id, post_owner_id];
    } else if (hideType === 2 || hideType === 3) {
      if (!normalizedAdId) return { code: 400, message: 'Missing ad_id for type=2/3' };
      sql = 'DELETE FROM mob_hidden_ads WHERE user_id = ? AND ad_id = ? AND type = ?';
      params = [user_id, normalizedAdId, hideType];
    } else {
      return { code: 400, message: 'Unsupported hide type' };
    }

    const result = await db.sql.query(sql, params);
    if ((result.affectedRows ?? 0) > 0) {
      return { code: 200, message: 'data deleted successfully', data: result.affectedRows };
    }
    return { code: 200, message: 'already not hidden/favourited', data: 0 };
  } catch (err) {
    logger.error('Error in unHide (AdMob)', { error: err.message });
    return { code: 500, message: err.message, data: null };
  }
}

module.exports = { hideAds, getHiddenPostOwners, unHide };
