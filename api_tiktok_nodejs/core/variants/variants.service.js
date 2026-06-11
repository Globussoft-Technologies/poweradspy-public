import variantsValidation from "./variants.validation.js";
import db from '../../Sequelize_cli/models/index.js'
import Response from '../../utils/response.js'
import logger from "../../resources/logs/logger.log.js";
import config from "config";
const tiktok_variants = db.tiktok_ad_variants;
class tiktokVariantsService {
    //this function is used for add the ad_varinats details
    async createVariants(req, res) {
        try {
            const data = req.body;
            const { value, error } = variantsValidation.createVariants(data);

            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));
            const adExist = await tiktok_variants.findOne({
                where: { ad_id: value.ad_id }
            });
            if (!adExist) {
                let variantsData = await tiktok_variants.create(value);
                return res.send(Response.userSuccessResp('New tiktok_variants inserted successfully', variantsData));
            }
            else {
                await tiktok_variants.update(value, {
                    where: { ad_id: value.ad_id },
                });
                let updated = await tiktok_variants.findOne({
                    where: { ad_id: value.ad_id }
                });
                return res.send(Response.userSuccessResp('tiktok_variants updated successfully', updated));
            }
        } catch (err) {
            res.send(Response.userFailResp('Failed to add tiktok_variants details', err))
        }
    }
    

    //this function is used for update tha ad_variants based on its id
    async updateVariants(req, res) {
      try {
            const {variantsid}=req.params
            const variantsData = req?.body;
            const { value, error } = variantsValidation.updateVariants(variantsData);
            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));

            const existingVarinats = await tiktok_variants.findOne({ where: { id: variantsid } });
            if (!existingVarinats) {
                return res.send(Response.userFailResp("Invalid variants ID"));
            }
            const newData= await tiktok_variants.update(  variantsData,
                    {
                        where: { id:variantsid }
                    })
            if (newData) {
                return res.send(Response.userSuccessResp("varinats data updated successfully", newData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to update variants data.", err));
        }

    }
    

    //this function is used for get all ad_varinats
    async getAllVariants(req, res) {
        try {
            let dataFind = await tiktok_variants.findAll();
             if (dataFind) {
                 return res.send(Response.userSuccessResp("Ads variants details fetched successfully", dataFind));
             }
         } catch (err) {
             logger.error(`${err}`);
             return res.send(Response.userFailResp("Failed to fetch Country gender.", err));
         }
    }
    
    //this function is used for delete the ad_varinats based on its id
    async deleteVariants(req, res) {
        try {
            const {variantsid}=req?.params
            const existingVariants = await tiktok_variants.findOne({ where: { id: variantsid } });
            if (!existingVariants) {
                return res.send(Response.userFailResp("Invalid variants ID"));
            }
            let deleteData= await tiktok_variants.destroy(  {
                        where: { id: variantsid }
                    })
            if (deleteData) {
                return res.send(Response.userSuccessResp("variants id deleted successfully", deleteData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to delete variants Id.", err));
        }
      
    }
    
    //this function is used for get the ad_varinats based on its id
    async getVariants(req, res) {
        try {
            let {variantsid}= req.params
            let dataFind;
            if (variantsid) {
                dataFind = await tiktok_variants.findOne({ where: { id: variantsid } });
            } 
            if (dataFind) {
                return res.send(Response.userSuccessResp("Ad variants info fetched successfully", dataFind));
            }
            return res.send(Response.userFailResp("No data Found",));
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to fetch ad varinats with this varinats id.", err));
        }
    }
}
export default new tiktokVariantsService();