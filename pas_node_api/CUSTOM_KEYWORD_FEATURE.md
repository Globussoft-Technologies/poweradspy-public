# Custom Keyword (Google) — feature notes

Status: code complete, **off by default**. Not yet merged or deployed. Last updated 2026-11-11.

## What it does

A user uploads a sheet (.csv or .xlsx) of their own keywords. A scraper works through them, scrapes Google ads for each keyword and stores the ads in SQL and Elasticsearch. When the user searches that keyword, they see the normal ads **plus their own scraped ads**. Nobody else sees those ads.

- Google only. New ads only (no backfill).
- User-specific: ownership and visibility are per user. Only the scraper work queue is shared.

## Flow

```
USER                                   SCRAPER                                  SEARCH
1. Custom Keyword button (SDUI)        4. POST /custom-keywords/next            8. user types a keyword in the
2. download sample (.xlsx or .csv)       -> keyword + userId + left/total         normal Keyword search (Google tab)
3. upload filled sheet                 5. scrape Google for the keyword         9. query = normal match
   -> Mongo, owner = id from JWT       6. POST /insertion/gtAdsData                 OR tag "<token user id>:<keyword>"
                                          + custom_keyword                     10. user sees normal + own ads
                                          + custom_keyword_user_id
                                       7. POST /next {"status":"done"} -> next
```

The tag stored with every custom ad is `"<userId>:<normalized keyword>"`, for example `281:nike shoes`. The user id is what keeps two users' ads apart, including when both upload the same keyword.

Normalization: `|` becomes a space, then trim, collapse spaces, lower-case.

## APIs (base `/api/v1/google/custom-keywords`)

Everything returns **503** while `customKeywords.enabled` is false.

**Who gets it (`customKeywords.allowedUserIds`)** — same contract as `imageGen` / `chatgptads`:
- `enabled` false → nobody.
- `enabled` true, `allowedUserIds` empty → every logged-in user.
- `enabled` true, `allowedUserIds` has ids → **only those user ids**: the button shows only for them, the user routes answer a plain **404** to everyone else, their keyword search gets the own-ads clause only if they are on the list, and `/next` hands out only keywords owned by listed users.

### User (header `Authorization: Bearer <JWT>`; the user id always comes from the token)

| Call | Purpose |
|---|---|
| `GET /access` | Whether this user gets the feature: `{ data: { enabled: true|false } }`. The frontend reads it to show or hide the button. Needs only the login token. |
| `GET /sample?format=xlsx\|csv` | Download the sample: `.xlsx` (default; sheet `Keywords`, column `keyword`, plus an `Instructions` sheet) or `.csv` (UTF-8, header `keyword`). Any other `format` is a 400. |
| `POST /upload` | multipart field `file`: **`.csv` or `.xlsx` only** (first sheet, header `keyword`, case-insensitive). CSV may be comma, semicolon or tab separated and may start with a BOM. Any other type gets a 400 with a clear message (`.xls` is told to save as `.xlsx` or `.csv`). Returns `received`, `added`, `duplicates`, `invalid[]` (row + reason), `notAddedOverLimit` |
| `GET /?page=&page_size=&status=&q=` | The caller's own keywords, with status and counts |

### Scraper (no JWT; header `x-scraper-name`)

The header name is `config.keywordSearch.scraperHeader` (default `x-scraper-name`), or `scraper` in the body — the same identity the existing `keyword-search/work` uses.

`POST /next` — the only scraper call. It closes the keyword this scraper holds, then hands out the next one.

Body (optional): `{ "status": "done" | "no_ads_found" | "failed", "error": "reason" }`. Default is `done`.

```json
{
  "code": 200,
  "message": "claimed",
  "scraper": "scraper-1",
  "closed": { "id": "…", "keyword": "nike shoes", "status": "done" },
  "data": { "id": "…", "keyword": "yoga mat", "userId": 281, "attempt": 1 },
  "left": 11,
  "total": 40
}
```

When nothing is left: `message: "no pending keywords"`, `data: null`, `left: 0`.
`left` = keywords still pending (not counting the one just handed out). `total` = all keywords of all users.

Rules:
- A failed keyword goes back to `pending` and is retried after `retryDelayMinutes`, up to `maxAttempts`, then it becomes `failed`.
- A keyword `in_progress` for more than `staleClaimMinutes` is handed to another scraper (no cron).
- A scraper can only close a keyword it still owns.
- Status lifecycle: `pending` → `in_progress` → `done` | `no_ads_found` | `failed`.

### Insertion (existing `POST /api/v1/google/insertion/gtAdsData`, existing auth)

Add two fields to every ad scraped for a custom keyword, copied from `/next` (`data.keyword`, `data.userId`):

