# Competitor Stats ES 6.8 Querying

`POST /get-competitor-count-new` uses Elasticsearch 6.8 `_msearch` by default.
Each competitor/network subsearch combines the displayable-media and supported-
country query with these aggregations in one scan:

- deduplicated all-time ad count;
- deduplicated today, yesterday, last-week, last-month and last-year counts;
- country buckets;
- impression and popularity averages for Facebook and Instagram;
- calculated average and total budget for Facebook and Instagram.

Google contributes ad counts, date buckets and countries. It intentionally
does not request Facebook/Instagram-derived engagement or budget fields, which
are not part of the Google ad schema.

Facebook, Instagram and Google run against their independently configured ES
servers. A failed network or individual subsearch is logged and contributes
zero while healthy networks continue returning data.

## Configuration

These optional values belong in the deployed competitor service's
`config/localDev.json`. Code defaults are used when a key is absent.

| Key | Default | Allowed by code | Purpose |
| --- | ---: | ---: | --- |
| `COMPETITOR_STATS_USE_MSEARCH` | `true` | boolean | Restart-time rollout/rollback switch. |
| `COMPETITOR_STATS_MSEARCH_BATCH_SIZE` | `25` | `1-100` | Competitor subsearches sent in one `_msearch` request per network. |
| `COMPETITOR_STATS_MSEARCH_MAX_CONCURRENT_SEARCHES` | `4` | `1-20` | ES 6.8 `max_concurrent_searches`. |
| `COMPETITOR_STATS_MSEARCH_MAX_CONCURRENT_SHARD_REQUESTS` | `2` | `1-20` | ES 6.8 `max_concurrent_shard_requests` per subsearch. |

The three network jobs execute in parallel because they use separate clusters.
Chunks for one network execute sequentially. Do not add an automatic legacy
retry after an `_msearch` failure: the first ES work may still be active, and a
retry would duplicate load.

## Observability

Every request writes one `ES 6.8 msearch completed` log with total duration,
competitor count, selected limits, failed subsearch count, and per-network
duration/batch/failure totals. Compare these values before changing defaults.

To roll back, set `COMPETITOR_STATS_USE_MSEARCH` to `false` and restart the
competitor service. The legacy implementation is selected from startup config;
the service never switches query strategies during an active request.
