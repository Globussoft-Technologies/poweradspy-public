'use strict';

/**
 * SDUI Service Routes (Public API)
 *
 * Mounts the following endpoints (registered in app.js under /api):
 *
 *    GET  /api/sdui/config                  - SDUI config (grouped by config_type)
 *    GET  /api/v1/sdui/config/version       - SDUI config version hash
 */

const express = require('express');
const sduiService = require('./services/sduiService');
const logger = require('../../logger');

const log = logger.createChild('sdui-routes');

// ── Router factory ────────────────────────────────────────────────────────────
function createSduiRouter() {
  const router = express.Router();

  // GET /api/sdui/config
  // Optional: ?platforms=facebook,youtube to filter by platform
  router.get('/sdui/config', async (req, res) => {
    try {
      let config = await sduiService.getSDUIConfig();

      // Apply platform-based filtering if ?platforms is provided
      const platformsParam = req.query.platforms;
      if (platformsParam) {
        const platforms = platformsParam.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
        if (platforms.length) {
          config = sduiService.filterConfigByPlatforms(config, platforms);
        }
      }

      // Prevent browser from caching stale sidebar config
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.json(config);
    } catch (err) {
      log.error('GET /sdui/config failed', { error: err.message });
      res.status(500).json({ error: 'db error' });
    }
  });

  // GET /api/v1/sdui/config/version
  router.get('/v1/sdui/config/version', async (_req, res) => {
    try {
      const config = await sduiService.getSDUIConfig();
      const body = JSON.stringify(config);
      const version = sduiService.computeVersion(body);
      res.json({ config_version: version });
    } catch (err) {
      log.error('GET /v1/sdui/config/version failed', { error: err.message });
      res.status(500).json({ error: 'db error' });
    }
  });

  return router;
}

module.exports = { createSduiRouter };
