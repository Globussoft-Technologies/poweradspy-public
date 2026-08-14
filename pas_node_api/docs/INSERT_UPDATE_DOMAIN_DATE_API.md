# insert-update-domain-date API — Test Guide

Sets a domain's **WHOIS registration date** (`domain_registered_date`) — or marks the domain as
**unresolvable** — across **all 10 networks'** domains tables, and bumps `updated_date = NOW()`
on every network. Node port of the PHP `SupportScrapper@putDomainDate`
(`PUT https://api.poweradspy.com/insert-update-domain-date`), generalised from facebook-only to
every network.

**Status model.** Each domains table has a `status` column driving the backfill loop:

| status | meaning | set how |
|--------|---------|---------|
| `0` PENDING | NULL date, not yet resolved — **returned** by [`get-domains-without-registration-date`](GET_DOMAINS_WITHOUT_REGISTRATION_API.md) | default; or send `status: 0` here to re-queue |
| `1` RESOLVED | a date was found & written | set automatically when you send a `domain_date` |
| `2` UNRESOLVABLE | attempted, no date obtainable (dead / privacy-redacted domain) — **permanently excluded** from the GET | send `status: 2` here |

This is the fix for the "stuck loop": when DS can't find a date for a rubbish domain, it marks it
`status: 2`, so the GET stops re-serving it and the queue drains to fillable domains.

**SQL + Elasticsearch.** Setting a date updates the SQL domains table **and** propagates the date
onto every associated ad's ES doc (the website reads the date off the ad doc, so a SQL-only update
would leave ES stale). ES docs don't store the domain string, so the ads are resolved from SQL
(`<adTable>.domain_id`) and their docs updated via `updateByQuery`. The ES field name + value
format differ per index family (all confirmed against live mappings):

| networks | ES index | date field | format | matched by |
|----------|----------|-----------|--------|-----------|
| facebook, instagram, native, pinterest, reddit, quora, gdn | `*_search_mix` | `<table>.domain_registered_date` | `yyyy-MM-dd` | internal id on `<adTable>.id` |
| google | `google_ads_data` | `domain_registered_date` | `yyyy-MM-dd` | public `ad_id` |
| linkedin, youtube | `*_ads_data` | `domain_registration_date` | **epoch seconds** | internal id on `ad_id` |

ES writes happen **only on the date path** (status 2/0 change no date, so no ES write). SQL remains
the source of truth. A synchronous ES failure or partial response is moved to the durable queue. If
that retry cannot be persisted, the API returns retryable HTTP `503` even though SQL is already set.

**Scale (sync vs async).** A domain can have many ads. When a network has **<= 100** matching ads the
ES update runs **synchronously** and the response carries an exact `es_updated` count. Above that,
the request durably writes a job under `data/domain-date-es-pending` and returns `es_mode: "async"`,
`es_queued: true`, and `es_queue_id`; no ES task is submitted by the request. The background worker
drains one job at a time per network, submits at most one ES task, polls it to completion, and only
then advances to the next chunk or domain. A MySQL `GET_LOCK` advisory lock enforces the same limit
across API processes and fails closed when SQL coordination is unavailable. Active networks do not
block later queue scans, so newly queued work for another idle network can start independently. Jobs
survive API restarts and retain an active ES task id for recovery.

Queued writes use at most 10,000 terms per task and default to 250 updates/second. This changes a
16,431-ad domain from 17 simultaneous unthrottled tasks into two throttled sequential tasks. Updates
use `conflicts: proceed`, `refresh: false`, and an idempotent script that no-ops when the date is
already correct. Before each new chunk, the worker verifies that the queued date is still current in
SQL; superseded jobs are discarded instead of overwriting a newer correction. The sync threshold
remains tunable through `domainDateUpdate.esSyncMaxAds`.

A completed response is accepted only when it is well formed, did not time out, has zero version
conflicts, and contains no bulk/search failures. Partial queued results retry the same chunk with
bounded backoff. Partial or failed synchronous writes are persisted to the same queue. Repeated API
requests reuse an equivalent pending job when found, avoiding unnecessary duplicate work.

**Bounded request work.** The 10 independent network SQL operations are started concurrently
instead of adding each network's latency serially. SQL reads used to locate domain/ad rows have a
10-second mysql2 inactivity timeout. The SQL `UPDATE` deliberately stays on the existing adapter
path: a mysql2 client timeout cannot cancel a mutation already running on the MySQL server, so
applying it to writes could report a false failure while the update still completes. Small sync
writes and queued task submissions/polls use a 10-second ES client timeout and `maxRetries: 0`.
Queue failures are persisted with increasing capped backoff instead of creating another submission
wave. Submission and completed-task failures move to `failed` after 10 unsuccessful attempts; a
polling failure retains its active task id so a possibly running task is never abandoned or duplicated.

