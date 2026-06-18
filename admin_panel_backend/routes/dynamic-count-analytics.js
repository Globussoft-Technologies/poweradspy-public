require('dotenv').config();
const express = require('express');
const router = express.Router();
const { dynamicCountFilter } = require('../src/dynamic-count-analytics');
const { logGetCount } = require('../src/get-count-logger');

// Audit every /get-count hit (who/what/response) for admin<->DS reconciliation.
// Wrapping res.json captures every response path (200/400/500) in one place;
// logging is best-effort and never blocks the response.
function auditLog(req, res, next) {
  const startedAt = Date.now();
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    logGetCount({ req, status: res.statusCode || 200, response: body, durationMs: Date.now() - startedAt });
    return sendJson(body);
  };
  next();
}

// Mounted at /admin-panel/network-name → POST /admin-panel/network-name/get-count
router.post('/get-count', auditLog, dynamicCountFilter);

module.exports = router;
module.exports.auditLog = auditLog;
