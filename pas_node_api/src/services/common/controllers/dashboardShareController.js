'use strict';

const crypto = require('crypto');
const serviceRegistry = require('../../ServiceRegistry');
const { searchAllNetworks } = require('./commonSearchController');

const COLLECTION_NAME = 'shared_dashboards';
let indexEnsured = false;

/**
 * Get the MongoDB collection for shared dashboards.
 * Uses facebook service's mongo connection (shared DB).
 * Creates TTL + token indexes on first call.
 */
async function getCollection() {
  const fbService = serviceRegistry.getService('facebook');
  if (!fbService?.db?.mongo) {
    throw new Error('MongoDB connection not available');
  }
  const collection = fbService.db.mongo.collection(COLLECTION_NAME);

  if (!indexEnsured) {
    try {
      await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
      await collection.createIndex({ token: 1 }, { unique: true });
      indexEnsured = true;
    } catch (err) {
      if (err.code !== 85 && err.code !== 86) {
        console.warn('Failed to create dashboard share indexes:', err.message);
      }
      indexEnsured = true;
    }
  }

  return collection;
}

/**
 * POST /api/v1/common/dashboard/share
 * Creates a shareable dashboard snapshot with filters, search state, and search payload.
 * Auth required (logged-in user).
 *
 * Body: { uiState: { searchQuery, searchIn, exactSearch, filterValues, activePlatforms, sortBy, activeTab }, searchPayload: { ...full API body... } }
 * Returns: { token, expires_at }
 */
