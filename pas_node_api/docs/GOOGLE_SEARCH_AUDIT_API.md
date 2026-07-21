# Google Search-Audit Keywords API

Two endpoints backing the Google keyword **audit crawler**:

- **GET** `get-search-audit-keywords` — the crawler pulls the next batch of keywords to audit.
- **POST** `insert-search-audit-keywords` — bulk-load keywords from a **CSV file** or **JSON**.

Both read/write a single MongoDB collection, **`google_audit_keywords`**, which replaced the old MySQL `google_keyword_search` table. All behaviour is controlled by `config.googleKeywordAudit` in `config.json`.

---

## Base URL

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:3000` |
| Staging     | `https://stagingtest-api.poweradspy.com` |

All paths below are under `/api/v1/google`.

## Auth

| Endpoint | Auth |
|----------|------|
| `GET /get-search-audit-keywords` | **None** (public) |
| `POST /insert-search-audit-keywords` | **None** (public) |

> The HTTP status of the GET is always `200`; the real application status is in the body `code` field (legacy contract — the crawler reads `code`). The POST maps its `code` to the HTTP status.

---

## Storage & rules (applies to both endpoints)

- **Collection:** `google_audit_keywords` (auto-created on first insert).
- **One document per unique keyword, case-insensitive.** The dedupe key is
  `keywordNorm = keyword.trim().toLowerCase()`, enforced by a **unique index** — so
  `cat`, `Cat`, `CAT`, and `" cat "` all collapse into a single row.
- **100,000 cap.** The collection never exceeds `maxCount` (default 100k). When an insert
  pushes it over, the **oldest** rows (by insertion order) are deleted to bring it back to
  the cap. The same cap is also enforced by a cron every 30 min.
- **Auto-sync from user searches.** When a user searches a Google **keyword** on the
  frontend (`type = 1`, network includes `google`), it is mirrored into this collection
  immediately (deduped), with the cron re-importing as a backstop.
- **Cursor** for the GET crawler is stored in a tiny `google_audit_meta` document
  (`_id: "cursor:crawl"`), so it survives restarts and is shared across instances.

---

## GET — pull the next batch

```
GET /api/v1/google/get-search-audit-keywords
```

No query params, no body. Each call returns up to **5** crawlable keywords
(`status` 0 = pending, 2 = re-crawl), **oldest first**, and advances a server-side cursor
so the next call continues after them. When the cursor reaches the end it **loops back** to
the start.

**Response `200` — keywords returned**

```json
{
  "code": 200,
  "message": "Keywords Fetched Successfully",
  "data": [
    {
      "id": "6a39360aaabb18b957153cef",
      "keyword": "cat",
      "status": 0,
      "country": null,
      "user_id": null,
      "process_date": null,
      "hit_count": 0
    }
  ]
}
```

Each row carries: `id` (Mongo `_id` as a string), `keyword`, `status`, `country`,
`user_id`, `process_date`, `hit_count`.

**Response — no crawlable keywords** (HTTP 200, body code 404)

```json
{ "code": 404, "message": "No Keywords Found" }
```

**Response — DB unavailable / error** (body code 500)

```json
{ "code": 500, "message": "Database connection is not available." }
```

---

## POST — bulk insert keywords

```
POST /api/v1/google/insert-search-audit-keywords
```

Accepts **either** a CSV file (multipart) **or** a JSON body. New keywords default to
`status = 0` (crawlable), `hit_count = 0`. Duplicates are ignored (case-insensitive).

### Option A — JSON

```
Content-Type: application/json
```

Three accepted body shapes:

**1. Array of strings**

```json
["cat", "dog", "running shoes"]
```

**2. Object with a `keywords` array**

```json
{ "keywords": ["cat", "dog", "running shoes"] }
```

**3. Array of objects** (to also set `country` / `user_id`)

```json
[
  { "keyword": "cat", "country": "US", "user_id": 42 },
  { "keyword": "dog" }
]
```

> Per item, only `keyword` is required. `value` / `term` are accepted as aliases for
> `keyword`; `country` and `user_id` (alias `userId`) are optional.

