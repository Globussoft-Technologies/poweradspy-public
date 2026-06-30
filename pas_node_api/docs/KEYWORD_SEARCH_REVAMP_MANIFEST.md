# Keyword-Search Tracking — Revamp Manifest

> **Status: IMPLEMENTED & integration-tested** (Mongo logic verified — dedupe,
> concurrent-claim distinctness, scrapeId-targeted completion). Additive only — the
> legacy MySQL `dailyKeyword` flow is untouched and still live.
>
> **Files:**
> - Controller: `src/services/common/controllers/keywordSearchController.js`
> - Routes (additive, **2 endpoints**): `src/services/common/routes/commonRoutes.js`
>   - `POST /api/v1/common/keyword-search` — frontend store
>   - `POST /api/v1/common/keyword-search/work` — the SINGLE scraper endpoint
>     (submit results + claim next, in one call; scraper identifies via `x-scraper-name`)
> - Config: `config.keywordSearch` in `config.json` (+ `src/config/index.js`)
> - Manual test: `tests/keywordSearch.manual.js` (`node tests/keywordSearch.manual.js`)
>
> This is a **fresh, from-scratch** implementation of the
> "daily keyword" / user-search-tracking feature. We are **not** extending the old
> MySQL flow — we replace it with a single optimized MongoDB collection.
>
> **Goal:** when a user searches a keyword / advertiser / domain on the frontend,
> that search is stored in the DB. The same term can be searched by many users, so
> there is **one document per term** (created once, updated thereafter) that
> accumulates all the users who searched it. The same term must never be stored as a
> duplicate. For every term we also track the scraping (plugin) **status** —
> start time / end time / status — per day.
>
> **Hard requirement:** the schema must **stay fast even with very large data**
> — achieved via a unique index for dedupe plus bounded array growth (see §4, §5).
>
> **Do NOT disturb** the existing search / insertion / notification pipelines beyond
> the explicit cutover in §8. This feature is additive and is a clean replacement of
> the daily-keyword store only.

---

## 0. Golden rules

1. **One document per unique search term.** Identity = `(type, valueNorm)`, enforced
   by a **unique compound index**. The frontend may fire the same term repeatedly;
   the DB stores it once. Every repeat is an **upsert**, never a fresh insert.
2. **MongoDB, not MySQL.** The old `daily_keyword_requests` MySQL table is retired.
   The new store lives in MongoDB (`pas_competitors` DB by default — see §3).
3. **Bounded growth.** Arrays that could otherwise grow without limit (`searchDates`,
   `users`) are kept safe via `$addToSet` plus capping / summary counters (§5). This
   is what keeps the collection fast at scale.
4. **The scraper owns `scrapping_status`.** The frontend only ever touches `users`
   and `searchDates`. The scraping plugin writes the per-day status sub-documents.

---

## 1. Old flow being REPLACED (for reference / cutover)

| Piece | Location | Fate |
|-------|----------|------|
| `dailyKeywordRequest()` (store) | `src/services/common/controllers/dailyKeywordRequestController.js` | replaced by new POST store |
| `getPriorityRequests()` (scraper pull) | same file | replaced by new GET / UPDATE |
| Route `POST /api/v1/common/daily-keyword-request` | `src/services/common/routes/commonRoutes.js:162` | re-point to new controller |
| Route `GET /api/v1/common/get-priority-requests/:platform/:limit` | `commonRoutes.js:170` | re-point / replace |
| Storage | **MySQL** `daily_keyword_requests` in the **LinkedIn** DB (`dbManager.getSQL('linkedin')`) | retired |
| Per-network status | MySQL columns `facebook_status`, `instagram_status`, `google_status`, `native_status`, `notify_status`, `email_status` (`9`=not searched, `1`=picked, `2`=found, `3`=not found) | replaced by the `scrapping_status[]` array |
| Notification crons | `src/jobs/pushNotificationCron.js` + `config.notifications.pendingTable=daily_keyword_requests`, `pendingNetwork=linkedin` | see §8 — must be migrated / re-pointed before the old table is dropped |

