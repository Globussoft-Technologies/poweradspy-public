# Copyright compliance: the whole flow

For everyone who works on, tests or supports the copyright work in PowerAdSpy: developers, QA, reviewers and leads. It explains, in order, what happens from the moment someone complains about an ad until the ad is gone and the deletion is proven. Updated 6 November 2026.

Other documents go deeper on one part:

| Document | What it covers |
| --- | --- |
| [COPYRIGHT_ADMIN_PANEL_GUIDE.md](COPYRIGHT_ADMIN_PANEL_GUIDE.md) | Every screen and button of the admin panel's Copyright Request page |
| [COPYRIGHT_BLOCKLIST_B1_MANIFEST.md](COPYRIGHT_BLOCKLIST_B1_MANIFEST.md) | The blocklist (B1) and image matching (B2) in full technical detail: settings, queries, speed |

---

## 1. Why this exists

PowerAdSpy collects ads from many networks and shows them in search. When the owner of a brand or an image says "you are showing my copyrighted work", we must:

1. **stop** collecting and showing that advertiser's ads, ad ids, links and images;
2. **remove** the ads we already have;
3. **prove** that they were removed.

The work is split into parts with short names. You will see these names in code, tables and logs:

| Name | Part | In one line |
| --- | --- | --- |
| **Claims** | Intake | The complaint is received, stored and decided by a reviewer. |
| **B1** | Blocklist | One list of everything that is blocked. Every new ad is checked against it. |
| **B2** | Image matching | Images get a fingerprint (hash), so a copy of a blocked image is caught even under a new name or ad id. |
| **Verification** | `copyright_status` | Every new ad stays hidden until it is checked. Failed ads are hidden and queued for removal. |
| **B3** | Takedown | Failed ads are deleted from storage (NAS), the database (SQL) and search (Elasticsearch), and every step is logged. |
| **B6** | Audit | A second record of each takedown: what was expected to be removed and what was found removed. |
| **Monitor** | Admin panel | A read-only view of all of the above. |

**The golden rules**

- Everything is **off by default** and is switched on per server in `config.json`.
- Only the takedown deletes. Intake, the blocklist, hashing and verification never delete anything.
- Nothing is half done. When a step fails, the ad stays in a safe state (hidden) and the step is tried again on the next pass.
- An ad is always identified by the **platform's ad id** (the scraper's id). Our own row id is used only as a cursor, or when it is clearly marked as `internal`.

---

## 2. The big picture

```
  ┌───────────────┐   ┌──────────────────┐
  │ Website form  │   │ Block request    │  (trusted server with a token)
  │ (claimant)    │   │ POST /advertiser/│
  └──────┬────────┘   │      block       │
         │            └────────┬─────────┘
         ▼                     │
  ┌───────────────┐            │
  │ 1. CLAIM      │ waiting    │
  │ stored        │            │
  └──────┬────────┘            │
         │ reviewer: Accept    │
         ▼                     ▼
  ┌──────────────────────────────────┐
  │ 2. BLOCKLIST (B1)                │  copyright_blocklist
  │ advertiser / ad id / url /       │  kept in memory on every server,
  │ domain / page / image hash       │  refreshed about every 30 s
  └──┬──────────────┬────────────────┘
     │              │
     │              ▼
     │      ┌───────────────────────┐
     │      │ 3. HASH JOB (B2)      │  every minute: finds the blocked
     │      │ old images → hashes → │  advertiser's stored images and adds
     │      │ image_hash entries    │  one image_hash entry per image
     │      └───────────────────────┘
     │
     ├──────────────► NEW AD arrives (scraper → insertion API)
     │                │
     │                ├─ 4. Check at insertion (B1): name / ad id / url / domain
     │                │      (+ exact image on Facebook, Instagram, ChatGPT Ads, AdMob)
     │                │      match → refused (422), nothing is saved
     │                │
     │                └─ saved with copyright_status = 0 (hidden)
     │                           │
     │                           ▼
     │                ┌─────────────────────────────┐
     │                │ 5. VERIFY cron (every 2 min)│
     │                │ blocklist + image hashes    │
     │                └───┬──────────────────┬──────┘
     │                    │ clean            │ match
     │                    ▼                  ▼
     │              status 1 (shown)    status 2 (hidden)
     │                                       ▲
     └─ 6. RECHECK (same cron): a NEW block  │
          also fails the ads that already ───┘
          exist (status 0 or 1 → 2)
                                             │
                                             ▼
                                ┌─────────────────────────────┐
                                │ 7. CLEANUP cron (every 15m) │
                                │ takedown run (B3):          │
                                │ NAS → SQL + ES delete       │
                                │ + steps log                 │
                                └──────────────┬──────────────┘
                                               ▼
                                ┌─────────────────────────────┐
                                │ 8. AUDIT (B6)               │
                                │ expected vs found removed   │
                                └──────────────┬──────────────┘
                                               ▼
                                ┌─────────────────────────────┐
                                │ 9. MONITOR (admin panel)    │
                                │ read only                   │
                                └─────────────────────────────┘
```

