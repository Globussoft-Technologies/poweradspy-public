import Joi from 'joi';
class adLocationValidation{
    createAdLocation(body){
    const schema=Joi.object().keys({
        ad_id:Joi.string(),
        countries:Joi.array().items(Joi.string()),
        state:Joi.string(),
        city:Joi.string()
    })
    const result = schema.validate(body);
    return result;
    }
    updateAdLocation(body){
        const schema=Joi.object().keys({
            ad_id:Joi.string(),
            countries:Joi.array().items(Joi.string()),
            state:Joi.string(),
            city:Joi.string()
        })
        const result = schema.validate(body);
        return result;
    }

}
export default new adLocationValidation()