**Old gates (keep the intent, port to the new store):**
- `config.dailyKeyword.realTimeStore` — `"on"` = always store, `"off"` = never, a
  number = only store when the facebook `ads_count` is below that number.
- `config.dailyKeyword.newPlanUser` — only these plan IDs are eligible to store.

---

## 2. Inputs from the frontend

A frontend search sends one of: `keyword`, `advertiser`, `domain` (plus `country`,
`email`, `ads_count`, and user / plan info from the JWT). **Type mapping
(authoritative — per current spec):**

| `type` | meaning | source field |
|--------|---------|--------------|
| `1` | keyword | `keyword` |
| `2` | advertiser | `advertiser` |
| `3` | domain | `domain` |

> Note: this `1/2/3` mapping is the new source of truth and **differs** from the
> legacy MySQL controller, which used `0/1/2`. All new code uses `1/2/3`.

---

## 3. Storage & connection

- **Engine:** MongoDB.
- **Connection:** `dbManager.getMongo(<slug>)`. The default DB is `pas_competitors`
  (`config.databases.mongo.database`). Use a dedicated slug for this feature so it is
  not coupled to any one network's ad DB. **TBD — confirm the slug with the user.**
- **Collection:** `keyword_searches` (proposed name).

---

## 4. Document schema (one per unique term)

```jsonc
{
  "_id": "ObjectId",
  "type": 1,                       // 1=keyword, 2=advertiser, 3=domain
  "value": "Nike",                 // original, as displayed
  "valueNorm": "nike",             // lowercased + trimmed — the dedupe key (see §5)
  "createdAt": "2026-05-15T10:30:00Z",
  "updatedAt": "2026-06-12T14:22:15Z",

  // who searched it (unique emails, via $addToSet) — bounded, see §5
  "users": ["user2@example.com"],
  "userCount": 1,                  // counter, so we never need to read the array length

  // rich searcher identity — one { id, username, email } per user, deduped BY id (or by
  // email when id is absent). Returned on the scraper /work response so a term can be
  // attributed to WHOSE request it is. Bounded like `users` (one entry per unique user).
  "userInfos": [
    { "id": 281, "username": "john_d", "email": "john@example.com" }
  ],

  // recent search timestamps — CAPPED to the last N (see §5)
  "searchDates": [
    "2026-06-12T14:22:15Z",
    "2026-06-10T16:45:22Z"
  ],
  "lastSearchedAt": "2026-06-12T14:22:15Z",
  "searchCount": 42,               // total searches ever (monotonic counter)

  // Which networks this term applies to (union of all networks it was searched for;
  // 'all' on POST expands to config.keywordSearch.networks). A scraper only ever
  // receives terms whose `networks` contains its network.
  "networks": ["facebook", "instagram"],

  // PER-NETWORK scrape state. The priority flag and the daily claim marker live HERE,
  // keyed by network — so a term scraped for facebook is still claimable for instagram
  // the same day (the core requirement). POST sets <net>.isActive=true for each searched
  // network; a priority claim flips <net>.isActive=false; a daily claim sets
  // <net>.dailyClaimDate=today.
  "networkState": {
    "facebook":  { "isActive": false, "dailyClaimDate": "2026-06-12", "lastScrape": { "date": "2026-06-12", "status": "completed", "owner": "fb-plugin-01" } },
    "instagram": { "isActive": true,  "dailyClaimDate": null }
  },

  // scraping / plugin status — one sub-document PER SCRAPE SESSION, written by the
  // scraper. Each entry carries its own `_id` (`scrapeId`), the `network`, `type`, and
  // `owner` (the x-scraper-name that claimed it). The owner is how the next /work hit
  // auto-closes the right session by name. (No adsCount — not tracked.)
  "scrapping_status": [
    { "_id": "sess_a1", "owner": "fb-plugin-01", "network": "facebook",  "type": 1, "mode": "priority", "date": "2026-06-12", "startTime": "2026-06-12T14:22:15Z", "endTime": "2026-06-12T14:35:45Z", "status": "completed" },
    { "_id": "sess_a2", "owner": "ig-plugin-01", "network": "instagram", "type": 1, "mode": "daily",    "date": "2026-06-11", "startTime": "2026-06-11T10:15:30Z", "endTime": "2026-06-11T10:28:45Z", "status": "no_ads_found" },
    { "_id": "sess_a3", "owner": "fb-plugin-01", "network": "facebook",  "type": 1, "mode": "daily",    "date": "2026-06-10", "startTime": "2026-06-10T16:45:22Z", "status": "scrapping" }
  ]
}
```

