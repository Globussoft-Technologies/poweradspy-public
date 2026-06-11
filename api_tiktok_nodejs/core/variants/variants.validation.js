import Joi from 'joi';

class variantsValidation {
    //ad_varinats payload should be in this format
    createVariants(body) {
        const schema = Joi.object().keys({
            ad_id: Joi.string().required(),
            ad_title: Joi.string(),
            newsfeed_description: Joi.string(),
            video_url_original: Joi.string(),
            video_url: Joi.string(),

        });
        const result = schema.validate(body);
        return result;
    }

     //update_ad_varinats payload should be in this format
    updateVariants(body) {
        const schema = Joi.object().keys({
            ad_id: Joi.string().required(),
            ad_title: Joi.string(),
            newsfeed_description: Joi.string(),
            video_url_original: Joi.string(),
            video_url: Joi.string(),
        });
        const result = schema.validate(body);
        return result;
    }

}
export default new variantsValidation();
