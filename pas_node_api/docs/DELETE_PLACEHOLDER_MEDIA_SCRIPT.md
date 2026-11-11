# Delete Placeholder-Media Ads + Old Google Organic (ES + SQL): Runbook

**Script:** `pas_node_api/scripts/delete-placeholder-media.js`

- Self-contained: it uses only `src/config/networks` and `src/database/DatabaseManager`, and no other script.
- Replaces `delete-placeholder-media-es.js`, which was ES only.

## Commands (run from `pas_node_api/`)

```bash
node scripts/delete-placeholder-media.js              # dry run: every network — counts, sizes, time. Deletes nothing.
node scripts/delete-placeholder-media.js --apply      # delete from ES + SQL
node scripts/delete-placeholder-media.js --apply=es   # ES only
node scripts/delete-placeholder-media.js --apply=sql  # SQL only
```

**Progress:** the apply run prints its live progress table in the same terminal. With `nohup`, it goes to the log:

```bash
nohup node scripts/delete-placeholder-media.js --apply > cleanup.log 2>&1 &
tail -f cleanup.log
```

- **Resume:** after Ctrl+C, a crash or a reboot, run the same command again.
- **One network:** `--networks=quora` (or several, comma-separated).

## What it deletes

### Default (`--mode=date`, since 2026-11-05): every ad last seen before 2024

On all 9 networks, every ad with `last_seen < --before` (default `2024-01-01`) is deleted from ES and SQL. There is no other condition: no placeholder check, no Google type filter.

| Store | Field |
|---|---|
| ES | each network's own last_seen field (`facebook_ad.last_seen`, `instagram_ad.last_seen`, `reddit_ad.last_seen`, `gdn_ad.last_seen`, `quora_ad.last_seen`; `last_seen` for youtube, linkedin, google and tiktok) |
| SQL | `<main table>.last_seen`, plus the ad's child tables. TikTok has no SQL. |

All the ES fields are `date` type. youtube and linkedin store `epoch_second`, and the query's own `yyyy-MM-dd` format handles that.

How it runs:
- **ES:** one server-side `_delete_by_query` task per network, with at most `--dbq-parallel=2` at once per cluster. The tasks share `--es-dbq-rps`, which the load controller lowers under pressure.
- **SQL:** walks the main table by id in windows of 50k ids.

Production check, 2026-11-05 (ES docs with `last_seen < 2024`):

| Network | Old / total | Share |
|---|---|---|
| facebook | 18,786,654 / 35,387,601 | 53% |
| instagram | 17,564,399 / 42,538,355 | 41% |
| youtube | 3,762,991 / 6,890,477 | 55% |
| linkedin | 166,710 / 745,658 | 22% |
| reddit | 326,870 / 378,476 | 86% |
| gdn | 0 / 592,318 | 0% |
| quora | 185,359 / 206,928 | 90% |
| google | 188,980,134 / 197,208,515 | 96% |
| tiktok | 1 / 128,881 | ~0% |
| **Total** | **~229.8M / 284.1M** | **~81%** |

**MySQL binlog safety.** Every deleted row is written to the binary log. With `binlog_row_image=FULL` that is the whole row, and Google's `google_ad_html_lander_content` alone is about 1.8 TB. The script handles this in three ways:
- **MINIMAL row image:** each delete session asks for `SET SESSION binlog_row_image='MINIMAL'`, so only primary keys are logged. This needs `SESSION_VARIABLES_ADMIN`; if the server denies it, FULL rows are logged.
- **Growth guard:** a host's deletes pause once its binary logs have grown `--max-binlog-growth-gb=100` since the start. The guard reads the size with `SHOW BINARY LOGS`, which needs `REPLICATION CLIENT`; without that privilege the guard is off for that host.
- **Dry-run table:** per host it shows binlog on/off, format and row image, current size, expiry, whether MINIMAL is allowed, and the estimated binlog growth. A second table shows when each network will be done ("DONE AT").

The sections below describe the OLD rule, which is still available with `--mode=placeholder`.

### A. Placeholder media

Networks: facebook, instagram, youtube, linkedin, reddit, tiktok, gdn, quora. Patterns: `pasimage`, `pasvideo`, `bydefault`, `DefaultImage`.

An ad is deleted when either:
1. an ES media field holds a placeholder, or
2. the ES doc has **no** media fields at all, and the ad's SQL media column holds a placeholder file (looked up by ad id).

