'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const networksConfig = require('../../../config/networks');
const { syncCategory } = require('./categoryController');

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
    ocrField:     'facebook_ad_variants.image_ocr',
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
    ocrField:     'instagram_ad_variants.image_ocr',
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
  },
  google: {
    service:      'google',
    index:        resolveIndex('google'),
    idField:      'ad_id',
    textField:    'ad_text',
    titleField:   'ad_title',
    ownerField:   'post_owner',
    ocrField:     'image_ocr',
    newsFeedField:'newsfeed_description',
    typeField:    'ad_type',
    imageNasField:'new_nas_image_url',
    thumbField:   null,
  },
  native: {
    service:      'native',
    index:        resolveIndex('native'),
    idField:      'native_ad.id',
    textField:    'native_ad_translation.ad_text',
    titleField:   'native_ad_translation.ad_title',
    ownerField:   'native_ad_post_owners.post_owner_name',
    ocrField:     'native_ad_variants.image_ocr',
    newsFeedField:'native_ad_translation.news_feed_description',
    typeField:    'native_ad.type',
    imageNasField:'native_ad.nas_url',
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
    thumbField:   'Thumbnail',
  },
  quora: {
    service:      'quora',
    index:        resolveIndex('quora'),
    idField:      'quora_ad.id',
    textField:    'quora_ad_translation.ad_text',
    titleField:   'quora_ad_translation.ad_title',
    ownerField:   'quora_ad_post_owners.post_owner_name',
    ocrField:     'quora_ad_variants.image_ocr',
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
    ocrField:     'pinterest_ad_variants.image_ocr',
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
 * GET /getDescriptionDetails
 *
 * Unified replacement for the per-platform Laravel getDescriptionDetails endpoints.
 * Queries the platform-specific ES index for ads with id > exVal, returns
 * a normalised array used for AI category mapping.
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
    const esResult = await service.db.elastic.search({
      index: esIndex,
      body: {
        from: 0,
        size: limit,
        sort: [{ [cfg.idField]: 'asc' }],
        query: {
          bool: {
            must: [{ range: { [cfg.idField]: { gt: exVal } } }],
          },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits || [];
    const finalArray = hits.map(hit => {
      const src = hit._source;
      const row = {};

      row.id                    = src[cfg.idField];
      row.ad_text               = src[cfg.textField]     ?? null;
      row.ad_title              = src[cfg.titleField]    ?? null;
      row.post_owner_name       = src[cfg.ownerField]    ?? null;
      row.news_feed_description = src[cfg.newsFeedField] ?? null;

      if (src[cfg.ocrField] !== undefined) row.ocr = src[cfg.ocrField];
      if (cfg.destPageField && src[cfg.destPageField] !== undefined) {
        row.destination_page_text = src[cfg.destPageField];
      }

      const adType   = src[cfg.typeField] || '';
      const nasValue = src[cfg.imageNasField] || '';

      if (adType === 'IMAGE') {
        row.ad_image = nasValue || null;
      }
      if (adType === 'VIDEO' && cfg.thumbField) {
        const thumb = src[cfg.thumbField] || '';
        row.thumbnail = thumb || null;
      }

      return row;
    });

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
 * @param {object} esConn  the connection object (service.db.elastic)
 * @param {object} params  index/update params
 * @param {string} typeName mapping type to use on 6.x (default 'doc')
 */
function withEsType(esConn, params, typeName = 'doc') {
  const major = esConn?.esMajor;
  if (major == null || major < 7) {
    return { ...params, type: typeName };
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

    // ── Step 1: Check if category exists in master category index ───────
    const existResult = await gdnService.db.elastic.search({
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
        return res.status(500).json({
          code: 500,
          error: "Category ID exists but category name doesn't match",
          cat_id: catId,
          expected_category: source.category,
          received_category: category,
        });
      }
      if (!catIdExists && catNameExists) {
        return res.status(500).json({
          code: 500,
          error: "Category name exists but category ID doesn't match",
          category,
          expected_cat_id: source.cat_id,
          received_cat_id: catId,
        });
      }

      // Add platform to category if missing
      if (!( (source.platforms || []).includes(platform) )) {
        await gdnService.db.elastic.update(withEsType(gdnService.db.elastic, {
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
              return res.status(500).json({ code: 500, error: "Subcategory ID exists but subcategory name doesn't match" });
            }
            subcategoryExists = true;
            if (!( (sub.platforms || []).includes(platform) )) {
              await gdnService.db.elastic.update(withEsType(gdnService.db.elastic, {
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
            return res.status(500).json({ code: 500, error: "Subcategory name exists but subcategory ID doesn't match" });
          }
        }

        if (!subcategoryExists) {
          await gdnService.db.elastic.update(withEsType(gdnService.db.elastic, {
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
      await gdnService.db.elastic.index(withEsType(gdnService.db.elastic, { index: 'category', body: docData, refresh: 'wait_for' }));
      message = 'New category' + (subCategory ? ' and subcategory' : '') + ' inserted successfully';
    }

    // ── Step 2: Update the ad record in the platform's search_mix index ──
    const esForPlat = platService?.db?.elastic || gdnService.db.elastic;
    // GDN is on gdn_search_mix_v2 — resolve the env-correct index from the live ES client, not the config-immune static map.
    const esIndex = ((platCfg.service === 'gdn' || platCfg.service === 'native') && esForPlat?.indexName) ? esForPlat.indexName : platCfg.index;
    try {
      gdnService.log?.info(`[newCatInsertion] searching index="${platCfg.index}" idField="${platCfg.idField}" for ad_id=${ad_id} platform=${platform}`);
      const adSearch = await esForPlat.search({
        index: esIndex,
        body:  {
          query: {
            bool: {
              should: [
                { match: { [platCfg.idField]: Number(ad_id) } },
                { match: { [platCfg.idField]: String(ad_id) } },
              ],
            },
          },
        },
      });
      const adHits = (adSearch.hits || adSearch.body?.hits)?.hits || [];
      if (adHits.length > 0) {
        const updateDoc = {
          category_id,
          [categoryField]:    category,
          subCategory_id:     subCategoryId || null,
          [subCategoryField]: subCategory   || null,
        };
        // Version-aware: 6.x needs type 'doc' (matches PHP: 'type' => 'doc'),
        // TikTok's ES 8.1 is typeless and would reject an explicit type.
        await esForPlat.update(withEsType(esForPlat, {
          index: esIndex,
          id:    adHits[0]._id,
          body:  { doc: updateDoc },
        }));
        gdnService.log?.info(`[newCatInsertion] ${platCfg.index} updated for ad_id=${ad_id}`);
      } else {
        gdnService.log?.warn(`[newCatInsertion] ad_id=${ad_id} not found in ${platCfg.index} — skipping update`);
      }
    } catch (updateErr) {
      gdnService.log?.warn(`[newCatInsertion] ${platCfg.index} update failed for ad_id=${ad_id}: ${updateErr.message}`);
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

    gdnService.log?.info(`[newCatInsertion] Processed ad_id=${ad_id}, category=${category}, sub=${subCategory}`);
    return res.status(200).json({ code: 200, message, ad_id });

  } catch (err) {
    return res.status(500).json({ code: 500, error: err.message });
  }
}

module.exports = { getDescriptionDetails, newCatInsertion };
