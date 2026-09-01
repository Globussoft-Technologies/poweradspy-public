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

      const bodyIsEmpty =
        !req.body ||
        typeof req.body !== 'object' ||
        (Array.isArray(req.body)
          ? req.body.length === 0
          : Object.keys(req.body).length === 0);
      if (bodyIsEmpty) {
        return res.status(400).json({
          code: 400,
          message:
            'Request body is empty. Expected a JSON body (or array) with the lander fields, '
            + 'either flat or nested under an "insertData" object.',
        });
      }

      // Accept { insertData:{} } | { insertData:[{}] } | flat { ad_id, ... } | arrays of those.
      const requestArray = InsertHtmlContentService.normalizeLanderItems(req.body);
      const malformedIdx = requestArray
        .map((item, i) => (item ? -1 : i))
        .filter((i) => i >= 0);
      if (malformedIdx.length > 0) {
        return res.status(400).json({
          code: 400,
          message:
            requestArray.length === 1
              ? 'No lander details were found in the request body. Send the fields either at the top '
                + 'level or nested under a non-null "insertData" object.'
              : `No lander details were found for payload item(s) at index ${malformedIdx.join(', ')}. `
                + 'Each item must carry the fields at the top level or under a non-null "insertData" object.',
        });
      }

      const db = service?.db || {};

      if (!db.sql || !db.elastic) {
        return res.status(500).json({
          code: 500,
          message:
            `A backend dependency is not available (${!db.sql ? 'database' : 'search'} connection not initialised). `
            + 'The request was not processed; please retry shortly.',
        });
      }

      for (let i = 0; i < requestArray.length; i++) {
        const item = requestArray[i];
        const validation = InsertHtmlContentService.validateRequest(item);
        if (!validation.isValid) {
          return res.status(400).json({
            code: 400,
            message:
              requestArray.length === 1
                ? validation.errors.join(' ')
                : `Validation failed for payload item at index ${i}: ${validation.errors.join(' ')}`,
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
