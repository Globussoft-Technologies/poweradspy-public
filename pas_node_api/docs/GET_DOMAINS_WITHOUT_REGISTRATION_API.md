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
| facebook | `facebook_ad_domains` | `last_seen` * |
| linkedin | `linkedin_ad_domains` | `last_seen` * |
| instagram | `instagram_ad_domain` | `updated_date` |
| google | `google_text_ad_domains` | `updated_date` |
| youtube | `youtube_ad_domains` | `updated_date` |
| native | `native_ad_domains` | `updated_date` |
| pinterest | `pinterest_ad_domains` | `updated_date` |
| reddit | `reddit_ad_domain` | `updated_date` |
| quora | `quora_ad_domain` | `updated_date` |
| gdn | `gdn_ad_domains` | `updated_date` |

\* `facebook_ad_domains` and `linkedin_ad_domains` have **no `updated_date`** column (they carry
`created` + `last_seen`), so they fall back to `last_seen` — the closest "most recently updated"
signal. TikTok is intentionally excluded (no SQL domains table).

---

## 2. Response

Body shape: `{ code, message, data?, meta? }`. `code` is also the HTTP status.

| Scenario | HTTP | `code` | `message` |
|----------|------|--------|-----------|
| Found (0+ rows) | **200** | 200 | `Domains fetched successfully` |
| `network` missing | **400** | 400 | `Please provide a network. Available: …` |
| Unsupported `network` | **400** | 400 | `Unsupported network: … Available: …` |
| Invalid `limit` (non-int / < 1) | **400** | 400 | `Invalid limit. Provide a positive integer up to 50.` |
| DB query error | **400** | 400 | `Some error ocurred during querying the db` |
| Network SQL connection unavailable | **503** | 503 | `SQL connection not available for network …` |

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
(`domain_registered_date` is always `NULL` here, so it's omitted). For `network=facebook` /
`network=linkedin` the sort column is `last_seen` instead of `updated_date`, and
`meta.sort_column` reflects that.

---

## 3. curl

```bash
BASE=http://localhost:4000   # or https://stagingtest-api.poweradspy.com

# google — up to 50 (default)
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domains-without-registration-date?network=google"

# facebook — 10 rows (sorted by last_seen)
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