The service imports the resolved `src/config` module; it does not read `config.json` or environment
variables directly. The performance controls can be tuned in `config.json` without code changes;
restart the API process after editing them because the service resolves these values at startup.

| `config.json` key | Default | Effect |
|-------------------|---------|--------|
| `domainDateUpdate.esSyncMaxAds` | `100` | Maximum unique matching ads updated synchronously per network; `0` makes all ES updates asynchronous. |
| `domainDateUpdate.sqlQueryTimeoutMs` | `10000` | mysql2 inactivity timeout for domain and ad-id `SELECT` queries only. |
| `domainDateUpdate.esRequestTimeoutMs` | `10000` | Client timeout for each ES `updateByQuery` request. |
| `domainDateUpdate.esTermsChunkSize` | `10000` | Maximum ad ids in one queued ES terms query. Chunks run sequentially. |
| `domainDateUpdate.esRequestsPerSecond` | `250` | Per-task `update_by_query` throttle used by both queued and small sync writes. |
| `domainDateUpdate.esTaskPollIntervalMs` | `5000` | Delay between checks of an active queued ES task. |
| `domainDateUpdate.esQueueSweepIntervalMs` | `5000` | Delay between durable queue scans. |
| `domainDateUpdate.esQueueMaxPendingJobs` | `5000` | Maximum pending jobs accepted before enqueue fails safely. |
| `domainDateUpdate.esQueueMaxSizeMb` | `512` | Maximum combined size of pending and failed queue files. |
| `domainDateUpdate.esQueueMinFreeDiskMb` | `2048` | Free disk reserve preserved by queue admission; `0` disables the reserve check. |
| `domainDateUpdate.esQueueMaxAttempts` | `10` | Bounded submission/completed-task failures before a job moves to `failed`. |

**Deployment prerequisites.** The API process must have persistent write access to its configured
`localCache.dir`, the MySQL account must be able to call `GET_LOCK` / `RELEASE_LOCK`, and the ES
account must be able to read `GET /_tasks/{taskId}`. Completed `.tasks` result documents are deleted
best-effort for successful and failed tasks; cleanup permission is recommended but a cleanup denial
does not block queue progress. Operators must alert on queue admission failures and files in `failed`.

**Update-only:** rows are never inserted. A network whose table has no matching domain is reported
as `not_found` and left untouched.

**All matching rows are updated.** These domains tables have no unique index on `domain`, so a
domain can appear in several rows (some dated, some NULL). The update targets **every** row for the
domain (`WHERE domain = ?`), not just one — otherwise duplicate NULL rows would survive and keep
showing up in [`get-domains-without-registration-date`](GET_DOMAINS_WITHOUT_REGISTRATION_API.md).

Companion to [`get-domains-without-registration-date`](GET_DOMAINS_WITHOUT_REGISTRATION_API.md)
(find the domains needing a date) and the per-network
[`get-domain-registration`](GET_DOMAIN_REGISTRATION_API.md) read.

---

## 1. Endpoint

- **Method:** `PUT`
- **Path:** `PUT /api/v1/common/insert-update-domain-date`
- **Auth:** none (internal, matches the PHP route + the other `common` ops endpoints)
- **Body (JSON):**

| Field | Required | Notes |
|-------|----------|-------|
| `domain_name` | **yes** | Exact domain to match against the `domain` column (e.g. `example.com`). |
| `domain_date` | one of date/status | The registration date, format **`YYYY-MM-DD`** (PHP `date_format:Y-m-d`). Sets `domain_registered_date` + `status = 1`. |
| `status` | one of date/status | `2` = mark UNRESOLVABLE (no date). `0` = reset to PENDING. `1` is invalid without a `domain_date`. |

Provide **either** `domain_date` **or** `status`. A `domain_date` with a conflicting `status`
(anything but 1) → 400. `updated_date` is bumped to `NOW()` for every network.

---

## 2. Response

Body shape: `{ code, message?, error?, data? }`. `code` is also the HTTP status.

| Scenario | HTTP | `code` |
|----------|------|--------|
| Processed (0+ networks updated) | **200** | 200 |
| `domain_name` missing | **400** | 400 (`error` = message) |
| neither `domain_date` nor `status`, bad `Y-m-d`, out-of-range/conflicting `status` | **400** | 400 |
| No network SQL connection available at all | **503** | 503 |
| SQL updated but required ES retry could not be durably queued | **503** | 503, `Retry-After: 5` |
| Every network fails and one or more SQL reads time out | **504** | 504 |
| Every network fails because of non-connection SQL/internal errors | **500** | 500 |

