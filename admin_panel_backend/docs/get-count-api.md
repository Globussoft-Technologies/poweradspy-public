# Get-Count API

**Last checked against implementation:** 17 November 2026

One SQL endpoint for ad counts. Powers the admin-panel crawler-insight cards and
gives the DS team the same numbers as their daily report — so both stay in sync.

```
POST  /admin-panel/network-name/get-count
Content-Type: application/json
```

> `network-name` is a literal part of the URL. The actual network goes in the body.

Every count is a **12 a.m. → 12 a.m.** window: `from` 00:00:00 up to (but not
including) the day **after** `to` at 00:00:00. So `from = to = 2026-06-15` means
the whole of June 15.

---

## Request fields

| Field | Required | Value |
|---|---|---|
| `network` | yes | `facebook`, `instagram`, `google`, `gdn`, `native`, `pinterest`, `quora`, `reddit`, `youtube`, `bing`, `linkedin` |
| `metric` | no (default `range`) | `range`, `new`, `active`, `platform`, `processed` |
| `range` | yes (all metrics) | `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }` |
| `platform` | only `metric=platform` | plugin code or array, e.g. `12` or `[3,10,12,15]`. Omit → every platform |
| `groupBy` | only `metric=new` | `type`, `ad_position`, or `source` |
| `stage` | only `metric=processed` | `destination`, `screenshot`, `builtwith`, `ocr`, or `ocb` |

Plugin codes: **3** = User Plugin, **10** = Scroll Plugin, **12** = Python Crawler, **15** = Meta Ad Library.

---

## Metrics, requests & responses

All responses are wrapped as `{ "code": 200, "message": "success", "data": <below> }`.

### `range` — Unique + Total in one call
```json
{ "network": "youtube", "metric": "range", "range": { "from": "2026-06-15", "to": "2026-06-15" } }
```
```json
{ "newCount": 5401, "activeCount": 9742 }
```

### `new` — new (unique) ads
```json
{ "network": "youtube", "metric": "new", "range": { "from": "2026-06-15", "to": "2026-06-15" } }
```
```json
{ "total": 5401 }
```

#### `new` + `groupBy` — breakdown
```json
{ "network": "youtube", "metric": "new", "range": { "from": "2026-06-15", "to": "2026-06-15" }, "groupBy": "type" }
```
```json
{ "total": 5401, "groupBy": "type", "buckets": [ { "key": "VIDEO", "count": 922 }, { "key": "IMAGE", "count": 4479 } ] }
```

**Implementation mapping:** `metric=new` without `groupBy` uses each network's configured `firstSeen` column: `first_seen` except YouTube and Pinterest, which use `created_date`. A `new` request with `groupBy` always groups on `first_seen` for every network. Therefore grouped bucket totals may differ from the ungrouped `new` total for YouTube and Pinterest.

### `active` — total ads in the window
"Active ads" for a day = ads whose last sighting fell in that day (`last_seen ∈ [day, day+1)`).
Because `last_seen` keeps moving as ads are re-crawled, a *live* query for a past
date isn't reproducible — so:
- **Past days** are read from a **frozen daily snapshot** (written nightly by the
  pas_node_api cron `activeCountSnapshot`), so the number is stable forever.
