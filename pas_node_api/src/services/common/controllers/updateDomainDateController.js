'use strict';

/**
 * PUT /api/v1/common/insert-update-domain-date
 *
 * Node port of the PHP SupportScrapper@putDomainDate, generalised to update a
 * domain's WHOIS registration date across ALL networks' domains tables (and bump
 * `updated_date` where the table has it). Update-only: rows are never inserted.
 *
 * Body: { domain_name: string, domain_date: 'YYYY-MM-DD' }
 */

const logger = require('../../../logger');
const { updateDomainDate } = require('../services/updateDomainDateService');

const log = logger.createChild('update-domain-date');

async function putDomainDate(req, res) {
  const result = await updateDomainDate(req.body || {}, log);
  return res.status(result.code).json(result);
}

module.exports = { putDomainDate };
