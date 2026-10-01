# PHP Spec — `adsLibraryInsert()` → POST `adsLibrary`

> Reference spec of the legacy Laravel method we are porting.
> Source: `api/app/Modules/User/Controllers/adsDataController.php:4801-6603`.
> Companion to [PHP-SPEC-metaAdsData.md](PHP-SPEC-metaAdsData.md). Shares most logic with `adsdata` — see §11.

---

## 1. Purpose

Ingest a single Facebook **Ad Library** ad (Meta public library, `platform` default `15`): upsert lookup rows (post_owner, call_to_action, category, domain, countries), insert/update `facebook_ad` + variant/analytics/meta/budget children, upload media (image/thumbnail to S3, video to NAS), translate copy, index into ES `search_mix`, fire best-effort AdsGPT + translation calls.

Branch on `getAd(ad_id)`:
- `code==400` (not found) → **INSERT** (4963-6016).
- `code==200` (found) → **UPDATE**: bump hits/last_seen/days_running, re-upload media if low quality, re-index ES (6018-6593).

### Differences vs regular `adsdata`
- Writes **`facebook_lib_page_detail`** (page gender/age breakdown, page name, platforms used, impressions range) and **`facebook_meta_ad_budget`**.
- `page_details`, `gender`, `age`, `ad_run_platforms`, `EUT`, `est_audience_size_low/high`, `impressions_low/high`, `meta_ad_id`, `lowerBudget/upperBudget`, `active_status`, `collation_id`, `location`, `views` payload.
- **Impression = simple avg(impressions_high, impressions_low)** (NOT `calculateImpression`); **popularity = null**.
- Calls `updateRequestedStatus` (Users_Request workflow).
- **Country arrives as ISO codes** → names via `country_data` lookup (unless contains `'ALL'`). adsdata gets names directly.
- NAS video upload via raw download + `StoreInNAS2`.
- Per-table inserts wrapped in **Spatie async Pool**, awaited at 5874.
- No `facebook_users`/`facebook_ad_users`/`facebook_comments`/`country`(city/state) inserts; discoverer user left default; `country_id`/`country_only_id`=0.

---

## 2. Input payload

Validator (4840-4866): `type`(req, IMAGE|VIDEO), `ad_position`(req; "VIDEO FEED"→"VIDEOFEED"), `other_multimedia`(present,nullable; split `||,`→`||`→`|`), `destination_url`(present; urldecode; host→domain strip www.), `ad_title`/`news_feed_description`/`ad_text`(present,string,nullable; urldecode; `&amp;`→`&`), `meta_ad_url`(present; urldecode; null→""), `post_owner`(present), `post_owner_image`(present; "null"→null; urldecode; `=v1:`→`=v1%3A`), `ad_id`(req), `platform`(req; def 15), `verified`(req), `call_to_action`(present; translated override), `first_seen`/`last_seen`(req; UNIX→datetime; def now), `est_audience_size_low/high`(present; null→0), `EUT`(present), `ad_run_platforms`(present), `currency`(present), `impressions_low`(present; null→0), `impressions_high`(present; impression avg), `country`(present, array; ISO→name).

Not validated but used: `thumbnail_url`(req for VIDEO else 400), `meta_ad_id`(→null), `views`(def 0), `post_date`(UNIX→datetime; def first_seen), `image_video_url`, `ad_image`, `gender`, `age`, `page_details.*`, `collation_id`, `location`, `lowerBudget`, `upperBudget`, `active_status`, `state`, `city`, `user_request_id`, `code`, `user_request_value`.

---

## 3. High-level flow

