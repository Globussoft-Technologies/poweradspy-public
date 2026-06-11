const fs = require('fs').promises;
const { storeInNas } = require('../../../insertion/helpers/nasClient');

class UploadService {
  static async deleteTempFile(filePath) {
    try {
      await fs.unlink(filePath);
  
    } catch (error) {
      console.error('Error deleting temp file:', error);
    }
  }

  static getFileExtension(filename) {
    return filename.split('.').pop().toLowerCase();
  }
  static async uploadBlackhatContent(adId, country, status, mediaFile, zipFile) {
    const uploadedPaths = {};

    try {
    

      if (!mediaFile && !zipFile) {
        return {
          code: 404,
          message: 'no file found',
        };
      }

      if (mediaFile) {
        try {
        
          const imagePath = await this.processImageFile(adId, country, status, mediaFile);
          uploadedPaths.image_path = imagePath;
          
        } catch (error) {
          console.error('Error uploading image:', error);
          throw error;
        }
      }

      if (zipFile) {
        try {
          
          const htmlPath = await this.processZipFile(adId, country, status, zipFile);
          uploadedPaths.html_path = htmlPath;
        
        } catch (error) {
          
          throw error;
        }
      }

      const response = {
        code: 200,
        message: 'files are stored successfully',
        ...uploadedPaths,
      };

   

      return response;
    } catch (error) {
      console.error('Error in uploadBlackhatContent:', error);
      throw error;
    }
  }

  static async processImageFile(adId, country, status, mediaFile) {
    try {
      const extension = this.getFileExtension(mediaFile.originalname);
      const timestamp = Math.floor(Date.now() / 1000);

      // Create unique keyBaseName: adId_country_status_timestamp
      const keyBaseName = `${adId}_${country}_${status}_${timestamp}`;

      // Determine NAS folder based on status
      const nasType = status === 1 ? 'BLACKHAT' : 'WHITEHAT';

      // Call nasClient directly
      const nasPath = await storeInNas(nasType, mediaFile.path, adId, 'instagram', keyBaseName);

      await this.deleteTempFile(mediaFile.path);
      
      return nasPath;
    } catch (error) {
      console.error('Error processing image:', error);
      throw error;
    }
  }

  static async processZipFile(adId, country, status, zipFile) {
    try {
      const fsSync = require('fs');
      const extension = this.getFileExtension(zipFile.originalname);

      

      const timestamp = Math.floor(Date.now() / 1000);

      // Create unique keyBaseName: adId_country_status_timestamp_html
      const keyBaseName = `${adId}_${country}_${status}_${timestamp}_html`;

      // Determine NAS folder based on status
      const nasType = status === 1 ? 'BLACKHAT' : 'WHITEHAT';

      // Call nasClient directly
      const nasPath = await storeInNas(nasType, zipFile.path, adId, 'instagram', keyBaseName);

      
      await this.deleteTempFile(zipFile.path);
      return nasPath;
    } catch (error) {
      console.error('Error processing zip:', error.message);
      throw error;
    }
  }

  static validateRequest(body, files) {
    const errors = [];

    if (!body.ad_id) errors.push('ad_id is required');
    if (!body.country) errors.push('country is required');
    if (!body.status) errors.push('status is required');

    if (body.status && ![1, 2].includes(parseInt(body.status))) {
      errors.push('status must be 1 (blackhat) or 2 (whitehat)');
    }

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

module.exports = UploadService;
