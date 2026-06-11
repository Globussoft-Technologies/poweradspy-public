import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import db from "../../Sequelize_cli/models/index.js";
import adLocationValidation from "./adLocation.validation.js";
import config from "config";
const tiktok_ad_location = db.tiktok_ad_location;
class adLocationService {
  //this function is used for add the ad location
  async AddLocation(req, res) {
    try {
      const adLocationData = req?.body;
      const { value, error } =
        adLocationValidation.createAdLocation(adLocationData);

      logger.error(error);
      if (error)
        return res.send(Response.validationFailResp("VALIDATION_FAIL", error));

      const adExist = await tiktok_ad_location.findOne({
        where: { ad_id: value.ad_id },
      });
      if (!adExist) {
        let createMetaData = await tiktok_ad_location.create(value);
        return res.send(
          Response.userSuccessResp(
            "New AD_location inserted successfully",
            createMetaData
          )
        );
      } else {
        let updated = await tiktok_ad_location.update(value, {
          where: { ad_id: value.ad_id },
        });
        return res.send(
          Response.userSuccessResp("ad_location updated successfully", updated)
        );
      }
    } catch (err) {
      logger.error(`${err}`);
    //   console.log(err);
      return res.send(
        Response.userFailResp("Failed to add Ads location.", err)
      );
    }
  }

  // this function is used for the get the ad-location based on its id
  async getLocationData(req, res) {
    try {
      let { locationid } = req.params;
      let dataFind;
      if (locationid) {
        dataFind = await tiktok_ad_location.findOne({
          where: { id: locationid },
        });
      }
      if (dataFind) {
        return res.send(
          Response.userSuccessResp(
            "ad-location info fetched successfully",
            dataFind
          )
        );
      }
      return res.send(Response.userFailResp("No data Found"));
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to fetch ad-location.", err)
      );
    }
  }

  //this function is used fo the get all ad-locations
  async getAllLocationData(req, res) {
    try {
      let dataFind = await tiktok_ad_location.findAll();
      if (dataFind) {
        return res.send(
          Response.userSuccessResp(
            "ad location info fetched successfully",
            dataFind
          )
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to fetch ad location.", err)
      );
    }
  }

  //this function is used for update the ad-location based on its id
  async updateLocationData(req, res) {
    try {
      const { locationid } = req.params;
      const adLocationData = req?.body;
      const { value, error } =
        adLocationValidation.updateAdLocation(adLocationData);
      logger.error(error);
      if (error)
        return res.send(Response.validationFailResp("VALIDATION_FAIL", error));
      const existingLocation = await tiktok_ad_location.findOne({
        where: { id: locationid },
      });
      if (!existingLocation) {
        return res.send(Response.userFailResp("Invalid ad-location ID"));
      }
      const newData = await tiktok_ad_location.update(adLocationData, {
        where: { id: locationid },
      });
      if (newData) {
        return res.send(
          Response.userSuccessResp(
            "Ad-location data updated successfully",
            newData
          )
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to update Ad-location data.", err)
      );
    }
  }

  //this function is used to delete the ad-location based on its id
  async deleteLocationData(req, res) {
    try {
      const { locationid } = req?.params;
      const existingLocation = await tiktok_ad_location.findOne({
        where: { id: locationid },
      });
      if (!existingLocation) {
        return res.send(Response.userFailResp("Invalid location ID"));
      }
      let deleteData = await tiktok_ad_location.destroy({
        where: { id: locationid },
      });
      if (deleteData) {
        return res.send(
          Response.userSuccessResp(
            "Ad location data deleted successfully",
            deleteData
          )
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to delete Ad-location with this Id.", err)
      );
    }
  }
}
export default new adLocationService();
