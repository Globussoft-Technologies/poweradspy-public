'use strict';

/**
 * GET /api/v1/common/get-domain-registration
 *
 * Unified cross-network domain registration-date lookup. Consolidates the four
 * per-network get-domain-registration endpoints and covers all 10 networks.
 *
 * Query params:
 *   domain   required — exact domain to look up
 *   network  optional — a network, a CSV of networks, or 'all' (default = all)
 */

const logger = require('../../../logger');
const { lookupDomainRegistration } = require('../services/domainRegistrationLookupService');

const log = logger.createChild('domain-registration-lookup');

async function getDomainRegistration(req, res) {
  const result = await lookupDomainRegistration(req.query || {}, log);
  return res.status(result.code).json(result);
}

module.exports = { getDomainRegistration };
