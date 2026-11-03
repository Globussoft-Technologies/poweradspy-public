# Copyright Blocklist (B1) — Implementation Manifest

Status: B1 and B2 are implemented and tested with fakes and a local fake hashing server (see "Status at a glance" below); **neither has been run
against a real database or the real hashing service yet**. Everything is **off by default**.
Scope: commitment B1 of the Oracle appeal — nothing from a blocked advertiser, ad or image is stored or uploaded.
Team plan and work split: [COPYRIGHT_COMPLIANCE_ARCHITECTURE.md](COPYRIGHT_COMPLIANCE_ARCHITECTURE.md).

## Status at a glance

| Part | Written | Tested with fakes | Run for real | Notes |
| --- | --- | --- | --- | --- |
| B1: check at collection (12 networks + TikTok), spelling variants, attempts log | yes | yes | no | committed in `cca001735` (PR #1649, branch `copyright`) |
| B2: DS client, matcher, hash job, worker, cron (`imageHashJobs`) | yes | yes | no | uncommitted |
| B2: schema (14 tables, 256-bit hash, `copyright_image_hash_jobs`, `copyright_image_hash_results`) | yes | dry-run rendered offline | no | no table exists on dev yet |
| B2: entry point for a name from the landing page (`submitAdvertiser`) and its route (`POST /api/v1/copyright/advertiser/block`) | yes | yes (function also on the real service; route with a local HTTP server) | no | route is off by default; the approval step in front of it is future work |
| B2: exact-copy check of every downloaded image / video thumbnail at ingestion (`guardFile`, hooked in `fetchPrimaryMedia`) | yes | yes (real download from a local server) | no | off by default (`compliance.imageMatch.enabled`); Facebook, Instagram, ChatGPT Ads, AdMob pipelines |
| B2: review queue (list, allow / block; a block adds the image to the blocklist) and search of the stored hashes, on token-protected routes | yes | yes | no | 13.14 |
| B2: hash of every image stored (`copyright_image_hashes`: new images by the sweep, old ones by the backfill job) | yes | yes | no | both off by default (13.13) |
| B2 for B3: job generations, requeue (rerun / resume), per-image results (`copyright_image_hash_results`), jobs for ad id and URL blocks, `unresolved` | yes | yes | no | 13.15; the URL part is limited by missing indexes |
| B2 stage 4: check of NEW ads (sweep) | yes | yes | no | exact copies only; uncommitted |
| B2: near-copy distances | — | — | no | **not tuned**, so near-copy matching stays off |
| B3 takedown, B6 audit | — | — | — | Anij's; they only read what B1/B2 write |
| Intake (form / agent), Oracle seed, other networks' images, TikTok images | no | — | — | later |

Tests: `npx vitest run tests/compliance tests/insertion/InsertionEngine tests/app tests/admin tests/jobs` → 28 files, 784 tests pass. The whole
`pas_node_api` suite still has the same 170 failing tests in 46 files as before this work.

## The compliance flow today (B1 → B2 → B3 → B6)

How a complaint becomes a block, end to end. `[built]` = code exists (tested with fakes only); `[not built]` = still to do.

```
 1. INTAKE   an advertiser name arrives from the landing-page form (the form and any approval step are not ours); the form calls POST /api/v1/copyright/advertiser/block
        │     (13.10), which runs submitAdvertiser(): search, block, queue the hashing, answer at once (13.9)    [built; the approval agent in front is future work]
        ▼
 2. BLOCKLIST  copyright_blocklist, one row per entry: type (advertiser / page / ad_id / url / domain / image_hash), value,
        │      network (or "all"), added_by, reason, complaint_id, status, dates                                               [built: B1]
        │      ── every server keeps this list in memory and refreshes it about every 30 s
        ▼
 3. COLLECTION  every new ad is checked while it is saved (12 networks + TikTok): name (with spelling variants), ad id, URL, domain
        │      match  → the ad is refused (422), nothing is stored or uploaded, one row in copyright_blocked_attempts           [built: B1]
        │      the downloaded image is also looked up by its SHA-256 among the banned images (exact copy only, local, `1 ms)   [built: B2, off by default]
        │      list not loaded → fail mode: closed (503) or open (per network setting)
        ▼
 4. HASHING  the cron job imageHashJobs finds each blocked advertiser that has no job yet and makes one (copyright_image_hash_jobs)
        │      (also: `imageMatch.backfill` records the hash of every stored image, `sweep.recordHashes` of every new one: 13.13)
        │      → finds the advertiser's OLD ads → their stored images → hashing service (DS) → one image_hash entry per image,
        │        added to the blocklist with the same complaint_id. Read-only on the ad tables; a job survives restarts            [built: B2]
        ▼
 5. NEW ADS  the same cron job, every pass: ads added since the saved cursor → their images → hashing service →
        │      compared in memory with the banned images → a match goes to copyright_review_queue (pending) and to
        │      copyright_blocked_attempts. Nothing is deleted or changed. Exact copies only until the distances are tuned.      [built: B2, off by default]
        ▼
 6. REVIEW   a person or the approval agent decides each held image: GET /review, POST /review/:id (a block also bans the image)  [built; nobody named yet]
        ▼
 7. TAKEDOWN B3 (Anij) deletes the advertiser's OLD ads in batches, ONLY AFTER its hash job is "done" (the images must exist to be
        │      hashed), and writes its run and action tables                                                                   [B3's work]
        ▼
 8. AUDIT    B6 (Anij) checks that nothing blocked is left and keeps the complaint, items and audit findings                      [B6's work]
```

| Step | Who | Changes data in | Deletes? |
| --- | --- | --- | --- |
| 1 Intake | form / agent / admin | `copyright_blocklist` (via `add()`) | no |
| 2–3 Blocklist and check at collection | B1 (this repo) | `copyright_blocklist`, `copyright_blocked_attempts` | no |
| 4–5 Hashing and new-ad sweep | B2 (this repo) | `copyright_blocklist` (image_hash), `copyright_image_hash_jobs`, `copyright_review_queue`, `copyright_blocked_attempts` | no |
| 7 Takedown | B3 | ad tables, `copyright_takedown_*` | yes (batches) |
| 8 Audit | B6 | `copyright_complaints`, `copyright_audit_*` | no |

Rules that hold across the steps:
- B1 and B2 only **add** to the blocklist and never delete anything; only B3 deletes, and only after step 4 is done for that advertiser.
- Every new behaviour is **off by default** and driven by `config.json` (per server, not in git); nothing needs a manual script once it is switched on.
- Old ads are handled by steps 4 and 7; new ads by steps 3 and 5. The sweep never scans old ads.
- **An ad is always identified by the platform's (scraper's) ad id**, never by our own row id: B1 matches `ad_id` entries against the payload's
  platform id, the hash job writes it as `ad_id` in an `image_hash` entry's `details` (our row id is kept beside it as `internal_ad_id`), and the
  sweep writes it to `copyright_review_queue.platform_ad_id` and `copyright_blocked_attempts.platform_ad_id`. Our row id (`facebook_ad.id`) is used
  only as a cursor to page through the table. B3 / B6 should read `ad_id` as the platform id.
- The check at step 3 uses only in-memory data; steps 4 and 5 run in the background and never slow down saving an ad.

## 1. What it does

Every ad that arrives through the insertion API is checked, in memory, against the network's blocklist **before** validation,
SQL writes, NAS upload, translation or Elasticsearch. A blocked ad gets a rejection and a log row; nothing else happens.

```
scraper / extension
      │
  insertionAuth ─► controller ─► InsertionEngine.safeProcess
                                      │ 1. owner deny-list            (existing, config.json)
                                      │ 2. blocklist.guard(ad, network)   ← NEW, no DB call
                                      ▼ allowed
                                  processOne(ad)  ─► SQL · NAS · ES
```

- The check is a `Map` lookup on an in-memory snapshot. The database is only read by a background refresh (default every 30 s).
- Skipped for the delete endpoints (they already pass `applyPostOwnerRejection: false`), so takedowns still work on blocked ads.
- Covers the 12 insertion networks through the shared engine: facebook, instagram, google, gdn, youtube, linkedin, reddit,
  quora, pinterest, native, admob, chatgptads. TikTok has its own insertion service — see section 9.

## 2. Folder structure

### pas_node_api

```
src/compliance/blocklist/        flat, like services/facebook/insertion
  service.js       the check (guard) and the public functions (init, add, revoke, listActive,
                   getImageHashes, recordAttempt, status, shutdown); applies the fail mode
  constants.js     entry types, matching families, load statuses
  cache.js         per-network snapshot, background refresh, saved copy on disk
  repository.js    the only file that runs SQL for the blocklist
  attempts.js      batched writer for copyright_blocked_attempts
  normalize.js     ids, names, URLs, domains
  extract.js       which payload fields carry what (configurable)
  match.js         snapshot builder + the matching rules

src/compliance/imagematch/       B2: client.js, matcher.js, sources.js, job.js, worker.js (see section 13)

src/config/index.js              + compliance.blocklist and compliance.imageMatch sections (settings)
src/jobs/cronManager.js          + imageHashJobs (B2 worker, lazy-loaded, off until enabled)
src/insertion/InsertionEngine.js + one call to blocklist.guard
src/app.js                       + blocklist.init() after the databases connect
src/server.js                    + blocklist.shutdown() (flushes pending attempts)
scripts/apply-copyright-schema.js  + copyright_blocked_attempts (B1); B2: 256-bit hash columns, copyright_image_hash_jobs
tests/compliance/blocklist/      attempts, attempts.failures, cache, cache.images, config, dependencies, engineIntegration,
                                 extract, knobs, match, networks, normalize, repository, service, workflow (+ helpers.mjs)
tests/compliance/imagematch/     client, matcher, job (with a local fake hashing server), worker (cron, new-ad sweep)
```

### api_tiktok_nodejs

```
core/blocklist/                  same design, ESM, Sequelize, single network
  blocklist.constants.js  blocklist.normalize.js  blocklist.extract.js  blocklist.match.js
  blocklist.repository.js blocklist.cache.js      blocklist.attempts.js blocklist.service.js
core/tiktok/tiktok.service.js    + guard at the start of create() and update()
project.server.js                + blocklist.init() after the database connects
tests/core/blocklist/            attempts, cache, extract, hardening, normalize, repository, service
tests/core/tiktok/tiktok.blocklist.test.js
```

## 3. Configuration

All settings live in `config.json` under `compliance.blocklist` (read in `src/config/index.js`). Invalid values fall back to,
or are clamped to, safe values. Nothing is hardcoded.

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Master switch. Off means no check and no DB reads. |
| `failMode` | `closed` | If a network's list cannot be loaded: `closed` rejects its ads with 503, `open` lets them through (logged). Any other value means `closed`. |
| `refreshSeconds` | `30` (5–3600) | How often each network's list is re-read. |
| `imageRefreshSeconds` | `60` (5–86400) | How often the NEW banned images (B2) are read (only rows after the last id). |
| `imageFullReloadSeconds` | `900` (60–86400) | How often all banned images are read again (picks up removals and expiries; a revoke does it at once). |
| `refreshJitterPercent` | `20` (0–50) | Random extra delay per process, as a % of `refreshSeconds`, so a cluster's workers do not all read the databases in the same second. `0` = none. |
| `openWarnSeconds` | `60` (5–3600) | With `failMode: open`, "ads are NOT being checked" is logged at most once per this many seconds per network. |
| `maxUrlsPerAd` | `200` (1–1000) | Most URLs checked from one ad (a huge carousel is cut here). |
| `loadTimeoutMs` / `pageSize` | `5000` / `5000` | Timeout and page size for the load query. |
| `emptyRefreshGuard` | `true` | A refresh returning 0 rows after a non-empty list is treated as a failure (last good list kept). |
| `networks` | `[]` | Networks covered. Empty means the networks in the existing networks config (config.json) that have SQL enabled and an `insertion` block and a connected database. Nothing is listed in the code; a network added to the config is picked up automatically. |
| `response` | `422`, generic message | Code (400–499) and message for a blocked ad. It never names a complaint or entry. |
| `unavailable` | `503`, generic message | Code (500–599) and message when the list is unavailable and `failMode` is `closed`. |
| `attempts` | `100` / `5` s / `10000` | `batchSize`, `flushSeconds`, `maxQueue` for the rejected-attempt log. |
| `snapshot` | enabled, `data/compliance-blocklist` | Saved copy of the last good list (see section 6). |
| `rules` | all `true` | Switch off `adId`, `advertiser`, `advertiserVariant`, `url` or `domain` matching. `advertiserVariant` also needs `advertiser` on. |
| `compactMinLength` | `4` (2–20) | Shortest advertiser name (letters and digits only) that gets the spelling-proof match (see "Spelling variants"). |
| `fields` | `{}` | Per-network payload field overrides: `{"*": {...}, "reddit": {"advertiser": ["post_owner"]}}`. |

Env overrides: `BLOCKLIST_ENABLED`, `BLOCKLIST_FAIL_MODE`, `BLOCKLIST_REFRESH_SECONDS`, `BLOCKLIST_SNAPSHOT_DIR`.

```json
"compliance": { "blocklist": {
  "enabled": true, "failMode": "closed", "refreshSeconds": 30,
  "networks": ["reddit"]
} }
```

## 4. Database

Tables are created by the shared schema script (section 8), in each network's own database. B1 uses two of them.

**`copyright_blocklist`** (definition owned by the team script) — columns B1 reads or writes:
`id, network, entry_type, value, value_sha256, reason, source, complaint_id, status, expires_at, details, created_at, updated_at, added_by`.
`added_by` is `NOT NULL` with no default, so every insert must supply it. The other columns (`image_sha256`, `image_phash_*`, `removed_at`,
`removed_by`) are nullable; the image columns belong to B2, and re-adding an entry clears `removed_at` and `removed_by`.
Unique key `(network, entry_type, value_sha256)`. Rows are never deleted; an entry is active when `status = 'active'` and not expired.
`network` is a network slug or `all`.

**`copyright_blocked_attempts`** (added for B1) — one row per rejected ad, identifiers only, never the payload:
`id, network, platform_ad_id, advertiser, image_url, blocklist_id, match_type, distance, source, created_at`.
Indexes: `(network, created_at)` and `blocklist_id`.

Queries (all in `repository.js`):

| Query | When | Notes |
| --- | --- | --- |
| load active entries | startup, then every `refreshSeconds` | two queries, one per scope (`network = <slug>`, then `network = 'all'`), each `status='active'` and `entry_type <> 'image_hash'`, expiry honoured, keyset pagination on `id`, only `id, entry_type, value` |
| load banned images (B2) | same refresh, own query | same shape with `entry_type = 'image_hash'`; reads `image_phash` (CHAR(64) hex); a failure here never affects the matching list |
| upsert entries | `add()` | one multi-row `INSERT ... ON DUPLICATE KEY UPDATE`; re-activates, never duplicates |
| read back ids | `add()` | one `SELECT id` per entry type through the unique key, `value_sha256 IN (...)` in chunks of 500 |
| revoke entries | `revoke()` | `UPDATE ... WHERE id IN (...) AND status = 'active'` in chunks of 500; never a `DELETE` |
| insert attempts | background flush | one multi-row `INSERT` per batch |

The per-ad check runs **no query**.

### Load on the database

- **Why two equality queries, not `network IN (?, 'all')`:** with equality on `network` and `status`, MySQL reads the
  `(network, status)` index already in `id` order, so there is no filesort and `id > ?` is a range seek. An `IN` list would sort the
  whole filtered set again on every page. No extra index is needed.
- **Refresh traffic:** each worker re-reads each network's list every `refreshSeconds` (default 30 s, plus up to 20 % random jitter per
  process so workers do not hit the databases in the same second). That is 2 queries per refresh while a list fits in one page
  (`pageSize` 5000). Estimate: 2,000 entries, 8 workers, 30 s gives about 500 rows/s and tens of KB/s per network database. At 100,000
  entries it would be a few MB/s per database, so keep a network's list well under ~50,000 entries or raise `refreshSeconds`.
- **Banned images (B2) are not re-read in full.** They can be tens of thousands, so after the first load the cache reads only the rows with an id
  above the last one it has (`imageRefreshSeconds`, and at once after an `add()`), and all of them every `imageFullReloadSeconds` (and at once after a
  `revoke()`). An unchanged list is not rebuilt (a fingerprint of the ids decides) and not written to the saved copy on disk again. Measured on an
  in-memory table while a hash job adds 10,000 images in 50 batches: 255,000 image rows read before, 10,000 now (25 times fewer), 364 ms to 49 ms.
  A new image whose id is lower than the last one seen (committed late) or a re-activated old entry is picked up by the next full reload, so a
  change reaches the matcher within `imageFullReloadSeconds` at most (a revoke: at once).
- **Attempt logging:** rows are buffered per worker (`maxQueue`, default 10,000) and written 100 at a time (or every 5 s), as one
  statement. A scraper retrying blocked ads therefore costs about one insert per 100 rejections, and never slows the rejection itself.
- **Connections:** the refresh holds one pool connection for a few milliseconds per query; a hung load is cut off by `loadTimeoutMs`.
- **Measured (CPU only, no database):** the per-ad check takes about 13 microseconds with a 100,000-entry list and about 0 when the
  feature is disabled; a 100,000-entry snapshot builds in ~120 ms and holds ~23 MB.
- **Not yet measured on a real database.** After the tables exist in dev, confirm the plan with:
  `EXPLAIN SELECT id, entry_type, value FROM copyright_blocklist WHERE network='reddit' AND status='active' AND id>0 AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP()) ORDER BY id LIMIT 5000;`
  Expect `key: idx_blocklist_status` and no `Using filesort`.

The shape of these queries is pinned by `tests/compliance/blocklist/repository.test.mjs` (equality filters, `ORDER BY id`, integer `LIMIT`,
no `IN`, `OFFSET` or `SELECT *`, one statement per batch).

### Entry types

| `entry_type` | Matched against |
| --- | --- |
| `ad_id` | platform ad id (case-sensitive; `123` equals `"123"`) |
| `advertiser`, `page` | advertiser / page name (NFKC, trimmed, lowercased, whitespace collapsed) |
| `url`, `image_url` | every image, thumbnail, video, carousel and destination URL |
| `domain` | host of the destination URL and its parent domains (`a.b.com` also matches `b.com`, never `notb.com`) |
| anything else, e.g. `image_hash` | ignored by B1 (owned by B2) |

### Spelling variants of an advertiser name

An advertiser can be written many ways. One `advertiser` or `page` entry also blocks the other spellings: besides the
exact match, the name is compared with spaces, punctuation, case and Latin accents ignored. So an entry `Twinkling Tree`
blocks `TwinklingTree`, `twinkling-tree`, `Twinkling_Tree` and `Twinkling.Tree`, but not `Twinkling Trees` or `Tree Twinkling`.

- The comparison is a second in-memory map built with the list; no extra database query and no schema change.
  Measured with 100k entries: about 0.7 µs more per ad, and about 12 ms more to build the list at each refresh.
- Names shorter than `compactMinLength` letters and digits (after removing punctuation) keep only the exact match, so a
  2-3 letter name cannot block unrelated advertisers.
- Only Latin accents are removed. In Devanagari, Arabic and similar scripts the marks belong to the letters, so they are kept.
- A typo (a wrong or missing letter) is not matched. That needs fuzzy matching, which is too slow for the insertion path;
  it belongs in the admin tool as a suggestion, not in the check.
- Switch off with `compliance.blocklist.rules.advertiserVariant: false`.

URL normalization ignores scheme, `www.`, query string, fragment, port, trailing slash and image size tokens
(`/150x150/`, `_300x250`, `=w300-h200`), keeps path case, and ignores `data:` URIs.

## 5. Payload fields

Defaults are the union of the field names the insertion pipelines read. Override per network in `compliance.blocklist.fields`.

| Group | Default fields |
| --- | --- |
| ad id | `ad_id` |
| advertiser | `post_owner`, `post_owner_name`, `advertiser_name`, `advertiser_id`, `advertiser` |
| image / video URLs | `image_video_url`, `image_url`, `image_url_original`, `ad_image`, `ad_video`, `thumbnail`, `thumbnail_url`, `video_url_original`, `post_owner_image` |
| list URLs (`\|\|,` `\|\|` `\|` separated) | `other_multimedia`, `othermedia`, `othermultimedia` |
| destination | `destination_url` (also used for the domain rule) |

`reddit_id` is deliberately not used: on Reddit it is the discovering user, not the advertiser. Field names were read from the
code, not from live payloads — compare against one real payload per network in dev.

## 6. Failure behavior

Per network, the list is in one of four states:

| State | Meaning | Ads |
| --- | --- | --- |
| `ready` | loaded from the database | checked |
| `stale` | a later refresh failed; last good list kept | checked |
| `from_file` | database unreachable at startup; loaded the saved copy | checked |
| `unavailable` | nothing loaded | follows `failMode` (503 when `closed`) |

- Every successful load also writes `blocklist-<network>.json` (atomic rename) under the snapshot directory.
- One network failing never affects another.
- Refreshes never overlap, and a hung load is cut off by `loadTimeoutMs`.
- If startup itself crashes while enabled, `status()` reports `startupError` and `failMode` still applies to every ad.
- A failure writing attempt rows never fails the rejection; rows are kept and retried (bounded by `maxQueue`).

## 7. Public API (`service.js`)

B1 is the base the other compliance jobs build on. Everything below is exported by `src/compliance/blocklist/service.js`.

| Function | Used by | Purpose |
| --- | --- | --- |
| `await init()` | server, scripts | start once per worker, after the databases connect; no-op when disabled |
| `guard(ad, network, { source })` | B1 | `null` if allowed, otherwise the rejection result. Synchronous, no DB call. |
| `await add(entries)` | B3, B6, seeding | put entries on the list. Every result lists the entries it wrote **with their ids**. |
| `await revoke(refs, { removedBy, approvedBy? })` | B5, B2 test cleanup | soft-remove entries by `{ network, blocklistId }` |
| `await listActive(network)` | B6 audits | every active entry and banned image, read from the database |
| `getImageHashes(network)` | B2 | the banned images in memory: `{ available, status, hashes: [{ id, sha256, phash (Uint32Array of 8 words, or null), algo }] }` |
| `recordAttempt(input)` | B2 | log a rejection through the same batched writer |
| `status()` | health | per-network state, pending / dropped / refused attempt rows |
| `await shutdown()` | server, scripts | stop timers and flush pending attempt rows |

`add`, `revoke` and `listActive` work whether or not ingestion enforcement is switched on, so a takedown never depends on that flag.
A script outside the server must connect the databases, call `init()`, and call `shutdown()` before it exits. Without `init()` they
reject with "blocklist is not initialised" (always a rejected promise, never a synchronous throw).

### `add(entries)`

Entry: `{ entryType, value, addedBy, network?, reason?, source?, complaintId?, expiresAt?, details? }`.

- `addedBy` (a person, script or service name) is required; an entry without it is returned in `rejected` with the reason.
- `network` is `all` (default, written into every covered network's database as an `all` row) or one slug.
- **Image hashes (B2):** `{ entryType: 'image_hash', imageSha256, imagePhash?, imagePhashAlgo?, addedBy, ... }`. `value` is not used. The stored
  `value` is the lowercase `imageSha256` and `value_sha256 = sha256(value)`, as the schema script documents. `imagePhash` is the 256-bit
  hash as 64 hex characters (any case; stored lowercase; anything else is refused with a reason); `imagePhashAlgo` is the hash version, e.g.
  `sscd-simhash-v1` (letters, digits, `_`, `-`; up to 16), and is required with it.
- Other types use `value_sha256 = sha256("<family>:<normalized value>")`, so equivalent URLs, domains and names map to one row.
- `value` may be at most 2048 characters (the column size, like the URL columns of the ad tables). A longer value is returned in `rejected`,
  never cut, because a cut entry would never match.

Returns `{ rejected: [{ entry, reason }], results: [{ network, ok, count, error?, entries: [{ entryType, value, valueSha256, blocklistId }] }] }`.
`blocklistId` is the row id **in that network's database**: B3 and B6 store it, with the `network`, in their link tables
(`copyright_takedown_blocklist_entries`, `copyright_complaint_blocklist_entries`). A partial failure is visible per network and the write is
idempotent, so it is safe to re-run. Re-adding a revoked entry re-activates the same row.

### `revoke(refs, opts)`

`refs`: `[{ network, blocklistId }]`, with the ids returned by `add()`. `opts.removedBy` is required; `opts.approvedBy` (B5) is recorded as
`"<removedBy> (approved by <approvedBy>)"`. Only rows that are still active change; nothing is ever deleted. Returns
`{ invalid: [...], results: [{ network, ok, requested, revoked, error? }] }`. The in-memory list is refreshed immediately, and removing the last
entry takes effect at once.

### What B2 does with it

Compare an image in memory against `getImageHashes(network).hashes` (exact on `sha256`; near by the number of differing bits of `phash`),
log a rejection with `recordAttempt`, and, if `available` is false, apply B2's own fail mode. The banned images are loaded by a separate query,
so a problem there can never stop the ingestion matching list. `phash` is the 256-bit hash of the image-hashing service, kept in the database
as `CHAR(64)` hex and in memory as a `Uint32Array` of 8 words (`src/compliance/imagematch/matcher.js`); the comparison is
`src/compliance/imagematch/matcher.js` (`decide`). It is done in the application, not in SQL, because `BIT_COUNT` is 64-bit.

## 8. Scripts

### `scripts/apply-copyright-schema.js` (team script; covers B1, B2, B3 and B6)

Creates and validates the 14 copyright tables in every distinct SQL database. Dry-run by default; existing tables are validated
(columns, types, nullability, character set and collation, indexes), never altered; no foreign keys; one failing database never stops
the others. Every text column names its collation explicitly, so the post-create validation passes.

```
node scripts/apply-copyright-schema.js                      # dry-run, all SQL databases
node scripts/apply-copyright-schema.js --only=B1            # just the B1 tables
node scripts/apply-copyright-schema.js --networks=reddit    # one network
node scripts/apply-copyright-schema.js --show-ddl           # also print the DDL
node scripts/apply-copyright-schema.js --apply --confirm-prod   # create missing tables
```

`--apply` is refused without `--confirm-prod`, and always asks you to type `create copyright tables in production` (in every environment).

### Tests

```
cd pas_node_api
npx vitest run tests/compliance tests/insertion/InsertionEngine.test.mjs tests/app.test.mjs --coverage.enabled=false
```

Result when B1 alone was finished: 17 files, 210 tests pass (now 28 files, 661 tests with B2 and the folders listed in "Status at a glance"). `workflow.test.mjs` runs the real cache and service on an in-memory copy of the table and walks the
flows B3 (add, undo), B2 (banned images, attempts) and B6 (audit reads) use on top of B1.

## 9. TikTok (`api_tiktok_nodejs`)

TikTok ads are inserted by this separate service (`POST /v1/tiktok/create`, `PUT /v1/tiktok/update`), not by the shared engine,
so the same check was ported to ESM + Sequelize.

- Guard at the very start of `create()` and `update()`, before the transaction, Elasticsearch lookup, translation or NAS upload.
- Settings come from the `config` package under `compliance.blocklist` (same keys, same env overrides). Default saved-copy directory:
  `resources/logs/responselogs/compliance-blocklist` (already git-ignored).
- Fields: `ad_id`; advertiser `post_owner`, `tiktok_account_name`, `tiktok_account_id`; URLs `video_cover`, `video_url`, `destination_url`.
  `library_url` is not matched (it is TikTok's own Creative Center page).
- Response uses the project's shape: `{ statusCode, body: { status: "failed", message, error } }`.
- TikTok is in the default network list because its entry in the networks config has SQL enabled and an `insertion` block, so `add()` also
  writes entries into TikTok's database. Nothing in `pas_node_api` calls `guard()` for it.

Not covered, on purpose: `/v1/metadata`, `/v1/owner`, `/v1/variants`. They cannot create an ad (their `ad_id` is the internal row id),
so the only gap is attaching a blocked URL's text to an existing ad.

Tests: `tests/core/blocklist/*` and `tests/core/tiktok/tiktok.blocklist.test.js` — 83 tests pass (the three tuning keys above are supported there too). This project has no `node_modules`
in the working tree, so they were run from a temporary copy using `pas_node_api`'s vitest. The existing `tiktok.service.test.js`
passes 115 of 115 with and without these changes (with a stub for the `sequelize` package).

## 10. Rollout

1. Dev: run the schema script in dry-run, then `--only=B1 --apply`.
2. Dev `config.json`: `compliance.blocklist.enabled: true` and `networks` set to one network.
3. Add a test entry with `add()`, send a matching ad: expect a 422, no database row, no storage object, one row in `copyright_blocked_attempts`.
4. Repeat for the other networks and for TikTok.
5. Production: DevOps supplies each network's host and database; the schema script runs with the typed confirmation; enable per network.

## 11. Known limits and open items

| Item | Detail |
| --- | --- |
| Not run on a real database | the Sequelize and MySQL queries are covered only with fakes |
| Field names | read from code, not live payloads |
| Entry-type vocabulary | `ad_id, advertiser, page, url, image_url, domain` — confirm with the B2/B3/B6 owners |
| Seed script | not written; waiting for Oracle's list (and whether its ad ids are the platform's or ours). `add()` is ready. |
| TikTok database | confirm the schema script's TikTok database is the one `api_tiktok_nodejs` connects to |
| TikTok shutdown | that project has no SIGTERM handler, so pending attempt rows (a few seconds' worth) can be lost on restart |
| Health endpoint | `status()` exists but is not wired into `src/health` |
| B2 image matching | B1 stores and serves the banned images (`getImageHashes`); the comparison is B2's (section 13). B1's own matching ignores `image_hash` rows. The distances are not tuned, a person to look at `copyright_review_queue` is not named, and what happens to a held ad beyond the queue (B3's takedown) is not decided. |
| Intake of advertisers | the form on the landing page, the approval agent and the admin screen are not built. Today an advertiser gets into the blocklist through `add()` only; the hashing worker then handles it by itself. |
| Non-ASCII ad ids in the attempts log | `platform_ad_id`, `network`, `match_type` and `source` are ASCII columns, so other characters are stored as `?` (the row is kept). |
| Attempt rows the table refuses | dropped, logged at error level and counted in `status().rejectedAttempts`; they never block the rest. |
| Older tables | a table created without the image-hash columns only disables `getImageHashes` (`available: false`); ingestion matching keeps working. |
| TikTok | has the check and the attempts hardening, but not `add` / `revoke` / `listActive` / image hashes (those run from `pas_node_api`, which writes into TikTok's database). |

Pre-existing, unrelated: the full `pas_node_api` suite has 170 failing tests in 46 files, the same set recorded before this work.

## 12. Dependencies on other work

| Needs | From |
| --- | --- |
| tables `copyright_blocklist` and `copyright_blocked_attempts` | the schema script (run in dev/prod) |
| agreed `entry_type` names | B2, B3, B6 owners |
| Oracle's list (format) | whoever holds the complaint |
| production hosts and database names | DevOps |
| the hashing service address and key (`IMAGE_HASH_API_URL`, `IMAGE_HASH_API_KEY`; the key shown in earlier screenshots should be rotated) | DS team |
| deleting an advertiser's old ads only after its hash job is `done` (the images must exist to be hashed) | B3 owner |

| Others depend on B1 for | Provided by |
| --- | --- |
| adding entries after a takedown, and the ids to store in the run link table (B3) | `add()` (results carry `blocklistId` per network) |
| undoing a block, soft (B3, B5) | `revoke()` |
| the entries to audit, and the ids for the complaint link table (B6) | `listActive()`, `add()` |
| the banned images and a place to log rejections (B2) | `getImageHashes()`, `recordAttempt()`; image entries are written with `add()` (`image_hash`) |
| removing test entries after the false-positive test (B2) | `revoke()` |

## 13. Image matching (B2)

Status: written and tested with mocks; **nothing has been run against a real database or the real hashing service yet**. The check at
ingestion is not built (an ad is not stopped while it is being saved); new ads are checked a little later by a sweep (13.6), which holds a match for a
person and deletes nothing. Everything is OFF by default.
Scope: altered copies of a banned image (resized, recompressed, lightly cropped) are caught even when they arrive under a new ad ID or another
advertiser. B1 stops by name, ad id, URL and domain; this part stops by picture.

### 13.1 How it fits together

```
banned images ── copyright_blocklist (entry_type = image_hash, one row per banned image)
                      │  loaded in memory per network: blocklist.getImageHashes(network)
                      ▼
new image ── image-hashing service (sha256 + 256-bit sscd hash) ── matcher.decide() ── reject | review | allow
```

The banned images are read by B1's list refresh, never per ad: the comparison runs in memory. `copyright_image_hashes` (one row per image seen)
is only read by offline B3 / B6 sweeps, never by ingestion.

### 13.2 The image-hashing service (DS team)

Swagger: `https://img-hashing-local-blr.poweradspy.ai/docs` ("SSCD Hash API").

| Endpoint | Use |
| --- | --- |
| `POST /v1/hash-url` | JSON `{ "image_url": "..." }` (max 2083 characters); the service downloads the image |
| `POST /v1/hash` | multipart field `image`; the image is uploaded |
| `GET /health` | `{ "status": "ready", "hash_version": "sscd-simhash-v1", "hash_bits": 256 }` (no key needed) |

The two POST calls need the header `X-API-Key` (401 otherwise). **One image per call.** The answer is `{ "sscd_hash": "<64 hex>", "sha256": "<64 hex>" }`:
256 bits as hex (checked on a real answer), and the SHA-256 of the file's bytes (checked against `sha256sum`).
Limits: 50 MB and 40 million pixels (413), smaller than 32x32 (422), 20 s to download a URL (422), 5 redirects, public `http(s)` only.
Stored images are served from the public CDN (`config.cdn.baseUrl` + the stored path), so `/v1/hash-url` works on them; `toFetchableUrl()` builds the URL
with exactly one `/` between base and path (`host//path` is a 404 there).

### 13.3 Code (`src/compliance/imagematch/`)

| File | Purpose |
| --- | --- |
| `client.js` | `ImageHashClient` (`hashUrl`, `hashFile`, `health`): retries, a cap on calls in flight, never throws, never logs the key. Outcomes: `ok`, `skip` (this image cannot be hashed), `unauthorized`, `rejected`, `unavailable`, `bad_response`, `not_configured` |
| `matcher.js` | The 256-bit hash as 8 words (`parseHash`, `toHex`, `hammingDistance`) and `decide(banned, image, options)` → `reject` (exact sha256, or a near copy), `review` (close, not enough to reject), `allow`, or `unavailable` (the list cannot be trusted: the caller applies its fail mode). Hashes of another version are never compared. Measured: 0.03 ms per image against 1,000 banned images, 0.35 ms against 20,000, 2 ms against 100,000 |
| `sources.js` | The checked table map of each supported network (Facebook only), the read-only queries on it (index lookups with a LIMIT), the usual spellings of an advertiser's name, and the URL of a stored image |
| `job.js` | `HashJob`: hashes one blocked advertiser's images and adds them to the blocklist as `image_hash` entries |
| `worker.js` | The SQL of `copyright_image_hash_jobs`, the job's saved place (in its row), `HashWorker` (claim, run, retry, pause), `NewAdSweeper` (the check of new ads, 13.6) and the cron tick (`runImageHashJobs`, registered in `src/jobs/cronManager.js` as `imageHashJobs`) |

Tests: `tests/compliance/imagematch/` (client, matcher, job and pipeline, worker and cron).

### 13.4 Settings (`compliance.imageMatch`, `src/config/index.js`)

| Setting | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | `""` | Address of the service (`IMAGE_HASH_API_URL`) |
| API key | — | **Environment only**: `IMAGE_HASH_API_KEY`. Never in `config.json` |
| `timeoutMs` / `concurrency` | `30000` / `4` | Per call; calls in flight at once |
| `maxConcurrency` | `0` (off) | Above `concurrency`: the client adds one call at once after 20 answers in a row and halves the number on 429 / 5xx / timeout, never above this. Set it once the DS team says how many calls the service can take |
| `retries` / `retryDelayMs` | `2` / `500` | For network errors, 429 and 5xx; the wait doubles each time |
| `maxFileBytes` | 50 MB | Larger files are not uploaded |
| `hashVersion` | `sscd-simhash-v1` | Hashes of another version are not compared |
| `perceptual.enabled` | `false` | Near-copy matching. Off: only an exact copy (same sha256) is caught |
| `perceptual.rejectDistance` / `reviewDistance` | `0` / `0` | Bits (0..256) up to which an image is rejected / held for a person |
| `enabled` | `false` | Reserved for a check inside ingestion; not used |
| `sweep.enabled` | `false` | The check of new ads (13.6). Needs `true` |
| `sweep.recordHashes` | `false` | Also hash and record every new image in `copyright_image_hashes`, even while nothing is banned (13.13). Costs a call of the service per new image |
| `backfill.enabled` / `pageSize` / `fromId` | `false` / `100` / `0` | Hash and record every image already stored, with the cron pass's spare time (13.13); ads per page (1..500); start after this ad id |
| `sweep.pageSize` / `sweep.budgetShare` | `100` / `0.4` | Ads per page (1..500); the part (0.1..0.9) of a cron pass's time the sweep may use before the hashing jobs get the rest |
| `worker.*` | see below | `networks` (empty = every supported network with SQL), `staleClaimMinutes` 60, `maxAttempts` 3, `pauseSeconds` 300, `newJobsPerTick` 100, `maxJobsPerTick` 20, `maxImagesPerJob` 50,000, `addedBy` |
| `job.*` | see below | `pageSize` 200 ads per page, `pageDelayMs` 200 between pages, `maxImages` 10,000, `includeCarousel` false, `maxConsecutiveFailures` 20, `addBatchSize` 200, `maxOwners` 20 |

The distances are **not tuned**: set them from real altered copies and a sample of unrelated images before turning `perceptual.enabled` on.
The hash is stored as `CHAR(64)` hex (`copyright_blocklist.image_phash`, `copyright_image_hashes.phash`, `copyright_review_queue.phash`; `distance` is
`smallint`). `BIT_COUNT` is 64-bit, so the distance is computed in the application, never in SQL.

### 13.5 Hashing a blocked advertiser's images: automatic

**Nobody runs anything for an advertiser.** It is a job of the project's cron manager (`config.crons.jobs.imageHashJobs`, `src/jobs/cronManager.js`):
it starts with the server, runs on one process of a machine (`isSingletonOwner`), a tick that is still working makes the next skip, and two machines
never take the same job (an atomic claim in the database). It is OFF until enabled in `config.json` (per server, not in git):

```json
"crons": { "jobs": { "imageHashJobs": {
  "enabled": true, "schedule": "1 min", "timeBudgetSeconds": 240, "window": ""
} } }
```

One-time set-up besides enabling it: the copyright tables in each network's database (`scripts/apply-copyright-schema.js`, including
`copyright_image_hash_jobs`), and `IMAGE_HASH_API_URL` / `IMAGE_HASH_API_KEY` in the environment.
`timeBudgetSeconds` (10–3000) is the longest a tick works; then the job stops after its page, goes back to the queue with its place saved (the try is not
counted) and the next tick continues, so the load is steady however big an advertiser is. `window` (optional, `"HH:MM-HH:MM"` in the crons timezone;
overnight works) limits hashing to quiet hours; an invalid window pauses hashing and is logged once.

Each tick, for each network:

1. finds blocklist entries of type `advertiser` / `page` that have no job yet and creates one job each (whatever put the advertiser in the blocklist is
   picked up; only names, a platform id entry is not looked up by name);
2. claims the oldest waiting job (or one whose worker has shown no sign of life for `staleClaimMinutes`) and runs it: owner (by exact lowercase name and
   its usual spellings, via an index) → its ads, 200 per page, with a pause → each ad's stored image → the service → one `image_hash` entry per distinct
   image, with the entry's `complaint_id`; `details` holds the job, owner id, ad id and stored path, so B3 and B6 can find the ad;
3. records how it ended: `done`, `no_owner` (no advertiser of that name has ads), `limit_reached` (the image cap), `failed` (gave up after `maxAttempts`,
   or the request cannot work; see `last_error`), or back to `pending`. A bad key, a service that is not ready or a wrong hash version pauses the worker
   for `pauseSeconds` and does not count as an attempt.

It only reads the ad tables (index lookups with a LIMIT, no OFFSET or LIKE; indexes checked on dev only) and writes only `copyright_blocklist` and
`copyright_image_hash_jobs`; it never deletes. A restart continues where it stopped. Images with no stored file, only the default image, or that the
service cannot hash (under 32x32, too large) are skipped and counted. Only Facebook is supported: another network needs its tables checked and an
entry in `sources.js`. Carousel images are off until the index on `facebook_ad_image_video` is checked.

**Order with deletion (B3):** the images must exist to be hashed, so an advertiser's images should be deleted only after its hash job is `done` (or
`no_owner`): see its row in `copyright_image_hash_jobs` (`blocklist_id` / `complaint_id`).

### 13.6 New ads: the sweep (stage 4)

Part of the same cron job (`imageHashJobs`); OFF until `compliance.imageMatch.sweep.enabled` is `true`. **Nothing changes in insertion**: no new
work and no new failure while an ad is saved. A new ad is checked within a few minutes of being saved.

```
new ads (id after the saved cursor) -> their stored images -> hashing service -> matcher.decide() against the banned images in memory
        -> match: a pending row in copyright_review_queue + a row in copyright_blocked_attempts (source "imagematch-sweep")
```

- **Only new ads.** The cursor is made when the sweep first runs, at the newest ad id; older ads are never scanned. Old ads are covered by the hashing
  worker (13.5, which hashes a blocked advertiser's old images) and by B3's deletion.
- **Cheap on the database.** One read of the newest id, then a primary-key range with a LIMIT per page, the images by the ad-id index. The cursor is a
  reserved row (`blocklist_id = 0`, status `sweep`) of `copyright_image_hash_jobs`, so there is no new table; the hashing worker never claims it.
- **No ad is skipped.** An ad is looked at on the pass after the one that first saw its id, so an insert that commits a little late is still checked.
  The cursor moves only after a page is done; a restart or another machine continues from it.
- **Only exact copies match for now** (same sha256), because `perceptual.enabled` is `false` until the distances are tuned (13.4). With it on, a close
  image is held too (its distance is recorded).
- **It never deletes or changes an ad.** A held image is for a person; taking an ad down stays B3's work. One row per image per banned entry: a repeat
  changes nothing, so a person's decision is never overwritten.
- **Problems wait, nothing is lost.** The banned list not loaded: nothing is checked and the cursor stays. The hashing service down for a whole page: the
  page is retried on the next pass (a page where some images hashed moves on; the others are counted as skipped). A refused key pauses the worker.
  Nothing banned yet: the cursor moves without calling the service. Ads without a stored image are skipped.
- **Watch it.** `copyright_image_hash_jobs` row `new-ads sweep`: `state` has `lastAdId` (how far it has checked) and `last_error` the last problem;
  the cron log line `image-hash pass` shows `swept` (`checked`, `matched`, `skipped`, `lag` = ads still to check).

Not covered: an ad whose image is stored only after the pass that looked at it; carousel images; networks other than Facebook; TikTok.

### 13.6a Speed notes (B2)

- **Checking an image** is a hash lookup in memory (exact) and, once near-copy matching is on, a scan of the banned hashes of the same version: about
  0.03 ms at 1,000, 0.35 ms at 20,000 and 2 ms at 100,000 banned hashes. Nothing here runs while an ad is being saved.
- **Every query is an index lookup with a LIMIT** (no OFFSET, no LIKE, no scan of old ads): the sweep reads a primary-key range after its cursor, the
  hash job pages on the owner index, images and platform ids are looked up by key. The sweep's cursor row is created only when missing (it does not
  use up an auto-increment id on every pass).
- **Adding images does not re-read the list**: see "Banned images (B2) are not re-read in full" in section 4.
- Not yet measured on a real database (EXPLAIN on dev, and prod indexes on the ad tables, are still to check).

### 13.7 Still to do

| What |
| --- |
| Confirm the near-copy policy and a larger / production sample (13.11), then set the distances and turn `perceptual.enabled` on; name the person or agent who decides the review queue; other networks; TikTok; Google / GDN pipelines for the ingestion check. Hashing every existing image is not planned (one image per call makes it impractical) |
| Run it for real: apply the schema on dev, set the key and address, enable the cron, try one advertiser |

### 13.8 Rollout of B2 (in this order)

1. Dev: `node scripts/apply-copyright-schema.js --networks=facebook --apply --confirm-prod` (dry-run first). Creates the 14 tables.
2. Environment: `IMAGE_HASH_API_URL` and `IMAGE_HASH_API_KEY` (the key only in the environment).
3. `config.json`: `compliance.blocklist.enabled: true`, then `crons.jobs.imageHashJobs.enabled: true` (hashing of blocked advertisers).
4. Try one test advertiser: add it with `add()`; read its row in `copyright_image_hash_jobs` until `done`; check the `image_hash` entries it made.
5. Tune the distances with real altered copies and unrelated images (resized, low-quality JPEG, 10% crop, text overlay, greyscale; 100–200 unrelated),
   then set `perceptual` (`enabled`, `rejectDistance`, `reviewDistance`).
6. `compliance.imageMatch.sweep.enabled: true`; post a copy of a banned image as a new ad; expect one pending row in `copyright_review_queue`
   and one in `copyright_blocked_attempts` within a few minutes.
7. Tell the B3 owner that old ads may be deleted only after the advertiser's job is `done`. Production: same steps with DevOps' hosts, one network at a time.

### 13.9 The entry point for a name from the landing page (`submitAdvertiser`)

`src/compliance/imagematch/worker.js` exports `submitAdvertiser({ name, addedBy, reason?, complaintId?, network? })` (and `createIntake(deps)` for tests).
The landing-page backend (or the approval step in front of it) calls it; there is no HTTP route in this repository.

```
name ──> check the input ──> [ search our data  ||  add to the blocklist ] (at the same time) ──> create the hashing job ──> answer
                                  1 indexed read      blocklist.add(), the B1 write            1 small insert per network
```

It answers with: `ok`, `complaintId`, the cleaned `name`, `blocked` (network and blocklist id of each entry written), `failed`, `rejected`,
`matches` (network, owner id, owner name, `ads`), `totalAds` and `hashing` (network, `queued`). Unusable input gives `{ ok: false, error }`
(`invalid_name`, `added_by_required`, `invalid_complaint_id`, `invalid_network`) and writes nothing. It never throws.

**Fast on millions of ads:**
- The search is one indexed read of the owners table per supported network (the owner's lower-cased name plus its usual spellings, `LIMIT`). The
  number of ads is the owner's stored `ads_count`: the ad table is never counted or scanned in the request, so the figure is as fresh as that counter.
- The block is the same idempotent write B1 uses; the same name again changes nothing. From then on new ads of that name (and its spellings) are refused.
  A name with no ads in our data is still blocked.
- The hashing is **not** part of the answer. The job row is created at once (so its progress is visible); the cron job (13.5) does the work.

**Hashing many advertisers fast (cron job):**
- A pass with a time budget runs several jobs one after another (`worker.maxJobsPerTick`, default 20), so small advertisers do not wait one minute each.
- A job is claimed by who has waited longest (`ORDER BY updated_at, id`): a big advertiser goes to the back of the line after each time slice and
  cannot starve a new small one.
- `imageMatch.maxConcurrency` (off by default) lets the client find how many calls at once the service takes, without knowing its limit (13.4).
- The service's real speed is not known yet (the specification lists only per-image limits: 50 MB, 40 million pixels, 32x32 minimum, 20 s download,
  5 redirects, public URLs only, key required). Ask the DS team for calls per second and the time per image before promising a time for a large advertiser.

**Not decided here (the caller's side):** who may submit (a public form should go through an approval step before the block is written, or anyone could block a
competitor), how often (rate limit), and what the user is told about the ads that are already visible: hiding them from search and listing is not done by
B1 or B2, and deleting them is B3's.

### 13.10 The route the landing-page form calls (`src/services/copyrightRequest.js`)

A single additive file, like `services/aiSearch.js`: not auto-mounted by the service registry; `src/app.js` mounts it at `/api/v1/copyright` only when
`compliance.request.enabled` is true **and** there is a token or `allowPublic`; when off the file is not even required.

```
POST /api/v1/copyright/advertiser/block        header x-copyright-token: <token>        body { "name": "...", "reason": "..." (optional) }
  200 { code, message: "ok", data: { complaintId, name, found, adsFound } }
  400 the name (or reason) cannot be used      401 missing or wrong token      429 too many requests
  503 not configured, or the request could not be recorded (nothing is half-done: try again)
```

- **What the caller cannot choose:** who is recorded as having asked (`compliance.request.addedBy`, default `landing-form`), the complaint id (generated) and
  the network (`all`). The answer never carries blocklist ids or internal errors. `reason` is one cleaned line of at most 255 characters.
- **Settings** (`compliance.request` in `config.json`, `src/config/index.js`): `enabled` (false), `allowPublic` (false), `addedBy`, `rateLimit.windowMs` (60000) and
  `rateLimit.max` (10 requests per address per window). The token is **environment only**: `COPYRIGHT_REQUEST_TOKEN`, never in `config.json`.
- **Safety:** enabled without a token and without `allowPublic` the route is not mounted (an error is logged); the token is compared in constant time; a rate limit
  applies per address on top of the global one. With `allowPublic` anyone who can reach the route can block any name, so use it only knowingly.
- **Approval:** today a request is acted on at once. The approval step that will sit in front of it (an agent) is future work; it calls this route with the token
  after approving. Until then, enable it only with a token held by a trusted server (a token placed in browser code is not a secret).
- **Browser calls** also need the landing page's origin to be allowed by the server's CORS setting (`config.cors`), and a proxy to forward the header.
- Tests: `tests/compliance/imagematch/worker.test.mjs` (route, with a local HTTP server) and `tests/compliance/blocklist/config.test.mjs` (settings).

### 13.11 Measured on dev: the service's speed and the near-copy distances

Measured with the real service from a developer machine (scripts are not in the repository). Dev data only: a different mix of images in production may give different numbers.

**Speed.** The best result was about **6.4 images per second** with 8 calls at once (2.9 times faster than one call at a time; one image takes about 0.45 s alone and about 1.2 s with 8 at once, so the service saturates near 6 to 7 per second). Time to hash: 1,000 images 3 min, 10,000 images 26 min, 100,000 images 4.4 hours, 1,000,000 images 43.6 hours. This is why hashing is a background job, never part of an answer to a user, and why a call to the service inside ingestion is not planned (it would add 0.5 to 1.3 s per image and the service cannot take more than about 6 images per second in total). 58 % of the dev rows sampled had no reachable file (a video id, or a file the CDN does not have); each such image still costs a call.

**Distances** (bits out of 256 that differ). 15 originals, 8 kinds of altered copy each, against 2,223 other images (about 2.5 million pairs):

| Distance | Light copies caught (resize 50 %, jpeg q30, grey, text overlay, 10 % crop) | Stronger copies caught (resize 25 %, jpeg q10, 20 % crop) | Different files at or under it (pairs) |
| --- | --- | --- | --- |
| 16 | 20 % | 9 % | 138 |
| 32 | 63 % | 33 % | 180 |
| 48 | 85 % | 67 % | 208 |
| 64 | 99 % | 96 % | 246 |
| 96 | 100 % | 100 % | 3,308 |

- Different images are about 125 bits apart (median); 95 % are within 140.
- The "different" pairs at 64 bits or less that were looked at (15 pairs, by eye) were all the **same creative** (another crop, size, language or small text change), not different images: the sample holds many copies of the same ad, and one creative repeated k times makes k(k-1)/2 pairs. Between 65 and 85 bits the pairs were the same creative or the same template with other text; the first clearly different images appeared at 88 bits.
- 126 pairs were byte-identical files (the exact check catches those).
- **Provisional setting, not applied:** `rejectDistance` 48 (high confidence), `reviewDistance` 85 (a person decides 49 to 85). `perceptual.enabled` stays **false** until the team decides whether translated or re-cropped versions and same-template ads count as copies, and a larger sample (ideally production images) has been run.

### 13.12 The exact-copy check at ingestion

`src/compliance/imagematch/matcher.js` exports `guardFile(network, filePath, { imageUrl, source })`. It is called by `media.fetchPrimaryMedia()`
(`src/insertion/helpers/mediaUpload.js`), the one place the Facebook, Instagram, ChatGPT Ads and AdMob pipelines download an ad's primary image (or a
video's thumbnail) to a temp file, before anything is saved or uploaded.

```
downloaded temp file ──> SHA-256 (a local read) ──> lookup among the banned images in memory ──> banned: refuse (422, same answer as a blocked name)
                                                                                                    else: carry on exactly as before
```

- **Result:** `fetchPrimaryMedia` returns `{ ok: false, reason: 'blocked', rejection }` and removes the temp file. Each of the six pipelines returns that
  `rejection` as is (one line each, before its own "could not be downloaded" answer). The attempt is logged in `copyright_blocked_attempts`
  (`match_type` sha256, source `ingestion:<network>`).
- **Off by default:** `compliance.imageMatch.enabled` (also `IMAGE_MATCH_ENABLED`). Off, it does no work at all (about 0.1 microsecond; the file is not read).
  It needs `compliance.blocklist.enabled` so the banned images are loaded.
- **Cost, measured:** 0.5 ms for a 50 KB image, 0.7 ms for 300 KB, 3 ms for 2 MB (reading the file and hashing it), the same with 1,000 or 100,000 banned
  images; nothing banned for the network: the file is not read.
- **Exact copies only.** A near copy needs the hashing service (about 0.5 to 1.3 s per image, about 6 images per second in total), which is too slow for a
  request; the sweep (13.6) catches those in the background.
- **Failure mode:** if the banned images could not be loaded, an ad is NOT refused for that reason (fail open, logged at most once a minute per network); the name
  check and its fail mode (section 6) are unaffected. The check never throws.
- **The bytes compared** are the downloaded bytes, which are what is uploaded to the NAS afterwards (no re-encoding), and what the hashing job hashed from the CDN, so
  the SHA-256 is the same value. Not yet confirmed on real stored files.
- **Not covered:** the Google and GDN pipelines (they upload without a pre-download), TikTok (its own project), and carousel / extra images (only the primary image or a
  video's thumbnail is gated).
- Tests: `tests/compliance/imagematch/matcher.test.mjs` (the check, and `fetchPrimaryMedia` against a local server).

### 13.13 Every image's hash, the backfill, and searching the stored hashes

Why: a future complaint should be searched across the whole store with a database read, not by hashing millions of images again.

- **`copyright_image_hashes`** gets one row per ad image (network, platform ad id, our row id, role, ordinal, SHA-256, the 256-bit hash and its version, source URL, stored path,
  source `ingest` or `backfill`). Idempotent on the slot (network, platform ad id, role, ordinal); a row without a platform ad id is not recorded. Ingestion never reads this table.
- **New images:** with `sweep.recordHashes` the sweep (13.6) also hashes and records every new image, even while nothing is banned. Off by default: it costs a call of the service
  (about 6 per second in total) for every new image, and the daily number of new ads is not known yet. A failing write never fails the sweep.
- **Old images, the backfill** (`src/compliance/imagematch/worker.js`, `ImageBackfill`, `imageMatch.backfill.enabled`): the lowest priority of the cron pass, it only gets the time left after the
  sweep and the hashing jobs, and never runs without the pass's time budget. It walks the ad table by primary key from `fromId` up to the newest ad at its first run (the sweep takes the ads
  after that), a page at a time, saving its place in a reserved row of `copyright_image_hash_jobs` (status `backfill`); a restart or another machine continues; finished, it costs nothing.
  Read-only on the ad tables, never deletes. At about 6 images per second, a million images is about two days of spare time.
- **Fewer wasted calls:** a stored path with no image extension (a video id) is no longer sent to the service (the CDN answers 400 for it; a third of the dev sample was like that), in the
  hashing job, the sweep and the backfill.
- **Search:** `searchStored(sql, network, { sha256?, phash?, maxDistance?, limit? })` finds the stored copies of a banned image: an exact copy through the SHA-256 index, near copies by reading
  the stored hashes by primary key in pages of 5,000 and comparing in the application (only the same hash version); it stops at a limit or a deadline and says whether it finished.
  Route: `POST /api/v1/copyright/images/search` (token required) with `{ network, sha256?, phash?, maxDistance?, limit? }`.

### 13.14 The review queue

Held images (`copyright_review_queue`, written by the sweep) are decided through `review.list` / `review.resolve` (`worker.js`), exposed on routes that **always need the token**, even where the
advertiser route is knowingly open (`allowPublic`):

```
GET  /api/v1/copyright/review?network=facebook&status=pending&afterId=0&limit=50
POST /api/v1/copyright/review/:id    { "network": "facebook", "decision": "allow" | "block", "reviewedBy": "...", "note": "..." }
```

- **allow:** the row becomes `allowed`; the same image against the same banned entry is never held again (the queue keeps the decision).
- **block:** the row becomes `blocked` and the image itself is added to the blocklist (type `image_hash`, the row's network, `source` review, with the review id, ad id and distance in `details`), so an
  exact copy of it is refused at ingestion from then on. The decision is saved first: if adding the image fails the answer says so (`blocklistAdded: false`) and nothing is undone; add it again.
  Deleting the ad that was found is B3's work.
- A decision is never overwritten (409 for an item already decided, 404 for a missing one, 400 for bad input). Nothing here deletes.

### 13.15 The hand-over to B3: what a finished job guarantees, generations, results, ad id and URL blocks

Asked for by B3 (takedown), who must not delete an image before B2 has hashed it. Everything here is read-only for the ad tables and never deletes.

**What a job starts from** (the worker finds these entries by itself, one job per entry and network):

| Entry type | What the job hashes |
| --- | --- |
| `advertiser`, `page` | the images of every ad of the owner (the name and its usual spellings), as before |
| `ad_id` | the images of the ad(s) with that platform ad id (index on `facebook_ad.ad_id`); none found ends `no_owner` |
| `url`, `image_url` | depends on what the URL is (below). The entry type alone does not say: B1 matches both through the same family |

**Statuses.** `done` and `no_owner` are the only ones that cover a block; `limit_reached` (image cap, incomplete), `failed`, `unresolved`, `pending` and `running` never do.
`done` does not mean every image was hashed: skipped and failed images are in the results (below), and B3 treats them as needing review.

**Generations: telling the runs apart, and a re-block while a job runs.** Every block of an entry is one generation. `copyright_image_hash_jobs` has
`requested_gen` (the newest asked for), `run_gen` (the one the current or last run works for) and `covered_gen` (the newest a run completed as `done` / `no_owner`), and `requested_at`.

- A repeated block (the blocklist upsert sets `updated_at`; the cron pass compares it with the job's `requested_at`, or `created_at`; `submitAdvertiser` does it at once) raises `requested_gen`.
  A job that is waiting or finished goes back to `pending` and starts clean (a full new run). A job that is **running** keeps running; when it ends, `finish` sees `requested_gen > run_gen`, does
  **not** close the job, leaves `covered_gen` as it was, and sends it back to `pending` to run again. So an older run is never taken for covering the newer block.
- **The rule for B3:** a job covers the latest block only when `coversLatest` is true: status `done` or `no_owner` and `covered_gen >= requested_gen`. Read the requested generation at the time of the block and compare.
- **Resume a `limit_reached` job:** same generation, saved place kept, the image counter back at zero (a new allowance). Only a `limit_reached` job can be resumed.

**Results: what happened to each image** (`copyright_image_hash_results`, written by the job, identifiers and outcomes only, never image data). One row per (job, generation, ad, image):
network, `job_id`, `blocklist_id`, `generation`, platform ad id (the scraper's), our row id, the stored path or URL, `outcome` and `reason`, and the SHA-256 when hashed.
Outcomes: `hashed`; `duplicate` (the same image URL or file as one already hashed in the run: it carries that hash); `skipped` (no stored image, not an image file, or the service says it cannot be hashed: too small / large / unreadable); `failed` (service or network error, with its kind and reason).
A rerun writes under the **new generation** and the old rows stay, so the previous run and the current run are never mixed. A repeated page of the same run updates the same rows. Retry = rerun.

**Routes** (token always required, like the review routes): `GET /api/v1/copyright/jobs?network=&jobId=&blocklistId=&status=` (status, the three generations, `coversLatest`, counts, per-owner progress),
`GET /api/v1/copyright/jobs/:id/results?network=&generation=&outcome=` (defaults to the job's latest run; says the latest generation), `POST /api/v1/copyright/jobs/requeue` with `{ network, blocklistId, mode: "rerun" | "resume" }`.

**URL blocks.** The role is decided by the URL, not the type alone: an `image_url` entry, or a URL ending in an image or video file name, is **media**; anything else is a **destination**.
B2 and B3 must use the same matching: B3 should act on the ads listed in the results of the covered generation, not search again by itself.

- **Destination URL:** the ads are found through the host: the domain index (`facebook_ad_domains.domain`) → the ads of that domain (`facebook_ad.domain_id` index) → their `destination_url` by primary key, compared with B1's normalization
  (scheme, `www.`, port, query, fragment and trailing slashes ignored). Then their stored images are hashed like any ad's. Limits, each reported as **`unresolved`** rather than guessed: the host has no domain row (it may be a media URL, or never stored);
  more than 20,000 ads on the host. Coverage depends on `domain_id` having been set from the same destination when the ad was inserted; an ad with another or no `domain_id` is missed.
- **Media URL:** the file at the URL is hashed and added to the blocklist (so a copy is caught from now on), but its **ads cannot be found**: there is **no index** on `destination_url`, `image_url` or `image_url_original` (`SHOW INDEX` on dev, 2026-11-03),
  and a search there would scan billions of rows. The job ends `unresolved`. Finding those ads safely needs a side table filled at ingestion (or the search index); not built, and no index is added to a production table by this work.
  B1 also matches an ad whose image field equals a `url` entry; a destination job does not search those fields for the same reason.

**Not checked on a real database yet:** the schema is applied nowhere; the generation updates rely on MySQL evaluating the assignments of one `UPDATE` from left to right (documented, and none of them changes `requested_gen` or `run_gen`); the tests use fakes and
check the statements' text. The jobs table definition changed in place (new columns); the schema script validates and never alters, so a database that already has the earlier table would report a mismatch (none does).
