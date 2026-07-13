# AI-Meta ES Mapping — Apply Runbook

**Applies to:** `AI_META_API_PAYLOAD_SPEC.md` **v1.6** · **Companion:** `AI_META_API_IMPLEMENTATION.md`
**Goal:** create the `ai` object mapping on every network's `*_search_mix` (or ads) index **before** the
DS pipeline starts POSTing AI-Meta, so filters/aggregations on `ai.*` work correctly.

**This mapping is designed to be:**
- **Fast** — every categorical field is a `keyword` (doc-values, exact filter + aggregation); no
  analyzed text where we only ever filter. Optional `eager_global_ordinals` for the hottest facets (§2.2).
- **Autocomplete-ready** — `offering` carries a **`completion`** sub-field (FST-backed type-ahead — the
  fast option that needs **only a mapping add**, no custom analyzer, no index-settings change, works on
  ES 6.8 *and* 8.x).
- **Fuzzy-ready** — `offering`, `caption`, `roa.*` are `text`, so typo-tolerant `match` queries with
  `fuzziness:"AUTO"` work with zero extra mapping (§2.1).
- **Idempotent / reuse-first** — we only ever `PUT <index>/_mapping` (which **reuses the existing
  index** and merges fields); we **never** `PUT <index>` (create). Re-running is a no-op `acknowledged`.
- **No reindex** — pure additive mapping on the live, open index.

> **You never applied the v1.1 mapping** — good. That means there is no legacy `ai` mapping to migrate;
> this is a **clean, additive** change. Adding a brand-new object field (and new sub-fields) to an
> existing index is a **non-breaking mapping update — NO reindex, no downtime, no data rewrite.** The
> only hard rule in Elasticsearch is: you may *add* fields freely, but you may not *change the type* of a
> field that already exists. `ai` doesn't exist yet, so we're only adding. (The one caveat — if some
> `ai` docs were already written and dynamically mapped — is handled in §5.)
>
> **Why not edge-ngram autocomplete?** An `edge_ngram` analyzer would need a custom analyzer in the
> index **settings**, and you cannot add analysis settings to an open index — it requires a close/open
> (brief index-wide unavailability) and only affects newly-indexed docs anyway. `completion` sub-fields
> give fast type-ahead with a **mapping-only** change (no close/open, no reindex), so we use those.

---

## 1. Why this must be done before the first write

If a document with an `ai` object is indexed **before** the explicit mapping exists, ES 6.8 **dynamically**
guesses the types, and the guesses are wrong for our use:

| Field | We want | Dynamic guess | Consequence if left wrong |
|---|---|---|---|
| `ai.colors` (`"#FFFFFF"`) | `keyword` | `text` + `.keyword` sub-field | can't do a clean exact-term/agg on the base field |
| `ai.offers.value` (`25`) | `float` | `long` | later a `12.5` value **fails to index** (type conflict) |
| `ai.offering_type` etc. | `keyword` | `text`+`keyword` | aggregations slower / on the wrong field |

Once a field is dynamically mapped, you **cannot** change its type in place — you'd have to reindex
(§5). So: **map first, write second.**

---

## 2. The mapping payload (v1.6)

One `properties.ai` block, identical across every network. This is the body you PUT (the enclosing
`PUT …/_mapping` differs per ES version — see §3).

```json
{
  "properties": {
    "ai": {
      "properties": {
        "ad_type":       { "type": "keyword" },
        "intent":        { "type": "keyword" },
        "hook":          { "type": "keyword" },
        "offering_type": { "type": "keyword" },
        "offers": {
          "properties": {
            "type":  { "type": "keyword" },
            "value": { "type": "float" }
          }
        },
        "colors":        { "type": "keyword" },
        "offering": {
          "type": "text",
          "fields": {
            "keyword": { "type": "keyword", "ignore_above": 256 },
            "suggest": { "type": "completion", "max_input_length": 200 }
          }
        },
        "caption": {
          "type": "text",
          "fields": { "keyword": { "type": "keyword", "ignore_above": 256 } }
        },
        "roa": {
          "properties": {
            "intent":        { "type": "text" },
            "hook":          { "type": "text" },
            "offering_type": { "type": "text" },
            "offering":      { "type": "text" }
          }
        },
        "category":       { "type": "keyword" },
        "category_id":    { "type": "keyword" },
        "sub_category":   { "type": "keyword" },
        "subcategory_id": { "type": "keyword" }
      }
    }
  }
}
```

