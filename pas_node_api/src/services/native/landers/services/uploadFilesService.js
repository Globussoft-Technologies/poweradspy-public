const {
  generateFileName,
  uploadToNAS,
  deleteTempFile,
  getFileExtension,
} = require('../../../../landers/helpers/nasService');

class UploadFilesService {
  /**
   * Upload blackhat/whitehat content
   */
  static async uploadBlackhatContent(adId, country, status, mediaFile, zipFile) {
    const uploadedPaths = {};

    try {
      // Validate: at least one file must be present
      if (!mediaFile && !zipFile) {
        return {
          code: 404,
          message: 'no file found',
        };
      }

      // Process media (screenshot) file
      if (mediaFile) {
        try {
          const imagePath = await this.processImageFile(
            adId,
            country,
            status,
            mediaFile
          );
          uploadedPaths.image_path = imagePath;
        } catch (error) {
          console.error('Error uploading image:', error);
          throw error;
        }
      }

      // Process zip file (HTML)
      if (zipFile) {
        try {
          const htmlPath = await this.processZipFile(adId, country, status, zipFile);
          uploadedPaths.html_path = htmlPath;
        } catch (error) {
          console.error('Error uploading zip:', error);
          throw error;
        }
      }

      return {
        code: 200,
        message: 'files are stored successfully',
        ...uploadedPaths,
      };
    } catch (error) {
      console.error('Error in uploadBlackhatContent:', error);
      throw error;
    }
  }

  /**
   * Process and upload image file
   */
  static async processImageFile(adId, country, status, mediaFile) {
    try {
      const extension = getFileExtension(mediaFile.originalname);
      const fileName = generateFileName(adId, country, status, extension);

      // In development: store locally, in production: upload to NAS
      const nasPath = await uploadToNAS(mediaFile.path, adId, status);

      // Clean up temp file
      await deleteTempFile(mediaFile.path);

      return nasPath;
    } catch (error) {
      console.error('Error processing image:', error);
      throw error;
    }
  }

  /**
   * Process and upload zip file
   */
  static async processZipFile(adId, country, status, zipFile) {
    try {
      const extension = getFileExtension(zipFile.originalname);
      const fileName = generateFileName(adId, country, status, extension);

      // Upload to NAS
      const nasPath = await uploadToNAS(zipFile.path, adId, status);

      // Clean up temp file
      await deleteTempFile(zipFile.path);

      return nasPath;
    } catch (error) {
      console.error('Error processing zip:', error);
      throw error;
    }
  }

  /**
   * Validate upload request
   */
  static validateRequest(body, files) {
    const errors = [];

    // Validate required fields
    if (!body.ad_id) errors.push('ad_id is required');
    if (!body.country) errors.push('country is required');
    if (!body.status) errors.push('status is required');

    // Validate status value
    if (body.status && ![1, 2].includes(parseInt(body.status))) {
      errors.push('status must be 1 (blackhat) or 2 (whitehat)');
    }

    // Validate at least one file
    const hasMedia = files && files.media && files.media.length > 0;
    const hasZip = files && files.zip && files.zip.length > 0;

    if (!hasMedia && !hasZip) {
      errors.push('At least one of media or zip file is required');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

module.exports = UploadFilesService;
