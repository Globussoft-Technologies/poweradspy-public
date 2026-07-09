# Adversuite API

Legacy PHP endpoints ported to Node across 4 platforms. Every endpoint is mounted
under a `/adversuite` sub-router on its network so paths stay consistent.

> **File layout** — one controller + one sub-router per network:
> - `src/services/<network>/controllers/adversuite_Api_Controller.js`
> - `src/services/<network>/routes/adversuite_Api_routes.js`
> - Sub-router mounted from `src/services/<network>/routes/<network>Routes.js` via
>   `router.use('/adversuite', createXxxAdversuiteRoutes(service))`.

---

## Base URL

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:3000` |
| Staging     | `https://stagingtest-api.poweradspy.com` |

All paths below are under `/api/v1/<network>/adversuite`.

## Auth

Every endpoint uses `authMiddleware`. Send the JWT via `Authorization: Bearer <token>`
header (or the `authToken` cookie from a browser session).

## PHP parity notes

- **HTTP code 202 preserved** on `getLocation` / `getCalltoAction` — PHP returned 202
  (not 200) for success. Any consumer checking `body.code === 202` keeps working.
  The HTTP status is normalized to `200` so caches/proxies behave, but the body
  keeps `code: 202`.
- **YouTube `getCallToActions` returns `msg` key** (not `message`) — PHP typo preserved.
- **`get_all_language` returns a raw array** (no `{ code, data }` envelope) — matches PHP.

---

## Endpoints by Platform

| # | Platform | Method | Path | PHP Source |
|---|----------|--------|------|------------|
| 1 | Facebook | POST | `/api/v1/facebook/adversuite/insert_free_plan` | `api/Userv2Controller@insert_free_plan` |
| 2 | Facebook | POST | `/api/v1/facebook/adversuite/insert_user_data` | `api/adsDataController@insert_user_data` |
| 3 | Facebook | GET | `/api/v1/facebook/adversuite/getLocation` | `api/Userv2Controller@getLocation` |
| 4 | Facebook | GET | `/api/v1/facebook/adversuite/getCalltoAction` | `api/Userv2Controller@getCalltoAction` |
| 5 | Facebook | GET | `/api/v1/facebook/adversuite/get-available-tags` | `api/Userv2Controller@getAvailableTags` |
| 6 | Facebook | GET | `/api/v1/facebook/adversuite/get_all_language` | `api/Userv2Controller@get_all_language` |
| 7 | Instagram | GET | `/api/v1/instagram/adversuite/getLocation` | `api_instagram/UserController@getLocation` |
| 8 | YouTube | GET | `/api/v1/youtube/adversuite/getLocation` | `api_youtube/UserController@getLocation` |
| 9 | YouTube | GET | `/api/v1/youtube/adversuite/get-call-to-actions` | `api_youtube/UserController@getCallToActions` |
| 10 | Google | GET | `/api/v1/google/adversuite/getLocation` | `api_gtext/UserController@getLocation` |

---

# API 1 — Insert Free Plan (Facebook)

```
POST /api/v1/facebook/adversuite/insert_free_plan
Authorization: Bearer <token>
Content-Type: application/json
```

Upsert-style write to the `free_plan` table. If a row exists for `user_id` it
returns the row; otherwise it inserts a new row and returns the fresh select.

## Body

| Field | Required | Notes |
|-------|----------|-------|
| `user_id` | yes | Numeric user id (returns `400` if missing). |
| `Search_count` | no | Whitelisted for insert. |
| `expiry_date` | no | Whitelisted for insert. |
| `status` | no | Whitelisted for insert. |
| `facebook_user_id` | no | Whitelisted for insert. |
| `created` / `updated` | no | Whitelisted for insert. |

> Only the fields above are honoured on INSERT — a security hardening vs the PHP
> version, which blindly forwarded `$request->all()`.

## Example

```bash
curl -X POST "http://localhost:3000/api/v1/facebook/adversuite/insert_free_plan" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"user_id": 113, "Search_count": 5, "expiry_date": "2026-08-08"}'
```

## Response — 200

```json
{
  "code": 200,
  "data": [{ "Search_count": 5, "expiry_date": "2026-08-08" }]
}
```

- Existing row → returned as-is.
- New row → inserted, then re-selected and returned in the same shape.
- `400` when `user_id` is missing.

---

# API 2 — Insert User Data (Facebook)

```
POST /api/v1/facebook/adversuite/insert_user_data
Authorization: Bearer <token>
Content-Type: application/json
```

Upserts a row in `user_socket`. Row exists → UPDATE email + updated_at.
No row → INSERT and return the new id.

## Body

| Field | Required | Notes |
|-------|----------|-------|
| `user_id` | yes | Numeric user id. |
| `email` | no | Stored on the row (nullable). |
| `socket_id` | no | Legacy column — defaults to `''` if omitted. |
| `paypal_id` | no | Legacy column — defaults to `''`. |
| `paypal_id_list` | no | Legacy column — defaults to `''`. |

