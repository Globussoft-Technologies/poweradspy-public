import Joi from 'joi';
class hideFavAdsAPIValidation {
    //hideFav ads payload should be in this format
    createFavAdsAPI(body){
        const schema=Joi.object().keys({
            user_id:Joi.number().integer(),
            ad_id:Joi.number().integer(),
            post_owner_id:Joi.number().integer(),
            type:Joi.number().valid(1, 2, 3).required(),
            status:Joi.number().integer(),
            platform:Joi.string(),
            is_notified:Joi.string(),
            is_requested:Joi.string(),
            lcs_status:Joi.string(),
        })
        const result = schema.validate(body);
        return result;
        }
}
export default new hideFavAdsAPIValidation()