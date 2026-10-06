# ChatGPT Ads Built-With – Implementation Manifest

Built-with / outgoing scrape queue for ChatGPT Ads (platform 21). A worker **GETs** a batch
of ad landing URLs, detects the technologies on each site (e-commerce platform, analytics /
tracking, CMS, affiliate network), then **POSTs** the result back per ad.

Built with Facebook Built-With as the reference (`src/services/facebook/controllers/built-withController.js`)
and keeps the **same endpoint names, request fields and response messages**, so the existing
worker can be pointed at this network unchanged. Storage is reshaped for the ChatGPT Ads
split-table schema (`scripts/chatgptads/chatgptads_schema.sql`) — the same split LinkedIn uses.

---

## 0. Golden Rules

- **Same contract as Facebook.** Endpoint names, fields (`id`, `status`, `built_with`,
  `built_with_cms`, `built_with_analytics_tracking`, `affiliate_data`), status values and
  response messages match Facebook Built-With.
- **Config-driven connections.** MySQL, Elasticsearch and the ES index come from
  `networks.chatgptads` in config (via `service.db`), exactly like Facebook. Fallback index name:
  `chatgpt_search_mix`.
- **`id` is the internal `chatgptads_ad.id`** (also the ES doc `_id`), not the 12-digit `ad_id` string.
- **One built-with row per ad.** `chatgptads_ad_built_with` has `UNIQUE chatgptads_ad_id`; every
  write is an upsert, because the insertion pipeline never creates this row.
- **No auth.** Worker-facing, unauthenticated — same as Facebook.

---

## 1. Endpoints

Auto-mounted by `ServiceRegistry` under `/api/v1/chatgptads`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/chatgptads/built-with/getUrlsForOutgoingBuiltWith` | Lease up to 100 pending ads |
| POST | `/api/v1/chatgptads/built-with/updateOutgoingBuiltWithStatus` | Report the scrape result for one ad |

---

## 2. Files

| Facebook | ChatGPT Ads |
|---|---|
| `facebook/controllers/built-withController.js` | `chatgptads/controllers/built-withController.js` (new) |
| routes inside `facebook/routes/facebookRoutes.js` | `chatgptads/routes/chatgptadsBuiltWithRoutes.js` (new — own file so `chatgptadsRoutes.js` is untouched) |

Supporting changes:

| File | Change |
|---|---|
| `src/services/chatgptads/insertion/esDocBuilder.js` | `CARRY_OVER_KEYS` += `ecommerce_platform`, `funnel`, `affiliate_data` (see §6) |
| `scripts/chatgptads/chatgpt_search_mix.mapping.json` | 3 new keyword fields |
| `scripts/chatgptads/apply-chatgpt-built-with-es-mapping.js` | new — adds the 3 fields to the live index |
| `swagger.yml` | "ChatGPT Built-With" tag + 2 paths |

---

## 3. Status Values

Same values as every other network.

| Value | `chatgptads_ad.built_with_status` | `chatgptads_ad_built_with.affiliate_status` |
|---|---|---|
| `0` | pending (column default) | pending (column default) |
| `2` | processing — handed to a worker | processing |
| `1` | done, data found | affiliate network found |
| `3` | done, no data / failed | none found |

```
0 ──GET──▶ 2 ──POST status=1, data──▶ 1
           ├──POST status=1, empty──▶ 3
           └──POST status≠1─────────▶ 3
