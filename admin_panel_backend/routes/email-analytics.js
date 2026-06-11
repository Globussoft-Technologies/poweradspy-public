const express = require("express");
const router = express.Router();
const h = require("../src/email-analytics");

// Email delivery analytics (PRD Feature 2) — read-only.
// Mounted at /admin-panel/email-analytics
router.get("/summary", h.summary);
router.get("/run-status", h.runStatus);
router.get("/log", h.log);
router.get("/log/:send_id", h.detail);
router.get("/calendar", h.calendar);
router.get("/breakdown", h.breakdown);

module.exports = router;