```json
{ "custom_keyword": "yoga mat", "custom_keyword_user_id": 281 }
```

Ordinary ads omit both and behave exactly as before. A bad or missing id means no tag is written (the ad is still inserted).

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

`config.json` is gitignored, so the flag is normally set through the environment. Without a dedicated `database`, keywords land in the default database (`pas_competitors` locally) — set one before real use.

## Files

Backend (`pas_node_api`)
- `src/services/google/controllers/customKeywordsController.js` — upload, sample, list, `/next` (new)
- `src/services/google/routes/googleRoutes.js` — 4 routes
- `src/services/google/insertion/normalize.js`, `repository.js`, `metaAdsPipeline.js` — tag, SQL merge, ES write
- `src/services/google/builders/GoogleSearchQueryBuilder.js`, `controllers/adSearchController.js` — search OR clause
- `src/services/sdui/services/sduiService.js`, `seed/sduiConfig.json` — SDUI fix and seed
- `src/config/index.js`, `package.json` (`exceljs ^4.4.0`), `scripts/google_ads_data_v2.mapping.json`
- `scripts/apply-custom-keywords-schema.js` — ES mapping + SQL column (new)

Frontend (`new-ui-react`)
- `src/components/ads/AdFilterBar.jsx` — SDUI-driven button and the dialog: two sample downloads, a click-or-drag upload area with one row per file (name, size, progress bar, Complete / Failed + Try again), and the keyword list
- `src/components/layout/Header.jsx`, `ads/AdGrid.jsx` — pass `onSearch` to the filter bar
- `src/services/api.js` — `downloadCustomKeywordSample(format)`, `uploadCustomKeywordsFile(file, onProgress)` (XMLHttpRequest when a progress callback is given), `fetchMyCustomKeywords`, `getCustomKeywordAccess`

Tests: `tests/services/google/customKeywords.test.mjs` (20), `tests/services/sdui/services/sduiService.test.mjs`, `new-ui-react/tests/components/ads/AdFilterBar.test.jsx`.

## Deploy checklist

1. `npm install` on every server (adds `exceljs`).
2. ES mapping: `node scripts/apply-custom-keywords-schema.js --apply --only=es`
3. SQL column, in a quiet window: `... --apply --only=sql` (needs MySQL >= 8.0.12, refuses MariaDB; uses `ALGORITHM=INSTANT`). The script is a dry run without `--apply`, and safe to run twice.
4. Add the `custom_keyword` SDUI document (above).
5. Turn on `customKeywords.enabled`, set `allowedUserIds` (for example `["72479"]`; leave `[]` for everyone) and restart the backend.
6. Brief the scraper team: use `/next`, send `custom_keyword` and `custom_keyword_user_id` on every ad.
7. Deploy the frontend.

## Test it locally

Start the backend with `CUSTOM_KEYWORDS_ENABLED=true` and `CUSTOM_KEYWORDS_DATABASE=pas_ck_dev`. The JWT is `authToken` in the browser's Local Storage after login.

```bash
B=http://localhost:3000/api/v1/google/custom-keywords
curl -H "Authorization: Bearer TOKEN" "$B/sample" -o sample.xlsx               # or "$B/sample?format=csv" -o sample.csv
curl -H "Authorization: Bearer TOKEN" -F "file=@sample.xlsx" "$B/upload"         # or file=@sample.csv
curl -H "Authorization: Bearer TOKEN" "$B?status=pending"
curl -X POST -H "x-scraper-name: scraper-1" -H "Content-Type: application/json" -d '{"status":"done"}' "$B/next"
```

In PowerShell use `curl.exe` and write the body as `'{\"status\":\"done\"}'`.

## Verified so far

- Unit tests: 20 backend tests for this feature, plus the SDUI and frontend tests. Claim logic was also run with 25 parallel scrapers against a throwaway Mongo (no duplicate hand-outs).
- Read-only run against the running local backend: validation (400), auth (401), `/prev` and `/status` gone (404), SDUI document present and kept when scoped to Google or Facebook.
- Read-only search against dev ES with the flag on: same results as with it off (no custom ads exist yet).

## Not verified yet

- Upload and `/next` against a real database, ad insertion writing the tag to SQL and ES, and the tag match in search (these write data).
- The upload and list routes with a real login token.
- The UI in a browser.
- As of 2026-11-11 neither the ES mapping nor the SQL column exists on the shared dev server.

## Open points

- Access is per user id (`allowedUserIds`), not per plan. Say so if a plan-based rule is also wanted.
- Optional: let `/next` take `?user_id=` so a scraper can work for one user only.
- Clicking a keyword in the dialog runs a normal keyword search, which is recorded like any typed keyword search.