---

## 3. Step by step

### Step 1: The claim comes in

**Who:** a person who owns the work, through the copyright form on the website (WordPress).

1. The person fills the form: the advertiser's name, their own name and email, company, reason, an optional link, and supporting files (PDF, images).
2. The website's server sends it to `pas_node_api`: `POST /claims`, protected by the **site token**. Files are sent with `POST /claims/:id/attachments`.
3. The claim is saved in `copyright_claims` with status **pending** ("Waiting" on screen). It gets:
   - a **complaint id**: a long unique code (UUID) that links the claim to everything that happens later;
   - a **reference** `CR-XXXXXX`, shown to the claimant. It uses no 0/O/1/I/L, so it is easy to read aloud.
4. Files go to a **private NAS bucket**, with one row each in `copyright_claim_files`. They are never given out by a link; a reviewer downloads them through the admin login. A file can be downloaded only after its virus scan.
5. The claimant can check the status only with a **status key**, which is made from the complaint id and a server secret. The complaint id alone is not enough.

**Safety:**
- Sending the same complaint id with the same content again returns the same claim, so nothing is added twice. The same id with **different** content is refused.
- No email is sent to anyone.

Code: [src/compliance/claims/claims.js](../src/compliance/claims/claims.js), [attachments.js](../src/compliance/claims/attachments.js), [src/services/copyrightClaimsRoutes.js](../src/services/copyrightClaimsRoutes.js).

#### The other way in: the block request

A trusted server (in the future, an approval agent) can block an advertiser directly, with no claim:
`POST /api/v1/copyright/advertiser/block { name, reason }` with a token.

This does the same as an accepted claim (step 2) at once: the advertiser is blocked on all networks and its hashing is queued. The complaint id is generated by the server. These blocks do **not** appear in the Requests tab, only under Monitoring, Blocked list.

Code: [src/services/copyrightRequest.js](../src/services/copyrightRequest.js).

---

### Step 2: A reviewer decides

**Who:** a person on the reviewers list, in the admin panel (Copyright Request page, Requests tab).

1. The admin panel (`react_admin`) talks only to `admin_panel_backend`. The backend checks two things:
   - the admin login (JWT);
   - that the user name is on `COPYRIGHT_CLAIMS_REVIEWERS`.

   Only then does it call `pas_node_api` with its own **admin token**. The browser never holds that token.
2. The reviewer reads the claim and downloads the files. **Search networks** can show whether the name exists in our data. It only reads.
3. **Reject** (a reason is required): the claim is closed. Nothing is blocked.
4. **Accept** (the "I reviewed the documents" tick box is required): the decision is saved first, then **processing** runs. Processing calls `submitAdvertiser()`, which:
   - adds an `advertiser` entry to the blocklist on **every network** (step 3), with the claim's complaint id;
   - queues a **hash job** for that advertiser on every network (step 4).
