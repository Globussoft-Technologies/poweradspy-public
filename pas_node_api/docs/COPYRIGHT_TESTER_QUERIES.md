# Copyright Request page: queries to check what it shows

This file gives you a ready query for each part of the **Admin panel › Copyright Request** page, so you can check that what the page
shows matches what is stored. Each section says **what the page shows**, **the query**, and **what should match**.

For the meaning of each tab and word, see [COPYRIGHT_ADMIN_PANEL_GUIDE.md](COPYRIGHT_ADMIN_PANEL_GUIDE.md).

---

## Before you start (read once)

1. **Only read. Never change.** Every query here is a `SELECT` (SQL) or a `_search` (Elasticsearch). Do not run `UPDATE`, `DELETE`,
   `INSERT`, or ES `_update` / `_delete`: the page and the crons depend on this data.
2. **Replace the placeholders.** Anything in `<angle brackets>` is yours to fill in, without the brackets.
   Example: `WHERE network = '<network>'` becomes `WHERE network = 'facebook'`.
3. **Which database?** Each network has its own MySQL database. Run a network's queries in **that network's database**
   (Facebook data in the Facebook database, Reddit data in the Reddit database, and so on).
   **Claims** (the Requests tab) are the exception: they are all in the **Facebook** database (the "home" database of claims).
4. **The network column holds the network name in small letters**: `facebook`, `instagram`, `reddit`, `google`, and so on.
5. **Times are stored in UTC.** The page shows your local time. India is UTC + 5:30, so 10:00 on the page is 04:30 in the database.
6. **Ids on the page:**
   - **Our row id** = the `id` column of the ad table (for example `facebook_ad.id`).
   - **Platform ad id** = the network's own id = the `ad_id` column of the ad table.
   - **Complaint id** = a long id like `3fa4c2e1-....`. The page sometimes shows only the first 8 characters: hover it (or press Copy)
     to get all of it. In the database it is stored in **small letters**.
7. **Paging:** the page shows 25 or 50 rows at a time (newest first). Your query shows everything, so compare the **first rows**
   with **page 1**, or add `LIMIT 50` to the query.

### Network → ad table → Elasticsearch

| Network | Ad table (SQL) | Advertiser table (SQL) | ES index (default) | ES field with our row id |
| --- | --- | --- | --- | --- |
| facebook | `facebook_ad` | `facebook_ad_post_owners` | `search_mix` | `facebook_ad.id` |
| instagram | `instagram_ad` | `instagram_ad_post_owners` | `instagram_search_mix` | `instagram_ad.id` |
| gdn | `gdn_ad` | `gdn_ad_post_owners` | `gdn_search_mix` | `gdn_ad.id` |
| youtube | `youtube_ad` | `youtube_ad_post_owners` | `youtube_ads_data` | `ad_id` |
| linkedin | `linkedin_ad` | `linkedin_ad_post_owners` | `linkedin_ads_data` | `ad_id` |
| reddit | `reddit_ad` | `reddit_ad_post_owners` | `reddit_search_mix` | `reddit_ad.id` |
| quora | `quora_ad` | `quora_ad_post_owners` | `quora_search_mix` | `quora_ad.id` |
| pinterest | `pinterest_ad` | `pinterest_ad_post_owners` | `pinterest_search_mix` | `pinterest_ad.id` |
| native | `native_ad` | `native_ad_post_owners` | `native_search_mix` | `native_ad.id` |
| google | `google_text_ad` | `google_text_ad_post_owners` | `google_ads_data_v2` | `id` |

The ES index name can be changed in a server's settings. If an ES query says "index not found", ask a developer for the index name of
that server.

The examples below use **Facebook**. For another network, swap the table names from this table.

---

## 1. Requests tab (claims)

**Run in:** the Facebook database.

### 1a. The list of claims

The page shows: reference, complaint id, advertiser named, sender, received, status (Waiting / Accepted / Rejected) and the result.

```sql
SELECT id, claim_reference, complaint_id, name AS advertiser_named, complainant_name, complainant_org,
       status, received_at, decided_by, decided_at, processing_status
  FROM copyright_claims
 ORDER BY id DESC
 LIMIT 25;
```

**Should match:** the first page of claims, in the same order.
- `status` `pending` = **Waiting** on the page, `accepted` = Accepted, `rejected` = Rejected.
- `processing_status` (`ok`, `partial`, `failed`, or empty) = the result shown after an accept.

Only one status (same as the Waiting / Accepted / Rejected filter):

```sql
SELECT id, claim_reference, complaint_id, name, status, received_at
  FROM copyright_claims
 WHERE status = '<pending | accepted | rejected>'
 ORDER BY id DESC;
```

