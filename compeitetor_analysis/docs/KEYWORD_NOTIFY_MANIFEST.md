# Keyword / Advertiser Notification Mail — Manifest

**Status:** additive, config-gated (OFF by default). Nothing in the existing
competitor / data-report / member-CC flows is touched.

Mails each user the **tracked search terms & advertisers that picked up new
ads**, on a schedule the operator controls from config. One digest per user,
newest activity first, top-N terms, each row deep-linking into the dashboard.

---

## 1. What it does (per run)

1. Read pending rows from Mongo `keyword_ad_notifications` (crawler writes these
   when a term the user tracks crosses its ad threshold).
2. Group by recipient `email`, **newest activity first** (`max(updatedAt)`).
3. Keep only terms with **more than `keyword_notify_min_ads` new ads**
   (default **10**), then take the **top-N** — `updatedAt` desc, then `adsCount`
   desc (`keyword_notify_top_n`, default **20**).
4. Render one digest (same look as the data-report mail) and send it —
   per-message click/open tracking on, bounce-blacklist guarded, audit-logged.
5. **Delete the mailed rows.** Delete = dedup:
   - schedule `24h`/`10am` → each term is mailed **once** (one digest/day),
   - schedule `15m` → a digest every 15 min carrying only the **new** terms
     that showed up since the last run.

No Elasticsearch query is made — the collection already carries `adsCount` +
`updatedAt`, so the count in the mail is exactly what the crawler recorded.

### Email design (`mail-template/keywordNotification.html`)

Deliberately light — a short friendly note, not a heavy dashboard:

> Hi {firstName}, — Just checking in with your daily update! We scanned
> {scannedNetworks} for you today and found {newAdsCount} new ads across
> {keywordCount} of your tracked keywords from {advertiserCount} advertisers…

- `scannedNetworks` is built from the networks actually present in the rows
  (e.g. "Facebook and Instagram"). Counts are computed from the included rows.
- Then a **primary CTA** ("Check out today's ads →") and the term list.
- **Each term row shows the network as an icon AND its name** ("Keyword · Facebook"),
  so it's always clear which network a term belongs to even if the mail client
  blocks images — plus a per-row **"View →"** button linking straight to that
  term on the dashboard.

> ⚠️ **Icon note:** icons load from `assets_base_url`. In `localDev` that's
> `http://localhost:6002/public` (and `assets_mode: "url"`), which a real inbox
> can't reach — so during local testing the icon image may be blank, but the
> **network name text is always shown** so nothing is ambiguous. In prod, point
> `assets_base_url` at a public host (or set `assets_mode: "inline"`).

---

## 2. Source collection — `keyword_ad_notifications`

Read-only for us (crawler owns writes). Fields used:

| field       | use                                                        |
|-------------|------------------------------------------------------------|
| `email`     | recipient (grouping key)                                   |
| `username`  | greeting name                                              |
| `type`      | **1 = keyword, 2 = advertiser**                            |
| `network`   | shown for advertisers; used in the advertiser deep-link    |
| `value`     | the keyword / advertiser text (shown + linked)             |
| `adsCount`  | "new ads" number + secondary sort key                      |
| `updatedAt` | "updated" date + primary sort key                          |
| `_id`       | deleted after the row is mailed                            |

---

## 3. Deep links (email → dashboard)

Built against config `app_url`.

| type          | link                                             | FE handling                          |
|---------------|--------------------------------------------------|--------------------------------------|
| keyword (1)   | `{app_url}?keyword=<value>`                      | **NEW** handler in `new-ui-react/src/App.jsx` |
| advertiser (2)| `{app_url}?advertiser=<value>&platform=<network>`| existing advertiser deep-link        |

`new-ui-react/src/App.jsx` — added a `?keyword=` branch to the deep-link
`useEffect` (mirrors the existing `?advertiser=` one): runs a keyword search,
optional `&platform=` pre-selects a network.

---

## 4. Scheduling (config-driven)

Config key **`keyword_notify_schedule`** (in `config/localDev.json`). Accepts:

| you write        | meaning                    | cron used        |
|------------------|----------------------------|------------------|
| `"10am"`, `"10 pm"` | daily at that hour      | `0 10 * * *`     |
| `"10:00"`, `"9:30"` | daily at HH:MM          | `0 10 * * *`     |
| `"15m"`, `"30 min"` | every N minutes (N<60)  | `*/15 * * * *`   |
| `"6h"`, `"2 hours"` | every N hours (N<24)    | `0 */6 * * *`    |
| `"24h"` (or ≥24h)   | once daily (midnight)   | `0 0 * * *`      |
| `"0 10 * * *"`      | raw 5-field cron        | used verbatim    |
| `""` (empty)        | **feature off**         | —                |

