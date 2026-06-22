'use strict';

/**
 * Convert a human-friendly schedule string into a node-cron expression.
 * (Same conventions used by the notification crons.)
 *
 * Accepts:
 *   - intervals:  "1 min", "5 min", "30 min", "1 hour", "2 hour", "5m", "1h"
 *   - daily time: "daily 12:05 AM", "daily 2:30 PM", "00:05", "2:30 pm"
 *   - raw cron:   "* /5 * * * *" (5 fields, passed through unchanged)
 * Returns `fallbackCron` if it can't understand the input.
 */
function parseSchedule(input, fallbackCron) {
  if (!input || typeof input !== 'string') return fallbackCron;
  const s = input.trim().toLowerCase();

  // Raw cron (5 space-separated fields) — pass through
  if (input.trim().split(/\s+/).length === 5) return input.trim();

  // "N min" / "N minute(s)" / "Nm"
  let m = s.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/);
  if (m) { const n = Math.max(1, +m[1]); return n === 1 ? '* * * * *' : `*/${n} * * * *`; }

  // "N hour(s)" / "Nh"
  m = s.match(/(\d+)\s*(h|hr|hrs|hour|hours)\b/);
  if (m) { const n = Math.max(1, +m[1]); return n === 1 ? '0 * * * *' : `0 */${n} * * *`; }

  // daily time "HH:MM" with optional am/pm
  m = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (m) {
    let hh = +m[1]; const mm = +m[2]; const ap = m[3];
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${mm} ${hh} * * *`;
  }

  return fallbackCron;
}

module.exports = { parseSchedule };
