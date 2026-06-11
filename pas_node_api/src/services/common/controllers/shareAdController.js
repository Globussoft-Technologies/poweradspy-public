'use strict';

const crypto = require('crypto');
const serviceRegistry = require('../../ServiceRegistry');

// Network → getAdsByAdvertiser handler map (reuse existing controllers)
const { getAdsByAdvertiser: fbAdsByAdvertiser }   = require('../../facebook/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: igAdsByAdvertiser }   = require('../../instagram/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: ytAdsByAdvertiser }   = require('../../youtube/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: pinAdsByAdvertiser }  = require('../../pinterest/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: googAdsByAdvertiser } = require('../../google/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: liAdsByAdvertiser }   = require('../../linkedin/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: redAdsByAdvertiser }  = require('../../reddit/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: qrAdsByAdvertiser }   = require('../../quora/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: natAdsByAdvertiser }  = require('../../native/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: gdnAdsByAdvertiser }  = require('../../gdn/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: ttAdsByAdvertiser }   = require('../../tiktok/controllers/getAdsByAdvertiserController');

const adHandlers = {
  facebook:  fbAdsByAdvertiser,
  instagram: igAdsByAdvertiser,
  youtube:   ytAdsByAdvertiser,
  pinterest: pinAdsByAdvertiser,
  google:    googAdsByAdvertiser,
  linkedin:  liAdsByAdvertiser,
  reddit:    redAdsByAdvertiser,
  quora:     qrAdsByAdvertiser,
  native:    natAdsByAdvertiser,
  gdn:       gdnAdsByAdvertiser,
  tiktok:    ttAdsByAdvertiser,
};

const COLLECTION_NAME = 'shared_ad_links';
let indexEnsured = false;

/**
 * Get the MongoDB collection for shared links.
 * Uses facebook service's mongo connection (shared DB).
 * On first call, ensures a TTL index on `expires_at` so MongoDB
 * automatically deletes expired documents (cleanup runs every ~60s).
 */
async function getShareCollection() {
  const fbService = serviceRegistry.getService('facebook');
  if (!fbService?.db?.mongo) {
    throw new Error('MongoDB connection not available');
  }
  const collection = fbService.db.mongo.collection(COLLECTION_NAME);

  if (!indexEnsured) {
    try {
      // TTL index — MongoDB auto-deletes docs when expires_at passes
      await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
      // Fast lookup by token
      await collection.createIndex({ token: 1 }, { unique: true });
      indexEnsured = true;
    } catch (err) {
      // Index might already exist — not a fatal error
      if (err.code !== 85 && err.code !== 86) {
        console.warn('Failed to create TTL/token index:', err.message);
      }
      indexEnsured = true;
    }
  }

  return collection;
}

/**
 * POST /api/v1/common/ads/share
 * Creates a shareable link token with a fixed 7-day expiry.
 *
 * Body: { ad_id, network }
 * Returns: { token, expires_at }
 */
async function createShareLink(req, res) {
  const { ad_id, network } = req.body;

  // Validation
  if (!ad_id) {
    return res.status(400).json({ code: 400, message: 'ad_id is required' });
  }
  if (!network) {
    return res.status(400).json({ code: 400, message: 'network is required' });
  }

  const validNetworks = Object.keys(adHandlers);
  const normalizedNetwork = network.toLowerCase().trim();
  if (!validNetworks.includes(normalizedNetwork)) {
    return res.status(400).json({
      code: 400,
      message: `Invalid network: ${network}. Supported: ${validNetworks.join(', ')}`,
    });
  }

  // Fixed 7-day expiry
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Generate unique token
  const token = crypto.randomBytes(16).toString('hex');

  try {
    const collection = await getShareCollection();

    await collection.insertOne({
      token,
      ad_id: String(ad_id),
      network: normalizedNetwork,
      expires_at: expiresAt,
      created_by: req.user?.id || req.user?.user_id || null,
      created_at: now,
    });

    return res.status(200).json({
      code: 200,
      token,
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('Error creating share link:', err.message);
    return res.status(500).json({ code: 500, message: 'Failed to create share link' });
  }
}

/**
 * GET /api/v1/common/ads/share/:token
 * Fetches the shared ad. Public endpoint — no auth required.
 *
 * Returns the ad data if token is valid and not expired.
 * Returns 410 if expired, 404 if not found.
 */
async function getSharedAd(req, res) {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ code: 400, message: 'Share token is required' });
  }

  try {
    const collection = await getShareCollection();
    const shareDoc = await collection.findOne({ token });

    if (!shareDoc) {
      return res.status(404).json({ code: 404, message: 'Share link not found' });
    }

    // Check expiry
    if (new Date() > new Date(shareDoc.expires_at)) {
      return res.status(410).json({
        code: 410,
        expired: true,
        message: 'Share link has expired',
      });
    }

    // Fetch the ad using existing network-specific handler
    const network = shareDoc.network;
    const handler = adHandlers[network];

    if (!handler) {
      return res.status(500).json({ code: 500, message: `No handler for network: ${network}` });
    }

    const service = serviceRegistry.getService(network);
    if (!service) {
      return res.status(500).json({ code: 500, message: `Service not available for network: ${network}` });
    }

    // Build a minimal request object for the existing handler
    const fakeReq = { body: { ad_id: shareDoc.ad_id, take: 1, skip: 0 } };
    const result = await handler(fakeReq, service.db, service.log);

    if (result.code !== 200 || !result.data?.length) {
      return res.status(404).json({ code: 404, message: 'Ad not found' });
    }

    return res.status(200).json({
      code: 200,
      expired: false,
      ad: result.data[0],
      network,
      expires_at: shareDoc.expires_at,
    });
  } catch (err) {
    console.error('Error fetching shared ad:', err.message);
    return res.status(500).json({ code: 500, message: 'Failed to fetch shared ad' });
  }
}

module.exports = { createShareLink, getSharedAd };