1. Init vars + model singletons + Spatie Pool (4807-4836).
2. Validate; split other_multimedia; VIDEO thumbnail check (400 if missing); validation fail → 400 (4840-4907). *(stray `DB::rollBack()` at 4892 before any tx — drop in port.)*
3. Coerce meta_ad_id/views/audience/impression nulls (4909-4926).
4. `updateRequestedStatus($postData)` (4918).
5. Existence `getAd(ad_id)` → resultAdid (4931-4934).
6. Translation API (best-effort) → responseForLanguageTranslate (4937-4959).
7. **INSERT (code==400):** beginTransaction → decode/clean/dates → language id (skip if APP_ENV=dev) → post_owner upsert + S3 image → **async** lib_page_detail → **async** CTA → **async** category (if page_category) → country ISO→name + country_only upsert → **async** domain → impression avg → insert facebook_ad (dup→402) → variants + media (S3 image / thumbnail + NAS video; video fail→500) → analytics → **async** meta_budget (if meta_ad_id) → other_multimedia upload → facebook_ad_countries + countries_only → **async** meta_data → **commit** → join-query → pool.wait() → lib_page_detail.updateData(facebook_ad_id) → ES index per row → best-effort AdsGPT → 200 (or 400 if id≤0).
8. **UPDATE (code==200):** no tx begin → getJoindAds → set collation/views → post_date → ES search; re-upload media only if missing/low-quality (NAS video if existing) → variant image_url_original → meta_budget if new → iso from language_id → country ISO→name + country_only upsert → update facebook_ad last_seen/days_running/hits (Eloquent) → countries_only upsert → translation updateOrCreate → ES search (carry over outgoing/url/translation/nas) → delete old ES doc (searchID) → rebuild join → ES index per row → best-effort AdsGPT → 200 "Ad already present, data updated".
9. Return json. Outer catch → rollBack + 400 "Some Error occurred".

**Tx:** INSERT bracketed (beginTransaction 4965 → commit 5833). UPDATE none. ⚠️ Async pool tasks run inside tx but awaited AFTER commit (5874) — **Node port must await all writes before commit.**

---

## 4. Database writes

INSERT path:
- **facebook_ad_post_owners** — insert/update {post_owner_name, post_owner_image, original_post_owner_image, ads_count+1, verified, image_updated}; dedup `post_owner_lower`.
- **facebook_lib_page_detail** — exists/insert/updateData {gender_details(json), age_details(json), page_name(=post_owner), platform_used(=ad_run_platforms), ad_id, post_owner_id, impression_low, impression_high, page_category; later facebook_ad_id}.
- **facebook_call_to_actions** — {action, count+1}; dedup `action`.
- **facebook_category** — {category_name from page_details.page_category}; dedup name.
- **country_data** (read) — whereIn iso → names.
- **country_only** — upsertData(names) → rows.
- **facebook_ad_domains** — {domain = host minus www, or ""}; dedup.
- **facebook_ad** — insert {call_to_action_id, domain_id, country_id=0, country_only_id=0, post_owner_id, default_variant_id, default_analytics_id, post_date, first_seen, last_seen, source="desktop", days_running=1, lower_age_seen=18, upper_age_seen=65, type, platform, ad_id, ad_position, default_ad_url_id=0, post_owner_updated=0, language_id=1, variants_count=0, destination_scraper_status=0, l_c_s_status=0, l_c_s_updated_date=now, status=1, affiliate_ad=0, redirect_destination_url_source=0, reward_status=0, hits=1, impression=final_impression, category_id(or 0), collation_id, views(VIDEO else 0)}; dup→402.
- **facebook_ad_variants** — insert/update {facebook_ad_id, title, text, newsfeed_description, image_url_original, image_url}.
- **facebook_ad_analytics** — {facebook_ad_id, likes=0, comments=0, shares=0, popularity=null, impression=final_impression, date=today, hits=1}.
- **facebook_meta_ad_budget** — {facebook_ad_id, meta_ad_id, lowerBudget, upperBudget} if meta_ad_id.
- **facebook_ad_image_video** — fileUpload(...,"MULTIMEDIA") if other_multimedia.
- **facebook_ad_countries / facebook_ad_countries_only** — insertFacebookAdCountriesArray(countryOnlyArray).
- **facebook_ad_meta_data** — insert-if-absent {facebook_ad_id, destination_url, screenshot_url="processing.gif", platform, firstSeenOnDesktop=now, meta_ad_url, est_audience_size_low/high, active_status, ad_run_platforms, EUT}.
- **languages** (read), **Users_Request** (via updateRequestedStatus).

UPDATE path also: facebook_ad.updateData(collation_id, views, post_date) + Eloquent save(last_seen, days_running, hits); variants update; post_owner verified=1; meta_budget insert if new; country_only + countries_only upsert; translation updateOrCreate; analytics read-only.

---

## 5. Elasticsearch indexing

Index **`search_mix`** type `doc`. INSERT `currentTableColumns` (5835-5844) — see source for exact array; same `|ru,fr,sp,ge,exactly` expansion + html/mixdata/facebook_user_countries synthetics as adsdata, plus Ad-Library fields: `facebook_ad.collation_id`, `facebook_ad.first_seen`, `facebook_ad_meta_data.est_audience_size_low/high`, `facebook_ad_meta_data.EUT`, `facebook_ad_meta_data.meta_ad_url`, `facebook_ad_meta_data.ad_run_platforms`.