> **Legacy `NOT NULL` columns**: `socket_id`, `paypal_id`, `paypal_id_list` in the
> `user_socket` table are `NOT NULL` without a DB default. The endpoint inserts
> `''` for any that the caller didn't send. `updated_at` is a Unix timestamp
> (matches PHP `time()`), so downstream `INT` readers keep working.

## Example

```bash
curl -X POST "http://localhost:3000/api/v1/facebook/adversuite/insert_user_data" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"user_id": 113, "email": "user@example.com"}'
```

## Response

- **New insert** → `{ "code": 200, "message": "data inserted successfully", "data": 108 }`
- **Update existing** → `{ "code": 200, "message": "data updated successfully", "data": 1 }`
- **Missing user_id** → `{ "code": 400, "message": "user_id is required", "data": null }`

---

# API 3 — Get Location (all 4 platforms)

Returns the distinct country list for a network's country table. Every platform
has its own table, but the response shape is identical.

```
GET /api/v1/facebook/adversuite/getLocation
GET /api/v1/instagram/adversuite/getLocation
GET /api/v1/youtube/adversuite/getLocation
GET /api/v1/google/adversuite/getLocation
Authorization: Bearer <token>
```

## Per-platform table

| Platform | Table | Filter |
|----------|-------|--------|
| Facebook | `country_only` | `country IS NOT NULL` |
| Instagram | `instagram_country_only` | `country != ''` |
| YouTube | `youtube_country_only` | `DISTINCT ... WHERE country IS NOT NULL` |
| Google | `google_text_country_only` | `DISTINCT ... WHERE country IS NOT NULL` |

## Response — 202 (PHP parity)

```json
{
  "code": 202,
  "message": "data retrieved successfully",
  "data": [
    { "country": "United States" },
    { "country": "India" },
    { "country": "United Kingdom" }
  ]
}
```

- Rows found → `code: 202` (HTTP 200)
- No rows → `code: 400`, `data: []`
- DB unavailable → `code: 503`
- DB error → `code: 401`, `message: <error>`

---

# API 4 — Get Call-to-Action (Facebook)

```
GET /api/v1/facebook/adversuite/getCalltoAction
Authorization: Bearer <token>
```

Returns a **hardcoded** list of 88 ad-CTA labels. No DB read. Copied verbatim
from PHP so the frontend dropdown keeps the same order.

## Response — 202

```json
{
  "code": 202,
  "message": "data retrieved successfully",
  "data": [
    { "action": "Add" },
    { "action": "Add to Cart" },
    { "action": "Apply Now" },
    "... (85 more)"
  ]
}
```

Full list: `Add, Add to Cart, Apply Now, Ask, Assist, Book Now, Buy, Buy Now,
Buy Tickets, Call, Call Now, Chat with Us, Check, Contact Us, Continue, Contribute,
Donate, Donate Now, Download, Email Now, Find More, Follow, Get Access, Get Coupon,
Get Deal, Get Directions, Get Offer, Get Quote, Get Showtimes, Get Tickets, Get Trends,
Get Your Code, Give Now, Go Now, Go Shopping, Grab a bid, Hear, Install, Install App,
Install Now, Interested, Join, Know More, Learn More, Like Page, Like This Page,
Listen Now, Look More, Make an Order, Menu, Message, More, More on This, Obtain Offer,
Offer, Open Link, Order Now, Play Game, Play Now, Purchase, Read, Register Now,
Request Time, Reserve Now, Save, Save Offer, Schedule, Search, See Details, See Menu,
See More, Sell Now, Send, Send Message, Shop Now, Sign Up, Start Order, Subscribe,
try in camera, Try It, turn on us, Use App, use the offer, View, View Event,
Visit Website, Vote Now, Watch More, Watch Others, Watch Video`.

---

# API 5 — Get Call-to-Actions (YouTube)

```
GET /api/v1/youtube/adversuite/get-call-to-actions
Authorization: Bearer <token>
```

Same as API 4 but a **shorter, YouTube-specific list of 60 labels** (no
`Buy`/`Chat with Us`/`Save Offer` etc.). Also uses the key **`msg`**, not
`message` — PHP typo preserved.

## Response — 202

```json
{
  "code": 202,
  "msg": "data retrieved successfully",
  "data": [
    { "action": "Add" },
    { "action": "Apply Now" },
    "... (58 more)"
  ]
}
```

Full list: `Add, Apply Now, Book Now, Buy Now, Buy Tickets, Call, Call Now, Check,
Contact Us, Continue, Contribute, Directions, Donate, Donate Now, Download, Email Now,
Find More, Follow, Get Access, Get Coupon, Get Deal, Get Offer, Get Quote, Get Tickets,
Give Now, Go Now, Install, Install Now, Interested, Join, Know More, Learn More,
Like Page, Listen Now, Look More, Menu, Message, More, More on This, Open Link,
Order Now, Play Game, Play Now, Purchase, Schedule, Search, See Menu, See More,
Sell Now, Send, Shop Now, Sign Up, Subscribe, Try It, Use App, View, View Event,
Visit Website, Vote Now, Watch More`.

