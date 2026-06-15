'use strict';

/**
 * Native OCR/OCB controller — thin HTTP layer over the OCR services.
 * Mirrors the nativeLandersController style (static methods, (req,res,next,service)).
 *
 *   GET  getNativeImageUrl → getImageUrl            (UserController@getImageUrl)
 *   POST update-image-info → updateImageOcrDetails  (UserController@updateImageOcrDetails)
 */

const GetImageUrlService = require('../ocr/services/getImageUrlService');
const UpdateImageOcrService = require('../ocr/services/updateImageOcrService');

class NativeOcrController {
  /**
   * GET /api/v1/native/ocr/getNativeImageUrl
   * Hands out a batch of image ads queued for OCR/OCB and marks them in-progress.
   * `status` is read from the query string (GET), falling back to the body.
   */
  static async getImageUrl(req, res, next, service) {
    try {
      const startTime = Date.now();
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
      result.exe_time = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));

      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in getImageUrl:', error);
      // PHP returns 401-coded body on failure, HTTP 200.
      return res.status(200).json({
        code: 401,
        message: 'No More Image are present',
        data: [],
      });
    }
  }

  /**
   * POST /api/v1/native/ocr/update-image-info
   * Persists OCR/OCB results into MySQL + Elasticsearch.
   */
  static async updateImageOcrDetails(req, res, next, service) {
    try {
      const postData = req.body || {};

      if (!postData.ad_id) {
        return res.status(200).json({
          code: 400,
          message: JSON.stringify(['The ad_id field is required.']),
          data: [],
        });
      }

      const result = await UpdateImageOcrService.updateImageOcrDetails(
        postData,
        service?.db || {},
        service?.log
      );

      return res.status(200).json(result);
    } catch (error) {
      console.error('Error in updateImageOcrDetails:', error);
      // PHP returns 401-coded body on failure, HTTP 200.
      return res.status(200).json({
        code: 401,
        message: 'Image Object not updated',
      });
    }
  }
}

module.exports = NativeOcrController;
