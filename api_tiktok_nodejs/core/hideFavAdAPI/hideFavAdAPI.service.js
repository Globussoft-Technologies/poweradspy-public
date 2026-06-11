import Response from '../../utils/response.js';
import logger from '../../resources/logs/logger.log.js';
import hideFavAdsAPIValidation from './hideFavAdAPI.validate.js';
import db from '../../Sequelize_cli/models/index.js'
const hideFavAds = db.hide_favourite_ads;
import { getHideFavAds } from "../../utils/elasticSearch.js";
class hideFavAdsAPIService {
    //this function is used for hide-fav-ads
    async hideFavAd(req, res) {
        try {
            const data = req.body;
            const { value, error } = hideFavAdsAPIValidation.createFavAdsAPI(data);
            
            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));
            
            const adExist = await hideFavAds.findOne({
                where: { ad_id: value.ad_id, user_id: value.user_id }
            });

            if (!adExist) {
                let createFavAdsAPI = await hideFavAds.create(value);
                return res.send(Response.userSuccessResp('New data inserted successfully', createFavAdsAPI.id));
            } else {
                const typeExist = await hideFavAds.findOne({
                    where: {
                        ad_id: value.ad_id,
                        type: value.type,
                        user_id: value.user_id
                    }
                });
            
                if (typeExist) {
                    return res.send(Response.userFailResp('data with this type already exists for this ad_id'));
                } else {
                    let createFavAdsAPI = await hideFavAds.create(value);
                    return res.send(Response.userSuccessResp('data inserted successfully', createFavAdsAPI.id));
                }
            }
            
            
        } catch (err) {
            res.send(Response.userFailResp('Failed to insert data', err))
        }
    }
     
    //this function is used for unHideFav ads
    async unHideFavAd(req, res) {
        try {
            const data = req.body;
            const { value, error } = hideFavAdsAPIValidation.createFavAdsAPI(data);

            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));
            const adExist = await hideFavAds.findOne({
                where: { ad_id: value.ad_id ,user_id: value.user_id}
            });
            
            if (!adExist) {
                return res.send(Response.userFailResp('Ad is not found for this id'));
            } else {
                const typeExist = await hideFavAds.findOne({
                    where: {
                        ad_id: value.ad_id,
                        type: value.type,
                        user_id: value.user_id
                    }
                });
            
                if (typeExist) {
                    let deleteData= await hideFavAds.destroy(  {
                        where: { ad_id: value.ad_id, type: value.type, user_id: value.user_id }
                    })
                    if(deleteData)
                    { 
                        return res.send(Response.userSuccessResp('data deleted successfully'));
                    }
                    
                } else {
                    return res.send(Response.userFailResp('data not found for this type'));
                }
            }
            
            
        } catch (err) {
            res.send(Response.userFailResp('Failed to delete data', err))
        }
    }
    async getHideAds(req, res) {
        try {
            const { type, user_id } = req.body;
            const hideAds = await hideFavAds.findAll({
                where: { type: type , user_id:user_id}
            });
            if (hideAds) {
                const hiddenFavAds = hideAds.map(ad => ({
                    sql_id: ad.ad_id,
                    type: ad.type  
                  }));
               let HiddenFavAds=await getHideFavAds(hiddenFavAds)
               const updatedHideFavAds = [...new Map(HiddenFavAds?.map(ad => [ad?.sql_id, ad]))?.values()];
                return res.send(Response.userSuccessResp('HideFavAds retrieved successfully', updatedHideFavAds));
            } else {
                return res.send(Response.userFailResp('No ads found for the specified type'));
            }
        } catch (error) {
            return res.send(Response.userFailResp('Failed to retrieve HideFavads', error));
        }
    }

    async getHideFavAds(req, res) {
        try {
            const { type, user_id } = req.body;
    
            if (!type || !user_id) {
                return res.status(400).send(Response.userFailResp('Missing type or user_id'));
            }
    
            const hideAds = await hideFavAds.findAll({
                where: { type, user_id },
                attributes: ['ad_id', 'type'], 
                raw: true 
            });
    
            if (!hideAds.length) {
                return res.status(200).send(Response.userFailResp('No ads found for the specified type'));
            }
           
            return res.send(Response.userSuccessResp('HideFavAds retrieved successfully', hideAds));
    
        } catch (error) {
            // console.error("Error in getHideAds:", error);
            return res.status(500).send(Response.userFailResp('Failed to retrieve HideFavAds', error.message));
        }
    } 
}
export default new hideFavAdsAPIService();