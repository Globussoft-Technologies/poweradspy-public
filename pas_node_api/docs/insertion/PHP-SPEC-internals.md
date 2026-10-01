# PHP Spec — Internals (schema, ES builder, helpers)

> Load-bearing details extracted from the Laravel models + helpers, so the Node
> writers/ES-builder/media-upload can be implemented without re-reading PHP.
> Companion to [PHP-SPEC-metaAdsData.md](PHP-SPEC-metaAdsData.md) & [PHP-SPEC-adsLibrary.md](PHP-SPEC-adsLibrary.md).

---

## A. Model method conventions (→ raw mysql2 in Node)

Legacy pattern: `$where = ['rawQuery'=>'col = ?', 'bindParams'=>[...]]`, `$select=['*']`.
Returns `json_encode({code, message, data})`:
- **getX** → `.get()`. `200`+rows if ≥1, `400`+null if none, `401` on error. Existence = `isset(data[0])`.
- **insertX** → `insertGetId`. `200`+`data=<id>` if id>0, else `400`, `401` on error.
- **updateX(data, where)** → `200` only if **exactly 1** row affected, `400` if 0, `401` on error.
- **deleteX** → `200` if >0 else `400`.

**Arg-order / return traps:**
- Generic `updateX(data, where)` — but `Facebook_ad_domains.updateFacebook_ad_domains(where, data)` is reversed.
- Non-JSON returns: `Country_only.upsertData` & `Facebook_ad_countries_only.upsertFacebookAdCountriesArray` → stdClass; `Facebook_meta_ad_budget.insertData/dataExist/updateData`, `FacebookTranslation.updateOrCreateTranslation`, `Facebook_ad_meta_data.updateMetaDataFor` → raw bool/int/rows.
- Bulk `insertFacebookAdCountriesArray` → plain `insert(array)`, `500` on error.
- `facebook_ad_meta_data` PK = `facebook_ad_id` (Eloquent insert, no id).
- `existsFacebook_lib_page_details` INVERTED: `200` = exists, `400` = not found.
- `facebook_ad_variants` & `facebook_ad_domains` carry **env DB-name prefix** (`pasdev_facebook.` dev / `facebook_sql.` prod) — parameterize schema name.

---

## B. Table → columns

| Table | Columns (key ones) | Dedup / PK |
|---|---|---|
| `facebook_ad` | id, ad_id, ad_position, post_owner_id, domain_id, call_to_action_id, country_id, country_only_id, discoverer_user_id, category_id, language_id, type, post_date, created_date, last_seen, first_seen, days_running, likes, comments, shares, hits, views, source, status, impression, popularity, proxy_status, System_id, lower_age_seen, upper_age_seen, default_variant_id, default_analytics_id, default_ad_url_id, variants_count, l_c_s_status, l_c_s_updated_date, affiliate_ad, reward_status, redirect_destination_url_source, post_owner_updated, destination_scraper_status, collation_id | PK id; lookup ad_id |
| `facebook_ad_variants` | id, facebook_ad_id, image_url, image_url_original, newsfeed_description, text, title, tags, image_object, image_celebrity, image_brand_logo, image_ocr, image_url_status, object_update_date, ocr_updated_date | facebook_ad_id |
| `facebook_ad_analytics` | id, facebook_ad_id, date, created, last_updated, likes, comments, shares, hits, impression, popularity, engagement_rate | facebook_ad_id+date |
| `facebook_ad_post_owners` | id, post_owner_name, post_owner_lower, post_owner_image, original_post_owner_image, ads_count, image_updated, verified, created_date, updated_date, page_created_date | post_owner_lower |
| `facebook_ad_domains` | id, domain, hits, created, last_seen, domain_registered_date | domain |
| `facebook_category` | id, category_name, created_date, updated_date | category_name |
| `facebook_call_to_actions` | id, action, count | action |
| `country` | id, country, city, state, country_only_id, status, created_date, updated_date | (insertCountry implodes array country→csv) |
| `country_only` | id, country | country |
| `facebook_users` | id, facebook_id, name, age, Gender, current_country, relationship_status, others_places_lived, server_user, update_status, ads_info_status, System_id, created_date, updated_date | facebook_id |
| `facebook_ad_users` | id, facebook_ad_id, user_id, count, userid_status, platform, created_date, updated_date | facebook_ad_id+user_id |
| `facebook_ad_countries` | id, facebook_ad_id, country_id, country_only_id, count, created_date, updated_date | bulk insert |
| `facebook_ad_countries_only` | id, facebook_ad_id, country_only_id, count, created_date, updated_date | (country_only_id, facebook_ad_id) |
| `facebook_ad_meta_data` | **facebook_ad_id (PK)**, ad_url, destination_url, screenshot_url, built_with, built_with_status, version, language, platform, lcs_status, firstSeenOnDesktop/Ios/Android, lastSeenOn*, est_audience_size_low/high, active_status, ad_run_platforms, EUT, meta_ad_url, created_date | facebook_ad_id |
| `facebook_comments` | id, facebook_ad_id, comment_data | facebook_ad_id |
| `facebook_meta_ad_budget` | facebook_ad_id, meta_ad_id, lowerBudget, upperBudget, status | meta_ad_id |
| `facebook_translation` | facebook_ad_id, news_feed_description, ad_title, ad_text | facebook_ad_id (upsert) |
| `facebook_lib_page_details` | id, ad_id, facebook_ad_id, gender_details, age_details, page_name, platform_used, post_owner_id, impression_low, impression_high, page_category | ad_id |
| `country_data` | id, name, nicename, iso, country | name / nicename |
| `facebook_ad_image_video` | facebook_ad_id, ad_type, ad_image_video | facebook_ad_id |

