require('dotenv').config()
const express = require("express");
const router = express.Router();
const { networkAccountDataWithFilter,currentCount } = require('../src/network-account-data')


router.post("/analytics", networkAccountDataWithFilter);
router.post("/current-analytics", currentCount);

module.exports = router;