const Joi = require('joi');

const handleWebhook = {
  body: Joi.object()
    .keys({
      event: Joi.string().required(),
      payload: Joi.object()
        .keys({
          from: Joi.string().required(),
          to: Joi.string().required(),
          body: Joi.string().required(),
        })
        .unknown(true), // Allow other properties in payload
    })
    .unknown(true), // Allow other top-level properties
};

module.exports = {
  handleWebhook,
};
