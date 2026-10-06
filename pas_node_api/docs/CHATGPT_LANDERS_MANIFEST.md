# ChatGPT Ads Landers – Implementation Manifest

Destination-lander scraping pipeline for ChatGPT Ads (platform 21). It is a worker queue:
the scraper **GETs** a batch of ads, opens each ad's `destination_url`, **uploads** the
screenshot / HTML zip to NAS, then **POSTs** the captured lander data back.

Built with Facebook Landers as the reference (`src/services/facebook/landers/*`) and keeps
the **same endpoint names and request/response contract**, so the existing scrapers can be
pointed at this network unchanged. The storage side is reshaped for the ChatGPT Ads schema
(`scripts/chatgptads/chatgptads_schema.sql`).

---

## 0. Golden Rules

- **Same contract as Facebook.** Endpoint names, multipart fields, `insertData` body shapes,
  validation rules and response messages match Facebook Landers.
- **Config-driven connections.** MySQL, Elasticsearch and the ES index come from
  `networks.chatgptads` in config (via `service.db`), exactly like Facebook. Nothing is
  hardcoded except the fallback index name `chatgpt_search_mix`.
- **One row per ad.** The lander is stored in `chatgptads_ad_landers` and its page text in
  `chatgptads_ad_html_lander_content` (both `UNIQUE chatgptads_ad_id`); a re-crawl overwrites
  them, so storage does not grow per crawl.
- **`ad_id` in the POSTs is the internal `chatgptads_ad.id`** — the `id` returned by the GET —
  not the extension's 12-digit `ad_id` string.
- **No auth.** Scraper-facing, unauthenticated — same as Facebook Landers.

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/chatgptads`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/chatgptads/landers/getAdwithCountryCode` | Lease up to 50 ads queued for lander scraping |
| POST | `/api/v1/chatgptads/landers/uploadFileToServer` | Upload lander screenshot and/or HTML zip to NAS |
| POST | `/api/v1/chatgptads/landers/insertHtmlRedirectCountry` | Store the scraped lander data |

---

## 2. Directory Layout (Mirrors Facebook Landers)

```
src/services/chatgptads/
├── routes/
│   └── chatgptadsLandersRoutes.js        # 3 routes + multer (media, zip) disk storage
├── controllers/
│   └── chatgptadsLandersController.js    # thin — delegates to the services
└── landers/
    ├── getAdsService.js                  # getAdwithCountryCode
    ├── uploadService.js                  # uploadFileToServer
    ├── insertHtmlService.js              # insertHtmlRedirectCountry
    └── repository.js                     # all SQL (one function per DB operation)
```

| Facebook | ChatGPT Ads |
|---|---|
| `facebook/routes/facebookLandersRoutes.js` | `chatgptads/routes/chatgptadsLandersRoutes.js` |
| `facebook/controllers/facebookLandersController.js` | `chatgptads/controllers/chatgptadsLandersController.js` |
| `facebook/landers/getAdsService.js` | `chatgptads/landers/getAdsService.js` |
| `facebook/landers/uploadService.js` | `chatgptads/landers/uploadService.js` |
| `facebook/landers/insertHtmlService.js` | `chatgptads/landers/insertHtmlService.js` |
| `facebook/landers/repository.js` | `chatgptads/landers/repository.js` |

Reused shared helpers:
- `src/insertion/helpers/nasClient.js` → `storeInNas()` (network slug `chatgptads` → NAS prefix `gpt`)
- `src/services/chatgptads/insertion/esDocBuilder.js` → `searchIdQuery()`, `firstHitId()`

---

## 3. Status Transitions (`chatgptads_ad.lander_status`)

| Value | Meaning | Set by |
|---|---|---|
| `0` | PENDING — not claimed yet (column default) | insertion |
| `2` | IN_PROCESSING — handed to a scraper | GET (ad present in ES) |
| `4` | SUCCESS — lander stored | POST insertHtmlRedirectCountry |
| `5` | NOT_FOUND — ad missing from ES, or destination gave no response | GET (ad absent from ES) / POST with `status=3` |

