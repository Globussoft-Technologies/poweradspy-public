# Total Ad Count API

A single internal endpoint to fetch the total ad count for any network from
Elasticsearch. Same endpoint powers the admin-panel dashboard header **and**
the DS daily reports — guaranteeing the two numbers stay in sync, and
matching the **"Total Ads"** number shown in the new-ui-react frontend.

---

## Why this exists

The previous DS-team approach was `SELECT COUNT(id) FROM <network>_ad` against
MySQL. That works but is slow on multi-million-row tables and, more
importantly, it counted **every row in the table** — including ads the
end-user-facing frontend hides because the media isn't displayable.

This endpoint runs a single Elasticsearch `count` against the per-network ad
index, with **the same media-displayable filter the frontend applies**.
Result:

- ms-level response at any scale.
- Same number across the admin panel header, the DS report, and the new-ui
  "Total Ads" label.

---

## Filtering (important — read this)

The new-ui-react frontend always applies a per-network **displayable-media**
filter when rendering ads:

- **IMAGE** ads must have a stored NAS image URL.
- **VIDEO** ads must have a usable thumbnail.
- Legacy placeholder thumbnails (`*pasvideo*`, `*pasimage*`, `*bydefault*`)
  are excluded.
- Non-IMAGE / non-VIDEO ad types pass through.
- Exact rules vary slightly per network — source of truth is
  `pas_node_api/src/services/common/helpers/displayableMediaFilters.js`.

This endpoint applies the **same filter by default**, so the count returned
matches what the user sees in the frontend.

The raw lifetime row-count from `SELECT COUNT(id) FROM <network>_ad` will be
**higher** because it includes the rows the frontend hides. If you ever
need the unfiltered count for a specific reason, ping the backend team.

Networks with no displayable-media filter (Google text ads, Bing, TikTok)
return the raw `match_all` count — there is no media to filter on for those.

---

## Endpoint

```
POST   /api/v1/common/total-ad-count
```

**Base URL** — confirm with your environment.

| Environment | Base URL |
|---|---|
| Local dev   | `http://localhost:<port>` |
| Staging     | `https://<staging-host>` |
| Production  | `https://<prod-host>` |

Full URL: `<base>/api/v1/common/total-ad-count`

**Auth:** none (internal endpoint, network-only).
**Content-Type:** `application/json`.

---

## Request

```json
{
  "network": "linkedin",
  "range": {
    "from": "2026-05-01",
    "to":   "2026-05-26"
  }
}
```

### Fields

| Field   | Type   | Required | Description |
|---|---|---|---|
| `network` | string | yes | One of: `facebook`, `instagram`, `google`, `gdn`, `native`, `pinterest`, `quora`, `reddit`, `youtube`, `linkedin`, `tiktok`. Case-insensitive. |
| `range`   | object | no  | Optional date filter. Omit for **lifetime** total (replaces `SELECT COUNT(id) FROM <network>_ad`). |
| `range.from` | string | only if `range` given | Inclusive start date, `YYYY-MM-DD`. |
| `range.to`   | string | only if `range` given | Inclusive end date, `YYYY-MM-DD`. |

### What `range` filters

The range is applied to the ad's `last_seen` field — i.e. "ads still seen at
some point in this window." This matches DS Q3 semantics (active ads in the
window), **not** Q2 (new ads in the window).

If you need first-seen semantics, ask backend — we'll add a typed parameter.

---

## Response

### Success — HTTP 200

```json
{
  "code": 200,
  "message": "Success",
  "data": {
    "network": "linkedin",
    "totalAds": 68508,
    "index": "linkedin_ads_data",
    "rangeApplied": false,
    "mediaFilterApplied": true
  },
  "meta": {}
}
```

| Field | Type | Description |
|---|---|---|
| `data.network`            | string  | Echoed, lowercased. |
| `data.totalAds`           | integer | The count. Matches what the frontend shows. |
| `data.index`              | string  | ES index queried — for debugging. |
| `data.rangeApplied`       | boolean | `true` if a `range` filter was applied. |
| `data.mediaFilterApplied` | boolean | `true` if the per-network displayable-media filter was applied (always `true` except for `google`, `bing`, `tiktok`). |