5. The result of each network is stored with the claim: `processing_status` is `ok`, `partial` or `failed`. A failure never undoes the decision. **Retry** runs processing again, and it is safe to repeat: the blocklist write is an upsert, and a finished hash job is not restarted.

**Safety:**
- A decision is one conditional update (`WHERE status = 'pending'`). If two reviewers press at the same time, only one wins. The other gets "already decided".
- The name saved with a decision is always the login's user name. Anything typed by the browser is ignored.

Code: [admin_panel_backend/routes/copyright-claims.js](../../admin_panel_backend/routes/copyright-claims.js), [react_admin/.../CopyrightClaims.jsx](../../react_admin/vite-project/src/components/Pas/CopyrightClaims.jsx).

---

### Step 3: The blocklist (B1)

**One table, `copyright_blocklist`, in each network's own database.** One row is one blocked thing:

| `entry_type` | What it blocks | Matched against |
| --- | --- | --- |
| `advertiser` | An advertiser name | The ad's advertiser name, including common spelling variants: `Twinkling Tree` also blocks `TwinklingTree`, `twinkling-tree`, `Twinkling.Tree` |
| `page` | A page name | Same as advertiser |
| `ad_id` | One ad | The platform's ad id. With `identifier_namespace = 'internal'` it is our own row id instead (used by the cleanup). |
| `url` / `image_url` | A link or image address | Every image, video, carousel and landing-page URL of the ad, cleaned first (no `www.`, no query string, no size tokens) |
| `domain` | A website | The landing page's host and its parent domains (`a.b.com` matches `b.com`, never `notb.com`) |
| `image_hash` | One image | Its SHA-256 (exact copy) and its 256-bit perceptual hash (near copy). Written by B2. |

Other columns: `network` (a network name, or `all`), `status` (`active`, `revoked`, `expired`), `added_by`, `source`, `reason`, `complaint_id`, `expires_at`, `details` (JSON).

**How it is used:**
- Every server keeps the list **in memory** and re-reads it about every 30 seconds. New image hashes are read every 60 seconds, and the whole list every 15 minutes. So the per-ad check makes **no database call** (about 13 microseconds for 100,000 entries).
- A copy of the last good list is saved to disk. If the database is down at startup, the copy is used.
- If no list can be loaded, `failMode` decides: `closed` refuses ads with 503 (the default), `open` lets them through and logs it.
- Rows are never deleted. Unblocking is a **revoke** (`status = 'revoked'`, with who and when).

Code: [src/compliance/blocklist/](../src/compliance/blocklist/).

---

### Step 4: Image hashing (B2)

**Why:** a blocked advertiser can come back under a new name or ad id with the same picture. A fingerprint of the picture catches that.

**The hashing service** (built by the DS team) takes one image URL and returns two hashes:
- **SHA-256:** the same only for the exact same file;
- **SSCD hash:** 256 bits, close for images that look alike (resized, recompressed, lightly cropped). The number of different bits is the **distance**: 0 means the same picture.

**The hash job** (cron `imageHashJobs`, every minute):
1. It finds blocklist entries of type `advertiser`, `page`, `ad_id`, `url` or `image_url` that have no job yet, and creates one row in `copyright_image_hash_jobs`.
2. It claims the oldest waiting job. The claim is atomic, so two servers never run the same job.
3. It finds the advertiser's **stored** ads (by the indexed lowercase name), takes each ad's stored image (for YouTube, the thumbnail), and sends it to the service.
4. It adds one `image_hash` entry to the blocklist per distinct image, with the same complaint id. `details` keeps the platform ad id, our row id and the stored path.
5. It records the result of every image in `copyright_image_hash_results`: hashed, duplicate, skipped or failed.
6. It ends as `done`, `no_owner` (the name has no ads), `limit_reached` (image cap), `unresolved` (the ads could not be found) or `failed`.

It works in short slices with a time budget and keeps its place in the job row, so a huge advertiser never overloads anything and a restart continues where it stopped. It only **reads** the ad tables.

