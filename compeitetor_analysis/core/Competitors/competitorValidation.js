import Joi from "joi";

// Validator for create api
class CompetitorValidation {
  createDetails(body) {
    const schema = Joi.object().keys({
      amember_id: Joi.number().integer().required(),
      plan_id: Joi.number().integer().required(),
      plan_expiry_date: Joi.date().required(),
      company_name: Joi.string(),
      userName: Joi.string().required(),
      email: Joi.string().email().required(),
      url: Joi.string().uri(),
      phone_number: Joi.string().pattern(/^[0-9+\-().\s]{7,20}$/),
    });
    const result = schema.validate(body);
    return result;
  }

  createRequest(body) {
    const schema = Joi.object().keys({
      user_id: Joi.string().length(24).hex().required(),

      project_name: Joi.string().trim(),
      brand_url: Joi.string()
        .trim()
        .uri({
          scheme: ["http", "https"],
          allowRelative: true,
        })
        .required(),

      advertiser: Joi.array()
        .items(Joi.string().trim().required())
        .min(1)
        .required(),

      competitor_details: Joi.array()
        .items(
          Joi.object().keys({
            competitor_name: Joi.string().trim().required(),
            competitor_url: Joi.string().required(),
          })
        )
        .min(1)
        .required(),


        country: Joi.array()
        .items(Joi.string().trim())
        .min(0)
        .required(),
  
      category: Joi.array()
        .items(Joi.string().trim())
        .min(0)
        .required(),

    });

    const result = schema.validate(body);
    return result;
  }
}
export default new CompetitorValidation();
