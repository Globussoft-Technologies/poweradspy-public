import express from "express";
import axios from "axios";
import config from "config";
import competitorController from "../../core/Competitors/competitorController.js";
import { verifyToken } from "../../utils/authentication.js";
import dashboardController from "../../core/Dashboard/dashboardController.js";
import monitorController from "../../core/Competitors/monitorController.js"
import emailController from "../../core/mailer/emailController.js";
import dataReportController from "../../core/mailer/dataReportController.js";
import keywordNotifyController from "../../core/mailer/keywordNotifyController.js";
import { handleSendgridWebhook, recordUnsubscribeEvent } from "../../core/mailer/sendgridWebhookController.js";
import advertiserController from "../../core/Advertisers/advertiserController.js";
import memberController from "../../core/Members/memberController.js";
import manualSendController from "../../core/mailer/manualSendController.js";
import userController from "../../core/Users/userController.js";
import memberOverviewController from "../../core/Members/memberOverviewController.js";
import snapshotController from "../../core/Dashboard/snapshotController.js";
import alertRulesController from "../../core/Dashboard/alertRulesController.js";
import activityFeedController from "../../core/Dashboard/activityFeedController.js";

const app = express(); 
const router = express.Router();

const entitlementCache = new Map();
const ENTITLEMENT_CACHE_MS = 5000;
const hasConfig = (key) => typeof config.has === "function" && config.has(key);
const PLAN_CONTROL_MODE = hasConfig("PLAN_CONTROL_ENFORCEMENT_MODE")
  ? String(config.get("PLAN_CONTROL_ENFORCEMENT_MODE")).toLowerCase()
  : "shadow";
const LEGACY_PLAN_ACCESS_URL = hasConfig("PLAN_ACCESS_API_URL")
  ? String(config.get("PLAN_ACCESS_API_URL"))
  : "";
const ENTITLEMENTS_URL = hasConfig("PLAN_ENTITLEMENTS_API_URL")
  ? String(config.get("PLAN_ENTITLEMENTS_API_URL"))
  : LEGACY_PLAN_ACCESS_URL.replace(/\/plan-access\/?$/, "/entitlements");

const NETWORK_IDS = new Set(["facebook", "instagram", "youtube", "google", "gdn", "linkedin", "reddit", "quora", "pinterest", "tiktok", "native"]);

function filterDeniedNetworks(value, allowed) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => {
        const network = item && typeof item === "object" ? item.platform || item.network : null;
        return !network || allowed.has(String(network).toLowerCase());
      })
      .map((item) => filterDeniedNetworks(item, allowed));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !NETWORK_IDS.has(key.toLowerCase()) || allowed.has(key.toLowerCase()))
    .map(([key, item]) => [key, filterDeniedNetworks(item, allowed)]));
}

function planCapability(capabilityId, options = {}) {
  return async function competitorPlanCapability(req, res, next) {
    const authorization = req.headers.authorization || "";
    try {
      if (!ENTITLEMENTS_URL) throw new Error("Plan entitlements URL is not configured");
      const now = Date.now();
      let cached = entitlementCache.get(authorization);
      if (!cached || now - cached.at >= ENTITLEMENT_CACHE_MS) {
        const response = await axios.get(ENTITLEMENTS_URL, {
          headers: { Authorization: authorization },
          timeout: 3000,
        });
        cached = { at: now, data: response.data?.data || null };
        if (entitlementCache.size >= 500) entitlementCache.delete(entitlementCache.keys().next().value);
        entitlementCache.set(authorization, cached);
      }
      const decision = cached.data?.capabilities?.[capabilityId];
      req.planControlDecision = decision || null;
      const allowedNetworks = new Set((decision?.allowedNetworks || []).map((network) => String(network).toLowerCase()));
      const requestedNetwork = req.body?.platform || req.body?.network || req.query?.platform || req.query?.network;
      const networkDenied = options.networkAware && requestedNetwork && requestedNetwork !== "all"
        && !allowedNetworks.has(String(requestedNetwork).toLowerCase());
      if (decision?.allowed !== false && !networkDenied) {
        if (PLAN_CONTROL_MODE === "enforce" && options.networkAware && allowedNetworks.size) {
          const originalJson = res.json.bind(res);
          res.json = (body) => originalJson(filterDeniedNetworks(body, allowedNetworks));
        }
        return next();
      }
      const deniedDecision = networkDenied
        ? { ...decision, allowed: false, reasonCode: "NETWORK_NOT_PERMITTED" }
        : decision;
      if (PLAN_CONTROL_MODE !== "enforce") {
        console.warn("[plan-control-shadow-denial]", {
          capabilityId,
          reasonCode: deniedDecision?.reasonCode,
          path: req.originalUrl,
          userId: req.user?.id,
        });
        return next();
      }
      return res.status(403).json({
        code: 403,
        message: "Your current plan does not support this project feature.",
        ...deniedDecision,
      });
    } catch (error) {
      console.error("[plan-control-check-failed]", { capabilityId, message: error.message });
      if (PLAN_CONTROL_MODE !== "enforce") return next();
      return res.status(503).json({
        code: 503,
        message: "Entitlement check unavailable.",
        reasonCode: "POLICY_UNAVAILABLE",
      });
    }
  };
}

