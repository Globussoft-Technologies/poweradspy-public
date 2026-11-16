# Custom Keyword (Google) — feature notes

Status: code complete, **off by default**. Not yet merged or deployed. Last updated 2026-11-11.

## What it does

A user uploads a sheet (.csv or .xlsx) of their own keywords. A scraper works through them, scrapes Google ads for each keyword and stores the ads in SQL and Elasticsearch. When the user searches that keyword, they see the normal ads **plus their own scraped ads**. Nobody else sees those ads.

- Google only. New ads only (no backfill).
- User-specific: ownership and visibility are per user. Only the scraper work queue is shared.

## Flow

```
USER                                   SCRAPER                                  SEARCH
1. Custom Keyword button (SDUI)        4. GET  /scraper/keywords?size=N         8. user types a keyword in the
2. download sample (.xlsx or .csv)        (or ?keyword=..)  -> keywords to scrape  normal Keyword search (Google tab)
3. upload filled sheet                 5. scrape Google for those keywords      9. query = normal match
   -> Mongo, owner = id from JWT       6. POST /insertion/gtAdsData                 OR tag "<token user id>:<keyword>"
                                          custom_keyword: ["kw1","kw2",..]     10. user sees normal + own ads
                                          (a list, NO user id) -> the backend
                                          finds the owners in Mongo
                                       7. POST /scraper/results  -> done / no_ads_found / failed
                                          done -> owners get a bell notification + a push
```

The tag stored with every custom ad is `"<userId>:<normalized keyword>"`, for example `281:nike shoes`. The user id is what keeps two users' ads apart, including when both upload the same keyword. **The scraper never sends the user id**: when an ad arrives with `custom_keyword`, the backend looks up every user who uploaded that keyword in MongoDB and writes one tag per owner. If two users uploaded the same keyword, both get the ad.

Normalization: `|` becomes a space, then trim, collapse spaces, lower-case.

## APIs (base `/api/v1/google/custom-keywords`)

Everything returns **503** while `customKeywords.enabled` is false.

**Who gets it (`customKeywords.allowedUserIds`)** — same contract as `imageGen` / `chatgptads`:
- `enabled` false → nobody.
- `enabled` true, `allowedUserIds` empty → every logged-in user.
- `enabled` true, `allowedUserIds` has ids → **only those user ids**: the button shows only for them, the user routes answer a plain **404** to everyone else, their keyword search gets the own-ads clause only if they are on the list, and the scraper GET hands out only keywords owned by listed users.

### User (header `Authorization: Bearer <JWT>`; the user id always comes from the token)

| Call | Purpose |
|---|---|
| `GET /access` | Whether this user gets the feature: `{ data: { enabled: true|false } }`. The frontend reads it to show or hide the button. Needs only the login token. |
| `GET /sample?format=xlsx\|csv` | Download the sample: `.xlsx` (default; sheet `Keywords`, column `keyword`, plus an `Instructions` sheet) or `.csv` (UTF-8, header `keyword`). Any other `format` is a 400. |
| `POST /upload` | multipart field `file`: **`.csv` or `.xlsx` only** (first sheet, header `keyword`, case-insensitive). CSV may be comma, semicolon or tab separated and may start with a BOM. Any other type gets a 400 with a clear message (`.xls` is told to save as `.xlsx` or `.csv`). Returns `received`, `added`, `duplicates`, `invalid[]` (row + reason), `notAddedOverLimit`, and `items[]`: one result per keyword in the sheet, in sheet order — `{ row, keyword, result, reason? }` with `result` = `added`, `duplicate` (`already in your list` or `repeated in your file`), `invalid` (too long) or `not_added` (over the per-user limit) |
| `GET /?page=&page_size=&status=&q=` | The caller's own keywords, with status and counts |

### Scraper (no JWT; header `x-scraper-name`): one GET to fetch keywords, one POST to send back the results

Base `/api/v1/google/custom-keywords/scraper`. The scraper name is `config.keywordSearch.scraperHeader` (default `x-scraper-name`), or `scraper` in the body or the query string — the same identity the existing `keyword-search/work` uses. There is **no user id** anywhere in the scraper API.

