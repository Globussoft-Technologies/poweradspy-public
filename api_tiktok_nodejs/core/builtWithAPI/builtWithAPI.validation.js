import Joi from 'joi';
class builtWithAPIValidation{
    //payload should be in this format while sending
    createBuiltWith(body){
    const schema=Joi.object().keys({
        id:Joi.string(),
        affiliate_data: Joi.string().allow(null, ''),
        status: Joi.string().allow(null, ''),
        built_with: Joi.string().allow(null, ''),
        built_with_cms: Joi.string().allow(null, ''),
        built_with_analytics_tracking: Joi.string().allow(null, '')
    })
    const result = schema.validate(body);
    return result;
    }

}
export default new builtWithAPIValidation()