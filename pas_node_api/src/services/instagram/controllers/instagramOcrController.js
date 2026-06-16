'use strict';

/**
 * Instagram OCR/OCB controller — thin HTTP layer over the OCR services.
 * Mirrors the nativeOcrController style (static methods, (req,res,next,service)).
 *
 *   GET  getImageUrl        → getImageUrl          (AdDetails@getImageUrls)
 *   POST updateImageDetails → updateImageDetails   (AdDetails@updateImageDetails)
 *
 * Faithful to the PHP contract: every response is HTTP 200 — the real outcome is
 * carried in the body `code` field — so existing scraper clients keep working.
 */

const GetImageUrlService = require('../ocr/services/getImageUrlService');
const UpdateImageDetailsService = require('../ocr/services/updateImageDetailsService');

class InstagramOcrController {
  /**
   * GET /api/v1/instagram/ocr/getImageUrl
   * Hands out a batch of image ads queued for OCR/OCB and marks them in-progress.
   * `status` is read from the query string (GET), falling back to the body.
   */
  static async getImageUrl(req, res, next, service) {
    try {
      const raw = req.query.status ?? req.body?.status;

      if (raw === undefined || raw === null || raw === '') {
        return res.status(200).json({
          code: 400,
          message: JSON.stringify(['The status field is required.']),
          data: [],
        });
      }

      const result = await GetImageUrlService.getImageUrl(
        service?.db || {},
        Number(raw),
        service?.log
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in Instagram getImageUrl:', error);
      // PHP returns a 401-coded body on failure, HTTP 200.
      return res.status(200).json({
        code: 401,
        message: 'No More Image are present',
        data: [],
      });
    }
  }

  /**
   * POST /api/v1/instagram/ocr/updateImageDetails
   * Persists OCR/OCB results into MySQL + Elasticsearch.
   */
  static async updateImageDetails(req, res, next, service) {
    try {
      const postData = req.body || {};

      if (postData.ad_id === undefined || postData.ad_id === null || postData.ad_id === '') {
        return res.status(200).json({
          code: 400,
          message: 'Some Error occurred',
        });
      }

      const result = await UpdateImageDetailsService.updateImageDetails(
        postData,
        service?.db || {},
        service?.log
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in Instagram updateImageDetails:', error);
      // PHP catch returns the raw error; we keep a 401-coded body, HTTP 200.
      return res.status(200).json({
        code: 401,
        message: 'Image Object not updated',
      });
    }
  }
}

module.exports = InstagramOcrController;
