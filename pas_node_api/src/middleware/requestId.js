'use strict';

const crypto = require('crypto');

module.exports = function requestIdMiddleware() {
  return (req, res, next) => {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    req.id = id;
    req.requestId = id; // alias used by logger middleware
    res.setHeader('X-Request-Id', id);
    next();
  };
};
