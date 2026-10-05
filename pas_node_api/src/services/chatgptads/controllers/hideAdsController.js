'use strict';

/**
 * ChatGPT Ads — per-user save / hide (chatgptads_hidden_ads).
 *
 * Same request/response contract as facebook's hideAdsController, because the dashboard's
 * hideAds / unHideAds / fetchHiddenAndFavourites (new-ui-react services/api.js) call every
 * network the same way:
 *   type 1 = hide advertiser (post_owner_id), 2 = hide ad (ad_id), 3 = save ad (ad_id)
 * `ad_id` is the external ChatGPT ad id the card carries (chatgptads_ad.ad_id).
 * `user_id` is injected into the body by authMiddleware.
 *
 * Unlike facebook there is no recommended-activity ES index to keep in sync — SQL only.
 */

const TABLE = 'chatgptads_hidden_ads';

function targetKey(type, postOwnerId, adId) {
  return type === 1 ? `owner:${postOwnerId}` : `ad:${adId}`;
}

function parseRequest(body = {}) {
  const userId = body.user_id != null && String(body.user_id).trim() !== '' ? String(body.user_id).trim() : null;
  const type = parseInt(body.type, 10);
  const postOwnerId = Number.isInteger(Number(body.post_owner_id)) && Number(body.post_owner_id) > 0
    ? Number(body.post_owner_id)
    : null;
  const adId = body.ad_id != null && String(body.ad_id).trim() !== '' ? String(body.ad_id).trim() : null;
  return { userId, type, postOwnerId, adId };
}

function validate({ userId, type, postOwnerId, adId }) {
  if (!userId || !type) return 'Missing required params: user_id, type';
  if (![1, 2, 3].includes(type)) return 'Invalid type. Must be 1, 2, or 3';
  if (type === 1 && !postOwnerId) return 'Missing post_owner_id for type=1';
  if (type !== 1 && !adId) return 'Missing ad_id for type=2/3';
  return null;
}

/** POST /ads/hide_ads — hide an advertiser / hide an ad / save an ad. */
async function hideAds(req, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };
    const p = parseRequest(req.body);
    const error = validate(p);
    if (error) return { code: 400, message: error };

    // Hiding an advertiser also un-saves that advertiser's ads, and hiding an ad un-saves it,
    // so an ad never shows in both Saved and Hidden (same behaviour as facebook).
    try {
      if (p.type === 1) {
        await db.sql.query(
          `DELETE h FROM ${TABLE} h
           INNER JOIN chatgptads_ad a ON a.ad_id = h.ad_id
           WHERE h.user_id = ? AND h.type = 3 AND a.post_owner_id = ?`,
          [p.userId, p.postOwnerId]
        );
      } else if (p.type === 2) {
        await db.sql.query(
          `DELETE FROM ${TABLE} WHERE user_id = ? AND type = 3 AND ad_id = ?`,
          [p.userId, p.adId]
        );
      }
    } catch (err) {
      logger.warn('ChatGPT Ads auto-unsave on hide failed', { error: err.message });
    }

    const result = await db.sql.query(
      `INSERT INTO ${TABLE} (user_id, type, post_owner_id, ad_id, target_key) VALUES (?, ?, ?, ?, ?)`,
      [
        p.userId,
        p.type,
        p.postOwnerId,
        p.type === 1 ? null : p.adId,
        targetKey(p.type, p.postOwnerId, p.adId),
      ]
    );
    if (result?.insertId > 0) return { code: 200, message: 'data inserted successfully', data: result.insertId };
    return { code: 400, message: 'data not inserted', data: null };
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
      // Double click / stale UI — idempotent success, never an auth-looking error.
      return { code: 200, message: 'already hidden/favourited', data: 0 };
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.errno === 1452) {
      return { code: 404, message: 'Ad or advertiser not found', data: null };
    }
    logger.error('Error in ChatGPT Ads hideAds', { error: err.message });
    return { code: 500, message: err.message, data: null };
  }
}

