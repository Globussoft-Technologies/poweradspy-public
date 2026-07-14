'use strict';

/**
 * Native built-with scrape queue controller.
 * Ports ApiController@getUrlForBuiltWith and @updateBuiltWith.
 *
 * NOTE: The Native get only bumps `built_with_status` to 2 — it does NOT
 * also flip `affiliate_status` (unlike every other network). This matches
 * the PHP behaviour exactly.
 */

const NATIVE_ES_INDEX = 'native_search_mix';

function normalizePipe(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return s.replace(/\|\|/g, '|');
}

async function getUrlForBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available', data: null };
  }
  try {
    const rows = await db.sql.query(
      `SELECT na.id, na.ad_id, nmd.destination_url
         FROM native_ad na
         INNER JOIN native_ad_meta_data nmd ON nmd.native_ad_id = na.id
        WHERE nmd.built_with_status = 0
          AND nmd.destination_url IS NOT NULL
        ORDER BY na.id DESC
        LIMIT 100`
    );

    if (!rows || rows.length === 0) {
      return {
        code: 400,
        message: 'No more ads available for builtwith',
        data: null,
      };
    }

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    // Native intentionally does not flip affiliate_status here.
    await db.sql.query(
      `UPDATE native_ad_meta_data
          SET built_with_status = 2
        WHERE native_ad_id IN (${placeholders})`,
      ids
    );

    return { code: 200, message: 'Ads found for builtwith', data: rows };
  } catch (err) {
    logger.error('Error in getUrlForBuiltWith (native)', { error: err.message });
    return { code: 500, message: 'Error occured', data: null };
  }
}

async function updateBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available' };
  }

  const post = { ...req.body, ...req.query };
  if (post.id == null || post.status == null) {
    return { code: 400, message: ['The id field is required.', 'The status field is required.'] };
  }

  const adId = post.id;
  const status = Number(post.status);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  try {
    const existing = await db.sql.query(
      'SELECT native_ad_id FROM native_ad_meta_data WHERE native_ad_id = ? LIMIT 1',
      [adId]
    );
    if (!existing || existing.length === 0) {
      return { code: 200, message: 'parameters empty', data: post };
    }

    if (status === 1) {
      const built_with                    = normalizePipe(post.built_with);
      const built_with_analytics_tracking = normalizePipe(post.built_with_analytics_tracking);
      const built_with_cms                = normalizePipe(post.built_with_cms);
      const affiliate_data                = post.affiliate_data === '' || post.affiliate_data == null ? null : post.affiliate_data;

      const built_with_status = (built_with || built_with_analytics_tracking || built_with_cms) ? 1 : 3;
      const affiliate_status  = affiliate_data ? 1 : 3;

      const upd = await db.sql.query(
        `UPDATE native_ad_meta_data
            SET built_with                    = ?,
                built_with_analytics_tracking = ?,
                built_with_cms                = ?,
                built_with_status             = ?,
                built_with_date               = ?,
                affiliate_data                = ?,
                affiliate_status              = ?,
                clickbank_processed_date      = ?
          WHERE native_ad_id = ?`,
        [built_with, built_with_analytics_tracking, built_with_cms, built_with_status, now,
         affiliate_data, affiliate_status, now, adId]
      );
      const affected = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
      if (!affected) {
        return { code: 400, message: 'built with not updated' };
      }

      if (db.elastic) {
        try {
          const index = db.elastic.indexName || NATIVE_ES_INDEX;
          const search = await db.elastic.search({
            index,
            body: { query: { match: { 'native_ad.id': Number(adId) } }, size: 1 },
          });
          const hits = search?.hits?.hits || search?.body?.hits?.hits || [];
          if (hits.length === 0) {
            return { code: 400, message: 'ad not found' };
          }
          await db.elastic.update({
            index,
            type: 'doc',
            id: hits[0]._id,
            body: {
              doc: {
                'native_ad_meta_data.built_with': built_with,
                'native_ad_meta_data.built_with_analytics_tracking': built_with_analytics_tracking,
                'native_ad_meta_data.affiliate_data': affiliate_data,
              },
            },
          });
        } catch (esErr) {
          logger.warn('native ES overlay failed in updateBuiltWith', { error: esErr.message });
        }
      }

      return { code: 200, message: 'built with updated' };
    }

    await db.sql.query(
      `UPDATE native_ad_meta_data
          SET built_with_status         = 3,
              built_with_date           = ?,
              affiliate_status          = 3,
              clickbank_processed_date  = ?
        WHERE native_ad_id = ?`,
      [now, now, adId]
    );
    return { code: 200, message: 'parameters empty', data: post };
  } catch (err) {
    logger.error('Error in updateBuiltWith (native)', { error: err.message });
    return { code: 400, message: `Exception: ${err.message}` };
  }
}

module.exports = { getUrlForBuiltWith, updateBuiltWith };
