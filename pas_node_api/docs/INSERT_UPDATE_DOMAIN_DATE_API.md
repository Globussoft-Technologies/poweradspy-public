# insert-update-domain-date API — Test Guide

Sets a domain's **WHOIS registration date** (`domain_registered_date`) across **all 10 networks'**
domains tables, and bumps `updated_date = NOW()` wherever that column exists. Node port of the PHP
`SupportScrapper@putDomainDate` (`PUT https://api.poweradspy.com/insert-update-domain-date`),
generalised from facebook-only to every network.

**Update-only:** rows are never inserted. A network whose table has no matching domain is reported
as `not_found` and left untouched.

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
| `domain_date` | **yes** | The registration date, format **`YYYY-MM-DD`** (PHP `date_format:Y-m-d`). |

`updated_date` is bumped to `NOW()` for every network **except facebook & linkedin**, whose
`*_ad_domains` tables have no `updated_date` column (they carry `created` + `last_seen`).

---

## 2. Response

Body shape: `{ code, message?, error?, data? }`. `code` is also the HTTP status.

| Scenario | HTTP | `code` |
|----------|------|--------|
| Processed (0+ networks updated) | **200** | 200 |
| `domain_name` / `domain_date` missing or `domain_date` not `Y-m-d` | **400** | 400 (`error` = first message) |
| No network SQL connection available at all | **503** | 503 |

`data.results` reports the outcome per network; `data.summary` totals them.

### 200 example

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
    "results": {
      "facebook":  { "status": "updated", "id": 22, "previous_registered_date": "2000-01-01", "updated_date_touched": false },
      "google":    { "status": "updated", "id": 11, "previous_registered_date": null,          "updated_date_touched": true },
      "reddit":    { "status": "not_found" },
      "quora":     { "status": "error", "message": "..." }
    },
    "summary": { "updated": 2, "not_found": 7, "errors": 1 }
  }
}
```

Per-network `status`: `updated` | `not_found` | `error`.

---

## 3. curl

```bash
BASE=http://localhost:4000   # or https://stagingtest-api.poweradspy.com

# update across all networks
curl -s -X PUT -w "\n[HTTP %{http_code}]\n" \
  -H "Content-Type: application/json" \
  -d '{"domain_name":"example.com","domain_date":"2026-07-09"}' \
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
- PHP original: `poweradspy/api/app/Modules/User/Controllers/SupportScrapper.php` → `putDomainDate`
