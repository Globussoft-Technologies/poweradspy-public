import config from "config";
import moment from "moment";
import logger from "../../resources/logs/logger.log.js";
import { getSubscribedUserEmails, getSubscribedUsers } from "./amemberService.js";
import { getContactsBreakdown } from "./sendgridContactsService.js";

/**
 * Ramp + priority config reader (manifest §17). All three keys are optional:
 *   daily_report_ramp_start  — IST date "YYYY-MM-DD" of day 1, or null
 *   daily_report_ramp_cap    — integer per-day increment (compounds: day N → N × cap)
 *   daily_report_priority    — array like ["active"], ["new_user"],
 *                              or ["active","new_user"] (primary, secondary, …)
 * Returns { start, cap, priority } with safe null defaults.
 */
function rampConfig() {
  let start = null, cap = null, priority = null;
  try { start = config.get("daily_report_ramp_start"); } catch { /* unset */ }
  try { cap = config.get("daily_report_ramp_cap"); } catch { /* unset */ }
  try { priority = config.get("daily_report_priority"); } catch { /* unset */ }
  const capNum = Number(cap);
  return {
    start: start ? String(start).slice(0, 10) : null,
    cap: Number.isFinite(capNum) && capNum > 0 ? Math.floor(capNum) : null,
    priority: Array.isArray(priority)
      ? priority.map((p) => String(p || "").trim().toLowerCase()).filter(Boolean)
      : (typeof priority === "string" && priority.trim()
          ? priority.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean)
          : null),
  };
}

/**
 * 1-indexed day number relative to ramp_start in IST. Returns null when the
 * ramp is disabled or today is before the start date.
 */
function rampDayNumber({ start }) {
  if (!start) return null;
  const todayKey = moment.utc().utcOffset("+05:30").format("YYYY-MM-DD");
  if (todayKey < start) return null;
  return moment(todayKey, "YYYY-MM-DD").diff(moment(start, "YYYY-MM-DD"), "days") + 1;
}

/**
 * Sort users by the configured priority criteria. Multiple criteria are
 * applied as primary → secondary → … sort keys.
 *
 * Supported criteria:
 *   "active"   — most recently logged-in first (uses raw.last_login).
 *   "new_user" — most recent signups first (uses raw.added).
 *
 * Unknown criteria score 0 (no effect). A user missing the relevant field
 * scores -1 so populated rows always rank above empty ones.
 */
function sortByPriority(users, priority) {
  if (!priority?.length) return users;
  const scoreFor = (u, crit) => {
    switch (crit) {
      case "active":
        return u.last_login ? Date.parse(u.last_login) || -1 : -1;
      case "new_user":
      case "new":
        return u.added ? Date.parse(u.added) || -1 : -1;
      default:
        return 0;
    }
  };
  return [...users].sort((a, b) => {
    for (const crit of priority) {
      const sa = scoreFor(a, crit);
      const sb = scoreFor(b, crit);
      if (sa !== sb) return sb - sa; // higher score first
    }
    return 0;
  });
}

/**
 * Apply the daily ramp (day N × cap_per_day) and priority sort to an
 * eligible-users list. Returns the trimmed users plus a diagnostic block
 * (rendered by /data-report/recipients so the operator sees what happened).
 *
 * No-op when ramp config is incomplete — original list returned unchanged.
 */
export function applyRampAndPriority(users) {
  const cfg = rampConfig();
  if (!cfg.start || !cfg.cap) {
    return { users, ramp: null };
  }
  const dayN = rampDayNumber({ start: cfg.start });
  if (dayN == null) {
    return {
      users: [],
      ramp: {
        applied: true, day: 0, cap_per_day: cfg.cap, limit: 0,
        priority: cfg.priority || [], eligible: users.length, selected: 0,
        note: "today is before daily_report_ramp_start — no recipients today",
      },
    };
  }
  const limit = dayN * cfg.cap;
  const sorted = sortByPriority(users, cfg.priority);
  const capped = sorted.slice(0, limit);
  return {
    users: capped,
    ramp: {
      applied: true,
      day: dayN,
      cap_per_day: cfg.cap,
      limit,
      priority: cfg.priority || [],
      eligible: users.length,
      selected: capped.length,
    },
  };
}

/**
 * Optional config override. If `dailyreport` in config is a non-empty list
 * (array, or comma-separated string) of emails, the daily report goes ONLY to
 * those addresses (handy for testing / targeted sends). null / undefined /
 * empty → normal aMember + SendGrid fetch.
 * @returns {string[]|null}
 */
