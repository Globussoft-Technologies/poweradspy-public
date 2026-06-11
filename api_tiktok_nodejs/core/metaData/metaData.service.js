import metaDataValidation from "./metaData.validation.js";
import db from '../../Sequelize_cli/models/index.js'
import Response from '../../utils/response.js'
import logger from "../../resources/logs/logger.log.js";
import config from "config";
const tiktok_meta_data = db.tiktok_ad_meta_data;
class metaDataService {
    //this function is used for create the meta data details
    async createMetaData(req, res) {
        try {
            const data = req.body;
            const { value, error } = metaDataValidation.createMetaData(data);

            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));
            const adExist = await tiktok_meta_data.findOne({
                where: { ad_id: value.ad_id }
            });
            if (!adExist) {
                let createMetaData = await tiktok_meta_data.create(value);
                return res.send(Response.userSuccessResp('New tiktok_meta_data inserted successfully', createMetaData));
            }
            else {
                let updated = await tiktok_meta_data.update(value, {
                    where: { ad_id: value.ad_id },
                });
                return res.send(Response.userSuccessResp('tiktok_meta_data updated successfully', updated));
            }
        } catch (err) {
            res.send(Response.userFailResp('Failed to add tiktok_meta_data details', err))
        }
    }
   

    //this function is used for update the meta data details based on its id 
    async updateMetaData(req, res) {
      try {
            const {metadataid}=req.params
            const data = req?.body;
            const { value, error } = metaDataValidation.updateMetaData(data);
            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));

            const existingMetaData = await tiktok_meta_data.findOne({ where: { id: metadataid } });
            if (!existingMetaData) {
                return res.send(Response.userFailResp("Invalid meta data ID"));
            }
            const newData= await tiktok_meta_data.update( data,
                    {
                        where: { id:metadataid }
                    })
            if (newData) {
                return res.send(Response.userSuccessResp("metadata data updated successfully", newData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to update meta  data.", err));
        }

    }
    
    //this function is used for get all meta data details
    async getAllMetaData(req, res) {
        try {
            let dataFind = await tiktok_meta_data.findAll();
             if (dataFind) {
                 return res.send(Response.userSuccessResp("Ads meta data details fetched successfully", dataFind));
             }
         } catch (err) {
             logger.error(`${err}`);
             return res.send(Response.userFailResp("Failed to fetch meta data.", err));
         }
    }
    
    //this function is used for delete the meta data details based on its id
    async deleteMetaData(req, res) {
        try {
            const {metadataid}=req?.params
            const existingMetaData = await tiktok_meta_data.findOne({ where: { id: metadataid } });
            if (!existingMetaData) {
                return res.send(Response.userFailResp("Invalid meta data ID"));
            }
            let deleteData= await tiktok_meta_data.destroy(  {
                        where: { id: metadataid }
                    })
            if (deleteData) {
                return res.send(Response.userSuccessResp("meta data id deleted successfully", deleteData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to delete meta data Id.", err));
        }
      
    }
    
    //this function is used for get the meta data details based on its id
    async getMetaData(req, res) {
        try {
            let {metadataid}= req.params
            let dataFind;
            if (metadataid) {
                dataFind = await tiktok_meta_data.findOne({ where: { id: metadataid } });
            } 
            if (dataFind) {
                return res.send(Response.userSuccessResp("Ad meta data info fetched successfully", dataFind));
            }
            return res.send(Response.userFailResp("No data Found",));
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to fetch ad meta data with this meta data id.", err));
        }
    }
}
export default new metaDataService();