### Error — HTTP 400

```json
{
  "code": 400,
  "message": "Unsupported network \"foo\". Supported: facebook, instagram, google, gdn, native, pinterest, quora, reddit, youtube, linkedin, tiktok"
}
```

### Error — HTTP 503

Elasticsearch isn't reachable for the requested network.

```json
{
  "code": 503,
  "message": "Elasticsearch is not configured for network \"linkedin\""
}
```

### Error — HTTP 500

```json
{
  "code": 500,
  "message": "Failed to fetch total ad count",
  "error": "..."
}
```

---

## Examples

### Lifetime total — replaces `SELECT COUNT(id) FROM linkedin_ad`

**curl**

```bash
curl -X POST '<base>/api/v1/common/total-ad-count' \
     -H 'Content-Type: application/json' \
     -d '{"network": "linkedin"}'
```

**Python**

```python
import requests

resp = requests.post(
    f"{BASE_URL}/api/v1/common/total-ad-count",
    json={"network": "linkedin"},
    timeout=10,
)
resp.raise_for_status()
total = resp.json()["data"]["totalAds"]
```

### Date-bounded total — active ads in a window

```bash
curl -X POST '<base>/api/v1/common/total-ad-count' \
     -H 'Content-Type: application/json' \
     -d '{
       "network": "facebook",
       "range":   { "from": "2026-05-01", "to": "2026-05-26" }
     }'
```

### Batch — one count per network

```python
import requests

BASE_URL = "https://<host>"
NETWORKS = [
    "facebook", "instagram", "google", "gdn", "native", "pinterest",
    "quora", "reddit", "youtube", "linkedin", "tiktok",
]

results = {}
for net in NETWORKS:
    r = requests.post(
        f"{BASE_URL}/api/v1/common/total-ad-count",
        json={"network": net},
        timeout=15,
    )
    if r.ok:
        results[net] = r.json()["data"]["totalAds"]
    else:
        results[net] = None  # log r.text for the actual reason

print(results)
```

---

## Per-network notes

The internal `last_seen` field varies per network. You don't need to know
this — `range` always uses `YYYY-MM-DD`. Documented here for awareness.

| Network | `last_seen` field | Stored format | Displayable-media filter? |
|---|---|---|:-:|
| facebook   | `facebook_ad.last_seen`    | datetime string | yes |
| instagram  | `instagram_ad.last_seen`   | datetime string | yes |
| google     | `google_text_ad.last_seen` | datetime string | **no** |
| gdn        | `gdn_ad.last_seen`         | datetime string | yes |
| native     | `native_ad.last_seen`      | datetime string | yes |
| pinterest  | `pinterest_ad.last_seen`   | datetime string | yes |
| quora      | `quora_ad.last_seen`       | datetime string | yes |
| reddit     | `reddit_ad.last_seen`      | datetime string | yes |
| youtube    | `last_seen` (flat)         | epoch_second    | yes |
| linkedin   | `last_seen` (flat)         | epoch_second    | yes |
| tiktok     | `last_seen` (flat)         | datetime string | **no** |
| bing       | `bing_text_ad.last_seen`   | datetime string | **no** |

---

## Things to be aware of

1. **`range` filters on `last_seen`, not `first_seen`.** If you need "new
   ads discovered in this window" (DS Q2), this endpoint does **not** give
   you that.
2. **Counts can drift slightly between requests** because new ads are being
   ingested continuously. For day-over-day comparisons, lock the `range`.
3. **TikTok lives on a separate ES cluster.** Same endpoint, same request
   shape — routing is internal.
4. **No raw ES query injection.** The endpoint is intentionally limited to
   typed parameters (`network`, `range`). New filters get added as typed
   parameters when there's a real need.

---

## Versioning

Under `/api/v1/`. Breaking changes → `/api/v2/...`. Additions
(new optional fields, new networks) ship in place — not breaking.

---

## Contact

Backend changes / bugs / new feature requests — ping the admin-backend team.
