require('dotenv').config()
const express = require("express");
const router = express.Router();
const { adSourceFilter } = require('../src/ad-source-analytics')


router.post("/source-counts", adSourceFilter);


module.exports = router;