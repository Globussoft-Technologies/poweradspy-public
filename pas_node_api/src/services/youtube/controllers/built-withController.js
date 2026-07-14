'use strict';

/**
 * YouTube built-with scrape queue controller.
 * Ports ApiController@getUrlForBuiltWith and @updateBuiltWith.
 *
 * Key differences vs other networks:
 *  - The get filter is `built_with_status NOT IN (1, 2, 4)` — i.e. only
 *    statuses 0 and 3 (and anything else) are picked up. PHP intentionally
 *    excludes completed (1), processing (2), and skipped (4).
 *  - The ES index is `youtube_ads_data` and the ad id is used as the `_id`
 *    directly. ES fields differ (ecommerce_platform / funnel / affiliate_networks).
 */

const YOUTUBE_ES_INDEX = 'youtube_ads_data';

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
      `SELECT ya.id, ya.ad_id, ymd.destination_url
         FROM youtube_ad ya
         INNER JOIN youtube_ad_meta_data ymd ON ymd.youtube_ad_id = ya.id
        WHERE ymd.built_with_status NOT IN (1, 2, 4)
        ORDER BY ya.id DESC
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
    await db.sql.query(
      `UPDATE youtube_ad_meta_data
          SET built_with_status = 2,
              affiliate_status  = 2
        WHERE youtube_ad_id IN (${placeholders})`,
      ids
    );

    return { code: 200, message: 'Ads found for builtwith', data: rows };
  } catch (err) {
    logger.error('Error in getUrlForBuiltWith (youtube)', { error: err.message });
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
      'SELECT youtube_ad_id FROM youtube_ad_meta_data WHERE youtube_ad_id = ? LIMIT 1',
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
        `UPDATE youtube_ad_meta_data
            SET built_with                    = ?,
                built_with_analytics_tracking = ?,
                built_with_cms                = ?,
                built_with_status             = ?,
                built_with_date               = ?,
                affiliate_status              = ?,
                clickbank_processed_date      = ?,
                affiliate_data                = ?
          WHERE youtube_ad_id = ?`,
        [built_with, built_with_analytics_tracking, built_with_cms, built_with_status, now,
         affiliate_status, now, affiliate_data, adId]
      );
      const affected = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
      if (affected !== 1) {
        return { code: 400, message: 'built with not updated' };
      }

      if (db.elastic) {
        try {
          const index = db.elastic.indexName || YOUTUBE_ES_INDEX;
          await db.elastic.update({
            index,
            type: 'doc',
            id: adId,
            body: {
              doc: {
                ecommerce_platform: built_with,
                funnel: built_with_analytics_tracking,
                affiliate_networks: affiliate_data,
              },
            },
          });
        } catch (esErr) {
          logger.warn('youtube ES overlay failed in updateBuiltWith', { error: esErr.message });
        }
      }

      return { code: 200, message: 'Built with Updated successfully' };
    }

    // status !== 1 → mark row as no-data.
    await db.sql.query(
      `UPDATE youtube_ad_meta_data
          SET built_with                    = ?,
              built_with_analytics_tracking = ?,
              built_with_cms                = ?,
              built_with_status             = 3,
              built_with_date               = ?,
              clickbank_processed_date      = ?,
              affiliate_status              = 3
        WHERE youtube_ad_id = ?`,
      [post.built_with ?? null, post.built_with_analytics_tracking ?? null, post.built_with_cms ?? null,
       now, now, adId]
    );
    return { code: 200, message: 'parameters empty', data: post };
  } catch (err) {
    logger.error('Error in updateBuiltWith (youtube)', { error: err.message });
    return { code: 400, message: `Exception: ${err.message}` };
  }
}

module.exports = { getUrlForBuiltWith, updateBuiltWith };