async function createDashboardShare(req, res) {
  const { uiState, searchPayload } = req.body;

  if (!uiState || !searchPayload) {
    return res.status(400).json({ code: 400, message: 'uiState and searchPayload are required' });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const token = crypto.randomBytes(16).toString('hex');

  try {
    const collection = await getCollection();

    await collection.insertOne({
      token,
      uiState,
      searchPayload,
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
    console.error('Error creating dashboard share:', err.message);
    return res.status(500).json({ code: 500, message: 'Failed to create dashboard share link' });
  }
}

/**
 * GET /api/v1/common/dashboard/share/:token
 * Returns the stored UI state for rendering the guest dashboard.
 * Public endpoint — no auth required.
 */
async function getDashboardShare(req, res) {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({ code: 400, message: 'Token is required' });
  }

  try {
    const collection = await getCollection();
    const doc = await collection.findOne({ token });

    if (!doc) {
      return res.status(404).json({ code: 404, message: 'Dashboard share link not found' });
    }

    if (new Date() > new Date(doc.expires_at)) {
      return res.status(410).json({ code: 410, expired: true, message: 'Dashboard share link has expired' });
    }

    return res.status(200).json({
      code: 200,
      expired: false,
      uiState: doc.uiState,
      expires_at: doc.expires_at,
    });
  } catch (err) {
    console.error('Error fetching dashboard share:', err.message);
    return res.status(500).json({ code: 500, message: 'Failed to fetch dashboard share' });
  }
}

/**
 * POST /api/v1/common/dashboard/guest-search
 * Runs a search using stored dashboard filters. Public endpoint — no auth.
 * Limited to 100 ads per network.
 *
 * Body: { token, skip }
 */
async function guestSearch(req, res) {
  const { token, skip = 0 } = req.body;

  if (!token) {
    return res.status(400).json({ code: 400, message: 'Token is required' });
  }

  const parsedSkip = Number(skip) || 0;
  const isOffset = parsedSkip > 20; // TikTok sends skip as multiples of 9 (0,9,18,...)

  try {
    const collection = await getCollection();
    const doc = await collection.findOne({ token });

    // 35 ads per platform for both ALL and single platform (4 pages × 9 ads)
    const MAX_PAGES  = 4;
    const MAX_OFFSET = 27;  // TikTok-style offset pagination

    const limitReached = isOffset ? parsedSkip >= MAX_OFFSET : parsedSkip >= MAX_PAGES;

    if (limitReached) {
      return res.status(200).json({
        code: 200,
        data: [],
        meta: { total: {}, guestLimitReached: true },
        message: 'Guest limit reached. Please login to view more.',
      });
    }

    if (!doc) {
      return res.status(404).json({ code: 404, message: 'Dashboard share link not found' });
    }

    if (new Date() > new Date(doc.expires_at)) {
      return res.status(410).json({ code: 410, expired: true, message: 'Dashboard share link has expired' });
    }

    // Reconstruct request from stored payload
    const storedPayload = { ...doc.searchPayload };
    storedPayload.skip = parsedSkip;
    storedPayload.take = '9';
    // Ensure user_id is present — required by all network search controllers
    if (!storedPayload.user_id) storedPayload.user_id = doc.created_by || 281;

    // Create a mock request object for searchAllNetworks
    const mockReq = {
      body: storedPayload,
      query: {},
      headers: {},
      planAccess: null, // no plan restrictions for guest — allow all networks in stored state
      user: null,
      ip: req.ip,
    };

    // Capture the response from searchAllNetworks
    let responseData = null;
    const mockRes = {
      status: function (code) {
        return {
          json: function (data) {
            responseData = { ...data, _statusCode: code };
          },
        };
      },
    };

    await searchAllNetworks(mockReq, mockRes);

    if (!responseData) {
      return res.status(500).json({ code: 500, message: 'Search returned no response' });
    }

    const statusCode = responseData._statusCode || 200;
    delete responseData._statusCode;

    // Add guest limit info to meta
    if (responseData.meta) {
      const nextSkip = isOffset ? parsedSkip + 9 : parsedSkip + 1;
      const nextLimitReached = isOffset ? nextSkip >= MAX_OFFSET : nextSkip >= MAX_PAGES;
      responseData.meta.guestLimitReached = nextLimitReached;
      responseData.meta.guestMaxAds = 35;
    }

    return res.status(statusCode).json(responseData);
  } catch (err) {
    console.error('Error in guest search:', err.message);
    return res.status(500).json({ code: 500, message: 'Failed to perform guest search' });
  }
}

/**
 * POST /api/v1/common/dashboard/public-search
 * No token required — returns default ads from all networks for the guest landing page.
 * Limited to 35 ads per platform (4 pages × 9 ads).
 */
async function publicSearch(req, res) {
  const { skip = 0, network = 'all' } = req.body;

  const parsedSkip = Number(skip) || 0;
  const isOffset   = parsedSkip > 20;

  const MAX_PAGES  = 4;
  const MAX_OFFSET = 27;

  const limitReached = isOffset ? parsedSkip >= MAX_OFFSET : parsedSkip >= MAX_PAGES;

  if (limitReached) {
    return res.status(200).json({
      code: 200,
      data: [],
      meta: { total: {}, guestLimitReached: true },
      message: 'Guest limit reached. Please login to view more.',
    });
  }

  // Accept single platform string or array; default to 'all'
  const resolvedNetwork = Array.isArray(network)
    ? (network.length === 1 ? network[0] : 'all')
    : (network || 'all');

  try {
    const mockReq = {
      body: {
        network: resolvedNetwork,
        user_id: 281,
        skip:    parsedSkip,
        take:    '9',
        keyword: 'NA', advertiser: 'NA', domain: 'NA',
        country: 'NA', type: 'NA', newest_sort: 'newest_sort',
      },
      query:     {},
      headers:   {},
      planAccess: null,
      user:       null,
      ip:         req.ip,
    };

    let responseData = null;
    const mockRes = {
      status: (code) => ({
        json: (data) => { responseData = { ...data, _statusCode: code }; },
      }),
    };

    await searchAllNetworks(mockReq, mockRes);

    if (!responseData) {
      return res.status(500).json({ code: 500, message: 'Search returned no response' });
    }

    const statusCode = responseData._statusCode || 200;
    delete responseData._statusCode;

    if (responseData.meta) {
      const nextSkip        = isOffset ? parsedSkip + 9 : parsedSkip + 1;
      const nextLimitReached = isOffset ? nextSkip >= MAX_OFFSET : nextSkip >= MAX_PAGES;
      responseData.meta.guestLimitReached = nextLimitReached;
      responseData.meta.guestMaxAds       = 35;
    }

    return res.status(statusCode).json(responseData);
  } catch (err) {
    console.error('Error in public search:', err.message);
    return res.status(500).json({ code: 500, message: 'Failed to perform public search' });
  }
}

module.exports = { createDashboardShare, getDashboardShare, guestSearch, publicSearch };
