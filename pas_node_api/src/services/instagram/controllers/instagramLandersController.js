const GetAdsService = require('../landers/getAdsService');
const UploadService = require('../landers/uploadService');
const InsertHtmlContentService = require('../landers/insertHtmlContentService');

class LandersController {
  static async getInstagramAdsWithCountry(req, res, next, service) {
    try {
      const startTime = Date.now();
      const db = service?.db || {};

      const ads = await GetAdsService.fetchAdsForScraping(db);

      const exeTime = ((Date.now() - startTime) / 1000).toFixed(2);

      return res.json({
        code: 200,
        message: 'Ads fetched successfully',
        data: ads,
        exe_time: parseFloat(exeTime),
      });
    } catch (error) {
      console.error('Error in getInstagramAdsWithCountry:', error);
      return res.status(500).json({
        code: 500,
        message: 'Internal server error',
        error: error.message,
      });
    }
  }

  static async uploadBlackhatContent(req, res, next, service) {
    try {
      const { ad_id, country, status } = req.body;
      const files = req.files || {};
      const db = service?.db || {};

      const validation = UploadService.validateRequest(req.body, req.files);
      if (!validation.isValid) {
        return res.status(400).json({
          code: 400,
          message: 'Validation failed',
          errors: validation.errors,
        });
      }

      const result = await UploadService.uploadBlackhatContent(
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

  static async insertHtmlContent(req, res, next, service) {
    try {
      const startTime = Date.now();
      const requestArray = Array.isArray(req.body) ? req.body : [req.body];
      const db = service?.db || {};

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

      const result = await InsertHtmlContentService.insertHtmlContent(
        requestArray,
        db
      );

      const exeTime = ((Date.now() - startTime) / 1000).toFixed(2);
      result.exe_time = parseFloat(exeTime);

      return res.json(result);
    } catch (error) {
      console.error('Error in insertHtmlContent:', error);

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
