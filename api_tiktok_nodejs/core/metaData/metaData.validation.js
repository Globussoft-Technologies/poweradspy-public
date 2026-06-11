import Joi from 'joi';

class metaDataValidation {
    //payload of the meta data should be in this format
    createMetaData(body) {
        const schema = Joi.object().keys({
            ad_id: Joi.string().required(), 
            video_url: Joi.string(), 
            video_duration: Joi.string(), 
            video_cover: Joi.string(), 
            platform: Joi.number().integer(), 
            destination_url: Joi.string(), 
            source: Joi.string(), 
            cost: Joi.number().precision(2), 
            ctr: Joi.number().precision(2), 
            library_url: Joi.string(), 
            ad_paid_for: Joi.string(), 
            audience: Joi.string(), 
            interest: Joi.string(), 
            video_interection: Joi.string(), 
            creator_interactions: Joi.string(), 
            published_countries_count: Joi.number().integer(), 
            target_users:Joi.string(),
            top_clicks: Joi.string(), 
            objectives: Joi.array().items(Joi.string()), 
            target_keywords: Joi.array().items(Joi.string()), 
            top_ctr :Joi.string(),
            ctr_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            top_cvr :Joi.string(),
            cvr_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            clicks_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            top_conversion:Joi.string(),
            conversion_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            top_remains:Joi.string(),
            remain_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            affiliate_status:Joi.string(),
            affiliate_data:Joi.string(),
            built_with_status:Joi.string(),
            built_with_data:Joi.string(),
            built_with_analytics_tracking:Joi.string()

        });
        const result = schema.validate(body);
        return result;
    }

    //payload of the update meta data should be in this format
    updateMetaData(body) {
        const schema = Joi.object().keys({
            ad_id: Joi.string().required(), 
            video_url: Joi.string(), 
            video_duration: Joi.string(), 
            video_cover: Joi.string(), 
            platform: Joi.number().integer(), 
            destination_url: Joi.string(), 
            source: Joi.string(), 
            cost: Joi.number().precision(2), 
            ctr: Joi.number().precision(2), 
            library_url: Joi.string(), 
            ad_paid_for: Joi.string(), 
            audience: Joi.string(), 
            interest: Joi.string(), 
            video_interection: Joi.string(), 
            creator_interactions: Joi.string(), 
            published_countries_count: Joi.number().integer(), 
            target_users:Joi.string(),
            top_clicks: Joi.string(), 
            objectives: Joi.array().items(Joi.string()), 
            target_keywords: Joi.array().items(Joi.string()), 
            top_ctr :Joi.string(),
            ctr_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            top_cvr :Joi.string(),
            cvr_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            clicks_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            top_conversion:Joi.string(),
            conversion_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            top_remains:Joi.string(),
            remain_graph:Joi.array().items(Joi.object({
                second: Joi.number().integer(),
                value: Joi.number().precision(2)})),
            affiliate_status:Joi.string(),
            affiliate_data:Joi.string(),
            built_with_status:Joi.string(),
            built_with_data:Joi.string(),
            built_with_analytics_tracking:Joi.string()
        });
        const result = schema.validate(body);
        return result;
    }

}
export default new metaDataValidation();
