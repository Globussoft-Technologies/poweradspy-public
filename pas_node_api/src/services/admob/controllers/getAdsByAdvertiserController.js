'use strict';

const { searchAds } = require('./adSearchController');

// The common share-link controller (services/common/controllers/shareAdController.js)
// calls every network's getAdsByAdvertiser with the same (req, db, logger)
// contract and a { ad_id, take, skip } request body, expecting { code, data }
// back. AdMob never had this handler at all -- "Copy ad link" for an AdMob ad
// called createShareLink({ network: 'admob' }), which the backend rejected
// (admob wasn't in shareAdController's supported-network map) because there
// was nothing to route it to.
//
// AdMob has no separate advertiser/detail SQL path the way other networks do;
// searchAds already supports looking up a single ad by its internal id or
// public ad_id (see buildCommonClauses in adSearchController.js), so this
// reuses that instead of duplicating the ES query/field-mapping logic.
async function getAdsByAdvertiser(req, db, logger) {
  const { ad_id, take = 1, skip = 0 } = req.body || {};

  if (!ad_id) {
    return { code: 400, message: 'ad_id is required', data: null };
  }

  const searchReq = {
    body: {
      id: ad_id,
      take: Number(take) || 1,
      skip: Number(skip) || 0,
    },
  };

  const result = await searchAds(searchReq, db, logger);

  if (result.code !== 200) {
    return { code: result.code, message: result.message || 'Failed to fetch ad', data: null };
  }
  if (!result.data || result.data.length === 0) {
    return { code: 400, message: 'No ads found', data: null };
  }

  return {
    code: 200,
    data: result.data,
    total: result.data.length,
    message: 'Ad fetched successfully',
  };
}

module.exports = { getAdsByAdvertiser };
