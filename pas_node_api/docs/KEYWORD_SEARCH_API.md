# Keyword-Search API

Three endpoints. **API 1** (frontend) stores a search. **API 2** (scraper) is the single
endpoint a plugin calls in a loop to submit finished results and claim the next terms.
**API 3** bulk-inserts **synthetic** (manually-inserted) keywords. All share the one
`keyword_searches` collection.

> Design details: [KEYWORD_SEARCH_REVAMP_MANIFEST.md](./KEYWORD_SEARCH_REVAMP_MANIFEST.md).
> All behaviour is controlled by `config.keywordSearch` in `config.json`.

> **Synthetic keywords** are stored in the same collection + doc shape as user searches,
> distinguished only by `users: null` + `userInfos: null` (real docs always carry arrays).
> A later user search on the same term enriches the existing doc automatically (no
> duplicate). A config-driven **HARD capacity cap** (`config.keywordSearch.cleanup`,
> default 100k each for user-searched & synthetic) auto-deletes on insert — see the bottom.

---

## Base URL

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:4000` |
| Staging     | `https://stagingtest-api.poweradspy.com` |

All paths below are under `/api/v1/common`.

## Auth

| Endpoint | Auth |
|----------|------|
| `POST /keyword-search` (store) | **JWT required** — `Authorization: Bearer <token>` header (or `authToken` cookie in a browser). |
| `POST /keyword-search/work` (scraper) | **No JWT.** Must send the `x-scraper-name` header (the plugin's own unique name). |
| `POST /keyword-search/synthetic` (bulk insert) | **No JWT** (internal bulk-load, like `work`). |

---

## Reference values

| Field | Values |
|-------|--------|
| `type` | `1` = keyword, `2` = advertiser, `3` = domain. The words `keyword` / `advertiser` / `domain` are also accepted. On **work** you may send one type, a comma list, or an array (e.g. `["keyword","advertiser"]`). |
| `network` | One of: `facebook, instagram, gdn, youtube, google, native, linkedin, reddit, quora, pinterest, tiktok`. On **store** you may also send `all` (expands to every network) or a comma list. On **work** send one concrete network, a comma list, or an array (e.g. `["facebook","instagram"]`) — but never `all`. |
| `status` (optional, on work) | `completed` (default) \| `no_ads_found` \| `failed` |

---

## API 1 — Store a search

```
POST /api/v1/common/keyword-search
Authorization: Bearer <token>
Content-Type: application/json
```

**Body**

| Field | Required | Notes |
|-------|----------|-------|
| `value` | yes* | The term. *Or send legacy `keyword` / `advertiser` / `domain` instead (type inferred). |
| `type` | yes* | `1` / `2` / `3` (or the word). Required when using `value`. |
| `network` | yes | Single slug, comma list, or `all`. |
| `email` | no | Stored against the term (deduped). |
| `ads_count` | no | Used only by the `realTimeStore` numeric gate. |

**Example — keyword for all networks**

```json
{ "value": "Nike", "type": 1, "network": "all", "email": "user@example.com" }
```

**Example — advertiser for facebook + instagram**

```json
{ "value": "Adidas", "type": 2, "network": "facebook,instagram", "email": "user@example.com" }
```

**Response `200`**

```json
{
  "code": 200,
  "message": "keyword search stored",
  "data": { "status": "new", "type": 1, "value": "Nike", "networks": ["facebook","instagram", "..."] }
}
```

- `data.status`: `new` (created) · `existing` (already there, updated) · `skip` (a gate skipped it).
- Same term again = **no duplicate**; the user is added and the searched networks are reactivated.

---

## API 2 — Scraper work (claim + complete in one call)

```
POST /api/v1/common/keyword-search/work
x-scraper-name: fb-keyword-plugin-01
Content-Type: application/json
```

The scraper just calls this **in a loop** with the same body. On each hit the server
**automatically closes the term this scraper finished last** (matched by `x-scraper-name`)
and hands the **next** term. The scraper does **not** track `docId`/`scrapeId` and does
**not** send `adsCount`.

**Body**

| Field | Required | Notes |
|-------|----------|-------|
| `type` | yes | `1` / `2` / `3` (or word). One value, a comma list, or an array (e.g. `["keyword","advertiser"]`). |
| `network` | yes | One concrete network slug, a comma list, or an array (e.g. `["facebook","instagram"]`). Never `all`. |
| `priority` | no | `true` = priority mode; omit/`false` = daily mode. |
| `size` | no | How many terms to claim this call (default 1). |
| `status` | no | Outcome of the term just finished: `no_ads_found` / `failed`. Omit = `completed`. |

> **Multi type/network:** when `type` and/or `network` are arrays, the claim pool is the
> union of every requested type × network. Each call still returns **one value per slot**,
> and each returned item carries its own concrete `type` + `network` — so a single value
> may come from facebook **or** instagram (or be a keyword **or** an advertiser). This
> works identically in **priority** and **daily** modes; per-network independence is
> preserved (a term scraped for facebook is still claimable for instagram the same day).

**Two modes (same endpoint, same auto-close):**

- **daily** (default): every term applicable to the network, **once per day per network**
  (facebook scraping a term does NOT stop instagram from getting it the same day).
- **priority** (`priority:true`): only terms re-searched on the frontend; each is handed
  out once, then goes quiet until searched again.

**Synthetic-only claim (opt-in):** send `users: null` (or `userInfos: null`) in the body to
claim **only synthetic** (manually-inserted, not-yet-user-searched) keywords. Omit it for the
normal pool — existing behaviour is unchanged. The response echoes `synthetic: true`.

**Google priority ordering + implicit loop (network-specific):** for `network: "google"`, a
normal **daily** claim (no `priority` flag) serves terms in a fixed order on **every** hit —
**priority** (`networkState.google.isActive:true`) first, then **user-searched**, then
**synthetic**. When all three tiers are exhausted for the day, the server **automatically
resets** `networkState.google.dailyClaimDate` for Google and tries again, so Google scrapers
never sit idle waiting for the next calendar day. No client flag is required. The status
transitions are unchanged (priority flips `isActive`; daily sets `dailyClaimDate`). Every
other network — and any explicit `priority:true` — is unchanged.

**The loop (size = 1):**

```jsonc
// Hit 1 — nothing to close yet, get the first term
{ "type": "keyword", "network": "facebook" }

// Hit 2 — server auto-closes the term from hit 1 (endTime+status), gives the next
{ "type": "keyword", "network": "facebook" }

// Hit 3 — if the previous term had no ads, just say so; still gives the next
{ "type": "keyword", "network": "facebook", "status": "no_ads_found" }
```

**Priority is identical — just add `priority: true`:**

```json
{ "type": "keyword", "network": "facebook", "priority": true }
```

**Multi network / type — one stream draining several pools (priority or daily):**

```jsonc
// keywords across facebook OR instagram — each returned value is one term tagged with
// the network it came from (facebook or instagram).
{ "type": "keyword", "network": ["facebook", "instagram"] }

// keywords AND advertisers, facebook OR instagram — pool is the union of all 4 pairs.
{ "type": ["keyword", "advertiser"], "network": ["facebook", "instagram"], "priority": true }
```

**Response `200`**

```json
{
  "code": 200,
  "message": "claimed",
  "scraper": "fb-keyword-plugin-01",
  "mode": "daily",
  "network": "facebook",
  "networks": ["facebook"],
  "types": [1],
  "completed": 1,
  "completionErrors": [],
  "count": 1,
  "data": [
    {
      "docId": "665f1f77bcf86cd799439002", "type": 1, "value": "Nike", "network": "facebook",
      "scrapeId": "665f200abcf86cd799439010", "mode": "daily",
      "users": [
        { "id": 281, "username": "john_d", "email": "john@example.com" },
        { "id": 305, "username": "asha", "email": "asha@example.com" }
      ]
    }
  ]
}
```

- `networks` / `types` echo what was requested. `network` is the single slug when one
  network was requested, or the array when several were. Each `data[]` item always carries
  its own concrete `network` + `type` — that is the source of the value.
- `data[].users` is the array of everyone who searched that term — one
  `{ id, username, email }` object per user — so you know **whose** request the term is.
  (`id`/`username` come from the searcher's login; older terms stored before this change
  may show `id: null`, `username: ""` with just the email.)
- `completed` = how many of this scraper's previous open terms were just closed (1 in a
  normal size-1 loop; 0 on the very first hit).
