'use strict';

/**
 * Geolocation routes — port of PHP geolocation.poweradspy.com routes/web.php.
 * Auto-mounted by ServiceRegistry under /api/v1/geoloacation.
 *
 *   GET /api/v1/geoloacation/         → location of the caller's IP
 *   GET /api/v1/geoloacation/get-ip   → location of ?ip=
 *
 * Crawler-facing; unauthenticated (same as PHP).
 */

const { Router } = require('express');
const { findLoaction, findLoactionById } = require('../controllers/findLocationController');

function createGeoloacationRoutes(service) {
  const router = Router();

  router.get('/', (req, res) => findLoaction(req, res, service.log));
  router.get('/get-ip', (req, res) => findLoactionById(req, res, service.log));

  return router;
}

module.exports = { createGeoloacationRoutes };
