import express from "express";
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

router.post("/get-lcs", advertiserController.getLCS);
router.post("/get-engagement", advertiserController.getEngagementData);
router.post("/get-frequent-data", advertiserController.getFrequentData);
router.post("/get-avgbud-data", advertiserController.getAverageBudgetByData);
router.post("/get-longest", advertiserController.getLongestAd);
router.post("/get-top-likes", advertiserController.getTopLikes);
router.post("/get-top-comments", advertiserController.getTopComments);
router.post("/get-top-impression", advertiserController.getTopImpressions);
router.post("/get-top-popularity", advertiserController.getTopPopularity);
router.post("/get-category", advertiserController.getCategory);
router.post("/get-ad-count", advertiserController.getAdCount);
router.post("/get-ad-type", advertiserController.getAdType);
router.get("/get-countries", dashboardController.getCountry);

router.use(verifyToken);

router.post("/create-backlink", dashboardController.insertBacklink);
router.post("/organic-search",dashboardController.insertOrganicSearch);
router.post("/paid-search",dashboardController.insertpaidSearch);

router.post("/create-comp-details", competitorController.create);
router.post("/competitors-request", competitorController.insertCompRequests);
router.get("/check-user", competitorController.checkUser);
router.post("/check-brand", competitorController.checkBrand);

router.post("/project-details", dashboardController.userProject);

// ── Project members + per-brand competitor-email CC (NEW) ──
router.post("/members/list", memberController.listMembers);
router.post("/members/add", memberController.addMember);
router.post("/members/update", memberController.updateMember);
router.post("/members/delete", memberController.deleteMember);
router.post("/brand-cc/get", memberController.getBrandCc);
router.post("/brand-cc/set", memberController.setBrandCc);
router.post("/compeitetor-name", dashboardController.projectcompeitetor);
router.post("/compeitetor-name-client", dashboardController.projectcompeitetorClient);
router.post("/compeitetor-count", dashboardController.getplatformcount);
router.post("/fetch-competitors", competitorController.fetchCompetitors);
router.post("/fetch-competitors-client", competitorController.fetchCompetitorsClient);
router.post("/fetch-competitors-for-update", competitorController.fetchCompetitorsForUpdate);
router.post("/fetch-competitors-for-update-client", competitorController.fetchCompetitorsForUpdateClient);
router.post("/fetch-competitors-for-update-new", competitorController.fetchCompetitorsForUpdateNew);
router.post("/get-competitor-count",dashboardController.getCompetitorsCount);
router.post("/get-competitor-count-new", dashboardController.getCompetitorsCountNew);
router.post("/update-monitoring", competitorController.updateMonitoring);
router.post("/get-backlinks", dashboardController.getBackLinks);
router.post("/get-organic-searches", dashboardController.getOrganicSearches);
router.post("/get-paid-searches", dashboardController.getPaidSearches);
router.post("/get-count",dashboardController.getCount)
router.post("/get-store-process-competitors", competitorController.getStoreProcessCompetitors);
router.post("/check-existing-competitorcount", competitorController.checkExistingCompetitorCount);
router.post("/get-all-competitors", competitorController.getAllCompetitors);


router.post("/update-competitors",competitorController.updateCompetitors);
router.post("/update-competitors-new", competitorController.updateCompetitorsNew);
router.patch("/update-advertiser",competitorController.updateAdvertiser);
router.post("/check-daily-token-limit", competitorController.checkDailyTokenLimit);
router.post("/fetch-keywords-basedOnWebsite", competitorController.fetchKeywordsBasedOnWebsite);
router.post("/check-competitor-process", competitorController.checkCompetitorProcess);
router.post("/delete-project", competitorController.deleteProject);
router.post("/add-manual-competitor", competitorController.addManualCompetitor);
router.post("/delete-competitor", competitorController.deleteCompetitor);

// ── Threshold-based competitor alerts (NEW) ──
router.post("/alert-rules/list", alertRulesController.list);
router.post("/alert-rules/create", alertRulesController.create);
router.post("/alert-rules/update", alertRulesController.update);
router.post("/alert-rules/delete", alertRulesController.delete);

// ── "What changed" activity feed (NEW) — shared activity_events store with
//    the alert rules above (category "alert" vs "change"). ──
router.post("/activity-feed/list", activityFeedController.list);
router.post("/activity-feed/mark-read", activityFeedController.markRead);

export default router;