Extra body fields (INSERT, 5896-5921): `Thumbnail`(VIDEO), `lang_detect`, `facebook_lib_page_details.data`(=page_details), `facbook_ad.impression`(sic)=avg, `facebook_ad.location`, `facebook_ad.status`=1, `facebook.averagebudget`, `facebook_translation.ad_text/news_feed_description`, `facebook_ad.ad_category`=[page_category], VIDEO→{views, nas_video_url}, IMAGE→{s3_path, new_nas_image_url}, image_url_original, platform.

UPDATE: delete old doc via searchID → re-index carrying over outgoing_links/url_redirects/translation(ar,pt,fr)/nas_video_url from old _source.

---

## 6. External API calls

1. **Translation** `env(LANGUAGE_TRANSLATION_API)` — {call_to_action,text,title,newsfeed_description}. **Best-effort** here (try/catch, logs only — unlike adsdata where it's critical).
2. **AdsGPT** — INSERT hardcoded `https://adsgpt-dev-collection-api.poweradspy.com/ads-gpt-data/v1/data-insertion`; UPDATE `env(ADGPT_INSERTION_API)`. postAsync(combinedData), wait(false). Best-effort. *(catch wrongly calls DB::rollback — drop.)*
3. **S3/NAS** fileUpload + StoreInNAS2 (HTTP fetch). VIDEO upload fail on INSERT → 500; image fail tolerated.

---

## 7. Events & async jobs

No Laravel events/jobs. Spatie **Pool** parallelizes: lib_page_detail, CTA, category, domain, meta_budget, meta_data inserts; awaited 5874 (INSERT only). Guzzle postAsync (AdsGPT). updateRequestedStatus synchronous.

---

## 8. Response shapes

| Trigger | code | message |
|---|---|---|
| VIDEO no thumbnail | 400 | "Invalid Thumbnail for Video Ad" |
| Validation fail | 400 | errors[] (HTTP 200) |
| Duplicate ad | 402 | "duplicate ad found" |
| Variant video upload fail | 500 | "Failed when uploading image video url into S3.Thumnail_url is required" |
| INSERT success | 200 | "Ad inserted successfully", id, time |
| INSERT id≤0 | 400 | "Exception occurred in ad_insertion", id |
| UPDATE success | 200 | "Ad already present, data updated. $id" |
| Outer catch | 400 | "Some Error occurred" |

⚠️ Several error paths return raw strings / model arrays — **normalize to {code,message} in the port.**

---

## 9. Helpers — same set as adsdata (see that spec §9) plus: `existsFacebook_lib_page_details`, `insertFacebook_lib_page_details`, lib `updateData`; `Country_data` iso→name; `Facebook_meta_ad_budget insertData/dataExist`. `calculateImpression`/`calculatePopularity` **NOT used**.

---

## 10. CPU vs I/O

Predominantly **I/O-bound** (DB get/insert/update, two big join queries, country_data/languages lookups, translation/AdsGPT/S3/NAS network, video download to disk, ES ops). CPU light (validation, decode/clean, dates, parse_url, impression avg, setParams). Spatie pool = parallelize independent I/O inserts.

---

## 11. Shared logic with `adsdata` → REUSE (do not duplicate)

**Shared tables/upserts (identical dedup):** facebook_ad_post_owners, facebook_call_to_actions, facebook_category, country_only + facebook_ad_countries + facebook_ad_countries_only, facebook_ad_domains, facebook_ad, facebook_ad_variants, facebook_ad_analytics, facebook_ad_meta_data, facebook_meta_ad_budget, facebook_translation.

**Shared helpers:** fileUpload, StoreInNAS2 (→ common nasClient), postApiCall (→ common httpClient), setParams (ES doc builder), searchID (ES id lookup), ES index/search/delete into `search_mix`.

**Ad-Library-only (port fresh):** facebook_lib_page_detail, updateRequestedStatus (Users_Request), country ISO→name (country_data), simple-avg impression, Spatie pool orchestration.

**adsdata-only (don't call from library):** facebook_users, facebook_ad_users, facebook_comments, country (city/state), calculateImpression, calculatePopularity.

### Porting hazards
- Await all writes BEFORE commit (PHP awaits pool after commit — fix).
- Drop stray `DB::rollBack()` in AdsGPT catch & pre-tx thumbnail check.
- Normalize raw-string/array error returns to {code,message}.
- UPDATE branch has no transaction wrapper.
- Buggy boolean comparisons (`platform==15`, `destination_url==""`) — port the intent.
