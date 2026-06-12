'use strict';

const fs = require('fs').promises;
const { storeInNas } = require('../../../insertion/helpers/nasClient');

/**
 * uploadBlackhatContent — handles media/zip file uploads to NAS.
 * Mirrors PHP: BlackhatController@uploadBlackhatContent
 *
 * status 1 = blackhat residential → NAS type BLACKHAT
 * status 2 = blackhat data center (whitehat) → NAS type WHITEHAT
 */
async function uploadBlackhatContent(req) {
  const { ad_id, country, status } = req.body;
  const { media, zip } = req.files || {};

  try {
    // Validate request
    if (!ad_id || !country || !status) {
      return {
        code: 400,
        message: 'Missing required fields: ad_id, country, status'
      };
    }

    if (!media && !zip) {
      return {
        code: 404,
        message: "File not found or File type should be 'media' or 'zip'"
      };
    }

    const response = {
      code: 200,
      message: 'Files are stored successfully'
    };

    const timestamp = Math.floor(Date.now() / 1000);
    const keyBaseName = `${ad_id}_${country}_${status}_${timestamp}`;

    // Process media file (screenshot)
    if (media && media.length > 0) {
      try {
        const mediaFile = media[0];
        const nasType = String(status) === '1' ? 'BLACKHAT' : 'WHITEHAT';
        const nasPath = await storeInNas(
          nasType,
          mediaFile.path,
          ad_id,
          'reddit',
          keyBaseName
        );
        response.image_path = nasPath;
        await fs.unlink(mediaFile.path).catch(() => {});
      } catch (error) {
        console.error('[reddit-landers] Error uploading media file:', error);
        throw error;
      }
    }

    // Process zip file
    if (zip && zip.length > 0) {
      try {
        const zipFile = zip[0];
        const nasType = String(status) === '1' ? 'BLACKHAT' : 'WHITEHAT';
        const nasPath = await storeInNas(
          nasType,
          zipFile.path,
          ad_id,
          'reddit',
          keyBaseName
        );
        response.html_path = nasPath;
        await fs.unlink(zipFile.path).catch(() => {});
      } catch (error) {
        console.error('[reddit-landers] Error uploading zip file:', error);
        throw error;
      }
    }

    return response;
  } catch (error) {
    console.error('[reddit-landers] Error in uploadBlackhatContent:', error);
    return {
      code: 400,
      message: `Exception occur during upload zip file and blackhat or whithat content to s3 in uploadBlackhatContent function: ${error.message}`
    };
  }
}

module.exports = {
  uploadBlackhatContent
};