const projectAccess = planCapability("projects.access");
const projectSession = planCapability("projects.session");
const projectView = planCapability("projects.view");
const projectBrandCreate = planCapability("projects.brand.create");
const competitorDiscovery = planCapability("projects.competitors.discovery");
const competitorMonitoring = planCapability("projects.competitors.monitoring");
const projectAnalytics = planCapability("projects.analytics", { networkAware: true });
const projectManage = planCapability("projects.manage");
const projectMembers = planCapability("projects.members");
const projectBrandCc = planCapability("projects.brand_cc");
const projectAlerts = planCapability("projects.alerts");
const projectActivity = planCapability("projects.activity_feed");
router.post("/active-competitor-contacts", monitorController.activeCompetitorContacts);
router.get("/get-competitors", monitorController.getCompetitors);
router.get("/update-competitors-status", monitorController.updateCompetitorsStatus);
router.post("/create-mail", emailController.sendEmail);

// ── Data report (NEW) — ES-count summary mail + SendGrid subscribers ──
router.post("/data-report/send", dataReportController.send);
router.post("/data-report/test", dataReportController.sendTest);
router.get("/data-report/stats", dataReportController.stats);
router.get("/data-report/subscribers", dataReportController.subscribers);
router.get("/data-report/contacts", dataReportController.contacts);
router.get("/data-report/recipients", dataReportController.recipients);

// ── Keyword / advertiser notification (NEW) — mails users their tracked terms
//    that picked up new ads (source: keyword_ad_notifications). Config-driven
//    cron; these routes are for manual run / preview / schedule inspection. ──
router.post("/keyword-notify/run", keywordNotifyController.run);
router.get("/keyword-notify/preview", keywordNotifyController.preview);
router.get("/keyword-notify/schedule", keywordNotifyController.schedule);

// SendGrid Event Webhook (public — no auth; SendGrid posts delivery events here)
router.post("/webhooks/sendgrid", handleSendgridWebhook);

// Record a custom (platform) unsubscribe as an email_send_events row so the
// admin dashboard's Unsubscribed tile reflects it. Public; called by pas_node_api.
router.post("/email-events/unsubscribe", recordUnsubscribeEvent);

// ── Admin-triggered single-recipient send (NEW, additive — never touches
//    the existing /active-competitor-contacts or /data-report/send paths).
//    See docs/MEMBER_CC_MANIFEST.md §8.
router.post("/email-analytics/send-competitor",  manualSendController.sendCompetitor);
router.post("/email-analytics/send-data-report", manualSendController.sendDataReport);
router.post("/email-analytics/send-keyword-notify", manualSendController.sendKeywordNotify);

// Admin-panel members overview (read-only, joins members + brand_cc_members
// + email_send_log[member_brand]). Public to match the existing read-only
// admin endpoints; lock it behind verifyToken later if needed.
router.get("/members/admin-overview", memberOverviewController.overview);
router.get('/update-daily-competitors',monitorController.updateDailyCompetitors)
router.post('/unsubscribe-mail', monitorController.unSubscribeMail);
router.post('/resubscribe-mail', monitorController.reSubscribeMail);
router.get("/get-all-details", competitorController.getAllDetails);
router.post("/filter-details", competitorController.filterDetails);
router.get("/get-active-details", competitorController.getActiveUsers);
router.get("/get-inactive-details", competitorController.getInactiveUsers);
router.get("/get-comp-users-count", competitorController.getCompUsersCount);
router.get("/get-all-users", userController.getAllUsers);
router.post("/user-brand-stats", dashboardController.getUserBrandStats);
router.post("/competitor-ads-by-range", dashboardController.getCompetitorAdsByRange);
router.post("/competitors-trend-batch", dashboardController.getCompetitorsTrend);

// ── Competitor snapshot rollup (NEW) — manual/debug trigger for the
//    snapshot → alert-evaluation → change-detection chain. See snapshotCron.js
//    for the scheduled version. Same pre-auth placement as /keyword-notify/run
//    above (an ops trigger, not user data). ──
router.get("/snapshot/run", snapshotController.run);
router.get("/snapshot/last-run", snapshotController.lastRun);
router.get("/alert-rules/run", alertRulesController.run);

// Customer analytics are used by the authenticated All Projects frontend.
// They must establish customer identity before any plan/capability decision.
router.post("/get-lcs", verifyToken, projectAnalytics, advertiserController.getLCS);
router.post("/get-engagement", verifyToken, projectAnalytics, advertiserController.getEngagementData);
router.post("/get-frequent-data", verifyToken, projectAnalytics, advertiserController.getFrequentData);
router.post("/get-avgbud-data", verifyToken, projectAnalytics, advertiserController.getAverageBudgetByData);
router.post("/get-longest", verifyToken, projectAnalytics, advertiserController.getLongestAd);
router.post("/get-top-likes", verifyToken, projectAnalytics, advertiserController.getTopLikes);
router.post("/get-top-comments", verifyToken, projectAnalytics, advertiserController.getTopComments);
router.post("/get-top-impression", verifyToken, projectAnalytics, advertiserController.getTopImpressions);
router.post("/get-top-popularity", verifyToken, projectAnalytics, advertiserController.getTopPopularity);
router.post("/get-category", verifyToken, projectAnalytics, advertiserController.getCategory);
router.post("/get-ad-count", verifyToken, projectAnalytics, advertiserController.getAdCount);
router.post("/get-ad-type", verifyToken, projectAnalytics, advertiserController.getAdType);
router.get("/get-countries", verifyToken, projectAnalytics, dashboardController.getCountry);

