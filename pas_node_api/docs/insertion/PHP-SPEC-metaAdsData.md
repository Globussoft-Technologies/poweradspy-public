# PHP Spec — `adsdata()` → POST `metaAdsData`

> Reference specification of the legacy Laravel method we are porting to Node.
> Source: `api/app/Modules/User/Controllers/adsDataController.php`, method `adsdata`, **lines 102–2477**.
> Keep this in sync if the PHP changes. The Node port lives under `src/services/facebook/insertion/`.

---

## 1. Purpose

Ingests a SINGLE scraped Facebook ad and either:
- **INSERTs** a new ad (when `ad_id` not yet in `facebook_ad`), or
- **UPDATEs** the existing ad's analytics/metadata (when it already exists).

Steps: validate → video LCS/thumbnail rules → version checks per platform → resolve/create discovering `facebook_users` → **language-translation API (critical)** → existence check `getAd(ad_id)` → branch INSERT vs UPDATE → upsert dimension rows → media to S3/NAS → write `facebook_ad` + variants + analytics + child rows → impression/popularity APIs → translation → index ES `search_mix` (+ `facebook_ad`) → fire-and-forget ADGPT → respond. Runs under `set_time_limit(0)`.

---

## 2. Input payload (`$request->all()`)

**Pre-validation:** `ad_id == null` → `400 "Ad id cannot be null"`. Required.

**Validator (runs only when `socionator == 0` or unset):**

| Field | Rule |
|---|---|
| `type` | required, in:`IMAGE`,`VIDEO` |
| `category` | required string |
| `call_to_action` | present, string, nullable |
| `image_video_url` | required, url, string |
| `ad_position` | required string |
| `likes` / `comment` / `share` | required integer |
| `other_multimedia` | present, nullable |
| `destination_url` | present, nullable |
| `ad_title` / `news_feed_description` / `ad_text` / `ad_url` | present, string, nullable |
| `post_owner` | present, string, nullable |
| `post_owner_image` | present, nullable |
| `ad_id` / `platform` / `version` | required |
| `post_date` | present, string, nullable |
| `first_seen` / `last_seen` | required, string, nullable |
| `city` / `state` | present, string, nullable |
| `country` | present, array |

Failure → `{code:400, message: errors[]}` returned with **HTTP 200**.

**Other fields:** `views` (→0 if empty), `thumbnail_url` (required for VIDEO), `socionator`, `user_request_id`/`user_request_value`/`code`, `meta_ad_id` (→null), `lower_age`/`upper_age` (""→null), `system_id` (req for platform 10), `facebook_id`, `source` (def "desktop"), `status` (def 1), `impression`, `country_status`→`proxy_status`, `lowerBudget`/`upperBudget`, `comments_data`, `verified`/`page_verified`, `category_id`/`subcategory_id` (ES-only).

**Coercions (INSERT path):**
- `post_owner_image == "null"` → null.
- `urldecode`: ad_text, news_feed_description, destination_url, image_video_url, ad_title, post_owner_image, ad_url.
- `image_video_url` & `post_owner_image`: `str_replace("=v1:", "=v1%3A")`.
- `post_date`/`first_seen`/`last_seen`: `intval(substr(val,0,10))` (epoch → 10-digit seconds).
- variant title/text/newsfeed: `&amp;` → `&`.
- `other_multimedia`: split by first match of `||,` → `||` → `|`, else single element.

**Platform codes:**
- **2** Socinator — version `>= 1.0.31` else 400.
- **3** FB-not-user (no facebook_id) — look up `facebook_users.facebook_id` by `current_country = country`; sets `userid_status=1` on ad_users rows.
- **5,6** Android/iOS — version `>= 1.3.2` else 400.
- **10** system-based — requires `system_id`; updates `facebook_users.System_id`; writes `facebook_ad.System_id`; logs `facebook_accounts_activities` (insert is_unique=1 / update is_unique=0).
- **11** sets `facebook_users.ads_info_status=11` if not set; EXCLUDED from analytics-update branch.
- **0** default when platform unset.

---

## 3. High-level flow

