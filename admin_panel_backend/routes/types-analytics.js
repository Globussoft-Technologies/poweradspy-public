require('dotenv').config()
const express = require("express"); 
const router = express.Router();
const {typesStatsWithFilter} = require('../src/types-anaytics')


router.post("/counts",typesStatsWithFilter);

module.exports = router;