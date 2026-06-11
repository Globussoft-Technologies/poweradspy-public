import fs from "fs";
import path from "path";
import logger from "../resources/logs/logger.log.js";
import sharp from "sharp";
import FormData from "form-data";
import axios from "axios";
import config from "config";

export async function uploadFile(tempFolderPath, ad_id, network, type) {
 
  try {
    const files = await fs.promises.readdir(tempFolderPath);

    if (files.length === 0) {
      const errorMsg = "No files found in the temp folder.";
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const filePath = path.join(tempFolderPath, files[0]);
    const fileBuffer = await fs.promises.readFile(filePath);
    const webpBuffer = await sharp(fileBuffer)
      .webp({ quality: 4 })
      .toBuffer();

    const formData = new FormData();
    formData.append("files", webpBuffer, files[0]); 
    formData.append("adId", ad_id);
    formData.append("network", network);
    formData.append("type", type);
    formData.append("mode", config.get("nas_mode"));

    const formDataHeaders = formData.getHeaders();

    const response = await axios.post(
      config.get("nas_url"),
      formData,
      {
        headers: {
          ...formDataHeaders,
        },
      }
    );

    return response.data?.data;
  } catch (error) {
    // console.error("Error occurred during file upload:", error);
    logger.error("Error uploading file:", error.message || error);
    throw error; 
  }
}
