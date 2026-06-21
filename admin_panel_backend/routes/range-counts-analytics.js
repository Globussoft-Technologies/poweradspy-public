require('dotenv').config();
const express = require('express');
const router = express.Router();
const { rangeCountsFilter } = require('../src/range-counts-analytics');

router.post('/get-range-counts', rangeCountsFilter);

module.exports = router;
