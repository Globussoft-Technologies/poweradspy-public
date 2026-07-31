require('dotenv').config();
const express = require('express');
const router = express.Router();
const { dailyAiMetaStats } = require('../src/ai-meta-stats');

// POST /admin-panel/ai-meta-stats/daily
// Body: { range: { from, to }, networks?: [] } → per-platform daily count of ads written to
// <net>_ad_ai_meta, bucketed by updated_at, plus the newest write time.
router.post('/daily', dailyAiMetaStats);

module.exports = router;
