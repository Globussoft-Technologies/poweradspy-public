'use strict';

/**
 * GET get-domain-registration (Google / gtext) — port of
 * UserController@getDomainRegistration. Looks up a domain's registration date in the
 * google_text_ad_domains table. Thin wrapper over the shared helper.
 */

const { getDomainRegistration: run } = require('../../../utils/domainRegistration');

const TABLE = 'google_text_ad_domains';

async function getDomainRegistration(req, db, logger) {
  return run(req, db, logger, TABLE);
}

module.exports = { getDomainRegistration };