---

# API 6 — Get Available Tags / Niches (Facebook)

```
GET /api/v1/facebook/adversuite/get-available-tags
Authorization: Bearer <token>
```

Returns the niche list from the `facebook_niche` table.

## Response — 200

```json
{
  "code": 200,
  "message": "Niche data fetched",
  "data": [
    { "niche": "Fashion" },
    { "niche": "Fitness" },
    { "niche": "Beauty" }
  ]
}
```

- Query error → `code: 400`, `message: "Exception: in getAvailableTags function"`
- DB unavailable → `code: 503`

---

# API 7 — Get All Languages (Facebook)

```
GET /api/v1/facebook/adversuite/get_all_language
Authorization: Bearer <token>
```

Returns every row from `languages` ordered by name. **Returns a raw array with
no envelope** — matches the PHP handler shape.

## Response — 200 (raw array)

```json
[
  { "iso": "aa", "name": "Afar" },
  { "iso": "ab", "name": "Abkhazian" },
  { "iso": "af", "name": "Afrikaans" }
]
```

- DB unavailable → falls back to error object `{ "code": 503, "message": "...", "data": [] }`
- DB error → `{ "code": 401, "message": "<error>", "data": [] }`

> **Client handling**: check `Array.isArray(response)` before treating the body
> as a list — errors come back as objects.

---

## Quick test with curl

```bash
BASE=http://localhost:3000/api/v1
TOKEN=<your-jwt>

# ─── Facebook (6) ─────────────────────────────────────
curl -X POST "$BASE/facebook/adversuite/insert_free_plan" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"user_id": 113, "Search_count": 5, "expiry_date": "2026-08-08"}'

curl -X POST "$BASE/facebook/adversuite/insert_user_data" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"user_id": 113, "email": "user@example.com"}'

curl -X GET "$BASE/facebook/adversuite/getLocation"           -H "Authorization: Bearer $TOKEN"
curl -X GET "$BASE/facebook/adversuite/getCalltoAction"       -H "Authorization: Bearer $TOKEN"
curl -X GET "$BASE/facebook/adversuite/get-available-tags"    -H "Authorization: Bearer $TOKEN"
curl -X GET "$BASE/facebook/adversuite/get_all_language"      -H "Authorization: Bearer $TOKEN"

# ─── Instagram (1) ────────────────────────────────────
curl -X GET "$BASE/instagram/adversuite/getLocation" -H "Authorization: Bearer $TOKEN"

# ─── YouTube (2) ──────────────────────────────────────
curl -X GET "$BASE/youtube/adversuite/getLocation"          -H "Authorization: Bearer $TOKEN"
curl -X GET "$BASE/youtube/adversuite/get-call-to-actions"  -H "Authorization: Bearer $TOKEN"

# ─── Google (1) ───────────────────────────────────────
curl -X GET "$BASE/google/adversuite/getLocation" -H "Authorization: Bearer $TOKEN"
```

---

## Common error codes

| HTTP | body.code | Meaning |
|------|-----------|---------|
| 200  | 200 | Success (data present) |
| 200  | 202 | Success (PHP legacy code — GET Location / CTA lists) |
| 400  | 400 | Bad request (missing required field, no data found) |
| 401  | 401 | Handled exception — SQL error, etc. `message` carries the error string |
| 405  | 405 | Method not allowed |
| 503  | 503 | Database connection unavailable |

---

## Response shape reference

Most endpoints return the standard envelope:

```json
{ "code": <200|202|400|401|503>, "message": "...", "data": <payload|null|[]> }
```

**Exceptions**:
- `get_all_language` → **raw array** on success.
- `insert_free_plan` → success response omits `message`.
- YouTube `get-call-to-actions` → uses **`msg`** instead of `message`.

---

## Migration notes (breaking changes from PHP)

1. **All Facebook endpoints moved from root to `/adversuite`** — e.g. the old PHP
   route `POST /insert_free_plan` is now `POST /api/v1/facebook/adversuite/insert_free_plan`.
   Any client still calling the flat path gets 404.
2. **`insert_user_data`** — PHP accepted GET too; the Node version is POST-only.
3. **`get_all_language`** — PHP was POST-only; Node exposes it as GET (safe: read-only).
4. **`insert_free_plan` column whitelist** — PHP forwarded every posted field to INSERT.
   Node restricts to `Search_count, expiry_date, status, facebook_user_id, created,
   updated` — anything else is silently dropped.
5. **`checkIfAdExists`** was ported to the controller but the route is **not exposed**.
   Re-enable in `adversuite_Api_routes.js` if needed.