### 1b. One claim

```sql
SELECT *
  FROM copyright_claims
 WHERE complaint_id = '<full complaint id, small letters>';
```

**Should match:** what the claim page shows. `processing_result` holds what happened on each network after the accept.

### 1c. The number on the Requests badge (claims waiting)

```sql
SELECT COUNT(*) AS waiting FROM copyright_claims WHERE status = 'pending';
```

---

## 2. Monitoring › number boxes at the top

**Run in:** each network's database. The page adds up all networks, so run it in each database and add the numbers.

Takedown runs, by mode and status:

```sql
SELECT mode, status, COUNT(*) AS runs,
       SUM(items_planned) AS planned, SUM(items_succeeded) AS deleted, SUM(items_failed) AS failed
  FROM copyright_takedown_runs
 WHERE network = 'facebook'
 GROUP BY mode, status;
```

- `mode = 'dry_run'` rows are **dry runs** (they deleted nothing) and are counted apart from real runs.
- Status words are grouped on the page:
  - **Done:** succeeded, success, completed, complete, done, deleted, verified
  - **Failed:** failed, error, errored, partial_failed
  - **Running:** running, in_progress, started, executing
  - **Waiting:** pending, planned, queued, scheduled, retry, retrying, waiting

Hash jobs, by status:

```sql
SELECT status, COUNT(*) AS jobs
  FROM copyright_image_hash_jobs
 WHERE network = 'facebook'
   AND blocklist_id > 0 AND blocklist_id <= 4294967294
 GROUP BY status;
```

> Why the `blocklist_id` condition? Rows with `blocklist_id` 0 and 4294967295 are the worker's own bookmarks, not real jobs.
> The page never counts them, so your query must leave them out too.

Ad verification (ads waiting, and ads that failed the check):

```sql
SELECT copyright_status, COUNT(*) AS ads
  FROM facebook_ad
 WHERE copyright_status IN (0, 2)
 GROUP BY copyright_status;
```

`0` = **waiting** for the check (hidden from users), `2` = **failed** the check (hidden, will be deleted). `1` = approved (visible);
not counted here.

---

## 3. Monitoring › Ad verification

The page shows the ads that are still waiting (`copyright_status = 0`), with the stage, details, attempts and advertiser.

**Run in:** the network's database.

```sql
SELECT a.id AS our_row_id, a.ad_id AS platform_ad_id, o.post_owner_name AS advertiser,
       d.stage, d.detail, d.attempts, d.first_checked_at, d.last_checked_at
  FROM facebook_ad a
  LEFT JOIN copyright_verification_diagnostics d
         ON d.network = 'facebook' AND d.internal_ad_id = CAST(a.id AS CHAR)
  LEFT JOIN facebook_ad_post_owners o ON o.id = a.post_owner_id
 WHERE a.copyright_status = 0
 ORDER BY a.id
 LIMIT 50;
```

**Should match:** page 1 of Ad verification (oldest first). An empty `stage` is shown as **Not checked yet**.

### 3a. Check one ad in SQL and in Elasticsearch

Use this when an ad shows on one side but not the other, or to confirm an ad is approved everywhere.

SQL:

```sql
SELECT id, ad_id, copyright_status FROM facebook_ad WHERE id = <our row id>;
```

Elasticsearch (ES 6.8; in Kibana Dev Tools or a similar tool):

```json
GET search_mix/_search
{
  "query": { "terms": { "facebook_ad.id": [<our row id>] } },
  "_source": ["facebook_ad.id", "copyright_status"]
}
```

**Should match:** the same `copyright_status` on both sides.
- SQL `1` and ES `1`: approved, the ad is visible to users. Correct.
- SQL `0` and ES `0`: still waiting. It should be listed in Ad verification.
- SQL `1` and ES `0` (or the other way round): **a bug. Report it** with the row id, the network and both values.
- No ES hit at all: the ad is not in search yet. In Ad verification its stage is then **Waiting for search index**.
- A doc with **no** `copyright_status` field: indexed before this feature. It is treated as visible.

---

## 4. Monitoring › Takedown runs

**Run in:** the network's database.

```sql
SELECT run_id, complaint_id, trigger_type, mode, status, started_at, finished_at,
       items_planned, items_succeeded, items_failed, operator, created_at
  FROM copyright_takedown_runs
 WHERE network = 'facebook'
 ORDER BY created_at DESC, run_id DESC
 LIMIT 25;
```

**Should match:** page 1 of Takedown runs. **Planned / Deleted / Failed** = `items_planned` / `items_succeeded` / `items_failed`.

Runs made by the verification cleanup have `trigger_type = 'verification'` and **no** complaint id. So searching the runs by a
complaint id is normally empty; that is expected.

