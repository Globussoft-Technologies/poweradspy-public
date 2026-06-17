# Get-Count API

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
| `stage` | only `metric=processed` | `destination`, `screenshot`, or `builtwith` |

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

### `active` — total ads active in the window
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

### `processed` — pipeline-stage counts (needs `stage`)
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
| Yesterday Total Ads | `metric: "active"` |
| New Ads per Platform | `metric: "platform"` (no filter → buckets) |
| New Ads based on Type | `metric: "new"`, `groupBy: "type"` |
| New Ads based on Position | `metric: "new"`, `groupBy: "ad_position"` |
| New Ads based on Source | `metric: "new"`, `groupBy: "source"` |
| Destination URLs Processed | `metric: "processed"`, `stage: "destination"` |
| Google ScreenShot Processed | `metric: "processed"`, `stage: "screenshot"` |
| Builtwith Processed | `metric: "processed"`, `stage: "builtwith"` |

---

## Errors

`400` with a `{ "message": "..." }` explaining the problem:

- `Please provide a valid network` — missing/unknown `network`
- `Invalid metric. Allowed: ...`
- `metric "<x>" requires range { from, to }`
- `Invalid groupBy. Allowed: type, ad_position, source`
- `platform must be an integer or array of integers`
- `metric "processed" requires stage. Allowed: destination, screenshot, builtwith`

`500` with `{ "error": "Internal Server Error" }` — database/server failure.

---

## Notes

- The window upper bound is explicit, so the count is correct **at any time of
  day** (the DS cron leaves it implicit because it runs at midnight).
- `tiktok` is **not** supported here — it lives on a separate stack.
- Lifetime "Total Ads" stays on Elasticsearch (`get-ads-count`) for speed.

### curl
```bash
curl -X POST http://localhost:6001/admin-panel/network-name/get-count \
  -H "Content-Type: application/json" \
  -d '{"network":"youtube","metric":"range","range":{"from":"2026-06-15","to":"2026-06-15"}}'
```
