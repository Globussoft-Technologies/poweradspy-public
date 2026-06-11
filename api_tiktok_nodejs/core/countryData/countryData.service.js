import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import countryValidation from "./countryData.validation.js";
import db from "../../Sequelize_cli/models/index.js";

const contryIndex = db.tiktok_ad_country_info;
class countryService {
  //this function is used for add the country-data
  async AddData(req, res) {
    try {
      const countryData = req?.body;
      const { value, error } = countryValidation.addCountry(countryData);
      if (error) {
        return res.send(Response.userFailResp("Validation Failed", error));
      }
      const existingCountry = await contryIndex.findOne({
        where: { name: value?.name },
      });
      if (existingCountry) {
        return res.send(Response.userFailResp("Country already exists"));
      }
      const newData = await contryIndex.create(value);
      if (newData) {
        return res.send(
          Response.userSuccessResp(
            "Country data inserted successfully",
            newData
          )
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to add Country data.", err)
      );
    }
  }

  //this function is used for get the country data based on its id
  async getCountry(req, res) {
    try {
      let { countryid } = req.params;
      let dataFind;
      if (countryid) {
        dataFind = await contryIndex.findOne({ where: { id: countryid } });
      }
      if (dataFind) {
        return res.send(
          Response.userSuccessResp(
            "Country info fetched successfully",
            dataFind
          )
        );
      }
      return res.send(Response.userFailResp("No data Found"));
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to fetch Country data.", err)
      );
    }
  }

  //this function is used get all the country data
  async getAllCountry(req, res) {
    try {
      let dataFind = await contryIndex.findAll();
      if (dataFind) {
        return res.send(
          Response.userSuccessResp(
            "Country info fetched successfully",
            dataFind
          )
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to fetch Country data.", err)
      );
    }
  }

  //this function is used for update the country data based on its id
  async updateCountryData(req, res) {
    try {
      const { countryid } = req.params;
      const countryData = req?.body;
      const existingCountry = await contryIndex.findOne({
        where: { id: countryid },
      });
      if (!existingCountry) {
        return res.send(Response.userFailResp("Invalid country ID"));
      }
      const { value, error } = countryValidation.updateCountry(countryData);
      if (error) {
        return res.send(Response.userFailResp("Validation Failed", error));
      }
      const newData = await contryIndex.update(countryData, {
        where: { id: countryid },
      });
      if (newData) {
        return res.send(
          Response.userSuccessResp("Country data updated successfully", newData)
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to update Country data.", err)
      );
    }
  }

  //this function is used for the delete the country data based on its id
  async deleteCountryData(req, res) {
    try {
      const { countryid } = req?.params;
      const existingCountry = await contryIndex.findOne({
        where: { id: countryid },
      });
      if (!existingCountry) {
        return res.send(Response.userFailResp("Invalid country ID"));
      }
      let deleteData = await contryIndex.destroy({
        where: { id: countryid },
      });
      if (deleteData) {
        return res.send(
          Response.userSuccessResp(
            "Country data deleted successfully",
            deleteData
          )
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp("Failed to delete Country data.", err)
      );
    }
  }
}
export default new countryService();