```

---

## 4. Data Flow

### GET `/built-with/getUrlsForOutgoingBuiltWith`

1. Select up to **100** ads, newest first:
   ```sql
   SELECT id, destination_url FROM chatgptads_ad
    WHERE built_with_status = 0
      AND destination_url IS NOT NULL AND TRIM(destination_url) <> ''
      AND LOWER(TRIM(destination_url)) NOT IN ('null','undefined')
    ORDER BY id DESC LIMIT 100
   ```
2. `chatgptads_ad.built_with_status = 2` for those ids.
3. `chatgptads_ad_built_with` is **not** touched — its row is created by the POST when the
   worker reports a result, so the table only holds real results (no empty placeholder rows).

Response:
```json
{
  "code": 200,
  "message": "outgoing/builtwith scrapping data ,fetched data in 0.0421 1st query 0.0180 2nd query  0.0231",
  "data": [ { "id": 63, "destination_url": "https://example.com/landing" } ]
}
```

| Code | When |
|---|---|
| 200 | batch returned, rows now processing |
| 400 | `No more urls available for outgoing/builtwith scrapping…` — queue empty |
| 402 | `Error Occured` — SQL error |
| 503 | SQL connection not available |

### POST `/built-with/updateOutgoingBuiltWithStatus`

Body (JSON; query-string values are also read, same as Facebook):

| Field | Required | Example |
|---|---|---|
| `id` | yes | `63` (internal `chatgptads_ad.id`) |
| `status` | yes | `1` = scraped OK; anything else = failed |
| `built_with` | no | `Shopify\|WooCommerce` |
| `built_with_analytics_tracking` | no | `Webflow\|Google Analytics` |
| `built_with_cms` | no | `WordPress` |
| `affiliate_data` | no | `ClickBank` |

Example:
```json
{ "id": "63", "built_with": "", "built_with_cms": "", "built_with_analytics_tracking": "Webflow", "affiliate_data": "", "status": "1" }
```

Steps:
1. `id` and `status` required → else `400 chatgptads ad id and status must be present`.
2. Ad must exist in `chatgptads_ad` → else `200` with `"built with updated": false` (same as Facebook).
3. **`status = 1`:**
   - Normalize the three built-with fields: trim, `''` → NULL, `||` → `|`. `affiliate_data`: `''` → NULL.
   - `built_with_status` = `1` if any of the three has a value, else `3`.
   - `affiliate_status` = `1` if `affiliate_data` has a value, else `3`.
   - Upsert `chatgptads_ad_built_with` (all four data fields + `affiliate_status`).
   - `UPDATE chatgptads_ad SET built_with_status = ?`.
   - Patch ES (see §6).
4. **any other status:** upsert `affiliate_status = 3`, set `built_with_status = 3`. No data stored, no ES write.

Response:
```json
{ "code": 200, "message": "BuiltWith Service status Updated ", "built with updated": true }
```
`built with updated` is `true` when MySQL inserted or changed a row. On SQL error:
`400 BuiltWith Service status Not Updated`.

---

## 5. Tables (DB from `networks.chatgptads.sql.database`, e.g. `pasdev_chat_ads`)

| Table | Columns used |
|---|---|
| `chatgptads_ad` | `id`, `destination_url`, `built_with_status` |
| `chatgptads_ad_built_with` | `chatgptads_ad_id`, `built_with`, `built_with_analytics_tracking`, `built_with_cms`, `affiliate_data`, `affiliate_status` |

Facebook also writes `built_with_date` and `clickbank_processed_date`; this table has no such
columns — `chatgptads_ad_built_with.updated_at` records the time instead.

---

## 6. Elasticsearch

- Index: `db.elastic.indexName` (config `networks.chatgptads.elastic.index`), fallback `chatgpt_search_mix`.
- After a `status = 1` POST, the doc is updated **by `_id` = `chatgptads_ad.id`** (no search; the
  insertion pipeline uses the same deterministic `_id`):

  | ES field | From (MySQL / payload) | Value |
  |---|---|---|
  | `ecommerce_platform` | `built_with` | split on `\|` → array, or null |
  | `funnel` | `built_with_analytics_tracking` | split → array, or null |
  | `affiliate_data` | `affiliate_data` | split → array, or null |

  `ecommerce_platform` / `funnel` are the same ES names YouTube and LinkedIn use.
  `built_with_cms` is not sent to ES (same as Facebook).
- **Arrays, not the pipe string** (differs from Facebook): the fields are `keyword` +
  `lowercase_normalizer`, so one technology is a cheap `term` filter instead of a wildcard.
- Best-effort: an ES error is logged
  (`Error Occured in function chatgptads updateOutgoingBuiltWithStatus elastic update`) and the
  SQL update still stands.
- **Carry-over:** the insertion pipeline (and the ES outbox job) rewrite the whole doc with
  `index()` when an ad is re-crawled. The 3 fields are in `esDocBuilder.CARRY_OVER_KEYS`, so they
  are read from the existing doc and kept.

### Mapping

Added to `chatgpt_search_mix.mapping.json` (used when the index is created fresh):
```json
"ecommerce_platform": { "type": "keyword", "normalizer": "lowercase_normalizer" },
"funnel":             { "type": "keyword", "normalizer": "lowercase_normalizer" },
"affiliate_data":     { "type": "keyword", "normalizer": "lowercase_normalizer" }
```

For the **existing live index**, run once (adds new fields only — non-destructive, no reindex;
fields that already exist are skipped):
```
node scripts/chatgptads/apply-chatgpt-built-with-es-mapping.js           # dry run, no connection
node scripts/chatgptads/apply-chatgpt-built-with-es-mapping.js --apply   # PUT _mapping
```
Until this is applied, the values are still stored in each doc's `_source` (the index is
`dynamic: false`) but are not searchable.

---

## 7. Differences vs Facebook Built-With

| Area | Facebook | ChatGPT Ads |
|---|---|---|
| Queue table | `facebook_ad_meta_data` | `chatgptads_ad` |
| Data table | same `facebook_ad_meta_data` row (UPDATE) | `chatgptads_ad_built_with` (upsert) |
| GET filter | `built_with_status = 0` | `built_with_status = 0` + usable `destination_url` |
| Date columns | `built_with_date`, `clickbank_processed_date` | none (`updated_at`) |
| ES doc lookup | search `facebook_ad.id`, update hit `_id` | update by `_id` = `chatgptads_ad.id` |
| ES field names | `facebook_ad_meta_data.built_with` / `.built_with_analytics_tracking` / `.affiliate_data` (dotted) | flat `ecommerce_platform` / `funnel` / `affiliate_data` |
| ES value shape | pipe string | keyword array |
| ES miss | returns `400 ad not found` | logged only |
| Routes | in main routes file | own file `chatgptadsBuiltWithRoutes.js` |

---

## 8. Config

| Setting | Key | Env |
|---|---|---|
| SQL | `networks.chatgptads.sql.*` | `CGA_SQL_*` |
| ES node / auth | `networks.chatgptads.elastic.*` | `CGA_ELASTIC_*` |
| ES index | `networks.chatgptads.elastic.index` | `CGA_ELASTIC_INDEX` |

---

## 9. Known Caveats

- **Stuck rows:** like Facebook, an ad at `built_with_status = 2` whose worker never POSTs stays
  at 2 — nothing re-queues it.
- **Carry-over timing:** the carry-over reads the existing ES doc by search; with the index's 30 s
  `refresh_interval`, a built-with patch made seconds before a re-crawl re-index may not be seen
  and would be dropped from ES (MySQL still has it).

---

## 10. Verification

- [x] New modules load (`node -e "require(...)"`).
- [x] `swagger.yml` parses.
- [ ] Apply the ES mapping script on the live index (run by the owner).
- [ ] GET against `pasdev_chat_ads` — rows flip to 2, built-with rows created with `affiliate_status = 2`.
- [ ] POST status 1 with data / with empty data / status 0 — check both tables and the ES doc.
- [ ] Re-crawl an ad after a built-with POST — ES fields survive.

---

## Document Version

- 2026-10-05 — initial implementation.
- 2026-10-06 — ES fields renamed: `built_with` → `ecommerce_platform`, `built_with_analytics_tracking` → `funnel` (MySQL columns unchanged).