All times are **IST** (`Asia/Kolkata`).

**Gating** — its OWN switch, independent of the data-report `cron` flag. The
cron registers only when BOTH are true:
- `keyword_notify_cron` is `true`, and
- `keyword_notify_schedule` is set and parseable.

Parser: `toCronExpr()` in `keywordNotifyCron.js`. An overlap guard prevents a
new run starting while one is still in flight.

---

## 5. Config keys (`config/localDev.json`)

```jsonc
"keyword_notify_cron": true,       // dedicated switch — NOT tied to `cron`
"keyword_notify_schedule": "10am", // "" = off; see table above
"keyword_notify_top_n": 20,        // rows per user per digest
"keyword_notify_min_ads": 10       // only terms with MORE THAN this many new ads
```

> The data-report `cron` flag is intentionally NOT used here — this feature has
> its own `keyword_notify_cron` switch so the two can be toggled independently.

`TEST_EMAIL_ONLY` (if set) is honoured — only that address is processed, same as
the competitor mailer. Handy on staging so real users aren't mailed.

---

## 6. Admin panel (analytics)

Logged under **`mail_type: "keywordNotification"`** via the shared
`email_send_log` / `email_send_events` pipeline — so delivered / opened /
bounced / **clicks** all show up exactly like the other mails.

- `admin_panel_backend/src/email-analytics.js` — added `keywordNotification` to
  `TYPES`; `byType` is now derived from `TYPES` (auto-includes the new type in
  summary tiles, rates, clicks, unsubscribes).
- `react_admin/.../Pas/EmailDetails.jsx` — new **"Keyword Alerts"** mail-type
  tab; row/detail/export type labels; snapshot shows "N tracked terms with new
  ads"; per-row single-recipient **resend is disabled** for this type (the
  source rows are deleted once mailed — there's nothing to resend).
- **Send custom mail** composer — third option **"Keyword Alert"**. Sends the
  digest to a typed email that already has rows in `keyword_ad_notifications`
  (else 404). This is a **testing path**: the rows are **NOT deleted**, so the
  same terms can be re-sent. Routes to `/api/email-analytics/send-keyword-notify`
  → `manualSendController.sendKeywordNotify` → `sendKeywordNotifyForEmail`
  (email matched case-insensitively, bounce-blacklist guarded).

---

## 7. Files

**compeitetor_analysis (sender):**
- `core/mailer/keywordNotifyService.js` — fetch/group/rank, render, send, delete. Exports `runKeywordNotify`, `previewForUser`.
- `core/mailer/keywordNotifyCron.js` — schedule parser + cron wiring. Exports `initKeywordNotifyCron`, `toCronExpr`, `runKeywordNotifyOnce`.
- `core/mailer/keywordNotifyController.js` — manual run / preview / schedule endpoints.
- `core/mailer/manualSendController.js` — added `sendKeywordNotify` (admin composer send, no delete).
- `mail-template/keywordNotification.html` — the email (data-report look).
- `resources/routes/routes.js` — 3 routes (below).
- `server.js` — calls `initKeywordNotifyCron()` after `initDataReportCron()`.
- `config/localDev.json` — `keyword_notify_schedule`, `keyword_notify_top_n`.

**admin_panel_backend (reader):** `src/email-analytics.js`.
**react_admin (UI):** `src/components/Pas/EmailDetails.jsx`.
**new-ui-react (UI):** `src/App.jsx` (`?keyword=` deep link).

Reused (unchanged): `emailAudit.logSend/newSendId`, `bounceGuard.isBlacklisted`,
`unsubscribeToken`, SendGrid client.

---

## 8. Endpoints (manual / testing)

| method | path                          | body / query        | does                                             |
|--------|-------------------------------|---------------------|--------------------------------------------------|
| POST   | `/api/keyword-notify/run`     | `{ limitUsers? }`   | runs one pass now — **sends + deletes** (honours `TEST_EMAIL_ONLY`) |
| GET    | `/api/keyword-notify/preview` | `?email=<addr>`     | that user's next digest — **no send, no delete** (returns rows + rendered html) |
| GET    | `/api/keyword-notify/schedule`| —                   | resolved cron + whether it's active              |
| POST   | `/api/email-analytics/send-keyword-notify` | `{ email }` | admin/testing send to one email — **404 if no rows in DB**, and **rows are NOT deleted** |

Verified end-to-end against the localDev DB via `preview`: grouping, top-20
ranking, keyword vs advertiser deep-links (`?keyword=…` / `?advertiser=…&platform=…`),
and full template render (no unresolved `{{ }}`).
