const GetNativeAdsService = require('../landers/services/getNativeAdsService');
const UploadFilesService = require('../landers/services/uploadFilesService');
const InsertHtmlContentService = require('../landers/services/insertHtmlContentService');

class LandersController {
  /**
   * GET /api/landers/get_ads_for_blackhat
   * Fetch ads with status=0 and return ISO codes
   */
  static async getNativeAdsWithCountry(req, res, next, service) {
    try {
      const startTime = Date.now();
      const db = service?.db || {};

      const ads = await GetNativeAdsService.fetchAdsForScraping(db);

      const exeTime = ((Date.now() - startTime) / 1000).toFixed(2);

      return res.json({
        code: 200,
        message: 'Ads fetched successfully',
        data: ads,
        exe_time: parseFloat(exeTime),
      });
    } catch (error) {
      console.error('Error in getNativeAdsWithCountry:', error);
      return res.status(500).json({
        code: 500,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }

  /**
   * POST /api/landers/upload_native_blackhat
   * Upload screenshot and HTML zip files
   */
  static async uploadBlackhatContent(req, res, next, service) {
    try {
      const { ad_id, country, status } = req.body;
      const files = req.files || {};
      const db = service?.db || {};

      // Validate request
      const validation = UploadFilesService.validateRequest(
        req.body,
        req.files
      );
      if (!validation.isValid) {
        return res.status(400).json({
          code: 400,
          message: 'Validation failed',
          errors: validation.errors,
        });
      }

      // Upload files
      const result = await UploadFilesService.uploadBlackhatContent(
        ad_id,
        country,
        parseInt(status),
        files.media ? files.media[0] : null,
        files.zip ? files.zip[0] : null,
        db
      );

      if (result.code !== 200) {
        return res.status(404).json(result);
      }

      return res.json(result);
    } catch (error) {
      console.error('Error in uploadBlackhatContent:', error);
      return res.status(500).json({
        code: 500,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }

  /**
   * POST /api/landers/insert_html_content
   * Insert HTML content and metadata
   */
  static async insertHtmlContent(req, res, next, service) {
    try {
      const startTime = Date.now();
      const requestArray = Array.isArray(req.body) ? req.body : [req.body];
      const db = service?.db || {};

      // Validate each item
      for (const item of requestArray) {
        const validation = InsertHtmlContentService.validateRequest(item);
        if (!validation.isValid) {
          return res.status(400).json({
            code: 400,
            message: 'Validation failed',
            errors: validation.errors,
            adId: item.ad_id,
          });
        }
      }

      // Process all items
      const result = await InsertHtmlContentService.insertHtmlContent(
        requestArray,
        db
      );

      const exeTime = ((Date.now() - startTime) / 1000).toFixed(2);
      result.exe_time = parseFloat(exeTime);

      return res.json(result);
    } catch (error) {
      console.error('Error in insertHtmlContent:', error);

      // Handle specific errors
      if (error.message === 'ad not found') {
        return res.status(400).json({
          code: 400,
          message: 'ad not found',
        });
      }

      return res.status(500).json({
        code: 500,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }
}

module.exports = LandersController;
