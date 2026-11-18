# Elasticsearch 6.8 + 9.5 (+ TikTok 8.0.2) – Dual-Version Compatibility

**Audience:** developers of `pas_node_api` who write or change any Elasticsearch call (API code or `scripts/`).
**Status:** done. Audit of every ES call in `pas_node_api` (`src/`, `scripts/`, `tests/`, root files) on 2026-11-18. All fixes below are in place. They were checked offline only (syntax + stubbed requests); nothing has been run against ES or MySQL yet.
**Related:** [ES_9.5_CODE_CHANGES_SUMMARY.md](ES_9.5_CODE_CHANGES_SUMMARY.md) (what had to change for 9.5)

---

## 1. Key message

The same code runs against **ES 6.8** (old clusters), **ES 9.5** (upgraded clusters) and **ES 8.0.2** (TikTok). The client is `@elastic/elasticsearch` **9.5.1** for all three.

Version differences are handled **in one place**: [esVersionCompat.js](../src/database/esVersionCompat.js), wired in by [DatabaseManager.js](../src/database/DatabaseManager.js). Service code does not check versions itself. It calls the `db.elastic` wrapper the same way on every cluster.

> **Rule:** always use the wrapper (`db.elastic.search / count / get / index / update / delete / bulk / putMapping`).
> Use the raw client (`db.elastic.client.*`) only for APIs the wrapper does not have, and then follow §5.

---

## 2. How the compat layer works

At connect time `DatabaseManager` reads the cluster version (`esMajor`). The wrapper then does the following:

| Wrapper method | ES 6.8 (`esMajor <= 6`) | ES 9.5 | TikTok ES 8.0.2 |
|---|---|---|---|
| `search`, `count` | `type` dropped; `calendar_interval`/`fixed_interval` → `interval`; `docvalue_fields` get `format: use_field_mapping` | `type` dropped | `type` dropped |
| `get` | raw `GET /index/<type or _all>/id` | `type` dropped | `type` dropped |
| `index`, `update`, `delete` | raw typed URL; type = caller's `type` or read from the index mapping (`doc`) | `type` dropped | `type` dropped |
| `bulk` | `_type` added to every action line that lacks one | unchanged | unchanged |
| `putMapping` *(new)* | raw `PUT /index/_mapping/<type>` | `indices.putMapping`, `type` dropped | `indices.putMapping`, `type` dropped |

Connection: one transport for every cluster. There is no product check (6.8 sends no `x-elastic-product` header), and headers are plain `application/json` (6.8 and 8.x reject `compatible-with=9`).

**Why `type` has to be dropped:** client 9 has no `type` parameter. **Any unknown key is sent inside the request body**, so ES 9.5 returns:

```
x_content_parse_exception: [UpdateRequest] unknown field [type]
```

That was the Facebook lander insert error (ad `133849`). Old code that still passes `type: ES_DOC_TYPE` now works on every version without changes.

---

## 3. Helpers in `esVersionCompat.js`

| Helper | Use |
|---|---|
| `isLegacy(esMajor)` | `true` for ES 6.x |
| `stripType(params)` | removes a caller-supplied `type` |
| `toLegacySearch(params)` | 6.x search/count rewrite (see §2) |
| `legacyIndex / legacyGet / legacyUpdate / legacyDelete(client, params, options, cache)` | typed document requests for 6.x |
| `legacyPutMapping(client, params, options, cache)` | typed put-mapping for 6.x |
| `toLegacyBulk(client, params, cache)` | adds `_type` to bulk action lines |
| `compatClientOptions(esModule)` | **for scripts that build their own `new Client()`**: spread into the client options so it can connect to 6.8 / 8.x / 9.x |

---

## 4. What the audit found and fixed

### 4.1 Core (fixes every caller at once)

| Change | File |
|---|---|
| `type` dropped on 9.5 / 8.0.2 (all methods) and on 6.8 search/count | `DatabaseManager.js`, `esVersionCompat.js` |
| New wrapper method `putMapping` (main + TikTok adapters) | `DatabaseManager.js`, `esVersionCompat.js` |
| New `legacyPutMapping`, `compatClientOptions` | `esVersionCompat.js` |