**`scrapping_status[].status` enum:** `scrapping` (in progress, only `startTime`) →
`completed` (has `endTime` + `adsCount`) | `no_ads_found` | `failed`. Keep this list
closed; map the old MySQL `2=found / 3=not-found / 9=not-searched` onto it.

**Per-network independence:** all claim gating is keyed by `networkState.<net>`, so
"scraped for facebook" never blocks the instagram scraper for the same term, and vice
versa. The `lastScrape` denormalization also lives per network.

**`scrapeId` (`scrapping_status[]._id`)** is generated by the server at claim time and
returned to the scraper. The scraper echoes it back on completion so the end-time lands
on the exact session — never "the latest entry" (§7).

---

## 5. Why this stays fast at scale

1. **Dedupe is a unique index, not a SELECT-then-INSERT.** The store path is a single
   `updateOne({ type, valueNorm }, …, { upsert: true })`. No read-before-write race,
   no duplicates.
   - `valueNorm = value.trim().toLowerCase()` so `"Nike"`, `"nike "`, and `"NIKE"`
     collapse into one document.
2. **Indexes (the whole point):**
   - `{ type: 1, valueNorm: 1 }` **unique** — dedupe plus exact lookup.
   - `{ type: 1, networks: 1, updatedAt: -1 }` — **both** claim queries (§7.A/B): equality
     on `type` + `networks` (applicability) with a recency sort. The per-network gate
     (`networkState.<net>.isActive` / `.dailyClaimDate`) is a residual predicate applied
     over the already index-sorted candidates, and `findOneAndUpdate` stops at the first
     match. (Per-network fields can't be generically indexed since the network is
     dynamic; this index keeps the common case index-ordered and cheap.)
   - `{ updatedAt: -1 }` — recency lists / admin views.
   - `{ users: 1 }` (multikey) **only if** "what did user X search" must be answered
     from this collection. If that query is hot, prefer the side collection in note 5.
3. **No unbounded arrays in the hot path:**
   - `users` uses `$addToSet` (unique) plus a `userCount` counter, so the array length
     is never measured at read time. If a term can be searched by a very large number
     of users, the array is the wrong place — see note 5.
   - `searchDates` is **capped** to the last N (e.g. 30) using
     `$push: { $each: [...], $slice: -30 }`. Full history lives in counters
     (`searchCount`, `lastSearchedAt`), not in an ever-growing array.
4. **`scrapping_status` grows ~1 entry/day** — bounded in practice, but still trim or
   aggregate old entries (e.g. keep the last 90 days) and rely on `lastScrape` for the
   hot read.
5. **Scale escape hatch (recommended if `users` per term can get large):** keep
   `keyword_searches` as the per-term document (users summarized by `userCount` only),
   and put the per-user-per-term facts in a **second collection**
   `keyword_user_searches` — one small document `{ termId, email, firstSearchedAt,
   lastSearchedAt, count }` with a unique index `{ termId, email }`. This removes the
   only unbounded array entirely and is the truly scale-proof shape. **Decision
   pending user confirmation.**

---

## 6. POST — store a search (frontend)

**`POST /api/v1/common/keyword-search`** (auth). Body: `{ value, type, network, email, ... }`.

Behaviour: **one atomic pipeline upsert.** If the term already exists → it is updated
(dedupe by unique `{ type, valueNorm }`); if not → it is created. `network` may be a
single slug, a comma list, or `all` (expands to `config.keywordSearch.networks`). Each
searched network is unioned into `networks` and **reactivated**
(`networkState.<net>.isActive = true`).