**Not present** (removed — do NOT create these): `product_type`, `language`, `ocr`, `object`,
`brand_logos`, `status`, and — as of **v1.5** — `brand` and `celebrity`.

Design notes / why each type:
- **Categorical → `keyword`** (`ad_type`, `intent`, `hook`, `offering_type`, `colors`, `category`,
  `category_id`, `sub_category`, `subcategory_id`): exact filter + fast `terms` aggregation via doc-values.
  Enum/hex values and the 4/8-char taxonomy codes — no analysis, no fuzzy needed.
- **`category_id` / `subcategory_id` → `keyword`** (v1.6): the 4-char / 8-char taxonomy codes now carried
  inside `ai_meta`. Note these mirror the ad doc's existing top-level `category_id` / `subCategory_id`
  fields (written by the classification path) — the `ai.*` copies live under the `ai` object.
- **`offering` → `text`** base (full-text + fuzzy) **+ `offering.keyword`** (exact/agg) **+
  `offering.suggest`** (`completion`, autocomplete). This is the one free-text field a user types to
  search, so it carries the autocomplete sub-field. Multi-fields are auto-populated from the base value
  at index time — the app writes `ai.offering` once and ES derives all three.
- **`caption` → `text`** + `.keyword` — full-text/fuzzy search + exact; no autocomplete (it's a whole
  sentence, not a term you type-ahead).
- **`roa.*` → `text`** only — free-form justification, searched not faceted.
- **`offers` → plain object** (not `nested`) — we never match "an offer whose type=X AND value=Y"
  atomically, so `object` is cheaper. `value` is **`float`** (a dynamic guess would be `long` and then
  reject a `12.5`).

> **v1.5 dropped `brand` and `celebrity`.** Earlier drafts of this runbook gave `brand` a completion
> sub-field for brand autocomplete — that field no longer exists, so autocomplete is on **`offering`
> only**. If you want brand-name autocomplete later, it would come from the advertiser/post-owner data,
> not `ai`.

### 2.1 Fuzzy search (no extra mapping — query-time only)
Fuzziness is a query option on any analyzed (`text`) field; nothing special in the mapping:
```json
GET gdn_search_mix_v2/_search
{ "query": { "match": { "ai.offering": { "query": "printr parts", "fuzziness": "AUTO" } } } }
```
Also works on `ai.caption` and `ai.roa.*`. (`fuzziness:"AUTO"` = edit-distance 1 for 3–5 char terms,
2 for longer.)

### 2.2 Autocomplete (the `offering.suggest` completion field)
Type-ahead uses the suggest API against the `offering.suggest` completion field — FST-backed,
sub-millisecond:
```json
POST gdn_search_mix_v2/_search
{ "suggest": { "offering_ac": {
    "prefix": "print",
    "completion": { "field": "ai.offering.suggest", "size": 8, "skip_duplicates": true,
                    "fuzzy": { "fuzziness": "AUTO" } } } } }
```
`skip_duplicates:true` dedupes repeated strings across docs; `fuzzy` makes the type-ahead typo-tolerant
too.
> Note: `completion` indexes the first `max_input_length` chars (200 above, covering the full field).
> It's prefix-first by design — for "contains" matching use the `match_phrase_prefix` fallback in §2.3.

### 2.3 Fallback autocomplete (zero extra fields)
If you'd rather not use the completion suggester, `match_phrase_prefix` on the `text` field gives
"as-you-type" with no extra mapping (slower on very large indices, but simple):
```json
GET gdn_search_mix_v2/_search
{ "query": { "match_phrase_prefix": { "ai.offering": "print" } } }
```

### 2.4 Optional speed tuning — `eager_global_ordinals`
For the facets you aggregate on constantly (e.g. `ad_type`, `offering_type`, `category`), you can add
`"eager_global_ordinals": true` to that `keyword` field to prebuild global ordinals at refresh, making
`terms` aggs noticeably faster. Trade-off: slightly slower refresh + a little heap. Add it only to the
1–3 hottest facets, not everything. Example: `"ad_type": { "type": "keyword", "eager_global_ordinals": true }`.
This is an additive mapping change too (no reindex).

