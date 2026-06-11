'use strict';

const metrics = require('../metrics/MetricsCollector');

/**
 * Express middleware that records request metrics into MetricsCollector.
 * Must be placed AFTER request logging middleware in the chain.
 */
function metricsMiddleware() {
  return (req, res, next) => {
    const start = Date.now();

    // Track active connections
    metrics.activeConnections++;

    // Listen for response finish
    res.on('finish', () => {
      const responseTime = Date.now() - start;
      metrics.activeConnections--;
      metrics.recordRequest(req, res, responseTime);
    });

    // Also handle connection close/error
    res.on('close', () => {
      if (!res.writableFinished) {
        metrics.activeConnections--;
      }
    });

    next();
  };
}

module.exports = metricsMiddleware;
