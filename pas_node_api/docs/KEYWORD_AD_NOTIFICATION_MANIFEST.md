# Keyword Ad-Notification – Implementation Manifest

> Companion to `KEYWORD_SEARCH_REVAMP_MANIFEST.md` and `INTELLIGENCE_MANIFEST.md`.
> This file documents the **keyword-search → ad-count notification** feature as built in `pas_node_api`.
> It is **additive**: read-only against existing pipelines; writes its own Mongo collection plus a
> per-day `notifyDismissed[]` marker on the source doc (§9.B), and is fully gated behind its own config toggle.
>
> **Status: WRITE-SIDE + FRONTEND BELL IMPLEMENTED.** The cron records matches in Mongo; the bell
> has its 2 APIs (poll + mark-read) and a **click-through** that searches the term on its network (§9).
> Mark-read **deletes** the row + records a per-day dismissal so it never resurrects (§9.B).
> **Push/email delivery + retention are still NOT built** — see §7 Open Items.
> The feature toggle is **`keywordSearch.notify.enabled`**.

---

## 0. Golden Rules (as Implemented)

1. **Additive & isolated.** Reads `keyword_searches` + Elasticsearch; writes its own
   notification collection (and, on mark-read only, a `notifyDismissed[]` marker on the source
   `keyword_searches` doc — §9.B). Disabling it (`notify.enabled:false` or `keywordSearch.enabled:false`)
   makes the scan a no-op.
2. **In-process cron, no HTTP self-call.** The cron calls the controller function directly,
   mirroring the push/email crons.
3. **Worker-1 only.** Initialized only on worker 1 (`WORKER_ID` unset or `'1'`) to avoid duplicate
   jobs in cluster mode.
4. **Never throws.** Every term / network is isolated so one ES/Mongo hiccup cannot abort the run.
5. **Dedup per user+term+network+day.** A unique Mongo index guarantees one notification per
   `(userId, email, valueNorm, type, network, date)`.
6. **Self-contained field map.** ES queries use `PLATFORM_FIELD_MAPPINGS` from
   `src/services/common/helpers/platformSearchFields.js` — the feature owns its own copy of the
   per-network search fields, so it has no dependency on the admin search-intelligence controller.

---

## 1. Flow

```
keyword_searches (Mongo)
   │  terms scraped TODAY  (status: completed | no_ads_found)
   ▼
keywordAdNotificationCron  (every 15 min, worker-1)   → parseSchedule() from pushNotificationCron
   ▼
runKeywordAdNotificationScan()  [keywordAdNotificationController]
   │  for each term × each network scraped today:
   │     buildQuery(net, type, value, dateScoped, today)   ← PLATFORM_FIELD_MAPPINGS + TIMESTAMP_FIELD
   │     dbManager.getElastic(net).count({ index, body:{ query } })
   │     if adsCount >= threshold (default 20):  upsert one notification per user
   ▼
keyword_ad_notifications (Mongo)   { notified: false }
   ▼
[ MISSING ] delivery: push/email cron + frontend read API   ← see §7
```

---

## 2. Files

| File | Role | State |
|------|------|-------|
| `src/jobs/keywordAdNotificationCron.js` | Cron scheduler; calls the scan in-process | NEW |
| `src/services/common/controllers/keywordAdNotificationController.js` | Cron `runKeywordAdNotificationScan()` + frontend `runUserKeywordAdScan()` / `getUserKeywordAdNotifications()` / `markKeywordAdNotificationRead()` | NEW / MODIFIED |
| `src/services/common/routes/commonRoutes.js` | Wires `GET/POST /keyword-ad-notifications[/read]` (auth) | MODIFIED |
| `src/jobs/pushNotificationCron.js` | Exports `parseSchedule` (reused by the cron) | MODIFIED |
| `src/services/common/helpers/platformSearchFields.js` | Exports `PLATFORM_FIELD_MAPPINGS` (per-network search fields) | NEW |
| `src/config/index.js` | `keywordSearch.notify.*` defaults | MODIFIED |
| `src/app.js` | Wires `initKeywordAdNotificationCron()` (worker-1 guard) | MODIFIED |
| `tests/keywordAdNotification.manual.js` | Manual test harness | NEW |

---

## 3. Config (`keywordSearch.notify`)

Defaults resolved in `src/config/index.js` (file `config.json` > env > default):

