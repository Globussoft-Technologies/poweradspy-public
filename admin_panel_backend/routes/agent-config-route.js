require('dotenv').config()
const express = require("express");
const router = express.Router();
const { fetchAgentData} = require('../src/agent-config-data')


router.get('/get-data',fetchAgentData)


module.exports = router;