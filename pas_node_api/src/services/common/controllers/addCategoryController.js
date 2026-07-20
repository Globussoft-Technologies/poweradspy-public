'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const networksConfig = require('../../../config/networks');
const config = require('../../../config');
const { syncCategory } = require('./categoryController');
const { validateAiMeta } = require('../helpers/aiMetaValidator');
const { persistAiMeta } = require('../helpers/aiMetaSqlWriter');
const { getDisplayableMediaFilter } = require('../helpers/displayableMediaFilters');

// NAS/CDN base that turns a stored NAS path into a fetchable URL (config.json cdn.baseUrl
// or CDN_BASE_URL env; e.g. https://media.globussoft.com/pas-prod/stream). Mirrors the
// creativeScoreController `served()` helper and the FE resolveNasUrl.
const CDN_BASE = ((config && config.cdn && config.cdn.baseUrl) || process.env.CDN_BASE_URL || '').replace(/\/+$/, '');

/**
 * Turn a stored creative value into a fetchable http(s) URL. Already-absolute values
 * pass through untouched (youtube). NAS-relative paths (e.g. `/PowerAdspy/n2/native/adImage/…`)
 * get their mount prefix stripped and the CDN base prepended, so the classifier receives
 * the resolvable `https://media.globussoft.com/pas-prod/stream/…` path directly instead of
 * having to rewrite `/PowerAdspy/n2/` itself (Issue "Minor" in the backend fix prompt).
 * Returns null for empty input so callers can emit a clean `null`.
 */
