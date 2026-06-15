require('dotenv').config();
const express = require('express');
const router = express.Router();
const { dynamicCountFilter } = require('../src/dynamic-count-analytics');

// Mounted at /admin-panel/network-name → POST /admin-panel/network-name/get-count
router.post('/get-count', dynamicCountFilter);

module.exports = router;
