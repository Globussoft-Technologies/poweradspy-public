'use strict';

const { AppError } = require('./errorHandler');
const { HTTP, ERROR_CODES } = require('../utils/constants');

/**
 * Validator middleware for request bodies, queries, and params.
 * Uses a simple schema-based approach (can be swapped for Joi/Zod).
 */
const validator = (schema) => (req, res, next) => {
  const sources = ['body', 'query', 'params'];
  const errors = [];

  for (const source of sources) {
    if (schema[source]) {
      const keys = Object.keys(schema[source]);
      for (const key of keys) {
        const value = req[source][key];
        const rule = schema[source][key];

        if (rule.required && (value === undefined || value === null || value === '')) {
          errors.push(`${source}.${key} is required`);
        } else if (value !== undefined && rule.type) {
          if (rule.type === 'number' && isNaN(Number(value))) {
            errors.push(`${source}.${key} must be a number`);
          } else if (rule.type === 'boolean' && value !== 'true' && value !== 'false' && typeof value !== 'boolean') {
            errors.push(`${source}.${key} must be a boolean`);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    return next(new AppError(errors.join(', '), HTTP.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR));
  }

  next();
};

module.exports = validator;