### 4a. The steps of one run (the run's log)

```sql
SELECT id, target_type, internal_ad_id, target_id, `system`, operation, status, error_message, attempts, next_retry_at, created_at
  FROM copyright_takedown_actions
 WHERE run_id = '<run id, small letters>' AND network = 'facebook'
 ORDER BY id;
```

> `system` must be written with backticks (`` `system` ``): it is a reserved word in MySQL 8.

Step counts by system and status (the small boxes above the log):

```sql
SELECT `system`, status, COUNT(*) AS steps
  FROM copyright_takedown_actions
 WHERE run_id = '<run id>' AND network = 'facebook'
 GROUP BY `system`, status;
```

---

## 5. Monitoring › Failures

The newest failed steps of all runs.

```sql
SELECT id, run_id, internal_ad_id, target_id, `system`, operation, status, error_message, attempts, created_at
  FROM copyright_takedown_actions
 WHERE network = 'facebook'
   AND status IN ('failed', 'error', 'errored', 'partial_failed')
 ORDER BY id DESC
 LIMIT 50;
```

**Should match:** page 1 of Failures, newest first.

---

## 6. Monitoring › Blocked (the block list)

**Run in:** the network's database.

```sql
SELECT id, entry_type, identifier_namespace, value, reason, source, complaint_id, status, added_by, created_at, removed_at
  FROM copyright_blocklist
 WHERE network IN ('facebook', 'all')
 ORDER BY id DESC
 LIMIT 50;
```