```js
// netActiveSet = { [`networkState.${net}.isActive`]: true } for each searched network
db.keyword_searches.updateOne(
  { type, valueNorm },                                   // valueNorm = value.trim().toLowerCase()
  [
    { $set: {
        type, value, valueNorm,
        createdAt:   { $ifNull: ['$createdAt', now] },
        updatedAt:   now,
        lastSearchedAt: now,
        searchCount: { $add: [{ $ifNull: ['$searchCount', 0] }, 1] },
        users:       { $setUnion: [{ $ifNull: ['$users', []] }, email ? [email] : []] },
        searchDates: { $slice: [{ $concatArrays: [{ $ifNull: ['$searchDates', []] }, [now]] }, -cap] },
        networks:    { $setUnion: [{ $ifNull: ['$networks', []] }, netList] },
        ...netActiveSet,
    } },
    { $set: { userCount: { $size: '$users' } } },          // exact counter, single round-trip
  ],
  { upsert: true }
);
```
Apply the §1 gates (`realTimeStore`, `newPlanUser`) **before** this write. Setting
`networkState.<net>.isActive = true` on **every** POST means a freshly re-searched term
re-enters the priority queue (§7.A) for those networks even after a previous scrape
deactivated them. The single pipeline does dedupe, bounded arrays, per-network
reactivation, and an exact `userCount` in one atomic op. It also maintains `userInfos` —
the rich `{ id, username, email }` searcher list (id/username pulled from the JWT) deduped
by id — which the scraper `/work` response echoes per term so each term is attributable to
whose request it is.

---

## 7. The scraper API — ONE endpoint (concurrency-critical)

**`POST /api/v1/common/keyword-search/work`** is the **single** endpoint a scraper calls
in a loop. The scraper does NOT hit multiple APIs. One call does **both**:
1. **auto-close the term this scraper finished last** — matched **by owner name**
   (`x-scraper-name`), NOT by id. The scraper sends no `docId`/`scrapeId` and no
   `adsCount`; only an optional `status` (default `completed`). See §7.D.
2. **claim the next** term for the requested `type`(s) + concrete `network`(s). Both
   `type` and `network` accept a single value, a comma list, **or an array** (e.g.
   `network: ["facebook","instagram"]`, `type: ["keyword","advertiser"]`). The claim pool
   is the union of every requested `type × network` pair, so a single returned value may
   come from any of them — each item still carries its own concrete `type`+`network`.
   Identical in priority and daily modes.

> Advanced: a scraper claiming many at once (`size > 1`) can't auto-map one outcome to
> several terms, so it may instead send an explicit `results: [{ docId, scrapeId,
> status }]` (ids from the previous response). The normal size-1 loop never needs this.

**Scraper identity:** every request MUST carry the `x-scraper-name` header
(configurable — `config.keywordSearch.scraperHeader`) with the plugin's own unique name.
It is stored as the session `owner`, so we always know which plugin claimed/scraped a
term, and **only that owner can close its own session** (enforced in the update query via
`$elemMatch` on `{ _id: scrapeId, owner }`).

Body: `{ type, network, priority?, size?, results?: [{ docId, scrapeId, status, adsCount }] }`.
`type` and `network` are required (the work stream) and each accept a single value, a
comma list, or an array. `priority` is a body flag — same two modes as before. `size`
(clamped to `maxClaimSize`) = how many to claim this call.

**Required `type` + `network` scoping (both modes):** each individual claim is scoped to
**one** `type` **and** to terms whose `networks` array contains **one** network — so a
facebook keyword-claim only receives keywords applicable to facebook. When `type`/`network`
are arrays, the endpoint enumerates every `type × network` pair and, for each slot, claims
from the first pair that has a term (each claim is still the atomic single-pair
`findOneAndUpdate` of §7.C). This keeps per-network independence and concurrency-safety
intact while letting one stream drain several pools.

