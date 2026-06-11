import Response from '../../utils/response.js'
import logger from '../../resources/logs/logger.log.js';
import db from '../../Sequelize_cli/models/index.js'
import config from 'config';
const countryGenderIndex = db.tiktok_ad_country_gender;
class countryGenderService{
    async AddCountryGender(req, res) {
        try {
            const countryAgeData = req?.body;
            const newData = await countryGenderIndex.create(countryAgeData);
            if (newData) {
                return res.send(Response.userSuccessResp("Country gender inserted successfully", newData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to add Country gender.", err));
        }
    }
    
    async getCountryGender(req, res) {
        try {
            let {genderid}= req.params
            let dataFind;
            if (genderid) {
                dataFind = await countryGenderIndex.findOne({ where: { id: genderid } });
            } 
            if (dataFind) {
                return res.send(Response.userSuccessResp("Country gender info fetched successfully", dataFind));
            }
            return res.send(Response.userFailResp("No data Found",));
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to fetch Country gender.", err));
        }
    }
    async getAllCountryGender(req, res) {
        try {
           let dataFind = await countryGenderIndex.findAll();
            if (dataFind) {
                return res.send(Response.userSuccessResp("Country gender info fetched successfully", dataFind));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to fetch Country gender.", err));
        }
    }
    async updateCountryGender(req, res) {
        try {
            const {genderid}=req.params
            const countryAgeData = req?.body;
            const existingCountry = await countryGenderIndex.findOne({ where: { id: genderid } });
            if (!existingCountry) {
                return res.send(Response.userFailResp("Invalid gender ID"));
            }
            const newData= await countryGenderIndex.update(  countryAgeData,
                    {
                        where: { id:genderid }
                    })
            if (newData) {
                return res.send(Response.userSuccessResp("Country gender data updated successfully", newData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to update Country gender data.", err));
        }
    }
    async deleteCountryGender(req, res) {
        try {
            const {genderid}=req?.params
            const existingCountry = await countryGenderIndex.findOne({ where: { id: genderid } });
            if (!existingCountry) {
                return res.send(Response.userFailResp("Invalid gender ID"));
            }
            let deleteData= await countryGenderIndex.destroy(  {
                        where: { id: genderid }
                    })
            if (deleteData) {
                return res.send(Response.userSuccessResp("Gender id deleted successfully", deleteData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to delete Gender Id.", err));
        }
    }
}
export default new countryGenderService();