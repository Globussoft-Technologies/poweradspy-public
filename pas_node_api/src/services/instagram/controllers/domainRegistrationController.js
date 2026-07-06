'use strict';

/**
 * GET get-domain-registration (Instagram / gramapi) — port of
 * Userv2Controller@getDomainRegistration. Looks up a domain's registration date in the
 * instagram_ad_domain table. Thin wrapper over the shared helper.
 */

const { getDomainRegistration: run } = require('../../../utils/domainRegistration');

const TABLE = 'instagram_ad_domain';

async function getDomainRegistration(req, db, logger) {
  return run(req, db, logger, TABLE);
}

module.exports = { getDomainRegistration };
