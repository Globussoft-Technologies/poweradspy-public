require('dotenv').config()
const express = require("express");
const router = express.Router();
const {systemsNames, systemsAnalytics, accountsMetrics, accountsNameList,pluginWithChart, systemsDetails,systemActive,systemStateChart,accountStateChart,getDomainsProcessed} = require('../src/system-metrics')
const wrapAsync = require('../utils/async-handler');


router.post("/systems-names", wrapAsync(systemsNames));
router.post("/systems-analytics", wrapAsync(systemsAnalytics));
router.post("/accounts-name-list", wrapAsync(accountsNameList));
router.post("/accounts-metrics", wrapAsync(accountsMetrics));
router.post('/plugin-with-chart', wrapAsync(pluginWithChart));
router.post('/system-details', wrapAsync(systemsDetails));
router.post('/system-active', wrapAsync(systemActive));
router.post('/system-state-chart', wrapAsync(systemStateChart));
router.post('/account-state-chart', wrapAsync(accountStateChart));
router.post('/domains-data', wrapAsync(getDomainsProcessed));
module.exports = router;