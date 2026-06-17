'use strict';

/**
 * YouTube OCB/OCR — insertUpdateOcb (report results).
 *
 * Faithful port of YoutubeAdOcb::insertUpdateOcb (api_youtube), the handler behind
 * `POST insert-update-ocb`. Upserts the OCB/OCR result into youtube_ad_ocb, flips
 * youtube_ad_variants.ocb_url_status to `status`, and patches the youtube_ads_data ES
 * document directly by its _id (= ad_id) — no search step.
 *
 * Body:
 *   ad_id    (required) — youtube_ad_id (also the ES _id in youtube_ads_data)
 *   status   1 = OCB done · 4 = OCR done
 *   object / celebrity / brand_logo   (status 1) — `||`-delimited
 *   ocr                               (status 4) — `||`-delimited
 *
 * YouTube quirks vs Facebook/GDN:
 *   - separate youtube_ad_ocb table (UPSERT), plus a status flip on youtube_ad_variants.
 *   - ES updated by _id directly (id = ad_id); ES field names are object/celebrity/BRAND
 *     (note: `image_brand`, not image_brand_logo) and image_ocr — stored as ARRAYS,
 *     with NO language (_ru/_fr/_sp/_exactly) families.
 *   - status 1 and status 4 are mutually exclusive (OCB writes object/celebrity/brand;
 *     OCR writes ocr) — the un-sent family is not touched.
 */

const repo = require('../repository');

const ES_DOC_TYPE = 'doc';

// PHP explode('||', value): null/'' → [''], "a||b" → ['a','b'].
const splitPipe = (v) => String(v === undefined || v === null ? '' : v).split('||');

function nowDateTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function esResult(res) {
  return res?.result || res?.body?.result || null;
}

async function insertUpdateOcb(db, log, body) {
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'youtube_ads_data';

  const adId = body.ad_id;
  const statusNum = body.status === undefined || body.status === null ? null : Number(body.status);

  try {
    if (!sql || !elastic) return { code: 500, messages: 'DB Exception' };

    // Build the youtube_ad_ocb upsert payload + the ES doc, per status.
    const insertValue = {};
    let esData = {};

    if (statusNum === 4) {
      insertValue.ocr = body.ocr;
      insertValue.ocr_update_date = nowDateTime();
      esData = { image_ocr: splitPipe(body.ocr) };
    }
    if (statusNum === 1) {
      insertValue.object = body.object;
      insertValue.brand_logo = body.brand_logo;
      insertValue.celebrity = body.celebrity;
      insertValue.object_update_date = nowDateTime();
      esData = {
        image_object: splitPipe(body.object),
        image_celebrity: splitPipe(body.celebrity),
        image_brand: splitPipe(body.brand_logo),
      };
    }

    // updateOrInsert(youtube_ad_ocb): insert when absent, else update.
    const exists = await repo.ocbRowExists(sql, adId);
    let insertFlag;
    if (!exists) {
      insertFlag = await repo.insertOcb(sql, adId, insertValue); // true
    } else {
      insertFlag = (await repo.updateOcb(sql, adId, insertValue)) >= 1; // changed → true
    }

    // The variant status flip runs regardless of the upsert outcome (PHP order).
    await repo.updateVariantStatus(sql, adId, body.status);

    if (!insertFlag) {
      return { code: 400, message: 'Image Data is already updated' };
    }

    const updRes = await elastic.update({
      index: ES_INDEX,
      type: ES_DOC_TYPE,
      id: adId,
      body: { doc: esData, detect_noop: false },
    });

    if (esResult(updRes) === 'updated') {
      return { code: 200, message: 'Image Data Updated Successfully' };
    }
    return { code: 400, message: 'Image Object not updated' };
  } catch (e) {
    log?.error?.('youtube.ocr.insertUpdateOcb failed', { adId, error: e.message });
    // PHP: model throws "DB Exception" → controller buildResponse(500, message).
    return { code: 500, messages: 'DB Exception' };
  }
}

module.exports = { insertUpdateOcb };
