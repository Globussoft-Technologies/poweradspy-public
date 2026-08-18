# Recent AI-Meta feed: production readiness checks

Run these checks on one platform database/index at a time, preferably against a
read replica first. All checks below are read-only. Production checks completed
for all six platforms confirm that the existing `created_date` indexes provide
covering range scans with primary-key ordering and no filesort; no new index DDL
is required.

## 1. HeidiSQL: metadata checks (no table scan)

Choose the platform table:

| Platform | SQL table | Elasticsearch index | ES ID field |
|---|---|---|---|
| Facebook | `facebook_ad` | `search_mix` | `facebook_ad.id` |
| Instagram | `instagram_ad` | `instagram_search_mix` | `instagram_ad.id` |
| YouTube | `youtube_ad` | `youtube_ads_data` | `ad_id` |
| Google | `google_text_ad` | `google_ads_data_v2` | `id` |
| Native | `native_ad` | runtime Native index (`native_search_mix` by default) | `native_ad.id` |
| Pinterest | `pinterest_ad` | `pinterest_search_mix` | `pinterest_ad.id` |

Run this after replacing only `facebook_ad` with the current table:

```sql
SELECT VERSION() AS mysql_version,
       DATABASE() AS database_name,
       @@global.time_zone AS global_time_zone,
       @@session.time_zone AS session_time_zone,
       NOW(3) AS session_now,
       UTC_TIMESTAMP(3) AS utc_now;

SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
       COLUMN_DEFAULT, EXTRA, DATETIME_PRECISION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'facebook_ad'
  AND COLUMN_NAME IN ('id', 'created_date');

SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, CARDINALITY
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'facebook_ad'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
```

Stop rollout if `created_date` is absent. Confirm whether it is `DATETIME` or
`TIMESTAMP`, whether its default is `CURRENT_TIMESTAMP`, and that values represent
UTC. If `NOW()` and `UTC_TIMESTAMP()` differ, verify storage semantics with the DBA;
do not infer UTC merely from the column name.

## 2. HeidiSQL: optimizer-only check

Plain `EXPLAIN FORMAT=JSON` does not execute the SELECT. Replace the table name and
use a cursor within the last five minutes:

```sql
SET @cursor_time = DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 5 MINUTE, '%Y-%m-%d %H:%i:%s');
SET @cursor_id = 0;
SET @available_through = DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 60 SECOND, '%Y-%m-%d %H:%i:%s');

EXPLAIN FORMAT=JSON
SELECT id,
       DATE_FORMAT(created_date, '%Y-%m-%d %H:%i:%s.%f') AS inserted_at
FROM facebook_ad
WHERE created_date <= @available_through
  AND (created_date > @cursor_time
       OR (created_date = @cursor_time AND id > @cursor_id))
ORDER BY created_date ASC, id ASC
LIMIT 500;
```

Go criteria:

- access type is `range` (not `ALL`);
- chosen key starts with `created_date` and preserves `id` order;
- no `filesort` or temporary table;
- estimated examined rows are close to the recent five-minute population, not the
  whole table.

An existing single-column `created_date` secondary index may satisfy the
order because InnoDB stores the primary key in secondary-index entries. Trust the
actual plan: do not create a duplicate composite index if the plan already has
`range`, no filesort, and acceptable timing.

## 3. HeidiSQL: bounded actual timing (only after step 2 passes)

On MySQL 8, this executes at most 500 returned rows and aborts after two seconds:

```sql
SET SESSION MAX_EXECUTION_TIME = 2000;
EXPLAIN ANALYZE
SELECT id,
       DATE_FORMAT(created_date, '%Y-%m-%d %H:%i:%s.%f') AS inserted_at
FROM facebook_ad
WHERE created_date <= @available_through
  AND (created_date > @cursor_time
       OR (created_date = @cursor_time AND id > @cursor_id))
ORDER BY created_date ASC, id ASC
LIMIT 500;
```

Target: under 50 ms on the database host under normal load; investigate anything
over 200 ms. MySQL 5.7 does not support `EXPLAIN ANALYZE`; use the application log's
`sql_query_ms` after the optimizer-only check instead. MariaDB uses
`SET STATEMENT max_statement_time=2 FOR SELECT ...` rather than MySQL's session
variable.

## 4. HeidiSQL: fallback join plan

Use one known recent internal ID. This is optimizer-only and should show `const` or
`ref` lookups on every joined table:

```sql
EXPLAIN FORMAT=JSON
SELECT a.id,
       v.title,
       v.text,
       v.newsfeed_description,
       v.image_url,
       o.post_owner_name
FROM facebook_ad AS a
LEFT JOIN facebook_ad_variants AS v ON a.id = v.facebook_ad_id
LEFT JOIN facebook_ad_post_owners AS o ON a.post_owner_id = o.id
WHERE a.id IN (123456789);
```

Use the platform prefixes for other databases. Google uses `google_text_ad*`;
YouTube's creative column is `thumbnail_url`; Native uses `image_url_original`.
Stop if a variants join reports `ALL`; its `<platform>_ad_id` foreign-key column
needs an index before production traffic.

## 5. Kibana Dev Tools: mapping and bounded lookup

First verify the ID field is indexed. This is a metadata-only request:

```http
GET /search_mix/_field_caps?fields=facebook_ad.id,facebook_ad.type,new_nas_image_url,Thumbnail
```

Then paste 1-20 recent SQL IDs from step 3 into this bounded lookup. It has a
two-second timeout and returns only the ID/type fields, not full ad documents:

```http
POST /search_mix/_search?filter_path=took,timed_out,_shards,hits.total,hits.hits._source
{
  "size": 20,
  "timeout": "2s",
  "_source": ["facebook_ad.id", "facebook_ad.type"],
  "query": {
    "bool": {
      "filter": [
        { "terms": { "facebook_ad.id": [123456789] } }
      ]
    }
  }
}
```

Repeat with the index and ID-field table above. Target `timed_out: false`, zero
failed shards, and `took` below 100 ms under normal load. A one-off cold-cache
result can be higher; run no more than three times and compare the warm results.

Finally call the development API with `limit: 20`. Its structured page log records
the exact production query's `sql_query_ms`, `es_query_ms`, returned count, and
insertion lag. It also records `scanned_rows` and `scan_limit_reached`. Go criteria
for a warm development/read-only run are: no scan-limit event, SQL total below
200 ms, ES total below 400 ms, no failed shards/timeouts, and a candidate-to-returned
ratio below 10:1. A higher ratio means the SQL candidate population and dashboard
eligibility are too far apart and must be investigated before enabling six workers.

This is safer and more representative than profiling broad ES queries. Do not use
wildcard, unbounded date-range, `_search` without the ID terms, `profile: true`, or
a large `size` against production during this check.
