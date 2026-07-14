'use strict';

/**
 * GDN built-with scrape queue controller.
 * Ports ApiController@getUrlForBuiltWith and @updateBuiltWith.
 */

const GDN_ES_INDEX = 'gdn_search_mix';

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
      `SELECT ga.id, ga.ad_id, gmd.destination_url
         FROM gdn_ad ga
         INNER JOIN gdn_ad_meta_data gmd ON gmd.gdn_ad_id = ga.id
        WHERE gmd.built_with_status = 0
          AND gmd.destination_url IS NOT NULL
        ORDER BY ga.id DESC
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
      `UPDATE gdn_ad_meta_data
          SET built_with_status = 2,
              affiliate_status  = 2
        WHERE gdn_ad_id IN (${placeholders})`,
      ids
    );

    return { code: 200, message: 'Ads found for builtwith', data: rows };
  } catch (err) {
    logger.error('Error in getUrlForBuiltWith (gdn)', { error: err.message });
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
      'SELECT gdn_ad_id FROM gdn_ad_meta_data WHERE gdn_ad_id = ? LIMIT 1',
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
        `UPDATE gdn_ad_meta_data
            SET built_with                    = ?,
                built_with_analytics_tracking = ?,
                built_with_cms                = ?,
                built_with_status             = ?,
                built_with_date               = ?,
                clickbank_processed_date      = ?,
                affiliate_data                = ?,
                affiliate_status              = ?
          WHERE gdn_ad_id = ?`,
        [built_with, built_with_analytics_tracking, built_with_cms, built_with_status, now, now,
         affiliate_data, affiliate_status, adId]
      );
      const affected = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
      if (!affected) {
        return { code: 400, message: 'built with not updated' };
      }

      if (db.elastic) {
        try {
          const index = db.elastic.indexName || GDN_ES_INDEX;
          const search = await db.elastic.search({
            index,
            body: { query: { match: { 'gdn_ad.id': Number(adId) } }, size: 1 },
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
                'gdn_ad_meta_data.built_with': built_with,
                'gdn_ad_meta_data.built_with_analytics_tracking': built_with_analytics_tracking,
                'gdn_ad_meta_data.affiliate_data': affiliate_data,
              },
            },
          });
        } catch (esErr) {
          logger.warn('gdn ES overlay failed in updateBuiltWith', { error: esErr.message });
        }
      }

      return { code: 200, message: 'built with updated' };
    }

    await db.sql.query(
      `UPDATE gdn_ad_meta_data
          SET built_with_status         = 3,
              built_with_date           = ?,
              affiliate_status          = 3,
              clickbank_processed_date  = ?
        WHERE gdn_ad_id = ?`,
      [now, now, adId]
    );
    return { code: 200, message: 'parameters empty', data: post };
  } catch (err) {
    logger.error('Error in updateBuiltWith (gdn)', { error: err.message });
    return { code: 400, message: 'Error Occurred', data: err.message };
  }
}

module.exports = { getUrlForBuiltWith, updateBuiltWith };