**Networks:** Facebook, Instagram, Reddit, Quora, Pinterest, Native, GDN, ChatGPT Ads, LinkedIn, YouTube, Google text ads and AdMob. The map of tables per network is in [src/compliance/imagematch/sources.js](../src/compliance/imagematch/sources.js). TikTok is not covered.

**Other B2 pieces, all off by default:**
- `copyright_image_hashes`: the hash of every stored image (new ones by the sweep, old ones by the backfill). It lets us find every copy of a banned image.
- **Sweep:** checks new ads' images and puts close matches in `copyright_review_queue` for a person.
- **Review routes:** `GET /review` and `POST /review/:id` (allow or block). A block adds the image to the blocklist.

**Important:** near-copy matching (`perceptual.enabled`) stays **off** until the distances are tuned on real data. Until then, only **exact** copies match.

Code: [src/compliance/imagematch/](../src/compliance/imagematch/).

---

### Step 5: A new ad arrives

A scraper sends a new ad to the insertion API. Two checks protect us, one before saving and one after.

#### 5a. The check at insertion (B1, before saving)

Inside `InsertionEngine.safeProcess`, before validation, SQL, NAS upload or ES:

```
scraper → insertion API → owner deny-list → blocklist.guard(ad) → save (SQL, NAS, ES)
                                                │
                                                └ match → 422, nothing saved,
                                                  one row in copyright_blocked_attempts (source "ingestion")
```

- It checks the advertiser name, ad id, URLs and domain, in memory.
- On **Facebook, Instagram, ChatGPT Ads and AdMob**, the downloaded image is also checked by its SHA-256 against the banned images (exact copy only, `compliance.imageMatch.enabled`).
- It covers the 12 networks of the shared engine. TikTok has the same name / ad id / URL check in its own service (`api_tiktok_nodejs`).
- The delete endpoints skip the check, so a blocked ad can still be deleted.

#### 5b. Hidden until checked (`copyright_status`)

An ad that passes 5a is saved, but with `copyright_status = 0`, so it is **hidden**:

| Value | Name | In search | Next |
| --- | --- | --- | --- |
| `0` | pending | hidden | The verify cron checks it |
| `1` | approved | shown | Nothing. It is a normal ad |
| `2` | failed | hidden | The cleanup cron deletes it |

How the status is kept the same everywhere:
- **SQL:** the column is on each network's main ad table (`facebook_ad`, `google_text_ad`, `mob_ads`, ...). The migration gives existing ads `1` (still shown) and new ads `0`, and adds the index `(copyright_status, id)`.
- **Elasticsearch:** before every `elastic.index()`, a hook reads the ad's status from SQL and writes it into the ES document. A re-index can therefore never show a pending ad or hide an approved one. On any problem it writes `0`: hidden, and checked later. It never blocks insertion.
- **Search** hides ES documents with status `0` or `2`. A document **without** the field (indexed before this feature) stays visible, so no ES backfill was needed. Ad detail pages use `copyright_status = 1` in SQL.

Code: [src/services/copyrightVerification/status.js](../src/services/copyrightVerification/status.js), [migrate.js](../src/services/copyrightVerification/migrate.js).

---

### Step 6: The verify cron (every 2 minutes)

Cron `copyrightVerification`. For each network, one pass does two things.

#### 6a. Check pending ads

1. It reads one page of ads with status `0` (`batchSize`, default 200), walking the index with a cursor.
2. **Metadata check:** advertiser, platform ad id, URL and domain against the in-memory blocklist. It also checks `internal` ad id entries, which point at our row id.
3. **Image check:** only when there are banned images. It hashes the ad's images (`hashConcurrency` calls at once) and compares them in worker threads (`workers`).
   - A **match** marks the ad failed.
   - **Close but not enough to reject:** the ad is **kept hidden** for a person to decide. This is held in memory until the server restarts.
   - **Image not reachable yet** (for example the NAS upload is still queued): the ad is tried again on a later pass. After `maxHashAttempts` (5) it stays hidden, or is approved if `afterMaxAttempts = 'approve'`.
   - **Hashing service down:** nothing is approved by image, and the ads wait.
