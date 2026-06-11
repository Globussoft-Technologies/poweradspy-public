'use strict';

/**
 * insertionEnabled(networkSlug) — per-network insertion on/off guard.
 *
 * Returns 403 when config.networks.<slug>.insertion.enabled is false, so a
 * network's insertion endpoints can be switched off without touching its
 * read/search endpoints. Reads the live networks config (hot-reloadable).
 */

const networksConfig = require('../config/networks');

function insertionEnabled(networkSlug) {
  return function (req, res, next) {
    const net = networksConfig[networkSlug];
    if (net && net.insertion && net.insertion.enabled === false) {
      return res.status(403).json({
        code: 403,
        status: 'rejected',
        message: `Insertion is currently disabled for the ${networkSlug} network.`,
        hint: `Set networks.${networkSlug}.insertion.enabled = true in config.json (or the ${networkSlug.toUpperCase()}_INSERTION_ENABLED env) to accept ads again. Nothing was inserted.`,
      });
    }
    return next();
  };
}

module.exports = { insertionEnabled };