The scraper is flexible: it decides how many keywords to take at a time (1, 2 or 10 ...), can ask for exact keywords, and reports how each one went.

#### `GET /keywords` — fetch keywords (or just look)

| Query | Meaning |
|---|---|
| `size=5` | Take up to 5 waiting keywords, oldest first. Default `1`. `0` takes nothing. Max `maxClaimSize` (100). |
| `keyword=gym bag&keyword=yoga mat` | Take exactly these keywords instead. Repeat the parameter for several (a comma is **not** a separator, a keyword may contain one). Any case. A keyword that is already `done` can be scraped again. `size` is ignored. |
| `status=pending` | Only **look**: list the keywords with this status (`pending`, `in_progress`, `done`, `no_ads_found`, `failed`) and take nothing. Also `limit=50&page=1`. |

Taking a keyword marks it `in_progress` for this scraper (the same way the existing keyword-search `GET /next` works). The response is never cached.

Take response:

```json
{
  "code": 200,
  "message": "claimed",
  "scraper": "scraper-1",
  "data":    [ { "id": "…", "keyword": "yoga mat", "attempt": 1 }, { "id": "…", "keyword": "gym bag", "attempt": 1 } ],
  "skipped": [ { "keyword": "no such keyword", "reason": "not_found" } ],
  "left": 11,
  "total": 40
}
```

- `data` is always a list (empty when nothing was taken). `message` is `claimed`, `no pending keywords`, `ok` (size 0) or `no keywords taken` (only skipped ones).
- `skipped` only lists keywords asked for by name: `not_found` (nobody uploaded it) or `in_progress` (another scraper has it).
- `left` = entries still pending (one per user and keyword, not counting what was just handed out). `total` = all entries.

Look response (`?status=pending`): one row per distinct keyword, oldest first, plus the counts of every status:

```json
{ "code": 200, "status": "pending", "page": 1, "pageSize": 50, "total": 2,
  "counts": { "pending": 3, "in_progress": 1, "done": 1, "no_ads_found": 0, "failed": 1 },
  "data": [ { "keyword": "gym bag", "owners": 2, "attempts": 0, "since": "2026-01-01T00:00:00.000Z" } ] }
```

`owners` = how many users uploaded the keyword (never their ids). `in_progress` rows show `claimedBy`; failed rows show `lastError`. The status counts are over entries, so a keyword uploaded by two users counts twice there.

#### `POST /results` — send back how each keyword went

```json
{ "results": [
  { "keyword": "gym bag",   "status": "done" },
  { "keyword": "yoga mat",  "status": "no_ads_found" },
  { "id": "…",              "status": "failed", "error": "captcha" }
] }
```

- `status` is `done`, `no_ads_found` or `failed`. Match each result by `keyword` (any case) or by `id`.
- Or send `{ "status": "done" }` (no `results`) to close **everything** this scraper holds. An empty body is a 400, never a silent "close all".

```json
{ "code": 200, "message": "recorded", "scraper": "scraper-1",
  "closed":  [ { "id": "…", "keyword": "gym bag", "status": "done" } ],
  "ignored": [ { "keyword": "never taken", "reason": "not_held" } ] }
```

`ignored` lists results for keywords this scraper does not hold (never taken, already closed, or held by another scraper).

Rules:
- **A keyword uploaded by several users is taken once for all of them**: one scrape serves every owner. All their entries move to `in_progress` and are closed together.
- A failed keyword goes back to `pending` and is retried after `retryDelayMinutes`, up to `maxAttempts`, then it becomes `failed`.
- A keyword `in_progress` for more than `staleClaimMinutes` is handed to another scraper (no cron).
- A scraper can only close keywords it holds.
- Status lifecycle: `pending` → `in_progress` → `done` | `no_ads_found` | `failed`.
- With an allow-list, only keywords owned by allowed users are handed out or listed.

### Insertion (existing `POST /api/v1/google/insertion/gtAdsData`, existing auth)

