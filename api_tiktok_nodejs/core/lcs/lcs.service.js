// Imports
import db from "../../Sequelize_cli/models/index.js";
import Response from "../../utils/response.js";
import { updateDocument, searchDoc } from "../../utils/elasticSearch.js";
import tiktokService from "../tiktok/tiktok.service.js";
import logger from "../../resources/logs/logger.log.js";

// Models
const { tiktok_ad_analytics: ANALYTICS } = db;

class lcsService {
  // Update lcs
  async update(req, res) {
    const data = req?.body;

    if (!data) {
      logger.error("Missing request data");
      return res.send(Response.validationFailResp("Missing request data", ""));
    }

    const transaction = await db.sequelize.transaction();

    try {
      const adExist = await searchDoc("sql_id", data.id);
      if (!adExist) {
        logger.error("No ad found with ad_id", data.ad_id);
        return res.send(
          Response.validationFailResp("No ad found with ad_id", data.ad_id)
        );
      }

      const { likes, comments, shares } = data;
      const shouldUpdate =
        adExist.likes !== likes ||
        adExist.comments !== comments ||
        adExist.shares !== shares;

      if (shouldUpdate) {
        let [popularity, impression] = tiktokService.popularityImpression(
          adExist.clicks_graph,
          adExist.ctr,
          likes,
          comments,
          shares
        );
        const adOperations = [
          ANALYTICS.create(
            {
              likes,
              comments,
              shares,
              popularity,
              impression,
              ad_id: adExist.sql_id,
            },
            { transaction }
          ),
          updateDocument("sql_id", adExist.sql_id, {
            likes,
            comments,
            shares,
            popularity,
            impression,
          }),
        ];

        await Promise.all(adOperations);
        await transaction.commit();
        logger.info("LCS updated successfully", { ...data });
        return res.send(
          Response.userSuccessResp("LCS updated successfully", { ...data })
        );
      }
      logger.info("LCS data is up to date", { ...data });
      return res.send(
        Response.userSuccessResp("LCS data is up to date", { ...data })
      );
    } catch (error) {
      await transaction.rollback();
      logger.error("Error updating LCS", error);
      // console.error("Error:", error);
      return res.send(Response.userFailResp("Error updating LCS", error));
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
  async getLCS(req, res) {
    const id = req?.params?.id;
    try {
      if (!id) {
        logger.error("Missing id field", id);
        return res.send(Response.validationFailResp("Missing id field", id));
      }
      const lcs = await ANALYTICS.findAll({
        where: {
          ad_id: id,
        },
      });
      if (!lcs.length) {
        logger.error("No ad found with ad_id", id);
        return res.send(
          Response.validationFailResp("No ad found with ad_id", id)
        );
      }
      const transformedData = lcs.map((data) => ({
        likes: data.likes,
        comments: data.comments,
        shares: data.shares,
        date: data.createdAt,
      }));

      return res.send(
        Response.userSuccessResp("LCS fetched successfully", transformedData)
      );
    } catch (error) {
      logger.error("Error fetching LCS", error);
      return res.send(Response.userFailResp("Error fetching LCS", error));
    }
  }
}

export default new lcsService();
