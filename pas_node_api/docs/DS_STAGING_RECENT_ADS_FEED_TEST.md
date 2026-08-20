# DS staging test: Recent Ads Category + AI-Meta feed

## Purpose

Validate one returned ad at a time for each supported network before the backend
is promoted to production:

`facebook`, `instagram`, `youtube`, `google`, `native`, `linkedin`, `reddit`,
`pinterest`.

This is a read-only feed test. Do not call the Category or AI-Meta POST APIs, start
production workers, or persist the staging checkpoint as a production checkpoint.

## Preparation

1. Obtain the staging base URL from the backend team.
2. Ensure each network has a recently inserted, dashboard-visible staging ad.
3. Wait at least 60 seconds after insertion; the feed intentionally allows SQL-to-ES
   indexing to settle before exposing an ad.
4. Record one UTC boundary per network that is 5-10 minutes before that known ad.

If no item is returned, confirm that a qualifying staging ad exists before widening
the boundary. Do not repeatedly request a large historical window.

## Test request

Send this request separately for every network, replacing the base URL, platform,
and timestamp:

```http
POST <STAGING_BASE_URL>/api/v1/common/getRecentAdsForAiMeta
Content-Type: application/json
X-Request-ID: ds-recent-facebook-001
```

```json
{
  "platform": "facebook",
  "checkpoint": null,
  "start_from": "2026-08-17T13:00:00.000Z",
  "limit": 1,
  "wait_seconds": 0
}
```

Use a unique request ID for each network. Replace `facebook` in both the header and
body with the network under test.

## Checks for the first response

- HTTP status is `200` and the body is JSON, not HTML.
- `platform` matches the request.
- `items` contains exactly one item.
- `request_id` matches the supplied `X-Request-ID`.
- `server_time` and `items[0].inserted_at` are valid UTC timestamps.
- `items[0].id` and `items[0].ad_id` are non-empty.
- `items[0].insertion_cursor` equals `next_checkpoint` for this one-item page.
- `has_more` is a boolean.
- Expected text and creative fields are present without obviously incorrect URLs or
  content from another ad.
- The warm response completes in under two seconds.

Platform-specific checks:

- **Google:** `id` is the numeric/internal cursor and `ad_id` is the public Google
  identifier accepted by the AI-Meta POST API. Report both values.
- **LinkedIn:** the recent-feed SQL cursor comes from `linkedin_ad.created_at`
  (not `created_date`); report the returned `id`, `ad_id`, and `inserted_at`
  exactly as the backend emits them.
- **Native:** report `native_creative_type`, `image_url_original`, and `ad_image`.
  For IMAGE or TEXT ads with no NAS image, confirm the existing original-image
  fallback is preserved. If no image exists, usable ad text or a clear
  `creative_availability_reason` must be present.
- **All other networks:** confirm `ad_id` is the identifier DS would send to the
  Category/AI-Meta POST API. Report `ad_image` for image ads and `thumbnail` for
  video ads when applicable.

## Replay check

Repeat the exact original request with the same `checkpoint: null`, `start_from`,
and platform. The replay must return the same logical first item:

- same `id`;
- same `ad_id`;
- same `inserted_at`.

The opaque token text may differ because a fresh signed token can be issued. Compare
the item position and content, not the raw token string.

## Backend log checks

Give the backend team each `request_id`. For the corresponding successful page log,
confirm:

- `sql_query_ms < 200`;
- `es_query_ms < 400`;
- `scan_limit_reached: false`;
- no ES timeout or failed shards;
- `returned_count: 1`;
- `available_through` is about 60 seconds behind request time.

These values are application-log fields, not API response fields and not database
records. With the repository's default logging configuration, search
`<API_WORKING_DIRECTORY>/logs/combined-YYYY-MM-DD.log` (or the directory configured
by `LOG_DIR`) for `[getRecentAdsForAiMeta] page` and the supplied request ID. In a
production-mode deployment, the same structured JSON is also written to stdout and
may be available in the server's centralized container/process logs. A non-production
console line may omit the metadata, so use the combined file for staging.

These are single-request staging thresholds, not a substitute for later load-test
percentiles.

## Results to send back

Send the exact request JSON, first response JSON, replay response JSON, client-side
duration, and this completed table:

| Network | HTTP | Client ms | Request ID | id | ad_id | inserted_at | Replay same item | Creative/text correct | SQL ms | ES ms | Scan limit | Notes |
|---|---:|---:|---|---|---|---|---|---|---:|---:|---|---|
| facebook | | | | | | | | | | | | |
| instagram | | | | | | | | | | | | |
| youtube | | | | | | | | | | | | |
| google | | | | | | | | | | | | |
| native | | | | | | | | | | | | |
| linkedin | | | | | | | | | | | | |
| reddit | | | | | | | | | | | | |
| pinterest | | | | | | | | | | | | |

Do not redact IDs, timestamps, timing values, or request IDs. Secrets and unrelated
ad payload content may be redacted.

## Pass condition

Production promotion is approved only after all eight rows pass, the first/replay
responses are supplied, and the backend log thresholds are confirmed. Any wrong
identifier, missing creative contract, checkpoint replay mismatch, timeout, partial
ES response, scan-limit event, or non-200 response must be investigated first.
