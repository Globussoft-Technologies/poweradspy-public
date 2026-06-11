require('dotenv').config()
const express = require("express");
const router = express.Router();
const { adCountFilter } = require('../src/ad-count-analytics')


router.post("/ad-counts", adCountFilter);


module.exports = router;