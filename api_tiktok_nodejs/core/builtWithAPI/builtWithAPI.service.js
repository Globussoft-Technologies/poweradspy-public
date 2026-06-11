import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import db from "../../Sequelize_cli/models/index.js";
import builtWithAPIValidation from "./builtWithAPI.validation.js";
import config from "config";
const tiktok_Meta_Data = db.tiktok_ad_meta_data;
class builtWithAPIService {
  //this function used for update the built with status
  async updateBuiltWithStatus(req, res) {
    try {
      const builtwithData = req?.body;
      const { value, error } =
        builtWithAPIValidation.createBuiltWith(builtwithData);

      logger.error(error);
      if (error)
        return res.send(Response.validationFailResp("VALIDATION_FAIL", error));

      const adExist = await tiktok_Meta_Data.findOne({
        where: { id: value.id },
      });
      if (!adExist) {
        return res.send(Response.userFailResp("Invalid Ad_id"));
      } else {
        let updated = await tiktok_Meta_Data.update(value, {
          where: { id: value.id },
        });
        return res.send(
          Response.userSuccessResp("built_with updated successfully", updated)
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      // console.log(err);
      return res.send(Response.userFailResp("Failed to add built_with.", err));
    }
  }

  //this function is used for get urls from meta-data table
  async getUrlsForBuiltWith(req, res) {
    try {
      const select = ["id", "library_url", "destination_url"];
      const where = { status: 0 };
      const updateStatus = { status: 1 };
      let dataFind = await tiktok_Meta_Data.findAll({
        attributes: select,
        where: where,
      });
      let ids = dataFind.map((item) => item.id);
      if (dataFind.length > 0) {
        await tiktok_Meta_Data.update(updateStatus, {
          where: {
            id: ids,
          },
        });
        return res.send(
          Response.userSuccessResp("records fetched successfully", dataFind)
        );
      } else {
        return res.send(Response.userFailResp("No more records to fetch"));
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(Response.userFailResp("Failed to fetch records.", err));
    }
  }
}
export default new builtWithAPIService();
