# Ad Analytics API — All Platforms

How the analytics ("Ad Insights") data is served for every ad network in `pas_node_api`:
which endpoint to call, what each platform returns, where the data comes from, and how the
advertiser-level numbers are calculated.

> Written 2026-10-01 from the code in `src/services/common/controllers/*CommonInsightsController.js`
> and each network's `controllers/adInsightsController.js`. Where this doc and `swagger.yml`
> disagree, this doc follows the code — see [Known inconsistencies](#9-known-inconsistencies).

Platform-specific deep dive: [CHATGPTADS_ANALYTICS_API.md](CHATGPTADS_ANALYTICS_API.md).

---

## 1. The endpoints

| Endpoint | What it is for |
|---|---|
| `POST /api/v1/common/ads/getAdInsights` | The main one. Streams every insight for one ad as Server-Sent Events. All networks except AdMob. |
| `POST /api/v1/<network>/ads/getAdvertiserInsightsByDateRange` | Advertiser-level data for a custom date range. Plain JSON. |
| `GET/POST /api/v1/common/ads/ad-country` | Just the ad-level country list, without the rest of the stream. Plain JSON. |
| `POST /api/v1/admob/ads/search` and `/ads/sessions` | AdMob. It does not use `getAdInsights` at all — see [section 8](#8-admob). |

---

## 2. `getAdInsights` — common behaviour

### Request

```json
POST /api/v1/common/ads/getAdInsights
Authorization: Bearer <token>

{ "network": "reddit", "reddit_ad_id": 88001, "user_id": 281, "language": "en" }
```

- `network` picks the platform handler. If omitted it defaults to `facebook`.
- The ad id field name is different per network (table below). The value is always the
  **internal** numeric id of the ad row, not the platform's own public ad id.
- `language` is only used by `adDetails`, to add a translation when it is not `en`.
- `platform: 15` is Facebook-only and switches on the `pageDetails` event.

| Network | Ad id field | Also required |
|---|---|---|
| facebook | `facebook_ad_id` | `user_id` |
| instagram | `instagram_ad_id` | `user_id` |
| youtube | `youtube_ad_id` | `user_id` |
| linkedin | `linkedin_ad_id` | `user_id` |
| reddit | `reddit_ad_id` | `user_id` |
| quora | `quora_ad_id` | `user_id` |
| pinterest | `pinterest_ad_id` | `user_id` |
| gdn | `gdn_ad_id` | `user_id` |
| google | `google_text_ad_id` | `user_id` |
| native | `native_ad_id` | `user_id` |
| tiktok | `tiktok_ad_id` (or `ad_id`) | — (but `lcs` and `analytics` return 401 inside the stream without `user_id`) |
| chatgptads | `chatgptads_ad_id` (or `ad_id`) | — |

### Middleware (in order)

`authMiddleware` → `planAccessMiddleware` → `requireCapability('legacy.advanced_ad_analytics')`
→ handler lookup in the `insightHandlers` map in `commonRoutes.js`.

### Response

`Content-Type: text/event-stream`. Every fetcher for the network runs in parallel and its
result is written as soon as it resolves, so **event order is not fixed**. `done` is always last.

```
event: <key>
data: {"code":200,"message":"...","data":...}

event: done
data: {"code":200,"message":"All insights complete"}
```

- **Per-fetcher timeout: 15 seconds.** A fetcher that times out sends
  `{"code":408,"data":null,"error":"Timed out"}` under its own key.
- **Stream safety timeout: 20 seconds.** If the fetchers have not all finished, the stream
  closes with `done` → `{"code":408,"message":"Stream timeout"}`.
- A fetcher that throws sends `{"code":500,"data":null,"error":"<message>"}`.
- Once the stream starts the HTTP status is 200. Each event carries its own `code`.

Errors before the stream starts are plain JSON:

| HTTP | When |
|---|---|
| 400 | `network` is not in `insightHandlers` |
| 401 | The network's required id / `user_id` is missing |
| 403 | Plan or capability check rejected the request |
| 503 | The network's service is not registered |

---

## 3. Which events each platform streams

Taken from each `INSIGHT_REGISTRY`.

| Event | fb | ig | yt | li | reddit | quora | pin | gdn | google | native | tiktok | chatgpt |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `adDetails` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `lcs` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | ✓ | — |
| `country` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `outgoingLinks` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `userData` | ✓ | ✓ | — | — | — | ✓ | — | — | — | — | — | — |
| `adsLibUserData` | — | ✓ | — | — | — | — | — | — | — | — | — | — |
| `pageDetails` | ✓* | — | — | — | — | — | — | — | — | — | — | — |
| `advertiserLCSData` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | — | ✓ | — |
| `advertiserCountryData` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `advertiserUserData` | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| `analytics`, `industries` | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| `targetSite`, `adNetwork`, `redirect`, `redirectOutgoingUrls` | — | — | — | — | — | — | — | — | — | ✓ | — | — |

\* `pageDetails` is only sent when the request has `platform: 15`.

---

## 4. Event reference

### 4.1 `adDetails`

The ad itself. For the ten legacy networks it is one SQL row (the network's `<net>_ad` table
joined to its variants, post owner, domain, meta data and so on) with extra fields overlaid
from the ad's Elasticsearch document. `data` is a one-item array.

| Network | Source |
|---|---|
| facebook, instagram, youtube, linkedin, reddit, quora, pinterest, gdn, google, native | SQL join + ES overlay — see `<network>/controllers/adDetailController.js` for the exact field list |
| chatgptads | ES only, a fixed list of 14 fields — see [CHATGPTADS_ANALYTICS_API.md](CHATGPTADS_ANALYTICS_API.md) |
| tiktok | No `adDetails` event. The `analytics` event carries the ad's ES document instead. |

### 4.2 `lcs` — likes / comments / shares over time for one ad

The shape differs per network, including the date format.

| Network | Source | Rows | Fields | `date` format |
|---|---|---|---|---|
| facebook | `facebook_ad_analytics` (SQL), last row overlaid from ES | one per day, plus a leading zero row at `post_date` | `likes`, `comment`, `share`, `engagement_rate` | `YYYY-MM-DD` |
| instagram | `instagram_ad_analytics` (SQL) | one per day | `likes`, `comment`, `share` | Unix seconds |
| reddit | `reddit_ad_analytics` (SQL) | one per day | `likes`, `comment`, `share` | Unix seconds |
| linkedin | `linkedin_ad_analytics` (SQL) | one per day, plus a leading zero row | `likes`, `comments`, `followers`, `hits`, `platform` | `YYYY-MM-DD` |
| tiktok | `tiktok_ad_analytics` (SQL) | one per snapshot | `likes`, `comments`, `shares` | raw `createdAt` |
| youtube | ES only | always one row (current totals) | `likes`, `comment`, `view` | `last_seen`, numeric |
| quora | ES only | always one row (current totals) | `likes`, `comment`, `share` | `YYYY-MM-DD` (`post_date`) |

Note the singular/plural difference: Facebook, Instagram, Reddit, YouTube and Quora use
`comment` / `share`; LinkedIn and TikTok use `comments` / `shares`. LinkedIn has `followers`
instead of shares. YouTube has `view` instead of shares.

### 4.3 `country` — countries one ad was seen in

Always `data: [{ country, iso }]`. Native also returns `count` per country.

| Network | Country names come from | ISO comes from |
|---|---|---|
| facebook | ES `country_only.country` | `country_data` lookup, one query per name |
| instagram | SQL `instagram_ad_countries_only` | `country_data.instagram_country_iso` |
| youtube | ES `countries` | `country_data`, batched; a bare 2-letter value is treated as an ISO |
| linkedin | ES `countries` (non-Latin names dropped) | `country_data`, batched; duplicates merged by ISO |
| reddit | ES `reddit_country_only.country`, falling back to `reddit_country.country` | `country_data`, batched |
| quora | ES `quora_country_only.country` | `country_data`, one query per name |
| pinterest | SQL `pinterest_ad_countries_only`; comma-separated values are split | `country_data`, batched |
| gdn | SQL `gdn_ad_countries_only`, with ES as fallback if SQL fails | `country_data`, batched; duplicates removed |
| google | SQL `google_text_ad_countries_only` | joined `country_data` |
| native | SQL `native_ad_countries_only` | joined `country_data` |

Every network applies a small `fixCountryIso` patch for names `country_data` gets wrong
(Czechia, Russia, the two Congos, and a few more for Google).

ChatGPT Ads reads the names from the ad's ES document (`country`) and returns `iso: null` —
only names are stored, and the frontend resolves the ISO from the name.

TikTok has no `country` event. Its ISO list is on the `analytics` document (`countries`).

### 4.4 `outgoingLinks` — redirect chain

| Network | Source table | Fields |
|---|---|---|
| facebook, youtube, linkedin, quora, pinterest, gdn, google | `<net>_ad_outgoing_links` (`google_ad_outgoing_links` for google) | `source_url`, `redirect_url`, `final_url` |
| instagram | `instagram_ad_url` | `url_type`, `url` |
| reddit | `reddit_ad_url` | all columns (`SELECT *`) |

Native sends the same data under two different keys: `redirect` (`native_ad_url`: `url`,
`url_type`) and `redirectOutgoingUrls` (`native_ad_outgoing_links`: `source_url`,
`redirect_url`, `final_url`).

When there are no rows the event has `code: 400` and `data` is `[]` or `null` depending on
the network.

### 4.5 `userData` — audience of one ad

| Network | Source | `data` |
|---|---|---|
| facebook | `facebook_ad_users` → `facebook_users`, cached in `facebook_ad_user_analytics` | demographic percentages (below), plus a second key `tragetData` holding the raw user rows |
| instagram | `instagram_ad_users` → `instagram_user` | raw user rows. `code: 201` when no users are linked. |
| quora | `quora_ad_users` → `quora_user` | raw user rows: `age`, `name`, `quora_id`, `current_country`, `Gender`, `relationship_status` |

Facebook's `data` holds three groups: age buckets (`age_18_to_24` … `age_55_to_64`), gender
(`male`, `female`) and relationship (`married`, `single`, `others`). Three things to know:

- **The key names are swapped at ad level.** `genderData` holds the age buckets and `ageData`
  holds male/female. (`advertiserUserData` has them the right way round.)
- **`data` is a JSON string the first time and an object afterwards.** A fresh calculation
  returns `JSON.stringify(...)`; a cached row returns a parsed object.
- **The age percentages are generated with random numbers**, ranked by which bucket has the
  most users; gender and relationship fall back to random splits when a group is empty. The
  result is written to `facebook_ad_user_analytics` on first request and reused from then on.

### 4.6 `adsLibUserData` (Instagram only)

From `instagram_page_details`: `{ genderData, ageData }`, parsed from the `gender_details` and
`age_details` JSON columns.

### 4.7 `pageDetails` (Facebook only, `platform: 15`)

The single `facebook_lib_page_details` row for the ad, all columns.

### 4.8 TikTok-only events

- **`analytics`** — the ad's full ES document from the TikTok index, matched on `sql_id`.
  This is TikTok's equivalent of `adDetails`, and where its `countries` ISO list lives.
- **`industries`** — not specific to the ad. A `terms` aggregation over the `industry` field of
  the whole index (top 100), mapped to categories.

### 4.9 Native-only events

- **`targetSite`** — `native_ad_target_site`, summed per date: `[{ date, count }]`.
- **`adNetwork`** — the ad networks serving the ad: `[{ network }]` from `native_ad_network`.
- **`redirect`**, **`redirectOutgoingUrls`** — see 4.4.

---

## 5. Advertiser-level data

These events answer "what has this ad's **advertiser** been doing", not "what did this ad do".

### 5.1 The common pattern

1. **Find the advertiser.** From the ad id, read the ad's `post_owner_id`, advertiser name and
   `last_seen` — one SQL join of `<net>_ad` to `<net>_ad_post_owners`. (TikTok reads these
   from the ad's ES document instead.)
2. **Pick the period.** The calendar year of the ad's `last_seen`, falling back to the current
   year. LinkedIn's `advertiserLCSData` is the exception — see 5.3.
3. **Fetch the advertiser's ads from ES** — every ad of that advertiser whose `last_seen` is
   in the period, up to 10,000. In parallel, a yearly `date_histogram` on `last_seen` gives
   `available_years`.
4. **Aggregate in code** — by country or by month.

Response envelope:

```json
{
  "code": 200,
  "message": "...",
  "post_owner_id": 3,
  "year": 2026,
  "available_years": [2026, 2025],
  "data": ...
}
```

`post_owner_id` is what the date-range endpoint (section 6) takes as input.

### 5.2 Per-network differences

| Network | ES index | How the advertiser is matched | `last_seen` in ES |
|---|---|---|---|
| facebook | env `FB_ES_INDEX` | `match` on `facebook_ad_post_owners.post_owner_name_exactly` | datetime string |
| instagram | env `IG_ES_INDEX` | `match` on `instagram_ad_post_owners.post_owner_name_exactly` | datetime string |
| gdn | `db.elastic.indexName` or `gdn_search_mix` | `match` on `gdn_ad_post_owners.post_owner_name_exactly` | datetime string |
| reddit | `reddit_search_mix` | `match_phrase` on `reddit_ad_post_owners.post_owner_name` | datetime string |
| quora | `quora_search_mix` | `match_phrase` on `quora_ad_post_owners.post_owner_name` | datetime string |
| pinterest | `pinterest_search_mix` | `match_phrase` on `pinterest_ad_post_owners.post_owner_name` | datetime string |
| native | `db.elastic.indexName` or `native_search_mix_v2` | `match_phrase` on `native_ad_post_owners.post_owner_name` | datetime string |
| google | `db.elastic.indexName`, env `GOOG_ELASTIC_INDEX`, or `google_ads_data_v2` | `match_phrase` on `post_owner_name` | datetime string |
| youtube | `db.elastic.indexName` or `youtube_ads_data` | `match_phrase` on `post_owner` | epoch seconds |
| linkedin | `linkedin_ads_data` | `match_phrase` on `post_owner` | epoch seconds |
| tiktok | env `TT_ELASTIC_INDEX` or `tiktok_ads` | `term` on `post_owner_id` | datetime string |
| chatgptads | `networks.chatgptads.elastic.index` in `config.json` | `term` on `post_owner_lower` | datetime string |

TikTok's cluster is ES 8.x and uses `calendar_interval: 'year'`; every other network is on
ES 6.x and uses `interval: 'year'`.

### 5.3 `advertiserLCSData` — engagement by month

`data` is an object keyed by month, oldest first:

```json
{
  "jan_2026": { "ad_ids": [11, 12], "total_ads": 2, "likes": 340, "comments": 21, "shares": 9 },
  "feb_2026": { "ad_ids": [13],     "total_ads": 1, "likes": 80,  "comments": 4,  "shares": 0 }
}
```

An ad is placed in the month of its **`last_seen`**, and counted once.

| Network | Where the numbers come from | Fields per month |
|---|---|---|
| facebook | Each ad's **latest** row in `facebook_ad_analytics` | `likes`, `comments`, `shares`, `engagement_rate` |
| instagram | Each ad's latest row in `instagram_ad_analytics` | `likes`, `comments`, `shares` |
| reddit | Each ad's latest row in `reddit_ad_analytics` | `likes`, `comments`, `shares` |
| linkedin | Each ad's latest row in `linkedin_ad_analytics` | `likes`, `comments`, `followers` |
| youtube | Totals stored on each ad's ES document | `likes`, `dislikes`, `comments`, `views` |
| quora | Totals stored on each ad's ES document | `likes`, `comments`, `shares` |
| tiktok | Totals stored on each ad's ES document | `likes`, `comments`, `shares` |

So a month's `likes` is the sum, across the ads whose `last_seen` falls in that month, of each
ad's most recent like count. It is not the likes gained during that month.

**LinkedIn is different:** its `advertiserLCSData` always covers the **last 12 months from
today**, ignores the ad's year, and returns no `year` or `available_years`.

### 5.4 `advertiserCountryData` — ads per country

```json
"data": [
  { "country": "India", "iso": "IN", "ad_ids": [42, 43], "ad_count": 2 },
  { "country": "United States", "iso": "US", "ad_ids": [42], "ad_count": 1 }
]
```

Sorted by `ad_count`, highest first.

- **`ad_count` is the number of distinct ads** seen in that country, not the number of sightings.
- **An ad seen in several countries is counted once in each**, so the counts can add up to more
  than the advertiser's total ads.
- **The period filter is on `last_seen`.**

| Network | Differences from the shape above |
|---|---|
| facebook, instagram, reddit, quora, pinterest, gdn, native, youtube | As shown. ISO from `country_data`. |
| linkedin | Non-Latin country names are dropped; names resolving to the same ISO are merged into one row. |
| google | Calculated with an ES `terms` + `cardinality` aggregation instead of fetching ads, so there is **no 10,000 cap** — but `ad_ids` is always `[]`. Buckets resolving to the same ISO are merged. |
| tiktok | ES stores ISO codes, so rows are `{ iso, ad_ids, ad_count }` with **no `country` name**. |
| chatgptads | Only full names are stored, so **`iso` is always `null`**; the frontend resolves it from the name. |

### 5.5 `advertiserUserData` (Facebook only)

Sums the cached per-ad rows in `facebook_ad_user_analytics` across all of the advertiser's ads
in the year: `{ ageData, genderData, relationshipData }`. Because it sums the per-ad
percentages described in 4.5, the totals are sums of percentages, not head counts.

### 5.6 The 10,000-ad cap

Every advertiser query except Google's country aggregation fetches at most 10,000 ES documents.
An advertiser with more ads than that in the period is undercounted.

---

## 6. `getAdvertiserInsightsByDateRange`

Same calculations as section 5, for a custom date range instead of a calendar year. Used by the
date picker in the analytics modal. Plain JSON, not SSE.

```json
POST /api/v1/<network>/ads/getAdvertiserInsightsByDateRange

{ "post_owner_id": 3, "from_date": "2026-01-01", "to_date": "2026-06-30", "type": "country" }
```

`post_owner_id` comes from an earlier `advertiserCountryData` / `advertiserLCSData` event.
Dates are `YYYY-MM-DD`.

| Network | Supported `type` values |
|---|---|
| facebook | `lcs` (default), `country`, `user` |
| instagram | `lcs`, `country` |
| youtube, reddit, quora, tiktok | `country`, `lcs` |
| linkedin, pinterest, gdn, google, native | `country` only |
| chatgptads | `country` only |

The response is `{ code, message, from_date, to_date, data }`, with `data` in the same shape as
the matching event in section 5.

---

## 7. `ad-country`

```
GET/POST /api/v1/common/ads/ad-country?network=<net>&<net>_ad_id=<id>
```

Runs only the network's `country` fetcher and returns `{ "code": 200, "data": [{ country, iso }] }`.
Used by the Ad Details popup, which needs the country list but not the whole stream.

- `user_id` defaults to 281 if not sent.
- No country data returns `code: 200` with `data: []`, never an error.
- TikTok is supported here: it reads the `analytics` document and reshapes its ISO list to
  `[{ country: "<ISO>", iso: "<ISO>" }]`.
- ChatGPT Ads and AdMob are not supported.

---

## 8. AdMob

AdMob is not in `insightHandlers`. The frontend (`useAdInsights.js`) calls two AdMob endpoints
directly and does not open an SSE stream:

| Call | Used as |
|---|---|
| `POST /api/v1/admob/ads/search` with `{ id, take: 1 }` | the ad details |
| `POST /api/v1/admob/ads/sessions` with `{ id, take: 25, skip: 0 }` | the session list |

AdMob has no advertiser-level view; the country chart shows ad-level data only. Country comes
back as a full name and the frontend resolves the ISO from it (`NAME_TO_ISO` in
`CountryAnalytics.jsx`) — the same approach ChatGPT Ads uses.

---

## 9. Known inconsistencies

Observed in the code while writing this. None are fixed here; they are listed so nobody is
surprised by them.

1. **`swagger.yml` is out of date for this endpoint.** Its events table does not match the
   registries (for example it omits Native's `advertiserCountryData` and TikTok's two
   advertiser events), and it says the per-fetcher timeout is 2 seconds; the code uses 15.
2. **`year` is not forwarded by `getAdInsights`** for any network except ChatGPT Ads. The
   fetchers read `year`, but the registry payloads do not pass it, so the stream always uses
   the ad's own `last_seen` year. Other periods go through the date-range endpoint.
3. **Empty advertiser results differ.** Facebook and Instagram return `code: 400`,
   `"No data found."`, `data: null`. The other networks return `code: 200` with empty `data`.
4. **`lcs` field names and date formats differ per network** (section 4.2).
5. **Facebook `userData`** — swapped `ageData` / `genderData` keys, string-or-object `data`,
   randomly generated percentages, and the misspelt `tragetData` key (section 4.5).
6. **Facebook `country` returns `code: 401`** (`"Something Went Wrong"`) when the ad has no
   country, where other networks return 400.
7. **Index names are sourced four different ways** — env vars, `db.elastic.indexName`,
   hardcoded strings, and `config.json` (section 5.2).
8. **LinkedIn `advertiserLCSData`** uses a rolling 12 months while LinkedIn's own
   `advertiserCountryData` uses the ad's year (section 5.3).

---

## 10. Where the code lives

| Path | Role |
|---|---|
| `src/services/common/routes/commonRoutes.js` | The route and the `insightHandlers` network → handler map. |
| `src/services/common/helpers/sseHelper.js` | `streamInsights` — parallel fetch, timeouts, event writing. |
| `src/services/common/controllers/<net>CommonInsightsController.js` | One per network: the `INSIGHT_REGISTRY` and parameter check. Facebook's is `commonInsightsController.js`, Instagram's is `instaCommonInsightsController.js`. |
| `src/services/<net>/controllers/adInsightsController.js` | The fetchers: lcs, country, outgoing links, advertiser data, date range. |
| `src/services/<net>/controllers/adDetailController.js` | The `adDetails` fetcher (ChatGPT Ads keeps it in `adInsightsController.js`). |
| `src/services/common/controllers/adCountryController.js` | The `ad-country` endpoint. |
| `new-ui-react/src/hooks/useAdInsights.js` | Frontend consumer: `NETWORK_AD_ID_FIELD` and the SSE reader. |
| `new-ui-react/src/components/modals/analytics/CountryAnalytics.jsx` | Frontend country chart, including name → ISO resolution. |

### Adding a network

1. Write the fetchers as `async (req, db, logger)` functions returning `{ code, data, … }`.
2. Create `src/services/common/controllers/<net>CommonInsightsController.js` with an
   `INSIGHT_REGISTRY`. Each entry's `key` becomes the SSE event name.
3. Add the network to `insightHandlers` in `commonRoutes.js`.
4. Add the id field to `NETWORK_AD_ID_FIELD` in `useAdInsights.js`.
5. Check the network passes `planAccessMiddleware` and the `legacy.advanced_ad_analytics`
   capability.
6. Update `swagger.yml` and this document.