Add **one** field to every ad scraped for custom keywords. It is a **list**, so one ad can carry as many keywords as the scraper likes (copy them from the keywords the GET gave you):

```json
{ "custom_keyword": ["gym bag", "yoga mat"] }
```

A single string (`"custom_keyword": "gym bag"`) also works. Keywords are trimmed, lower-cased and de-duplicated; blanks, non-text items and keywords longer than `maxKeywordLength` are ignored; at most `maxClaimSize` keywords per ad are used.

There is no user id in the insertion. The backend finds the owners itself (users who uploaded each keyword and are allowed to use the feature) and tags the ad for each owner of each keyword. An old scraper that still sends `custom_keyword_user_id` is harmless: the field is ignored.

Ordinary ads omit `custom_keyword` and behave exactly as before, with no extra query. If nobody uploaded the keyword, or MongoDB cannot be reached, the ad is still inserted, just without tags. All owners are looked up with one Mongo query per ad, and cached for 30 seconds, so many ads for the same keywords cost no extra queries.

## Notifications (bell + push)

When the scraper reports a keyword as `done` (`POST /scraper/results`), every user who uploaded that keyword is told:

- **Bell** (the in-app bell): one document per owner is upserted into the collection the bell already reads (`config.keywordSearch.notify.collection`, default `keyword_ad_notifications`), with `type: 0` (keyword), `network: 'google'`, the keyword as `value`, `source: 'custom_keyword'` and `notified: false`. It shows as "New ads found for “gym bag”" with no frontend change. Clicking it opens a Google keyword search, which shows the normal ads plus the user's own scraped ones. If the user already has a bell row for that keyword today, it is reused. Marking it read removes it, as with every other bell item; reporting the keyword `done` again later creates a new one.
- **Push** (Firebase): one push per owner who has an FCM token and the Profile › Notifications **"Keyword search results"** switch on (the same token and switch the first-ad push uses). Text: "Your keyword has been scraped — We found ads for your keyword "gym bag". Tap to view." Tapping opens `/?keyword=gym%20bag&platform=google`.

