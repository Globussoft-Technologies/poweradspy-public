require('dotenv').config()
const express = require("express"); 
const router = express.Router();
const {affiliateWithFilter} = require('../src/affiliate-data')


router.post("/counts",affiliateWithFilter);


module.exports = router;