---

## C. `getJoindAds` JOIN (build ES denormalized row) — `Facebook_ad.php:1501`

```sql
SELECT <cols> FROM facebook_ad
LEFT JOIN facebook_ad_image_video  ON facebook_ad.id = facebook_ad_image_video.facebook_ad_id
LEFT JOIN facebook_ad_domains      ON facebook_ad.domain_id = facebook_ad_domains.id
LEFT JOIN facebook_call_to_actions ON facebook_ad.call_to_action_id = facebook_call_to_actions.id
LEFT JOIN country                  ON country.id = facebook_ad.country_id
LEFT JOIN facebook_users           ON facebook_ad.discoverer_user_id = facebook_users.id
LEFT JOIN facebook_ad_meta_data    ON facebook_ad.id = facebook_ad_meta_data.facebook_ad_id
LEFT JOIN facebook_ad_url          ON facebook_ad.id = facebook_ad_url.facebook_ad_id
LEFT JOIN facebook_ad_post_owners  ON facebook_ad.post_owner_id = facebook_ad_post_owners.id
LEFT JOIN facebook_ad_variants     ON facebook_ad.id = facebook_ad_variants.facebook_ad_id
LEFT JOIN facebook_category        ON facebook_category.id = facebook_ad.category_id
LEFT JOIN languages                ON facebook_ad.language_id = languages.id
LEFT JOIN facebook_meta_ad_budget  ON facebook_ad.id = facebook_meta_ad_budget.facebook_ad_id
LEFT JOIN facebook_lib_page_details ON facebook_ad.id = facebook_lib_page_details.facebook_ad_id
WHERE <rawQuery> GROUP BY facebook_ad.id;
```
Commented out (NOT active): facebook_ad_analytics, country_data, facebook_ad_outgoing_links.
Per-row enrichment: `row.urlArray = SELECT url,url_type FROM facebook_ad_url WHERE facebook_ad_id=row.id` (do `WHERE IN (...)` grouped in Node to avoid N+1).

---

## D. ES doc builder (`setParams` / `setNewParams` / `searchID`)

`setParams(row, 'facebook_ad')` → builds `{ index: lower(currentTable), type:'doc', body }`:
- For each entry in `currentTableColumns`:
  - `"table.field"` → `body["table.field"] = row[field]` (value keyed by FIELD only; collisions = last write wins).
  - `"table.field|ru,fr,sp,ge,exactly"` → `body["table.field_<lang>"] = row[field]` for each lang (SAME value, **no real translation**) PLUS `body["table.field"] = row[field]`.
  - Synthetic single tokens: `html` = `title+" "+text+" "+newsfeed_description`; `mixdata` = `+ " "+comment_data`; `comment_data` = `JSON.parse(row.comment_data)`; `lang_detect` = `lower(row.iso)`; `facebook_user_countries` = `GROUP_CONCAT(country_only.country)` via `facebook_ad_countries_only` where facebook_ad_id=row.id → `.split(',')` (array).
  - `".country"` override → array of country names via `facebook_ad_countries`→`country_only`.
  - Date sentinel: `"0000-00-00 00:00:00"` → `"0001-01-01 01:01:01"` (per field, before write).
- `setNewParams(obj)` (secondary `facebook_ad` index) ≡ plain copy: `body[k]= sentinel(obj[k])`, `{index:'facebook_ad', type:'doc', body}`.
- `searchID(id)` → `elasticsearch.search({index: currentTable, type:'doc', body:{query:{term:{'facebook_ad.id': id}}}})` → `hits.hits[0]._id` (guard for empty → null).

`currentTableColumns`: metaAdsData INSERT set = PHP 1263-1272; adsLibrary INSERT set = PHP 5835-5844 (see endpoint specs §5).

---

