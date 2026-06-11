import Joi from 'joi';

class userRequestValidation {
    //user-request payload should be in this format
    createUserRequest(body) {
        const schema = Joi.object().keys({
            user_id: Joi.number(),
            name:Joi.string(),
            email:Joi.string(),
            keywords: Joi.string().allow(null, '').empty(''),
            advertiser: Joi.string().allow(null, '').empty(''),
            url: Joi.string().allow(null, '').empty(''),
            country: Joi.string().allow(null, '').empty(''),
            user_type: Joi.number(),
        }).or('keywords', 'advertiser', 'url');
        const result = schema.validate(body);
        return result;
    }
      
  //update-user-request payload should be in this format
    updateUserRequest(body) {
        const schema = Joi.object().keys({
            user_id: Joi.number(),
            keywords: Joi.string().allow(null, '').empty(''),
            advertiser: Joi.string().allow(null, '').empty(''),
            url: Joi.string().allow(null, '').empty(''),
            country: Joi.string().allow(null, '').empty(''),
            user_type: Joi.number(),

        }).or('keywords', 'advertiser', 'url');
        const result = schema.validate(body);
        return result;
    }

}
export default new userRequestValidation();