---

## 3. Targets — one index per network, on that network's own cluster

Each network has its **own** Elasticsearch host/cluster; the index name is `resolveIndex(platform)`
(config.json → env → the default below). All are **ES 6.8 except TikTok (ES 8.x)**, which changes the
PUT form.

| Network | ES | Index (default) | Env override | Mapping type |
|---|---|---|---|---|
| facebook | 6.8 | `search_mix` | `FB_ELASTIC_INDEX` | `doc` |
| instagram | 6.8 | `search_mix` | `IG_ES_INDEX` | `doc` |
| gdn | 6.8 | `gdn_search_mix_v2` | `GDN_ELASTIC_INDEX` | `doc` |
| youtube | 6.8 | `youtube_ads_data` | `YT_ELASTIC_INDEX` | `doc` |
| google | 6.8 | `google_ads_data` | `GOOG_ELASTIC_INDEX` | `doc` |
| native | 6.8 | `native_search_mix_v2` | `NAT_ELASTIC_INDEX` | `doc` |
| linkedin | 6.8 | `linkedin_ads_data` | `LI_ELASTIC_INDEX` | `doc` |
| reddit | 6.8 | `reddit_search_mix` | `RED_ELASTIC_INDEX` | `doc` |
| quora | 6.8 | `quora_search_mix` | `QR_ELASTIC_INDEX` | `doc` |
| pinterest | 6.8 | `pinterest_search_mix` | `PIN_ELASTIC_INDEX` | `doc` |
| tiktok | 8.x | `tiktok_ads` | `TT_ELASTIC_INDEX` | *(typeless)* |

⚠️ **facebook and instagram share the literal name `search_mix`** but live on **different clusters** — run
each against its own host. ⚠️ **gdn/native**: the app prefers the live client's `indexName`, which is the
`_v2` index above; if your env differs, confirm with §3.1 and map the index the app actually writes to.

### 3.1 Confirm the exact index the app uses (don't trust the table blindly)

The mapping must land on the **same index newCatInsertion / POST /ai-meta writes to**. Confirm per network:

```bash
# What index + host is this network's ES client bound to? (run from the pas_node_api box)
node -e "require('dotenv').config(); const r=require('./src/services/ServiceRegistry'); \
  (async()=>{ for (const n of ['facebook','instagram','gdn','youtube','google','native','linkedin','reddit','quora','pinterest','tiktok']) { \
    const s=r.getService(n); const e=s?.db?.elastic; console.log(n.padEnd(10), e? (e.indexName||'(cfg index)') : 'NO ES CLIENT'); } })();"
```
(If `ServiceRegistry` needs the app's normal bootstrap to populate, run this inside a small script that
first calls the same init your server entrypoint does — or just use the config defaults above, which are
correct unless an env var overrides them.)

---

## 4. Apply it

Pick ONE of the three methods. **Kibana Dev Tools (§4A)** is the least error-prone if each cluster has a
Kibana; **curl (§4B)** if not; **the Node script (§4C)** applies all networks in one go using the app's
own clients (handles the per-cluster hosts and the 6.8-vs-8.x difference for you).

### 4A. Kibana Dev Tools (per cluster)

**ES 6.8 (every network except TikTok)** — the type goes in the path:
```
PUT search_mix/_mapping/doc
{
  "properties": { "ai": { "properties": { … as in §2 … } } }
}
```
Use the right index name per network (e.g. `PUT gdn_search_mix_v2/_mapping/doc`,
`PUT google_ads_data/_mapping/doc`, …).

**TikTok (ES 8.x)** — typeless:
```
PUT tiktok_ads/_mapping
{
  "properties": { "ai": { "properties": { … as in §2 … } } }
}
```

Expected response: `{ "acknowledged": true }`.

### 4B. curl (per cluster)

Save the §2 payload as `ai-mapping.json`, then:

