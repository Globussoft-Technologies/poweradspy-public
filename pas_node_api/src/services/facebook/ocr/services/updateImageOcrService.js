'use strict';

/**
 * Facebook OCR/OCB — updateImageOcrDetails (report results).
 *
 * Faithful port of Userv2Controller@updateImageOcrDetails (api app), the handler
 * behind `POST update-image-info`. Persists scraper output into MySQL
 * (facebook_ad_variants) and mirrors it into Elasticsearch (search_mix).
 *
 * Body:
 *   ad_id      (required) — internal facebook_ad.id (variant keyed by facebook_ad_id)
 *   status     1 = OCB done · 4 = OCR done · 2 = re-queue/partial
 *   object     "a||b||c" (||-delimited), nullable
 *   celebrity  ||-delimited, nullable
 *   brand_logo ||-delimited, nullable
 *   ocr        ||-delimited; if omitted, the existing image_ocr is kept
 *
 * ⚠ Overwrite, not append: object/celebrity/brand_logo are replaced on every call —
 * omitting one sets it to NULL. `ocr` is the exception (kept if omitted). SQL and ES
 * writes are independent (a good SQL write + missing ES doc still returns "ad not found")
 * — preserved verbatim from the PHP.
 */

const repo = require('../repository');

const ES_DOC_TYPE = 'doc';

// isset()-parity: a value the scraper actually sent (not missing, not null).
const sentOrNull = (v) => (v === undefined || v === null ? null : v);

// PHP explode('||', value): null/'' → [''], "a||b" → ['a','b'].
const splitPipe = (v) => String(v === undefined || v === null ? '' : v).split('||');

function nowDateTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function esHits(res) {
  return res?.hits?.hits || res?.body?.hits?.hits || [];
}
function esResult(res) {
  return res?.result || res?.body?.result || null;
}

async function updateImageInfo(db, log, body) {
  const response = {};
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'search_mix';

  const adId = body.ad_id;
  const status = body.status; // may be undefined (status is optional)
  const statusNum = status === undefined || status === null ? null : Number(status);

  try {
    if (!sql) {
      response.code = 401;
      response.message = 'Image Object not updated';
      return response;
    }

    const variant = await repo.getVariantByAdId(sql, adId);

    if (!variant) {
      response.code = 400;
      response.message = 'Please enter valid ad_id';
      return response;
    }

    // ── Build the MySQL update (faithful to the PHP isset(...) ? value : null logic) ──
    const updateVariants = {};

    // Only stamp the "final" status the first time (when it is still 0).
    if (Number(variant.image_text_final_status) === 0) {
      updateVariants.image_text_final_status = status === undefined ? null : status;
    }

    updateVariants.image_object = sentOrNull(body.object);
    updateVariants.image_celebrity = sentOrNull(body.celebrity);
    updateVariants.image_brand_logo = sentOrNull(body.brand_logo);
    updateVariants.image_ocr = body.ocr === undefined || body.ocr === null ? variant.image_ocr : body.ocr;

    if (statusNum === 1 || statusNum === 4) {
      updateVariants.image_url_status = statusNum;
    } else if (statusNum === 2) {
      // PHP in_array(null, $row): inspect EVERY column of the pre-update row.
      const anyNull = Object.values(variant).some((v) => v === null);
      updateVariants.image_url_status = anyNull ? 3 : 1;
    }

    if (statusNum === 1) updateVariants.object_update_date = nowDateTime();
    if (statusNum === 4) updateVariants.ocr_updated_date = nowDateTime();

    const updated = await repo.updateVariant(sql, adId, updateVariants);

    if (!updated) {
      response.code = 400;
      response.message = 'Ad not found';
      return response;
    }

    // ── Mirror into Elasticsearch (independent of the SQL write) ──
    try {
      if (!elastic) {
        response.code = 400;
        response.message = 'ad not found';
        return response;
      }

      const object = splitPipe(body.object);
      const celebrity = splitPipe(body.celebrity);
      const brandLogo = splitPipe(body.brand_logo);
      const ocr = splitPipe(body.ocr);

      const found = await elastic.search({
        index: ES_INDEX,
        type: ES_DOC_TYPE,
        body: { query: { match: { 'facebook_ad.id': adId } } },
      });
      const hits = esHits(found);

      if (!hits.length) {
        response.code = 400;
        response.message = 'ad not found';
        return response;
      }

      const docValue = {
        'facebook_ad_variants.image_object': object,
        'facebook_ad_variants.image_object_ru': object,
        'facebook_ad_variants.image_object_fr': object,
        'facebook_ad_variants.image_object_sp': object,
        'facebook_ad_variants.image_object_exactly': object,
        'facebook_ad_variants.image_celebrity': celebrity,
        'facebook_ad_variants.image_celebrity_ru': celebrity,
        'facebook_ad_variants.image_celebrity_fr': celebrity,
        'facebook_ad_variants.image_celebrity_sp': celebrity,
        'facebook_ad_variants.image_celebrity_exactly': celebrity,
        'facebook_ad_variants.image_brand_logo': brandLogo,
        'facebook_ad_variants.image_brand_logo_ru': brandLogo,
        'facebook_ad_variants.image_brand_logo_fr': brandLogo,
        'facebook_ad_variants.image_brand_logo_sp': brandLogo,
        'facebook_ad_variants.image_brand_logo_exactly': brandLogo,
      };
      if (statusNum === 4) {
        Object.assign(docValue, {
          'facebook_ad_variants.image_ocr': ocr,
          'facebook_ad_variants.image_ocr_ru': ocr,
          'facebook_ad_variants.image_ocr_fr': ocr,
          'facebook_ad_variants.image_ocr_sp': ocr,
          'facebook_ad_variants.image_ocr_exactly': ocr,
        });
      }

      const updRes = await elastic.update({
        index: ES_INDEX,
        type: ES_DOC_TYPE,
        id: hits[0]._id,
        body: { doc: docValue, detect_noop: false },
      });

      if (esResult(updRes) === 'updated') {
        response.code = 200;
        response.message = 'Image Data Updated Successfully';
      } else {
        response.code = 400;
        response.message = 'ad not found';
      }
      return response;
    } catch (esErr) {
      log?.error?.('facebook.ocr.updateImageInfo ES update failed', { adId, error: esErr.message });
      response.code = 400;
      response.message = 'Some Error occurred';
      return response;
    }
  } catch (e) {
    log?.error?.('facebook.ocr.updateImageInfo failed', { adId, error: e.message });
    response.code = 401;
    response.message = 'Image Object not updated';
    return response;
  }
}

module.exports = { updateImageInfo };
