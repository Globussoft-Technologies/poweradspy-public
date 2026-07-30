require('dotenv').config();
const express = require('express');
const router = express.Router();
const { dailyDomainRegistrationStats } = require('../src/domain-registration-stats');

// POST /admin-panel/domain-registration-stats/daily
// Body: { range: { from, to }, networks?: [] } → per-platform daily
// processed / updated / failed counts for the domain-registration-date crawler.
router.post('/daily', dailyDomainRegistrationStats);

module.exports = router;
