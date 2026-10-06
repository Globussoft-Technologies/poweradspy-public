'use strict';

/**
 * ChatGPT Ads built-with / outgoing-scrape queue controller.
 * Mirrors facebook/controllers/built-withController.js (getUrlsForOutgoingBuiltWith /
 * updateOutgoingBuiltWithStatus), reshaped for this network's split-table schema
 * (scripts/chatgptads/chatgptads_schema.sql — same split as LinkedIn):
 *   - the queue status lives on chatgptads_ad.built_with_status;
 *   - the scraped data + affiliate_status live on chatgptads_ad_built_with
 *     (ONE row per ad, UNIQUE chatgptads_ad_id — created/upserted by the POST only, so it
 *     holds results only).
 *
 * GET  → pulls up to 100 chatgptads_ad rows whose built_with_status = 0 (pending) and
 *        flips them to 2 (processing) so a second worker cannot pick up the same batch.
 *        chatgptads_ad_built_with is not touched.
 * POST → worker reports scrape result back for one ad. status=1 with any data
 *        → built_with_status=1 / affiliate_status=1 (each set to 3 if empty).
 *        Anything else → built_with_status=3 / affiliate_status=3.
 *
 * `id` is the INTERNAL chatgptads_ad.id (= the ES doc _id).
 *
 * ES: after a status=1 update the chatgpt_search_mix doc is patched by _id with
 * ecommerce_platform (= built_with) / funnel (= built_with_analytics_tracking) / affiliate_data
 * as keyword ARRAYS (the "|"-separated values split), so a single technology is a cheap term
 * filter. Same ES names youtube/linkedin use. Best-effort:
 * an ES failure is logged, the SQL update still stands. These keys are in
 * esDocBuilder.CARRY_OVER_KEYS so an insertion re-index does not wipe them.
 */

const CHATGPTADS_ES_INDEX = 'chatgpt_search_mix';

function normalizePipe(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  return s.replace(/\|\|/g, '|');
}

/** "a|b|" → ['a','b']; null when there is nothing. */
function pipeToArray(v) {
  if (v == null) return null;
  const list = [...new Set(String(v).split('|').map((x) => x.trim()).filter(Boolean))];
  return list.length ? list : null;
}

async function getUrlsForOutgoingBuiltWith(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available', data: null };
  }

  const t0 = Date.now();

  try {
    // Ads without a usable destination_url are skipped — there is nothing to scrape.
    const rows = await db.sql.query(
      `SELECT id, destination_url
         FROM chatgptads_ad
        WHERE built_with_status = 0
          AND destination_url IS NOT NULL
          AND TRIM(destination_url) <> ''
          AND LOWER(TRIM(destination_url)) NOT IN ('null', 'undefined')
        ORDER BY id DESC
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

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');

    // Mark rows as processing so a second worker doesn't pick the same batch.
    const tBeforeUpdate = Date.now();
    // Only the queue column changes here. chatgptads_ad_built_with is NOT touched — its row is
    // created by updateOutgoingBuiltWithStatus when the worker reports a result, so the table
    // only ever holds real results (no empty "processing" placeholder rows).
    await db.sql.query(
      `UPDATE chatgptads_ad
          SET built_with_status = 2
        WHERE id IN (${placeholders})`,
      ids
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
    logger.error('Error in chatgptads getUrlsForOutgoingBuiltWith', { error: err.message });
    return { code: 402, message: 'Error Occured', data: null };
  }
}

async function updateOutgoingBuiltWithStatus(req, db, logger) {
  if (!db.sql) {
    return { code: 503, message: 'SQL connection not available' };
  }

  const post = { ...req.body, ...req.query };
  if (post.id == null || post.status == null) {
    return { code: 400, message: 'chatgptads ad id and status must be present' };
  }

  const adId = post.id;
  const status = Number(post.status);

  try {
    const existing = await db.sql.query(
      'SELECT id FROM chatgptads_ad WHERE id = ? LIMIT 1',
      [adId]
    );
    if (!existing || existing.length === 0) {
      // Same as facebook: unknown ad → nothing written, still a 200.
      return { code: 200, message: 'BuiltWith Service status Updated ', 'built with updated': false };
    }

    if (status === 1) {
      const built_with                    = normalizePipe(post.built_with);
      const built_with_analytics_tracking = normalizePipe(post.built_with_analytics_tracking);
      const built_with_cms                = normalizePipe(post.built_with_cms);
      const affiliate_data                = post.affiliate_data === '' || post.affiliate_data == null ? null : post.affiliate_data;

      const built_with_status = (built_with || built_with_analytics_tracking || built_with_cms) ? 1 : 3;
      const affiliate_status  = affiliate_data ? 1 : 3;

      const upsert = await db.sql.query(
        `INSERT INTO chatgptads_ad_built_with
                (chatgptads_ad_id, built_with, built_with_analytics_tracking, built_with_cms,
                 affiliate_data, affiliate_status)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
                built_with                    = VALUES(built_with),
                built_with_analytics_tracking = VALUES(built_with_analytics_tracking),
                built_with_cms                = VALUES(built_with_cms),
                affiliate_data                = VALUES(affiliate_data),
                affiliate_status              = VALUES(affiliate_status)`,
        [adId, built_with, built_with_analytics_tracking, built_with_cms, affiliate_data, affiliate_status]
      );
      const update = await db.sql.query(
        'UPDATE chatgptads_ad SET built_with_status = ? WHERE id = ?',
        [built_with_status, adId]
      );
      const affectedOf = (r) => (typeof r?.affectedRows === 'number' ? r.affectedRows : 0);
      const affected = affectedOf(upsert) + affectedOf(update);

      // ES overlay — best-effort; the doc _id is the internal chatgptads_ad.id.
      if (db.elastic) {
        try {
          const index = db.elastic.indexName || CHATGPTADS_ES_INDEX;
          await db.elastic.update({
            index,
            type: 'doc',
            id: String(adId),
            body: {
              doc: {
                ecommerce_platform: pipeToArray(built_with),
                funnel: pipeToArray(built_with_analytics_tracking),
                affiliate_data: pipeToArray(affiliate_data),
              },
            },
          });
        } catch (esErr) {
          logger.error('Error Occured in function chatgptads updateOutgoingBuiltWithStatus elastic update', { id: adId, error: esErr.message });
        }
      }

      return {
        code: 200,
        message: 'BuiltWith Service status Updated ',
        'built with updated': affected > 0,
      };
    }

    // status !== 1 → mark ad as no-data (built_with_status = 3 / affiliate_status = 3).
    const upsert = await db.sql.query(
      `INSERT INTO chatgptads_ad_built_with (chatgptads_ad_id, affiliate_status)
       VALUES (?, 3)
       ON DUPLICATE KEY UPDATE affiliate_status = VALUES(affiliate_status)`,
      [adId]
    );
    const update = await db.sql.query(
      'UPDATE chatgptads_ad SET built_with_status = 3 WHERE id = ?',
      [adId]
    );
    const affected = (upsert?.affectedRows || 0) + (update?.affectedRows || 0);

    return {
      code: 200,
      message: 'BuiltWith Service status Updated ',
      'built with updated': affected > 0,
    };
  } catch (err) {
    logger.error('Error Occured in function chatgptads updateOutgoingBuiltWithStatus', { error: err.message });
    return { code: 400, message: 'BuiltWith Service status Not Updated' };
  }
}

module.exports = { getUrlsForOutgoingBuiltWith, updateOutgoingBuiltWithStatus };