1. POST only; `set_time_limit(0)`; init scalars.
2. ad_id null guard.
3. Validation (conditional on socionator).
4. VIDEO LCS check: `likes+comment+share > views` → `404 "Total LCS is greater than views"`.
5. VIDEO thumbnail check: missing `thumbnail_url` → 400.
6. `updateRequestedStatus` if `user_request_id`.
7. meta_ad_id / views normalization.
8. other_multimedia parsing.
9. Version checks (platforms 5/6 and 2).
10. Get model singletons; age normalization.
11. facebook_id resolution (→ user_id; platform 11 / 3 specials; else 400).
12. Existence check `getAd(ad_id)` → `$result_fb_id`.
13. **Language translation API (BEFORE branch, critical)** — non-200 → 400.
14. **Branch:**
    - **INSERT (code==400):** `beginTransaction` → platform-10 system_id → URL decode → language detect (`languages` lookup/insert) → CTA translation override → upsert post_owner (+image upload) → upsert call_to_action → category → country_only → country → domain → build+insert `facebook_ad` (impression/popularity) → `commit` → meta_ad_budget → variants (+S3/NAS media) → analytics → `commit` → comments → multimedia → child rows (countries, countries_only, ad_users, meta_data) → `commit` → translation → **ES index `search_mix`** (reuse `_id` if exists) + `facebook_ad` index → ADGPT async → platform-10 activity log → `200 "Ad inserted successfully"` + id.
    - **UPDATE (code==200):** re-query joined ad → merge states/cities/countries → max(old,new) LCS/views (**BUG: adShares uses $comment not $share, line 1717**) → conditional NAS/S3 re-upload if not on PowerAdspy → update variant image_url_original → iso lookup → meta builtwith_status=4 if no dest_url → country_only/country upsert → update last_seen/days_running/hits → post_owner verified → **analytics update branch** (excl platform 11; only FEED/VIDEOFEED/SIDE positions; update today's row OR insert + `updateLCSgraph` backfill if gap>4d) → meta_ad_budget → hits recompute → ad_users count → VIDEO image_url_original → countries_only upsert → translation → **ES delete + re-index `search_mix`** (carry over outgoing/url/translation from old _source) → ADGPT async → platform-10 activity log → `200 "Ad already present, data updated. $id"`.
15. Outer catch → `rollBack` → `401 "Some error occured in adsdata"`.

**Transactions:** INSERT uses explicit `beginTransaction` w/ commits @ fb_ad, @ analytics, @ child rows (many rollBack on failure). UPDATE has no explicit transaction.

---

## 4. Database writes (per table)

> Model pattern: `Model::getInstance()` singleton; methods return JSON string → `{code:200|400|401, data, message}`. `400` = not found.

- **facebook_users** — read `getFacebook_usersdata`; update `ads_info_status=11` (p11), `System_id` (p10).
- **facebook_ad_post_owners** — read by `post_owner_lower`; insert {post_owner_name, post_owner_image, original_post_owner_image, ads_count=1, verified}; update {image_updated, post_owner_image, ads_count+1, verified}.
- **facebook_call_to_actions** — read by `action`; insert {action, count=1}.
- **facebook_category** — read by `category_name`; insert {category_name}.
- **country_only** — `upsertData(country)` → {country_only_id}.
- **country** — read by city/state/country; insert {city, state, country[, country_only_id]}.
- **facebook_ad_domains** — read by `domain`; insert {domain}.
- **facebook_ad** — read `getAd(ad_id)` / `getJoindAds`; insert cols: category_id, call_to_action_id, domain_id, country_id, country_only_id, post_owner_id, default_variant_id, default_analytics_id, discoverer_user_id, likes, comments, shares, source, post_date, first_seen, last_seen, days_running=1, lower_age_seen, upper_age_seen, type, platform, ad_id, ad_position (VIDEO FEED→VIDEOFEED), default_ad_url_id=0, post_owner_updated=0, language_id, variants_count=0, destination_scraper_status=0, l_c_s_status=0, l_c_s_updated_date, status, affiliate_ad=0, redirect_destination_url_source=0, reward_status=0, hits=1, views (VIDEO), System_id (p10), impression, proxy_status (country_status), popularity. update: default_analytics_id, views, days_running, last_seen, hits.
- **facebook_meta_ad_budget** — `dataExist`; insert {facebook_ad_id, meta_ad_id, lowerBudget, upperBudget}.
- **facebook_ad_variants** — insert {facebook_ad_id, title, text, newsfeed_description, image_url_original}; update {image_url, image_url_original}.
- **facebook_ad_analytics** — insert {facebook_ad_id, likes, comments, shares, popularity, impression, engagement_rate, date, hits=1}; update existing row {likes, comments, shares, hits, impression, popularity, engagement_rate}; raw `SELECT sum(hits)`.
- **facebook_comments** — save {facebook_ad_id, comment_data=json}.
- **facebook_ad_image_video** — via `fileUpload(...,"MULTIMEDIA")`.
- **facebook_ad_countries** — `insertFacebookAdCountriesArray` (+facebook_ad_id each).
- **facebook_ad_countries_only** — insert/`upsertFacebookAdCountriesArray`.
- **facebook_ad_users** — read `getFacebookAdUsers`; insert {facebook_ad_id, user_id, count=1, platform}; update count+1; userid_status=1 (p3).
- **facebook_ad_meta_data** — read; insert {facebook_ad_id, destination_url, built_with_status(=4 if no dest), firstSeenOn*/lastSeenOn* per source, screenshot_url="processing.gif", platform, ad_url, version, lcs_status=5}; update built_with_status=4.
- **facebook_translation** — `updateOrCreateTranslation`.
- **languages** — select by iso; insertGetId {iso, name}.
- **facebook_accounts_activities** — raw insert {account_id, system_id, facebook_ad_id, platform, is_unique} (p10).
- **Users_Request** — via `updateRequestedStatus`.

---

## 5. Elasticsearch indexing

**Index:** `search_mix` (type `doc`) primary; `facebook_ad` secondary.

Doc built by `setParams($gt,'facebook_ad')`: expands `col|langs` → `col_ru/fr/sp/ge/exactly`; synthetic `html` (title+text+newsfeed), `mixdata` (+comment_data), `facebook_user_countries` (GROUP_CONCAT). `"0000-00-00 00:00:00"` → `"0001-01-01 01:01:01"`.

**INSERT columns** (see PHP lines 1263–1272) — full `currentTableColumns` array incl. facebook_ad.*, facebook_users.Gender, country_only.country, call_to_actions.action, variants.{title,text,newsfeed_description,image_*}|langs, post_owners.*, meta_data.*, comments.comment_data, html, mixdata, facebook_user_countries, html_lander_content.*, domains.domain_registered_date, translation.{ad_text,news_feed_description,ad_title}.

**Extra body fields (INSERT):** lang_detect; VIDEO→ Thumbnail(image_url), facebook_ad.views, nas_video_url; IMAGE→ facebook_ad.s3_path, new_nas_image_url; facebook_ad.impression; states[]; city[]; engagement_rate; facebook.averagebudget; facebook_ad.popularity={max,current}; image_url_original; platform; category_id; subcategory_id.

**De-dup:** search `search_mix` by `facebook_ad.id`; if found reuse `_id` so `index()` replaces in place.

**UPDATE:** `delete` existing (`searchID(id)` finds `_id` by term query) → re-query → re-index carrying over outgoing-link/url/translation/popularity/impression fields from old `_source`.

---

## 6. External API calls

| Call | Params | Use | Criticality |
|---|---|---|---|
| **Language Translation** `env(LANGUAGE_TRANSLATION_API)` | call_to_action, text, title, newsfeed_description | detected_language, language_name, translations | **CRITICAL (abort 400)** |
| **Impression** `https://impression.poweradspy.com/get_impressions_and_popularity` | ad_running_days, call_to_action, iso[], type, position, likes, comments, shares, views | impressions, engagement_rate | throws on error |
| **Popularity** `env(API_IMPRESSION_POPULARITY)` | same | {max,current} | throws on error |
| **ADGPT** `env(ADGPT_INSERTION_API)` postAsync timeout 0.1s | combinedData | ignored | **best-effort** |
| **NAS** `StoreInNAS2("VIDEO",path,variant_id)` | video file | nas_video_url | best-effort |
| **S3/NAS image-video** `fileUpload(type,url,id,folder[,adId,thumb])` | media URL | S3/nas path; DefaultImage.jpg/.mp4 → 500 abort | critical for media |

`postApiCall(method,url,data,multipart)` (helper.php:45) = Guzzle wrapper → `{statusCode, data}`.

---

## 7. Events & async jobs

- No `event()` / `dispatch()` / Spatie Pool / `analyticsIndex` actually fired (dead imports).
- Only async = Guzzle `postAsync` to ADGPT (fire-and-forget, 0.1s timeout).

---

## 8. Response shapes

| Code | Message |
|---|---|
| 400 | "Ad id cannot be null" |
| 400 (HTTP 200) | validator errors[] |
| 404 | "Total LCS is greater than views" |
| 400 | "Invalid Thumbnail for Video Ad" |
| 400 | "update there is no ad for this keyword" |
| 400 | "Please check the Version,Version Should be greater than 1.3.1 for ads" |
| 400 | "Please check the Version,Version Should be greater than 1.0.31" |
| 401 | "current facebook_id not found" |
| 401 | "current country not found" |
| 400 | "please provide facebook_id" |
| 400 | "error occurred in  Language translation api" (x2, one typo `mesosage`) |
| 402 | "duplicate ad found" |
| 500 | "Failed when uploading image video url into S3…" |
| 200 | "Ad inserted successfully" + id |
| 200 | "Ad already present, data updated. $id" |
| 401 | "Some error occured in adsdata" (outer catch) |

---

## 9. Helper methods

- `updateRequestedStatus($postData)` — updates Users_Request status + sent_status/meta_sync_count.
- `calculateImpression(...)` — impression API → {impression, engagement_rate}.
- `calculatePopularity(...)` — popularity API → {max,current}.
- `setParams($gt,'facebook_ad')` — ES doc builder (|lang expansion, html/mixdata synthetics, date sentinel).
- `setNewParams($variant)` — ES doc builder for `facebook_ad` index.
- `searchID($id)` — ES term query → `_id`.
- `uploadToS3Bucket`, `upload_multiple_*` — media upload helpers.
- helper: `postApiCall`, `logApiErrors`, `fileUpload`, `StoreInNAS2`, `webpImageConverter`, `uploadImageToStoragePath`, `updateLCSgraph`.
- `updateOrCreateTranslation` (FacebookTranslation model).

---

## 10. CPU vs I/O

- **CPU (light):** validation, version/LCS checks, urldecode/str_replace/substr, JSON encode/decode of model responses, `setParams` doc build.
- **I/O (heavy):** every DB upsert/insert (post_owner/cta/category/country/domain/ad/variants/analytics/child rows), translation/impression/popularity APIs, S3/NAS media upload + full video download, ES search/index/delete.
- `usleep(200000)` = deliberate 200ms ES-consistency wait.

---

## ⚠️ Re-implementation cautions

1. Existing-ID detection (`code 400 = not found`) drives INSERT vs UPDATE — replicate exactly.
2. Translation API failure is a hard 400 — called BEFORE branching.
3. INSERT = explicit transaction w/ multiple commits; UPDATE = none.
4. Timestamps: payload epoch (ms or s); INSERT truncates `substr(val,0,10)`; ADGPT divides by 1000 if `strlen>10`.
5. Preserve-or-deliberately-fix bug: `adShares` from `$comment` not `$share` (line 1717).
6. `ad_position == "SIDE"||"MARKETPLACE"` truthiness bug (always true) — reproduce intent (SIDE or MARKETPLACE).
7. ES de-dup: INSERT replaces in place if doc exists; UPDATE deletes-then-reindexes.
8. Any `/DefaultImage.jpg|.mp4` on the primary image = fatal 500 in INSERT.
