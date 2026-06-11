import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";

import {
  updateDocument,
  getAdsLander,
  searchDoc,
} from "../../utils/elasticSearch.js";
import db from "../../Sequelize_cli/models/index.js";

const { tiktok_ad_html_lander: LANDER } = db;

class landerServices {
  // Get ads with country code
  async getAdwithCountryCode(req, res, next) {
    const transaction = await db.sequelize.transaction();
    try {
      const landerAds = await getAdsLander("tiktok_ads");

      if (landerAds.length === 0) {
        logger.info("No urls found");
        return res.send(Response.userSuccessResp("No urls found", ""));
      }

      const EsUpdatePromises = landerAds.map((ad) =>
        updateDocument("sql_id", ad.ad_id, { landerStatus: 1 })
      );
      const SqlUpdatePromises = landerAds.map((ad) =>
        LANDER.update(
          { status: 1 },
          { where: { ad_id: ad.ad_id }, transaction }
        )
      );
      await Promise.all([...SqlUpdatePromises, ...EsUpdatePromises]);
      await transaction.commit();

      logger.info("Fetched urls successfully", landerAds);
      return res.send(
        Response.userSuccessResp("Fetched urls successfully", landerAds)
      );
    } catch (error) {
      await transaction.rollback();
      logger.error("Error fetching ads", error);
      // console.error("Error:", error);
      return res.send(Response.userFailResp("Error fetching ads", error));
    }
    finally {
      if (transaction) {
          try {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
              await transaction.rollback();
            }
          } catch (error) {
              logger.error("Error releasing transaction connection", error);
          }
      }
}
  }

  // Upload file to s3
  async uploadFileToServer(req, res, next) {
    try {
      const imageUrl = req.files["image.png"][0].location.split("/").pop();
      const zipUrl = req.files["file.zip"][0].location.split("/").pop();

      logger.info("Files uploaded successfully", { imageUrl, zipUrl });
      return res.send(
        Response.userSuccessResp("Files uploaded successfully", {
          imageUrl,
          zipUrl,
        })
      );
    } catch (error) {
      // console.error("Error:", error);
      logger.error("Error uploading files", error);
      return res.send(Response.userFailResp("Error uploading files", error));
    }
  }

  // Insert lander data
  async insertLanderContent(req, res, next) {
    const transaction = await db.sequelize.transaction();
    try {
      const data = req.body;
      if (!data) {
        logger.error("Missing request data in body");
        return res.send(Response.validationFailResp("Missing request data in body", data));
      }
      if (!(await searchDoc("sql_id", data.ad_id))) {
        logger.error("No ad found with that ad_id", data.ad_id);
        return res.send(
          Response.validationFailResp("No ad found with that ad_id", data.ad_id)
        );
      }
      const insertOperations = [
        LANDER.update(
          { ...data, ad_id: data.ad_id },
          { where: { ad_id: data.ad_id }, transaction }
        ),
        updateDocument("sql_id", data.ad_id, {
          landerData: data,
          landerStatus: data.status,
        }),
      ];

      await Promise.all(insertOperations);
      await transaction.commit();
      logger.info("Lander data inserted successfully", data);
      return res.send(
        Response.userSuccessResp("Lander data inserted successfully", data)
      );
    } catch (error) {
      await transaction.rollback();
      // console.error("Error:", error);
      logger.error("Error inserting lander data", error);
      return res.send(Response.userFailResp("Error inserting lander data", error));
    }
    finally {
      if (transaction) {
          try {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
              await transaction.rollback();
            }
          } catch (error) {
              logger.error("Error releasing transaction connection", error);
          }
      }
}
  }
}
export default new landerServices();