4. **Results:**
   - **Approved:** ES is set to 1 first, then SQL. If ES fails, SQL stays 0 and the ad is retried.
   - **Failed:** SQL is set to 2. ES already hides it. One row is written to `copyright_blocked_attempts` (source `verification`), with the image URL when an image matched.

#### 6b. Recheck: a new block also catches existing ads

The flow so far only stops **new** ads. The recheck handles the ads we **already have** (`recheckExisting`, on by default):

1. It reads new blocklist entries from the last `recheckLookbackHours` (24), a few per pass (`recheckEntries`, 100).
2. It finds the existing ads each entry covers:

   | Entry | How the ads are found |
   | --- | --- |
   | `advertiser` | The owner rows by indexed lowercase name (shared `SOURCES` map), then their ads |
   | `ad_id` (platform) | The ad with that platform id. Our own `internal` entries are skipped, because those ads are already being removed. |
   | `image_hash` | The source ad saved in the entry's `details`, plus every stored exact copy in `copyright_image_hashes` |

3. Those ads (status 0 or 1) are set to `2` in SQL and in ES, so they are hidden at once. Each one gets a `copyright_blocked_attempts` row with source `verification-recheck`.
4. At most `recheckAds` (1000) ads per pass. A large advertiser continues on the next pass. After a restart, the last 24 hours of entries are checked again, which is safe because the update only changes rows still at 0 or 1.

`url`, `domain`, `page` and `image_url` entries are **not** rechecked against existing ads. They apply only to new ads.

Code: [src/services/copyrightVerification/service.js](../src/services/copyrightVerification/service.js) (`verifyNetwork`, `recheckExisting`).

---

### Step 7: The cleanup cron: the takedown (B3, every 15 minutes)

Cron `copyrightCleanup`. For each network:

0. **Close stuck runs.** A run still `running` after 1 hour (for example after a server restart) is closed as `failed`. Its unfinished ads count as failed **in that run** (`failed = planned − done`), and `details` says they are retried by a later run.
1. It reads up to `cleanupBatchSize` (50) ads with status `2`.
2. **Block first.** It adds each ad's platform id to the blocklist (`ad_id`, added by `copyright-verification`, source `verification`), and the advertiser too if `blockAdvertiser` is on. A re-scraped copy is then refused at insertion.
3. **Open a takedown run.** It writes one row in `copyright_takedown_runs` (trigger `verification`, mode `execute`, status `running`, `items_planned`) with a **snapshot** of every ad before deletion (`preflight_snapshot`). **If this row cannot be saved, nothing is deleted.**
4. For each ad:
   1. **NAS:** it deletes the ad's own stored files (`nasConcurrency` at once). A shared or default file is never deleted. If NAS fails, the ad waits for the next pass, up to `maxNasAttempts` (3).
   2. **SQL and ES:** it calls the network's existing **delete pipeline**, the same one the delete API uses. That deletes the ad and its child rows in the right order (tables with RESTRICT foreign keys first) and removes the ES document.
   3. SQL is deleted last. If anything fails, the row stays at status 2 and the next pass tries again.
5. **Finish the run.** It writes one `copyright_takedown_actions` row per step (system `storage` or `sql`, status, error, details), then sets the run to `succeeded` or `failed` with planned, done and failed counts. If a step could not be saved, the run still closes and the problem is written in `details`.

**How to read a run** (Planned / Done / Failed):

| Status | Example | Meaning |
| --- | --- | --- |
| succeeded | 3 / 3 / 0 | All deleted |
| failed | 3 / 1 / 2 | Some deletes were refused. See the steps. |
| failed | 3 / 0 / 3 | Stopped before it finished. The ads were retried by a later run. |
| running | 3 / 0 / 0 | Working now, or stuck. Closed after 1 hour. |

Code: [service.js](../src/services/copyrightVerification/service.js) (`cleanupNetwork`, `startRun`, `finishRun`, `closeStaleRuns`), and each network's `deletePipeline` and `repository.js` (`deleteAdCascade`).

