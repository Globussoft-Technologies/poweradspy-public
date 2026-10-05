# ChatGPT Ads (platform 21) — Analytics API

Analytics for ChatGPT Ads is served by the same endpoint every other network uses:

```
POST /api/v1/common/ads/getAdInsights
```

Send `network: "chatgptads"` and the endpoint streams three results as Server-Sent Events:
the ad's details, the countries this ad was seen in, and a country breakdown for the ad's
advertiser.

> **Status (2026-10-01):** code written and checked against stubbed ES/SQL responses only.
> It has not been run against the live server or real data yet — `chatgptads_ad` was empty
> at the time of writing. See [Open items](#open-items) before relying on it.

Related reading:
- [insertion/chatgptads/MANIFEST.md](insertion/chatgptads/MANIFEST.md) — how the data gets in (tables, ES mapping).
- [insertion/chatgptads/PAYLOAD-SPEC.md](insertion/chatgptads/PAYLOAD-SPEC.md) — the insertion payload.
- `swagger.yml` → `/api/v1/common/ads/getAdInsights` — the same contract in Swagger.

---

## 1. Request

```json
POST /api/v1/common/ads/getAdInsights
Authorization: Bearer <token>
Content-Type: application/json

{
  "network": "chatgptads",
  "chatgptads_ad_id": 42,
  "user_id": 281
}
```

| Field | Required? | Notes |
|---|---|---|
| `network` | **Required** | Must be `"chatgptads"`. If omitted, the endpoint defaults to `facebook`. |
| `chatgptads_ad_id` | **Required** | The **internal** numeric id — `chatgptads_ad.id` in MySQL, field `id` in ES. `ad_id` is accepted as an alias for the same value. |
| `year` | Optional | Year for the advertiser country breakdown. Defaults to the year of this ad's `last_seen`. |
| `user_id` | Optional | Not used by this network; sent for consistency with the other networks. |

### Which id to send

A ChatGPT ad has two ids. Send the first one.

| Id | Example | Where it lives | Use it here? |
|---|---|---|---|
| Internal id | `42` | `chatgptads_ad.id`, ES `id` | **Yes** |
| Extension ad id | `"123456789012"` | `chatgptads_ad.ad_id`, ES `ad_id` | No |

The request field named `ad_id` (the alias) still means the **internal** id. It is not matched
against the ES `ad_id` field.

---

## 2. Response

The response is an SSE stream (`Content-Type: text/event-stream`). The three results are fetched
in parallel and each is sent the moment it is ready, so their order is not guaranteed. A `done`
event always comes last.

```
event: adDetails
data: {"code":200,"data":[{ ... }],"message":"Ad details fetched successfully"}

event: country
data: {"code":200,"message":"ChatGPT Ads country data fetched.","data":[{"country":"India","iso":null}]}

event: advertiserCountryData
data: {"code":200,"post_owner_id":3,"year":2026,"available_years":[2026],"data":[ ... ]}

event: done
data: {"code":200,"message":"All insights complete"}
```

Each fetcher has a 15 second timeout. One that times out sends `{"code":408,"data":null,"error":"Timed out"}`
under its own event key and does not block the others.

### 2.1 `adDetails`

Read from Elasticsearch only (no SQL). `data` is an array with one object:

```json
{
  "code": 200,
  "message": "Ad details fetched successfully",
  "data": [
    {
      "id": 42,
      "ad_id": "123456789012",
      "ad_text": "For long sitting in an ergonomic office chair, here is a back-support option.",
      "ad_title": "Make Every Chair More Comfortable",
      "newsfeed_description": "Add lower back support to your everyday chair for better comfort while you sit.",
      "post_owner_image": "https://media.globussoft.com/pas-dev/stream/gpt/postowner/202610/3.png",
      "post_owner_name": "Leeford Ortho",
      "new_nas_image_url": "https://media.globussoft.com/pas-dev/stream/gpt/adImage/202610/42.png",
      "first_seen": "2026-10-01 10:30:55",
      "last_seen": "2026-10-01 10:30:55",
      "ad_position": "conversational_bottom",
      "type": "IMAGE",
      "domain": "leeford.example.com",
      "destination_url": "https://leeford.example.com/landing?utm_source=chatgpt",
      "image_url_original": "https://example-cdn.com/ads/chair-ad.jpg",
      "image_video_url": "https://media.globussoft.com/pas-dev/stream/gpt/adImage/202610/42.png",
      "days_running": 1,
      "lang_detect": "English",
      "language": "English"
    }
  ]
}
```

| Field | Notes |
|---|---|
| `id` | Internal id (the one sent in the request). |
| `ad_id` | The extension's own ad id. |
| `ad_title`, `ad_text`, `newsfeed_description` | Ad copy as first seen. A re-send with changed copy does not overwrite it. |
| `post_owner_name` | Advertiser name. |
| `post_owner_image` | Advertiser logo, returned as a full CDN URL. |
| `image_video_url` | Our stored (NAS) copy of the creative, as a full CDN URL — same field name and meaning as the other networks. For `IMAGE` ads it is the image. For `VIDEO` ads it is the video, or the video's thumbnail until the video has been stored. `null` if no media has been stored yet. |
| `image_url_original` | The original source URL the extension sent, returned unchanged. It can be a signed URL that expires, so prefer `image_video_url` for display. |
| `new_nas_image_url` | The ad image as a full CDN URL — the same value as `image_video_url` for `IMAGE` ads. **`null` for `type: "VIDEO"` ads.** Kept for compatibility; use `image_video_url`. |
| `first_seen`, `last_seen` | `yyyy-MM-dd HH:mm:ss`. |
| `days_running` | Number of days the ad has been running, as stored by the insertion pipeline. |
| `lang_detect` | Detected language of the ad copy, as a full name (e.g. `English`), from the translation step at insertion. `null` if detection has not run or failed. |
| `language` | Same value as `lang_detect` — the field name the analytics modal and the other networks use. |
| `ad_position` | ChatGPT placement, e.g. `conversational_bottom`. Free-form, not a fixed list. |
| `type` | `IMAGE` or `VIDEO`. |
| `domain` | Derived from `destination_url` at insertion time. |
| `destination_url` | Where the ad links to. |

Any field missing from the ES document is returned as `null`.

**How the image URLs are built.** ES stores a NAS path such as
`/pas-dev/stream/gpt/adImage/202610/42.png`. The API turns it into a full URL with
`mediaUrl()` from `helpers/paramParser.js` — the same function the ChatGPT search cards use —
which goes through the shared NAS resolver (`resolveMediaUrl`, base
`config.insertion.nas.mediaUrl`), so the URL points at the same place the file was uploaded
to. A value that is already an absolute `http…` URL is returned unchanged, and a
`DefaultImage` placeholder (a failed upload) is returned as `null` instead of a broken image.

### 2.2 `country` (ad level)

Every country this one ad has been seen in, read from the ad's ES document (`country`). The
insertion pipeline appends to that list each time the extension re-sends the ad from a new
country, so it is the ad's full history.

```json
{ "code": 200, "message": "ChatGPT Ads country data fetched.", "data": [ { "country": "India", "iso": null } ] }
```

Duplicates (case-insensitive) are removed. `iso` is always `null` for the same reason as in
2.3. When the ad has no countries the event is `code: 400`, `"No country data found."`, and
the frontend shows "No data found" for the Ad Level view.

### 2.3 `advertiserCountryData`

Shows in which countries the ad's advertiser has been running ads during one year.

```json
{
  "code": 200,
  "message": "Advertiser country data fetched.",
  "post_owner_id": 3,
  "year": 2026,
  "available_years": [2026],
  "data": [
    { "country": "India", "iso": null, "ad_ids": [42, 43], "ad_count": 2 },
    { "country": "USA",   "iso": null, "ad_ids": [42],     "ad_count": 1 }
  ]
}
```

| Field | Notes |
|---|---|
| `post_owner_id` | The advertiser's id (`chatgptads_ad_post_owners.id`). |
| `year` | The year the breakdown covers. |
| `available_years` | Every year this advertiser has ads in, newest first. Use it for a year picker. |
| `data[].country` | Full country name, exactly as stored. |
| `data[].iso` | **Always `null`** — see below. |
| `data[].ad_ids` | Internal ids of the advertiser's ads seen in that country. |
| `data[].ad_count` | Number of entries in `ad_ids`. |

`data` is sorted by `ad_count`, highest first. When the advertiser has no ads in the year, the
response is `code: 200` with `data: []` and the message `"No data found for this year."`.

**Why `iso` is always `null`.** This network stores only the full country name — there is no ISO
code in the payload and no `country_data` table in its database. The frontend resolves the ISO
from the name using `NAME_TO_ISO` (`normalizeCountryIdentity` in
`new-ui-react/src/components/modals/analytics/CountryAnalytics.jsx`), the same way it already
does for AdMob.

---

## 3. How the advertiser data is calculated

1. **Find the advertiser (MySQL).** One query joins `chatgptads_ad` to
   `chatgptads_ad_post_owners` on the requested id and reads `post_owner_id`,
   `post_owner_lower` and the ad's `last_seen`.
2. **Pick the year.** The request's `year` if sent, otherwise the year of the ad's `last_seen`.
   The range is 1 January 00:00:00 to 31 December 23:59:59.
3. **Fetch the advertiser's ads (ES).** Two queries run in parallel:
   - the ads — exact `term` match on `post_owner_lower`, `last_seen` within the year, fetching
     only `id` and `country`, up to 10,000 documents;
   - the available years — a yearly `date_histogram` on `last_seen` for the same advertiser,
     with no year filter.
4. **Group by country (in code).** Each ad's `country` is the list of every country it was seen
   in. For each country the code collects the set of ad ids that include it, then sorts
   countries by how many ads they have.

### Worked example

Advertiser "Leeford Ortho" has two ads with `last_seen` in 2026:

| Ad id | `country` |
|---|---|
| 42 | India, USA |
| 43 | India |

Result: India → `ad_ids: [42, 43]`, `ad_count: 2`; USA → `ad_ids: [42]`, `ad_count: 1`.

### What the numbers mean

- **`ad_count` counts distinct ads, not sightings.** An ad seen 50 times in India counts as 1
  for India. The per-country sighting count in `chatgptads_ad_countries.count` is not used.
- **An ad seen in several countries is counted once in each.** The `ad_count` values can
  therefore add up to more than the advertiser's total number of ads.
- **The year filter is on `last_seen`.** An ad first seen in 2025 and still running in 2026
  appears only under 2026.
- **Ads with no country are skipped.**
- **10,000 ad cap.** An advertiser with more than 10,000 ads in one year would be undercounted.
  Every other network's advertiser country data has the same limit.

### Custom date range ("Select Range")

The analytics modal's date picker calls a separate, plain-JSON endpoint:

```json
POST /api/v1/chatgptads/ads/getAdvertiserInsightsByDateRange

{ "post_owner_id": 3, "from_date": "2026-10-01", "to_date": "2026-10-30", "type": "country" }
```

It runs the same calculation as `advertiserCountryData`, with `last_seen` filtered to the given
dates instead of a calendar year. `post_owner_id` is the one returned in the
`advertiserCountryData` event. Only `type: "country"` is supported. Response:
`{ code, message, from_date, to_date, post_owner_id, data }`, with `data` in the same shape as
`advertiserCountryData`. No ads in the range returns `code: 400`, `"No data found."`, `data: []`.

Guards: `authMiddleware` → `planAccessMiddleware` → `requirePlatform('chatgptads')`, the same as
`/api/v1/chatgptads/ads/search`. Route file: `src/services/chatgptads/routes/chatgptadsInsightsRoutes.js`.

---

## 4. Errors

Errors before the stream starts are plain JSON with the matching HTTP status:

| HTTP | When | Body |
|---|---|---|
| 400 | `network` is not a supported value | `{"code":400,"message":"Unsupported network: … Available: …"}` |
| 401 | `chatgptads_ad_id` (and `ad_id`) missing | `{"code":401,"message":"Missing parameters: chatgptads_ad_id (or ad_id) is required"}` |
| 403 | Plan/capability check rejected the request | from `planAccessMiddleware` / `requireCapability` |
| 503 | `chatgptads` service not registered | `{"code":503,"message":"ChatGPT Ads service not available"}` |

Once the stream has started the HTTP status is always 200, and each event carries its own `code`:

| Event | `code` | Meaning |
|---|---|---|
| `adDetails` | 404 | No ES document with that internal id. |
| `adDetails` | 503 | ES connection not available. |
| `advertiserCountryData` | 400 | No `chatgptads_ad` row with that id, so the advertiser could not be found. |
| `advertiserCountryData` | 503 | SQL or ES connection not available. |
| either | 408 | The fetcher took longer than 15 seconds. |
| either | 500 | Unexpected error; `error` holds the message. |

Note that the two events read from different stores. Straight after an insert, the SQL row
exists immediately but the ES document is only searchable after the index's 30 second refresh,
so `adDetails` can briefly return 404 while `advertiserCountryData` already finds the advertiser.

---

## 5. Where the code lives

| File | Role |
|---|---|
| `src/services/chatgptads/controllers/adInsightsController.js` | The API functions: `getAdDetails`, `getChatgptAdCountry`, `getAdvertiserCountryData` and `getAdvertiserInsightsByDateRange`. |
| `src/services/chatgptads/helpers/insightsHelpers.js` | Shared helpers those functions reuse: ES index from config, id parsing, the ad / advertiser ES queries, year and date ranges, available years, and the country grouping. |
| `src/services/common/controllers/chatgptadsCommonInsightsController.js` | SSE wrapper. Holds the registry of fetchers and streams them. |
| `src/services/common/routes/commonRoutes.js` | `chatgptads` entry in the `insightHandlers` map. |
| `src/services/common/helpers/sseHelper.js` | Shared streaming and timeout logic (unchanged). |

### Configuration

Nothing is hardcoded in the controller.

| Item | Source |
|---|---|
| ES index | `networks.chatgptads.elastic.index` in `config.json` (currently `chatgpt_search_mix`), overridable with the `CGA_ELASTIC_INDEX` env var. Read through `src/config/networks.js`. |
| MySQL connection (`db.sql`) | `networks.chatgptads.sql` in `config.json`. Injected by `ServiceRegistry`. |
| ES connection (`db.elastic`) | `networks.chatgptads.elastic` in `config.json`. Injected by `ServiceRegistry`. |
| CDN prefix | `config.cdn.baseUrl`. |

### Adding another insight

Write a new `async (req, db, logger)` function in `adInsightsController.js` that returns
`{ code, data, … }`, export it, and add one entry to `INSIGHT_REGISTRY` in
`chatgptadsCommonInsightsController.js`. The `key` becomes the SSE event name.

---

## 6. What this network does not have

Other networks stream more events from this endpoint. These are absent for ChatGPT Ads because
the data does not exist, not because they were left out:

| Event on other networks | Why not here |
|---|---|
| `lcs`, `advertiserLCSData` | No likes, comments or shares — ChatGPT's ad surface has no engagement data. |
| `userData`, `advertiserUserData` | No age or gender targeting data. |
| `outgoingLinks` | No outgoing-link / redirect resolver for this network. |

---

## Open items

1. **Not tested live.** Both functions were exercised only with stubbed ES/SQL responses.
   Run a real request once an ad has been inserted.
2. **Plan gating is unverified.** The route runs `planAccessMiddleware` and
   `requireCapability('legacy.advanced_ad_analytics')` before the handler, and `chatgptads` is
   not in the hardcoded platform list in `src/middleware/planAccess.js`. If requests come back
   403, that is the place to look.
3. **Frontend is not wired.** `NETWORK_AD_ID_FIELD` in `new-ui-react/src/hooks/useAdInsights.js`
   has no `chatgptads` entry, so the hook would send `facebook_ad_id` for this network. It needs
   `chatgptads: 'chatgptads_ad_id'`.
4. **VIDEO media is untested.** `image_video_url` returns the video (or its thumbnail) for
   VIDEO ads, but no real ChatGPT VIDEO ad has been inserted yet to check it against.
5. **A server restart is needed** for the new `insightHandlers` entry to take effect.