```
0 ──GET, in ES──▶ 2 ──insertHtml status 1/2──▶ 4
│                 └──insertHtml status 3────▶ 5
└──GET, not in ES──▶ 5
```

Stuck ads: when no `0` rows are left, the GET re-serves `2` rows whose `updated_at` is
before today, so an ad claimed by a crashed scraper is retried at most once per day.

---

## 4. Data Flow

### GET `/landers/getAdwithCountryCode`

1. Fetch up to **50** ads from `chatgptads_ad` with `lander_status = 0`, newest first, with
   their country names (`chatgptads_ad_countries` → `chatgptads_country_only`, `GROUP_CONCAT`).
   Ads with an unusable `destination_url` (NULL, blank, or the text `null` / `undefined`)
   are excluded.
2. If none → fallback to `lander_status = 2` with `updated_at < CURDATE()`.
3. Check every ad in ES in parallel (`term` on `id`, index from config).
   - present → `lander_status = 2`, `updated_at = NOW()`
   - absent → `lander_status = 5`
4. Resolve country names → ISO codes with the static name → ISO map shared with TikTok
   (`src/services/tiktok/helpers/countries.js`, `COUNTRY_LABEL_TO_ISO`) — no DB lookup.
   Case-insensitive; duplicates removed; a name not in the map is skipped.

Response:
```json
{
  "code": 200,
  "message": "Ads fetched successfully",
  "data": [
    { "id": 63, "ad_url": "123456789012", "iso": ["IN"], "destination_url": "https://example.com/offer" }
  ],
  "exe_time": 0.214
}
```

| Field | Value |
|---|---|
| `id` | internal `chatgptads_ad.id` — send this back as `ad_id` in the POSTs |
| `ad_url` | the ad's external `ad_id` string (kept under Facebook's field name; this network has no `ad_url` column) |
| `iso` | ISO codes of the ad's tracked countries |
| `destination_url` | URL to scrape |

Other responses: `400 No Ads found` (queue empty), `401 No Ads found` (SQL/ES unavailable or error).
If every ad was missing from ES the message is `Ads not found in Elastisearch` with `data: []`.

### POST `/landers/uploadFileToServer` (multipart)

| Field | Type | Notes |
|---|---|---|
| `ad_id` | text | internal `chatgptads_ad.id` |
| `country` | text | used in the file name |
| `status` | text | `1` → `BLACKHAT` folder, `2` → `WHITEHAT` folder; any other value → nothing uploaded |
| `media` | file | lander screenshot |
| `zip` | file | zipped lander HTML |

- File name base: `{ad_id}_{country}_{status}_{unix_ts}`; the zip gets a `_zip` suffix.
- Stored path example: `/pas-dev/stream/gpt/whiteHatAd/202610/63_in_2_1791193138_zip.zip`
  (`pas-prod` in production).
- Temp files written by multer (`<os tmp>/pas-chatgptads-landers`) are always deleted.

Response:
```json
{
  "code": 200,
  "message": "files are stored successfully",
  "image_path": "/pas-dev/stream/gpt/whiteHatAd/202610/63_in_2_1791193138.jpg",
  "html_path": "/pas-dev/stream/gpt/whiteHatAd/202610/63_in_2_1791193138_zip.zip"
}
```
Other responses: `404 no file found`, `400 Error occured in the function uploadFileToServer`.

### POST `/landers/insertHtmlRedirectCountry` (JSON)

Accepted body shapes (same as Facebook):
- `{ "ad_id": 63, "insertData": { ... } }`
- `{ "ad_id": 63, "insertData": [ { ... } ] }`
- `[ { "ad_id": 63, ... } ]`
- `{ "ad_id": 63, "country_iso": "...", ... }` (flat)

Validation (same rules as Facebook):

| Field | Rule |
|---|---|
| `ad_id` | required |
| `status` | required (`1` blackhat, `2` whitehat, `3` no response) |
| `crawled_by` | required, exactly `.net` or `python` |
| `country_iso`, `destinations`, `html_path`, `screen_shot`, `html_content` | key must be present; string or null |
| `domain_registered_date` | key must be present; may be null |
| `outgoing_url`, `redirects` | optional arrays |