### 7.A. Priority mode — body `{ priority: true, type: "keyword", network: "facebook", size: N }`

- Pool = terms of the `type`, applicable to `network`, with
  `networkState.<net>.isActive: true`. Sorted by `updatedAt: -1`. *(asc/desc tunable — §9.)*
- **Claiming flips `networkState.<net>.isActive → false`**, so it is not handed out for
  that network again until a new POST reactivates it ("second hit pe wahi na aaye").
- `isActive` for **other** networks is untouched.

### 7.B. Daily mode — body `{ type: "keyword", network: "facebook", size: N }`  *(no `priority`)*

- Pool = all terms of the `type` applicable to `network` (no `isActive` condition).
  Sorted by `updatedAt: -1`.
- Gate = **not already claimed today for this network**:
  `networkState.<net>.dailyClaimDate != <today>`. Claiming sets it to `<today>`, so the
  term cannot repeat the same day **for that network** — but **another network can still
  claim the same term the same day** (the core per-network requirement). Next day all
  become eligible again; cross-day repeats are expected.

### 7.C. The atomic claim (why concurrent scrapers never collide)

Each unit of work is claimed with a single **`findOneAndUpdate`** — atomic at the
document level. MongoDB re-evaluates the filter under the document's write lock, so two
concurrent claims can never select the same doc: the first flips the doc out of the
filter (its per-network gate), the second automatically matches the **next** one.

```js
// one claim (mode = 'priority' | 'daily'); scrapeId minted server-side.
// `type`, `net` (single slug), `owner` (x-scraper-name) are REQUIRED. Paths per-network.
const scrapeId = new ObjectId();
const activePath = `networkState.${net}.isActive`;
const dailyPath  = `networkState.${net}.dailyClaimDate`;
const claim = mode === 'priority'
  ? { filter: { type, networks: net, [activePath]: true },          setOut: { [activePath]: false } }
  : { filter: { type, networks: net, [dailyPath]: { $ne: today } }, setOut: { [dailyPath]: today } };

const doc = await col.findOneAndUpdate(
  claim.filter,
  {
    $set:  { ...claim.setOut, [`networkState.${net}.lastScrape`]: { date: today, status: 'scrapping', owner } },
    $push: { scrapping_status: { _id: scrapeId, network: net, mode, owner, date: today, startTime: now, status: 'scrapping' } }
  },
  { sort: { updatedAt: -1 }, returnDocument: 'after' }   // priority may use updatedAt:1 — see §9
);
// doc === null  ⇒ pool exhausted (return what we have so far)
```

- **`size > 1`:** loop this claim `size` times in the request; each iteration is its own
  atomic claim → distinct docs even within one multi-size call. Stop early on `null`.
  Clamped to `config.keywordSearch.maxClaimSize`.
- **Response:** `{ scraper, mode, networks, network, types, completed, count, data: [{ docId, type, value, network, scrapeId, mode, users: [{ id, username, email }] }, ...] }`.
  `networks`/`types` echo the request; `network` is a single slug when one was requested,
  else the array. Each `data[]` item carries its own concrete `type`+`network` (the value's
  source) plus `users` — the rich searcher list (from `userInfos`) so the term can be
  attributed to WHOSE request it is. The scraper keeps each `scrapeId` paired with the term.

### 7.D. Closing the previous term — auto, by owner name

By default the scraper sends **no ids**. At the top of each `work` call we close that
scraper's still-open session(s) for the requested `network`(s) and any of the requested
`type`(s) (one auto-close pass per network so each net's `lastScrape` denorm stays
correct), matched **by owner name**.
The scraper optionally sends `status` (`no_ads_found`/`failed`; default `completed`).
No `adsCount`. In the normal size-1 loop there is exactly one open session per owner, so
this is unambiguous — and a different scraper name never touches another's session.

