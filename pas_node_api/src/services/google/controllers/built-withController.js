'use strict';

/**
 * Google text ads built-with scrape queue controller.
 * Ports ApiController@getUrlForBuiltWith and ApiController@updateBuiltWithold
 * (exposed here as `updateBuiltWith` for naming parity with the other networks).
 *
 * Key differences vs the other networks:
 *  - The ES index is `google_ads_data` and the doc is matched by a flat `id`
 *    field (not `google_text_ad.id`).
 *  - The ES doc uses FLAT field names — `built_with`, `built_with_analytics_tracking`,
 *    `built_with_analytics_tracking_exact`, `affiliate_data`, `affiliate_data_exact`
 *    (no `google_text_ad_meta_data.` dotted prefix, unlike every other network).
 */

const GOOGLE_ES_INDEX = 'google_ads_data';

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
      `SELECT gt.id, gt.ad_id, gtm.destination_url
         FROM google_text_ad gt
         INNER JOIN google_text_ad_meta_data gtm ON gtm.google_text_ad_id = gt.id
        WHERE gtm.built_with_status = 0
          AND gtm.destination_url IS NOT NULL
        ORDER BY gt.id DESC
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
      `UPDATE google_text_ad_meta_data
          SET built_with_status = 2,
              affiliate_status  = 2
        WHERE google_text_ad_id IN (${placeholders})`,
      ids
    );

    return { code: 200, message: 'Ads found for builtwith', data: rows };
  } catch (err) {
    logger.error('Error in getUrlForBuiltWith (google)', { error: err.message });
    return { code: 500, message: 'Something went wrong', data: null };
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
      'SELECT google_text_ad_id FROM google_text_ad_meta_data WHERE google_text_ad_id = ? LIMIT 1',
      [adId]
    );
    if (!existing || existing.length === 0) {
      return { code: 400, message: 'Data not updated', data: post };
    }

    if (status === 1) {
      const built_with                    = normalizePipe(post.built_with);
      const built_with_analytics_tracking = normalizePipe(post.built_with_analytics_tracking);
      const built_with_cms                = normalizePipe(post.built_with_cms);
      const affiliate_data                = post.affiliate_data === '' || post.affiliate_data == null ? null : post.affiliate_data;

      const built_with_status = (built_with || built_with_analytics_tracking || built_with_cms) ? 1 : 3;
      const affiliate_status  = affiliate_data ? 1 : 3;

      const upd = await db.sql.query(
        `UPDATE google_text_ad_meta_data
            SET built_with                    = ?,
                built_with_analytics_tracking = ?,
                built_with_cms                = ?,
                built_with_status             = ?,
                built_with_date               = ?,
                affiliate_data                = ?,
                affiliate_status              = ?,
                clickbank_processed_date      = ?
          WHERE google_text_ad_id = ?`,
        [built_with, built_with_analytics_tracking, built_with_cms, built_with_status, now,
         affiliate_data, affiliate_status, now, adId]
      );
      const affected = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
      if (affected !== 1) {
        return { code: 400, message: 'built with not updated' };
      }

      if (db.elastic) {
        try {
          const index = db.elastic?.indexName || GOOGLE_ES_INDEX;
          const search = await db.elastic.search({
            index,
            body: { query: { match: { id: Number(adId) } }, size: 1 },
          });
          const hits = search?.hits?.hits || search?.body?.hits?.hits || [];
          if (hits.length > 0) {
            await db.elastic.update({
              index,
              type: 'doc',
              id: hits[0]._id,
              body: {
                doc: {
                  built_with,
                  built_with_analytics_tracking,
                  built_with_analytics_tracking_exact: built_with_analytics_tracking,
                  affiliate_data,
                  affiliate_data_exact: affiliate_data,
                },
              },
            });
          }
        } catch (esErr) {
          logger.warn('google ES overlay failed in updateBuiltWith', { error: esErr.message });
        }
      }

      return { code: 200, message: 'built with updated' };
    }

    // status !== 1 → mark row as no-data.
    const upd = await db.sql.query(
      `UPDATE google_text_ad_meta_data
          SET built_with_status         = 3,
              built_with_date           = ?,
              affiliate_status          = 3,
              clickbank_processed_date  = ?
        WHERE google_text_ad_id = ?`,
      [now, now, adId]
    );
    const affected = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
    if (affected === 1) {
      return { code: 200, message: 'parameters empty', data: post };
    }
    return { code: 400, message: 'Data not updated', data: post };
  } catch (err) {
    logger.error('Error in updateBuiltWith (google)', { error: err.message });
    return { code: 400, message: `Exception: ${err.message}` };
  }
}

module.exports = { getUrlForBuiltWith, updateBuiltWith };
