require('dotenv').config()
const express = require("express");
const router = express.Router();
const { adPositionFilter } = require('../src/ad-position-analytics')


router.post("/position-counts", adPositionFilter);


module.exports = router;