| Key | Env | Default | Meaning |
|-----|-----|---------|---------|
| `enabled` | `KEYWORD_SEARCH_NOTIFY_ENABLED` | `true` | Master toggle for the scan |
| `schedule` | `KEYWORD_SEARCH_NOTIFY_SCHEDULE` | `'15 min'` | Cron cadence (parsed by `parseSchedule`) |
| `adsCountThreshold` | `KEYWORD_SEARCH_NOTIFY_THRESHOLD` | `20` | Min matching ES ads before a notification is recorded |
| `collection` | `KEYWORD_SEARCH_NOTIFY_COLLECTION` | `'keyword_ad_notifications'` | Output Mongo collection |
| `dateScoped` | `KEYWORD_SEARCH_NOTIFY_DATE_SCOPED` | `true` | `true` = count only today's ads (range on per-network last_seen) |
| `scanBatch` | `KEYWORD_SEARCH_NOTIFY_SCAN_BATCH` | `500` | Max `keyword_searches` docs scanned per run |
| `userScanLimit` | `KEYWORD_SEARCH_NOTIFY_USER_SCAN_LIMIT` | `100` | Max of the caller's own terms scanned per frontend poll (§9) |
| `pollIntervalSec` | `KEYWORD_SEARCH_NOTIFY_POLL_SEC` | `60` | Frontend poll cadence; echoed to the UI as `meta.pollIntervalMs` (§9) |

Source connection comes from the shared `keywordSearch` block: `mongoSlug` (default `'facebook'`),
`database` (default `''` → connection default db), `collection` (default `'keyword_searches'`).

---

## 4. Data Stores

- **Read:** `keyword_searches` (Mongo, on `keywordSearch.mongoSlug`) — terms + `scrapping_status[]` + `users`/`userInfos`.
- **Read:** Elasticsearch per network via `dbManager.getElastic(net)` — `count()` only.
- **Write:** `keyword_ad_notifications` (Mongo) — one doc per `(userId, email, valueNorm, type, network, date)`.
- **Write:** `keyword_searches.notifyDismissed[]` (Mongo, source doc) — per-user, per-network, per-day
  dismissal markers set by mark-read (§9.B) so a dismissed notification is not re-created the same day.
  Date-scoped — only today's entries are kept (stale ones pruned on write).

### Notification document
```jsonc
{
  "userId": 123, "email": "u@x.com", "username": "u",
  "valueNorm": "nike shoes", "value": "Nike Shoes", "type": 1, "network": "facebook",
  "date": "2026-06-19", "adsCount": 57, "threshold": 20,
  "notified": false, "createdAt": "…", "updatedAt": "…"
}
```

### Indexes (bootstrapped once, `ensureNotifyIndexes`)
- `uniq_user_term_net_day` — UNIQUE `{ userId, email, valueNorm, type, network, date }`
- `recency` — `{ date: -1 }`
- `pending` — `{ notified: 1, date: -1 }`  *(intended for the future delivery consumer)*

---

## 5. Key Mappings

- **`TYPE_FIELD_KEY`**: `1 → keyword`, `2 → advertiser`, `3 → domain`.
- **`TIMESTAMP_FIELD`**: per-network ES `last_seen` field used for the `dateScoped` range filter.
- **`PLATFORM_FIELD_MAPPINGS`** (from `common/helpers/platformSearchFields.js`): per-network search
  fields. `keyword`/`advertiser` → `multi_match` phrase; `domain` → `wildcard` on the domain field.

---

## 6. Operational Notes

- **Cluster-safe:** cron initialized only on worker 1.
- **Timezone:** `today` computed via `config.notifications.timezone` (default `Asia/Kolkata`).
- **Resilient:** per-term / per-network / per-user errors are caught and logged; the scan returns
  `{ scanned, matched, notified }` and never throws.
- **`notified` count** increments only on new inserts (`upsertedCount`), not on updates.

---

## 7. Open Items (NOT yet implemented)

1. **Push/email delivery consumer.** The bell read API (§9) deletes docs on the user's side
   (recording a per-day dismissal), but there is still **no** cron that pushes/emails
   `{ notified: false }` docs out of band. Because mark-read deletes (not flips), `notified`
   never becomes `true` today — it stays `false` for the life of every bell doc, reserved for
   that future consumer. The `pending` index is in place for exactly this.
2. **Retention / cleanup.** No TTL or purge of old notification docs.

---

## 8. Manual Test