function served(v) {
  if (!v || typeof v !== 'string') return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (!CDN_BASE) return v;
  const t = v.replace(/^\/?(PowerAdspy\/n2|PowerAdspy-Dev|pas-dev\/stream|pas-prod\/stream)\//i, '/');
  return CDN_BASE + (t.startsWith('/') ? t : '/' + t);
}

/**
 * Exact-ID ad lookup shared by newCatInsertion (to update) and getAdCategory (to read
 * back). Some platforms index the id as a long (facebook_ad.id), others as a keyword
 * (google.ad_id) — so we try both the string and numeric term. Returns the first ES hit
 * (with `_source`) or null.
 *
 * @param {object} esForPlat  the platform's ES client (service.db.elastic)
 * @param {string} esIndex    resolved index name
 * @param {string} idField    the ad's primary-key field for this platform
 * @param {string|number} adId
 */
async function findAdDoc(esForPlat, esIndex, idField, adId) {
  const adIdStr      = String(adId);
  const adIdNum      = Number(adId);
  const adIdNumValid = !Number.isNaN(adIdNum) && String(adIdNum) === adIdStr;
  const shouldClauses = [{ term: { [idField]: adIdStr } }];
  if (adIdNumValid) shouldClauses.push({ term: { [idField]: adIdNum } });

  const adSearch = await esForPlat.search({
    index: esIndex,
    body:  { query: { bool: { should: shouldClauses, minimum_should_match: 1 } } },
  });
  const adHits = (adSearch.hits || adSearch.body?.hits)?.hits || [];
  return adHits[0] || null;
}

/**
 * Write a validated `ai_meta` object onto the ad's ES doc under the `ai` field
 * (see AI_META_API_PAYLOAD_SPEC.md §7 mapping).
 *
 * Idempotency: the whole `ai` object is REPLACED on every write (a painless assign,
 * not a doc-merge) so re-sending overwrites prior labels and stale sub-fields from an
 * older payload shape are dropped. v1.4 removed the `status` field, so there is no
 * longer a partial/status-only path — every payload is a completed enrichment.
 */
async function writeAiMeta(esForPlat, esIndex, docId, normalized) {
  await esForPlat.update(withEsType(esForPlat, {
    index: esIndex,
    id:    docId,
    body: {
      script: {
        source: 'ctx._source.ai = params.ai;',
        lang:   'painless',
        params: { ai: normalized },
      },
    },
    refresh: 'wait_for',
  }));
}

/**
 * Mirror an ai_meta-sourced category onto the ad's ES doc under the canonical
 * literal dotted `${platform}.category` / `${platform}.subCategory` keys plus the
 * flat 4-char `category_id` / 8-char `subCategory_id` codes and the legacy
 * `confidence_score: 0` (marking a certain/assigned category). This is byte-for-byte
 * the same `updateDoc` shape newCatInsertion writes, so the feed reads it identically.
 * Idempotent doc-merge. Only called when the ai_meta object carries a category (+id).
 *
 * @param {object} cat  { category, subCategory, categoryId, subCategoryId }
 */
async function mirrorCategoryToEs(esForPlat, esIndex, docId, platform, cat) {
  await esForPlat.update(withEsType(esForPlat, {
    index: esIndex,
    id:    docId,
    body: {
      doc: {
        category_id:                 cat.categoryId ?? null,
        [`${platform}.category`]:    cat.category,
        subCategory_id:              cat.subCategoryId ?? null,
        [`${platform}.subCategory`]: cat.subCategory ?? null,
        confidence_score:            0,
      },
    },
    refresh: 'wait_for',
  }));
}

/**
 * Conflict raised by `syncMasterCategory` when the incoming category/subcategory
 * name↔id pair contradicts what the master `category` taxonomy index already holds.
 * Carries the exact legacy response payload so callers reproduce the old 500 body.
 */
class CategoryTaxonomyConflict extends Error {
  constructor(payload) {
    super(payload.error || 'category taxonomy conflict');
    this.name = 'CategoryTaxonomyConflict';
    this.payload = payload;
  }
}

/**
 * Insert/patch the shared master `category` taxonomy index (the category dropdown:
 * `{ category, cat_id, platforms[], subcategory:[{ sub_cat, sub_cat_id, platforms[] }] }`).
 * Extracted verbatim from newCatInsertion so BOTH the classification POST and the
 * /ai-meta path (v1.6: ids now arrive inside ai_meta) maintain the taxonomy identically.
 *
 * @param {object} esClient  the ES client that owns the shared `category` index (gdn)
 * @param {object} p         { category, catId, subCategory, subCategoryId, platform }
 * @returns {Promise<{ message: string }>}
 * @throws  {CategoryTaxonomyConflict} on a name↔id mismatch (legacy 500 payload)
 */
async function syncMasterCategory(esClient, { category, catId, subCategory, subCategoryId, platform }) {
  const existResult = await esClient.search({
    index: 'category',
    body: {
      query: {
        bool: {
          should: [
            { term: { 'category.keyword': category } },
            { term: { 'cat_id.keyword': catId } },
          ],
          minimum_should_match: 1,
        },
      },
    },
  });

  const hits = (existResult.hits || existResult.body?.hits)?.hits || [];
  let message = 'Category/Subcategory successfully processed';

  if (hits.length > 0) {
    const doc    = hits[0];
    const docId  = doc._id;
    const source = doc._source;

    const catIdExists   = source.cat_id  === catId;
    const catNameExists = source.category === category;

    if (catIdExists && !catNameExists) {
      throw new CategoryTaxonomyConflict({
        code: 500,
        error: "Category ID exists but category name doesn't match",
        cat_id: catId,
        expected_category: source.category,
        received_category: category,
      });
    }
    if (!catIdExists && catNameExists) {
      throw new CategoryTaxonomyConflict({
        code: 500,
        error: "Category name exists but category ID doesn't match",
        category,
        expected_cat_id: source.cat_id,
        received_cat_id: catId,
      });
    }

    // Add platform to category if missing
    if (!((source.platforms || []).includes(platform))) {
      await esClient.update(withEsType(esClient, {
        index: 'category',
        id:    docId,
        body: {
          script: {
            source: "if (!ctx._source.platforms.contains(params.platform)) { ctx._source.platforms.add(params.platform); }",
            lang:   'painless',
            params: { platform },
          },
        },
      }));
    }

    // Handle subcategory
    if (subCategory && subCategoryId) {
      const subcategories   = source.subcategory || [];
      let subcategoryExists = false;

      for (const sub of subcategories) {
        if (sub.sub_cat_id === subCategoryId) {
          if (sub.sub_cat !== subCategory) {
            throw new CategoryTaxonomyConflict({ code: 500, error: "Subcategory ID exists but subcategory name doesn't match" });
          }
          subcategoryExists = true;
          if (!((sub.platforms || []).includes(platform))) {
            await esClient.update(withEsType(esClient, {
              index: 'category',
              id:    docId,
              body: {
                script: {
                  source: `
                    if (ctx._source.subcategory == null) { ctx._source.subcategory = []; }
                    boolean found = false;
                    for (sub in ctx._source.subcategory) {
                      if (sub.sub_cat_id == params.sub_cat_id) {
                        if (!sub.platforms.contains(params.platform)) { sub.platforms.add(params.platform); }
                        found = true;
                      }
                    }
                    if (!found) { ctx._source.subcategory.add(params.newSub); }
                  `,
                  lang:   'painless',
                  params: {
                    sub_cat_id: subCategoryId,
                    platform,
                    newSub: { sub_cat: subCategory, sub_cat_id: subCategoryId, platforms: [platform] },
                  },
                },
              },
            }));
          }
          break;
        } else if (sub.sub_cat === subCategory) {
          throw new CategoryTaxonomyConflict({ code: 500, error: "Subcategory name exists but subcategory ID doesn't match" });
        }
      }

      if (!subcategoryExists) {
        await esClient.update(withEsType(esClient, {
          index: 'category',
          id:    docId,
          body: {
            script: {
              source: `
                if (ctx._source.subcategory == null) { ctx._source.subcategory = []; }
                boolean found = false;
                for (sub in ctx._source.subcategory) {
                  if (sub.sub_cat_id == params.newSub.sub_cat_id) { found = true; break; }
                }
                if (!found) { ctx._source.subcategory.add(params.newSub); }
              `,
              lang:   'painless',
              params: {
                newSub: { sub_cat: subCategory, sub_cat_id: subCategoryId, platforms: [platform] },
              },
            },
          },
        }));
        message = 'Subcategory inserted successfully';
      } else {
        message = 'Category and Subcategory already exist';
      }
    } else {
      message = 'Category already exists';
    }
  } else {
    // ── Insert new category ──────────────────────────────────────────
    const docData = { category, cat_id: catId, platforms: [platform] };
    if (subCategory && subCategoryId) {
      docData.subcategory = [{ sub_cat: subCategory, sub_cat_id: subCategoryId, platforms: [platform] }];
    }
    await esClient.index(withEsType(esClient, { index: 'category', body: docData, refresh: 'wait_for' }));
    message = 'New category' + (subCategory ? ' and subcategory' : '') + ' inserted successfully';
  }

  return { message };
}

/**
 * Apply an ai_meta-sourced category to ES (v1.6: the category name + 4/8-char ids
 * now live inside ai_meta). Two writes, both idempotent:
 *   1. maintain the shared master `category` taxonomy index (via `syncMasterCategory`
 *      on the gdn ES client), and
 *   2. mirror the flat codes + dotted names onto the ad doc (`mirrorCategoryToEs`).
 * Non-fatal: returns a status object; a taxonomy name↔id conflict or an ES error is
 * captured (not thrown), so the AI-Meta write it accompanies still succeeds.
 * Returns null when the payload has no category to apply.
 *
 * @returns {Promise<{taxonomy, mirrored, taxonomy_error?, mirror_error?}|null>}
 */
async function applyAiMetaCategoryToEs({ gdnEs, platEs, esIndex, docId, platform, normalized, log }) {
  if (!normalized || !normalized.category || !normalized.category_id) return null;
  const status = { taxonomy: null, mirrored: false };

  if (gdnEs) {
    try {
      const { message } = await syncMasterCategory(gdnEs, {
        category:      normalized.category,
        catId:         normalized.category_id,
        subCategory:   normalized.sub_category,
        subCategoryId: normalized.subcategory_id,
        platform,
      });
      status.taxonomy = message;
    } catch (taxErr) {
      const isConflict = taxErr instanceof CategoryTaxonomyConflict;
      status.taxonomy = isConflict ? 'conflict' : 'error';
      status.taxonomy_error = isConflict ? taxErr.payload.error : taxErr.message;
      log?.warn?.(`[aiMetaCategory] taxonomy sync failed for platform=${platform}: ${status.taxonomy_error}`);
    }
  }

  try {
    await mirrorCategoryToEs(platEs, esIndex, docId, platform, {
      category:      normalized.category,
      subCategory:   normalized.sub_category,
      categoryId:    normalized.category_id,
      subCategoryId: normalized.subcategory_id,
    });
    status.mirrored = true;
  } catch (mirrorErr) {
    status.mirror_error = mirrorErr.message;
    log?.warn?.(`[aiMetaCategory] ES mirror failed for platform=${platform}: ${mirrorErr.message}`);
  }

  return status;
}

/**
 * Resolve a platform's ES index name from config.json (via the shared networks
 * config), instead of reading XX_ELASTIC_INDEX env vars directly. networksConfig
 * already layers config.json → env → built-in default for every network, and
 * exposes TikTok's index under `elastic_tiktok` rather than `elastic`.
 *
 * @param {string} platform network slug (matches PLATFORM_CONFIG keys)
 * @returns {string|undefined} the configured index name
 */
function resolveIndex(platform) {
  const dbCfg = networksConfig[platform]?.database;
  return (dbCfg?.elastic || dbCfg?.elastic_tiktok)?.index;
}

// Per-platform ES field mapping for getDescriptionDetails + newCatInsertion ad update
const PLATFORM_CONFIG = {
  facebook: {
    service:      'facebook',
    index:        resolveIndex('facebook'),
    idField:      'facebook_ad.id',
    textField:    'facebook_ad_variants.text_exactly',
    titleField:   'facebook_ad_variants.title_exactly',
    ownerField:   'facebook_ad_post_owners.post_owner_name',
    ocrField:     'facebook_ad_variants.image_ocr_exactly',
    newsFeedField:'facebook_ad_variants.newsfeed_description_exactly',
    typeField:    'facebook_ad.type',
    imageNasField:'new_nas_image_url',
    thumbField:   'Thumbnail',
    destPageField:'facebook_ad_html_lander_content.html_dc_blackhat_lander_text',
  },
  instagram: {
    service:      'instagram',
    index:        resolveIndex('instagram'),
    idField:      'instagram_ad.id',
    textField:    'instagram_ad_translation.ad_text',
    titleField:   'instagram_ad_translation.ad_title',
    ownerField:   'instagram_ad_post_owners.post_owner_name',
    ocrField:     'instagram_ad_variants.image_ocr_exactly',
    newsFeedField:'instagram_ad_translation.news_feed_description',
    typeField:    'instagram_ad.type',
    imageNasField:'new_nas_image_url',
    thumbField:   'thumbnail',
  },
  youtube: {
    service:      'youtube',
    index:        resolveIndex('youtube'),
    idField:      'ad_id',
    categoryField:    'category',
    subCategoryField: 'subCategory',
    textField:    'ad_text',
    titleField:   'ad_title',
    ownerField:   'post_owner',
    ocrField:     'image_ocr',
    newsFeedField:'newsfeed_description',
    typeField:    'ad_type',
    imageNasField:'new_nas_image_url',
    thumbField:   'thumbnail_url',
  },
  gdn: {
    service:      'gdn',
    index:        resolveIndex('gdn'),
    idField:      'gdn_ad.id',
    textField:    'gdn_ad_variants.text',
    titleField:   'gdn_ad_variants.title',
    ownerField:   'gdn_ad_post_owners.post_owner_name',
    ocrField:     'gdn_ad_variants.image_ocr',
    newsFeedField:'gdn_ad_variants.newsfeed_description',
    typeField:    'gdn_ad.type',
    imageNasField:'new_nas_image_url',
    thumbField:   null,
    destPageField:'gdn_ad_html_lander_content.html_dc_blackhat_lander_text',
    // GDN is 100% type IMAGE in production (live-verified: 129,927/129,927 docs) — it
    // has no real TEXT-type ads despite the field existing in its schema. The ~24% of
    // GDN ads that do carry a non-empty ad_text are incidental scraped banner
    // boilerplate ("Ads by  Send feedback", "Click here to C0ntinue"), not real ad
    // copy, and ad_title is populated on <1% of ads. Per product direction, GDN
    // shouldn't send any of ad_text/ad_title/news_feed_description to the classifier.
    suppressTextFields: true,
  },
  google: {
    service:      'google',
    index:        resolveIndex('google'),
    idField:      'ad_id',          // ad lookup key (newCatInsertion matches on this)
    // google_ads_data is the only flat index with BOTH a distinct internal PK (`id`)
    // and the Google ad identifier (`ad_id`). getDescriptionDetails paginates on the
    // monotonic `id` and surfaces `ad_id` separately; everywhere else id === ad_id.
    descIdField:  'id',             // getDescriptionDetails pagination + response `id`
    adIdField:    'ad_id',          // getDescriptionDetails response `ad_id`
    textField:    'ad_text',
    titleField:   'ad_title',
    ownerField:   'post_owner',
    ocrField:     'image_ocr',
    newsFeedField:'newsfeed_description',
    // The google ES doc's ad-type field is the flat `type` key (e.g. "IMAGE"),
    // NOT `ad_type` — confirmed against GoogleSearchQueryBuilder.js/adCountController.js
    // (both query `type`) and the insertion pipeline, which writes `type: 'IMAGE'`
    // verbatim into `_source` (the field's `lowercase_normalizer` only affects the
    // indexed/searchable term, not the stored `_source` value read here).
    typeField:    'type',
    imageNasField:'new_nas_image_url',
    thumbField:   null,
    // Google's own type enum is IMAGE/TEXT/ORGANIC SEARCH (validate.js), but ORGANIC
    // SEARCH is already excluded entirely by the displayable-media filter above (its
    // GOOGLE clause has an unconditional `match_phrase: type:'ORGANIC SEARCH'`
    // exclusion) and isn't a real ad type in the frontend's Ad Type filter (only
    // "Image"/"text" list `google` in sduiConfig.json) — so only IMAGE and TEXT ads
    // ever reach this feed. TEXT ads have no creative image — `ad_image` should still
    // be emitted as `null` for them (instead of the key being omitted entirely) so the
    // classifier can distinguish "checked, no image" from "field never sent".
    // Deliberately NOT falling back to `screenshot_url`/`png_file`: those are a
    // Lighthouse/cloaking-detection screenshot of the ad's DESTINATION website
    // (`api_gtext/.../CronController.php::saveScreenShotUsingGAPI`, `BlackhatController.php`,
    // `docs/GOOGLE_LANDER_MANIFEST.md`) — never the ad creative. Feeding that into
    // ad_image would show the classifier an unrelated site's imagery and manufacture
    // false `colors`/`caption` mismatches (the AI-meta caption field exists specifically
    // to catch real ones).
    imageOrigField:  'image_url_original',
    alwaysEmitImage: true,
  },
  native: {
    service:      'native',
    index:        resolveIndex('native'),
    idField:      'native_ad.id',
    textField:    'native_ad_translation.ad_text',
    titleField:   'native_ad_translation.ad_title',
    ownerField:   'native_ad_post_owners.post_owner_name',
    ocrField:     'native_ad_variants.image_ocr_exactly',
    newsFeedField:'native_ad_translation.news_feed_description',
    typeField:    'native_ad.type',
    imageNasField:'native_ad.nas_url',
    // Fallback creative source when the NAS copy was never stored (Issue 3): the
    // original scraped image URL is kept top-level on the native ES doc.
    imageOrigField:'image_url_original',
    thumbField:   null,
    destPageField:'native_ad_html_lander_content.html_dc_blackhat_lander_text',
  },
  linkedin: {
    service:      'linkedin',
    index:        resolveIndex('linkedin'),
    idField:      'ad_id',
    textField:    'ad_text',
    titleField:   'ad_title',
    ownerField:   'post_owner',
    ocrField:     'image_ocr',
    newsFeedField:'newsfeed_description',
    typeField:    'ad_type',
    imageNasField:'new_nas_image_url',
    // LinkedIn has no `Thumbnail` field — VIDEO ads store their thumbnail in
    // `ad_video` (confirmed against LinkedinSearchQueryBuilder.js's EXTRA_CONDITION,
    // which requires `ad_video` to exist/be non-placeholder for VIDEO ads).
    thumbField:   'ad_video',
  },
  quora: {
    service:      'quora',
    index:        resolveIndex('quora'),
    idField:      'quora_ad.id',
    textField:    'quora_ad_translation.ad_text',
    titleField:   'quora_ad_translation.ad_title',
    ownerField:   'quora_ad_post_owners.post_owner_name',
    ocrField:     'quora_ad_variants.image_ocr_exactly',
    newsFeedField:'quora_ad_translation.news_feed_description',
    typeField:    'quora_ad.type',
    imageNasField:'new_nas_image_url',
    thumbField:   'thumbnail',
  },
  reddit: {
    service:      'reddit',
    index:        resolveIndex('reddit'),
    idField:      'reddit_ad.id',
    textField:    'reddit_ad_variants.text',
    titleField:   'reddit_ad_variants.title',
    ownerField:   'reddit_ad_post_owners.post_owner_name',
    ocrField:     'reddit_ad_variants.image_ocr',
    newsFeedField:'reddit_ad_variants.newsfeed_description',
    typeField:    'reddit_ad.type',
    imageNasField:'new_nas_image_url',
    thumbField:   'Thumbnail',
  },
  pinterest: {
    service:      'pinterest',
    index:        resolveIndex('pinterest'),
    idField:      'pinterest_ad.id',
    textField:    'pinterest_ad_variants.text',
    titleField:   'pinterest_ad_variants.title',
    ownerField:   'pinterest_ad_post_owners.post_owner_name',
    ocrField:     'pinterest_ad_variants.image_ocr_exactly',
    newsFeedField:'pinterest_ad_variants.newsfeed_description',
    typeField:    'pinterest_ad.type',
    imageNasField:'new_nas_image_url',
    thumbField:   'thumbnail',
  },
  tiktok: {
    service:      'tiktok',
    index:        resolveIndex('tiktok'),
    idField:      'ad_id',
    textField:    'ad_text',
    titleField:   'ad_title',
    ownerField:   'post_owner',
    ocrField:     'image_ocr',
    newsFeedField:'newsfeed_description',
    typeField:    'ad_type',
    imageNasField:'new_nas_image_url',
    thumbField:   'thumbnail',
  },
};

/**
 * MySQL fallback config for getDescriptionDetails, mirroring each network's own
 * adDetailController.js join (`<net>_ad` ⟶ `<net>_ad_variants` via `<net>_ad_id`,
 * ⟶ `<net>_ad_post_owners` via `post_owner_id`). Google's tables are prefixed
 * `google_text_ad*` rather than `google_ad*`; youtube's variants table has no
 * `image_url` column (video-only creative), only `thumbnail_url`. TikTok has no
 * SQL table carrying ad_text/ad_title/newsfeed_description/image (confirmed via
 * its controllers — only analytics/country-info tables exist there), so it has
 * no fallback and stays ES-only.
 *
 * @param {string} platform
 * @returns {{adTable, variantsTable, variantsFk, ownerTable, imageCol}|null}
 */
function sqlFallbackConfigFor(platform) {
  if (platform === 'tiktok') return null;
  const prefix = platform === 'google' ? 'google_text_ad' : `${platform}_ad`;
  return {
    adTable:       prefix,
    variantsTable: `${prefix}_variants`,
    variantsFk:    `${prefix}_id`,
    ownerTable:    `${prefix}_post_owners`,
    imageCol:      platform === 'youtube' ? 'thumbnail_url' : 'image_url',
  };
}

/**
 * Batch-fetch the SQL fallback row (ad_title/ad_text/news_feed_description/
 * post_owner_name/ad_image_url) for a set of ad ids. Returns a Map keyed by
 * the ad's SQL PK (as a string) so callers can look up by `row.id`.
 */
async function fetchSqlDescriptionFallback(sqlClient, sqlCfg, ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const query = `
    SELECT
      ${sqlCfg.adTable}.id AS _fallback_id,
      ${sqlCfg.variantsTable}.title AS ad_title,
      ${sqlCfg.variantsTable}.text AS ad_text,
      ${sqlCfg.variantsTable}.newsfeed_description AS news_feed_description,
      ${sqlCfg.variantsTable}.${sqlCfg.imageCol} AS ad_image_url,
      ${sqlCfg.ownerTable}.post_owner_name AS post_owner_name
    FROM ${sqlCfg.adTable}
    LEFT JOIN ${sqlCfg.variantsTable} ON ${sqlCfg.adTable}.id = ${sqlCfg.variantsTable}.${sqlCfg.variantsFk}
    LEFT JOIN ${sqlCfg.ownerTable} ON ${sqlCfg.adTable}.post_owner_id = ${sqlCfg.ownerTable}.id
    WHERE ${sqlCfg.adTable}.id IN (${placeholders})
  `;
  const rows = await sqlClient.query(query, ids);
  const map = new Map();
  for (const r of rows) map.set(String(r._fallback_id), r);
  return map;
}

/**
 * GET /getDescriptionDetails
 *
 * Unified replacement for the per-platform Laravel getDescriptionDetails endpoints.
 * Queries the platform-specific ES index for ads with id > exVal, returns
 * a normalised array used for AI category mapping.
 *
 * Each row includes a `cursor` field that is the stable, monotonic value to pass
 * as the next `exVal`. For most platforms `cursor === id`. For Google the index
 * has a distinct internal PK (`id`) and a public `ad_id`; `cursor` is the internal
 * `id` so pagination is stable, while `ad_id` is returned separately for ad lookup.
 *
 * Query/body params: platform (required), exVal (default 0), limit (default 150)
 */
async function getDescriptionDetails(req, res) {
  const platform = (req.query.platform || req.body.platform || '').toLowerCase().trim();
  const exVal    = Number(req.query.exVal  || req.body.exVal  || 0);
  const limit    = Number(req.query.limit  || req.body.limit  || 150);

  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) {
    return res.status(400).json({
      code: 400,
      message: `Unsupported platform: ${platform}. Valid: ${Object.keys(PLATFORM_CONFIG).join(', ')}`,
    });
  }

  const service = serviceRegistry.getService(cfg.service);
  if (!service?.db?.elastic) {
    return res.status(503).json({ code: 503, message: `ES not available for platform: ${platform}` });
  }

  try {
    // GDN is on gdn_search_mix_v2 — resolve the env-correct index from the live ES client, not the config-immune static map.
    const esIndex = ((cfg.service === 'gdn' || cfg.service === 'native') && service.db.elastic.indexName) ? service.db.elastic.indexName : cfg.index;
    // Pagination cursor: usually the same field as the ad lookup key, but Google
    // paginates on its distinct internal PK (`id`) while looking ads up by `ad_id`.
    const pageField = cfg.descIdField || cfg.idField;
    // Displayable-media gate: skip ads the UI itself hides for broken/missing/
    // placeholder media (same clauses each network's own SearchMixQueryBuilder
    // always applies — see displayableMediaFilters.js). Every ad this feed
    // returns gets sent through the external category/AI-meta classifier, so
    // an undisplayable ad is pure wasted classification spend.
    const mediaFilter = getDisplayableMediaFilter(platform);
    const boolQuery = { must: [{ range: { [pageField]: { gt: exVal } } }] };
    if (mediaFilter) boolQuery.filter = mediaFilter;
    const esResult = await service.db.elastic.search({
      index: esIndex,
      body: {
        from: 0,
        size: limit,
        sort: [{ [pageField]: 'asc' }],
        query: { bool: boolQuery },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits || [];
    const finalArray = hits.map(hit => {
      const src = hit._source;
      const row = {};

      row.id                    = src[pageField];
      // Stable pagination cursor: the exact value the caller should send back as
      // the next `exVal`. This is always the field the ES sort/range used.
      row.cursor                = src[pageField];
      // Only platforms whose index keeps id and ad_id distinct (Google) carry both.
      if (cfg.adIdField) row.ad_id = src[cfg.adIdField] ?? null;
      // GDN sends no ad-copy text at all (see PLATFORM_CONFIG.gdn.suppressTextFields) —
      // it has no real TEXT-type ads, and the incidental text some IMAGE ads carry is
      // scraped banner boilerplate, not classifiable ad copy.
      if (!cfg.suppressTextFields) {
        row.ad_text               = src[cfg.textField]     ?? null;
        row.ad_title              = src[cfg.titleField]    ?? null;
        row.news_feed_description = src[cfg.newsFeedField] ?? null;
      }
      row.post_owner_name       = src[cfg.ownerField]    ?? null;

      // Read-back of the stored AI/human category so the classifier can verify a
      // prior newCatInsertion write actually attached and skip already-categorised
      // ads (Issue 1). Fields mirror exactly what newCatInsertion writes onto the ad:
      // the literal dotted `${platform}.category` / `${platform}.subCategory` keys plus
      // the flat `category_id` / `subCategory_id` / `confidence_score`.
      row.category      = src[`${platform}.category`]    ?? null;
      row.sub_category  = src[`${platform}.subCategory`] ?? null;
      row.category_id   = src.category_id    ?? null;
      row.subcategory_id = src.subCategory_id ?? null;
      if (src.confidence_score !== undefined) row.confidence_score = src.confidence_score;
      // Read-back of any stored AI-Meta enrichment so the classifier can verify a prior
      // /ai-meta (or newCatInsertion+ai_meta) write and skip already-enriched ads.
      row.ai = src.ai ?? null;

      if (src[cfg.ocrField] !== undefined) row.ocr = src[cfg.ocrField];
      if (cfg.destPageField && src[cfg.destPageField] !== undefined) {
        row.destination_page_text = src[cfg.destPageField];
      }

      const adType   = src[cfg.typeField] || '';
      const nasValue = src[cfg.imageNasField] || '';
      // Original scraped image URL, where the platform keeps one (native). Surfaced
      // both as a fallback for ad_image and on its own so the classifier can recover
      // backlog ads whose NAS creative was never stored (Issue 3).
      const origValue = cfg.imageOrigField ? (src[cfg.imageOrigField] || '') : '';
      if (cfg.imageOrigField) row.image_url_original = served(origValue) ?? null;

      if (adType === 'IMAGE' || cfg.alwaysEmitImage) {
        // Prefer the stored NAS copy; fall back to the original scraped URL when the
        // NAS creative is missing. `cfg.alwaysEmitImage` (google) only widens WHEN this
        // runs (so a TEXT-type ad gets an explicit `ad_image: null` instead of the key
        // being omitted) — it intentionally has no extra fallback source, since google's
        // only other image-shaped fields (`screenshot_url`/`png_file`) are landing-page
        // screenshots, not the ad creative. served() returns a resolvable CDN URL (no
        // more client-side /PowerAdspy/n2 rewrite).
        row.ad_image = served(nasValue) ?? served(origValue) ?? null;
      }
      if (adType === 'VIDEO' && cfg.thumbField) {
        const thumb = src[cfg.thumbField] || '';
        row.thumbnail = served(thumb) ?? null;
      }

      return row;
    });

    // SQL fallback: ES is a downstream sync of MySQL, so an ad whose ES doc hasn't
    // (yet) received text/title/description/owner/image carries the real value in
    // MySQL. Only fills fields ES left null — never overwrites an ES-derived value.
    const sqlCfg = sqlFallbackConfigFor(platform);
    if (sqlCfg && service.db.sql) {
      try {
        // Blank, not falsy: a legit value like ad_text `"0"` must never be treated
        // as missing (a plain `!value` check would wrongly overwrite/skip it).
        const isBlank = (v) => v === null || v === undefined || v === '';
        // GDN never gets ad_text/ad_title/news_feed_description backfilled either —
        // those keys don't exist on the row at all for gdn (suppressTextFields), so
        // they must be excluded from both the "does this row need a SQL lookup" check
        // and the merge, or the fallback would silently reintroduce them from MySQL.
        const wantsTextFields = !cfg.suppressTextFields;
        const idsNeedingFallback = [...new Set(
          finalArray
            .filter(row => (wantsTextFields && (isBlank(row.ad_text) || isBlank(row.ad_title) || isBlank(row.news_feed_description))) || isBlank(row.post_owner_name) || row.ad_image === null)
            .map(row => row.id)
        )];
        if (idsNeedingFallback.length) {
          const fallbackMap = await fetchSqlDescriptionFallback(service.db.sql, sqlCfg, idsNeedingFallback);
          for (const row of finalArray) {
            const sqlRow = fallbackMap.get(String(row.id));
            if (!sqlRow) continue;
            if (wantsTextFields) {
              if (isBlank(row.ad_text) && !isBlank(sqlRow.ad_text)) row.ad_text = sqlRow.ad_text;
              if (isBlank(row.ad_title) && !isBlank(sqlRow.ad_title)) row.ad_title = sqlRow.ad_title;
              if (isBlank(row.news_feed_description) && !isBlank(sqlRow.news_feed_description)) row.news_feed_description = sqlRow.news_feed_description;
            }
            if (isBlank(row.post_owner_name) && !isBlank(sqlRow.post_owner_name)) row.post_owner_name = sqlRow.post_owner_name;
            if (row.ad_image === null && !isBlank(sqlRow.ad_image_url)) row.ad_image = served(sqlRow.ad_image_url);
          }
        }
      } catch (sqlErr) {
        service.log?.warn(`[getDescriptionDetails] SQL fallback failed for platform=${platform}: ${sqlErr.message}`);
      }
    }

    return res.status(200).json(finalArray);

  } catch (err) {
    service.log?.error(`[getDescriptionDetails] platform=${platform} error: ${err.message}`);
    return res.status(500).json({ code: 500, message: 'Some Error Occured', error: err.message });
  }
}

/**
 * Adds an explicit mapping `type` to index/update params only when the target
 * ES server is 6.x. The ES7 JS client (this project ships 7.17) defaults to
 * typeless write URLs (e.g. POST /index/_update/{id}); a 6.8 server rejects
 * those as an invalid type name ("type name can't start with '_', found:
 * [_update]"), while a 7+/8 server rejects an explicit type. `esMajor` is
 * surfaced per-connection by DatabaseManager. When the version is unknown we
 * fall back to the 6.x-safe form, since most of our clusters are 6.8.
 *
 * The type name must match how each 6.8 index was actually mapped, or a scripted
 * update addresses a non-existent type and fails with `document_missing_exception`
 * (search sends no type, so it silently succeeds — masking the mismatch). Verified
 * live: the shared master `category` index is mapped under `_doc`, while every
 * per-network ad index (`search_mix`, `<net>_search_mix`, `<net>_ads_data`) is
 * mapped under `doc`. `INDEX_TYPE` records that; unlisted indices default to `doc`.
 *
 * @param {object} esConn  the connection object (service.db.elastic)
 * @param {object} params  index/update params (must carry `index`)
 * @param {string} [typeName] explicit override; when omitted, resolved from the index
 */
const INDEX_TYPE = { category: '_doc' };

function withEsType(esConn, params, typeName) {
  const major = esConn?.esMajor;
  if (major == null || major < 7) {
    const type = typeName ?? INDEX_TYPE[params.index] ?? 'doc';
    return { ...params, type };
  }
  return params;
}

/**
 * POST /newCatInsertion
 *
 * Unified replacement for the Laravel AdMetaDataController@newCatInsertion.
 * Inserts or updates a category in the master `category` ES index,
 * updates the ad's category fields in the platform's search_mix index,
 * then syncs to MongoDB sdui_config.
 *
 * Body: { platform, category, category_id, ad_id, sub_category?, subcategory_id? }
 */
async function newCatInsertion(req, res) {
  try {
    const {
      platform:      platformRaw,
      category,
      category_id,
      ad_id,
      sub_category:  subCategory,
      subcategory_id: subCategoryId,
      ai_meta:       aiMeta,
    } = req.body;

    const platform = (platformRaw || '').toLowerCase().trim();

    // ── Validation ──────────────────────────────────────────────────────
    const errors = [];
    if (!platform || !PLATFORM_CONFIG[platform])
      errors.push(`platform is required. Valid: ${Object.keys(PLATFORM_CONFIG).join(', ')}`);
    if (!category || typeof category !== 'string' || category.length < 5)
      errors.push('category is required and must be at least 5 characters');
    if (!category_id || String(category_id).length !== 4)
      errors.push('category_id is required and must be exactly 4 characters');
    if (!ad_id)
      errors.push('ad_id is required');
    if (subCategory && !subCategoryId)
      errors.push('subcategory_id is required when sub_category is present');
    if (subCategoryId && !subCategory)
      errors.push('sub_category is required when subcategory_id is present');
    if (subCategory && subCategory.length < 2)
      errors.push('sub_category must be at least 2 characters');
    if (subCategoryId && String(subCategoryId).length !== 8)
      errors.push('subcategory_id must be exactly 8 characters');
    if (subCategoryId && !String(subCategoryId).startsWith(String(category_id)))
      errors.push('subcategory_id must start with category_id');

    if (errors.length > 0) {
      return res.status(400).json({ code: 400, message: 'validation failed: ' + errors.join(', ') });
    }

    const catId     = String(category_id);
    const platCfg   = PLATFORM_CONFIG[platform];

    // Category field names follow {platform}.category / {platform}.subCategory for all platforms
    const categoryField    = `${platform}.category`;
    const subCategoryField = `${platform}.subCategory`;

    // GDN service ES is used for the shared `category` index
    const gdnService  = serviceRegistry.getService('gdn');
    // Platform-specific service for updating the ad in its own search_mix index
    const platService = serviceRegistry.getService(platCfg.service) || gdnService;

    if (!gdnService?.db?.elastic) {
      return res.status(503).json({ code: 503, message: 'ES not available' });
    }

    // ── Step 1: Upsert the master `category` taxonomy index (shared helper,
    //    also used by POST /ai-meta now that ids travel inside ai_meta). ──
    let message;
    try {
      ({ message } = await syncMasterCategory(gdnService.db.elastic, {
        category, catId, subCategory, subCategoryId, platform,
      }));
    } catch (taxErr) {
      if (taxErr instanceof CategoryTaxonomyConflict) {
        return res.status(taxErr.payload.code || 500).json(taxErr.payload);
      }
      throw taxErr;
    }

    // ── Step 2: Update the ad record in the platform's search_mix index ──
    const esForPlat = platService?.db?.elastic || gdnService.db.elastic;
    // Prefer the live ES client's indexName when available (handles gdn_search_mix_v2,
    // native_search_mix_v2, or any future index cutover), fall back to config.
    const esIndex = (esForPlat?.indexName) ? esForPlat.indexName : platCfg.index;
    let adUpdated = false;
    let adWarning = null;
    // Distinguishes what happened to the AD record (separate from the master-category
    // `message` above): the ad category was newly set ('inserted'), changed from a
    // previous value ('updated'), was already identical ('unchanged'), or the ad could
    // not be located ('not_found').
    let adCategoryStatus = 'not_found';
    let adPreviousCategory = null;
    let adDocId = null;   // captured for the optional ai_meta write below
    try {
      gdnService.log?.info(`[newCatInsertion] searching index="${esIndex}" idField="${platCfg.idField}" for ad_id=${ad_id} platform=${platform}`);

      const adHit = await findAdDoc(esForPlat, esIndex, platCfg.idField, ad_id);
      if (adHit) {
        adDocId = adHit._id;
        // Compare against the ad's current category to classify insert vs update vs no-op.
        const prevSrc = adHit._source || {};
        const prevCat = prevSrc[categoryField]    ?? null;
        const prevSub = prevSrc[subCategoryField] ?? null;
        adPreviousCategory = prevCat;
        const sameValue = prevCat === category && (prevSub ?? null) === (subCategory ?? null);
        adCategoryStatus = prevCat == null ? 'inserted' : (sameValue ? 'unchanged' : 'updated');

        const updateDoc = {
          category_id,
          [categoryField]:    category,
          subCategory_id:     subCategoryId || null,
          [subCategoryField]: subCategory   || null,
          // Mirrors legacy PHP: a human-assigned category is marked as certain.
          confidence_score:   0,
        };
        // Version-aware: 6.x needs type 'doc' (matches PHP: 'type' => 'doc'),
        // TikTok's ES 8.1 is typeless and would reject an explicit type.
        // A doc-merge update overwrites any prior category, so re-POSTing a
        // different category replaces the old one (Issue 1 acceptance criterion).
        await esForPlat.update(withEsType(esForPlat, {
          index: esIndex,
          id:    adHit._id,
          body:  { doc: updateDoc },
          refresh: 'wait_for',
        }));
        adUpdated = true;
        gdnService.log?.info(`[newCatInsertion] ${esIndex} ${adCategoryStatus} for ad_id=${ad_id}`);
      } else {
        adWarning = `ad_id=${ad_id} not found in ${esIndex}`;
        gdnService.log?.warn(`[newCatInsertion] ${adWarning} — skipping update`);
      }
    } catch (updateErr) {
      adCategoryStatus = 'error';
      adWarning = `update failed for ad_id=${ad_id}: ${updateErr.message}`;
      gdnService.log?.warn(`[newCatInsertion] ${adWarning}`);
    }

    // ── Step 2b: Optional AI-Meta enrichment (Option A) ─────────────────
    // Additive: when the caller includes an `ai_meta` object we validate + write it
    // onto the same ad doc's `ai` field. This never fails the category write — an
    // invalid ai_meta is reported back as `ai_meta_status='validation_error'` while
    // the category result stands. The dedicated POST /ai-meta endpoint (Option B) is
    // the strict path that 400s on invalid payloads.
    let aiMetaResult = null;
    if (aiMeta !== undefined && aiMeta !== null) {
      const { errors: aiErrors, normalized: aiNormalized, storedFields } = validateAiMeta(aiMeta);
      if (aiErrors.length > 0) {
        aiMetaResult = { ai_meta_status: 'validation_error', ai_meta_errors: aiErrors };
      } else if (!adDocId) {
        aiMetaResult = { ai_meta_status: 'ad_not_found' };
      } else {
        try {
          await writeAiMeta(esForPlat, esIndex, adDocId, aiNormalized);
          aiMetaResult = { ai_meta_status: 'stored', ai_meta_stored_fields: storedFields };
          gdnService.log?.info(`[newCatInsertion] ai_meta stored for ad_id=${ad_id}`);

          // Category on Option A is driven by the top-level classification (Step 1
          // taxonomy + Step 2 flat-code ad update) which runs on every request, so the
          // ai_meta category is not re-applied here — it would only duplicate that write.
          // Durable SQL copy + category dual-write (non-fatal — an ES success stands
          // even if SQL is unavailable or the AI-Meta table has not been created yet).
          const sqlResult = await persistAiMeta({
            sql:        platService?.db?.sql,
            network:    platform,
            adId:       ad_id,
            normalized: aiNormalized,
            logger:     gdnService.log,
          });
          aiMetaResult.ai_meta_sql = sqlResult;
        } catch (aiErr) {
          aiMetaResult = { ai_meta_status: 'error', ai_meta_error: aiErr.message };
          gdnService.log?.warn(`[newCatInsertion] ai_meta write failed for ad_id=${ad_id}: ${aiErr.message}`);
        }
      }
    }

    // ── Step 3: Sync to MongoDB sdui_config (fire-and-forget) ───────────
    setImmediate(async () => {
      try {
        let syncResponse = null;
        const fakeReq = { body: { cat_id: catId } };
        const fakeRes = {
          status: (code) => ({
            json: (body) => {
              syncResponse = { code, body };
            },
          }),
          json: (body) => { syncResponse = { code: 200, body }; },
        };
        await syncCategory(fakeReq, fakeRes);
        if (syncResponse?.code === 200) {
          gdnService.log?.info(`[newCatInsertion] MongoDB sdui_config synced for cat_id=${catId}`);
        } else {
          gdnService.log?.warn(`[newCatInsertion] MongoDB sync returned code=${syncResponse?.code} for cat_id=${catId}: ${JSON.stringify(syncResponse?.body)}`);
        }
      } catch (err) {
        gdnService.log?.warn(`[newCatInsertion] MongoDB sync failed for cat_id=${catId}: ${err.message}`);
      }
    });

    gdnService.log?.info(`[newCatInsertion] Processed ad_id=${ad_id}, category=${category}, sub=${subCategory}, updated=${adUpdated}, ad_status=${adCategoryStatus}`);
    const response = {
      code: 200,
      // `message` reflects the master-category/subcategory index (backward compatible).
      message,
      ad_id,
      updated: adUpdated,
      // `ad_status` reflects what happened to the AD record specifically, so the
      // classifier can tell "inserted" / "updated" / "unchanged" / "not_found" apart.
      ad_status: adCategoryStatus,
      ad_category: category,
      ad_sub_category: subCategory || null,
    };
    if (adPreviousCategory != null) response.previous_category = adPreviousCategory;
    if (adWarning) response.warning = adWarning;
    if (aiMetaResult) Object.assign(response, aiMetaResult);
    return res.status(200).json(response);

  } catch (err) {
    return res.status(500).json({ code: 500, error: err.message });
  }
}

/**
 * GET /getAdCategory?platform=<net>&ad_id=<id>
 *
 * Lightweight single-ad read-back so the classifier can verify a newCatInsertion
 * write attached without paging the whole getDescriptionDetails feed (Issue 1).
 * Returns the ad's currently-stored category/sub_category (+ ids + confidence_score),
 * matched on the same per-platform primary key newCatInsertion updates.
 */
async function getAdCategory(req, res) {
  const platform = (req.query.platform || req.body?.platform || '').toLowerCase().trim();
  const adId     = req.query.ad_id ?? req.body?.ad_id;

  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) {
    return res.status(400).json({
      code: 400,
      message: `Unsupported platform: ${platform}. Valid: ${Object.keys(PLATFORM_CONFIG).join(', ')}`,
    });
  }
  if (adId === undefined || adId === null || adId === '') {
    return res.status(400).json({ code: 400, message: 'ad_id is required' });
  }

  const service = serviceRegistry.getService(cfg.service);
  const es = service?.db?.elastic;
  if (!es) {
    return res.status(503).json({ code: 503, message: `ES not available for platform: ${platform}` });
  }

  const esIndex = es.indexName || cfg.index;
  try {
    const adHit = await findAdDoc(es, esIndex, cfg.idField, adId);
    if (!adHit) {
      return res.status(404).json({ code: 404, message: `ad_id=${adId} not found in ${esIndex}`, ad_id: adId, platform });
    }
    const src = adHit._source || {};
    return res.status(200).json({
      code:            200,
      platform,
      ad_id:           adId,
      category:        src[`${platform}.category`]    ?? null,
      sub_category:    src[`${platform}.subCategory`] ?? null,
      category_id:     src.category_id    ?? null,
      subcategory_id:  src.subCategory_id ?? null,
      confidence_score: src.confidence_score ?? null,
      ai:              src.ai ?? null,
    });
  } catch (err) {
    service.log?.error(`[getAdCategory] platform=${platform} ad_id=${adId} error: ${err.message}`);
    return res.status(500).json({ code: 500, message: 'Some Error Occured', error: err.message });
  }
}

/**
 * POST /ai-meta  (Option B — dedicated AI-Meta enrichment endpoint)
 *
 * Standalone, spec-conformant write path for AI-generated meta labels
 * (AI_META_API_PAYLOAD_SPEC.md §2/§3/§6). As of v1.6 the category classification
 * travels inside `ai_meta` (name + 4-char `category_id` + 8-char `subcategory_id`),
 * so this endpoint is now ALSO the category writer: when a category is present it
 * maintains the master `category` taxonomy index, mirrors the flat codes + names onto
 * the ad doc, and dual-writes to SQL — everything the classification POST does.
 *
 * Body: { ad_id, network, ai_meta:{…} }
 * Responses follow §6 exactly (success / 400 VALIDATION_ERROR / 404 AD_NOT_FOUND).
 */
async function insertAiMeta(req, res) {
  const body     = req.body || {};
  const adId     = body.ad_id;
  const platform = (body.network || body.platform || '').toLowerCase().trim();

  // ── Top-level validation (spec §2) ──────────────────────────────────
  const details = [];
  if (adId === undefined || adId === null || adId === '')
    details.push({ field: 'ad_id', message: 'ad_id is required' });
  if (!platform)
    details.push({ field: 'network', message: 'network is required' });
  else if (!PLATFORM_CONFIG[platform])
    details.push({ field: 'network', message: `'${platform}' is not a supported network. Valid: ${Object.keys(PLATFORM_CONFIG).join(', ')}` });
  if (body.ai_meta === undefined || body.ai_meta === null)
    details.push({ field: 'ai_meta', message: 'ai_meta is required' });

  // ai_meta field-level validation (spec §3)
  let normalized, storedFields, aiErrors = [];
  if (body.ai_meta !== undefined && body.ai_meta !== null) {
    ({ errors: aiErrors, normalized, storedFields } = validateAiMeta(body.ai_meta));
    details.push(...aiErrors);
  }

  if (details.length > 0) {
    return res.status(400).json({
      success: false,
      ad_id:   adId ?? null,
      error:   { code: 'VALIDATION_ERROR', message: 'Request validation failed', details },
    });
  }

  const cfg = PLATFORM_CONFIG[platform];
  const service = serviceRegistry.getService(cfg.service);
  const es = service?.db?.elastic;
  if (!es) {
    return res.status(503).json({ success: false, ad_id: adId, error: { code: 'ES_UNAVAILABLE', message: `ES not available for network: ${platform}` } });
  }
  const esIndex = es.indexName || cfg.index;

  try {
    const adHit = await findAdDoc(es, esIndex, cfg.idField, adId);
    if (!adHit) {
      return res.status(404).json({
        success: false,
        ad_id:   adId,
        error:   { code: 'AD_NOT_FOUND', message: `Ad with id '${adId}' does not exist` },
      });
    }

    await writeAiMeta(es, esIndex, adHit._id, normalized);
    service.log?.info(`[insertAiMeta] stored for ad_id=${adId} network=${platform}`);

    // Category (v1.6: name + ids inside ai_meta) — maintain the master `category`
    // taxonomy index and mirror the flat codes + names onto the ad doc. Non-fatal.
    const categorySync = await applyAiMetaCategoryToEs({
      gdnEs:      serviceRegistry.getService('gdn')?.db?.elastic,
      platEs:     es,
      esIndex,
      docId:      adHit._id,
      platform,
      normalized,
      log:        service.log,
    });

    // Durable SQL copy + category dual-write (non-fatal).
    const sqlResult = await persistAiMeta({
      sql:        service?.db?.sql,
      network:    platform,
      adId:       adId,
      normalized: normalized,
      logger:     service.log,
    });

    const out = {
      success: true,
      ad_id:   adId,
      message: 'AI-Meta labels stored successfully',
      stored_fields: storedFields,
      sql: sqlResult,
    };
    if (categorySync) out.category_sync = categorySync;
    return res.status(200).json(out);
  } catch (err) {
    service.log?.error(`[insertAiMeta] network=${platform} ad_id=${adId} error: ${err.message}`);
    return res.status(500).json({ success: false, ad_id: adId, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

module.exports = { getDescriptionDetails, newCatInsertion, getAdCategory, insertAiMeta };
