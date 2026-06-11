'use strict';

/**
 * Basic health check endpoints for liveness and readiness probes.
 * Usually monitored by Kubernetes or load balancers.
 */

const express = require('express');
const os = require('os');
const databaseManager = require('../database/DatabaseManager');

class HealthCheck {
  static register(app) {
    const router = express.Router();

    // Liveness probe (is the process running?)
    router.get('/live', (req, res) => {
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Readiness probe. Per-network DB status is reported for monitoring but
    // does not gate readiness — the app should still serve other networks
    // even if a specific DB is down.
    router.get('/ready', (req, res) => {
      res.status(200).json({
        status: 'ready',
        databases: databaseManager.getHealth(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        loadAvg: os.loadavg(),
      });
    });

    app.use('/health', router);
  }
}

module.exports = HealthCheck;