```bash
# --- ES 6.8 networks (type in the path) ---
# facebook (its own host), instagram (its own host), gdn, youtube, google, native, linkedin, reddit, quora, pinterest
curl -sS -u "$ES_USER:$ES_PASS" \
  -X PUT "https://<facebook-es-host>:9200/search_mix/_mapping/doc" \
  -H 'Content-Type: application/json' --data-binary @ai-mapping.json ; echo

# (repeat with each network's host + index from the §3 table)

# --- TikTok (ES 8.x, typeless) ---
curl -sS -u "$TT_ELASTIC_USERNAME:$TT_ELASTIC_PASSWORD" \
  -X PUT "http://<tiktok-es-host>:9200/tiktok_ads/_mapping" \
  -H 'Content-Type: application/json' --data-binary @ai-mapping.json ; echo
```

Hosts/creds come from each network's `.env` (the same ones the app's ES clients use;
TikTok's are `TT_ELASTIC_NODE`/`TT_ELASTIC_USERNAME`/`TT_ELASTIC_PASSWORD` — passwords stay in `.env`,
never in a repo/vault).

If a 6.8 cluster rejects the typed path with *"Types cannot be provided in put mapping requests"*, your
client is talking to it typelessly — drop `/doc` (use `PUT <index>/_mapping`). If instead a request
**without** a type is rejected on 6.8, add `?include_type_name=true` and keep `/doc`.

### 4C. One-shot Node script (uses the app's own ES clients)

Reuses each network's already-configured client + resolved index, and the existing `withEsType` helper
so the 6.8 `type:'doc'` vs TikTok-8.x typeless difference is handled automatically. Save as
`scripts/apply-ai-meta-mapping.js` and run `node scripts/apply-ai-meta-mapping.js` (add `--commit` to
actually write; without it, dry-run prints the plan).

```js
'use strict';
// Bootstraps exactly like the server does, then PUTs the `ai` mapping per network.
require('dotenv').config();
const serviceRegistry = require('../src/services/ServiceRegistry');

const AI_PROPS = {
  ad_type:{type:'keyword'}, intent:{type:'keyword'}, hook:{type:'keyword'}, offering_type:{type:'keyword'},
  offers:{properties:{type:{type:'keyword'}, value:{type:'float'}}},
  colors:{type:'keyword'},
  offering:{type:'text', fields:{keyword:{type:'keyword', ignore_above:256}, suggest:{type:'completion', max_input_length:200}}},
  caption:{type:'text', fields:{keyword:{type:'keyword', ignore_above:256}}},
  roa:{properties:{intent:{type:'text'}, hook:{type:'text'}, offering_type:{type:'text'}, offering:{type:'text'}}},
  category:{type:'keyword'}, category_id:{type:'keyword'},
  sub_category:{type:'keyword'}, subcategory_id:{type:'keyword'},
};
const NETWORKS = ['facebook','instagram','gdn','youtube','google','native','linkedin','reddit','quora','pinterest','tiktok'];
const COMMIT = process.argv.includes('--commit');

// 6.8 wants { type:'doc' } on putMapping; 7+/8 (tiktok) must omit it. esMajor is surfaced per connection.
function withType(es, params) {
  const major = es?.esMajor;
  return (major == null || major < 7) ? { ...params, type: 'doc' } : params;
}

(async () => {
  for (const net of NETWORKS) {
    const svc = serviceRegistry.getService(net);
    const es = svc?.db?.elastic;
    if (!es) { console.log(`${net.padEnd(10)} SKIP (no ES client)`); continue; }
    const index = es.indexName || require('../src/config/networks')[net]?.database?.elastic?.index
      || require('../src/config/networks')[net]?.database?.elastic_tiktok?.index;
    if (!index) { console.log(`${net.padEnd(10)} SKIP (no index resolved)`); continue; }
    console.log(`${net.padEnd(10)} -> ${index}${COMMIT ? '' : '  (dry-run)'}`);
    if (!COMMIT) continue;
    try {
      await es.indices.putMapping(withType(es, { index, body: { properties: { ai: { properties: AI_PROPS } } } }));
      console.log(`${net.padEnd(10)} OK acknowledged`);
    } catch (e) {
      console.log(`${net.padEnd(10)} FAIL ${e.meta?.body?.error?.reason || e.message}`);
    }
  }
  process.exit(0);
})();
```

