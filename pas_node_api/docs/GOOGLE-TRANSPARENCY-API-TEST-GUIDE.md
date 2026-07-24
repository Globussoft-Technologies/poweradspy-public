# Google Transparency platform-18 API test guide

Contract: `3.2.0`  
Insertion and update use the same endpoint and are distinguished by `ad_id`.

## 1. Prerequisites

From `pas_node_api`, apply infrastructure before sending payloads:

```powershell
node scripts/apply-google-transparency-schema.js
node scripts/apply-google-transparency-schema.js --apply
node scripts/apply-google-transparency-es-mapping.js
node scripts/apply-google-transparency-es-mapping.js --apply
```

Configure:

```text
INSERTION_SECRET_KEY = HMAC secret used by insertion
API_DELETE_TOKEN     = token used by deletion
LANGUAGE_TRANSLATION_API = existing language detection/translation service URL
```

`insertion.api.translationRequired` is `true` by default. If the translation
service is missing or unavailable, platform 18 returns `503` before SQL is
written. Set it to `false` only in an intentional best-effort environment.

Set local test variables:

```powershell
$BaseUrl = "http://localhost:3000"
$env:INSERTION_SECRET_KEY = "<same secret configured on API>"
$env:API_DELETE_TOKEN = "<same delete token configured on API>"
```

## 2. Insertion/update API

```text
POST /api/v1/google/insertion/gtAdsData
Content-Type: application/json
x-signature: HMAC-SHA256(exact raw request body, INSERTION_SECRET_KEY), hex
```

When `insertion.allowPlatformBypass` contains `"18"` (for example
`["12","18"]`), omit the `x-signature` header and an all-platform-18 object,
array, or `{ads:[...]}` batch is allowed.
A mixed-platform batch never bypasses authentication. If an `x-signature`
header is supplied, it must still be valid; an invalid header returns `401`
instead of falling back to the bypass. When bypass is not configured, sign the
exact bytes that are sent; reformatting JSON after signing invalidates the
signature.

PowerShell helper:

