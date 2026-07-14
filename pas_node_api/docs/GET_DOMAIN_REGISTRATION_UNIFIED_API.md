# get-domain-registration (unified, cross-network) — Test Guide

One endpoint that looks a domain's **WHOIS registration date** up across **all 10 networks'**
domains tables. Consolidates the four per-network endpoints
(`/api/v1/{instagram,google,youtube,facebook}/get-domain-registration`) and extends coverage to
every network.

Because the same domain can exist in several networks' tables **with different registration
dates**, this returns **every** match, each tagged with the network it came from. It also handles
**duplicate rows within a single network** (these tables have no unique index on `domain`): each
**distinct** date found in a network is returned (so a network with one dated row + one NULL row
surfaces both).

---

## 1. Endpoint

- **Method:** `GET`
- **Path:** `GET /api/v1/common/get-domain-registration`
- **Auth:** none (matches the per-network originals + the other `common` domain endpoints)
- **Query params:**

| Param | Required | Notes |
|-------|----------|-------|
| `domain` | **yes** | Exact domain to look up (matched against the `domain` column). |
| `network` | no | A single network, a CSV list (`facebook,google`), or `all`. **Omitted / empty / `all` → search every network.** Unknown names → 400. |

Supported networks: `facebook, linkedin, instagram, google, youtube, native, pinterest, reddit, quora, gdn`.

---

## 2. Response

Body shape: `{ code, message, data?, meta? }`. `code` is also the HTTP status.

| Scenario | HTTP | `code` | `message` |
|----------|------|--------|-----------|
| Found in ≥1 network | **200** | 200 | `Domain found successfully` |
| Found in no network | **404** | 404 | `Domain not found` |
| `domain` missing / empty | **400** | 400 | `Please provide proper domain` |
| Unknown `network` | **400** | 400 | `Unsupported network(s): …` |

- `data.matches` — one entry per distinct (date, status) the domain was found under, tagged with network: `{ network, domain, domain_registered_date, status }` (status 0 pending / 1 resolved / 2 unresolvable). Ordered by the canonical network order.
- `data.found_in` — the networks, in the same order.
- `data.distinct_registered_dates` — the set of distinct dates seen (includes `null` if a matched row has no date).
- `meta.networks_searched` — which networks were queried.
- `meta.errors` — present only if a network's query failed (e.g. its SQL connection was down); the rest still return.

### 200 — found in two networks with different dates

```
GET /api/v1/common/get-domain-registration?domain=example.com
```
```json
{
  "code": 200,
  "message": "Domain found successfully",
  "data": {
    "domain": "example.com",
    "matches": [
      { "network": "facebook", "domain": "example.com", "domain_registered_date": "2004-06-04", "status": 1 },
      { "network": "google",   "domain": "example.com", "domain_registered_date": "2015-08-12", "status": 1 }
    ],
    "found_in": ["facebook", "google"],
    "distinct_registered_dates": ["2004-06-04", "2015-08-12"]
  },
  "meta": { "networks_searched": ["facebook","linkedin","instagram","google","youtube","native","pinterest","reddit","quora","gdn"], "found_count": 2 }
}
```

### 200 — scoped to one network

```
GET /api/v1/common/get-domain-registration?domain=example.com&network=google
```

### 404 — not found anywhere

```json
{ "code": 404, "message": "Domain not found", "data": { "domain": "nope.com", "matches": [], "found_in": [] }, "meta": { "networks_searched": [ ... ], "found_count": 0 } }
```

---

## 3. curl

```bash
BASE=http://localhost:4000   # or https://stagingtest-api.poweradspy.com

# all networks (default)
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domain-registration?domain=example.com"

# one network
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domain-registration?domain=example.com&network=google"

# a subset
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/common/get-domain-registration?domain=example.com&network=facebook,google,reddit"
```

---

## 4. Relationship to the per-network endpoints

The original per-network endpoints
(`/api/v1/{instagram,google,youtube,facebook}/get-domain-registration`,
see [GET_DOMAIN_REGISTRATION_API.md](GET_DOMAIN_REGISTRATION_API.md)) are **left in place** so existing
callers keep working. This unified endpoint is the superset — migrate callers to it, then the
per-network ones can be retired.

---

## 5. Implementation reference
- Shared network→table config: `src/services/common/helpers/domainTables.js`
- Service: `src/services/common/services/domainRegistrationLookupService.js`
- Controller: `src/services/common/controllers/domainRegistrationLookupController.js`
- Route: `src/services/common/routes/commonRoutes.js` (`GET /get-domain-registration`)
- Tests: `tests/services/common/domainRegistrationLookupService.test.mjs`
