# Recent ads feed for Category + AI-Meta

`POST /api/v1/common/getRecentAdsForAiMeta` exposes dashboard-eligible ads in
ascending insertion order for `facebook`, `instagram`, `youtube`, `google`,
`native`, `linkedin`, `reddit`, and `pinterest`. It is read-only and does not
manage DS workers.

## Cursor and insertion source

Every platform uses the `created_date` column and immutable `id` primary key from
its SQL ad table. The tables are `facebook_ad`, `instagram_ad`, `youtube_ad`,
`google_text_ad`, `native_ad`, `linkedin_ad`, `reddit_ad`, and `pinterest_ad`.
SQL is necessary because not every search index carries `created_date`.
Elasticsearch then applies the shared `getDisplayableMediaFilter` dashboard
rules and the same response-normalization and SQL-fallback helpers as
`getDescriptionDetails`.

The checkpoint is an opaque Base64URL payload plus HMAC-SHA256 signature. It is
bound to a platform and stores `(created_date, id)`, token version, and issue
time. Tokens are accepted for seven days. Set `RECENT_ADS_CHECKPOINT_SECRET` to a
stable secret shared by all API instances; the configured JWT secret is used as
a deployment fallback. Rotating that secret invalidates outstanding checkpoints.

Production `EXPLAIN FORMAT=JSON` checks on the originally validated platforms
confirmed that the existing `created_date` keyset plan is already effective:
`range` access through the secondary index, primary-key `id` ordering supplied
by InnoDB, and no filesort. LinkedIn and Reddit now use the same feed path and
should be re-EXPLAINed in staging or production if you want a fresh index check
for those two newly enabled networks.

## Request example

```json
{
  "platform": "facebook",
  "checkpoint": null,
  "start_from": "2026-08-17T10:00:00.000Z",
  "limit": 20,
  "wait_seconds": 0
}
```

On later requests, send the durably committed `next_checkpoint`; `start_from` is
ignored. `wait_seconds` is validated in the `0-15` range, but this initial backend
implementation returns immediately rather than holding a long poll.
The first watermark is conservatively rounded down to the start of its UTC second
because legacy `created_date` columns may not retain milliseconds; DS may receive
a harmless same-second replay but cannot lose an ad at rollout.

By default, rows become feed candidates 60 seconds after `created_date`. This
settling interval prevents a committed SQL row from being skipped while its ES
document is still indexing or awaiting refresh. Configure it with
`RECENT_ADS_SETTLE_SECONDS`; reducing it to zero is not recommended until production
SQL-to-ES visibility latency has been measured.

Each request scans at most 2,000 SQL candidates by default (`RECENT_ADS_MAX_SCAN_ROWS`,
minimum 500). This caps one call at four 500-ID eligibility lookups. Eligibility
lookups return IDs only; a second bounded lookup fetches full fields solely for the
rows that can enter the requested page (at most `limit + 1`). When the cap is reached,
the API returns a partial safe page with `has_more: true`, or a retryable
`RECENT_SCAN_LIMIT_REACHED` 503 if none of the candidates were eligible. It never
advances a checkpoint merely to escape an ineligible range.

Google returns its SQL/ES `id` separately from the public `ad_id`. Every other
platform receives an explicit string `ad_id` copied from its public `id`. Native
IMAGE and TEXT records retain the existing `image_url_original`/`ad_image`
fallback behavior.

Empty pages return HTTP 200, `items: []`, and the exact supplied checkpoint. Error
responses include `code`, `message`, `retryable`, and `request_id`; retryable 429
or infrastructure responses also include `retry_after` and a `Retry-After` header.