---

### Step 8: The audit (B6)

Written by the same cleanup pass, right after the run, when `audit` is on (the default):

- one `copyright_audit_runs` row per run: type, status (`completed` / `failed`), **expected** count, **found** count, and the takedown run id;
- one `copyright_audit_findings` row per removed ad: type `blocklist_hit`, system `sql`, the table, our row id and the platform ad id, status `resolved` with resolution `removed`, and details such as what was deleted from NAS.

Expected = found means the run removed everything it meant to. The audit is our proof that the takedown happened.

---

### Step 9: The monitor (admin panel, read only)

**Copyright Request → Monitoring** (the *Takedown Monitor*) reads all of the above and changes nothing:

| Where | Shows |
| --- | --- |
| Top boxes | Deleted, Waiting, Failed (summed from runs), Waiting for check (status 0), Waiting for cleanup (status 2), Takedown runs, Hash jobs |
| Network table | The same per network. "To check / to remove" shows status 0 / status 2 counts, or "not migrated". |
| Takedown runs | Every run, its counts, and its step log |
| Failed steps | Steps that failed, with the error and next retry |
| Hash jobs | Every B2 job and the result of each image |
| Blocked list | The blocklist with filters and search |
| Rejected ads | `copyright_blocked_attempts`: what was refused or failed, and why |
| Audit | B6 runs and findings, linked to their takedown run |
| Claim requests | The claims, read only |

A network whose tables are missing is shown as "not available", **never as zero**.

Code: [src/compliance/monitor/monitor.js](../src/compliance/monitor/monitor.js), [TakedownMonitor.jsx](../../react_admin/vite-project/src/components/Pas/TakedownMonitor.jsx). Screen guide: [COPYRIGHT_ADMIN_PANEL_GUIDE.md](COPYRIGHT_ADMIN_PANEL_GUIDE.md).

---

## 4. One example, start to finish

"Acme Shoes" sends a claim against the advertiser **Acme Brand**, which has 40 ads on Facebook.

| Time | What happens | Where to see it |
| --- | --- | --- |
| 10:00 | The claim arrives: pending, `CR-7K3QXP` | Requests, Waiting |
| 10:20 | A reviewer accepts it. `advertiser = Acme Brand` is added on all networks, and hash jobs are queued. | Claim: "Done"; Blocked list |
| 10:21 | The hash job hashes the 40 ads' images and adds, say, 35 `image_hash` entries (5 were duplicates). | Hash jobs → done |
| 10:22 | The verify cron's recheck finds the 40 existing ads and sets them to status 2. They disappear from search. | Rejected ads (verification-recheck); Waiting for cleanup = 40 |
| 10:24 | The recheck of the 35 image entries finds 3 more ads by **other** advertisers using the same images, and fails them too. | Rejected ads (Same image) |
| 10:30 | The cleanup run deletes the first 43 ads (batch of 50), adds their ad ids to the blocklist, and writes the steps and the audit. | Takedown runs: 43 / 43 / 0; Audit: expected 43, found 43 |
| 11:05 | A scraper sends a new Acme Brand ad. | Refused at insertion (422), Rejected ads (ingestion) |
| 11:10 | Another advertiser's new ad uses an Acme image. It is saved hidden (status 0); the verify cron matches the image and sets it to 2. Cleanup deletes it at 11:15. | Rejected ads (verification) → Takedown runs |

---

## 5. The life of one ad

```
                  insertion check (B1) match
   new ad ─────────────────────────────────────────► refused, never saved
     │
     │ saved
     ▼
  ┌──────────┐  verify: clean   ┌──────────┐
  │ 0 pending├─────────────────►│1 approved│ (shown in search)
  │ (hidden) │                  └────┬─────┘
  └────┬─────┘                       │ recheck: a new block covers it
       │ verify: match               │
       ▼                             ▼
  ┌──────────────────────────────────────┐
  │ 2 failed (hidden)                    │
  └────────────────┬─────────────────────┘
                   │ cleanup: NAS + SQL + ES delete
                   ▼
             gone, plus its ad id on the blocklist,
             takedown steps and an audit finding
```