> If `ServiceRegistry.getService` returns nothing here, the registry isn't initialised outside the
> HTTP server. In that case call whatever your server entrypoint (`src/app.js` / `index.js`) uses to
> build the services first, or fall back to §4A/§4B. The mapping content is identical either way.

---

## 5. If some `ai` docs were ALREADY written (dynamic mapping already happened)

Only relevant if the DS pipeline (or a test POST) already wrote an `ai` object before you mapped. Check
one network:

```
GET search_mix/_mapping/field/ai.*        # ES 6.8 (Kibana)  — or curl GET <host>/<index>/_mapping
```
- **No `ai.*` fields returned** → nothing was written; just do §4. ✅
- **`ai.*` present but already matches §2** → someone applied it; you're done. ✅
- **`ai.*` present with WRONG types** (e.g. `ai.offers.value` as `long`, `ai.colors` as `text`) → you
  cannot change them in place. Reindex:
  1. Create `<index>_v2` with the correct full mapping (existing mapping **+** the §2 `ai` block).
  2. `POST _reindex { "source": {"index":"<index>"}, "dest": {"index":"<index>_v2"} }`.
  3. Point the app at `<index>_v2` (env `*_ELASTIC_INDEX`, or the alias/`indexName`), verify, then drop the old index.
  Given the pipeline isn't live yet, the far cheaper path is usually: **delete the few test `ai` docs'
  field** (or the whole test index if it's a dev index) and re-map clean.

---

## 6. Verify

**a) Mapping is present and correctly typed:**
```
GET gdn_search_mix_v2/_mapping/field/ai.offers.value      # → "type":"float"
GET gdn_search_mix_v2/_mapping/field/ai.colors            # → "type":"keyword"
GET gdn_search_mix_v2/_mapping/field/ai.category_id       # → "type":"keyword"  (v1.6)
```

**b) End-to-end write + read-back** (uses the real endpoints — pick an ad_id you know exists). The
category group (name + 4/8-char ids, v1.6) exercises the taxonomy + flat-code path:
```bash
# write
curl -sS -X POST "https://<api-host>/api/v1/common/ai-meta" -H 'Content-Type: application/json' -d '{
  "ad_id":"<known_ad_id>","network":"gdn",
  "ai_meta":{"ad_type":"promotional","intent":["conversion"],"hook":["urgency"],
             "offering_type":"product","offering":"printer parts",
             "colors":["#FFFFFF","#C9A227"],"caption":"A test caption.",
             "category":"Retail","category_id":"1234",
             "sub_category":"Specialty Stores","subcategory_id":"12340001"}
}'
# → { "success": true, "stored_fields": [...], "category_sync": { "mirrored": true, ... }, "sql": {...} }

# read back (should echo the ai object)
curl -sS "https://<api-host>/api/v1/common/getAdCategory?platform=gdn&ad_id=<known_ad_id>"
# → { ..., "ai": { "ad_type":"promotional", ... } }
```

**c) Aggregation works (proves keyword mapping):**
```
GET gdn_search_mix_v2/_search
{ "size":0, "aggs": { "by_type": { "terms": { "field": "ai.offering_type" } } } }
```
A clean bucketed result (not a "field is analyzed / fielddata" error) confirms `keyword`.

**d) Autocomplete works (proves the completion sub-field):**
```
POST gdn_search_mix_v2/_search
{ "suggest": { "ac": { "prefix": "print",
    "completion": { "field": "ai.offering.suggest", "skip_duplicates": true } } } }
```

---

## 7. Safety / rollback

- **Additive & idempotent:** re-running the PUT with the same `ai` block is a no-op (`acknowledged:true`);
  it never touches existing documents or other fields.
- **No downtime, no reindex** (clean-slate case).
- **Rollback:** there's nothing to roll back — an unused mapping field costs nothing. If you truly must
  remove it, that requires a reindex into an index without the field (same mechanics as §5).
- **Ordering:** map **all** networks before flipping the pipeline on. If you stage it, only enable
  AI-Meta writes for the networks you've already mapped.