**Rule 1 also requires that NO media field is real.** A real value is a NAS path such as `/PowerAdspy/...` or `/pas-prod/...`, or an http URL. A production check on 2026-11-05 found many docs that render fine, where only an old field still holds a placeholder:
- instagram: real `new_nas_image_url`, but `thumbnail` = `pasimages/...`
- linkedin: `ad_video` = `pasimages/...`
- facebook: an `othermedia` array with one `/DefaultImage.jpg` among real images

These docs are **kept**. The dry run counts them in the "KEPT: REAL MEDIA" column. For TikTok, only `video_cover` counts as real media, because `video_url` is an expiring tiktokcdn link.

**SQL patterns are different from the ES ones:** only `DefaultImage` and `bydefault` (`--sql-patterns`). SQL media columns store **real** media as relative paths such as `pasimages/reddit/og62xv.jpg`. A `pasimage` / `pasvideo` match there means nothing, so the script refuses those patterns for SQL. A production check on 2026-11-05 confirmed this.

| Network | ES media fields | SQL media columns (checked for rule 2) |
|---|---|---|
| facebook | new_nas_image_url, Thumbnail, othermedia | facebook_ad_variants.image_url, facebook_ad_image_video.ad_image_video |
| instagram | new_nas_image_url, thumbnail, Thumbnail, othermedia | instagram_ad_variants.image_url, instagram_ad_image_video.ad_image_video |
| youtube | new_nas_image_url, thumbnail_url | youtube_ad_variants.thumbnail_url / video_url, youtube_ad_image_video.ad_image_video |
| linkedin | new_nas_image_url, ad_video | linkedin_ad_variants.image_url, linkedin_ad_image_video.ad_image_video |
| reddit | new_nas_image_url, Thumbnail | reddit_ad_variants.image_url, reddit_ad_image_video.ad_image_video |
| gdn | new_nas_image_url | gdn_ad_variants.image_url |
| quora | new_nas_image_url, thumbnail | quora_ad_variants.image_url / video_url, quora_ad_image_video.ad_image_video |
| tiktok | video_cover, video_url | — (ES only) |

- **Columns not checked:** `old_*` and `*_original` are history or source URLs.
- **Ads kept in SQL:** an ad stays when it still has another ES doc that is not being deleted and shows real media. Each one is listed in `<network>.sql-kept.jsonl`.

### B. Google organic search before 2023

| Store | Filter |
|---|---|
| SQL | `google_text_ad.type = 'ORGANIC SEARCH' AND last_seen < '2023-01-01 00:00:00'` |
| ES | `type: "organic search"` (keyword, lowercased) and `last_seen < 2023-01-01`. This includes ES docs with no SQL row. |

- **Change the date:** `--before=YYYY-MM-DD`.
- **Change the column:** `--google-date-column=first_seen`.

### Not touched

- **Networks:** Pinterest, Native, AdMob, ChatGPT, and any non-organic Google ads.
- **SQL tables:** activity, log, hidden, favourite, queue and history tables found by name. The dry run lists them.

## Big tables without an index

A production check on 2026-11-05 found three child tables with no index on the ad column:
- `single_ad_analytics`: 11M rows
- `instagram_page_details`: 2.2M rows
- `youtube_comments`: 854 MB

Every delete batch would scan the whole table, so these tables are **skipped automatically**. Both the dry run and the apply run list them as "skipped". Their rows for the deleted ads stay behind as orphans. `--allow-unindexed` deletes from them anyway.

## Dry-run probe

All networks are probed in parallel. A live table shows, per network:
- index, phase (ES count → ES media scan → SQL media check → SQL probe → done)
- scanned / total, %, found (to delete), docs/s, ETA, SQL host

Above the table: overall % and ETA, the ES cluster load and scan slots, and SQL `Threads_running`.

**Shared ES cluster:** all networks share one scan budget per cluster.
- It starts at 2 requests at once and adds one every 10 s while heap < 70%, CPU < 55%, the search queue is ≤ 25, and there are requests waiting (max `--scan-parallel=8`).
- On heap > 80%, CPU > 70%, search queue > 100, search rejections or red status it halves and pauses 20 s.
- Big scans are split into sliced scrolls: 4 slices above 1M docs, 2 above 200k (`--scan-slices`).

**Shared SQL host** (reddit + quora): the SQL media check backs off while `Threads_running` > 16.