---

## 6. The tables

`scripts/apply-copyright-schema.js` creates **12 tables** in each network's database. It is safe to run again. The `copyright_status` column on the ad tables comes from `migrate.js`.

| Table | Part | Holds | Written by |
| --- | --- | --- | --- |
| `copyright_claims` | Claims | One claim: claimant, advertiser, reason, decision, processing result | Claims service (home database only) |
| `copyright_claim_files` | Claims | Evidence files: name, type, size, scan, private path | Claims service |
| `copyright_blocklist` | B1 | Everything blocked | Accept / block request, hash job, review, cleanup |
| `copyright_blocked_attempts` | B1 | Every refused or failed ad (identifiers only) | Insertion check, sweep, verify cron, recheck |
| `copyright_image_hash_jobs` | B2 | One hash job per blocked entry, and the sweep and backfill cursors | Hash job cron |
| `copyright_image_hash_results` | B2 | What happened to each image of each job run | Hash job cron |
| `copyright_image_hashes` | B2 | The hash of every stored image | Sweep, backfill |
| `copyright_review_queue` | B2 | Near matches waiting for a person | Sweep |
| `copyright_takedown_runs` | B3 | One row per takedown run, with counts and snapshot | Cleanup cron |
| `copyright_takedown_actions` | B3 | One row per step of a run | Cleanup cron |
| `copyright_audit_runs` | B6 | One row per audit (expected vs found) | Cleanup cron |
| `copyright_audit_findings` | B6 | One row per ad checked | Cleanup cron |

Four older tables (`copyright_complaints`, `copyright_complaint_items`, `copyright_complaint_blocklist_entries`, `copyright_takedown_blocklist_entries`) were removed because nothing used them.

---

## 7. Switching it on

Settings are per server in `config.json`. Secrets are only in the environment.

| Order | What | Setting / command |
| --- | --- | --- |
| 1 | Create the tables in every network's database | `node scripts/apply-copyright-schema.js` |
| 2 | Turn on the blocklist | `compliance.blocklist.enabled` (+ `failMode`, `networks`) |
| 3 | Connect the hashing service | `compliance.imageMatch.baseUrl`; env `IMAGE_HASH_API_URL`, `IMAGE_HASH_API_KEY` (never in `config.json`) |
| 4 | Turn on the hash jobs | `crons.jobs.imageHashJobs.enabled` (every 1 min) |
| 5 | Turn on claims and the admin page | `compliance.claims.enabled`; site and admin tokens in env; in `admin_panel_backend`: `JWT_SECRET`, `PAS_NODE_API_URL`, `COPYRIGHT_CLAIMS_ADMIN_TOKEN`, `COPYRIGHT_CLAIMS_REVIEWERS`; in `react_admin`: `VITE_ADMIN_PANEL_API` |
| 6 | Add the status column | `node src/services/copyrightVerification/migrate.js` (dry run), then `--apply` |
| 7 | Turn on verification and cleanup | `compliance.copyrightVerification.enabled`; `crons.jobs.copyrightVerification` (2 min) and `crons.jobs.copyrightCleanup` (15 min) |
| optional | Block request route | `compliance.request.enabled` with a token |
| optional | Near-copy matching | `compliance.imageMatch.perceptual.enabled` **only after the distances are tuned** |

Main settings of `compliance.copyrightVerification`:

| Setting | Default | Meaning |
| --- | --- | --- |
| `networks` | all | Networks to process (TikTok is never included) |
| `batchSize` | 200 | Pending ads checked per network per pass |
| `workers` / `hashConcurrency` | 2 / 4 | Threads for comparing hashes / hash calls at once |
| `maxHashAttempts` / `afterMaxAttempts` | 5 / `pending` | When an image never loads: stay hidden, or `approve` |
| `cleanupBatchSize` | 50 | Failed ads deleted per network per pass |
| `nasConcurrency` / `maxNasAttempts` | 2 / 3 | NAS deletes at once / tries before giving up on NAS |
| `blockAdvertiser` | false | Also block the advertiser of a failed ad |
| `audit` | true | Write takedown runs, steps and the audit |
| `recheckExisting` | true | A new block also fails existing ads |
| `recheckEntries` / `recheckAds` / `recheckLookbackHours` | 100 / 1000 / 24 | Recheck limits per pass |

