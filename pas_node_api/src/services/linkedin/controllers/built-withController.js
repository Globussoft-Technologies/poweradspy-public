'use strict';

/**
 * LinkedIn built-with scrape queue controller.
 * Ports SupportScrapper@getLinkedinBuiltWith and @updateLinkedinBuiltWith.
 *
 * NOTE: LinkedIn is different from every other network:
 *   - The `built_with_status` column lives on `linkedin_ad_meta_data`
 *     (used for the pending filter), BUT the actual built_with data
 *     (built_with, built_with_cms, built_with_analytics_tracking,
 *     affiliate_data + their statuses) is stored on `linkedin_ad_built_with`
 *     (singular) — a separate table.
 *   - The ES index is `linkedin_ads_data` and the ad id is the `_id`
 *     directly (no query needed). ES fields differ from other networks
 *     (ecommerce_platform / funnel / affiliate_networks).
 */

const LINKEDIN_ES_INDEX = 'linkedin_ads_data';

async function getUrlForBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available', data: null };
  }
  try {
    const rows = await db.sql.query(
      `SELECT linkedin_ad_id AS id, ad_url, destination_url
         FROM linkedin_ad_meta_data
        WHERE built_with_status = 0
        ORDER BY linkedin_ad_id DESC
        LIMIT 100`
    );

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'no data found', data: null };
    }

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    // PHP updates linkedin_ad_built_with (the split table). We mirror that.
    await db.sql.query(
      `UPDATE linkedin_ad_built_with
          SET built_with_status = 2,
              affiliate_status  = 2
        WHERE linkedin_ad_id IN (${placeholders})`,
      ids
    );

    // Also keep meta_data in sync so the next GET doesn't hand out the same rows.
    await db.sql.query(
      `UPDATE linkedin_ad_meta_data
          SET built_with_status = 2
        WHERE linkedin_ad_id IN (${placeholders})`,
      ids
    );

    return { code: 200, message: 'records fetched successfully', data: rows };
  } catch (err) {
    logger.error('Error in getLinkedinBuiltWith', { error: err.message });
    return { code: 500, message: 'Error occured', data: null };
  }
}

async function updateBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available' };
  }

  const post = { ...req.body, ...req.query };
  if (post.id == null || post.status == null) {
    return { code: 400, message: 'Please Provide linkedin id and status' };
  }

  const adId = post.id;
  const status = Number(post.status);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const built_with                    = post.built_with ?? null;
  const built_with_cms                = post.built_with_cms ?? null;
  const built_with_analytics_tracking = post.built_with_analytics_tracking ?? null;
  const affiliate_data                = post.affiliate_data ?? null;

  try {
    const existing = await db.sql.query(
      'SELECT linkedin_ad_id FROM linkedin_ad_built_with WHERE linkedin_ad_id = ? LIMIT 1',
      [adId]
    );
    if (!existing || existing.length === 0) {
      return { code: 400, message: 'Built With Status not Updated' };
    }

    if (status === 1) {
      const built_with_status = (built_with != null || built_with_cms != null || built_with_analytics_tracking != null) ? 1 : 3;
      const affiliate_status  = affiliate_data != null ? 1 : 3;

      const upd = await db.sql.query(
        `UPDATE linkedin_ad_built_with
            SET built_with                    = ?,
                built_with_cms                = ?,
                built_with_analytics_tracking = ?,
                built_with_status             = ?,
                built_with_date               = ?,
                clickbank_processed_date      = ?,
                affiliate_status              = ?,
                affiliate_data                = ?
          WHERE linkedin_ad_id = ?`,
        [built_with, built_with_cms, built_with_analytics_tracking, built_with_status, now, now,
         affiliate_status, affiliate_data, adId]
      );
      const saved = typeof upd?.affectedRows === 'number' ? upd.affectedRows : upd;
      if (!saved) {
        return { code: 400, message: 'Built With Not Updated' };
      }

      // Keep meta_data in sync so this row isn't re-issued by getUrlForBuiltWith.
      await db.sql.query(
        `UPDATE linkedin_ad_meta_data
            SET built_with_status = ?
          WHERE linkedin_ad_id = ?`,
        [built_with_status, adId]
      );

      if (db.elastic) {
        try {
          const index = db.elastic.indexName || LINKEDIN_ES_INDEX;
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
          logger.warn('linkedin ES overlay failed in updateBuiltWith', { error: esErr.message });
        }
      }

      return { code: 200, message: 'Built With Updated successfully' };
    }

    // status !== 1
    await db.sql.query(
      `UPDATE linkedin_ad_built_with
          SET built_with_status         = 3,
              built_with_date           = ?,
              clickbank_processed_date  = ?,
              affiliate_status          = 3
        WHERE linkedin_ad_id = ?`,
      [now, now, adId]
    );
    await db.sql.query(
      `UPDATE linkedin_ad_meta_data
          SET built_with_status = 3
        WHERE linkedin_ad_id = ?`,
      [adId]
    );
    return { code: 200, message: 'Built With and Affiliate Data Status Updated successfully' };
  } catch (err) {
    logger.error('Error in updateLinkedinBuiltWith', { error: err.message });
    return { code: 401, message: 'Built With Status not Updated' };
  }
}

module.exports = { getUrlForBuiltWith, updateBuiltWith };