```powershell
function Send-GoogleTransparencyPayload {
  param([Parameter(Mandatory=$true)][string]$Path)

  $resolved = (Resolve-Path $Path).Path
  [byte[]]$body = [System.IO.File]::ReadAllBytes($resolved)
  [byte[]]$key = [System.Text.Encoding]::UTF8.GetBytes($env:INSERTION_SECRET_KEY)
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($key)
  $signature = -join ($hmac.ComputeHash($body) | ForEach-Object { $_.ToString("x2") })
  $hmac.Dispose()

  Invoke-RestMethod `
    -Uri "$BaseUrl/api/v1/google/insertion/gtAdsData" `
    -Method Post `
    -ContentType "application/json" `
    -Headers @{"x-signature"=$signature} `
    -Body $body
}
```

Run each variant:

```powershell
Send-GoogleTransparencyPayload "docs/samples/google-transparency-text-range.json"
Send-GoogleTransparencyPayload "docs/samples/google-transparency-image-over.json"
Send-GoogleTransparencyPayload "docs/samples/google-transparency-video-under.json"
```

The samples use public media from MDN's current interactive examples:

```text
images: interactive-examples.mdn.mozilla.net/media/cc0-images/*
video:  interactive-examples.mdn.mozilla.net/media/cc0-videos/*.mp4
```

Optional preflight from the API/NAS worker machine:

```powershell
curl.exe -L -I "https://interactive-examples.mdn.mozilla.net/media/cc0-images/painted-hand-298-332.jpg"
curl.exe -L -I "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
```

### Verified IMAGE run

The checked-in `google-transparency-image-over.json` payload was run end to end
against the configured dev services on 2026-07-23:

- first request: HTTP `200`, inserted as internal ID `178906`;
- identical second request: HTTP `200`, updated the same ID `178906`;
- SQL: one canonical row and one India delivery row;
- SQL `post_date`: `1000-01-01 00:00:00` unknown-date sentinel;
- SQL canonical `ad_position`: `FEED`; Transparency `subnetwork`: `SHOPPING`;
- Elasticsearch: `post_date=null`, `lang_detect=en`, correct nested India
  delivery, and the same canonical ID;
- primary NAS image:
  `gt/adImage/202607/178906.jpeg` (`200 image/jpeg`);
- other multimedia:
  `gt/otherMultiMedia/202607/178906_0.jpeg` (`200 image/jpeg`).

The numeric ID is environment-specific; a clean database will allocate another
ID. The important idempotency assertion is that insert and update return the
same ID and SQL counts remain one.

### Watch the full insertion process

`insertion.transparencyDebug=true` is currently enabled. Before sending a test
payload, open a second PowerShell window:

```powershell
$day = Get-Date -Format "yyyy-MM-dd"
Get-Content ".\logs\combined-$day.log" -Wait |
  Select-String "GT18 TRACE"
```

Or inspect only the IMAGE sample after insertion:

```powershell
Get-Content ".\logs\combined-2026-07-23.log" -Tail 2000 |
  Select-String "GT18 TRACE.*CR90000000000000000002"
```

Important trace events include:

```text
TRANSLATION_API_SUCCEEDED
TRANSLATION_API_EMPTY_RESULT
SQL_DIMENSIONS_RESOLVED
SQL_CANONICAL_INSERTED / SQL_CANONICAL_UPDATED
SQL_TRANSLATION_UPSERTED
SQL_TRANSPARENCY_PAYLOAD_UPSERTED
SQL_COUNTRY_DELIVERY_MERGED
SQL_TRANSACTION_COMMITTED
NAS_UPLOAD_PLAN
NAS_PRIMARY_IMAGE_RESULT
NAS_OTHER_MULTIMEDIA_RESULT
ELASTICSEARCH_INDEX_SUCCEEDED
PROCESS_COMPLETED
```

For a successful repeat, primary media reports `reused_existing=true`.
`NAS_OTHER_MULTIMEDIA_RESULT` reports `attempted=false` and `reused_count>0`
once its source-to-NAS state exists in Elasticsearch. Live back-to-back update
verification produced `attempted=false, reused_count=1`.

Expected first-insert response:

```json
{
  "code": 200,
  "status": "ok",
  "message": "Google Transparency ad inserted successfully.",
  "data": {"id": 12345}
}
```

Media failure may add a non-fatal `warning`; SQL data is already committed.
A required translation failure instead returns `503`; no SQL row is committed
for that item.

`TRANSLATION_API_EMPTY_RESULT` means the API call succeeded but translated
title, text, and description were all empty. Even if that response says
`detected_language=en`, insertion stores SQL `language_id=0` and Elasticsearch
`lang_detect=null`; it must not manufacture English.

## 3. Update and country-merge test

First insert the TEXT sample, then send:

```powershell
Send-GoogleTransparencyPayload "docs/samples/google-transparency-text-update-merge.json"
```

It reuses `CR90000000000000000001`. Expected:

```json
{
  "code": 200,
  "status": "ok",
  "message": "Ad already present — existing data updated (id 12345)",
  "data": {"id": 12345}
}
```

Expected update behavior:

- no second `google_text_ad` row;
- Germany remains one row and receives earlier country `first_seen`, later
  country `last_seen`, and current `times_shown`;
- India appends once;
- top-level null `last_seen` becomes server current time;
- valid stored top-level `first_seen` and `post_date` are not overwritten by
  incoming nulls;
- aggregate impressions, destination/redirect, creative fields and
  Transparency fields update;
- a successful existing NAS image/post-owner/video path is reused;
- TEXT image uses `gt/adT/<YYYYMM>/<id>.<detected-extension>`;
- `othermultimedia` stays under the existing `gt/otherMultiMedia` folder and
  source URLs remain unchanged.

### Nullable-field SQL compatibility

For a new payload with `"post_date": null`, SQL intentionally contains the
unknown-date sentinel while Elasticsearch keeps the public value null:

```sql
SELECT post_date, ad_position, country_id, country_only_id, post_owner_id
FROM google_text_ad
WHERE ad_id = 'CR90000000000000000002';
```

For the IMAGE sample, expect `post_date = '1000-01-01 00:00:00'` and
`ad_position = 'FEED'`. `subnetwork = 'SHOPPING'` is stored in
`google_transparency_ad_payload`, not forced into the legacy `FEED|SIDE` enum.
A later non-null `post_date` replaces the sentinel once; subsequent null values
do not erase it.

Live `google_text_country.city/state` columns are non-null, so country-only
delivery uses empty strings for those two legacy fields. Null translated values
use empty strings in `google_ad_translation` because its three copy columns are
also non-null. These are storage placeholders only; the common ad-search
response returns the corresponding platform-18 values as JSON `null`.

## 4. SQL verification

Replace `CR...` as needed.

### Canonical row and common fields

```sql
SELECT
  a.id,
  a.ad_id,
  a.type,
  a.ad_position,
  a.post_date,
  a.first_seen,
  a.last_seen,
  a.days_running,
  a.source,
  a.system_id,
  a.status,
  a.language_id,
  l.iso AS detected_language,
  l.name AS language_name,
  m.platform,
  m.version,
  m.destination_url,
  m.firstSeenOnDesktop,
  m.lastSeenOnDesktop,
  v.title,
  v.text,
  v.image_url_original,
  v.image_url AS nas_image_url,
  po.post_owner_name,
  po.post_owner_image,
  d.domain
FROM google_text_ad a
LEFT JOIN google_text_ad_meta_data m
  ON m.google_text_ad_id = a.id
LEFT JOIN google_text_ad_variants v
  ON v.google_text_ad_id = a.id
LEFT JOIN google_text_ad_post_owners po
  ON po.id = a.post_owner_id
LEFT JOIN google_text_ad_domains d
  ON d.id = a.domain_id
LEFT JOIN languages l
  ON l.id = a.language_id
WHERE a.ad_id = 'CR90000000000000000001';
```

### Translated copy

```sql
SELECT
  tr.google_ad_id,
  tr.ad_title,
  tr.ad_text,
  tr.news_feed_description
FROM google_ad_translation tr
JOIN google_text_ad a ON a.id = tr.google_ad_id
WHERE a.ad_id = 'CR90000000000000000001';
```

The original creative stays in `google_text_ad_variants`; translated copy stays
in the existing common translation table.

### Transparency-only fixed data

```sql
SELECT
  t.google_text_ad_id,
  t.advertiser_id,
  t.ad_url,
  t.subnetwork,
  t.region_code,
  t.impressions_min,
  t.impressions_max,
  t.impressions_operator,
  t.video_url_original,
  t.redirect_url,
  t.othermultimedia,
  t.created_at,
  t.received_at
FROM google_transparency_ad_payload t
JOIN google_text_ad a ON a.id = t.google_text_ad_id
WHERE a.ad_id = 'CR90000000000000000001';
```

`received_at` changes on update; `created_at` remains the original insertion
time.

### Country merge and duplicate check

```sql
SELECT
  d.google_text_ad_id,
  d.ordinal,
  co.country,
  d.country_code,
  d.first_seen,
  d.last_seen,
  d.impressions_min,
  d.impressions_max,
  d.impressions_operator
FROM google_transparency_country_delivery d
JOIN google_text_ad a ON a.id = d.google_text_ad_id
JOIN google_text_country_only co ON co.id = d.country_only_id
WHERE a.ad_id = 'CR90000000000000000001'
ORDER BY d.ordinal;
```

After the update sample, expected countries are Germany ordinal `0` and India
ordinal `1`.

```sql
SELECT co.country, COUNT(*) AS duplicate_count
FROM google_transparency_country_delivery d
JOIN google_text_ad a ON a.id = d.google_text_ad_id
JOIN google_text_country_only co ON co.id = d.country_only_id
WHERE a.ad_id = 'CR90000000000000000001'
GROUP BY co.country
HAVING COUNT(*) > 1;
```

Expected result: no rows.

### Confirm insert versus update

```sql
SELECT ad_id, COUNT(*) AS canonical_rows, MIN(id) AS internal_id
FROM google_text_ad
WHERE ad_id IN (
  'CR90000000000000000001',
  'CR90000000000000000002',
  'CR90000000000000000003'
)
GROUP BY ad_id;
```

Expected: `canonical_rows = 1` for every inserted sample.

## 5. Elasticsearch verification

The configured default index is normally `google_ads_data`. Search by the SQL
internal ID returned by the API:

```http
POST /google_ads_data/_search
Content-Type: application/json

{
  "size": 1,
  "query": {
    "term": {
      "id": 12345
    }
  }
}
```

Check `_source` for:

```text
id, ad_id, advertiser_id, platform=18, version=3.2.0,
title/text, destination_url, first_seen, last_seen,
impressions_min/max/operator, country, country_details,
language_id, lang_detect, ad_title, ad_text, news_feed_description,
image_url/new_nas_image_url and image_video_url when storage completes
```

`title`/`text` are original creative fields. `ad_title`/`ad_text` are translated
values, and `lang_detect` is the normalized two-letter detected language. When
translation contains no actual copy, `language`, `lang_detect`, `ad_title`,
`ad_text`, and `news_feed_description` are `null`, not default English.

For `POST /api/v1/common/ads/search`, platform-18 unknown compatibility values
are normalized before returning data to the frontend:

```json
{
  "post_date": null,
  "first_seen": null,
  "language": null,
  "ad_title": null,
  "ad_text": null,
  "news_feed_description": null,
  "platform": 18,
  "type": "IMAGE",
  "image_video_url": "/pas-dev/stream/gt/adImage/202607/12345.jpg",
  "image_url_original": "https://source.example/creative.jpg",
  "video_url_original": null,
  "othermultimedia": [
    "/pas-dev/stream/gt/otherMultiMedia/202607/12345_0.jpg"
  ]
}
```

NAS upload policy is server-owned. Configure `insertion.nas.store.image` and
`insertion.nas.store.video` in `config.json` (or `NAS_STORE_IMAGE` /
`NAS_STORE_VIDEO`). Do not send `store` in the insertion payload; contract
3.2.0 rejects it. The API does not return `othermultimedia_original`,
`carousel_media`, `image_url_nas`, `nas_video_url`, `language_id`, or
`lang_detect`. Empty `othermultimedia` is omitted.

VIDEO storage is asynchronous. Its NAS path appears in `image_video_url` after
the background queue completes. All platform-18 creatives, including
`type=TEXT`, select `<img>` or `<video>` from that URL's extension. A TEXT
creative falls back to the text card only when `image_video_url` is absent.

### NAS verification

Use the internal SQL ID returned by insertion. With a July 2026 upload and ID
`12345`, expected relative paths are:

```text
TEXT primary image: /<bucket>/stream/gt/adT/202607/12345.jpg
IMAGE primary:      /<bucket>/stream/gt/adImage/202607/12345.jpg
VIDEO primary:      /<bucket>/stream/gt/adVideo/202607/12345.mp4
Other image:        /<bucket>/stream/gt/otherMultiMedia/202607/12345_0.jpg
Other video:        /<bucket>/stream/gt/otherMultiMedia/202607/12345_1.mp4
Post-owner image:   /<bucket>/stream/gt/postowner/202607/<owner-id>.jpg
```

The actual extension follows the response Content-Type and may differ when a
server serves another valid image format. Confirm primary image paths in
`google_text_ad_variants.image_url`, owner paths in
`google_text_ad_post_owners.post_owner_image`, and video completion in ES
`image_video_url`. Original `othermultimedia` source URLs remain unchanged in
`google_transparency_ad_payload`; Elasticsearch and ad-search expose successful
NAS paths in `othermultimedia` (there is no new `nas_othermultimedia` field).
Confirm physical uploads in the existing NAS folder or the dedicated
`logs/nas-media-<date>.log` diagnostics using the internal ad ID.

## 6. Delete API

```text
POST /api/v1/google/insertion/delete
Content-Type: application/json
x-delete-token: API_DELETE_TOKEN
```

Delete using public ID:

```powershell
$deleteBody = '{"ad_id":"CR90000000000000000001"}'
Invoke-RestMethod `
  -Uri "$BaseUrl/api/v1/google/insertion/delete" `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{"x-delete-token"=$env:API_DELETE_TOKEN} `
  -Body $deleteBody
```

Or delete using the internal SQL ID:

```json
{"id": 12345}
```

Expected response:

```json
{
  "code": 200,
  "status": "ok",
  "message": "Data is deleted successfully !",
  "data": {"id": 12345}
}
```

The existing delete flow removes Transparency child rows, legacy Google child
rows, the canonical ad and the Elasticsearch document.

Verify SQL deletion:

```sql
SELECT COUNT(*) AS canonical_rows
FROM google_text_ad
WHERE ad_id = 'CR90000000000000000001';

SELECT COUNT(*) AS transparency_rows
FROM google_transparency_ad_payload t
WHERE t.google_text_ad_id = 12345;

SELECT COUNT(*) AS country_rows
FROM google_transparency_country_delivery d
WHERE d.google_text_ad_id = 12345;
```

Expected: all counts `0`. Repeat the ES query; expected hits are `0`.

## 7. Batch variant

The same insertion endpoint also accepts:

```json
{
  "ads": [
    {"...": "complete contract-valid TEXT payload"},
    {"...": "complete contract-valid IMAGE payload"},
    {"...": "complete contract-valid VIDEO payload"}
  ]
}
```

The entire exact batch JSON must be signed. A mixed result returns HTTP 200 with
`status: "partial"`, per-item results, and `meta.total/ok/failed`.