These fixed without touching service code:
- **Lander inserts:** facebook, linkedin, gdn, google and youtube. Both the ad lookup (`search` with `type`) and the update.
- **OCR / OCB:** facebook, gdn and linkedin OCR, and youtube OCB.
- **Google insertion:** `metaAdsPipeline.js` (`type: 'doc'` on update).
- **ChatGPT backfill:** `elastic.index` with `type`.

### 4.2 Individual files

| File | Problem | Broke on | Fix |
|---|---|---|---|
| `src/services/common/services/updateDomainDateService.js` | camelCase `waitForCompletion`, `requestsPerSecond` (client 9 puts unknown keys in the body) | both | `wait_for_completion`, `requests_per_second` |
| `src/services/common/helpers/domainDateEsQueue.js` | same camelCase; `tasks.get({ taskId })` crashes; `.tasks` cleanup sent `type` through raw client | both / 6.8 | snake_case, `task_id`, `legacyDelete` on 6.x |
| `src/admin/liveWatcher.js` | `tasks.cancel({ taskId })` → `?taskId=` rejected | both | `task_id` |
| `src/services/admin_user_activity/controllers/searchIntelligenceController.js` | purge fallback called `indices.refresh` on the wrapper | both | uses `elastic.client` |
| `scripts/admob/apply-es-mapping.js`, `scripts/ai-meta/apply-es-mapping.js`, `scripts/apply-custom-keywords-schema.js`, `scripts/apply-google-transparency-es-mapping.js` | `client.indices.putMapping({ type })` puts `type` in the mapping body | 6.8 | `elastic.putMapping(params)` |
| `scripts/cancel-google-es-tasks.js` | `tasks.cancel({ taskId })` | both | `task_id` |
| `scripts/verify-domain-date-production-readiness.js` | own client could not connect to 6.8; camelCase; `taskId`; typed index/get/delete through raw client; 9.x reported as fail | 6.8 / both | `compatClientOptions`, snake_case, `task_id`, `legacy*` helpers on 6.x, 9.x = pass |
| `scripts/test-multi-advertiser-live.js` | own client could not connect to 6.8 | 6.8 | `compatClientOptions` |
| `compeitetor_analysis/core/Advertisers/advertiserService.js` (`getAdCount`, `getLCS`, monthly CTA) | `date_histogram` with `format: "MMMM"`: 6.8 (Joda) returns `"February"`, 9.5 (java.time) returns `"Feb"`. Code used `key_as_string` as the month key, so `monthCounts["Feb"]` became `NaN` → `null` and the Competitive Analysis charts showed 0 | 9.5 | new `bucketMonthName()` maps the label by its first 3 letters, falling back to `bucket.key` (epoch, +05:30). Query unchanged |

### 4.3 Checked and already correct on both versions

- **Total-hit counts:** every `hits.total` read handles both shapes (`number` on 6.8, `{ value }` on 9.5).
- **`track_total_hits`:** only `true`/`false` is used (6.8 does not accept a number).
- **Date histograms:**
  - all use `calendar_interval` through the wrapper, which rewrites it for 6.8;
  - `marketTrends.js` picks the key by `esMajor`;
  - TikTok (8.0.2) uses `calendar_interval`.
  - every other `format` is numeric only (`yyyy`, `yyyy-MM`, `yyyy-MM-dd`), so `key_as_string` is identical on both versions: all `adInsightsController.js` files, `chatgptads/helpers/insightsHelpers.js`, `marketTrends.js`, google `resolveInterval` (trends, keyword insight, advertiser profile) and `api_tiktok_nodejs/utils/elasticSearch.js`.
- **Version-aware helpers:**
  - `withEsType` in `addCategoryController` / `creativeScoreController` adds `type` only on 6.x;
  - copyright `_type` in bulk lines is added only on 6.x.