- `error` is a structured object with `type`, `source`, `operation`, `stage`, `network`, `table`, and `details`.
- Per-network failures are reported inside `data.results[network].error` with the same structure.
- Elasticsearch failures are reported inside `data.results[network].es_error`.
- SQL connection failures use `type: sql_connection_error`; SQL query failures use `type: sql_query_error`; bounded SQL read timeouts use `type: sql_timeout_error`.
- ES failures use `type: elasticsearch_connection_error` or `type: elasticsearch_error`; incomplete results use `type: elasticsearch_incomplete_error` and are queued for retry.
- Queue-admission failures use `type: elasticsearch_queue_error`, are retryable, and return HTTP `503` with `Retry-After`.

`data.status` / `data.domain_date` echo the resolved action. `data.results` reports the outcome per
network: `es_mode` (`sync`|`async`), `es_matched_ads`, and either `es_updated` (sync) or
`es_queued`, `es_queue_id`, `es_chunks`, and `es_requests_per_second` (async). `es_tasks` is empty in
the immediate response because the queue worker has not submitted work yet. Structured `error` /
`es_error` objects report request-time failures. `data.summary` totals `es_matched_ads`,
`es_updated`, `es_async_networks`, `es_queued_networks`, `es_errors`, `timeouts`, and `duration_ms`.
When a small synchronous write is deferred, the network result also contains
`es_deferred_after_sync_failure: true` and `es_retry_reason`.

Each network result includes `timings_ms` for `select_rows`, `update_rows`, `propagate_date`, and
`total`. ES propagation also includes `es_timings_ms` for `resolve_ad_ids`, `submit_es`, and `total`.
The top-level `data.timings_ms` contains total request time and all per-network timings. These are
additive response fields; the existing result/status fields are unchanged.

### Error examples

#### 400 - invalid date format

```json
{
  "code": 400,
  "message": "The domain_date does not match the format Y-m-d.",
  "error": {
    "type": "validation_error",
    "source": "request",
    "operation": "update-domain-date",
    "field": "domain_date",
    "value": "07/09/2026"
  }
}
```

#### 503 - all SQL networks unavailable

```json
{
  "code": 503,
  "message": "No network SQL connection was available.",
  "error": {
    "type": "sql_connection_error",
    "source": "sql",
    "operation": "update-domain-date",
    "stage": "fanout",
    "details": {
      "failed_networks": ["facebook", "linkedin"]
    }
  },
  "data": {
    "domain": "example.com",
    "domain_date": "2026-07-09",
    "status": 1,
    "results": {
      "facebook": {
        "status": "error",
        "code": 503,
        "message": "SQL connection not available",
        "error": {
          "type": "sql_connection_error",
          "source": "sql",
          "operation": "update-domain-date",
          "stage": "network_connection",
          "network": "facebook",
          "table": "facebook_ad_domains"
        }
      }
    },
    "summary": {
      "updated": 0,
      "not_found": 0,
      "errors": 2,
      "timeouts": 0,
      "es_matched_ads": 0,
      "es_updated": 0,
      "es_async_networks": 0,
      "es_queued_networks": 0,
      "es_errors": 0,
      "duration_ms": 8
    }
  }
}
```

#### 200 with ES failure on one network

```json
{
  "code": 200,
  "message": "Domain date update processed",
  "data": {
    "domain": "example.com",
    "domain_date": "2026-07-09",
    "status": 1,
    "results": {
      "google": {
        "status": "updated",
        "matched_rows": 2,
        "ids": [11, 12],
        "new_status": 1,
        "updated_date_touched": true,
        "es_index": "google_ads_data",
        "es_mode": "sync",
        "es_matched_ads": 3,
        "es_error": {
          "type": "elasticsearch_connection_error",
          "source": "elasticsearch",
          "operation": "update-domain-date",
          "stage": "propagate_date",
          "table": "google_text_ad_domains",
          "details": {
            "message": "Elasticsearch client not available"
          }
        }
      }
    },
    "summary": {
      "updated": 1,
      "not_found": 9,
      "errors": 0,
      "es_matched_ads": 3,
      "es_updated": 0,
      "es_async_networks": 0,
      "es_queued_networks": 0,
      "es_errors": 1
    }
  }
}
```

### 200 example — set a date (status → 1)