Steps:
1. Ad must exist in ES (`term` on `id`), else `400`.
2. Validate, else `400` with a message naming the bad field.
3. `status = 3` → `lander_status = 5` only. Responds `200 Redirect status updated succesfully`,
   or `400 Redirect status updated previously` if no row changed.
4. Otherwise:
   1. Domain = hostname of the final URL in `destinations`, without `www.` (same rule as the
      insertion pipeline). Find-or-create it in `chatgptads_ad_domains` and set
      `domain_registered_date`. A blank date (`""`, `0`, `0000-00-00`) is stored as NULL and
      **never overwrites** a date already stored.
   2. Upsert `chatgptads_ad_landers` and `chatgptads_ad_html_lander_content`
      (`INSERT … ON DUPLICATE KEY UPDATE`).
   3. Set `lander_status = 4`.
   4. Update the ES doc (see §6). Responds `200 Destination Lander updated successfully`.

Payload → column mapping:

| Payload key | Column | Notes |
|---|---|---|
| `ad_id` | `chatgptads_ad_id` (both tables) | internal id |
| `html_path` | `chatgptads_ad_landers.html_path` | `''` → NULL |
| `html_content` | `chatgptads_ad_html_lander_content.html_content` | MEDIUMTEXT; `''` → NULL |
| `screen_shot` | `chatgptads_ad_landers.screenshot_url` | `''` → NULL |
| `outgoing_url` | `chatgptads_ad_landers.out_going_url` | JSON `[{start_url, destination_url, redirect_urls[]}]`; empty → NULL |
| `redirects` | `chatgptads_ad_landers.redirect_url` | JSON `[url, …]`; empty or `["NA"]` → NULL |
| `crawled_by` | `chatgptads_ad_landers.scrapper_name` | `.net` / `python` |
| `domain_registered_date` | `chatgptads_ad_domains.domain_registered_date` | on the domain of `destinations`; blank → NULL, never overwrites a stored date |

`country_iso` and `destinations` are validated (contract parity) but not stored as columns —
`destinations` is only used to work out the domain.

Example body:
```json
{
  "ad_id": 63,
  "insertData": {
    "ad_id": 63,
    "status": "2",
    "crawled_by": "python",
    "country_iso": "IN",
    "destinations": "https://example.com/offer",
    "html_path": "/pas-dev/stream/gpt/whiteHatAd/202610/63_in_2_1791193138_zip.zip",
    "screen_shot": "/pas-dev/stream/gpt/whiteHatAd/202610/63_in_2_1791193138.jpg",
    "html_content": "Visible text of the lander page...",
    "domain_registered_date": null,
    "outgoing_url": [
      { "start_url": "https://example.com/go", "destination_url": "https://shop.example.com", "redirect_urls": ["https://trk.example.com"] }
    ],
    "redirects": ["https://trk.example.com/click", "https://example.com/offer"]
  }
}
```

---

## 5. Tables (DB from `networks.chatgptads.sql.database`, e.g. `pasdev_chat_ads`)

| Table | Used for |
|---|---|
| `chatgptads_ad` | queue source (`lander_status`, `destination_url`, `updated_at`) |
| `chatgptads_ad_countries` + `chatgptads_country_only` | ad's tracked country names |
| `chatgptads_ad_landers` | captured lander (html_path, screenshot, outgoing / redirect URLs, scraper), one row per ad |
| `chatgptads_ad_html_lander_content` | lander page text (`html_content`), one row per ad |
| `chatgptads_ad_domains` | `domain_registered_date` (column added 2026-10-05 — run the commented `ALTER` in `chatgptads_schema.sql` once on an existing DB) |

---

## 6. Elasticsearch

