require('dotenv').config()
const express = require("express");
const router = express.Router();
const { adCountGraphFilter } = require('../src/ad-count-graph-analytics')


router.post("/ad-count-graph", adCountGraphFilter);


module.exports = router;