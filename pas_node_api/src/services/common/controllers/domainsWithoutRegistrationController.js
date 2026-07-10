'use strict';

/**
 * GET /api/v1/common/get-domains-without-registration-date
 *
 * Fetch a network's domains that have NO WHOIS registration date
 * (domain_registered_date IS NULL), newest-updated first.
 *
 * Query params:
 *   network  required — one of the 10 supported networks (see the service's NETWORK_CONFIG)
 *   limit    optional — max rows, 1..50 (default 50)
 *
 * Companion to the per-network get-domain-registration lookup
 * (see docs/GET_DOMAIN_REGISTRATION_API.md).
 */

const logger = require('../../../logger');
const { getDomainsWithoutRegistration } = require('../services/domainsWithoutRegistrationService');

const log = logger.createChild('domains-without-registration');

async function domainsWithoutRegistration(req, res) {
  const result = await getDomainsWithoutRegistration(req.query || {}, log);
  return res.status(result.code).json(result);
}

module.exports = { domainsWithoutRegistration };