router.use(verifyToken);

router.post("/create-backlink", projectManage, dashboardController.insertBacklink);
router.post("/organic-search", projectManage, dashboardController.insertOrganicSearch);
router.post("/paid-search", projectManage, dashboardController.insertpaidSearch);

router.post("/create-comp-details", projectSession, competitorController.create);
router.post("/competitors-request", projectBrandCreate, competitorController.insertCompRequests);
router.get("/check-user", projectSession, competitorController.checkUser);
router.post("/check-brand", projectBrandCreate, competitorController.checkBrand);

router.post("/project-details", projectView, dashboardController.userProject);

// ── Project members + per-brand competitor-email CC (NEW) ──
router.post("/members/list", projectMembers, memberController.listMembers);
router.post("/members/add", projectMembers, memberController.addMember);
router.post("/members/update", projectMembers, memberController.updateMember);
router.post("/members/delete", projectMembers, memberController.deleteMember);
router.post("/brand-cc/get", projectBrandCc, memberController.getBrandCc);
router.post("/brand-cc/set", projectBrandCc, memberController.setBrandCc);
router.post("/compeitetor-name", competitorDiscovery, dashboardController.projectcompeitetor);
router.post("/compeitetor-name-client", competitorDiscovery, dashboardController.projectcompeitetorClient);
router.post("/compeitetor-count", competitorDiscovery, dashboardController.getplatformcount);
router.post("/fetch-competitors", competitorDiscovery, competitorController.fetchCompetitors);
router.post("/fetch-competitors-client", competitorDiscovery, competitorController.fetchCompetitorsClient);
router.post("/fetch-competitors-for-update", competitorDiscovery, competitorController.fetchCompetitorsForUpdate);
router.post("/fetch-competitors-for-update-client", competitorDiscovery, competitorController.fetchCompetitorsForUpdateClient);
router.post("/fetch-competitors-for-update-new", competitorDiscovery, competitorController.fetchCompetitorsForUpdateNew);
router.post("/get-competitor-count", competitorDiscovery, dashboardController.getCompetitorsCount);
router.post("/get-competitor-count-new", competitorDiscovery, dashboardController.getCompetitorsCountNew);
router.post("/update-monitoring", competitorMonitoring, competitorController.updateMonitoring);
router.post("/get-backlinks", projectAnalytics, dashboardController.getBackLinks);
router.post("/get-organic-searches", projectAnalytics, dashboardController.getOrganicSearches);
router.post("/get-paid-searches", projectAnalytics, dashboardController.getPaidSearches);
router.post("/get-count", projectView, dashboardController.getCount);
router.post("/get-store-process-competitors", competitorDiscovery, competitorController.getStoreProcessCompetitors);
router.post("/check-existing-competitorcount", competitorDiscovery, competitorController.checkExistingCompetitorCount);
router.post("/get-all-competitors", competitorDiscovery, competitorController.getAllCompetitors);


router.post("/update-competitors", projectManage, competitorController.updateCompetitors);
router.post("/update-competitors-new", projectManage, competitorController.updateCompetitorsNew);
router.patch("/update-advertiser", projectManage, competitorController.updateAdvertiser);
router.post("/check-daily-token-limit", competitorDiscovery, competitorController.checkDailyTokenLimit);
router.post("/fetch-keywords-basedOnWebsite", competitorDiscovery, competitorController.fetchKeywordsBasedOnWebsite);
router.post("/check-competitor-process", competitorDiscovery, competitorController.checkCompetitorProcess);
router.post("/delete-project", projectManage, competitorController.deleteProject);
router.post("/add-manual-competitor", projectManage, competitorController.addManualCompetitor);
router.post("/delete-competitor", projectManage, competitorController.deleteCompetitor);

// ── Threshold-based competitor alerts (NEW) ──
router.post("/alert-rules/list", projectAlerts, alertRulesController.list);
router.post("/alert-rules/create", projectAlerts, alertRulesController.create);
router.post("/alert-rules/update", projectAlerts, alertRulesController.update);
router.post("/alert-rules/delete", projectAlerts, alertRulesController.delete);

// ── "What changed" activity feed (NEW) — shared activity_events store with
//    the alert rules above (category "alert" vs "change"). ──
router.post("/activity-feed/list", projectActivity, activityFeedController.list);
router.post("/activity-feed/mark-read", projectActivity, activityFeedController.markRead);

export default router;
