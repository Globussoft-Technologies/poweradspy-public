import Joi from 'joi';

class PostOwnerValidation {
    //post_owner payload should be in this format
    createOwnerDetails(body) {
        const schema = Joi.object().keys({
            post_owner: Joi.string(),
            ads_count: Joi.number(),
        });
        const result = schema.validate(body);
        return result;
    }

    //post_owner update payload should be in this format
    updateOwnerDetails(body) {
        const schema = Joi.object().keys({
            post_owner: Joi.string(),
            ads_count: Joi.number(),

        });
        const result = schema.validate(body);
        return result;
    }

}
export default new PostOwnerValidation();