```
PUT /api/v1/common/insert-update-domain-date
Content-Type: application/json

{ "domain_name": "example.com", "domain_date": "2026-07-09" }
```
```json
{
  "code": 200,
  "message": "Domain date update processed",
  "data": {
    "domain": "example.com",
    "domain_date": "2026-07-09",
    "status": 1,
    "results": {
      "facebook":  { "status": "updated", "matched_rows": 1, "ids": [22], "new_status": 1, "updated_date_touched": true, "es_index": "search_mix", "es_mode": "sync", "es_matched_ads": 3, "es_updated": 3 },
      "google":    { "status": "updated", "matched_rows": 2, "ids": [11, 12], "new_status": 1, "updated_date_touched": true, "es_index": "google_ads_data", "es_mode": "async", "es_matched_ads": 5200, "es_tasks": [], "es_queued": true, "es_queue_id": "24130_1786515312000_1", "es_chunks": 1, "es_requests_per_second": 250 },
      "reddit":    { "status": "not_found" },
      "quora":     { "status": "error", "message": "..." }
    },
    "summary": { "updated": 2, "not_found": 7, "errors": 1, "timeouts": 0, "es_matched_ads": 5203, "es_updated": 3, "es_async_networks": 1, "es_queued_networks": 1, "es_errors": 0, "duration_ms": 214 }
  }
}
```

### 200 example — mark unresolvable (no date found)

```
{ "domain_name": "some-dead-domain.xyz", "status": 2 }
```
Sets `status = 2` on every matching row across all networks (date left NULL); `data.status` is `2`
and `data.domain_date` is `null`. The domain stops appearing in `get-domains-without-registration-date`.

Per-network `status` (the outcome field): `updated` | `not_found` | `error`. `new_status` is the
`status` value written to the rows.

---

## 3. curl

```bash
BASE=http://localhost:4000   # or https://stagingtest-api.poweradspy.com

# update across all networks
curl -s -X PUT -w "\n[HTTP %{http_code}]\n" \
  -H "Content-Type: application/json" \
  -d '{"domain_name":"example.com","domain_date":"2026-07-09"}' \
  "$BASE/api/v1/common/insert-update-domain-date"

# mark a rubbish/unresolvable domain so it stops coming back in the fetch API
curl -s -X PUT -w "\n[HTTP %{http_code}]\n" \
  -H "Content-Type: application/json" \
  -d '{"domain_name":"some-dead-domain.xyz","status":2}' \
  "$BASE/api/v1/common/insert-update-domain-date"

# bad date → 400
curl -s -X PUT -w "\n[HTTP %{http_code}]\n" \
  -H "Content-Type: application/json" \
  -d '{"domain_name":"example.com","domain_date":"07/09/2026"}' \
  "$BASE/api/v1/common/insert-update-domain-date"
```

---

## 4. Operational logging

The controller logs request receipt and completion with the request id, HTTP status, total duration,
summary, and top-level error type/stage. The service logs each network's start and completion plus
stage timings. Queue logs include the queue id, network, ES task id, chunk position, configured
throttle, retries, and completion totals. Request and worker failures retain their stage and timing.

Useful event names:

- `insert-update-domain-date request received`
- `insert-update-domain-date request completed`
- `insert-update-domain-date request failed`
- `domain date network completed`
- `domain date ad-id lookup failed`
- `domain date ES propagation failed`
- `domain date ES sync update deferred to queue`
- `domain date ES update queued`
- `domain date ES enqueue reused pending job`
- `domain date ES task submitted`
- `domain date ES queue job completed`
- `domain date ES queue job deferred`
- `domain date ES queue job superseded`
- `domain date ES queue job moved to failed after retry limit`
- `domain date update processed with warnings`
- `domain date update fanout failed`

The application's request-context middleware automatically adds `requestId` to service logs, so a
single slow or failed call can be followed across controller, SQL, and ES stages. The API does not
log request credentials or Elasticsearch script values.

## 5. Implementation reference
- Service (network config + per-network update): `src/services/common/services/updateDomainDateService.js`
- Durable ES queue + worker: `src/services/common/helpers/domainDateEsQueue.js`
- Controller: `src/services/common/controllers/updateDomainDateController.js`
- Route: `src/services/common/routes/commonRoutes.js` (`PUT /insert-update-domain-date`)
- Tests: `tests/services/common/updateDomainDateService.test.mjs`
- Queue tests: `tests/services/common/domainDateEsQueue.test.mjs`
- Migration (adds `updated_date` to facebook/linkedin domains tables and backfills resolved rows): `scripts/domain-migrations/add-facebook-linkedin-updated-date.js` (dry-run by default; `--commit` to run; env-driven for dev/prod)
- PHP original: `poweradspy/api/app/Modules/User/Controllers/SupportScrapper.php` → `putDomainDate`