## E. `helper::fileUpload($type,$link,$id,$folder,$fbId=0,$thumbnail_url=null)`

Download (optional Session proxy via fsockopen, else direct `file_get_contents`) → stage to `storage/uploads/...` temp → `StoreInNAS2($folder,tmp,$id)` → `unlink`. **Only StoreInNAS2 (S3 commented out).** Return keys by branch:
- `postowner` → `{ post_owner_image: <nasPath | '/DefaultImage.jpg'> }`
- `IMAGE` → `{ nas_path, image_video_url }` (both = same NAS path; raw bytes, no webp convert)
- `THUMBNAIL` → downloads `$thumbnail_url`, webp-converts → `{ image_video_url }`
- `VIDEO` → `{ drive_video_url: <nasPath | '/DefaultImage.mp4'> }`
- `MULTIMEDIA` (`$link` = URL array) → per-url webp+NAS(OTHERMULTIMEDIA), upsert `facebook_ad_image_video` → `{ facebook_ad_id, ad_type, ad_image_video: json([paths]) }`
- outer catch → string `"/DefaultImage.jpg"`.
**No `Thumbnail`/`image_url` keys emitted.** `webpImageConverter`: gif→raw .jpg; webp→Intervention .webp q60; else→encode webp q75.

---

## F. impression / popularity (`calculateImpression` L7313 / `calculatePopularity` L7385)

Common sig `(ad_running_days, ad_call_to_action, country, ad_type, ad_position, ad_likes, ad_comments, ad_shares, ad_views)`.
- **Zero-engagement short-circuit:** likes==comments==shares==views==0 → impression `{impression:0,engagement_rate:0}`, popularity `{max:0,current:0}`.
- `ad_call_to_action` null→"".
- **ISO lookup:** for each country name → `SELECT iso FROM country_data WHERE name = UPPER(name)`; build `ad_iso[]`.
- POST `env(API_IMPRESSION_POPULARITY)` (impression in-use literal `https://impression.poweradspy.com/get_impressions_and_popularity`), JSON `{ad_running_days, ad_call_to_action, ad_iso, ad_type, ad_position, ad_likes, ad_comments, ad_shares, ad_views}`.
- **impression** reads `res.impressions`, `res.engagement_rate` → `{impression, engagement_rate}`.
- **popularity** reads `res.popularity_percentage` → `{max: val, current: val}` (both = popularity_percentage).
- On HTTP exception: **throws** (caller's outer catch handles).

---

## G. `updateRequestedStatus($postData)` — table `Users_Request`

1. needs `user_request_id`; fetch row (id,user_id,sent_status,keyword_status,advertiser_status,url_status,meta_sync_count); else no-op.
2. `code`→`code_to_update`: 200→1, 400→5, else 0.
3. `user_request_value`→target col: 1→keyword_status, 2→advertiser_status, 3→url_status.
4. sent_status branch: ==9 → meta_sync_count+1; ==5 → code 1→sent_status6, code 5→sent_status7.
5. always set `{targetCol}=code_to_update WHERE id=user_request_id`.

---

## H. `updateLCSgraph(...)` (helper L535)

Backfills synthetic daily `facebook_ad_analytics` rows between date1..date2 so the LCS graph has interpolated points. Point count by date_range (4-7→1, 7-25→2-3, 25-60→4-6, else 7-10). Eligible per metric when `(max-min)>=10`. Produces rows `{date:'Y-m-d', likes, comments, shares, facebook_ad_id, hits:1}` (monotonic growth) + final row at maxDate; returns array.

---

## I. Translation API (`adsdata` L340-462)

POST `env(LANGUAGE_TRANSLATION_API)` `{call_to_action, text, title, newsfeed_description}`. Success = HTTP200 && body.code==200. Consumes: `detected_language`→iso (lookup/insert `languages` WHERE iso=UPPER; skip block if APP_ENV=dev), `language_name`→new languages.name, `call_to_action`→override. Persist via `updateOrCreateTranslation`: maps `newsfeed_description→news_feed_description, title→ad_title, text→ad_text, facebook_ad_id`; upsert on facebook_ad_id.

---

## Env vars → Node config (config.insertion.*)
`NAS_MEDIA_URL`/`NAS_MEDIA_TOKEN`/`NAS_VIDEO_URL` → `insertion.nas`; `API_IMPRESSION_POPULARITY` → `insertion.api.popularityUrl`+`impressionUrl`; `LANGUAGE_TRANSLATION_API` → `insertion.api.translationUrl`; `ADGPT_INSERTION_API` → `insertion.api.adgptInsertionUrl`; `INSERTION_SECRET_KEY` → `insertion.secretKey`; `APP_ENV` → `config.env`. (`AWS_BUCKET` unused — S3 path commented out.)
