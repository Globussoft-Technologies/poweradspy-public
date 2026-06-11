import Joi from 'joi';
class keywordNotificationValidation {
    createKeywords(body){
        const schema=Joi.object().keys({
            user_id:Joi.number().integer(),
            name:Joi.string(),
            keyword:Joi.string(),
            email:Joi.string(),
            duration:Joi.number().valid(1, 2, 3).required(),
            type:Joi.number().valid(1, 2).required(),
            status:Joi.number().integer(),
        })
        const result = schema.validate(body);
        return result;
        }
}
export default new keywordNotificationValidation()