/** POST /ads/getHiddenPostOwners — { data: ownerIds, addata: hiddenAdIds, favorite: savedAdIds }. */
async function getHiddenPostOwners(req, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };
    const { userId } = parseRequest(req.body);
    if (!userId) return { code: 400, message: 'Missing required param: user_id' };

    const rows = await db.sql.query(
      `SELECT post_owner_id, ad_id, type FROM ${TABLE} WHERE user_id = ?`,
      [userId]
    );
    if (!rows || rows.length === 0) {
      return { code: 200, message: 'no data found', data: [], addata: [], favorite: [] };
    }

    const data = [];
    const addata = [];
    const favorite = [];
    for (const row of rows) {
      const type = Number(row.type);
      if (type === 1 && row.post_owner_id != null) data.push(Number(row.post_owner_id));
      else if (type === 2 && row.ad_id) addata.push(String(row.ad_id));
      else if (type === 3 && row.ad_id) favorite.push(String(row.ad_id));
    }
    return { code: 200, message: 'data retrieved', data, addata, favorite };
  } catch (err) {
    logger.error('Error in ChatGPT Ads getHiddenPostOwners', { error: err.message });
    return { code: 500, message: 'Error occurred in getHiddenPostOwners', data: null };
  }
}

/** POST /ads/un-hide — un-hide an advertiser / un-hide an ad / un-save an ad. */
async function unHide(req, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };
    const p = parseRequest(req.body);
    const error = validate(p);
    if (error) return { code: 400, message: error };

    const result = await db.sql.query(
      `DELETE FROM ${TABLE} WHERE user_id = ? AND type = ? AND target_key = ?`,
      [p.userId, p.type, targetKey(p.type, p.postOwnerId, p.adId)]
    );
    const affected = result?.affectedRows ?? 0;
    if (affected > 0) return { code: 200, message: 'data deleted successfully', data: affected };
    // Un-saving is idempotent: the row may already be gone because hiding auto-unsaved it.
    if (p.type === 3) return { code: 200, message: 'already not favourited', data: 0 };
    return { code: 400, message: 'data not deleted', data: null };
  } catch (err) {
    logger.error('Error in ChatGPT Ads unHide', { error: err.message });
    return { code: 500, message: 'Error in unHide', error: err.message };
  }
}

/**
 * Saved / hidden ad ids for the Saved / Hidden pages (search with favorite / hidden = 'true').
 * Hidden advertisers are returned as post_owner_lower values, the ES field that identifies an
 * advertiser in chatgpt_search_mix (it has no post_owner_id field).
 */
async function getUserAdLists(db, userId) {
  const rows = await db.sql.query(
    `SELECT h.type, h.ad_id, h.post_owner_id, o.post_owner_lower
     FROM ${TABLE} h
     LEFT JOIN chatgptads_ad_post_owners o ON o.id = h.post_owner_id
     WHERE h.user_id = ?`,
    [String(userId)]
  );
  const savedAdIds = [];
  const hiddenAdIds = [];
  const hiddenOwners = [];
  const hideMeta = new Map(); // ad_id or 'owner:<lower>' → { hideType, postOwnerId }
  for (const row of rows || []) {
    const type = Number(row.type);
    if (type === 3 && row.ad_id) savedAdIds.push(String(row.ad_id));
    if (type === 2 && row.ad_id) {
      hiddenAdIds.push(String(row.ad_id));
      hideMeta.set(String(row.ad_id), { hideType: 2, postOwnerId: row.post_owner_id ?? null });
    }
    if (type === 1 && row.post_owner_lower) {
      hiddenOwners.push(String(row.post_owner_lower));
      hideMeta.set(`owner:${String(row.post_owner_lower)}`, { hideType: 1, postOwnerId: row.post_owner_id ?? null });
    }
  }
  return { savedAdIds, hiddenAdIds, hiddenOwners, hideMeta };
}

module.exports = { hideAds, getHiddenPostOwners, unHide, getUserAdLists };
