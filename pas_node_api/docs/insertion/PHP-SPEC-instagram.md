# PHP Spec — Instagram insertion (DELTA vs Facebook)

> Instagram is structurally identical to Facebook insertion. This captures ONLY the
> differences. Baseline = [PHP-SPEC-metaAdsData.md](PHP-SPEC-metaAdsData.md) / [PHP-SPEC-adsLibrary.md](PHP-SPEC-adsLibrary.md).
> Source: `api_instagram/.../InstagramUserController.php` — `instaAdsData` (91-2564, POST `gramAdsData`),
> `adsLibraryInsert` (6516-8552), `deleteads` (6437). Routes use the non-`*NewIndex` methods.

## Endpoints / network
- POST `/api/v1/instagram/insertion/gramAdsData` → `instaAdsData`
- POST `/api/v1/instagram/insertion/adsLibrary` → `adsLibraryInsert`
- POST `/api/v1/instagram/insertion/delete` → `deleteads`
- NAS network slug = `instagram`, folder prefix = `insta` (already in nasClient.NAS_KEY_PREFIX). ADGPT `network=instagram`.

## Table map (facebook → instagram)
| Facebook | Instagram |
|---|---|
| facebook_ad | instagram_ad |
| facebook_ad_variants | instagram_ad_variants (FK `instagram_ad_id`) |
| facebook_ad_analytics | instagram_ad_analytics |
| facebook_ad_post_owners | instagram_ad_post_owners |
| facebook_call_to_actions | **instagram_call_to_action** (col **`call_to_action`**, not `action`) |
| facebook_category | instagram_category |
| facebook_ad_domains | **instagram_ad_domain** (singular) |
| country / country_only | **instagram_country / instagram_country_only** (network-specific) |
| facebook_ad_countries(_only) | instagram_ad_countries(_only) |
| facebook_ad_meta_data | instagram_ad_meta_data (own `id` PK + FK `instagram_ad_id`; `lcstatus` not lcs_status) |
| facebook_ad_image_video | instagram_ad_image_video |
| facebook_meta_ad_budget | instagram_meta_ad_budget |
| facebook_translation | **instagram_ad_translation** (cols: instagram_ad_id, ad_text, news_feed_description, ad_title) |
| facebook_users | **instagram_user** (singular) — discoverer; lookup by `instagram_id` |
| facebook_ad_users | instagram_ad_users (+ `userid_status`) |
| facebook_lib_page_detail | **instagram_page_details** |
| (n/a) | **instagram_ad_cost_usage_benefit_analysis** (adsLibrary: meta_ad_url, est_audience_size_low/high, ad_run_platforms, EUT) |
| facebook_accounts_activities | instagram_accounts_activities (platform 10) |
| facebook_ad_outgoing | instagram_ad_outgoing_links (ES carry-over read only) |
| facebook_html_content | instagram_ad_html_lander_content (ES read only) |
| country_data / languages | shared (same names) |

## instagram_ad columns
Has: id, ad_id, category_id, call_to_action_id, domain_id, country_id, country_only_id, post_owner_id, language_id, default_analytics_id, discoverer_user_id, default_variant_id, default_ad_url_id, post_owner_updated, variants_count, type, ad_position, likes, shares, comments, lower_age_seen, upper_age_seen, post_date, first_seen, last_seen, days_running, status, hits, **ad_type, source, affiliate_ad, redirect_destination_url_source, reward_status, l_c_s_status, domain_date_update_status, l_c_s_updated_date, created_date, updated_date, impression, popularity, collation_id, views, ad_budget, System_id**.
**NOT present (vs facebook):** `proxy_status`, `destination_scraper_status` → do NOT set them.
Default ages: instaAdsData 23/65; adsLibrary 18/65, source='desktop', language_id=1, hits=1.