export function getDailyReportOverride() {
  let v = null;
  try { v = config.get("dailyreport"); } catch { v = null; }
  if (v === null || v === undefined || v === "") return null;
  const arr = Array.isArray(v) ? v : (typeof v === "string" ? v.split(",") : []);
  const clean = [
    ...new Set(arr.map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@"))),
  ];
  return clean.length ? clean : null;
}

/**
 * Who the data report is mailed to (NEW).
 *
 * Source of truth = aMember (every PowerAdSpy user with unsubscribed = 0).
 * On top of that we best-effort drop any address SendGrid has suppressed
 * (bounced / blocked / spam / invalid / globally unsubscribed) so we never
 * waste a send on a dead address. If the SendGrid lookup fails we still
 * return the full aMember list — suppression filtering never blocks the send.
 *
 * @param {Object}  [opts]
 * @param {boolean} [opts.applySuppressions=true]
 * @returns {Promise<{ recipients, totalSubscribed, suppressedExcluded, amemberTotal }>}
 */
export async function getReportRecipients({ applySuppressions = true } = {}) {
  const rcfg = rampConfig();
  const useRamp = !!(rcfg.start && rcfg.cap);

  // ── Ramp + priority path (manifest §17) ──────────────────────────────
  // Pulls the richer user records so we can sort by signup date /
  // last_login, then caps at dayN × cap_per_day.
  if (useRamp) {
    const { users, total } = await getSubscribedUsers();

    // Suppress first → ramp afterwards so the cap counts only sendable
    // addresses (cap of 1000 means 1000 ATTEMPTED sends, not "1000 picked
    // and 200 of them silently dropped").
    const suppressed = new Set();
    if (applySuppressions) {
      try {
        const bd = await getContactsBreakdown({ includeEmails: true });
        for (const kind of Object.keys(bd.suppressions || {})) {
          for (const r of bd.suppressions[kind].emails || []) suppressed.add(r.email);
        }
      } catch (e) {
        logger.error(`getReportRecipients (ramp): SendGrid suppression lookup failed (${e.message})`);
      }
    }
    const eligible = suppressed.size
      ? users.filter((u) => !suppressed.has(u.email))
      : users;

    const { users: chosen, ramp } = applyRampAndPriority(eligible);

    logger.info(`[recipients] ramp ON · day=${ramp?.day} cap=${ramp?.cap_per_day} limit=${ramp?.limit} eligible=${ramp?.eligible} selected=${ramp?.selected} priority=${(ramp?.priority || []).join("|") || "(none)"}`);

    return {
      recipients: chosen.map((u) => u.email),
      totalSubscribed: users.length,
      suppressedExcluded: users.length - eligible.length,
      amemberTotal: total,
      ramp,
    };
  }

  // ── Original path (ramp disabled) — UNCHANGED ────────────────────────
  // 1. Subscribed users from aMember.
  const { emails, total } = await getSubscribedUserEmails();

  // 2. Best-effort: drop SendGrid-suppressed addresses.
  const suppressed = new Set();
  if (applySuppressions) {
    try {
      const bd = await getContactsBreakdown({ includeEmails: true });
      for (const kind of Object.keys(bd.suppressions || {})) {
        for (const r of bd.suppressions[kind].emails || []) suppressed.add(r.email);
      }
    } catch (e) {
      logger.error(`getReportRecipients: SendGrid suppression lookup failed (${e.message}) — sending to full aMember list`);
    }
  }

  const recipients = suppressed.size ? emails.filter((e) => !suppressed.has(e)) : emails;

  return {
    recipients,
    totalSubscribed: emails.length,
    suppressedExcluded: emails.length - recipients.length,
    amemberTotal: total,
  };
}

/**
 * Resolve the day's recipients: config `dailyreport` override if set, else the
 * normal aMember + SendGrid list. This is what the cron and the /recipients
 * view both use, so they always agree on who gets mailed.
 */
export async function resolveDailyRecipients() {
  const override = getDailyReportOverride();
  if (override) {
    logger.info(`[recipients] using config 'dailyreport' override: ${override.length} email(s)`);
    return { recipients: override, source: "override", totalSubscribed: override.length, suppressedExcluded: 0 };
  }
  const r = await getReportRecipients();
  return { ...r, source: "amember" };
}