- **Today** is computed **live** (the day isn't over yet).
- **A multi-day range** = the **sum of the daily snapshots** in range (+ live today
  if today is included). Note this is a per-day total — an ad active on N days
  counts N times.
- Fallback is span-level: if the snapshot query errors or returns **no rows** (including when the table is missing), the API runs one live count for that entire past span.
  If at least one snapshot row is returned, it sums the rows present and does **not** live-fill missing dates. Check snapshot completeness before interpreting a partial historical range.
```json
{ "network": "youtube", "metric": "active", "range": { "from": "2026-06-15", "to": "2026-06-15" } }
```
```json
{ "total": 9742 }
```

### `platform` — per-plugin counts
With a `platform` filter → single total:
```json
{ "network": "youtube", "metric": "platform", "range": { "from": "2026-06-15", "to": "2026-06-15" }, "platform": 12 }
```
```json
{ "total": 5401 }
```
Without `platform` → all plugins as buckets:
```json
{ "network": "youtube", "metric": "platform", "range": { "from": "2026-06-15", "to": "2026-06-15" } }
```
```json
{ "total": 5401, "buckets": [ { "platform": 12, "count": 5401 } ] }
```

**Implementation mapping:** Facebook stores `platform` on `facebook_ad`; other networks use their metadata table. LinkedIn uses `created_at` instead of `created_date`. Bing and LinkedIn count their ad foreign-key columns; the other networks count `id`. These mappings live in `DB_DATA` in `src/dynamic-count-analytics.js`.

### `processed` — pipeline-stage counts (needs `stage`)
`destination`/`screenshot`/`builtwith` normally read `<net>_ad_meta_data`; `ocr`/`ocb` normally read `<net>_ad_variants`. LinkedIn uses dedicated tables: `linkedin_ad_lander`, `linkedin_ad_meta_data`, `linkedin_ad_built_with`, and `linkedin_ad_ocr_ocb_details`.
```json
{ "network": "youtube", "metric": "processed", "range": { "from": "2026-06-15", "to": "2026-06-15" }, "stage": "builtwith" }
```
```json
{ "total": 0 }
```

---

## Maps to the DS daily report

| DS report line | Call |
|---|---|
| Total Ads (lifetime) | **Not this API** — use `POST /admin-panel/network-name/get-ads-count` (Elasticsearch) |
| Yesterday Ads | `metric: "new"` |
| Yesterday Total Ads | `metric: "active"` — see note below |
| New Ads per Platform | `metric: "platform"` (no filter → buckets) |
| New Ads based on Type | `metric: "new"`, `groupBy: "type"` |
| New Ads based on Position | `metric: "new"`, `groupBy: "ad_position"` |
| New Ads based on Source | `metric: "new"`, `groupBy: "source"` |
| Destination URLs Processed | `metric: "processed"`, `stage: "destination"` |
| Google ScreenShot Processed | `metric: "processed"`, `stage: "screenshot"` |
| Builtwith Processed | `metric: "processed"`, `stage: "builtwith"` |
| OCR Processed | `metric: "processed"`, `stage: "ocr"` |
| OCB Processed | `metric: "processed"`, `stage: "ocb"` |

---

## Errors

`400` with a `{ "message": "..." }` explaining the problem:

- `Please provide a valid network` — missing/unknown `network`
- `Invalid metric. Allowed: ...`
- `metric "<x>" requires range { from, to }`
- `Invalid groupBy. Allowed: type, ad_position, source`
- `platform must be an integer or array of integers`
- `metric "processed" requires stage. Allowed: destination, screenshot, builtwith, ocr, ocb`

`500` with `{ "error": "Internal Server Error" }` — database/server failure.

---

## Audit log

Every hit is logged (best-effort, never blocks the response) to one file per day:

```
admin_panel_backend/logs/get-count/YYYY-MM-DD.jsonl
```

One JSON line per request, capturing who hit it, with what, and what came back:

```json
{ "ts": "2026-06-18T11:03:41.410Z", "ip": "203.0.113.9", "source": "ds-daily-report",
  "userAgent": "python-requests/2.31", "origin": null, "referer": null,
  "status": 200, "durationMs": 87,
  "request":  { "network": "youtube", "metric": "new", "range": { "from": "2026-06-15", "to": "2026-06-15" } },
  "response": { "code": 200, "message": "success", "data": { "total": 0 } } }
```

- **Retention:** the default is the **most recent 7 days** of files; older day-files are deleted automatically. `GET_COUNT_LOG_RETENTION_DAYS` can override the default.
- **Identify yourself:** send a `x-source: <name>` header (e.g. `x-source: ds-daily-report`)
  so your calls are easy to find in the log. Without it, callers are still
  distinguishable by `ip` / `userAgent` / `origin`.
- **Use it for reconciliation:** if the admin panel and the DS report disagree,
  grep the day's file for the exact payload + response each side received.

## Notes

- The window upper bound is explicit, so the count is correct **at any time of
  day** (the DS cron leaves it implicit because it runs at midnight).
- **`active` past values are frozen snapshots, not live.** A nightly cron in
  pas_node_api (`config.json` → `crons.activeCountSnapshot`, default 12:05 AM)
  stores each network's previous-day active count in a per-network
  `active_count_snapshots` table (kept `retentionDays`, default 365). This API
  reads those for past dates so the number stays consistent; only **today** is live.
- **Timezone must match.** The admin read side uses `SNAPSHOT_TZ` (default
  `Asia/Kolkata`) to decide "today"; it must equal the cron's `crons.timezone`,
  or the past/today boundary disagrees by a day.
- `tiktok` is **not** supported here — it lives on a separate stack.
- Lifetime "Total Ads" stays on Elasticsearch (`get-ads-count`) for speed.

### curl
```bash
curl -X POST http://localhost:6001/admin-panel/network-name/get-count \
  -H "Content-Type: application/json" \
  -d '{"network":"youtube","metric":"range","range":{"from":"2026-06-15","to":"2026-06-15"}}'
```
