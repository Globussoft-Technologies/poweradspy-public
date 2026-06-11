require('dotenv').config()
const express = require("express"); 
const router = express.Router();
const {countryStatsWithFilter} = require('../src/countries-analytics')


router.post("/counts",countryStatsWithFilter);

module.exports = router;