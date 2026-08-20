# get-domains-without-registration-date API — Test Guide

A read-only, cross-network lookup that returns the **distinct** domains in a network's domains
table that still need a WHOIS registration date — i.e. `domain_registered_date IS NULL` **and
`status = 0` (PENDING)** — ordered so the most recently-updated domains come first. Useful for
ops / backfill (finding domains still awaiting a registration-date enrichment).

**The `status = 0` filter is what prevents the backfill loop from getting stuck.** Domains that
were tried and can't be resolved (dead / privacy-redacted — no date obtainable anywhere) are
marked `status = 2` (UNRESOLVABLE) via the update API and are **permanently excluded** here, so
they never get re-served. Results are DISTINCT by domain (a domain that spans multiple rows —
these tables have no unique index on `domain` — is returned once).

Companion to [`insert-update-domain-date`](INSERT_UPDATE_DOMAIN_DATE_API.md) (writes the date or
marks a domain unresolvable) and the [`get-domain-registration`](GET_DOMAIN_REGISTRATION_API.md) read.

---

## 1. Endpoint

- **Method:** `GET`
- **Path:** `GET /api/v1/common/get-domains-without-registration-date`
- **Auth:** none (internal, matches the other `common` ops endpoints)
- **Query params:**

| Param | Required | Notes |
|-------|----------|-------|
| `network` | **yes** | One of the 10 supported networks (see table below). |
| `limit` | no | Max rows to return. Integer **1–50**. Default `50`. Values above 50 are clamped to 50. |

### Supported networks & domains tables

| Network | Domains table | Sort column (DESC) |
|---------|---------------|--------------------|
| facebook | `facebook_ad_domains` | `updated_date` |
| linkedin | `linkedin_ad_domains` | `updated_date` |
| instagram | `instagram_ad_domain` | `updated_date` |
| google | `google_text_ad_domains` | `updated_date` |
| youtube | `youtube_ad_domains` | `updated_date` |
| native | `native_ad_domains` | `updated_date` |
| pinterest | `pinterest_ad_domains` | `updated_date` |
| reddit | `reddit_ad_domain` | `updated_date` |
| quora | `quora_ad_domain` | `updated_date` |
| gdn | `gdn_ad_domains` | `updated_date` |

TikTok is intentionally excluded (no SQL domains table).

## Google production performance

Google uses an indexed keyset scan instead of executing `GROUP BY domain` over the complete
pending set. Rows are read by `updated_date DESC, id DESC`; the first occurrence of each domain
is retained, preserving the legacy `MAX(updated_date)` ordering and unique-domain response.

The supporting SQL index is managed by this idempotent script:

```bash
# Read-only preflight
node scripts/apply-domain-pending-recency-index.js --status

# Add the online composite index
node scripts/apply-domain-pending-recency-index.js --apply

# Monitor an apply already running in another terminal
node scripts/apply-domain-pending-recency-index.js --monitor

# Optional rollback (removes only the index owned by this script)
node scripts/apply-domain-pending-recency-index.js --rollback
```

When MySQL exposes stage counters, apply/monitor prints actual percentage and ETA every five
seconds. Without permission to read the Performance Schema stage tables it prints the live
process state and elapsed time instead of inventing an estimate.

Deploy the index first and application code second. The code remains valid before the index
exists, but production performance is only guaranteed after the index is present.

Google lookups also use a MySQL advisory lock. It prevents separate PM2 workers or backend
instances from running the same lookup concurrently. A concurrent request receives HTTP `429`
with `error.type = request_in_progress` and `retry_after_seconds = 2`; the caller should retry.

---

## 2. Response

Body shape: `{ code, message, error?, data?, meta? }`. `code` is also the HTTP status.

| Scenario | HTTP | `code` | `message` |
|----------|------|--------|-----------|
| Found (0+ rows) | **200** | 200 | `Domains fetched successfully` |
| `network` missing | **400** | 400 | `Please provide a network. Available: …` |
| Unsupported `network` | **400** | 400 | `Unsupported network: … Available: …` |
| Invalid `limit` (non-int / < 1) | **400** | 400 | `Invalid limit. Provide a positive integer up to 50.` |
| Concurrent Google lookup | **429** | 429 | `A Google pending-domain lookup is already running. Please retry shortly.` |
| DB query error | **500** | 500 | `SQL query failed` |
| Network SQL connection unavailable | **503** | 503 | `SQL connection not available for network …` |

- `error` is a structured object with `type`, `source`, `operation`, `stage`, `network`, `table`, and `details`.
- Validation problems use `type: validation_error`.
- SQL issues use `type: sql_connection_error` or `type: sql_query_error`.

### Error examples

#### 400 - invalid network

```json
{
  "code": 400,
  "message": "Unsupported network: tiktok. Available: facebook, linkedin, instagram, google, youtube, native, pinterest, reddit, quora, gdn",
  "error": {
    "type": "validation_error",
    "source": "request",
    "operation": "get-domains-without-registration-date",
    "field": "network",
    "value": "tiktok",
    "details": {
      "expected": "facebook, linkedin, instagram, google, youtube, native, pinterest, reddit, quora, gdn"
    }
  }
}
```

#### 500 - SQL query failure

```json
{
  "code": 500,
  "message": "SQL query failed",
  "error": {
    "type": "sql_query_error",
    "source": "sql",
    "operation": "get-domains-without-registration-date",
    "stage": "query",
    "network": "google",
    "table": "google_text_ad_domains",
    "details": {
      "message": "Unknown column 'status' in 'where clause'",
      "code": "ER_BAD_FIELD_ERROR",
      "errno": 1054,
      "sqlState": "42S22"
    }
  }
}
```

### 200 example

```
GET /api/v1/common/get-domains-without-registration-date?network=google&limit=2
```
```json
{
  "code": 200,
  "message": "Domains fetched successfully",
  "data": [
    { "domain": "example-new.com", "updated_date": "2026-07-08 11:02:44" },
    { "domain": "another.io",      "updated_date": "2026-07-08 09:15:10" }
  ],
  "meta": { "network": "google", "limit": 2, "sort_column": "updated_date", "count": 2 }
}
```

Each row is a **distinct** domain (deduped across duplicate rows) with only the sort column
(`domain_registered_date` is always `NULL` here, so it's omitted). `meta.sort_column` reflects the
resolved sort column for the selected network.

---

## 3. curl

```bash
BASE=http://localhost:4000   # or https://stagingtest-api.poweradspy.com

# google — up to 50 (default)
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domains-without-registration-date?network=google"

# facebook — 10 rows (sorted by updated_date)
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domains-without-registration-date?network=facebook&limit=10"

# missing network → 400
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domains-without-registration-date"

# unsupported network → 400
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domains-without-registration-date?network=tiktok"
```

---

## 4. Implementation reference
- Service (network config + query): `src/services/common/services/domainsWithoutRegistrationService.js`
- Controller: `src/services/common/controllers/domainsWithoutRegistrationController.js`
- Route: `src/services/common/routes/commonRoutes.js` (`GET /get-domains-without-registration-date`)
- Tests: `tests/services/common/domainsWithoutRegistrationService.test.mjs`