- **Raw bulk calls in scripts** add `_type` only on 6.x: delete-ads-by-year, delete-placeholder-media, delete-post-owner-ads, facebook backfill, built-with and country backfills.
- **Index creation scripts** use a typed mapping on 6.x and typeless on 9.x: admob rebuild, chatgpt, facebook backfill, verify script.
- **`getMapping` readers** handle both `mappings.doc.properties` and `mappings.properties`.
- **Delete-by-query limit:** `size` on 6.x, `max_docs` on 7+ (searchIntelligence purge, purge-old-activities-loop).
- **Scroll:** `scroll` / `clearScroll` use `scroll_id`.
- **Raw update/delete-by-query:** the native lander, delete-ads-by-year and purge scripts send no `type` and no camelCase.
- **Cluster / nodes / tasks / cat / getSettings / exists calls** work on both versions.
- **Painless:** `doc[...]` is guarded with `.size()`; no `getMillis()` or Joda date methods.
- **Removed or 7+-only syntax:** none used (`_term` order, `_uid`, `_id` sort, `_all`, `runtime_mappings`, `combined_fields`, `case_insensitive`, `script_score`, PIT, `cutoff_frequency`, `common`).

### 4.4 Not verified

- `scripts/repair-google-transparency-v2-missing.js` uses `mget` with `ids` and no type. ES 6.x is expected to accept this; it was not run.
- Out of scope: other services (`api_tiktok_nodejs`, `admin_panel_backend`, etc.). Only `pas_node_api` was audited in full. For `compeitetor_analysis` and `api_tiktok_nodejs`, only the date-histogram formats were checked.

---

## 5. Rules for new code

1. **Call the wrapper**, not `db.elastic.client`, for search/count/get/index/update/delete/bulk/put-mapping.
2. **Do not pass `type`.** If old code passes it, it is harmless (the wrapper handles it), but new code should not.
3. **Raw-client params are snake_case**: `task_id`, `wait_for_completion`, `requests_per_second`, `scroll_id`, `max_docs`, `retry_on_conflict`. Client 9 does **not** convert camelCase. An unknown key goes into the body (or the query string) and ES rejects it.
4. Transport options (`requestTimeout`, `maxRetries`) go in the **second argument**, never in the params object.
5. **Raw-client document calls on 6.x** (index/get/update/delete) need the typed URL. Use `esCompat.legacy*` when `esMajor <= 6`.
6. **Raw bulk on 6.x**: add `_type` only when `esMajor < 7` (9.5 rejects `_type`).
7. **Date histograms**: write `calendar_interval` / `fixed_interval` and send through the wrapper. Never write `interval` (removed in 8.0).
8. **Read totals both ways:** `typeof hits.total === 'object' ? hits.total.value : hits.total`.
9. **`track_total_hits`**: only `true`/`false`.
10. **Scripts with their own `new Client()`**: spread `compatClientOptions(require('@elastic/elasticsearch'))` into the options.
11. **Mappings / index creation**: on 6.x wrap properties in `{ doc: {...} }` (create) or use `elastic.putMapping` (update); typeless on 9.x.
12. **Date-histogram `format`: numeric patterns only** (`yyyy`, `yyyy-MM`, `yyyy-MM-dd`). Text patterns (`MMM`, `MMMM`, `EEE`, `EEEE`) give different `key_as_string` values on 6.8 and 9.5. If you need month or day names, build them in JS from `bucket.key` (epoch millis).
13. Avoid features that exist on only one version: `_id` sort/aggs (9.5 blocks them), PIT / `runtime_mappings` / `case_insensitive` / `combined_fields` (not in 6.8), `_term` order (removed).

---

## 6. Test after deploy

| What | How | Expect |
|---|---|---|
| Facebook lander insert | resend payload for ad `133849` | `Destination Lander updated successfully` |
| Other lander inserts | one payload each: linkedin, gdn, google, youtube | 200 |
| OCR / OCB updates | facebook, gdn, linkedin OCR; youtube OCB | 200 |
| Domain date | one sync update + one queued update | dates updated in ES |
| Live Watcher | cancel an ES task from the admin panel | task cancelled |
| Mapping scripts | dry run first (no `--commit`) on each cluster | no errors |
| Competitive Analysis charts | open a project comparison (e.g. Flipkart vs Bigbasket); check `get-ad-count` / `get-lcs` responses | full month keys only (`February`), no `Feb` / `null` values; bars shown |

Run each test on a **6.8** cluster and on a **9.5** cluster.
