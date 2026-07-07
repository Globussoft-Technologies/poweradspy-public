'use strict';

/**
 * GET get-domain-registration (YouTube / tubeapi) — port of
 * SearchController@getDomainRegistration. Looks up a domain's registration date in the
 * youtube_ad_domains table. Thin wrapper over the shared helper.
 */

const { getDomainRegistration: run } = require('../../../utils/domainRegistration');

const TABLE = 'youtube_ad_domains';

async function getDomainRegistration(req, db, logger) {
  return run(req, db, logger, TABLE);
}

module.exports = { getDomainRegistration };
