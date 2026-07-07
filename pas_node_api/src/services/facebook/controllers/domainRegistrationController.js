'use strict';

/**
 * GET get-domain-registration (Facebook / api.poweradspy.com) — port of
 * Userv2Controller@getDomainRegistration. Looks up a domain's registration date in the
 * facebook_ad_domains table. Thin wrapper over the shared helper.
 */

const { getDomainRegistration: run } = require('../../../utils/domainRegistration');

const TABLE = 'facebook_ad_domains';

async function getDomainRegistration(req, db, logger) {
  return run(req, db, logger, TABLE);
}

module.exports = { getDomainRegistration };
