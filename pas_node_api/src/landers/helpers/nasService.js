/**
 * Landers NAS helper - wrapper around insertion's nasClient
 * Shared across all network landers implementations
 */

const fs = require('fs').promises;
const path = require('path');
const { storeInNas } = require('../../insertion/helpers/nasClient');

/**
 * Get NAS folder based on status
 * @param {number} status - 1=BLACKHAT, 2=WHITEHAT
 * @returns {string} Folder name
 */
function getNASFolder(status) {
  return status === 1 ? 'BLACKHAT' : 'WHITEHAT';
}

/**
 * Generate unique filename for NAS
 * @param {number} adId - Advertisement ID
 * @param {string} country - Country code
 * @param {number} status - Status code
 * @param {string} extension - File extension
 * @returns {string} Generated filename
 */
function generateFileName(adId, country, status, extension) {
  const timestamp = Math.floor(Date.now() / 1000);
  return `${adId}_${country}_${status}_${timestamp}.${extension}`;
}

/**
 * Get file extension from filename
 * @param {string} filename - Full filename
 * @returns {string} File extension
 */
function getFileExtension(filename) {
  return filename.split('.').pop().toLowerCase();
}

/**
 * Upload file to NAS
 * @param {string} localFilePath - Path to local file
 * @param {number} adId - Advertisement ID
 * @param {number} status - Status code (1=BLACKHAT, 2=WHITEHAT)
 * @param {string} network - Network name (default: 'native')
 * @returns {Promise<string>} NAS path
 */
async function uploadToNAS(localFilePath, adId, status, network = 'native') {
  try {
    const nasType = getNASFolder(status);

    // Use insertion's nasClient: storeInNas(type, filePath, adId, network, keyBaseName)
    const nasPath = await storeInNas(nasType, localFilePath, adId, network, `${adId}`);

    console.log(`[NAS Upload] Local: ${localFilePath} → NAS: ${nasPath}`);
    return nasPath;
  } catch (error) {
    console.error('NAS upload error:', error);
    throw error;
  }
}

/**
 * Delete local temp file
 * @param {string} filePath - Path to temp file
 * @returns {Promise<void>}
 */
async function deleteTempFile(filePath) {
  try {
    await fs.unlink(filePath);
    console.log(`[Cleanup] Deleted temp file: ${filePath}`);
  } catch (error) {
    console.error('Error deleting temp file:', error);
  }
}

/**
 * Ensure temp directory exists
 * @param {string} directory - Directory path
 * @returns {Promise<void>}
 */
async function ensureTempDirectory(directory) {
  try {
    await fs.mkdir(directory, { recursive: true });
  } catch (error) {
    console.error('Error creating directory:', error);
    throw error;
  }
}

module.exports = {
  getNASFolder,
  generateFileName,
  getFileExtension,
  uploadToNAS,
  deleteTempFile,
  ensureTempDirectory,
};