- When the pool is empty, `count: 0` and `data: []` — the scraper just waits and retries.
- If a scraper stops mid-term, that open session is auto-recovered after
  `staleClaimMinutes` so the term isn't stuck.

> **Batch (size > 1, advanced):** auto-close can't map one outcome to several different
> terms, so if you claim many at once, send an explicit
> `results: [{ docId, scrapeId, status }]` array instead (ids come from the previous
> response). For the normal one-at-a-time loop you never need this.

---

## API 3 — Insert synthetic keywords (bulk)

```
POST /api/v1/common/keyword-search/synthetic
```

Bulk-load manually-inserted ("synthetic") keywords from a **CSV file** or **JSON**. No JWT.
Stored in the same collection + doc shape as user searches, marked `users: null` +
`userInfos: null`, deduped **case-insensitively** by the unique `(type, valueNorm)` index via
`$setOnInsert` (an existing doc — user *or* synthetic — is **never** modified).

**`network` is MANDATORY** (no default). It can be a single slug, a comma list, or `all`,
supplied per-item, as a CSV `network` column, or as a batch field. It populates the doc's
`networks` + `networkState`. Items with no/invalid network are skipped; a request with none
valid → `400`.

### Option A — JSON

```
Content-Type: application/json
```

| Form | Example |
|------|---------|
| array of strings (+ batch `network`) | `{ "network": "facebook", "keywords": ["cat", "dog"] }` or `["cat","dog"]` with batch network |
| array of objects (per-item `network`/`type`) | `[ { "value": "cat", "network": "facebook,instagram" }, { "value": "ad", "type": 2, "network": "google" } ]` |

