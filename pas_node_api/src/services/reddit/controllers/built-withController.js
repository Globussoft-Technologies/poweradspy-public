'use strict';

/**
 * Reddit built-with scrape queue controller.
 * Ports ApiController@getUrlForBuiltWith and @updateBuiltWith.
 */

const REDDIT_ES_INDEX = 'reddit_search_mix';

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
      `SELECT ra.id, ra.ad_id, rmd.destination_url
         FROM reddit_ad ra
         INNER JOIN reddit_ad_meta_data rmd ON rmd.reddit_ad_id = ra.id
        WHERE rmd.built_with_status = 0
          AND rmd.destination_url IS NOT NULL
        ORDER BY ra.id DESC
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
      `UPDATE reddit_ad_meta_data
          SET built_with_status = 2,
              affiliate_status  = 2
        WHERE reddit_ad_id IN (${placeholders})`,
      ids
    );

    return { code: 200, message: 'Ads found for builtwith', data: rows };
  } catch (err) {
    logger.error('Error in getUrlForBuiltWith (reddit)', { error: err.message });
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
      'SELECT reddit_ad_id FROM reddit_ad_meta_data WHERE reddit_ad_id = ? LIMIT 1',
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
        `UPDATE reddit_ad_meta_data
            SET built_with                    = ?,
                built_with_analytics_tracking = ?,
                built_with_cms                = ?,
                built_with_status             = ?,
                built_with_date               = ?,
                affiliate_data                = ?,
                affiliate_status              = ?,
                clickbank_processed_date      = ?
          WHERE reddit_ad_id = ?`,
        [built_with, built_with_analytics_tracking, built_with_cms, built_with_status, now,
         affiliate_data, affiliate_status, now, adId]
      );
      const affected = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
      if (affected !== 1) {
        return { code: 400, message: 'built with not updated', id: adId };
      }

      if (db.elastic) {
        try {
          const index = db.elastic.indexName || REDDIT_ES_INDEX;
          const search = await db.elastic.search({
            index,
            body: { query: { match: { 'reddit_ad.id': Number(adId) } }, size: 1 },
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
                'reddit_ad_meta_data.built_with_analytics_tracking': built_with_analytics_tracking,
                'reddit_ad_meta_data.built_with': built_with,
                'reddit_ad_meta_data.affiliate_data': affiliate_data,
              },
            },
          });
        } catch (esErr) {
          logger.warn('reddit ES overlay failed in updateBuiltWith', { error: esErr.message });
        }
      }

      return { code: 200, message: 'built with updated', id: adId };
    }

    // status !== 1
    await db.sql.query(
      `UPDATE reddit_ad_meta_data
          SET built_with                    = ?,
              built_with_analytics_tracking = ?,
              built_with_cms                = ?,
              built_with_status             = 3,
              built_with_date               = ?,
              clickbank_processed_date      = ?,
              affiliate_status              = 3
        WHERE reddit_ad_id = ?`,
      [post.built_with ?? null, post.built_with_analytics_tracking ?? null, post.built_with_cms ?? null,
       now, now, adId]
    );
    return { code: 200, message: 'parameters empty', data: post };
  } catch (err) {
    logger.error('Error in updateBuiltWith (reddit)', { error: err.message });
    return { code: 400, message: `Exception: ${err.message}` };
  }
}

module.exports = { getUrlForBuiltWith, updateBuiltWith };