## ES — index `instagram_search_mix`, field keys prefixed `instagram_*`
- Date formats (verified mapping): `instagram_ad.post_date`/`last_seen`/`instagram_ad_meta_data.firstSeenOn*` = `yyyy-MM-dd HH:mm:ss`; `instagram_ad_domain.domain_registered_date` = `yyyy-MM-dd`; `instagram_ad.created_date` = default.
- Prefix examples: `instagram_ad.id`, `instagram_user.gender` (lowercase), `instagram_country_only.country`, `instagram_call_to_action.call_to_action`, `instagram_ad_variants.title|ru,fr,sp,ge,exactly`, `instagram_ad_post_owners.post_owner_name|...`, `instagram_ad_meta_data.firstSeenOnDesktop`, `instagram_ad_domain.domain_registered_date`, `instagram_ad_translation.{ad_text,news_feed_description,ad_title}`.
- Extra body keys: `instagram_ad.impression`, `instagram_ad.popularity`({max,current}), `instagram_ad.views`, `instagram.averagebudget`, `engagement_rate`, `states`, `city`, `lang_detect`, `image_url_original`, `thumbnail`, `new_nas_image_url`(IMAGE), `nas_video_url`(VIDEO), `othermedia`(=instagram_ad_image_video.ad_image_video). adsLibrary adds `instagram_page_details.data`, `instagram_ad.location`, `instagram_ad.ad_category`.
- UPDATE carry-over (read old _source, instagram_ prefix): `instagram_ad_outgoing_links.{source_url,redirect_url,final_url}`, `instagram_ad_url.{url_redirects,url_destination,country_code}`, `<translationFeild>.ar/.pt/.fr`, `new_nas_image_url`, `nas_video_url`.

## Payload / flow deltas
- **User resolution:** by `instagram_id` against `instagram_user`. If absent and platform==3 → country fallback (`getinstagramId_users`) + `userid_status=1`. Else 400 "please provide instagram_id".
- **instaAdsData validator:** `type` in IMAGE,VIDEO,**STORIES**; `image_video_url` url; `post_owner`, `ad_position`, `post_date/first_seen/last_seen`, `country/state/city`, `lower_age/upper_age`. Reads instagram_id, story_type, ad_type, system_id (platform 10), views, thumbnail_url (req for VIDEO), meta_ad_id, lowerBudget/upperBudget, verified.
- **adsLibrary validator:** type IMAGE,VIDEO; verified, first_seen, last_seen required; `country` present|array (ISO → name via `country_data.instagram_country_iso`, unless 'ALL'); est_audience_size_low/high, EUT, ad_run_platforms, currency, impressions_low/high, meta_ad_url, collation_id, gender, age, page_details.page_category, location.
- **Platform codes:** 2 plugin, 3 country-discovery, 10 system_id/accounts_activities, 12 skips category, 15 analytics branch (adsLibrary).
- **Extra writes:** instagram_accounts_activities (platform 10), instagram_user.System_id update (platform 10), STORIES handling (story_type/ad_type). adsLibrary: instagram_page_details + instagram_ad_cost_usage_benefit_analysis; no instagram_ad_users / instagram_country / instagram_ad_url writes.

## getJoinedAds (build ES row) — `Instagram_ad.php`
**getAdsDetail** (instaAdsData UPDATE): instagram_ad LEFT JOIN instagram_country, instagram_ad_analytics, instagram_call_to_action, instagram_ad_post_owners, instagram_ad_variants, instagram_ad_meta_data, instagram_ad_image_video, instagram_ad_domain; ORDER BY instagram_ad_analytics.id DESC; WHERE ad_id=?.
**getJoindAds** (adsLibrary UPDATE): instagram_ad + LEFT JOIN instagram_ad_analytics, instagram_ad_image_video, instagram_ad_domain, instagram_call_to_action, instagram_country, instagram_user, instagram_ad_meta_data, instagram_ad_cost_usage_benefit_analysis, instagram_ad_outgoing_links, instagram_ad_url, instagram_ad_post_owners, instagram_ad_variants, instagram_category, languages, instagram_meta_ad_budget; WHERE ad_id=?.
Node port joins by `facebook_ad.id`→`instagram_ad.id`; FKs are `instagram_ad_id`; user join on singular `instagram_user`.

## NAS
network slug `instagram`, folder `insta`, key `insta/<typeSubfolder><YYYYMM>/<id>.<ext>`, Bearer token. fileUpload returns image_video_url/new_nas_image_url/new_video_url.
