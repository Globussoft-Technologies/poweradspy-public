'use strict';
/**
 * Insert a hide/favorite record into the hidden_ads table.
 * Mirrors PHP hide_ads() 
 *
 * @param {Object} req    - Express request (body: user_id, post_owner_id, ad_id, type)
 * @param {Object} db     - { sql, elastic }
 * @param {Object} logger - service logger
 * @returns {Object}      - { code, message, data }
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
        const favRows = await db.sql.query(
          'SELECT ad_id FROM hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 3',
          [user_id, post_owner_id]
        );
        if (db.elastic) {
          for (const row of favRows || []) {
            if (!row.ad_id) continue;
            const esResult = await db.elastic.search({
              index: 'facebook_ad_recommended_activity',
              body: {
                query: {
                  bool: {
                    must: [
                      { match: { ad_id: row.ad_id } },
                      { match: { user_id } },
                      { match: { activity: 2 } },
                    ],
                  },
                },
              },
            });
            const hits = esResult.hits || esResult.body?.hits;
            if (hits?.hits?.length > 0) {
              await db.elastic.delete({
                index: 'facebook_ad_recommended_activity',
                id: hits.hits[0]._id,
              });
            }
          }
        }
        await db.sql.query(
          'DELETE FROM hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 3',
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
          'DELETE FROM hidden_ads WHERE user_id = ? AND ad_id = ? AND type = 3',
          [user_id, ad_id]
        );
        if (db.elastic) {
          const esResult = await db.elastic.search({
            index: 'facebook_ad_recommended_activity',
            body: {
              query: {
                bool: {
                  must: [
                    { match: { ad_id } },
                    { match: { user_id } },
                    { match: { activity: 2 } },
                  ],
                },
              },
            },
          });
          const hits = esResult.hits || esResult.body?.hits;
          if (hits?.hits?.length > 0) {
            await db.elastic.delete({
              index: 'facebook_ad_recommended_activity',
              id: hits.hits[0]._id,
            });
          }
        }
      } catch (err) {
        logger.warn('Auto-unfavorite on hide failed', { error: err.message });
      }
    }

    let lcs_status = 0;

    // For favorites (type=3), check ad_position + ad_url to set lcs_status
    if (parseInt(type) === 3 && ad_id) {
      try {
        const [adData] = await db.sql.query(
          `SELECT facebook_ad.ad_position, facebook_ad_meta_data.ad_url
           FROM facebook_ad
           JOIN facebook_ad_meta_data ON facebook_ad_meta_data.facebook_ad_id = facebook_ad.id
           WHERE facebook_ad.id = ?`,
          [ad_id]
        );
        if (adData) {
          lcs_status = (adData.ad_position === 'FEED' && adData.ad_url) ? 1 : 2;
        }
      } catch (err) {
        logger.warn('Could not fetch ad data for lcs_status', { error: err.message });
      }
    }

    // Insert into hidden_ads table
    const result = await db.sql.query(
      `INSERT INTO hidden_ads (user_id, post_owner_id, ad_id, type, lcs_status)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, post_owner_id || null, ad_id || null, type, lcs_status]
    );

    const insertId = result.insertId;

    if (insertId > 0) {
      return { code: 200, message: 'data inserted successfully', data: insertId };
    }
    return { code: 400, message: 'data not inserted', data: null };

  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      // Already hidden/favourited (double-click, stale UI state, retry) — idempotent success,
      // not an error. Returning 401 here would trip the frontend's session-expired handler
      // and force-logout the user over a harmless duplicate click.
      return { code: 200, message: 'already hidden/favourited', data: 0 };
    }
    logger.error('Error in hideAds', { error: err.message });
    return { code: 500, message: err.message, data: null };
  }
}

/**
 * Get hidden post owners, hidden ads, and favorites for a user.
 * Mirrors PHP getHiddenPostOwners() - Userv2Controller.php:5994
 *
 * @param {Object} req    - Express request (body: user_id)
 * @param {Object} db     - { sql, elastic }
 * @param {Object} logger - service logger
 * @returns {Object}      - { code, message, data, addata, favorite }
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
      'SELECT post_owner_id, ad_id, type FROM hidden_ads WHERE user_id = ?',
      [user_id]
    );

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'no data found', data: null, addata: null, favorite: null };
    }

    // Separate by type (matches PHP logic)
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
    logger.error('Error in getHiddenPostOwners', { error: err.message });
    return { code: 500, message: 'Error occurred in getHiddenPostOwners', data: null };
  }
}

/**
 * Un-hide or un-favorite an ad.
 * Mirrors PHP Userv2Controller@unHide
 *
 * type=1 → un-hide advertiser (needs post_owner_id)
 * type=2 → un-hide ad (needs ad_id)
 * type=3 → un-favorite ad (needs ad_id) + cleans up ES recommended activity
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
      sql = 'DELETE FROM hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 1';
      params = [user_id, post_owner_id];
    } else if (t === 2 || t === 3) {
      if (!ad_id) return { code: 400, message: 'Missing ad_id for type=2/3' };
      sql = 'DELETE FROM hidden_ads WHERE user_id = ? AND ad_id = ? AND type = ?';
      params = [user_id, ad_id, t];

      // For unfavorite (type=3), clean up recommended activity in ES
      if (t === 3 && db.elastic) {
        try {
          const esResult = await db.elastic.search({
            index: 'facebook_ad_recommended_activity',
            body: {
              query: {
                bool: {
                  must: [
                    { match: { ad_id } },
                    { match: { user_id } },
                    { match: { activity: 2 } },
                  ],
                },
              },
            },
          });
          const hits = esResult.hits || esResult.body?.hits;
          if (hits?.hits?.length > 0) {
            await db.elastic.delete({
              index: 'facebook_ad_recommended_activity',
              id: hits.hits[0]._id,
            });
          }
        } catch (esErr) {
          logger.warn('ES activity cleanup failed', { error: esErr.message });
        }
      }
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
    logger.error('Error in unHide', { error: err.message });
    return { code: 500, message: 'Error in unHide', error: err.message };
  }
}

module.exports = { hideAds, getHiddenPostOwners, unHide };
