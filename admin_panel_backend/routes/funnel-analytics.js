require('dotenv').config()
const express = require("express"); 
const router = express.Router();
const {funnelStatsWithFilter} = require('../src/funnel-analytics')


router.post("/counts",funnelStatsWithFilter);


module.exports = router;