**Decisions:** every decision and its reason is written to `data/placeholder-media/<run>/decisions.log`. The last 8 show under the table; without a TTY (nohup) they are printed as they happen. Apply logs its own decisions (bulk slots, batch, pauses, SQL host pauses) the same way.

## Progress table

Every 5 s the script prints:
- Per ES cluster: load (heap, CPU, write queue, status), bulk requests running at once, batch size, and the Google delete-by-query speed.
- `Threads_running` per SQL host.
- This machine's load and the script's memory.

Then one row per network:

| Group | Columns |
|---|---|
| ES | state, done/total, %, /s, ETA |
| SQL | host, state, progress, %, ads deleted, rows deleted, kept, ETA |

ETAs are shown as `1d 2h 3m`. Google's SQL progress is the position in `google_text_ad.id`.

## Speed and safety

- **ES, placeholder**
  - The wildcard query runs once per network, collecting IDs into an ID file. Deletes then go by `_id` in bulk.
  - Per ES cluster, the number of bulk requests at once (1 → `--es-parallel=4`) and the batch size (500 → 2000) grow while the node is healthy.
  - Both halve, and the script pauses, on heap > 80%, CPU > 70%, write queue > 50, a write rejection, or red/unreachable status.
- **ES, Google:** one server-side `_delete_by_query` task.
  - Its speed (top: `--es-dbq-rps=3000`) is re-throttled live from the same load readings.
  - The task id is saved: a restarted script re-attaches to the running task.
  - A task lost with an ES restart is started again; it only matches what is left.
  - Ctrl+C cancels the task.
- **SQL**
  - Different hosts run in parallel. Networks on one host (reddit + quora; linkedin) run one after another.
  - Each batch is one short transaction: children first, then the ad. The lock wait is 10 s.
  - The batch size (300 → 2000) follows batch time. A host pauses while its `Threads_running` is above 16.
  - Google is walked in id windows of 50k, so every SELECT stays short.
  - Only plain queries are used. Prepared statements could fill MySQL's global `max_prepared_stmt_count` and break the app.
- **Outages and crashes**
  - ES or SQL down, a timeout, 429, deadlock or lock wait: that lane waits 15 s → 2 min and retries. Deletes are idempotent, so a retry is safe.
  - A crash: the supervisor restarts the worker (10 s → 5 min backoff, `--max-restarts=30`), which continues from the saved cursors.
  - A network that fails 3 times with a non-transient error is skipped until it is fixed and `--restart` is used.
- **This machine**
  - Below-normal CPU priority, worker heap capped (`--max-heap-mb=512`).
  - Only one batch in memory: IDs are read from the file by byte offset.
  - Pauses while the load average per CPU is above 0.8.
- **State:** kept in `data/placeholder-media/<run>/`:
  - ID files (also the record of what was deleted)
  - per-network state with separate ES and SQL cursors, and the Google task id
  - `progress.json`
  - `report-apply-*.json`

  Saved progress for a different target, pattern list or date is refused. Use `--restart` or `--run=name`.

## Other ES / SQL than config.json

**Current setting:** ES does not come from config.json. It is set at the top of the script:

| Target | Networks | Node | User |
|---|---|---|---|
| `ES_TARGET` | facebook, instagram, youtube, linkedin, reddit, gdn, quora, google | `http://163.227.174.138:64201` | elastic |
| `TIKTOK_ES_TARGET` | tiktok | `http://163.227.174.149:64203` | elastic |

- Index names and all SQL still come from config.json.
- Fill both passwords in the script, or pass `--es-pass=... --tiktok-es-pass=...`. With a password missing, the script stops before connecting.

Otherwise, uncomment the `OVERRIDES` block at the top of the script, or use `--overrides=file.json`, or flags. Later sources win:

config.json < `OVERRIDES` < `--overrides=file.json` < flags

```bash
node scripts/delete-placeholder-media.js --es-node=http://10.0.0.5:9200 --es-user=elastic --es-pass=XXX --es-index=facebook:search_mix
```

Only the keys you set change. Overridden targets are marked `(override)` in the output.

## Before applying Google

Google is large:
- `google_text_ad` has about 266M ids.
- Organic search is about 146M of 197M ES docs.
- `google_text_ad_variants` has 321M rows (671 GB).

Before you apply:
1. Run the dry run and read its Google count and time.
2. Check the free disk space and binlog retention on the Google SQL host. Every deleted row is written to the binlog.
3. Expect days rather than hours.

Disk is freed only after `OPTIMIZE TABLE` (MySQL) or segment merges (ES).