Rules:
- Only `done` notifies. `no_ads_found` and `failed` do not, and neither does a result for a keyword the scraper does not hold, or a repeated `done`.
- Only owners whose entry was really closed by that call are notified, and only allowed users (`allowedUserIds`).
- It runs after the scraper's request and never delays or fails it; any problem is only logged.
- The bell part needs the existing bell to be on (`keywordSearch.enabled` and `keywordSearch.notify.enabled`). The push part works without it.
- Switch both off with `customKeywords.notifyEnabled: false`.
- No ad count is shown (counting a user's tagged ads needs the ES mapping).

## Storage

| Store | What |
|---|---|
| MongoDB | collection `custom_keywords` (own collection, so the keyword-search auto-cleanup cannot delete it). Unique index `(userId, keywordNorm)`. One document per user and keyword. |
| SQL | column `custom_keyword TEXT NULL` on `google_text_ad_variants`, tags joined by `\|` (same shape as `target_keyword`) |
| Elasticsearch | `custom_keyword` on `google_ads_data_v2`, mapped `keyword`, stored as an **array** of tags. An ad found for two users' keywords has both tags. |

The index is `dynamic:false`: without the mapping the field is stored (visible in `_source`) but **not searchable**.
SQL and ES custom-keyword writes are best-effort: a failure logs a warning and never fails the ad insert. For an ad that already exists, the tag is added atomically (painless script, `retry_on_conflict: 3`).

## Search

With the flag on, a Google keyword search becomes `(normal match) OR term custom_keyword = "<token user id>:<keyword>"`. The id comes from the JWT, never the request. With the flag off, the query is unchanged. Advertiser and Domain searches are unchanged. Only the Google keyword search (`GoogleSearchQueryBuilder._getKeywordEnv`) is touched.

## SDUI

The button is driven by SDUI, nothing hardcoded. Add this navbar document (admin: SDUI Config → New Document, type `navbar`, display mode `inline`; or insert into `sdui_config`):

```json
{
  "_id": "custom_keyword",
  "config_type": "navbar",
  "title": "CUSTOM KEYWORD",
  "rank": 99,
  "collapsed_by_default": false,
  "visible": true,
  "icon": { "type": "none", "value": null },
  "meta": "Upload your own keywords and see only your ads for them.",
  "display_mode": "inline",
  "platform_applicability": ["google"],
  "filters": []
}
```

Behaviour: the button shows only when the document exists, is `visible`, Google is the only selected network (a missing platform list means Google), **and** `GET /custom-keywords/access` says this user is allowed. Guests never see it. Hide it with `visible: false` or delete the document. The seed file `sduiConfig.json` already contains it for fresh databases.

`filterConfigByPlatforms` was changed to keep navbar documents that never had filters. Without that fix the button appeared and then disappeared when the config was refetched for the selected networks.

## Config (`src/config/index.js`, block `customKeywords` in `config.json`; each has an env override)

| Key | Default | Env |
|---|---|---|
| `enabled` | `false` | `CUSTOM_KEYWORDS_ENABLED` |
| `allowedUserIds` | `[]` (everyone) | `CUSTOM_KEYWORDS_ALLOWED_USER_IDS` (comma-separated) |
| `mongoSlug` / `database` / `collection` | keyword-search slug / its database / `custom_keywords` | `CUSTOM_KEYWORDS_MONGO_SLUG` / `_DATABASE` / `_COLLECTION` |
| `maxUploadMb` | 5 | `CUSTOM_KEYWORDS_MAX_UPLOAD_MB` |
| `maxRowsPerUpload` | 5000 | `CUSTOM_KEYWORDS_MAX_ROWS` |
| `maxKeywordsPerUser` | 10000 | `CUSTOM_KEYWORDS_MAX_PER_USER` |
| `maxKeywordLength` | 100 | `CUSTOM_KEYWORDS_MAX_LENGTH` |
| `maxAttempts` | 3 | `CUSTOM_KEYWORDS_MAX_ATTEMPTS` |
| `retryDelayMinutes` | 10 | `CUSTOM_KEYWORDS_RETRY_DELAY_MIN` |
| `staleClaimMinutes` | 30 | `CUSTOM_KEYWORDS_STALE_MINUTES` |
| `notifyEnabled` | `true` | `CUSTOM_KEYWORDS_NOTIFY_ENABLED` (bell + push when a keyword is done) |
| `maxClaimSize` | 100 | `CUSTOM_KEYWORDS_MAX_CLAIM_SIZE` (most keywords per GET, and per ad in `custom_keyword`) |

`config.json` is gitignored, so the flag is normally set through the environment. Without a dedicated `database`, keywords land in the default database (`pas_competitors` locally) — set one before real use.

## Files

Backend (`pas_node_api`)
- `src/services/google/controllers/customKeywordsController.js` — upload, sample, list, and the scraper GET and POST (new)
- `src/services/google/routes/googleRoutes.js` — 4 routes
- `src/services/google/insertion/normalize.js`, `repository.js`, `metaAdsPipeline.js` — tag, SQL merge, ES write
- `src/services/google/builders/GoogleSearchQueryBuilder.js`, `controllers/adSearchController.js` — search OR clause
- `src/services/sdui/services/sduiService.js`, `seed/sduiConfig.json` — SDUI fix and seed
- `src/services/common/controllers/keywordAdNotificationController.js` — `notifyCustomKeywordScraped` (bell + push; the existing logic is untouched)
- `src/config/index.js`, `package.json` (`exceljs ^4.4.0`), `scripts/google_ads_data_v2.mapping.json`
- `scripts/apply-custom-keywords-schema.js` — ES mapping + SQL column (new)

Frontend (`new-ui-react`)
- `src/components/ads/AdFilterBar.jsx` — SDUI-driven button and the dialog: two sample downloads, a click-or-drag upload area with one row per file (name, size, progress bar, Complete / Failed + Try again) and, per uploaded file, each keyword marked Added to DB / Duplicate / Invalid / Not added; and "My keywords": saved keywords shown as "Added to DB" (no pending / scraping / done words), the top 5 first, "Show all N" opens them in a scrolling list, "Load more" fetches 100 at a time (hundreds of keywords are fine)
- `src/components/layout/Header.jsx`, `ads/AdGrid.jsx` — pass `onSearch` to the filter bar
- `src/services/api.js` — `downloadCustomKeywordSample(format)`, `uploadCustomKeywordsFile(file, onProgress)` (XMLHttpRequest when a progress callback is given), `fetchMyCustomKeywords`, `getCustomKeywordAccess`

Tests: `tests/services/google/customKeywords.test.mjs` (20), `tests/services/sdui/services/sduiService.test.mjs`, `new-ui-react/tests/components/ads/AdFilterBar.test.jsx`.

## Deploy checklist

1. `npm install` on every server (adds `exceljs`).
2. ES mapping: `node scripts/apply-custom-keywords-schema.js --apply --only=es`
3. SQL column, in a quiet window: `... --apply --only=sql` (needs MySQL >= 8.0.12, refuses MariaDB; uses `ALGORITHM=INSTANT`). The script is a dry run without `--apply`, and safe to run twice.
4. Add the `custom_keyword` SDUI document (above).
5. Turn on `customKeywords.enabled`, set `allowedUserIds` (for example `["72479"]`; leave `[]` for everyone) and restart the backend.
6. Brief the scraper team: fetch with `GET /scraper/keywords` (any `size`, or `keyword=`), report each with `POST /scraper/results`, and send `custom_keyword` as a list (only) on every ad scraped for them.
7. Deploy the frontend.

## Test it locally

Start the backend with `CUSTOM_KEYWORDS_ENABLED=true` and `CUSTOM_KEYWORDS_DATABASE=pas_ck_dev`. The JWT is `authToken` in the browser's Local Storage after login.

```bash
B=http://localhost:3000/api/v1/google/custom-keywords
curl -H "Authorization: Bearer TOKEN" "$B/sample" -o sample.xlsx               # or "$B/sample?format=csv" -o sample.csv
curl -H "Authorization: Bearer TOKEN" -F "file=@sample.xlsx" "$B/upload"         # or file=@sample.csv
curl -H "Authorization: Bearer TOKEN" "$B?status=pending"
curl -H "x-scraper-name: scraper-1" "$B/scraper/keywords?size=5"                 # take 5
curl -H "x-scraper-name: scraper-1" -G "$B/scraper/keywords" --data-urlencode "keyword=gym bag"   # take one by name
curl -H "x-scraper-name: scraper-1" "$B/scraper/keywords?status=pending"          # look at the waiting ones
curl -X POST -H "x-scraper-name: scraper-1" -H "Content-Type: application/json" -d '{"results":[{"keyword":"gym bag","status":"done"}]}' "$B/scraper/results"
```

In PowerShell use `curl.exe` and write the body as `'{\"status\":\"done\"}'`.

## Verified so far

- Unit tests: 20 backend tests for this feature, plus the SDUI and frontend tests. Claim logic was also run with 25 parallel scrapers against a throwaway Mongo (no duplicate hand-outs).
- Read-only run against the running local backend: validation (400), auth (401), `/prev` and `/status` gone (404), SDUI document present and kept when scoped to Google or Facebook.
- Read-only search against dev ES with the flag on: same results as with it off (no custom ads exist yet).

## Not verified yet

- Upload and the scraper GET and POST against a real database, ad insertion writing the tag to SQL and ES, and the tag match in search (these write data).
- The upload and list routes with a real login token.
- The UI in a browser, the bell row appearing, and a real push arriving (tests use stand-ins for Mongo, SQL and Firebase).
- As of 2026-11-11 neither the ES mapping nor the SQL column exists on the shared dev server.

## Open points

- Access is per user id (`allowedUserIds`), not per plan. Say so if a plan-based rule is also wanted.
- Optional: let the scraper GET take `?user_id=` so a scraper can work for one user only.
- Notifications fire on `done` only. A "no ads found" message would need different bell wording ("New ads found for…" is fixed in the popup).
- Clicking a keyword in the dialog runs a normal keyword search, which is recorded like any typed keyword search.
