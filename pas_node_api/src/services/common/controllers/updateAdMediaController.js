'use strict';

/**
 * PATCH /api/v1/common/ads/media
 *
 * Cross-network media repair endpoint.
 * Body: { network, ad_id, image?, thumbnail?, video?, other_multimedia? }
 */

const logger = require('../../../logger');
const { updateAdMedia } = require('../services/updateAdMediaService');

const log = logger.createChild('update-ad-media');

async function patchAdMedia(req, res) {
  const result = await updateAdMedia(req.body, log);
  return res.status(result.code).json(result);
}

module.exports = { patchAdMedia };
