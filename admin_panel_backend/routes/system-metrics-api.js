require('dotenv').config()
const express = require("express");
const router = express.Router();
const {systemsNames, systemsAnalytics, accountsMetrics, accountsNameList,pluginWithChart, systemsDetails,systemActive,systemStateChart,accountStateChart,getDomainsProcessed} = require('../src/system-metrics')
const dashboard = require('../src/system-dashboard');
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
router.post('/dashboard/overview', wrapAsync(dashboard.overview));
router.post('/dashboard/system', wrapAsync(dashboard.systemDrill));
router.post('/dashboard/accounts', wrapAsync(dashboard.accountsOverview));
router.post('/dashboard/account-timeline', wrapAsync(dashboard.accountTimeline));
router.post('/dashboard/platforms', wrapAsync(dashboard.platforms));
router.post('/dashboard/system-debug', wrapAsync(dashboard.systemDebug));
router.get('/dashboard/exporter-health', wrapAsync(dashboard.exporterHealth));
module.exports = router;