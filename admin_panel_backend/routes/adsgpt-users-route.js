require('dotenv').config()
const express = require("express");
const router = express.Router();
const { getUserInteractionData,getUserIds,getUsersStats,getUserUsageCost } = require('../src/adsgpt-user-data')
const {authenticateJWT} = require("../services/authService")

router.get('/get-user-data/:userid',getUserInteractionData)
router.get('/get-user-id/',getUserIds)
router.get('/get-users-stats',getUsersStats)
router.get('/get-user-usage/:userid',authenticateJWT,getUserUsageCost)


module.exports = router;