### Option B — CSV file (multipart/form-data)

```
Content-Type: multipart/form-data
```

- Field name: **`file`**.
- Max size: **50 MB** (configurable). The file is streamed, never loaded whole into memory.
- Format — either works:
  - **One keyword per line** (no header):
    ```csv
    cat
    dog
    running shoes
    ```
  - **With a header row** — if a `keyword` column is present it is used, and optional
    `country` / `user_id` columns are picked up too:
    ```csv
    keyword,country,user_id
    cat,US,42
    dog,IN,
    ```
- Quoted values (`"a,b"`) and escaped quotes (`""`) are handled; surrounding spaces and a
  leading BOM are stripped.

### Response `200`

```json
{
  "code": 200,
  "message": "Keywords inserted successfully",
  "data": {
    "received": 3,
    "inserted": 2,
    "duplicatesIgnored": 1,
    "deletedOverCap": 0,
    "totalAfter": 2
  }
}
```

| Field | Meaning |
|-------|---------|
| `received` | rows/items parsed from the request |
| `inserted` | new keywords actually added |
| `duplicatesIgnored` | skipped — duplicates within the batch **or** already in the collection (case-insensitive) |
| `deletedOverCap` | oldest rows deleted to stay at/under the 100k cap (0 until the cap is reached) |
| `totalAfter` | total documents in the collection after this insert |

### Other responses

**No keywords supplied** (HTTP 400)

```json
{
  "code": 400,
  "message": "No keywords found in the request. Send a CSV file (field \"file\") or JSON keywords.",
  "hint": "JSON: {\"keywords\":[\"cat\",\"dog\"]} or [\"cat\",\"dog\"]. CSV: one keyword per line, or a column named \"keyword\"."
}
```

**CSV over the size limit** (HTTP 413)

```json
{ "code": 413, "message": "CSV exceeds the 50 MB limit." }
```

**DB unavailable / error** (HTTP 500) — `{ "code": 500, "message": "<error>" }`.

---

## Quick test with curl

```bash
BASE=https://stagingtest-api.poweradspy.com/api/v1/google

# GET the next batch
curl -s "$BASE/get-search-audit-keywords"

# POST via JSON
curl -s -X POST "$BASE/insert-search-audit-keywords" \
  -H "Content-Type: application/json" \
  -d '{"keywords":["cat","Cat","dog"]}'      # → inserted:2, duplicatesIgnored:1

# POST via CSV file
printf 'keyword,country\nshoes,US\nlaptop,UK\n' > kw.csv
curl -s -X POST "$BASE/insert-search-audit-keywords" -F "file=@kw.csv"
```

---

## Configuration (`config.googleKeywordAudit`)

| Key | Default | Purpose |
|-----|---------|---------|
| `enabled` | `true` | Master on/off for both endpoints + cron. |
| `collection` | `google_audit_keywords` | Keyword collection name. |
| `metaCollection` | `google_audit_meta` | Holds the crawl/import cursors. |
| `maxCount` | `100000` | Hard cap; oldest rows trimmed beyond it. |
| `crawlBatchSize` | `5` | Keywords returned per GET. |
| `crawlStatuses` | `[0, 2]` | Which statuses are "crawlable". |
| `maxUploadMb` | `50` | CSV upload size limit. |
| `syncFromUserSearch` | `true` | Synchronous dual-write from frontend google keyword searches. |
| `syncEnforceCap` | `true` | Enforce the cap inline on the dual-write (only when a row is actually added). |
| `importNetwork` / `importType` | `google` / `1` | Which `keyword_searches` docs the cron imports (google keywords). |

The cron is `config.crons.jobs.googleKeywordAudit` (schedule `"30 min"`); it imports new
google user-searched keywords and re-enforces the cap.

---

## Resetting the data

There is no delete endpoint. To start clean (e.g. before a fresh data load) drop **both**
collections in Mongo:

- `google_audit_keywords` — the keywords,
- `google_audit_meta` — the cursors (delete this too so the cron re-imports user searches
  from the beginning instead of only those newer than the last cursor).
