import Joi from 'joi';
class countryValidationService{
    //payload for country data should be in this format
    addCountry(body){
    const schema=Joi.object().keys({
        iso: Joi.string().length(2).required(),
        name: Joi.string().required(),
        nicename: Joi.string().required(),
        iso3: Joi.string().length(3).required(),
        numcode: Joi.number().integer().required(),
        phonecode: Joi.number().integer().required(),
    })
    const result = schema.validate(body);
    return result;
    }
    
    //payload for country data update should be in this format
    updateCountry(body){
        const schema=Joi.object().keys({
            iso: Joi.string().length(2),
            name: Joi.string(),
            nicename: Joi.string(),
            iso3: Joi.string().length(3),
            numcode: Joi.number().integer(),
            phonecode: Joi.number().integer(),
        })
        const result = schema.validate(body);
        return result;
    }

}
export default new countryValidationService()