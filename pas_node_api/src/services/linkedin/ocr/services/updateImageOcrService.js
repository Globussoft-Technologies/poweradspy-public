'use strict';

/**
 * LinkedIn OCR/OCB — updateImageOcrDetails (report results).
 *
 * Faithful port of api_linkedin UserController@updateImageOcrDetails, the handler behind
 * `POST update-image-info`. Persists scraper output into MySQL FIRST (two separate
 * tables), then Elasticsearch (`linkedin_ads_data`). This MySQL-first ordering is the
 * reverse of GDN and is preserved verbatim.
 *
 * Body:
 *   ad_id      (required) — internal linkedin_ad.id (rows keyed by linkedin_ad_id)
 *   status     1 = OCB done · 4 = OCR done (also 2 = in-progress flip, edge case)
 *   object     nullable — RAW string into MySQL; `||`-exploded into an ARRAY for ES
 *   celebrity  nullable — same
 *   brand_logo nullable — same (ES key is `image_brand`, not image_brand_logo)
 *   ocr        nullable — if omitted, the existing image_ocr is kept (MySQL); a STRING in ES
 *
 * LinkedIn specifics vs GDN:
 *   - OCB/OCR columns live in a SEPARATE table `linkedin_ad_ocr_ocb_details`
 *     (status/text-final-status stay on `linkedin_ad_variants`).
 *   - MySQL write happens FIRST (both tables), then ES.
 *   - ES doc is the FLAT `linkedin_ads_data` index, updated BY id = ad_id directly
 *     (no search-then-update), and only written for status 1 (OCB) / 4 (OCR).
 *   - ES object/celebrity/brand are `||`-exploded ARRAYS; ocr is a plain STRING; brand is
 *     written under the key `image_brand`. No multilingual (`_ru/_fr/_sp/_exactly`) family.
 *   - MySQL stores the RAW body values (kept-if-omitted), NOT the ES arrays.
 */

const repo = require('../repository');

const ES_DOC_TYPE = 'doc';

// isset()-parity: a field counts as "sent" only when present and not null.
const isSet = (v) => v !== undefined && v !== null;
const keepIfMissing = (sent, existing) => (isSet(sent) ? sent : existing);

// PHP empty(): '', '0', null, undefined, 0, false all count as empty.
const phpEmpty = (v) => v === undefined || v === null || v === '' || v === '0' || v === 0 || v === false;

// PHP loose `== 0` (null/''/'0'/0 → true; undefined / non-zero → false). Mirrors the
// image_text_final_status check, where a NULL column must also count as 0.
const looseIsZero = (v) => v !== undefined && Number(v) === 0;

// PHP explode("||", value): undefined/null collapse to '' so we always get [''] (not a throw).
const explodePipes = (v) => String(v === undefined || v === null ? '' : v).split('||');

function nowDateTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function esResult(res) {
  return res?.result || res?.body?.result || null;
}

async function updateImageInfo(db, log, body) {
  const response = {};
  const sql = db?.sql;
  const elastic = db?.elastic;
  const ES_INDEX = elastic?.indexName || 'linkedin_ads_data';

  const adId = body.ad_id;
  const statusNum = body.status === undefined || body.status === null ? null : Number(body.status);

  try {
    if (!sql || !elastic) {
      response.code = 401;
      response.message = 'Image Object not updated';
      return response;
    }

    // Load both rows up front (PHP: ->first() on each table).
    const variant = await repo.getVariantByAdId(sql, adId);
    const ocrDetail = await repo.getOcrDetailByAdId(sql, adId);

    // ── 1. linkedin_ad_variants — status / image_text_final_status (only if the row exists) ──
    if (variant) {
      const updateVariants = {};
      if (looseIsZero(variant.image_text_final_status)) {
        updateVariants.image_text_final_status = body.status;
      }
      if (statusNum === 1 || statusNum === 4) {
        updateVariants.image_url_status = statusNum;
      } else if (statusNum === 2) {
        const anyNull = Object.values(variant).some((v) => v === null);
        updateVariants.image_url_status = anyNull ? 3 : 1;
      }
      if (Object.keys(updateVariants).length) {
        await repo.updateVariant(sql, adId, updateVariants);
      }
    }

    // ── 2 + 3. linkedin_ad_ocr_ocb_details (MySQL) then Elasticsearch — both gated on the OCR row existing ──
    if (!ocrDetail) {
      response.code = 400;
      response.message = 'Please enter valid ad_id';
      return response;
    }

    // MySQL: RAW body values (image_ocr kept from the existing OCR row when not sent).
    const ocrVariants = {
      image_object: isSet(body.object) ? body.object : null,
      image_celebrity: isSet(body.celebrity) ? body.celebrity : null,
      image_brand_logo: isSet(body.brand_logo) ? body.brand_logo : null,
      image_ocr: keepIfMissing(body.ocr, ocrDetail.image_ocr),
    };
    if (statusNum === 1) ocrVariants.object_update_date = nowDateTime();
    if (statusNum === 4) ocrVariants.ocr_updated_date = nowDateTime();

    try {
      await repo.updateOcrDetail(sql, adId, ocrVariants);

      // ES: object/celebrity/brand as `||`-exploded arrays (null when the first element is
      // PHP-empty); ocr as a plain string. Written for status 1 (OCB) / 4 (OCR).
      const object = explodePipes(body.object);
      const celebrity = explodePipes(body.celebrity);
      const brandLogo = explodePipes(body.brand_logo);
      const ocr = body.ocr;

      const docValue = {};
      if (statusNum === 4) {
        docValue.image_ocr = ocr;
      }
      if (statusNum === 1) {
        docValue.image_object = !phpEmpty(object[0]) ? object : null;
        docValue.image_celebrity = !phpEmpty(celebrity[0]) ? celebrity : null;
        docValue.image_brand = !phpEmpty(brandLogo[0]) ? brandLogo : null;
      }

      const updRes = await elastic.update({
        index: ES_INDEX,
        type: ES_DOC_TYPE,
        id: adId,
        body: { doc: docValue, detect_noop: false },
      });

      if (esResult(updRes) === 'updated') {
        response.code = 200;
        response.message = 'Image Data Updated Successfully';
      } else {
        response.code = 400;
        response.message = 'Image Object not updated';
      }
      return response;
    } catch (esErr) {
      log?.error?.('linkedin.ocr.updateImageInfo elasticUpdate failed', { adId, error: esErr.message });
      response.code = 401;
      response.message = 'Image Object not updated';
      return response;
    }
  } catch (e) {
    log?.error?.('linkedin.ocr.updateImageInfo failed', { adId, error: e.message });
    response.code = 401;
    response.message = 'Image Object not updated';
    return response;
  }
}

module.exports = { updateImageInfo };