```
node tests/keywordAdNotification.manual.js
```
Exercises `runKeywordAdNotificationScan()` against the configured Mongo + ES.

---

## 9. Frontend APIs (the bell) — IMPLEMENTED

Two auth'd routes (JWT — `Authorization: Bearer` or `authToken` cookie), under
`/api/v1/common`, handlers in `keywordAdNotificationController.js`, wired in `commonRoutes.js`.

### 9.A Primary (poll) — `GET /api/v1/common/keyword-ad-notifications`
The frontend polls this every `notify.pollIntervalSec` (env `KEYWORD_SEARCH_NOTIFY_POLL_SEC`,
default 60s). Each call:
1. Runs `runUserKeywordAdScan()` — scoped to the **caller's own** terms (matched by
   `userInfos.id` / `users` email) that were scraped **today**, ordered by `lastSearchedAt`,
   capped at `notify.userScanLimit`. For each term × network-scraped-today it counts ES ads
   and **upserts one notification for this user** when `adsCount >= adsCountThreshold`
   (same dedup key as the cron, so cron and poll never double-write).
2. Returns the caller's pending docs (`notified:false`, newest first, ≤50).

```jsonc
// 200
{ "code": 200, "message": "ok",
  "data": [ { "_id": "…", "valueNorm": "nike shoes", "value": "Nike Shoes", "type": 1,
              "network": "facebook", "date": "2026-06-19", "adsCount": 57, "notified": false } ],
  "meta": { "unreadCount": 1, "pollIntervalMs": 60000, "scan": { "scanned": 4, "matched": 1, "notified": 1 } } }
```
`meta.pollIntervalMs` is the env-controlled cadence — the UI reads it to self-pace its polling.
The scan is best-effort: if it throws, the endpoint still returns whatever is already pending.

### 9.B Mark read — `POST /api/v1/common/keyword-ad-notifications/read`
Body `{ "id": "<docId>" }` or `{ "ids": ["…","…"] }`. For the caller's own matching docs
(ownership enforced by `userId`/`email`), it **(1)** records a per-user, per-network, per-day
**dismissal** on each source `keyword_searches` doc (`notifyDismissed[]`), then **(2) deletes**
the notification doc(s) from `keyword_ad_notifications`. No ids → `400`.

```jsonc
// 200
{ "code": 200, "message": "notification(s) removed", "data": { "deleted": 1 } }
```

> **Why delete + a dismissal flag** (not bare-delete, not soft-flip): the poll API (9.A) re-runs
> the per-user scan on every call, so a *bare-deleted* doc for a term still over-threshold + scraped
> today would be **re-inserted within one poll** (resurrection). The `notifyDismissed[]` marker makes
> `isDismissedToday()` skip re-creating it, so the row stays **gone** from `keyword_ad_notifications`
> (collection stays clean) yet never comes back the same day. It is **date-scoped** — only today's
> entries are kept (stale ones pruned on write) — so a new day notifies fresh.
> A soft-flip (`notified:true`) was the earlier design but was rejected to keep read rows from
> lingering in the collection; consequently `notified` is never flipped today (see §7.1).

### 9.C Frontend wiring (`new-ui-react`)
- `src/services/api.js` — `fetchNotifications()` → GET 9.A (maps `_id→id`, `value→keyword`,
  type `1/2/3 → 0/1/2` for the bell's `TYPE_MAP`, passes `network` through); `markNotificationsRead(ids)`
  → POST 9.B in one call (checks `res.ok` only — body shape ignored).
- `src/hooks/useNotifications.js` — adopts `meta.pollIntervalMs` as its poll cadence
  (env-controlled, default 60s until the server reports).
- `NotificationPopup.jsx` / `Header.jsx` — **click-through added.** Clicking a notification row
  calls `onNotificationClick(notif)` → `Header.handleNotificationClick`, which maps the bell type
  (0/1/2 → keyword/advertiser/domain) and calls `onSearch(value, searchType, network)` (App's
  `handleSearch`, whose 3rd arg selects the platform). So a click **searches that term on that
  network**. A row click does **not** mark read — only the explicit "Mark all read" button
  (→ `markAllRead()` → POST 9.B) does.

> Collection is the shared `notify.collection` (`keyword_ad_notifications`) — the poll API
> reads/writes the exact docs the cron writes; there is no second collection. Dismissals live on
> the source `keyword_searches` doc (`notifyDismissed[]`), not a separate collection.
