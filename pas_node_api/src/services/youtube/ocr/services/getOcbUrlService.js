'use strict';

/**
 * YouTube OCB — getOcbUrl (lease work).
 *
 * Port of api_youtube VideoURLController@getOcbUrl, the handler behind
 * `GET get-ocb-url?type=1`. Leases a batch of IMAGE/DISPLAY ads queued for OCB, resolves
 * each video_url → image_url to absolute, and flips them to ocb_url_status=1 so the next
 * call does not hand out the same ads.
 *
 * Only the image OCB queue (`type=1`) is supported — the legacy `type=2` (video) path is
 * not used by any scraper and was dropped. Any other `type` → 404.
 *
 * YouTube quirks vs Facebook/GDN: the queue is driven by `type` (not status); the lease
 * is OCB-only; leased rows are marked ocb_url_status=1 (not 2). Returns a plain
 * { code, data } — the controller maps it to the PHP buildResponse body shape.
 */

const { resolveMediaUrl } = require('../../../../insertion/helpers/nasClient');
const repo = require('../repository');

const PENDING = 0;   // ocb_url_status of an ad waiting for OCB
const LEASED = 1;    // PHP getOcbUrl sets data["ocb_url_status"] = 1 on lease

async function leaseOcb(db, log, type) {
  const sql = db?.sql;
  try {
    if (!sql) return { code: 500 };

    if (Number(type) !== 1) {
      return { code: 404 }; // only type=1 (image OCB) is supported → Missing Parameter
    }

    const result = await repo.leaseImageAds(sql, PENDING);
    // PHP resolves image_url to absolute (no `||` split for YouTube).
    for (const row of result) row.image_url = resolveMediaUrl(row.image_url);

    if (!result.length) return { code: 400 };

    const adIds = result.map((r) => r.ad_id);
    await repo.updateVariantStatusByAdIds(sql, adIds, LEASED);

    return { code: 200, data: result };
  } catch (e) {
    log?.error?.('youtube.ocr.getOcbUrl failed', { error: e.message });
    return { code: 500, message: e.message };
  }
}

module.exports = { leaseOcb };
