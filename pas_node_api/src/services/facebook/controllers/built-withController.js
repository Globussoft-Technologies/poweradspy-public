'use strict';

/**
 * Facebook built-with / outgoing-scrape queue controller.
 * Ports SupportScrapper@getUrlsForOutgoingBuiltWith and
 * SupportScrapper@updateOutgoingBuiltWithStatus.
 *
 * GET  → pulls up to 100 facebook_ad_meta_data rows whose built_with_status = 0
 *        (pending) and flips them to 2 (processing) so a second worker cannot
 *        pick up the same batch.
 * POST → worker reports scrape result back for one ad. status=1 with any data
 *        → built_with_status=1 / affiliate_status=1 (both set to 3 if empty).
 *        Anything else → built_with_status=3 / affiliate_status=3.
 */

const FACEBOOK_ES_INDEX = 'search_mix';

function normalizePipe(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return s.replace(/\|\|/g, '|');
}

async function getUrlsForOutgoingBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available', data: null };
  }

  const t0 = Date.now();

  try {
    const rows = await db.sql.query(
      `SELECT facebook_ad_id AS id, destination_url
         FROM facebook_ad_meta_data
        WHERE built_with_status = 0
        ORDER BY facebook_ad_id DESC
        LIMIT 100`
    );

    const tAfterSelect = Date.now();

    if (!rows || rows.length === 0) {
      return {
        code: 400,
        message: `No more urls available for outgoing/builtwith scrapping,fetched data in ${((Date.now() - t0) / 1000).toFixed(4)} sec`,
        data: null,
      };
    }

    const fbIds = rows.map(r => r.id);
    const placeholders = fbIds.map(() => '?').join(',');

    // Mark rows as processing so a second worker doesn't pick the same batch.
    const tBeforeUpdate = Date.now();
    await db.sql.query(
      `UPDATE facebook_ad_meta_data
          SET built_with_status = 2,
              affiliate_status  = 2
        WHERE facebook_ad_id IN (${placeholders})`,
      fbIds
    );
    const tAfterUpdate = Date.now();

    const totalSec  = ((tAfterUpdate - t0) / 1000).toFixed(4);
    const selectSec = ((tAfterSelect - t0) / 1000).toFixed(4);
    const updateSec = ((tAfterUpdate - tBeforeUpdate) / 1000).toFixed(4);

    return {
      code: 200,
      message: `outgoing/builtwith scrapping data ,fetched data in ${totalSec} 1st query ${selectSec} 2nd query  ${updateSec}`,
      data: rows,
    };
  } catch (err) {
    logger.error('Error in getUrlsForOutgoingBuiltWith', { error: err.message });
    return { code: 402, message: 'Error Occured', data: null };
  }
}

async function updateOutgoingBuiltWithStatus(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available' };
  }

  const post = { ...req.body, ...req.query };
  if (post.id == null || post.status == null) {
    return { code: 400, message: 'facebook ad id and status must be present' };
  }

  const facebookAdId = post.id;
  const status = Number(post.status);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  try {
    const existing = await db.sql.query(
      'SELECT facebook_ad_id FROM facebook_ad_meta_data WHERE facebook_ad_id = ? LIMIT 1',
      [facebookAdId]
    );
    if (!existing || existing.length === 0) {
      // PHP silently skipped when the row didn't exist and still returned success.
      return { code: 200, message: 'BuiltWith Service status Updated ', 'built with updated': false };
    }

    if (status === 1) {
      const built_with                    = normalizePipe(post.built_with);
      const built_with_analytics_tracking = normalizePipe(post.built_with_analytics_tracking);
      const built_with_cms                = normalizePipe(post.built_with_cms);
      const affiliate_data                = post.affiliate_data === '' || post.affiliate_data == null ? null : post.affiliate_data;

      const built_with_status = (built_with || built_with_analytics_tracking || built_with_cms) ? 1 : 3;
      const affiliate_status  = affiliate_data ? 1 : 3;

      const update = await db.sql.query(
        `UPDATE facebook_ad_meta_data
            SET built_with                    = ?,
                built_with_analytics_tracking = ?,
                built_with_cms                = ?,
                built_with_status             = ?,
                built_with_date               = ?,
                affiliate_status              = ?,
                affiliate_data                = ?,
                clickbank_processed_date      = ?
          WHERE facebook_ad_id = ?`,
        [built_with, built_with_analytics_tracking, built_with_cms, built_with_status, now,
         affiliate_status, affiliate_data, now, facebookAdId]
      );
      const affected = typeof update?.affectedRows === 'number' ? update.affectedRows : update;

      // ES overlay — best-effort, mirrors PHP (its ES block was inside its own
      // try/catch that only logged). Only runs on affectedRows === 1 (PHP condition).
      if (affected === 1 && db.elastic) {
        try {
          const index = db.elastic.indexName || FACEBOOK_ES_INDEX;
          const search = await db.elastic.search({
            index,
            body: { query: { match: { 'facebook_ad.id': Number(facebookAdId) } }, size: 1 },
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
                'facebook_ad_meta_data.built_with_analytics_tracking': built_with_analytics_tracking,
                'facebook_ad_meta_data.built_with': built_with,
                'facebook_ad_meta_data.affiliate_data': affiliate_data,
              },
            },
          });
        } catch (esErr) {
          logger.error('Error Occured in function updateOutgoingBuiltWithStatus elastic update', { error: esErr.message });
        }
      }

      return {
        code: 200,
        message: 'BuiltWith Service status Updated ',
        'built with updated': affected > 0,
      };
    }

    // status !== 1 → mark row as no-data (built_with_status = 3).
    const update = await db.sql.query(
      `UPDATE facebook_ad_meta_data
          SET built_with_status         = 3,
              built_with_date           = ?,
              affiliate_status          = 3,
              clickbank_processed_date  = ?
        WHERE facebook_ad_id = ?`,
      [now, now, facebookAdId]
    );
    const affected = typeof update?.affectedRows === 'number' ? update.affectedRows : update;

    return {
      code: 200,
      message: 'BuiltWith Service status Updated ',
      'built with updated': affected > 0,
    };
  } catch (err) {
    logger.error('Error Occured in function updateOutgoingBuiltWithStatus', { error: err.message });
    return { code: 400, message: 'BuiltWith Service status Not Updated' };
  }
}

module.exports = { getUrlsForOutgoingBuiltWith, updateOutgoingBuiltWithStatus };
