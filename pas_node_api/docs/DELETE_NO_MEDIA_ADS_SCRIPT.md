# Delete ads with no displayable media

`scripts/delete-no-media-ads.js` deletes, from Elasticsearch and MySQL, the ads the search API never
shows because they have no displayable media. It runs on every network except tiktok, chatgptads and
admob. The engine is the same as `delete-placeholder-media.js` (`--mode=no-media`).

## What is deleted

An ES doc is deleted when both of these hold:

- it has one of the network's media types:

  | Network | Types |
  |---|---|
  | facebook | IMAGE, VIDEO |
  | instagram | IMAGE, VIDEO, STORIES |
  | youtube | VIDEO, DISCOVERY, IMAGE, DISPLAY |
  | linkedin, reddit, quora, pinterest, native | IMAGE, VIDEO |
  | gdn | IMAGE, (empty) |
  | google | image |

- it **fails the network's displayable-media gate**. This is the same gate the search uses
  (`src/services/common/helpers/displayableMediaFilters.js`).

Never deleted:

- every ad the search shows;
- YouTube DISPLAY/IMAGE ads that are shown under GDN;
- types hidden on purpose: Google organic search and text, YouTube BANNER and TEXT, every TEXT type.

## Fail-safes

1. **The SQL media has a NAS path.** If the SQL media column contains `PowerAdspy` or `pas-prod`
   (`--keep-sql-patterns`), the ad is kept in both ES and SQL, because its image exists and only the
   ES doc is missing it. The kept ads are listed in
   `data/placeholder-media/no-media/<network>.kept-sql-media.jsonl`.
2. **Another ES doc of the ad is shown.** The SQL ad is kept while any other ES doc of it passes the
   search gate. These are listed in `<network>.sql-kept.jsonl`.
3. **The gate is out of date.** The script refuses to run against the old gate, the one from before
   2026-11-11 with the duplicate FB/IG `must_not` key. Deploy `src/services` first.

## Production numbers (2026-11-11)

From the read-only dry run:

| Network | ES docs to delete | Kept by fail-safe 1 |
|---|---|---|
| instagram | 1,46,26,119 (17.8 lakh are STORIES) | full dry run only |
| facebook | 89,37,647 | full dry run only |
| pinterest | 27,60,597 | full dry run only |
| youtube | 11,26,823 | full dry run only |
| google (image) | 9,12,545 | full dry run only |
| linkedin | 48,755 | 11,018 |
| reddit | 31,711 | 679 |
| quora | 9,988 | 1,179 |
| native | 118 | 0 |
| gdn | 0 | — |

The total is about 2.85 crore ES docs, roughly 277 GB.

## Run it

Run from `pas_node_api/` on the server. ES and SQL come from `config.json`.

```bash
node scripts/delete-no-media-ads.js --quick                        # counts only (read-only, fast)
node scripts/delete-no-media-ads.js                                # full dry run: ID scan + SQL fail-safe, read-only
node scripts/delete-no-media-ads.js --networks=linkedin,quora      # some networks only
setsid nohup node scripts/delete-no-media-ads.js --apply < /dev/null >> delete-no-media.log 2>&1 &
node scripts/delete-no-media-ads.js --status                       # progress of a running apply
```

Behaviour:

- The run is **resumable**. Run the same command again to continue. `--restart` starts over.
- The state lives in `data/placeholder-media/no-media/` and never mixes with a date or placeholder run.
- The live table and `decisions.log` show every speed or parallelism change and the reason for it.

## Speed and load

All networks run at the same time. Each network's ES lane and SQL lane keep several batches in flight
with ordered, resumable cursors. The wrapper's ceilings are:

| Setting | Ceiling |
|---|---|
| `--es-parallel` | 8 |
| `--es-max-batch` | 5000 |
| `--scan-slices` | 8 |
| `--scan-parallel` | 12 |
| `--sql-parallel` | 12 |
| `--sql-max-batch` | 3000 |

The engine starts low and grows only while there is headroom:

- **ES:** heap, CPU, queues and rejections.
- **SQL:** Threads_running and MySQL CPU.

It halves and pauses when it sees pressure. SQL sessions use `binlog_row_image=MINIMAL`, and a host
pauses after its binlog grows 100 GB. Any ceiling can be lowered by passing the flag, for example
`--es-parallel=4`.
