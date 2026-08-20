'use strict';

const insertionRepo = require('../insertion/repository');

// AdMob landers reuse the same SQL primitives as AdMob insertion so the
// lander flow stays aligned with the existing network tables and joins.
module.exports = {
  withTransaction: insertionRepo.withTransaction,
  getAdForUpdate: insertionRepo.getAdForUpdate,
  getAdsForLander: insertionRepo.getAdsForLander,
  updateRedirectStatus: insertionRepo.updateRedirectStatus,
  upsertLanderContent: insertionRepo.upsertLanderContent,
  getCompleteAd: insertionRepo.getCompleteAd,
};
