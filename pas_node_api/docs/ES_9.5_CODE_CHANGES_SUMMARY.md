# Elasticsearch 9.5 – Where the Code Must Change (Summary)

**Audience:** developers of `pas_node_api` and the other Node services that use Elasticsearch.
**Status:** analysis only – **no code has been changed yet**. Based on a scan of the repo on 2026-11-12; **re-checked after the latest pull** (§3 list corrected, Painless item removed).
**Related:** [ES_STAGE_F_APP_CHANGES_9.5.md](ES_STAGE_F_APP_CHANGES_9.5.md) (detailed app checklist) · [ES_UPGRADE_6.8_TO_9.5_COMPLETE_STEP_BY_STEP.md](ES_UPGRADE_6.8_TO_9.5_COMPLETE_STEP_BY_STEP.md) (cluster upgrade)

---

## 1. Key message

**The search queries themselves do not change.** `bool`, `must`, `filter`, `match`, `terms`, `range`, `nested`, aggregations, `collapse`, `sort` work the same on 9.5.

What changes is **how the code connects to, calls, and reads responses from** Elasticsearch, plus a few write calls that still send the old mapping type.

---

## 2. What must change

| # | Change | Where | Effort |
|---|---|---|---|
| 1 | **Connection: HTTPS + login + CA certificate** (9.5 only accepts `https://` with a user/API key) | `pas_node_api`: one place – [DatabaseManager.js](../src/database/DatabaseManager.js) `_getOrCreateEsClient` (lines ~344–364; already supports `auth`, needs `tls: { ca }`) + `.env`/config (`https://` host, `pas_app` user). Other services: their own client files (row 3) | Small |
| 2 | **Upgrade client to `@elastic/elasticsearch@9`** (the 7.17 client can't talk to 9.5) | `pas_node_api/package.json` (now `^7.17.14`), `api_tiktok_nodejs` (now `^8.10.0`) | Small (package) |
| 3 | **Replace legacy `elasticsearch@16` client** (not supported on 8.x/9.x) | `advertiser_analysis_nodejs/utils/Elasticsearch.js`, `advertiser_analysis_nodejs/core/Advertisers/advertiserService.js`, `admin_panel_backend/es-connections/connection.js`, `compeitetor_analysis/utils/Elasticsearch.js`, `compeitetor_analysis/core/mailer/dataReportStatsService.js` | **Large** – every ES call in these 3 services |
| 4 | **Response shape:** new client returns the result directly → `res.body.hits` becomes `res.hits` | `.body.` read in **~45 files / ~64 places** in `pas_node_api/src` – mainly each network's `adSearchController.js`, `adCountController.js`, `adInsightsController.js`, plus `commonSearchController`, `creativeScoreController`, `searchIntelligence*`, `userActivityController`, `esConcurrency.js`, `youtubeDisplayMerge.js`, `aiMetaSearchFilter.js`. Some already handle both shapes | **Medium/large** |
| 5 | **Request shape:** `client.search({ index, body: { query } })` → `client.search({ index, query })` (`body:` deprecated since client v8) | `body: {` in **~170 files** in `pas_node_api/src` (most are ES calls; some are HTTP route bodies) | **Large but mechanical** – the query inside stays the same |
| 6 | **Remove `type: 'doc'`** – types don't exist since 8.x; writes with a type **fail** | **76 places in 61 files** in `src` + 4 scripts – almost every network's insertion pipeline, `esDocBuilder`, `deletePipeline`, `built-withController`, OCR and lander service (see §3). They all go through the `DatabaseManager` wrapper, so the wrapper can drop `type` centrally | **Large** by hand / **small** via the wrapper |
| 7 | **`include_type_name`** removed | `src/services/quora/insertion/quoraAdsPipeline.js` | 1 place |
| 8 | **Version branches (`esMajor`)** – the code already detects the ES version (~67 files, e.g. "send `_type` only if ES < 8") | Already handled ✅ – check no branch assumes only 6/7/8 (e.g. `esMajor === 8`) | Check only |
| 9 | **Totals stop at 10,000** unless `track_total_hits: true` | Most count/insights/search builders already send it ✅. Check screens that show totals without it; read `hits.total.value` (e.g. `searchIntelligenceHelpers.js`, `creativeScoreController.js`) | Small |
| 10 | **Painless scripts** (`doc['field'].value` throws on missing fields since 7.x) | Checked: the only search script (`esQueryHelpers.js` `termFilterCI`) already has `doc[params.f].size() == 0` guard ✅; the other scripts are `ctx._source` update scripts (addCategory, domain date, interestBehaviour, google custom_keyword, native landers) – fine on 9.5 ✅ | None |
| 11 | **Index and alias names** | **No change** – same names, `_write` aliases recreated on 9.5 | – |

---

## 3. Hard-coded `type: 'doc'` (row 6)

Search pattern: `\btype:\s*['"]_?doc['"]` (plus `_type:` in bulk lines and `include_type_name`).
**Result after the latest pull: 76 occurrences in 61 files under `src/`, plus 4 scripts.** All are **unconditional** (sent regardless of ES version) – e.g. `facebook/insertion/esDocBuilder.js` returns `{ index, type: 'doc', body }`.

| Area | Files (under `src/services/` unless noted) |
|---|---|
| Insertion – doc builders | `facebook`, `google`, `gdn`, `youtube`, `linkedin`, `instagram`, `pinterest`, `native`, `quora`, `chatgptads` → `insertion/esDocBuilder.js` |
| Insertion – pipelines | `facebook/insertion/metaAdsPipeline.js`, `facebook/insertion/adsLibraryPipeline.js`, `google/insertion/metaAdsPipeline.js`, `gdn/insertion/metaAdsPipeline.js`, `youtube/insertion/metaAdsPipeline.js`, `linkedin/insertion/metaAdsPipeline.js`, `instagram/insertion/gramAdsPipeline.js`, `instagram/insertion/adsLibraryPipeline.js`, `pinterest/insertion/insertPinterestAdPipeline.js`, `native/insertion/insertNativeAdPipeline.js`, `chatgptads/insertion/chatgptadsPipeline.js`, `google/transparencyInsertion/pipeline.js` |
| Delete pipelines | `facebook`, `google`, `gdn`, `youtube`, `linkedin`, `instagram`, `pinterest`, `native`, `chatgptads` → `insertion/deletePipeline.js`; `chatgptads/jobs/chatgptadsEsOutboxJob.js` |
| Built-with controllers | `facebook`, `google`, `gdn`, `youtube`, `linkedin`, `instagram`, `pinterest`, `native`, `reddit`, `quora`, `chatgptads` → `controllers/built-withController.js` |
| OCR / media | `native`, `reddit`, `pinterest`, `quora` → `ocr/services/updateImageOcrService.js`; `instagram/ocr/services/updateImageDetailsService.js`; `quora/controllers/updateNasImageController.js`; `common/services/updateAdMediaService.js`; `src/insertion/helpers/nasDownloadQueue.js` |
| Landers | `reddit`, `pinterest`, `quora` → `landers/insertHtmlService.js`; `chatgptads/landers/insertHtmlService.js`; `instagram/landers/insertHtmlContentService.js`; `google`, `youtube`, `linkedin` → `landers/getAdsService.js` |
| Other | `frontend_user_activity/controllers/userActivityController.js` (3), `imageGen/helpers/adResolver.js` |
| Scripts | `scripts/ai-meta/apply-es-mapping.js`, `scripts/audit-google-transparency-read-paths.js`, `scripts/diagnose-google-transparency-ad.js`, `scripts/repair-google-transparency-v2-missing.js` (also `_type` in bulk lines) |

Already version-aware ✅: `scripts/backfill-facebook-instagram-country-es-resumable.js` and `scripts/backfill-built-with-es-sync.js` add `_type` only when `esMajor === 6`.

Because these calls go through the `DatabaseManager` wrapper (`db.elastic.index/update/delete/get/search`), **dropping `type` once in the wrapper fixes all of them** – the strongest argument for the wrapper approach (§6.1). Scripts that create their own client still need individual fixes.

Bulk requests: drop `_type` from action lines (`{ index: { _index, _id } }`).

---

## 4. What does NOT need to change ✅

- Query DSL (`bool`, `match`, `terms`, `range`, `nested`, aggregations, `collapse`, `sort`).
- Index names and `_write` aliases.
- Date formats (`yyyy-MM-dd HH:mm:ss`, `epoch_second`).
- No queries sort or aggregate on `_id` (checked).

---

## 5. Code patterns not accepted by 9.5 (before → after)

What our code does **today**, what happens on **9.5** (or with the 9.x client it requires), and the correct form.

### ❌ 5.1 Old client libraries – cannot connect

| We use now | On 9.5 | Must become |
|---|---|---|
| `@elastic/elasticsearch@7.17` (`pas_node_api`) | Not compatible with a 9.x server | `@elastic/elasticsearch@9` |
| legacy `elasticsearch@16` (`advertiser_analysis_nodejs`, `admin_panel_backend`, `compeitetor_analysis`) | Not supported since 8.x | Rewrite on `@elastic/elasticsearch@9` |
| `@elastic/elasticsearch@8` (`api_tiktok_nodejs`) | Works, but behind the server | Upgrade to `@9` |

### ❌ 5.2 Connecting without HTTPS and login

```js
// now (DatabaseManager / .env)
node: 'http://<host>:9200'          // no tls, maybe no auth
```

**On 9.5:** connection refused – only `https://` with a user/API key is accepted.

```js
// 9.5
node: 'https://<host>:9200',
auth: { username: 'pas_app', password: '…' },
tls:  { ca: fs.readFileSync('http_ca.crt') }
```

**Where:** [DatabaseManager.js](../src/database/DatabaseManager.js) (`_getOrCreateEsClient`) + `.env`; each legacy service's client file.

### ❌ 5.3 Mapping type `type: 'doc'` / `'_doc'` in calls

```js
// now
await elastic.update({ index, type: 'doc', id, body: { doc } });
await elastic.delete({ index: ES_INDEX, type: 'doc', id });
await elastic.search({ index, type: 'doc', body: { query } });
```

**On 9.5:** error – types were removed in 8.x; typed URLs (`/index/doc/…`) don't exist.

```js
// 9.5
await elastic.update({ index, id, doc });
await elastic.delete({ index: ES_INDEX, id });
await elastic.search({ index, query });
```

**Where:** see §3.

### ❌ 5.4 `_type` in bulk action lines

```js
// now
{ index: { _index: 'search_mix', _type: 'doc', _id: '123' } }
```

**On 9.5:** error (`_type` not allowed).

```js
// 9.5
{ index: { _index: 'search_mix', _id: '123' } }
```

**Where:** bulk builders that still add `_type` (some already add it only when `esMajor < 8` ✅).

### ❌ 5.5 `include_type_name`

```js
// now
await elastic.indices.getMapping({ index, include_type_name: true });
```

**On 9.5:** error – *"unrecognized parameter"*.

```js
// 9.5
await elastic.indices.getMapping({ index });   // response has no type level
```

**Where:** `src/services/quora/insertion/quoraAdsPipeline.js` (line ~536).

### ❌ 5.6 Reading `res.body` (with the new client)

```js
// now
const hits = res.body.hits;
```

**With the 9.x client:** `res.body` is `undefined` → crash or empty results.

```js
// 9.5 client
const hits = res.hits;
```

**Where:** ~45 files (each network's search/count/insights controllers, common and search-intelligence helpers). The wrapper approach (§6.1) avoids editing these.

### ⚠️ 5.7 `body:` wrapper in requests (with the new client)

```js
// now
client.search({ index, body: { query, size, aggs } });
client.index({ index, id, body: doc });
client.bulk({ body: lines });
```

**With the 9.x client:** `body` style deprecated since v8, and the field name differs per method.

```js
// 9.5 client
client.search({ index, query, size, aggs });
client.index({ index, id, document: doc });
client.bulk({ operations: lines });
```

| Method | Old | New |
|---|---|---|
| `search`, `count` | `body: { query, aggs, size, … }` | top-level `query`, `aggs`, `size`, … |
| `index` | `body: doc` | `document: doc` |
| `update` | `body: { doc / script / upsert }` | top-level `doc` / `script` / `upsert` |
| `bulk` | `body: lines` | `operations: lines` |

**Where:** ~170 files (mechanical; the query inside stays the same) – or the wrapper (§6.1).

### ⚠️ 5.8 `hits.total` read as a number

```js
// old 6.x assumption
const total = res.hits.total;            // number on 6.x
```

**On 9.5:** object `{ value: 10000, relation: "gte" }` → `[object Object]`/NaN, and capped at 10,000.

```js
// 9.5
const total = res.hits.total.value;       // + track_total_hits: true where exact totals are shown
```

**Where:** most controllers already handle both ✅; check `searchIntelligenceHelpers.js`, `creativeScoreController.js`.

### ✅ 5.9 Painless scripts – checked, no change needed

On 7.x+, `doc['field'].value` throws for documents without that field. Our code is already safe:

- The only search-time script, `src/services/common/helpers/esQueryHelpers.js` (`termFilterCI`), checks `doc[params.f].size() == 0` first.
- All other scripts are `ctx._source` **update** scripts (addCategory, domain-date, interestBehaviour, google `custom_keyword`, native landers) – unaffected.
- (The `doc['user.id']` lines in `userActivityController.js` are plain JavaScript object access, not Painless.)

Optional improvement on 9.5: `termFilterCI` could become a `term` query with `case_insensitive: true` (available since 7.10) – faster than a script. Not required.

### Summary

| Type of change | Blocking on 9.5? | Size |
|---|---|---|
| 5.1 Old client libraries | ❌ Blocking | 5 services |
| 5.2 http / no login | ❌ Blocking | Config + 1 central file (+ legacy services) |
| 5.3 `type: 'doc'` | ❌ Blocking (writes, some searches) | **61 files / 76 places** + 4 scripts (or wrapper) |
| 5.4 `_type` in bulk | ❌ Blocking | Few builders |
| 5.5 `include_type_name` | ❌ Blocking | 1 place |
| 5.6 `res.body` | ❌ Blocking with new client | ~45 files (or wrapper) |
| 5.7 `body:` wrapper | ⚠️ Deprecated – move | ~170 files (or wrapper) |
| 5.8 `hits.total` as number | ⚠️ Wrong values | Few places |
| 5.9 Painless scripts | ✅ Already safe | None |

---

## 6. Proposed approach (not implemented – for team decision)

### 6.1 `pas_node_api`: adapt the central wrapper

Almost every ES call in `pas_node_api` goes through **one wrapper** in [DatabaseManager.js](../src/database/DatabaseManager.js) (`_connectElastic`, lines ~387–407: `get`, `search`, `analyze`, `count`, `index`, `update`, `delete`, `bulk`).

Changing only that wrapper to:

1. **Move `body: {…}` to the top level** of the request (e.g. `{ index, body: { query, size } }` → `{ index, query, size }`; for `index`: `body` → `document`; for `update`: `body.doc` → `doc`; for `bulk`: `body` → `operations`).
2. **Drop `type`** from every request.
3. **Return the response in the old shape** `{ body: response }` so existing `res.body.…` code keeps working.

would make rows 4–6 work for most of `pas_node_api` **without editing the ~170 controller files**. Calls that use `db.elastic.client` directly (bypassing the wrapper) still need individual changes – find them with a search for `.client.`.

Pros: small, central, low risk, easy to test and roll back.
Cons: keeps the old `res.body` style in the codebase (can be cleaned up gradually later).

### 6.2 `api_tiktok_nodejs`

Client v8 → v9: mostly the same API; check `body:` usage and connection settings (row 1).

### 6.3 The three legacy services

`advertiser_analysis_nodejs`, `admin_panel_backend`, `compeitetor_analysis` – rewrite their ES client modules on `@elastic/elasticsearch@9`. Option: give each a small wrapper with the same idea as 6.1 so their callers change as little as possible.

---

## 7. Test plan (on the 9.5.5 practice cluster first)

1. Connect with `pas_app` over HTTPS with `http_ca.crt`.
2. Every network: search, filters, counts, insights, ad detail, landers, export.
3. Insert one test ad per pipeline → appears in search → delete it.
4. OCR / media / domain-date updates on one document.
5. Admin panel, advertiser analysis, competitor analysis.
6. Kibana → Upgrade Assistant → **Address API deprecations**: should show no calls from the app.
7. Restart jobs one network at a time.

---

## 8. Open decisions

- [ ] Wrapper approach (§6.1) vs. updating each call site.
- [ ] Password user (`pas_app`) or API key for the app.
- [ ] Order: `pas_node_api` first, then the three legacy services.
- [ ] Owners and timeline for each service.
