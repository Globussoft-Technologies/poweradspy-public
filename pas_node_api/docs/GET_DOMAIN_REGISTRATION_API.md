# get-domain-registration API — Test Guide

A read-only lookup that returns a domain's **WHOIS registration date** from a network's
domains table. Converted PHP → Node for **four** networks, keeping the same request/response
(with one improvement — proper HTTP status codes; see [§HTTP status](#http-status)).

---

## 1. Endpoints

| Network | Node endpoint | PHP original (reference) | Domains table |
|---------|---------------|--------------------------|---------------|
| Instagram (`gramapi`) | `GET /api/v1/instagram/get-domain-registration` | `GET gramapi.poweradspy.com/get-domain-registration` | `instagram_ad_domain` |
| Google (`gtext`) | `GET /api/v1/google/get-domain-registration` | `GET gtext.poweradspy.com/api/get-domain-registration` | `google_text_ad_domains` |
| YouTube (`tubeapi`) | `GET /api/v1/youtube/get-domain-registration` | `GET tubeapi.poweradspy.com/api/get-domain-registration` | `youtube_ad_domains` |
| Facebook (`api`) | `GET /api/v1/facebook/get-domain-registration` | `GET api.poweradspy.com/get-domain-registration` | `facebook_ad_domains` |

- **Method:** `GET`
- **Auth:** none (public — matches PHP)
- **Query param:** `domain` (required) — the exact domain to look up (e.g. `instagram.com`)
- **Body:** none

### Base URL
| Environment | Base URL |
|-------------|----------|
| Local dev | `http://localhost:3000` *(use whatever port your BE runs on)* |
| Staging | `https://stagingtest-api.poweradspy.com` |

---

## 2. Request

Only a query string — no headers or body required.

```
GET {BASE}/api/v1/instagram/get-domain-registration?domain=instagram.com
GET {BASE}/api/v1/google/get-domain-registration?domain=awaytravel.com
```

| Param | Required | Notes |
|-------|----------|-------|
| `domain` | **yes** | Must be a non-empty string. Matched **exactly** against the `domain` column (no wildcard/normalization). |

---

## 3. Response

Body shape: `{ code, message, data? }`. The `code` is **also** the HTTP status.

| Scenario | HTTP status | `code` | `message` | `data` |
|----------|-------------|--------|-----------|--------|
| Domain found | **200** | 200 | `Domain found successfully` | `{ domain, domain_registered_date }` |
| Domain not in table | **404** | 404 | `Domain not found` | *(absent)* |
| `domain` missing / empty | **400** | 400 | `Please provide proper domain` | *(absent)* |
| DB query error | **400** | 400 | `Some error ocurred during querying the db` | *(absent)* |
| DB connection unavailable | **401** | 401 | `Some Error Occured` | `[]` |

`domain_registered_date` is returned exactly as stored in the DB (a date/datetime string, or
`null` if the row has no registration date recorded).

<a name="http-status"></a>
> **HTTP status note:** the PHP returned **HTTP 200 for every case** (a side-effect of
> `json_encode`), with the real status only in `code`. This Node version maps `code` → the
> real HTTP status (200/404/400/401) — correct REST behaviour — while still returning `code`
> in the body, so a client can read either. (See `obsidian-vault/get-domain-registration-api.md`.)

---

## 4. Example payloads

### ✅ Expected — domain found (200)
Request:
```
GET /api/v1/instagram/get-domain-registration?domain=instagram.com
```
Response `200`:
```json
{
  "code": 200,
  "message": "Domain found successfully",
  "data": { "domain": "instagram.com", "domain_registered_date": "2004-06-04" }
}
```

Request:
```
GET /api/v1/google/get-domain-registration?domain=awaytravel.com
```
Response `200`:
```json
{
  "code": 200,
  "message": "Domain found successfully",
  "data": { "domain": "awaytravel.com", "domain_registered_date": "2015-08-12" }
}
```
*(the actual date is whatever the crawler stored for that domain; may be `null`.)*

### ✅ Expected — domain not found (404)
```
GET /api/v1/google/get-domain-registration?domain=this-domain-does-not-exist-12345.com
```
```json
{ "code": 404, "message": "Domain not found" }
```

### ⚠️ Unexpected — `domain` param missing (400)
```
GET /api/v1/instagram/get-domain-registration
```
```json
{ "code": 400, "message": "Please provide proper domain" }
```

### ⚠️ Unexpected — `domain` empty (400)
```
GET /api/v1/instagram/get-domain-registration?domain=
```
```json
{ "code": 400, "message": "Please provide proper domain" }
```

### ⚠️ Unexpected — garbage / non-domain value (404, not an error)
A value that isn't a real domain simply won't match a row → treated as **not found**, not a
validation error (the endpoint does not validate domain format):
```
GET /api/v1/google/get-domain-registration?domain=not a domain !!!
```
```json
{ "code": 404, "message": "Domain not found" }
```

### 🔒 Unexpected — SQL-injection attempt (safe → 404)
The query is parameterized, so an injection payload is treated as a literal value and just
doesn't match:
```
GET /api/v1/google/get-domain-registration?domain=' OR '1'='1
```
```json
{ "code": 404, "message": "Domain not found" }
```

---

## 5. curl

```bash
BASE=http://localhost:4000   # or https://stagingtest-api.poweradspy.com

# Instagram — found (pick a domain that exists in instagram_ad_domain)
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/instagram/get-domain-registration?domain=instagram.com"

# Google — found
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/google/get-domain-registration?domain=awaytravel.com"

# not found → HTTP 404
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/google/get-domain-registration?domain=nope-xyz-123.com"

# missing domain → HTTP 400
curl -s -w "\n[HTTP %{http_code}]\n" "$BASE/api/v1/instagram/get-domain-registration"

# value with spaces / special chars → URL-encode it
curl -s -w "\n[HTTP %{http_code}]\n" --get "$BASE/api/v1/google/get-domain-registration" --data-urlencode "domain=away travel"
```

`-w "[HTTP %{http_code}]"` prints the status so you can confirm the code→status mapping.

---

## 6. Testing in Postman

1. Method **GET**, URL `{{baseUrl}}/api/v1/instagram/get-domain-registration`.
2. **Params** tab → add key `domain`, value `instagram.com`.
3. No auth, no body. Send.
4. Check **both** the HTTP status (top-right) and the body `code` — they should match
   (200/404/400/401).
5. Repeat for `/api/v1/google/get-domain-registration`.

Suggested Postman cases to save: `found`, `not-found`, `missing-domain`, `empty-domain`.

---

## 7. Test data & gotchas

- **A `200` needs the domain to already exist** in that network's table. On dev, if you
  don't know one, query the DB for a sample:
  ```sql
  -- instagram
  SELECT domain, domain_registered_date FROM instagram_ad_domain      WHERE domain_registered_date IS NOT NULL LIMIT 5;
  -- google  (dev DB: pasdev_gtext)
  SELECT domain, domain_registered_date FROM google_text_ad_domains   WHERE domain_registered_date IS NOT NULL LIMIT 5;
  -- youtube (dev DB: pasdev_youtube)
  SELECT domain, domain_registered_date FROM youtube_ad_domains       WHERE domain_registered_date IS NOT NULL LIMIT 5;
  -- facebook
  SELECT domain, domain_registered_date FROM facebook_ad_domains      WHERE domain_registered_date IS NOT NULL LIMIT 5;
  ```
  Then use one of those `domain` values to see a `200`.
- **Per-network DBs / SQL must be enabled** — google uses `pasdev_gtext`, youtube uses
  `pasdev_youtube` (dev). Make sure each network's SQL connection is enabled in that
  environment (e.g. `GOOG_SQL_ENABLED=true`, `YT_SQL_ENABLED=true`), else you'll get `401`
  ("Some Error Occured").
- **Registration dates are stored PER network** — the same domain (e.g. `madgicx.com`) can
  have a date in `facebook_ad_domains` but `null` in `instagram_ad_domain`. Each endpoint
  only reads its own table, so a `200` with `domain_registered_date: null` from one network
  doesn't mean another network lacks it.
- **Exact match only** — `Instagram.com` vs `instagram.com`, or `www.instagram.com` vs
  `instagram.com`, are different lookups; there's no normalization or wildcarding (same as PHP).
- **`domain_registered_date` can be `null`** for a matched row (row exists but the date was
  never captured) — that's still a `200`, with `data.domain_registered_date: null`.

---

## 8. Implementation reference (for debugging)
- Shared logic: `src/utils/domainRegistration.js` (one query, table passed per network)
- Controllers: `src/services/{instagram,google,youtube,facebook}/controllers/domainRegistrationController.js`
- Routes: `src/services/{instagram,google,youtube,facebook}/routes/*Routes.js`
- Tests: `tests/utils/domainRegistration.test.mjs` (all 4 networks)
