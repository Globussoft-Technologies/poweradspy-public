# insert-update-domain-date API — Test Guide

Sets a domain's **WHOIS registration date** (`domain_registered_date`) — or marks the domain as
**unresolvable** — across **all 10 networks'** domains tables, and bumps `updated_date = NOW()`
wherever that column exists. Node port of the PHP `SupportScrapper@putDomainDate`
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
(anything but 1) → 400. `updated_date` is bumped to `NOW()` for every network **except facebook &
linkedin**, whose `*_ad_domains` tables have no `updated_date` column (they carry `created` +
`last_seen`).

---

## 2. Response

Body shape: `{ code, message?, error?, data? }`. `code` is also the HTTP status.

| Scenario | HTTP | `code` |
|----------|------|--------|
| Processed (0+ networks updated) | **200** | 200 |
| `domain_name` missing | **400** | 400 (`error` = message) |
| neither `domain_date` nor `status`, bad `Y-m-d`, out-of-range/conflicting `status` | **400** | 400 |
| No network SQL connection available at all | **503** | 503 |

`data.status` / `data.domain_date` echo the resolved action. `data.results` reports the outcome per
network; `data.summary` totals them.

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
      "facebook":  { "status": "updated", "matched_rows": 1, "ids": [22], "previous_registered_dates": ["2000-01-01"], "previous_statuses": [1], "new_status": 1, "updated_date_touched": false },
      "google":    { "status": "updated", "matched_rows": 2, "ids": [11, 12], "previous_registered_dates": [null, "1999-01-01"], "previous_statuses": [0, 1], "new_status": 1, "updated_date_touched": true },
      "reddit":    { "status": "not_found" },
      "quora":     { "status": "error", "message": "..." }
    },
    "summary": { "updated": 2, "not_found": 7, "errors": 1 }
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

## 4. Implementation reference
- Service (network config + per-network update): `src/services/common/services/updateDomainDateService.js`
- Controller: `src/services/common/controllers/updateDomainDateController.js`
- Route: `src/services/common/routes/commonRoutes.js` (`PUT /insert-update-domain-date`)
- Tests: `tests/services/common/updateDomainDateService.test.mjs`
- Migration (adds the `status` column to all 10 domains tables): `scripts/migrate-add-domain-status.js` (dry-run by default; `--apply` to run; env-driven for dev/prod)
- PHP original: `poweradspy/api/app/Modules/User/Controllers/SupportScrapper.php` → `putDomainDate`
