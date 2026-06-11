require('dotenv').config()
const express = require("express");
const router = express.Router();
const {totalAdsCountFilter}= require('../src/total-ad-count-analytics.js')


router.post("/get-ads-count",totalAdsCountFilter);

module.exports = router;