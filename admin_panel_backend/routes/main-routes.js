const express = require("express");
const countriesAnalytics = require("./countries-analytics")
const typeAnalytics = require("./types-analytics")
const funnelAnalytics = require("./funnel-analytics")
const builtWithAnalytics = require("./builtwith-analytics")
const positionAnalytics = require("./ad-position-analytics")
const sourceAnalytics = require("./ad-source-analytics")
const countAnalytics = require("./ad-count-analytics")
const countGraphAnalytics = require("./ad-count-graph-analytics")
const affiliateDate = require("./affiliate-data")
const networkAccountAnalytics = require("./network-account-analytics")
const totalAdCountAnalytics = require("./total-ad-count.anaylytics")
const rangeCountsAnalytics = require("./range-counts-analytics")
const dynamicCountAnalytics = require("./dynamic-count-analytics")
const systemMetrics = require("./system-metrics-api")
const adsgptUsersRoute = require("./adsgpt-users-route")
const agentConfig = require("./agent-config-route")
const competitorEmailDetails = require("./competitor-email-details")
const emailAnalytics = require("./email-analytics")
const app = express();

app.use("/networks-countries", countriesAnalytics);
app.use("/networks-types", typeAnalytics)
app.use("/networks-funnel",funnelAnalytics)
app.use("/networks-built_with",builtWithAnalytics)
app.use("/affiliate_data",affiliateDate)

 app.use("/networks-position",positionAnalytics)
 app.use("/networks-source", sourceAnalytics)
 app.use("/networks-ad-counts",countAnalytics )
 app.use("/networks-graph", countGraphAnalytics)

 app.use("/network-account",networkAccountAnalytics)
 app.use("/network-name", totalAdCountAnalytics)
 app.use("/network-name", rangeCountsAnalytics)
 app.use("/network-name", dynamicCountAnalytics)


 app.use("/system-metrics",systemMetrics)

 app.use("/adsgpt-users", adsgptUsersRoute)
 app.use("/agent-config", agentConfig)
 app.use("/competitor-email-details", competitorEmailDetails)
 app.use("/email-analytics", emailAnalytics)
module.exports = app;