- Index: `db.elastic.indexName` (config `networks.chatgptads.elastic.index`), fallback `chatgpt_search_mix`.
- GET and insertHtml check the ad exists (`term: { id }`).
- After a successful insertHtml (status 1/2) the doc is updated **by `_id` = `chatgptads_ad.id`**
  (best-effort — an ES error is logged, MySQL still stands):

  | ES field | Value | Mapping |
  |---|---|---|
  | `domain_registered_date` | `yyyy-MM-dd`; only written when the crawl resolved a date | `date` |
  | `outgoing_source_url` | `start_url` of each outgoing link | `text` + `.keyword` |
  | `outgoing_redirect_url` | all `redirect_urls` of the outgoing links | `text` + `.keyword` |
  | `outgoing_final_url` | `destination_url` of each outgoing link | `text` + `.keyword` |
  | `redirect_url` | the `redirects` list (`["NA"]` → null) | `text` + `.keyword` |

  `html_content` is **not** sent to ES.
- These keys are in `esDocBuilder.CARRY_OVER_KEYS`, so an insertion re-index keeps them.
- The fields are in `chatgpt_search_mix.mapping.json`; on an existing index add them with
  `PUT <index>/_mapping` (adds fields only, no reindex).

---

## 7. Differences vs Facebook Landers

| Area | Facebook | ChatGPT Ads |
|---|---|---|
| Queue column | `facebook_ad_meta_data.redirect_status` | `chatgptads_ad.lander_status` |
| Success status | `1` (.net) / `4` (python) | always `4` |
| No-response status | `3` (.net) / `5` (python) | always `5` |
| `iso` source | discoverers' countries, else ad's countries | ad's tracked countries only (no discoverers table) |
| Lander storage | meta screenshot/zip lists, html_lander_content, ad_url, outgoing_links, domains | one row in `chatgptads_ad_landers` + page text in `chatgptads_ad_html_lander_content` |
| Domain upsert | `domain_registered_date` + `dod_date` + `facebook_ad.domain_id` | `domain_registered_date` only (no `dod_date` column; `domain_id` set by insertion) |
| Domain rule | regex on the last hostname | last hostname without `www.` (matches chatgptads insertion) |
| ES | existence check + patch `search_mix` (dotted, pipe-joined strings) | existence check + update by `_id` (flat fields, arrays) |
| Upload response | zip path overwrites `image_path` | `image_path` (screenshot) + `html_path` (zip) |
| Zip file name | same base as screenshot | `_zip` suffix |

---

## 8. Config

All from `src/config/networks.js` → `chatgptads.database` (overridable via config.json /
`CGA_*` env vars):

| Setting | Key | Env |
|---|---|---|
| SQL | `networks.chatgptads.sql.*` | `CGA_SQL_*` |
| ES node / auth | `networks.chatgptads.elastic.*` | `CGA_ELASTIC_*` |
| ES index | `networks.chatgptads.elastic.index` | `CGA_ELASTIC_INDEX` |
| NAS bucket / transport | `insertion.nas.*` (shared) | — |

---

## 9. Known Caveats

- **ISO map coverage.** `COUNTRY_LABEL_TO_ISO` covers the sovereign countries plus the common
  territories (Hong Kong, Taiwan, Puerto Rico, Macao/Macau, Kosovo, Palestine, …). A name still
  not in the map is skipped — add it there if one shows up.
- **Stuck-ad fallback uses `chatgptads_ad.updated_at`.** The insertion pipeline also bumps it
  when an ad is re-crawled, so a stuck ad may be skipped for that day.
- **Swagger:** documented under the **ChatGPT Landers** tag in `swagger.yml`.

---

## 10. Verification

- [x] All new modules load (`node -e "require(...)"`).
- [x] `swagger.yml` parses; the 3 paths are present.
- [ ] GET against `pasdev_chat_ads` + `chatgpt_search_mix`.
- [ ] Upload to NAS (status 1 and 2).
- [ ] insertHtml with status 1/2 (row upserted, `lander_status = 4`) and status 3 (`lander_status = 5`).
- [ ] insertHtml writes `domain_registered_date`; a later blank date keeps it.

---

## Document Version

- 2026-10-05 — initial implementation.
- 2026-10-05 — `domain_registered_date` stored on `chatgptads_ad_domains`.
