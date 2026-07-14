'use strict';

/**
 * Instagram built-with scrape queue controller.
 * Ports SupportScrapper@getInstagramBuiltWith and @updateInstaBuiltWith.
 */

const INSTAGRAM_ES_INDEX = 'instagram_search_mix';

async function getUrlForBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available', data: null };
  }
  try {
    const rows = await db.sql.query(
      `SELECT instagram_ad_id AS id, ad_url, destination_url
         FROM instagram_ad_meta_data
        WHERE built_with_status = 0
          AND destination_url IS NOT NULL
        ORDER BY instagram_ad_id DESC
        LIMIT 100`
    );

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'no data found', data: null };
    }

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    await db.sql.query(
      `UPDATE instagram_ad_meta_data
          SET built_with_status = 2,
              affiliate_status  = 2
        WHERE instagram_ad_id IN (${placeholders})`,
      ids
    );

    return { code: 200, message: 'records fetched successfully', data: rows };
  } catch (err) {
    logger.error('Error in getInstagramBuiltWith', { error: err.message });
    return { code: 500, message: 'Error occured', data: null };
  }
}

async function updateBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available' };
  }

  const post = { ...req.body, ...req.query };
  if (post.id == null) {
    return { code: 400, message: 'Please Provide Insta id and Status' };
  }

  const adId = post.id;
  const status = Number(post.status);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const emptyToNull = (v) => (v === undefined || v === null || v === '' ? null : v);
  const built_with                    = emptyToNull(post.built_with);
  const built_with_cms                = emptyToNull(post.built_with_cms);
  const built_with_analytics_tracking = emptyToNull(post.built_with_analytics_tracking);
  const affiliate_data                = emptyToNull(post.affiliate_data);

  try {
    const existing = await db.sql.query(
      'SELECT instagram_ad_id FROM instagram_ad_meta_data WHERE instagram_ad_id = ? LIMIT 1',
      [adId]
    );
    if (!existing || existing.length === 0) {
      return { code: 400, message: 'ad not found' };
    }

    if (status === 1) {
      const built_with_status = (built_with != null || built_with_analytics_tracking != null || built_with_cms != null) ? 1 : 3;
      const affiliate_status  = affiliate_data != null ? 1 : 3;

      const upd = await db.sql.query(
        `UPDATE instagram_ad_meta_data
            SET built_with                     = ?,
                built_with_cms                 = ?,
                built_with_analytics_tracking  = ?,
                built_with_status              = ?,
                built_with_date                = ?,
                clickbank_processed_date       = ?,
                affiliate_status               = ?,
                affiliate_data                 = ?
          WHERE instagram_ad_id = ?`,
        [built_with, built_with_cms, built_with_analytics_tracking, built_with_status, now, now,
         affiliate_status, affiliate_data, adId]
      );
      const saved = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
      if (!saved) {
        return { code: 400, message: 'Built With Not Updated' };
      }

      if (db.elastic) {
        try {
          const index = db.elastic.indexName || INSTAGRAM_ES_INDEX;
          const search = await db.elastic.search({
            index,
            body: { query: { match: { 'instagram_ad.id': Number(adId) } }, size: 1 },
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
                'instagram_ad_meta_data.built_with': built_with,
                'instagram_ad_meta_data.built_with_analytics_tracking': built_with_analytics_tracking,
                'instagram_ad_meta_data.affiliate_data': affiliate_data,
              },
            },
          });
        } catch (esErr) {
          logger.warn('instagram ES overlay failed in updateBuiltWith', { error: esErr.message });
        }
      }

      return { code: 200, message: 'Built With Updated successfully' };
    }

    await db.sql.query(
      `UPDATE instagram_ad_meta_data
          SET built_with_status         = 3,
              built_with_date           = ?,
              affiliate_status          = 3,
              clickbank_processed_date  = ?
        WHERE instagram_ad_id = ?`,
      [now, now, adId]
    );
    return { code: 200, message: 'Built With Updated successfully' };
  } catch (err) {
    logger.error('Error in updateInstaBuiltWith', { error: err.message });
    return { code: 401, message: 'Built With Status not Updated' };
  }
}

module.exports = { getUrlForBuiltWith, updateBuiltWith };