```js
const finalStatus = ['completed','no_ads_found','failed'].includes(status) ? status : 'completed';
await col.updateMany(
  { scrapping_status: { $elemMatch: { owner, network: net, type, status: 'scrapping' } } },
  { $set: {
      "scrapping_status.$[s].endTime": now,
      "scrapping_status.$[s].status":  finalStatus,
      [`networkState.${net}.lastScrape`]: { date: today, status: finalStatus, owner },
  } },
  { arrayFilters: [{ "s.owner": owner, "s.network": net, "s.type": type, "s.status": "scrapping" }] }
);
```

**Advanced (size > 1):** instead of the auto path, the scraper sends explicit
`results: [{ docId, scrapeId, status }]`. Each closes the EXACT session by `scrapeId`
(positional `arrayFilters`), with ownership enforced in the main query via
`$elemMatch { _id: scrapeId, owner }` — a wrong owner matches nothing. This is what makes
the scraper-1-took-A / scraper-2-took-B case impossible even in batch mode.

### 7.E. Restart safety + stale-claim recovery (nothing gets stuck)

**All state lives in MongoDB** — there is no in-memory queue — so a server or scraper
restart never loses claims or breaks the loop; the scraper just calls `work` again.

If a scraper crashes (or a restart drops a handoff) after claiming but before submitting
its result, the session is stuck at `scrapping` (priority: that network stuck
`isActive:false`). `recoverStaleClaims()` self-heals it:
- Finds sessions `status: 'scrapping'` with `startTime` older than
  `config.keywordSearch.staleClaimMinutes` (batched by `staleSweepBatch`).
- Marks each `failed` (sets `endTime`); for **priority** sessions re-activates that
  session's own `networkState.<network>.isActive: true` so it can be re-claimed.

It runs **opportunistically inside `work`**, throttled to once per
`staleSweepIntervalSec` per process (config `autoRecoverStale`) — no separate cron
required. Still exported for an explicit cron/admin trigger if desired.

> **`behaviour` endpoint** (the user mentioned `get / behaviour / update / post`):
> still **TBD** — likely a read of a term's users + scrape history, or a per-user
> search-history view. Define before implementing.

---

## 8. Cutover / what must not break

1. Re-point the routes at `commonRoutes.js:162` and `:170` to the new controller, or
   add new routes and deprecate the old ones — **decide with the user**.
2. **Notification crons** (`src/jobs/pushNotificationCron.js`) currently read the
   MySQL table via `config.notifications.pendingTable` / `pendingNetwork`. They must
   be migrated to the Mongo collection **before** the MySQL table is retired,
   otherwise push / email notifications break. Track this as a dependent task.
3. Keep the `config.dailyKeyword.realTimeStore` and `newPlanUser` semantics (port the
   gate logic).
4. Nothing in the search / insertion pipelines changes.

---

## 9. Open decisions (need user input)

- [x] Type mapping → `1=keyword, 2=advertiser, 3=domain` (§2).
- [x] POST reactivates `isActive:true` on every search (§6).
- [x] Two GET modes — priority (`isActive` gate, flips false on claim) vs daily
      (`dailyClaimDate` gate, no same-day repeat) (§7.A/B).
- [x] Concurrency = atomic `findOneAndUpdate` claim + per-session `scrapeId` +
      `arrayFilters` end-time (§7.C/D).
- [ ] Priority sort direction: `updatedAt: -1` (newest demand first) vs `: 1` (oldest
      waiting first / anti-starvation). Currently proposed `-1`.
- [ ] Stale-claim timeout value + reaper style (cron vs lazy-on-read) — §7.E.
- [ ] Mongo slug / DB and final collection name (`keyword_searches`?).
- [ ] One collection (capped `users` array) vs. two collections
      (`keyword_user_searches` side table) — §5 note 5. This drives the scale-proof
      guarantee.
- [ ] `searchDates` cap size (proposed 30) and `scrapping_status` retention (proposed
      90 days).
- [ ] `behaviour` endpoint contract (§7 end).
- [ ] Notification-cron migration plan (§8.2).

---

## 10. Synthetic keywords, Google ordering & capacity cap (2026-06 additions — IMPLEMENTED)

Three additive changes layered on the store above. **The §6 store and §7 work flows are
unchanged** except where noted; all new behaviour is new code paths / opt-in flags.

