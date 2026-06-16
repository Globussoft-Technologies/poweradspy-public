'use strict';

/**
 * Reddit OCR/OCB controller — thin HTTP layer over the OCR services.
 * Mirrors the quoraOcrController / nativeOcrController style
 * (static methods, (req,res,next,service)).
 *
 *   GET  getImageUrl         → getImageUrl          (AdDetailsController@getImagesUrl)
 *   POST updateImageDetails  → updateImageDetails   (AdDetailsController@updateImageDetails)
 *
 * Every response is HTTP 200; the real outcome is in the body `code` field —
 * faithful to the PHP contract so existing scraper clients keep working unchanged.
 */

const GetImageUrlService = require('../ocr/services/getImageUrlService');
const UpdateImageOcrService = require('../ocr/services/updateImageOcrService');

class RedditOcrController {
  /**
   * GET /api/v1/reddit/ocr/getImageUrl
   * Hands out a batch of image ads queued for OCR/OCB and marks them in-progress.
   * `status` is read from the query string (GET), falling back to the body.
   */
  static async getImageUrl(req, res, next, service) {
    try {
      const startTime = Date.now();
      const raw = req.query.status ?? req.body?.status;

      // PHP Validator: status required.
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
      result.exe_time = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));

      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getImageUrl:', error);
      // PHP catch returns 401-coded body on failure, HTTP 200.
      return res.status(200).json({
        code: 401,
        message: 'No More Image are present',
        data: [],
      });
    }
  }

  /**
   * POST /api/v1/reddit/ocr/updateImageDetails
   * Persists OCR/OCB results into MySQL + Elasticsearch.
   */
  static async updateImageDetails(req, res, next, service) {
    try {
      const postData = req.body || {};

      const result = await UpdateImageOcrService.updateImageDetails(
        postData,
        service?.db || {},
        service?.log
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in updateImageDetails:', error);
      // PHP outer catch returns 400 "Some Error occured", HTTP 200.
      return res.status(200).json({
        code: 400,
        message: 'Some Error occured',
      });
    }
  }
}

module.exports = RedditOcrController;