---

## 8. When something goes wrong

| What you see | Why | What happens / what to do |
| --- | --- | --- |
| Blocklist cannot load | Database down | The saved copy on disk is used. With nothing at all, `failMode: closed` refuses ads (503). |
| Hashing service down | DS service | Hash jobs pause. Pending ads with images wait (hidden). Nothing is approved by mistake. |
| Image not uploaded yet | NAS queue | The ad is retried on later passes. |
| Ads stuck at 0 in ES while SQL says 1 | Old bug in the ES hook (fixed) | Run once: `node src/services/copyrightVerification/repairEs.js` (dry run), then `--apply`. It only sets ES to 1 where SQL is 1. |
| A run stays `running` | Server restarted mid-run | Closed as failed after 1 hour. Its ads stay at status 2 and are taken by the next run. |
| A run fails with "delete refused" | A child table blocks the delete | Read the step error. The ad stays at 2 and is retried. Add the missing table to that network's `deleteAdCascade`. |
| Monitor says "not available" | Tables missing | Run the schema script for that network. |
| Monitor says "not migrated" | No `copyright_status` column | Run `migrate.js --apply` for that network. |
| Failed total looks too high | Counted per run | An ad in several stopped runs counts several times. Check *Waiting for cleanup* for what is really left. |

---

## 9. Limits and open items

- The **decision does not delete**. Existing ads are removed only when verification and cleanup are switched on.
- **Near copies** are not matched until the distances are tuned. Today only exact images match.
- An ad **held for review** (close image) is kept in memory only: a restart checks it again. There is no screen to decide it yet.
- The **recheck** of existing ads covers advertiser, ad id and image hash entries, not URL, domain, page or image URL.
- The **image check at insertion** exists only on Facebook, Instagram, ChatGPT Ads and AdMob. The other networks are checked a minute or two later by the verify cron.
- A blocked **URL** cannot be matched to existing ads on Native, GDN and AdMob (no index), so the hash job ends as `unresolved`.
- **TikTok** has only the insertion check: no verification, hashing or cleanup.
- **No emails** are sent to claimants or reviewers.
- Runs from before 5 November 2026 have no step log or audit.

---

## 10. Where the code lives

| Part | `pas_node_api` | Other projects |
| --- | --- | --- |
| Claims | `src/compliance/claims/`, `src/services/copyrightClaimsRoutes.js` | `admin_panel_backend/routes/copyright-claims.js`; `react_admin/.../Pas/CopyrightClaims.jsx`, `CopyrightRequest.jsx` |
| Block request, review, jobs routes | `src/services/copyrightRequest.js` | |
| B1 blocklist | `src/compliance/blocklist/`; check in `src/insertion/InsertionEngine.js` | `api_tiktok_nodejs` (its own check) |
| B2 image matching | `src/compliance/imagematch/`; insertion image check in `src/insertion/helpers/mediaUpload.js` | Hashing service (DS team) |
| Verification, cleanup (B3), audit (B6) | `src/services/copyrightVerification/` (`status.js`, `service.js`, `hashWorker.js`, `migrate.js`, `repairEs.js`) | |
| Crons | `src/jobs/cronManager.js` (`imageHashJobs`, `copyrightVerification`, `copyrightCleanup`) | |
| Monitor | `src/compliance/monitor/monitor.js` | `react_admin/.../Pas/TakedownMonitor.jsx` |
| Schema | `scripts/apply-copyright-schema.js` | |
| Tests | `tests/compliance/`, `tests/services/copyrightVerification/` | `admin_panel_backend/tests/routes/`, `react_admin/vite-project/tests/components/` |