Files: `keywordSearchController.js` (`insertSyntheticKeywords`, `enforceCap`,
`buildClaimAttempts`), `helpers/keywordInput.js` (CSV/JSON parse), routes in
`commonRoutes.js`. Config: `config.keywordSearch.cleanup` + `synthetic*` keys.

### 10.1 Synthetic (manually-inserted) keywords
- **Identity marker = `users: null` + `userInfos: null`.** Real (user-searched) docs always
  carry arrays (even `[]`), so the null pair is unambiguous — **no new field added.**
- **`POST /api/v1/common/keyword-search/synthetic`** (no JWT, internal). CSV file
  (field `file`, ≤ `syntheticMaxUploadMb`, streamed) **or** JSON (array / `{keywords:[]}` /
  objects). Deduped case-insensitively by the unique `(type, valueNorm)` index via a
  **`$setOnInsert`-only** `bulkWrite` upsert → an existing doc (user *or* synthetic) is
  **never** clobbered.
- **`network` is MANDATORY** (no default; removed the earlier `all` default) — per-item,
  CSV column, or batch field. It fills the doc's `networks` + `networkState.<net>.{isActive:
  false}` (daily-crawlable, out of the priority queue until real demand). Items with no/invalid
  network → skipped (`skippedNoNetwork`); none valid → `400`.
- Synthetic doc shape = a fresh store doc with empty user data: `searchCount:0`,
  `lastSearchedAt:null`, `searchDates:[]`, `userCount:0`, `users:null`, `userInfos:null`.

### 10.2 Enrichment (no store change)
A user later searching a synthetic term hits the §6 upsert on the same `(type, valueNorm)`;
its `$ifNull(['$users', []])` / `$ifNull(['$userInfos', []])` turn `null → [] → [user]`, so
the doc "becomes" a normal user doc — no special-casing, no duplicate.

### 10.3 Synthetic-only claim + Google ordering + implicit loop on `/work`
- **Synthetic-only:** body `users:null` (or `userInfos:null`) restricts the claim to synthetic
  docs (`filter.userInfos = null`). Absent/non-null → unchanged pool. Response echoes
  `synthetic`.
- **Google-only ordering:** for `network:"google"`, a normal **daily** claim serves
  **priority → user-searched → synthetic** on every hit, via `buildClaimAttempts()` (an ordered
  list of atomic `findOneAndUpdate` attempts; first hit wins).
- **Google-only implicit loop:** when all three tiers are exhausted for the current day, the
  server automatically clears `networkState.google.dailyClaimDate` for Google docs that are not
  currently being scraped and retries the same three tiers. This makes Google scrapers loop
  continuously without requiring any client flag. It is controlled by
  `config.keywordSearch.google.continuousLoop` (default `true`) and applies only to Google;
  every other network keeps the once-per-day gate. Status transitions are unchanged (priority
  flips `isActive`; daily sets `dailyClaimDate`).

### 10.4 Hard capacity cap (`config.keywordSearch.cleanup`) — answers §5 scale question
- `applyTo` (`both`|`user`|`synthetic`|`none`), `userCap` (100k), `syntheticCap` (100k).
- Enforced **INLINE on insert (no cron)**, and only when a new doc was actually added
  (`upsertedCount > 0` on store; `inserted > 0` on synthetic) — so repeat searches skip it.
  Non-fatal (a cleanup error never fails the insert).
- Over cap → delete the **oldest** docs to reach the cap exactly, **already-scraped first**
  (`scrapping_status.0` exists), falling back to oldest not-yet-scraped only if still over
  (so pending keywords are kept to be scraped before deletion).
- Categories: user = `{$or:[{users:{$ne:null}},{userInfos:{$ne:null}}]}`, synthetic =
  `{users:null, userInfos:null}`.

Resolves §9 "one collection vs two" for now: **one collection**, bounded by the hard cap
instead of a side table.

See [KEYWORD_SEARCH_API.md](./KEYWORD_SEARCH_API.md) for the request/response contracts.
