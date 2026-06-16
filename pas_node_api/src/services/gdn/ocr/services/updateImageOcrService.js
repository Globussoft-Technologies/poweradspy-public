'use strict';

/**
 * GDN OCR/OCB — insertGDNImageData (report results).
 *
 * Faithful port of api_gdn ApiController@insertGDNImageData, the handler behind
 * `POST insert-GDN-imageUrl-data`. Persists scraper output into Elasticsearch
 * (gdn_search_mix) FIRST, then — only if the ES update succeeded — into MySQL
 * (gdn_ad_variants). This ordering is the reverse of Facebook and is preserved verbatim.
 *
 * Body:
 *   ad_id      (required) — internal gdn_ad.id (variant keyed by gdn_ad_id)
 *   status     1 = OCB done · 4 = OCR done
 *   object     delimited (`||,`, `||`, or `|`), nullable
 *   celebrity  delimited, nullable
 *   brand_logo delimited, nullable
 *   ocr        delimited; if omitted, the existing image_ocr is kept
 *
 * GDN specifics vs Facebook:
 *   - ES stores NORMALIZED `||`-joined STRINGS (not arrays). Any of `||,`/`||`/`|`
 *     delimiters in the input collapse to `||`.
 *   - MySQL stores the RAW body values (kept-if-omitted), NOT the normalized strings.
 *   - image_url_status: 1 if the pre-update row already had object+celebrity+brand+ocr
 *     all non-null; else `status` (when 1 or 4).
 */

const repo = require('../repository');

const ES_DOC_TYPE = 'doc';

/**
 * PHP multi-delimiter normalization: collapse `||,` / `||` / `|` to a single
 * `||`-joined string (first matching delimiter wins, mirroring the if/else-if chain).
 */
function normalizePipes(v) {
  const s = v === undefined || v === null ? '' : String(v);
  let parts;
  if (s.includes('||,')) parts = s.split('||,');
  else if (s.includes('||')) parts = s.split('||');
  else if (s.includes('|')) parts = s.split('|');
  else return s;
  return parts.join('||');
}

// isset()-parity: keep the existing column value only when the key is truly absent.
const keepIfMissing = (sent, existing) => (sent === undefined || sent === null ? existing : sent);

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
  const ES_INDEX = elastic?.indexName || 'gdn_search_mix';

  const adId = body.ad_id;
  const statusNum = body.status === undefined || body.status === null ? null : Number(body.status);

  try {
    if (!sql || !elastic) {
      response.code = 400;
      response.message = 'Some Error occurred';
      return response;
    }

    // 1. The variant row must exist.
    const existing = await repo.getVariantByAdId(sql, adId);
    if (!existing) {
      response.code = 400;
      response.message = 'gdn_ad_id not present in gdn_ad_variants table';
      return response;
    }

    // 2. The ad must exist in Elasticsearch (gdn_search_mix, match gdn_ad.id).
    const found = await elastic.search({
      index: ES_INDEX,
      type: ES_DOC_TYPE,
      body: { query: { match: { 'gdn_ad.id': adId } } },
    });
    const hits = esHits(found);
    if (!hits.length) {
      response.code = 400;
      response.message = 'Ad not found';
      return response;
    }

    // 3. ES update FIRST — normalized `||`-joined strings.
    const object = normalizePipes(body.object);
    const celebrity = normalizePipes(body.celebrity);
    const brandLogo = normalizePipes(body.brand_logo);
    const ocr = normalizePipes(body.ocr);

    const docValue = {
      'gdn_ad_variants.image_object': object,
      'gdn_ad_variants.image_object_ru': object,
      'gdn_ad_variants.image_object_fr': object,
      'gdn_ad_variants.image_object_sp': object,
      'gdn_ad_variants.image_object_exactly': object,
      'gdn_ad_variants.image_celebrity': celebrity,
      'gdn_ad_variants.image_celebrity_ru': celebrity,
      'gdn_ad_variants.image_celebrity_fr': celebrity,
      'gdn_ad_variants.image_celebrity_sp': celebrity,
      'gdn_ad_variants.image_celebrity_exactly': celebrity,
      'gdn_ad_variants.image_brand_logo': brandLogo,
      'gdn_ad_variants.image_brand_logo_ru': brandLogo,
      'gdn_ad_variants.image_brand_logo_fr': brandLogo,
      'gdn_ad_variants.image_brand_logo_sp': brandLogo,
      'gdn_ad_variants.image_brand_logo_exactly': brandLogo,
    };
    if (statusNum === 4) {
      Object.assign(docValue, {
        'gdn_ad_variants.image_ocr': ocr,
        'gdn_ad_variants.image_ocr_ru': ocr,
        'gdn_ad_variants.image_ocr_fr': ocr,
        'gdn_ad_variants.image_ocr_sp': ocr,
        'gdn_ad_variants.image_ocr_exactly': ocr,
      });
    }

    const updRes = await elastic.update({
      index: ES_INDEX,
      type: ES_DOC_TYPE,
      id: hits[0]._id,
      body: { doc: docValue, detect_noop: false },
    });

    if (esResult(updRes) !== 'updated') {
      response.code = 400;
      response.message = 'ad not found';
      return response;
    }

    // 4. MySQL write — RAW body values (kept if omitted), driven off the PRE-update row.
    const updateData = {
      image_object: keepIfMissing(body.object, existing.image_object),
      image_celebrity: keepIfMissing(body.celebrity, existing.image_celebrity),
      image_brand_logo: keepIfMissing(body.brand_logo, existing.image_brand_logo),
      image_ocr: keepIfMissing(body.ocr, existing.image_ocr),
    };

    if (statusNum === 1) updateData.object_update_date = nowDateTime();
    if (statusNum === 4) updateData.ocr_updated_date = nowDateTime();

    if (Number(existing.image_text_final_status) === 0) {
      updateData.image_text_final_status = body.status;
    }

    const allPresent = existing.image_object != null && existing.image_celebrity != null
      && existing.image_brand_logo != null && existing.image_ocr != null;
    if (allPresent) {
      updateData.image_url_status = 1;
    } else if (statusNum === 1 || statusNum === 4) {
      updateData.image_url_status = statusNum;
    }

    await repo.updateVariant(sql, adId, updateData);

    response.code = 200;
    response.message = 'Image Data Updated Successfully';
    return response;
  } catch (e) {
    log?.error?.('gdn.ocr.updateImageInfo failed', { adId, error: e.message });
    response.code = 400;
    response.message = 'Some Error occurred';
    return response;
  }
}

module.exports = { updateImageInfo };