`value` (alias `keyword`/`term`) is required per item; optional `type` (default keyword/1) and
`country`/`user_id`. Top-level `type`/`network` are batch defaults; per-item overrides win.

### Option B — CSV file (multipart/form-data)

Field name **`file`** (≤ `syntheticMaxUploadMb`, default 50 MB, streamed). One keyword per
line, **or** a header row with a `keyword` (or `value`) column (+ optional `type`/`network`
columns). A batch `network`/`type` text field supplies the default when a row omits it.

```csv
keyword,network
running shoes,facebook
gym bag,"facebook,instagram"
```

**Response `200`**

```json
{
  "code": 200,
  "message": "synthetic keywords stored",
  "data": { "received": 3, "unique": 2, "inserted": 2, "duplicatesIgnored": 0, "skippedNoNetwork": 0, "cleanup": { "category": "synthetic", "total": 2, "deleted": 0 } }
}
```

- `inserted` = new docs; `duplicatesIgnored` = already present / duplicate within the batch
  (case-insensitive); `skippedNoNetwork` = items dropped for a missing/invalid network;
  `cleanup` = the cap-enforcement summary (see below).
- `400` when no keywords are supplied, or when **no** keyword had a valid network.

---

## Capacity cap (auto-deletion)

`config.keywordSearch.cleanup` keeps each category within a **hard** cap, enforced **inline
when new data is inserted** (no cron) and only when a new doc was actually added:

| key | default | meaning |
|-----|---------|---------|
| `applyTo` | `"both"` | `both` \| `user` \| `synthetic` \| `none` (disable) |
| `userCap` | `100000` | max user-searched docs |
| `syntheticCap` | `100000` | max synthetic docs |

When a category is over cap, the **oldest** docs are deleted to return to exactly the cap —
**already-scraped docs first** (`scrapping_status` present), falling back to the oldest
not-yet-scraped only if still over. A synthetic bulk insert trims the synthetic category; a
new user search trims the user category. (`config.json` is environment-specific; the caps
also work from the `config/index.js` defaults.)

---

## Quick test with curl

