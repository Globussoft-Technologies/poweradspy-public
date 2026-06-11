import Joi from "joi";

class DashboardValidation {
  validatePayloadForBacklink(body) {
    const schema = Joi.object().keys({
      domain_name: Joi.string().required(),
      referring_page: Joi.string().allow("", null),
      referring_domains: Joi.string().allow("", null),
      skip: Joi.number().integer().required(),
      limit: Joi.number().integer().required(),
    });
    const result = schema.validate(body);
    return result;
  }

  validatePayloadForOrganic(body) {
    const schema = Joi.object().keys({
      domain_name: Joi.string().required(),
      keyword: Joi.string().allow("", null),
      best_position_url: Joi.string().allow("", null),
      skip: Joi.number().integer().required(),
      limit: Joi.number().integer().required(),
    });

    const result = schema.validate(body);
    return result;
  }
  validatePayloadForPaid(body) {
    const schema = Joi.object().keys({
      domain_name: Joi.string().required(),
      keywords: Joi.string().allow("", null),
      external_links: Joi.string().allow("", null),
      skip: Joi.number().integer().required(),
      limit: Joi.number().integer().required(),
    });

    const result = schema.validate(body);
    return result;
  }
}
export default new DashboardValidation();
