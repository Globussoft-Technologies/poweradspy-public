'use strict';

/**
 * GDN OCR/OCB controller (thin).
 *
 * HTTP-facing layer for the image OCB/OCR pipeline: validates the request and
 * delegates to the two services. Each returns a plain { code, message, ... } object;
 * the route always replies HTTP 200 with that body (PHP contract — outcome is in `code`).
 * Mirrors the controller→service layering used by the gdn landers endpoints.
 */

const { leaseImages } = require('../ocr/services/getImageUrlService');
const { updateImageInfo } = require('../ocr/services/updateImageOcrService');

// GET getGDNImageUrl — `status` accepted in the query string (also body, PHP parity).
async function getImageUrl(req, db, log) {
  const status = req.query?.status ?? req.body?.status;
  if (status === undefined || status === null || status === '') {
    return { code: 400, message: JSON.stringify(['The status field is required.']), data: [] };
  }
  return leaseImages(db, log, status);
}

// POST insert-GDN-imageUrl-data — `ad_id` required.
async function updateImageOcr(req, db, log) {
  const body = req.body || {};
  if (body.ad_id === undefined || body.ad_id === null || body.ad_id === '') {
    return { code: 400, message: JSON.stringify(['The ad_id field is required.']), data: [] };
  }
  return updateImageInfo(db, log, body);
}

module.exports = { getImageUrl, updateImageOcr };
