'use strict';

/**
 * YouTube OCB/OCR controller (thin).
 *
 * HTTP-facing layer for the image OCB/OCR pipeline. Validates the request and maps the
 * service result to the PHP buildResponse body shape (helper::buildResponse — note the
 * `messages` plural key). The route always replies HTTP 200; the outcome is the body code.
 */

const { leaseOcb } = require('../ocr/services/getOcbUrlService');
const { insertUpdateOcb } = require('../ocr/services/insertUpdateOcbService');

/** Port of api_youtube helper::buildResponse($code, $response). */
function buildResponse(code, payload) {
  const res = { code };
  if (code === 404) {
    res.messages = 'Missing Parameter';
    res.error = payload ?? '';
  } else if (code === 200) {
    res.messages = 'Success';
    if (payload !== '' && payload !== undefined && payload !== null) res.data = payload;
  } else if (code === 500) {
    res.messages = payload;
  } else if (code === 400) {
    res.messages = 'No data found';
  }
  return res;
}

// GET get-ocb-url — `type` (1=image, 2=video) in the query string (also body).
async function getOcbUrl(req, db, log) {
  const type = req.query?.type ?? req.body?.type;
  const result = await leaseOcb(db, log, type);
  // Lease returns a bare { code, data? } → shape it with buildResponse, matching PHP.
  return buildResponse(result.code, result.code === 200 ? result.data : '');
}

// POST insert-update-ocb — `status` and `ad_id` required (PHP validator).
async function updateOcb(req, db, log) {
  const body = req.body || {};
  const missing =
    body.status === undefined || body.status === null || body.status === '' ||
    body.ad_id === undefined || body.ad_id === null || body.ad_id === '';
  if (missing) {
    return buildResponse(404, ''); // validation fails → Missing Parameter
  }
  // The model already returns a { code, message } (or { code, messages } on 500) body.
  return insertUpdateOcb(db, log, body);
}

module.exports = { getOcbUrl, updateOcb };