```bash
BASE=http://localhost:4000
TOKEN=<your-jwt>

# 1. Store a keyword for all networks
curl -s -X POST "$BASE/api/v1/common/keyword-search" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"value":"Nike","type":1,"network":"all","email":"me@example.com"}'

# 2. Facebook scraper claims the first term
curl -s -X POST "$BASE/api/v1/common/keyword-search/work" \
  -H "x-scraper-name: fb-plugin-01" -H "Content-Type: application/json" \
  -d '{"type":"keyword","network":"facebook"}'

# 3. Same scraper hits again → server auto-closes the term from step 2 (by name) and
#    gives the next. No docId/scrapeId, no adsCount. (status optional.)
curl -s -X POST "$BASE/api/v1/common/keyword-search/work" \
  -H "x-scraper-name: fb-plugin-01" -H "Content-Type: application/json" \
  -d '{"type":"keyword","network":"facebook"}'

# 4. Instagram scraper STILL gets the same term the same day (per-network independence)
curl -s -X POST "$BASE/api/v1/common/keyword-search/work" \
  -H "x-scraper-name: ig-plugin-01" -H "Content-Type: application/json" \
  -d '{"type":"keyword","network":"instagram"}'

# 5. Insert synthetic keywords (JSON) — network is mandatory
curl -s -X POST "$BASE/api/v1/common/keyword-search/synthetic" \
  -H "Content-Type: application/json" \
  -d '{"network":"facebook","keywords":["running shoes","Running Shoes","gym bag"]}'

# 6. Insert synthetic keywords from a CSV file (field name = file)
printf 'keyword,network\nrunning shoes,facebook\ngym bag,instagram\n' > kw.csv
curl -s -X POST "$BASE/api/v1/common/keyword-search/synthetic" -F "file=@kw.csv" -F "network=facebook"

# 7. Claim ONLY synthetic keywords (users:null), and google priority-first ordering
curl -s -X POST "$BASE/api/v1/common/keyword-search/work" \
  -H "x-scraper-name: g-plugin-01" -H "Content-Type: application/json" \
  -d '{"type":"keyword","network":"google","users":null}'
```

---

## Test in Postman

### 1. Import the collection
`File → Import` → choose
[`docs/keyword-search.postman_collection.json`](./keyword-search.postman_collection.json).
It contains all requests pre-built with variables.

### 2. Set collection variables
Open the collection → **Variables** tab and set:

| Variable | Value |
|----------|-------|
| `baseUrl` | `http://localhost:4000` |
| `token` | your JWT (get it by logging in — see below) |
| `scraperName` | `fb-keyword-plugin-01` |

### 3. Getting a JWT for the store request
The store endpoint needs a logged-in user token. Easiest options:
- Log in via the app/login API and copy the `authToken` (from the cookie or the login
  response) into the `token` variable, **or**
- In a browser already logged in, the `authToken` cookie is sent automatically — but in
  Postman use the `Authorization: Bearer <token>` header (already wired to `{{token}}`).

If you only want to test the **scraper** endpoint, you don't need a token at all — just
`x-scraper-name`.

### 4. Run order
1. **Store keyword (all networks)** — should return `data.status: new`.
2. **Work: facebook (hit 1)** — returns one term; `completed: 0` (nothing to close yet).
3. **Work: facebook (hit 2)** — same body again → `completed: 1` (auto-closed hit-1's term
   by name) and gives the **next** term. No ids, no adsCount.
4. **Work: instagram** — you still get the same term → proves per-network independence
   (facebook being scraped didn't skip instagram).
5. **Work: facebook priority** — empty unless you store again first (priority only hands
   out freshly-searched terms).

### 5. What to check
- Re-running **Store** with the same value → `data.status: existing` (no duplicate).
- Keep hitting **Work facebook** → each hit closes the previous term and gives a new one,
  until `count: 0` (pool empty for today).
- Stop & restart the server mid-flow → the next **Work** call continues normally (state
  is all in MongoDB).

### 6. Swagger UI alternative
The same two endpoints are in the OpenAPI spec under the **Keyword Search** tag
(`swagger.yml`) — you can also try them from the Swagger UI if it's served in your env.
