'use strict';

const compression = require('compression');
const config = require('../config');

function compressionMiddleware() {
  return compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    threshold: config.compression.threshold,
  });
}

module.exports = compressionMiddleware;