**Should match:** page 1 of Blocked.
- **Type** on the page = `entry_type`: `advertiser`, `page`, `ad_id`, `url`, `domain`, `image_hash`.
- For an `ad_id` entry, `identifier_namespace` says which id it is: `platform` = platform ad id, `internal` = our row id.
- `added_by = 'copyright-verification'` = added by the verification cleanup (not by a claim).
- Why `IN ('facebook', 'all')`? Blocks from an accepted claim apply to every network, so they are saved with `network = 'all'`
  (a copy of that row is in every network's database). The page lists the network's own rows **and** the `all` rows, and shows
  **all networks** under the Type of an `all` row.

The same filters as the page:

```sql
-- one status (active / revoked / expired)
... AND status = '<status>'
-- one type
... AND entry_type = '<type>'
-- search text (the page's search box; not case sensitive)
... AND LOWER(value) LIKE '%<text in small letters>%'
-- only one claim's blocks ("Follow this claim")
... AND complaint_id = '<full complaint id, small letters>'
```

Put these lines before `ORDER BY`, in place of the `...`.

The counts next to the filters:

```sql
SELECT entry_type, status, COUNT(*) AS entries
  FROM copyright_blocklist
 WHERE network IN ('facebook', 'all')
 GROUP BY entry_type, status;
```

---

## 7. Monitoring › Rejected ads (blocked attempts)

Ads that the block list refused when they came in (they were never saved).

```sql
SELECT t.id, t.platform_ad_id, t.advertiser, t.match_type, t.distance, t.source, t.created_at,
       b.entry_type AS matched_type, b.value AS matched_value
  FROM copyright_blocked_attempts t
  LEFT JOIN copyright_blocklist b ON b.id = t.blocklist_id
 WHERE t.network = 'facebook'
 ORDER BY t.id DESC
 LIMIT 50;
```

**Should match:** page 1 of Rejected ads.
- **Refused because** = `match_type`: `advertiser`, `ad_id`, `url`, `domain`, `sha256` (same image), `phash` (similar image), `page`.
- **matched …** under it = `matched_type` and `matched_value` (the block entry it hit).
- **N bits apart** = `distance` (only for similar images; smaller = closer copy).

Only one claim's rejected ads ("Follow this claim"):

```sql
SELECT t.id, t.platform_ad_id, t.advertiser, t.match_type, t.created_at
  FROM copyright_blocked_attempts t
 WHERE t.network = 'facebook'
   AND t.blocklist_id IN (SELECT id FROM copyright_blocklist WHERE network IN ('facebook', 'all') AND complaint_id = '<complaint id>')
 ORDER BY t.id DESC;
```

---

## 8. Monitoring › Hash jobs

A hash job fingerprints the images of one blocked entry (usually an advertiser), so copies of those images can be caught later.

### 8a. The list of jobs

```sql
SELECT id, blocklist_id, entry_type, advertiser_name, complaint_id, status, attempts,
       requested_gen, run_gen, covered_gen, last_error, created_at, finished_at
  FROM copyright_image_hash_jobs
 WHERE network = 'facebook'
   AND blocklist_id > 0 AND blocklist_id <= 4294967294
 ORDER BY id
 LIMIT 50;
```

**Should match:** page 1 of Hash jobs (oldest first).
- **Runs:** `run_gen` = how many times the job has run. The job panel shows "run 3 of 3" when `run_gen` is 3.
- `requested_gen` bigger than `covered_gen` = the entry was blocked again after the last full run, so a new run is due.
- The numbers shown for a job (ads, images found, hashed, skipped…) are in the `state` column (JSON, under `stats`) and belong to
  the **latest run**.

### 8b. The results of one job (the job panel)

```sql
SELECT id, generation, platform_ad_id, internal_ad_id, outcome, reason, sha256, source_url, updated_at
  FROM copyright_image_hash_results
 WHERE network = 'facebook'
   AND job_id = <job id>
   AND generation = <run number>
 ORDER BY id;
```

**Should match:** the job panel with the same run chosen in the **Run** dropdown. The panel opens on the latest run, so start with
`generation` = the job's `run_gen`.
- **Image result** dropdown = `outcome`: `hashed`, `duplicate`, `skipped`, `failed`.
- Add `AND outcome = '<outcome>'` to check one filter.

How many results each run has (useful when the latest run is empty):

```sql
SELECT generation, outcome, COUNT(*) AS images
  FROM copyright_image_hash_results
 WHERE network = 'facebook' AND job_id = <job id>
 GROUP BY generation, outcome
 ORDER BY generation;
```

> A later run can find nothing when the ads were already deleted (for example by the cleanup). The earlier run still has its
> results: choose it in the **Run** dropdown.

### 8c. Which job belongs to which block

```sql
SELECT j.id AS job_id, j.status, j.run_gen, b.id AS blocklist_id, b.entry_type, b.value, b.complaint_id, b.added_by
  FROM copyright_image_hash_jobs j
  JOIN copyright_blocklist b ON b.id = j.blocklist_id
 WHERE j.network = 'facebook'
   AND b.value = '<advertiser name>';
```

---

## 9. Monitoring › Audit

One audit run per check (for example each verification cleanup), and what it found.

```sql
SELECT audit_id, audit_type, status, expected_count, found_count, takedown_run_id, started_at, finished_at, created_at
  FROM copyright_audit_runs
 WHERE network = 'facebook'
 ORDER BY created_at DESC, audit_id DESC
 LIMIT 25;
```

The findings of one audit:

```sql
SELECT id, finding_type, `system`, location, internal_ad_id, platform_ad_id, target_type, target_value,
       status, resolution, resolved_at, takedown_run_id
  FROM copyright_audit_findings
 WHERE audit_id = '<audit id, small letters>' AND network = 'facebook'
 ORDER BY id;
```

Counts by status (the boxes above the findings):

```sql
SELECT status, COUNT(*) AS findings
  FROM copyright_audit_findings
 WHERE audit_id = '<audit id>' AND network = 'facebook'
 GROUP BY status;
```

---

## 10. The advertiser shown next to an ad id

Wherever the page shows an ad, it also shows the advertiser. For an ad that still exists:

```sql
SELECT a.id AS our_row_id, a.ad_id AS platform_ad_id, o.post_owner_name AS advertiser
  FROM facebook_ad a
  LEFT JOIN facebook_ad_post_owners o ON o.id = a.post_owner_id
 WHERE a.id = <our row id>;          -- or: WHERE a.ad_id = '<platform ad id>'
```

For an ad the cleanup already deleted, the name comes from the takedown run's saved snapshot instead, so this query finds nothing.
That is expected.

---

## Common confusions

| You see | Why | Is it a bug? |
| --- | --- | --- |
| Your count is a little higher than the page | New rows arrived between the page load and your query | No. Press Refresh on the page and compare again. |
| Times differ by 5:30 | The database is in UTC, the page in local time | No |
| The complaint id doesn't match | The page shows only the first 8 characters, or you used capital letters | No. Use the full id in small letters. |
| A complaint search in Takedown runs is empty | Cleanup runs have no complaint id | No |
| The same advertiser has an `all` row and a `facebook` row | The claim blocked it for all networks; the verification cleanup (`added_by = 'copyright-verification'`) blocked it again for one network. Newer code skips names that are already blocked. | Not for old rows. A **new** duplicate is a bug. |
| A hash job's latest run has no results | The ads were deleted before that run | No. Choose an earlier run. |
| SQL `copyright_status` differs from ES for the same ad | The two copies disagree | **Yes. Report it.** |
| A row is in your query but on no page of the list | It should be listed | **Yes. Report it** with the query and the row. |

When you report a mismatch, send: the tab, the network, the id (row id / platform ad id / complaint id / job id), what the page
shows, your query, and what the query returned.
