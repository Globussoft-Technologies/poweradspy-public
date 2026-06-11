import Response from '../../utils/response.js'
import logger from '../../resources/logs/logger.log.js';
import db from '../../Sequelize_cli/models/index.js'
import config from 'config';
const contryAgeIndex = db.tiktok_ad_country_ages;
class countryAgeService{
    //this function is used for add the ad-counytry-age deatils
    async AddCountryAge(req, res) {
        try {
            const countryAgeData = req?.body;
            const newData = await contryAgeIndex.create(countryAgeData);
            if (newData) {
                return res.send(Response.userSuccessResp("Age id inserted successfully", newData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to add Age Id.", err));
        }
    }
    
    //this function is used for the get the country-age based on its id
    async getCountryAge(req, res) {
        try {
            let {ageid}= req.params
            let dataFind;
            if (ageid) {
                dataFind = await contryAgeIndex.findOne({ where: { id: ageid } });
            } 
            if (dataFind) {
                return res.send(Response.userSuccessResp("Country age info fetched successfully", dataFind));
            }
            return res.send(Response.userFailResp("No data Found",));
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to fetch age id.", err));
        }
    }

    //this function is used for get all the country age details
    async getAllCountryAge(req, res) {
        try {
           let dataFind = await contryAgeIndex.findAll();
            if (dataFind) {
                return res.send(Response.userSuccessResp("Country age info fetched successfully", dataFind));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to fetch age id.", err));
        }
    }

    //this function is used for update the country age based on its id.
    async updateCountryAge(req, res) {
        try {
            const {ageid}=req.params
            const countryAgeData = req?.body;
            const existingCountry = await contryAgeIndex.findOne({ where: { id: ageid } });
            if (!existingCountry) {
                return res.send(Response.userFailResp("Invalid age ID"));
            }
            const newData= await contryAgeIndex.update(  countryAgeData,
                    {
                        where: { id:ageid }
                    })
            if (newData) {
                return res.send(Response.userSuccessResp("Country age data updated successfully", newData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to update Country age data.", err));
        }
    }

    //this function is used for delete the country age based on its id
    async deleteCountryAge(req, res) {
        try {
            const {ageid}=req?.params
            const existingCountry = await contryAgeIndex.findOne({ where: { id: ageid } });
            if (!existingCountry) {
                return res.send(Response.userFailResp("Invalid age ID"));
            }
            let deleteData= await contryAgeIndex.destroy(  {
                        where: { id: ageid }
                    })
            if (deleteData) {
                return res.send(Response.userSuccessResp("age id deleted successfully", deleteData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to delete age Id.", err));
        }
    }
}
export default new countryAgeService();