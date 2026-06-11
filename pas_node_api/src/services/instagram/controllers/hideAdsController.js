'use strict';

const { normalizeParams } = require('../helpers/paramParser');

/**
 * Insert a hide/favorite record into the hidden_ads table.
 * Mirrors PHP hide_ads() - Userv2Controller.php:5950
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
          'SELECT ad_id FROM instagram_hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 3',
          [user_id, post_owner_id]
        );
        if (db.elastic) {
          for (const row of favRows || []) {
            if (!row.ad_id) continue;
            const esResult = await db.elastic.search({
              index: 'instagram_ad_recommended_activity',
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
                index: 'instagram_ad_recommended_activity',
                id: hits.hits[0]._id,
              });
            }
          }
        }
        await db.sql.query(
          'DELETE FROM instagram_hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 3',
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
          'DELETE FROM instagram_hidden_ads WHERE user_id = ? AND ad_id = ? AND type = 3',
          [user_id, ad_id]
        );
        if (db.elastic) {
          const esResult = await db.elastic.search({
            index: 'instagram_ad_recommended_activity',
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
              index: 'instagram_ad_recommended_activity',
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
          `SELECT instagram_ad.ad_position, instagram_ad_meta_data.ad_url
           FROM instagram_ad
           JOIN instagram_ad_meta_data ON instagram_ad_meta_data.instagram_ad_id = instagram_ad.id
           WHERE instagram_ad.id = ?`,
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
      `INSERT INTO instagram_hidden_ads (user_id, post_owner_id, ad_id, type)
       VALUES (?, ?, ?, ?)`,
      [user_id, post_owner_id || null, ad_id || null, type]
    );

    const insertId = result.insertId;

    if (insertId > 0) {
      return { code: 200, message: 'data inserted successfully', data: insertId };
    }
    return { code: 400, message: 'data not inserted', data: null };

  } catch (err) {
    logger.error('Error in hideAds', { error: err.message });
    return { code: 401, message: err.message, data: null };
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
      'SELECT post_owner_id, ad_id, type FROM instagram_hidden_ads WHERE user_id = ?',
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
    return { code: 401, message: 'Error occurred in getHiddenPostOwners', data: null };
  }
}

async function unHide(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.user_id || !p.type) {
    return { code: 401, message: 'Missing parameters: user_id and type are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const type = parseInt(p.type, 10);
    let sql, params;

    if (type === 1) {
      // Unhide by post_owner
      if (!p.post_owner_id) return { code: 401, message: 'Missing post_owner_id' };
      sql = 'DELETE FROM instagram_hidden_ads WHERE user_id = ? AND post_owner_id = ? AND type = 1';
      params = [p.user_id, p.post_owner_id];
    } else if (type === 2 || type === 3) {
      // Unhide ad (type=2) or unfavorite (type=3)
      if (!p.ad_id) return { code: 401, message: 'Missing ad_id' };
      sql = 'DELETE FROM instagram_hidden_ads WHERE user_id = ? AND ad_id = ? AND type = ?';
      params = [p.user_id, p.ad_id, type];

      // For unfavorite (type=3), also clean up recommended activity in ES
      if (type === 3 && db.elastic) {
        try {
          const esResult = await db.elastic.search({
            index: 'instagram_ad_recommended_activity',
            body: {
              query: {
                bool: {
                  must: [
                    { match: { ad_id: p.ad_id } },
                    { match: { user_id: p.user_id } },
                    { match: { activity: 2 } },
                  ],
                },
              },
            },
          });
          const hits = esResult.hits || esResult.body?.hits;
          if (hits?.hits?.length > 0) {
            await db.elastic.delete({
              index: 'instagram_ad_recommended_activity',
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
    const affected = result?.affectedRows ?? result?.changes ?? 0;

    if (affected > 0) {
      return { code: 200, message: 'data deleted successfully', data: affected };
    }
    // Un-favouriting is idempotent: the row may already be gone because the ad
    // (or its advertiser) was auto-unfavourited when hidden. Treat that as
    // success so the UI doesn't show a spurious "failed to update favourite".
    if (type === 3) {
      return { code: 200, message: 'already not favourited', data: 0 };
    }
    return { code: 400, message: 'data not deleted', data: null };
  } catch (err) {
    logger.error('Error in unHide', { error: err.message });
    return { code: 500, message: 'Error in unHide', error: err.message };
  }
}

module.exports = { hideAds, getHiddenPostOwners,unHide };
