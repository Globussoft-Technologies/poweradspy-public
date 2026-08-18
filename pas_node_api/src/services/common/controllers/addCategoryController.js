'use strict';

const crypto = require('crypto');
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
const parsedAiMetaTimeoutMs = Number(process.env.AI_META_OPERATION_TIMEOUT_MS);
const AI_META_OPERATION_TIMEOUT_MS = Number.isFinite(parsedAiMetaTimeoutMs) && parsedAiMetaTimeoutMs > 0
  ? parsedAiMetaTimeoutMs
  : 15000;
// Bulk writes stay sequential, but a hard cap also prevents one request from holding
// database connections and ES capacity for an unbounded backlog.
const DEFAULT_AI_META_BULK_RECOMMENDED_SIZE = 5;
const DEFAULT_AI_META_BULK_MAX_SIZE = 10;
const RECENT_AD_PLATFORMS = new Set(['facebook', 'instagram', 'youtube', 'google', 'native', 'pinterest']);
const RECENT_CHECKPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_SQL_SCAN_SIZE = 500;
const parsedRecentMaxScanRows = Number(process.env.RECENT_ADS_MAX_SCAN_ROWS);
const RECENT_ADS_MAX_SCAN_ROWS = Number.isSafeInteger(parsedRecentMaxScanRows) && parsedRecentMaxScanRows >= RECENT_SQL_SCAN_SIZE
  ? parsedRecentMaxScanRows
  : 2000;
const parsedRecentSettleSeconds = Number(process.env.RECENT_ADS_SETTLE_SECONDS);
const RECENT_ADS_SETTLE_SECONDS = Number.isSafeInteger(parsedRecentSettleSeconds) && parsedRecentSettleSeconds >= 0
  ? parsedRecentSettleSeconds
  : 60;

// SQL is the insertion-time source of truth. Several platform ES mappings do not
// index created_date (Instagram intentionally omits it), so last_seen/first_seen
// must not be substituted for the actual database insertion time.
const RECENT_SQL_CONFIG = {
  facebook:  { table: 'facebook_ad' },
  instagram: { table: 'instagram_ad' },
  youtube:   { table: 'youtube_ad' },
  google:    { table: 'google_text_ad' },
  native:    { table: 'native_ad' },
  pinterest: { table: 'pinterest_ad' },
};

function getPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getAiMetaBulkLimits() {
  const maxSize = getPositiveInteger(config.aiMeta?.bulkMaxSize, DEFAULT_AI_META_BULK_MAX_SIZE);
  const recommendedSize = Math.min(
    getPositiveInteger(config.aiMeta?.bulkRecommendedSize, DEFAULT_AI_META_BULK_RECOMMENDED_SIZE),
    maxSize,
  );
  return { maxSize, recommendedSize };
}

function getAiMetaRefreshPolicy(platform) {
  const forceRefreshNetworks = config.aiMeta?.forceRefreshNetworks;
  if (!Array.isArray(forceRefreshNetworks)) return 'wait_for';

  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  const usesForcedRefresh = forceRefreshNetworks.some(
    (network) => String(network || '').trim().toLowerCase() === normalizedPlatform,
  );

  // `refresh=true` refreshes only the shard receiving this AI-Meta update. This
  // avoids waiting for long index refresh intervals while keeping other writes on
  // the lower-cost `wait_for` policy.
  return usesForcedRefresh ? true : 'wait_for';
}

function getAiMetaTransportOptions(requestTimeoutMs = AI_META_OPERATION_TIMEOUT_MS) {
  // A single bounded attempt keeps slow ES writes inside the application timeout
  // budget. Retrying is delegated to the idempotent caller with Retry-After.
  return { requestTimeout: requestTimeoutMs, maxRetries: 0 };
}

/**
 * Resolve which ES object field stores AI-Meta for a given platform/environment.
 * Dev and all normal environments keep using the original `ai` field; only the
 * production facebook index is diverted to `ai_meta` to bypass the poisoned mapping.
 */
function getAiMetaEsField(platform) {
  return config.env === 'production' && platform === 'facebook' ? 'ai_meta' : 'ai';
}

// Read-back stays backward-compatible: prefer the field configured for the current
// environment/platform, but fall back to the other key so existing docs remain visible
// during rollout and mixed-state indices are still inspectable.
function readAiMetaFromSource(src, platform) {
  const preferredField = getAiMetaEsField(platform);
  if (src[preferredField] !== undefined) return src[preferredField];
  const fallbackField = preferredField === 'ai_meta' ? 'ai' : 'ai_meta';
  return src[fallbackField] ?? null;
}

/**
 * Turn a stored creative value into a fetchable http(s) URL. Already-absolute values
 * pass through untouched (youtube). NAS-relative paths (e.g. `/PowerAdspy/n2/native/adImage/`)
 * get their mount prefix stripped and the CDN base prepended, so the classifier receives
 * the resolvable `https://media.globussoft.com/pas-prod/stream/` path directly instead of
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

function isPlaceholderCreativeUrl(v) {
  if (isBlankValue(v)) return false;
  const text = String(v).trim().toLowerCase();
  return /(?:^|\/)bydefault_ads\.(?:jpg|png)(?:[?#].*)?$/.test(text);
}

function resolveCreativeUrl(v) {
  const url = served(v);
  return url && !isPlaceholderCreativeUrl(url) ? url : null;
}

function isBlankValue(v) {
  return v === null || v === undefined || v === '';
}

function firstDefined(...values) {
  for (const value of values) {
    if (!isBlankValue(value)) return value;
  }
  return undefined;
}

function parseNonNegativeInteger(rawValue, fieldName) {
  const valueText = String(rawValue).trim();
  if (!/^\d+$/.test(valueText)) {
    return { error: `${fieldName} must be a non-negative integer` };
  }
  const value = Number(valueText);
  if (!Number.isSafeInteger(value)) {
    return { error: `${fieldName} exceeds the safe integer range` };
  }
  return { value };
}

function setRetryAfter(res, seconds) {
  const value = String(seconds ?? 30);
  if (typeof res?.setHeader === 'function') {
    res.setHeader('Retry-After', value);
    return;
  }
  if (typeof res?.set === 'function') {
    res.set('Retry-After', value);
    return;
  }
  if (typeof res?.header === 'function') {
    res.header('Retry-After', value);
  }
}

function getRetryAfterSeconds(err) {
  const headerValue = err?.meta?.headers?.['retry-after']
    ?? err?.meta?.headers?.['Retry-After']
    ?? err?.response?.headers?.['retry-after']
    ?? err?.response?.headers?.['Retry-After'];
  const parsed = Number(headerValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

function getTemporaryEsStatus(err) {
  const rawStatus = err?.statusCode ?? err?.meta?.statusCode ?? err?.meta?.body?.status ?? err?.meta?.body?.error?.status;
  const status = Number(rawStatus);
  if (status === 429) return 429;
  if ([408, 502, 503, 504].includes(status)) return 503;

  // The Elasticsearch client can surface a connection timeout without an HTTP
  // status. Treat these transport failures as retryable category-sync failures.
  const errorName = String(err?.name || '').toLowerCase();
  const errorMessage = String(err?.message || '').toLowerCase();
  if (errorName.includes('timeout') || /\b(?:timed?\s*out|timeout|socket\s+hang\s+up|econnreset|econnrefused)\b/.test(errorMessage)) {
    return 503;
  }
  return null;
}

function setAiMetaTimingHeaders(res, timings = {}) {
  if (!res || typeof res.setHeader !== 'function') return;
  const serverTiming = [];
  const headerMap = {
    es_search_ms: 'X-ES-Search-Ms',
    es_write_ms: 'X-ES-Write-Ms',
    category_sync_ms: 'X-Category-Sync-Ms',
    sql_ms: 'X-SQL-Ms',
    total_ms: 'X-Total-Ms',
  };

  for (const [key, headerName] of Object.entries(headerMap)) {
    const value = timings[key];
    if (Number.isFinite(value)) {
      const rounded = Math.max(0, Math.round(value));
      res.setHeader(headerName, String(rounded));
      serverTiming.push(`${key.replace(/_ms$/, '').replace(/_/g, '-')};dur=${rounded}`);
    }
  }

  if (serverTiming.length) {
    res.setHeader('Server-Timing', serverTiming.join(', '));
  }
}

function recordCategorySyncError(status, phase, err) {
  const retryableStatus = getTemporaryEsStatus(err);
  const retryAfterSeconds = retryableStatus ? getRetryAfterSeconds(err) : null;
  status[`${phase}_error`] = err.message;
  status[`${phase}_status_code`] = retryableStatus || 500;
  if (retryableStatus) {
    status[`${phase}_retry_after_seconds`] = retryAfterSeconds;
    status.retryable = true;
    status.status_code = status.status_code ? Math.max(status.status_code, retryableStatus) : retryableStatus;
    status.retry_after_seconds = status.retry_after_seconds
      ? Math.max(status.retry_after_seconds, retryAfterSeconds)
      : retryAfterSeconds;
  } else {
    status.status_code = status.status_code || 500;
  }
}

/**
 * Exact-ID ad lookup shared by newCatInsertion (to update) and getAdCategory (to read
 * back). Some platforms index the id as a long (facebook_ad.id), others as a keyword
 * (google.ad_id)  so we try both the string and numeric term. Returns the first ES hit
 * (with `_source`) or null.
 *
 * @param {object} esForPlat  the platform's ES client (service.db.elastic)
 * @param {string} esIndex    resolved index name
 * @param {string} idField    the ad's primary-key field for this platform
 * @param {string|number} adId
 */
async function findAdDoc(esForPlat, esIndex, idField, adId, requestTimeoutMs = AI_META_OPERATION_TIMEOUT_MS) {
  const adIdStr      = String(adId);
  const adIdNum      = Number(adId);
  const adIdNumValid = !Number.isNaN(adIdNum) && String(adIdNum) === adIdStr;
  const shouldClauses = [{ term: { [idField]: adIdStr } }];
  if (adIdNumValid) shouldClauses.push({ term: { [idField]: adIdNum } });

  const adSearch = await esForPlat.search({
    index: esIndex,
    body:  { query: { bool: { should: shouldClauses, minimum_should_match: 1 } } },
  }, getAiMetaTransportOptions(requestTimeoutMs));
  const adHits = (adSearch.hits || adSearch.body?.hits)?.hits || [];
  return adHits[0] || null;
}

/**
 * Read-side-only compatibility lookup for Google.
 *
 * getAdCategory is used to verify what the UI sees after a write, so it is allowed
 * to recover a Google read-back using the display id field when the primary lookup
 * misses. Write paths stay strict and continue to use the documented public ad_id
 * contract only.
 */
async function findReadBackAdDoc(
  esForPlat,
  esIndex,
  cfg,
  adId,
  requestTimeoutMs = AI_META_OPERATION_TIMEOUT_MS,
  exactIdField = null,
) {
  const primaryIdField = exactIdField || cfg.idField;
  let adHit = await findAdDoc(esForPlat, esIndex, primaryIdField, adId, requestTimeoutMs);
  // An explicit identifier must never fall through to another field: the same
  // number can be one Google ad's internal id and another ad's public ad_id.
  if (!exactIdField && !adHit && cfg.descIdField && cfg.descIdField !== cfg.idField) {
    adHit = await findAdDoc(esForPlat, esIndex, cfg.descIdField, adId, requestTimeoutMs);
  }
  return adHit;
}

/**
 * Write a validated `ai_meta` object onto the ad's ES doc under the resolved AI-Meta field
 * (see AI_META_API_PAYLOAD_SPEC.md 7 mapping).
 *
 * Idempotency: the whole stored AI-Meta object is REPLACED on every write (a painless assign,
 * not a doc-merge) so re-sending overwrites prior labels and stale sub-fields from an
 * older payload shape are dropped. v1.4 removed the `status` field, so there is no
 * longer a partial/status-only path  every payload is a completed enrichment.
 */
async function writeAiMeta(esForPlat, esIndex, docId, normalized, platform, requestTimeoutMs = AI_META_OPERATION_TIMEOUT_MS) {
  const aiMetaField = getAiMetaEsField(platform);
  await esForPlat.update(withEsType(esForPlat, {
    index: esIndex,
    id:    docId,
    body: {
      script: {
        source: `ctx._source.${aiMetaField} = params.aiMeta;`,
        lang:   'painless',
        params: { aiMeta: normalized },
      },
    },
    refresh: getAiMetaRefreshPolicy(platform),
  }), getAiMetaTransportOptions(requestTimeoutMs));
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
async function mirrorCategoryToEs(esForPlat, esIndex, docId, platform, cat, requestTimeoutMs = AI_META_OPERATION_TIMEOUT_MS) {
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
    refresh: getAiMetaRefreshPolicy(platform),
  }), getAiMetaTransportOptions(requestTimeoutMs));
}

/**
 * Conflict raised by `syncMasterCategory` when the incoming category/subcategory
 * nameid pair contradicts what the master `category` taxonomy index already holds.
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
 * @throws  {CategoryTaxonomyConflict} on a nameid mismatch (legacy 500 payload)
 */
async function syncMasterCategory(esClient, { category, catId, subCategory, subCategoryId, platform, requestTimeoutMs = AI_META_OPERATION_TIMEOUT_MS }) {
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
  }, getAiMetaTransportOptions(requestTimeoutMs));

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
      }), getAiMetaTransportOptions(requestTimeoutMs));
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
            }), getAiMetaTransportOptions(requestTimeoutMs));
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
        }), getAiMetaTransportOptions(requestTimeoutMs));
        message = 'Subcategory inserted successfully';
      } else {
        message = 'Category and Subcategory already exist';
      }
    } else {
      message = 'Category already exists';
    }
  } else {
    //  Insert new category 
    const docData = { category, cat_id: catId, platforms: [platform] };
    if (subCategory && subCategoryId) {
      docData.subcategory = [{ sub_cat: subCategory, sub_cat_id: subCategoryId, platforms: [platform] }];
    }
    await esClient.index(withEsType(esClient, {
      index: 'category',
      body: docData,
      refresh: 'wait_for',
    }), getAiMetaTransportOptions(requestTimeoutMs));
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
 * Non-fatal: returns a status object; a taxonomy nameid conflict or an ES error is
 * captured (not thrown), so the AI-Meta write it accompanies still succeeds.
 * Returns null when the payload has no category to apply.
 *
 * @returns {Promise<{taxonomy, mirrored, taxonomy_error?, mirror_error?}|null>}
 */
async function applyAiMetaCategoryToEs({ gdnEs, platEs, esIndex, docId, platform, normalized, log, requestTimeoutMs = AI_META_OPERATION_TIMEOUT_MS }) {
  if (!normalized || !normalized.category || !normalized.category_id) return null;
  const status = { taxonomy: null, mirrored: false, retryable: false };

  if (gdnEs) {
    try {
      const { message } = await syncMasterCategory(gdnEs, {
        category:      normalized.category,
        catId:         normalized.category_id,
        subCategory:   normalized.sub_category,
        subCategoryId: normalized.subcategory_id,
        platform,
        requestTimeoutMs,
      });
      status.taxonomy = message;
    } catch (taxErr) {
      const isConflict = taxErr instanceof CategoryTaxonomyConflict;
      status.taxonomy = isConflict ? 'conflict' : 'error';
      if (isConflict) {
        status.taxonomy_error = taxErr.payload.error;
        status.taxonomy_status_code = taxErr.payload.code || 500;
        status.status_code = status.status_code || status.taxonomy_status_code;
      } else {
        recordCategorySyncError(status, 'taxonomy', taxErr);
      }
      log?.warn?.(`[aiMetaCategory] taxonomy sync failed for platform=${platform}: ${status.taxonomy_error}`);
    }
  }

  try {
    await mirrorCategoryToEs(platEs, esIndex, docId, platform, {
      category:      normalized.category,
      subCategory:   normalized.sub_category,
      categoryId:    normalized.category_id,
      subCategoryId: normalized.subcategory_id,
    }, requestTimeoutMs);
    status.mirrored = true;
  } catch (mirrorErr) {
    recordCategorySyncError(status, 'mirror', mirrorErr);
    log?.warn?.(`[aiMetaCategory] ES mirror failed for platform=${platform}: ${mirrorErr.message}`);
  }

  return status;
}

/**
 * Resolve a platform's ES index name from config.json (via the shared networks
 * config), instead of reading XX_ELASTIC_INDEX env vars directly. networksConfig
 * already layers config.json  env  built-in default for every network, and
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
    // GDN is 100% type IMAGE in production (live-verified: 129,927/129,927 docs)  it
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
    // google_ads_data_v2 is the only flat index with BOTH a distinct internal PK (`id`)
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
    // NOT `ad_type`  confirmed against GoogleSearchQueryBuilder.js/adCountController.js
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
    // "Image"/"text" list `google` in sduiConfig.json)  so only IMAGE and TEXT ads
    // ever reach this feed. TEXT ads have no creative image  `ad_image` should still
    // be emitted as `null` for them (instead of the key being omitted entirely) so the
    // classifier can distinguish "checked, no image" from "field never sent".
    // Deliberately NOT falling back to `screenshot_url`/`png_file`: those are a
    // Lighthouse/cloaking-detection screenshot of the ad's DESTINATION website
    // (`api_gtext/.../CronController.php::saveScreenShotUsingGAPI`, `BlackhatController.php`,
    // `docs/GOOGLE_LANDER_MANIFEST.md`)  never the ad creative. Feeding that into
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
    // LinkedIn has no `Thumbnail` field  VIDEO ads store their thumbnail in
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
 * adDetailController.js join (`<net>_ad`  `<net>_ad_variants` via `<net>_ad_id`,
 *  `<net>_ad_post_owners` via `post_owner_id`). Google's tables are prefixed
 * `google_text_ad*` rather than `google_ad*`; youtube's variants table has no
 * `image_url` column (video-only creative), only `thumbnail_url`. TikTok has no
 * SQL table carrying ad_text/ad_title/newsfeed_description/image (confirmed via
 * its controllers  only analytics/country-info tables exist there), so it has
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
    imageCol:      platform === 'youtube' ? 'thumbnail_url' : (platform === 'native' ? 'image_url_original' : 'image_url'),
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
 * Normalize one ES ad document into the shared classifier feed shape. Both the
 * historical and recent feeds call this helper so platform mappings cannot drift.
 */
function normalizeDescriptionHit(hit, cfg, platform, pageField) {
  const src = hit._source || {};
  const row = {};
  const wantsTextFields = !cfg.suppressTextFields;

  row.id = src[pageField];
  row.cursor = src[pageField];
  if (cfg.adIdField) row.ad_id = src[cfg.adIdField] ?? null;
  if (wantsTextFields) {
    row.ad_text = src[cfg.textField] ?? null;
    row.ad_title = src[cfg.titleField] ?? null;
    row.news_feed_description = src[cfg.newsFeedField] ?? null;
  }
  row.post_owner_name = src[cfg.ownerField] ?? null;
  row.category = src[`${platform}.category`] ?? null;
  row.sub_category = src[`${platform}.subCategory`] ?? null;
  row.category_id = src.category_id ?? null;
  row.subcategory_id = src.subCategory_id ?? null;
  if (src.confidence_score !== undefined) row.confidence_score = src.confidence_score;
  row.ai_meta = readAiMetaFromSource(src, platform);

  if (src[cfg.ocrField] !== undefined) row.ocr = src[cfg.ocrField];
  if (cfg.destPageField && src[cfg.destPageField] !== undefined) {
    row.destination_page_text = src[cfg.destPageField];
  }

  const adType = src[cfg.typeField] || '';
  if (platform === 'native') row.native_creative_type = src[cfg.typeField] ?? null;
  const nasValue = src[cfg.imageNasField] || '';
  const origValue = cfg.imageOrigField ? (src[cfg.imageOrigField] || '') : '';
  if (cfg.imageOrigField) row.image_url_original = resolveCreativeUrl(origValue);

  if (adType === 'IMAGE' || cfg.alwaysEmitImage || platform === 'native') {
    row.ad_image = resolveCreativeUrl(nasValue) ?? resolveCreativeUrl(origValue) ?? null;
  }
  if (adType === 'VIDEO' && cfg.thumbField) {
    row.thumbnail = served(src[cfg.thumbField] || '') ?? null;
  }

  return row;
}

/**
 * Restrict ES responses to fields consumed by normalizeDescriptionHit. Some ad
 * documents contain very large lander/content objects; fetching the full _source
 * for up to 500 candidates wastes ES CPU, network bandwidth, and Node heap.
 */
function descriptionSourceIncludes(cfg, platform, pageField) {
  return [...new Set([
    pageField,
    cfg.adIdField,
    cfg.textField,
    cfg.titleField,
    cfg.ownerField,
    cfg.ocrField,
    cfg.newsFeedField,
    cfg.typeField,
    cfg.imageNasField,
    cfg.imageOrigField,
    cfg.thumbField,
    cfg.destPageField,
    `${platform}.category`,
    `${platform}.subCategory`,
    'category_id',
    'subCategory_id',
    'confidence_score',
    'ai',
    'ai_meta',
  ].filter(Boolean))];
}

/**
 * Fill fields that have not reached ES yet from the platform's authoritative SQL
 * tables. This is shared by both classifier feeds and never overwrites ES values.
 */
async function applyDescriptionSqlFallback(rows, service, cfg, platform) {
  const sqlCfg = sqlFallbackConfigFor(platform);
  if (!sqlCfg || !service.db.sql) return;
  const wantsTextFields = !cfg.suppressTextFields;
  const idsNeedingFallback = [...new Set(
    rows
      .filter(row => (wantsTextFields && (isBlankValue(row.ad_text) || isBlankValue(row.ad_title) || isBlankValue(row.news_feed_description))) || isBlankValue(row.post_owner_name) || row.ad_image === null || (platform === 'native' && isBlankValue(row.ad_image)))
      .map(row => row.id)
  )];
  if (!idsNeedingFallback.length) return;

  const fallbackMap = await fetchSqlDescriptionFallback(service.db.sql, sqlCfg, idsNeedingFallback);
  for (const row of rows) {
    const sqlRow = fallbackMap.get(String(row.id));
    if (!sqlRow) continue;
    if (wantsTextFields) {
      if (isBlankValue(row.ad_text) && !isBlankValue(sqlRow.ad_text)) row.ad_text = sqlRow.ad_text;
      if (isBlankValue(row.ad_title) && !isBlankValue(sqlRow.ad_title)) row.ad_title = sqlRow.ad_title;
      if (isBlankValue(row.news_feed_description) && !isBlankValue(sqlRow.news_feed_description)) row.news_feed_description = sqlRow.news_feed_description;
    }
    if (isBlankValue(row.post_owner_name) && !isBlankValue(sqlRow.post_owner_name)) row.post_owner_name = sqlRow.post_owner_name;
    if (platform === 'native' && isBlankValue(row.image_url_original) && !isBlankValue(sqlRow.ad_image_url)) row.image_url_original = resolveCreativeUrl(sqlRow.ad_image_url);
    if (isBlankValue(row.ad_image) && !isBlankValue(sqlRow.ad_image_url)) row.ad_image = resolveCreativeUrl(sqlRow.ad_image_url);
  }
}

function addNativeCreativeAvailability(rows, platform) {
  if (platform !== 'native') return;
  for (const row of rows) {
    if (!isBlankValue(row.ad_image)) continue;
    const hasText = !isBlankValue(row.ad_text) || !isBlankValue(row.ad_title) || !isBlankValue(row.news_feed_description);
    if (!hasText) row.creative_availability_reason = 'No usable creative image or text was available from ES or SQL.';
  }
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
  const exValRaw = firstDefined(req.query.exVal, req.body?.exVal);
  const limitRaw = firstDefined(req.query.limit, req.body?.limit);
  const exValInput = exValRaw ?? 0;
  const limitInput = limitRaw ?? 150;
  const exValParsed = parseNonNegativeInteger(exValInput, 'exVal');
  if (exValParsed.error) {
    return res.status(400).json({ code: 400, message: exValParsed.error });
  }
  const limitParsed = parseNonNegativeInteger(limitInput, 'limit');
  if (limitParsed.error) {
    return res.status(400).json({ code: 400, message: limitParsed.error });
  }
  if (limitParsed.value === 0) {
    return res.status(400).json({ code: 400, message: 'limit must be greater than 0' });
  }

  const exVal = exValParsed.value;
  const limit = limitParsed.value;

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
    // GDN is on gdn_search_mix_v2  resolve the env-correct index from the live ES client, not the config-immune static map.
    const esIndex = ((cfg.service === 'gdn' || cfg.service === 'native') && service.db.elastic.indexName) ? service.db.elastic.indexName : cfg.index;
    // Pagination cursor: usually the same field as the ad lookup key, but Google
    // paginates on its distinct internal PK (`id`) while looking ads up by `ad_id`.
    const pageField = cfg.descIdField || cfg.idField;
    // Displayable-media gate: skip ads the UI itself hides for broken/missing/
    // placeholder media (same clauses each network's own SearchMixQueryBuilder
    // always applies  see displayableMediaFilters.js). Every ad this feed
    // returns gets sent through the external category/AI-meta classifier, so
    // an undisplayable ad is pure wasted classification spend.
    const mediaFilter = getDisplayableMediaFilter(platform);
    // Filter context avoids score calculation for cursor and visibility clauses.
    const boolQuery = { filter: [{ range: { [pageField]: { gt: exVal } } }, ...(mediaFilter || [])] };

    let esResult;
    try {
      esResult = await service.db.elastic.search({
        index: esIndex,
        body: {
          size: limit,
          _source: descriptionSourceIncludes(cfg, platform, pageField),
          sort: [{ [pageField]: 'asc' }],
          query: { bool: boolQuery },
        },
      });
    } catch (err) {
      const retryableStatus = getTemporaryEsStatus(err);
      if (retryableStatus) {
        setRetryAfter(res, getRetryAfterSeconds(err));
        const message = retryableStatus === 429
          ? `ES rate limit reached for platform: ${platform}`
          : `ES temporarily unavailable for platform: ${platform}`;
        service.log?.warn(`[getDescriptionDetails] platform=${platform} temporary ES error: ${err.message}`);
        return res.status(retryableStatus).json({ code: retryableStatus, message, error: err.message });
      }
      throw err;
    }

    const hits = (esResult.hits || esResult.body?.hits)?.hits || [];
    const finalArray = hits.map(hit => normalizeDescriptionHit(hit, cfg, platform, pageField));

    // SQL fallback: ES is a downstream sync of MySQL, so an ad whose ES doc hasn't
    // (yet) received text/title/description/owner/image carries the real value in
    // MySQL. Only fills fields ES left null  never overwrites an ES-derived value.
    try {
      await applyDescriptionSqlFallback(finalArray, service, cfg, platform);
    } catch (sqlErr) {
      service.log?.warn(`[getDescriptionDetails] SQL fallback failed for platform=${platform}: ${sqlErr.message}`);
    }
    addNativeCreativeAvailability(finalArray, platform);

    return res.status(200).json(finalArray);

  } catch (err) {
    const retryableStatus = getTemporaryEsStatus(err);
    if (retryableStatus) {
      setRetryAfter(res, getRetryAfterSeconds(err));
      const message = retryableStatus === 429
        ? `ES rate limit reached for platform: ${platform}`
        : `ES temporarily unavailable for platform: ${platform}`;
      service.log?.warn(`[getDescriptionDetails] platform=${platform} temporary ES error: ${err.message}`);
      return res.status(retryableStatus).json({ code: retryableStatus, message, error: err.message });
    }
    service.log?.error(`[getDescriptionDetails] platform=${platform} error: ${err.message}`);
    return res.status(500).json({ code: 500, message: 'Some Error Occured', error: err.message });
  }
}

function recentCheckpointSecret() {
  // A dedicated secret permits independent rotation; JWT is a backwards-compatible
  // deployment fallback so the endpoint does not start issuing unsigned cursors.
  return process.env.RECENT_ADS_CHECKPOINT_SECRET || config.jwt?.secret || '';
}

function encodeRecentCheckpoint(platform, insertedAt, id, issuedAt = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    p: platform,
    t: insertedAt,
    id: String(id),
    iat: issuedAt,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', recentCheckpointSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function decodeRecentCheckpoint(token, platform, now = Date.now()) {
  if (typeof token !== 'string' || !token) throw new Error('checkpoint must be a non-empty string or null');
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1]) || !recentCheckpointSecret()) {
    throw new Error('checkpoint is invalid');
  }
  const expected = crypto.createHmac('sha256', recentCheckpointSecret()).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch { throw new Error('checkpoint is invalid'); }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error('checkpoint is invalid');

  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new Error('checkpoint is invalid'); }
  if (payload.v !== 1 || payload.p !== platform || typeof payload.t !== 'string' || !/^\d+$/.test(payload.id || '') || !Number.isFinite(payload.iat)) {
    throw new Error('checkpoint is invalid for this platform');
  }
  if (now - payload.iat > RECENT_CHECKPOINT_TTL_MS || payload.iat > now + 60_000) throw new Error('checkpoint has expired or has an invalid issue time');
  if (!parseUtcTimestamp(payload.t)) throw new Error('checkpoint contains an invalid insertion position');
  return { insertedAt: payload.t, id: payload.id, issuedAt: payload.iat };
}

function parseUtcTimestamp(value) {
  const match = typeof value === 'string'
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/)
    : null;
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  const millis = Number(fraction.padEnd(3, '0'));
  const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), millis);
  const date = new Date(timestamp);
  // Date.UTC normalizes impossible dates (for example February 30), so compare
  // every component to reject them instead of silently shifting the watermark.
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)
    || date.getUTCHours() !== Number(hour) || date.getUTCMinutes() !== Number(minute) || date.getUTCSeconds() !== Number(second)) return null;
  return date.toISOString();
}

function mysqlUtcTimestamp(isoValue) {
  return isoValue.replace('T', ' ').replace(/Z$/, '');
}

function canonicalSqlTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const raw = String(value || '').trim();
  if (!raw) return null;
  // DATE_FORMAT makes MySQL return text rather than allowing mysql2 to parse a
  // DATETIME in the Node host timezone. Normalize microseconds to ISO millis.
  const utcText = raw.replace(' ', 'T').replace(/Z$/, '');
  const match = utcText.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const normalized = `${match[1]}.${(match[2] || '0').padEnd(3, '0').slice(0, 3)}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function recentFeedError(res, status, code, message, requestId, retryable = false, retryAfter = null) {
  if (retryAfter) setRetryAfter(res, retryAfter);
  return res.status(status).json({
    success: false,
    code,
    message,
    retryable,
    ...(retryAfter ? { retry_after: retryAfter } : {}),
    request_id: requestId,
  });
}

function assertCompleteRecentEsSearch(esResult) {
  const response = esResult?.body || esResult || {};
  if (!response.timed_out && Number(response._shards?.failed || 0) === 0) return;
  // A partial ES page is never safe for checkpoint advancement because a missing
  // shard could contain a candidate that would then be skipped permanently.
  const error = new Error(response.timed_out ? 'Elasticsearch search timed out' : 'Elasticsearch search had failed shards');
  error.statusCode = 503;
  throw error;
}

/**
 * POST /getRecentAdsForAiMeta
 *
 * SQL supplies the authoritative insertion tuple; Elasticsearch applies the same
 * dashboard visibility rules and response normalization as getDescriptionDetails.
 */
async function getRecentAdsForAiMeta(req, res) {
  const body = req.body || {};
  const requestId = req.id || req.requestId || null;
  const platform = String(body.platform || '').toLowerCase().trim();
  if (!RECENT_AD_PLATFORMS.has(platform)) {
    return recentFeedError(res, 400, 'INVALID_PLATFORM', `Unsupported platform: ${platform}`, requestId);
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'checkpoint') || (body.checkpoint !== null && typeof body.checkpoint !== 'string')) {
    return recentFeedError(res, 400, 'INVALID_CHECKPOINT', 'checkpoint is required and must be a string or null', requestId);
  }
  if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100) {
    return recentFeedError(res, 400, 'INVALID_LIMIT', 'limit must be an integer from 1 to 100', requestId);
  }
  if (body.wait_seconds !== undefined && (!Number.isInteger(body.wait_seconds) || body.wait_seconds < 0 || body.wait_seconds > 15)) {
    return recentFeedError(res, 400, 'INVALID_WAIT_SECONDS', 'wait_seconds must be an integer from 0 to 15', requestId);
  }

  let cursor;
  if (body.checkpoint === null) {
    const startFrom = parseUtcTimestamp(body.start_from);
    if (!startFrom) return recentFeedError(res, 400, 'INVALID_START_FROM', 'start_from must be a valid ISO-8601 UTC timestamp on the first request', requestId);
    // Legacy created_date columns commonly have one-second precision. Round the
    // first watermark down so a DS timestamp such as .482Z cannot skip inserts
    // stored as the same second; the conservative replay is safe for DS dedupe.
    const inclusiveStart = new Date(Math.floor(Date.parse(startFrom) / 1000) * 1000).toISOString();
    cursor = { insertedAt: inclusiveStart, id: '0', issuedAt: Date.now() };
  } else {
    try {
      cursor = decodeRecentCheckpoint(body.checkpoint, platform);
    } catch (err) {
      const invalidService = serviceRegistry.getService(PLATFORM_CONFIG[platform].service);
      invalidService?.log?.warn?.('[getRecentAdsForAiMeta] invalid checkpoint', { platform, request_id: requestId });
      return recentFeedError(res, 400, 'INVALID_CHECKPOINT', err.message, requestId);
    }
  }

  const cfg = PLATFORM_CONFIG[platform];
  const service = serviceRegistry.getService(cfg.service);
  if (!service?.db?.sql || !service?.db?.elastic) {
    return recentFeedError(res, 503, 'TEMPORARY_BACKEND_UNAVAILABLE', `Recent ad feed is unavailable for platform: ${platform}`, requestId, true, 30);
  }

  const sqlConfig = RECENT_SQL_CONFIG[platform];
  const pageField = cfg.descIdField || cfg.idField;
  const esIndex = cfg.service === 'native' && service.db.elastic.indexName ? service.db.elastic.indexName : cfg.index;
  const wanted = body.limit + 1;
  const eligible = [];
  let scanCursor = { ...cursor };
  const responseIssuedAt = Date.now();
  // Do not race a committed SQL row against its ES index/refresh operation. Newer
  // rows become eligible on a later poll after this bounded settling interval.
  const availableThrough = new Date(responseIssuedAt - (RECENT_ADS_SETTLE_SECONDS * 1000)).toISOString();
  let sqlQueryMs = 0;
  let esQueryMs = 0;
  let scannedRows = 0;
  let scanLimitReached = false;

  try {
    while (eligible.length < wanted) {
      const remainingScanRows = RECENT_ADS_MAX_SCAN_ROWS - scannedRows;
      if (remainingScanRows <= 0) {
        scanLimitReached = true;
        break;
      }
      const scanSize = Math.min(RECENT_SQL_SCAN_SIZE, remainingScanRows);
      const sqlStartedAt = Date.now();
      // mysql2 prepared statements reject a bound LIMIT value with
      // "Incorrect arguments to mysqld_stmt_execute", so inline this
      // validated scan size just like the other pagination controllers.
      const sqlRows = await service.db.sql.query(
        `SELECT id, DATE_FORMAT(created_date, '%Y-%m-%d %H:%i:%s.%f') AS inserted_at FROM ${sqlConfig.table}
         WHERE created_date <= ?
           AND (created_date > ? OR (created_date = ? AND id > ?))
         ORDER BY created_date ASC, id ASC
         LIMIT ${scanSize}`,
        [mysqlUtcTimestamp(availableThrough), mysqlUtcTimestamp(scanCursor.insertedAt), mysqlUtcTimestamp(scanCursor.insertedAt), scanCursor.id],
      );
      sqlQueryMs += Date.now() - sqlStartedAt;
      if (!sqlRows.length) break;
      scannedRows += sqlRows.length;

      const positions = new Map();
      for (const sqlRow of sqlRows) {
        const insertedAt = canonicalSqlTimestamp(sqlRow.inserted_at);
        if (!insertedAt) throw new Error(`Invalid created_date for ${platform} id=${sqlRow.id}`);
        positions.set(String(sqlRow.id), { insertedAt, id: String(sqlRow.id) });
      }
      const lastSqlRow = sqlRows[sqlRows.length - 1];
      scanCursor = positions.get(String(lastSqlRow.id));

      const boolQuery = { filter: [{ terms: { [pageField]: sqlRows.map(row => row.id) } }] };
      const mediaFilter = getDisplayableMediaFilter(platform);
      if (mediaFilter) boolQuery.filter.push(...mediaFilter);
      const esStartedAt = Date.now();
      // Phase 1 fetches only IDs to evaluate dashboard eligibility cheaply. Full
      // source can include large content fields and is needed for at most limit+1
      // rows, not every SQL candidate in the scan batch.
      const eligibilityResult = await service.db.elastic.search({
        index: esIndex,
        body: {
          size: sqlRows.length,
          timeout: '2s',
          _source: [pageField],
          query: { bool: boolQuery },
        },
      });
      esQueryMs += Date.now() - esStartedAt;
      assertCompleteRecentEsSearch(eligibilityResult);
      const eligibilityHits = (eligibilityResult.hits || eligibilityResult.body?.hits)?.hits || [];
      const visibleIds = new Set(eligibilityHits.map(hit => String(hit._source?.[pageField])));
      const detailIds = [];
      for (const sqlRow of sqlRows) {
        if (!visibleIds.has(String(sqlRow.id))) continue;
        detailIds.push(sqlRow.id);
        if (eligible.length + detailIds.length >= wanted) break;
      }

      if (detailIds.length) {
        const detailFilter = [{ terms: { [pageField]: detailIds } }, ...(mediaFilter || [])];
        const detailStartedAt = Date.now();
        const detailResult = await service.db.elastic.search({
          index: esIndex,
          body: {
            size: detailIds.length,
            timeout: '2s',
            _source: descriptionSourceIncludes(cfg, platform, pageField),
            query: { bool: { filter: detailFilter } },
          },
        });
        esQueryMs += Date.now() - detailStartedAt;
        assertCompleteRecentEsSearch(detailResult);
        const detailHits = (detailResult.hits || detailResult.body?.hits)?.hits || [];
        const byId = new Map(detailHits.map(hit => [String(hit._source?.[pageField]), hit]));
        if (byId.size !== detailIds.length) {
          const error = new Error('Elasticsearch detail lookup changed during page assembly');
          error.statusCode = 503;
          throw error;
        }

        for (const sqlRow of sqlRows) {
          const hit = byId.get(String(sqlRow.id));
          if (!hit) continue;
        const position = positions.get(String(sqlRow.id));
        const row = normalizeDescriptionHit(hit, cfg, platform, pageField);
        row.ad_id = String(row.ad_id ?? row.id);
        row.inserted_at = position.insertedAt;
        row.insertion_cursor = encodeRecentCheckpoint(platform, position.insertedAt, position.id, responseIssuedAt);
        eligible.push(row);
        if (eligible.length >= wanted) break;
        }
      }
      if (sqlRows.length < scanSize) break;
    }

    if (scanLimitReached && eligible.length === 0) {
      service.log?.warn?.('[getRecentAdsForAiMeta] scan limit reached without an eligible row', {
        platform,
        request_id: requestId,
        scanned_rows: scannedRows,
      });
      return recentFeedError(
        res,
        503,
        'RECENT_SCAN_LIMIT_REACHED',
        'Recent ad feed scan limit reached before an eligible ad was found',
        requestId,
        true,
        30,
      );
    }

    const hasMore = eligible.length > body.limit || scanLimitReached;
    const items = eligible.slice(0, body.limit);
    try {
      await applyDescriptionSqlFallback(items, service, cfg, platform);
    } catch (sqlErr) {
      service.log?.warn(`[getRecentAdsForAiMeta] SQL field fallback failed platform=${platform}: ${sqlErr.message}`);
    }
    addNativeCreativeAvailability(items, platform);

    const nextCheckpoint = items.length
      ? items[items.length - 1].insertion_cursor
      // Preserve an empty-page checkpoint byte-for-byte when supplied so callers
      // can safely persist/reuse it without a synthetic watermark advance.
      : (body.checkpoint || encodeRecentCheckpoint(platform, cursor.insertedAt, cursor.id, responseIssuedAt));
    const serverTime = new Date().toISOString();
    service.log?.info?.('[getRecentAdsForAiMeta] page', {
      platform,
      request_id: requestId,
      returned_count: items.length,
      empty: items.length === 0,
      sql_query_ms: sqlQueryMs,
      es_query_ms: esQueryMs,
      insertion_lag_ms: items.length ? Math.max(0, Date.parse(serverTime) - Date.parse(items[items.length - 1].inserted_at)) : null,
      scanned_rows: scannedRows,
      scan_limit_reached: scanLimitReached,
      available_through: availableThrough,
      checkpoint_hash: crypto.createHash('sha256').update(String(body.checkpoint || '')).digest('hex').slice(0, 12),
      next_checkpoint_hash: crypto.createHash('sha256').update(nextCheckpoint).digest('hex').slice(0, 12),
    });
    return res.status(200).json({ platform, items, next_checkpoint: nextCheckpoint, has_more: hasMore, server_time: serverTime, request_id: requestId });
  } catch (err) {
    const temporaryStatus = getTemporaryEsStatus(err);
    const status = temporaryStatus || 503;
    const retryAfter = getRetryAfterSeconds(err);
    service.log?.error?.(`[getRecentAdsForAiMeta] platform=${platform} error: ${err.message}`);
    return recentFeedError(
      res,
      status,
      status === 429 ? 'CAPACITY_LIMIT' : 'TEMPORARY_BACKEND_UNAVAILABLE',
      'Recent ad feed is temporarily unavailable',
      requestId,
      true,
      retryAfter,
    );
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
 * (search sends no type, so it silently succeeds  masking the mismatch). Verified
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

    //  Validation 
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

    //  Step 1: Upsert the master `category` taxonomy index (shared helper,
    //    also used by POST /ai-meta now that ids travel inside ai_meta). 
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

    //  Step 2: Update the ad record in the platform's search_mix index 
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
        gdnService.log?.warn(`[newCatInsertion] ${adWarning}  skipping update`);
      }
    } catch (updateErr) {
      adCategoryStatus = 'error';
      adWarning = `update failed for ad_id=${ad_id}: ${updateErr.message}`;
      gdnService.log?.warn(`[newCatInsertion] ${adWarning}`);
    }

    //  Step 2b: Optional AI-Meta enrichment (Option A) 
    // Additive: when the caller includes an `ai_meta` object we validate + write it
    // onto the same ad doc's runtime AI-Meta field. This never fails the category write  an
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
          await writeAiMeta(esForPlat, esIndex, adDocId, aiNormalized, platform);
          aiMetaResult = { ai_meta_status: 'stored', ai_meta_stored_fields: storedFields };
          gdnService.log?.info(`[newCatInsertion] ai_meta stored for ad_id=${ad_id}`);

          // Category on Option A is driven by the top-level classification (Step 1
          // taxonomy + Step 2 flat-code ad update) which runs on every request, so the
          // ai_meta category is not re-applied here  it would only duplicate that write.
          // Durable SQL copy + category dual-write (non-fatal  an ES success stands
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

    //  Step 3: Sync to MongoDB sdui_config (fire-and-forget) 
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
 * GET /getAdCategory?platform=google&internal_id=<id>
 *
 * Lightweight single-ad read-back so the classifier can verify a newCatInsertion
 * write attached without paging the whole getDescriptionDetails feed (Issue 1).
 * Returns the ad's currently-stored category/sub_category (+ ids + confidence_score),
 * matched on the same per-platform primary key newCatInsertion updates.
 */
async function getAdCategory(req, res) {
  const platform = (req.query.platform || req.body?.platform || '').toLowerCase().trim();
  const adId     = req.query.ad_id ?? req.body?.ad_id;
  const internalId = req.query.internal_id ?? req.body?.internal_id;
  const hasAdId = adId !== undefined && adId !== null && adId !== '';
  const hasInternalId = internalId !== undefined && internalId !== null && internalId !== '';

  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) {
    return res.status(400).json({
      code: 400,
      message: `Unsupported platform: ${platform}. Valid: ${Object.keys(PLATFORM_CONFIG).join(', ')}`,
    });
  }
  if (!hasAdId && !hasInternalId) {
    return res.status(400).json({ code: 400, message: 'ad_id is required (or internal_id for Google)' });
  }
  if (hasAdId && hasInternalId) {
    return res.status(400).json({ code: 400, message: 'Provide either ad_id or internal_id, not both' });
  }
  if (hasInternalId && platform !== 'google') {
    return res.status(400).json({ code: 400, message: 'internal_id is supported only for Google' });
  }

  const service = serviceRegistry.getService(cfg.service);
  const es = service?.db?.elastic;
  if (!es) {
    return res.status(503).json({ code: 503, message: `ES not available for platform: ${platform}` });
  }

  const esIndex = es.indexName || cfg.index;
  const lookupId = hasInternalId ? internalId : adId;
  const exactIdField = hasInternalId ? cfg.descIdField : null;
  try {
    const adHit = await findReadBackAdDoc(es, esIndex, cfg, lookupId, AI_META_OPERATION_TIMEOUT_MS, exactIdField);
    if (!adHit) {
      const lookupName = hasInternalId ? 'internal_id' : 'ad_id';
      return res.status(404).json({
        code: 404,
        message: `${lookupName}=${lookupId} not found in ${esIndex}`,
        [lookupName]: lookupId,
        platform,
      });
    }
    const src = adHit._source || {};
    return res.status(200).json({
      code:            200,
      platform,
      ad_id:           hasInternalId ? (src[cfg.adIdField] ?? src[cfg.idField] ?? null) : adId,
      ...(hasInternalId ? { internal_id: internalId } : {}),
      category:        src[`${platform}.category`]    ?? null,
      sub_category:    src[`${platform}.subCategory`] ?? null,
      category_id:     src.category_id    ?? null,
      subcategory_id:  src.subCategory_id ?? null,
      confidence_score: src.confidence_score ?? null,
      ai_meta:         readAiMetaFromSource(src, platform),
    });
  } catch (err) {
    const lookupName = hasInternalId ? 'internal_id' : 'ad_id';
    service.log?.error(`[getAdCategory] platform=${platform} ${lookupName}=${lookupId} error: ${err.message}`);
    return res.status(500).json({ code: 500, message: 'Some Error Occured', error: err.message });
  }
}

/**
 * POST /ai-meta  (Option B  dedicated AI-Meta enrichment endpoint)
 *
 * Standalone, spec-conformant write path for AI-generated meta labels
 * (AI_META_API_PAYLOAD_SPEC.md 2/3/6). As of v1.6 the category classification
 * travels inside `ai_meta` (name + 4-char `category_id` + 8-char `subcategory_id`),
 * so this endpoint is now ALSO the category writer: when a category is present it
 * maintains the master `category` taxonomy index, mirrors the flat codes + names onto
 * the ad doc, and dual-writes to SQL  everything the classification POST does.
 *
 * Body: { ad_id, network, ai_meta:{} }
 * Responses follow 6 exactly (success / 400 VALIDATION_ERROR / 404 AD_NOT_FOUND).
 */
async function insertAiMeta(req, res) {
  const body     = req.body || {};
  const adId     = body.ad_id;
  const platform = (body.network || body.platform || '').toLowerCase().trim();
  const requestId = req.id || req.requestId || null;
  const timings = { startedAt: Date.now() };
  const finish = (statusCode, payload) => {
    timings.total_ms = Date.now() - timings.startedAt;
    setAiMetaTimingHeaders(res, timings);
    return res.status(statusCode).json({ request_id: requestId, ...payload });
  };

  // Top-level validation (spec 2)
  const details = [];
  if (adId === undefined || adId === null || adId === '')
    details.push({ field: 'ad_id', message: 'ad_id is required' });
  if (!platform)
    details.push({ field: 'network', message: 'network is required' });
  else if (!PLATFORM_CONFIG[platform])
    details.push({ field: 'network', message: `'${platform}' is not a supported network. Valid: ${Object.keys(PLATFORM_CONFIG).join(', ')}` });
  if (body.ai_meta === undefined || body.ai_meta === null)
    details.push({ field: 'ai_meta', message: 'ai_meta is required' });

  // ai_meta field-level validation (spec 3)
  let normalized, storedFields, aiErrors = [];
  if (body.ai_meta !== undefined && body.ai_meta !== null) {
    ({ errors: aiErrors, normalized, storedFields } = validateAiMeta(body.ai_meta));
    details.push(...aiErrors);
  }

  if (details.length > 0) {
    return finish(400, {
      success: false,
      ad_id:   adId ?? null,
      error:   { code: 'VALIDATION_ERROR', message: 'Request validation failed', details },
    });
  }

  const cfg = PLATFORM_CONFIG[platform];
  const service = serviceRegistry.getService(cfg.service);
  const es = service?.db?.elastic;
  if (!es) {
    return finish(503, { success: false, ad_id: adId, error: { code: 'ES_UNAVAILABLE', message: `ES not available for network: ${platform}` } });
  }
  const esIndex = es.indexName || cfg.index;

  try {
    const esSearchStartedAt = Date.now();
    let adHit;
    try {
      adHit = await findAdDoc(es, esIndex, cfg.idField, adId);
    } finally {
      timings.es_search_ms = Date.now() - esSearchStartedAt;
    }
    if (!adHit) {
      return finish(404, {
        success: false,
        ad_id:   adId,
        error:   { code: 'AD_NOT_FOUND', message: `Ad with id '${adId}' does not exist` },
      });
    }

    const esWriteStartedAt = Date.now();
    try {
      await writeAiMeta(es, esIndex, adHit._id, normalized, platform);
    } finally {
      // Preserve the failed attempt duration in timing headers as well.
      timings.es_write_ms = Date.now() - esWriteStartedAt;
    }
    service.log?.info(`[insertAiMeta] stored for ad_id=${adId} network=${platform}`);

    // Category (v1.6: name + ids inside ai_meta) - maintain the master `category`
    // taxonomy index and mirror the flat codes + names onto the ad doc. Non-fatal.
    const categorySyncStartedAt = Date.now();
    const categorySync = await applyAiMetaCategoryToEs({
      gdnEs:      serviceRegistry.getService('gdn')?.db?.elastic,
      platEs:     es,
      esIndex,
      docId:      adHit._id,
      platform,
      normalized,
      log:        service.log,
      requestTimeoutMs: AI_META_OPERATION_TIMEOUT_MS,
    });
    timings.category_sync_ms = Date.now() - categorySyncStartedAt;

    // Durable SQL copy + category dual-write (non-fatal).
    const sqlStartedAt = Date.now();
    const sqlResult = await persistAiMeta({
      sql:        service?.db?.sql,
      network:    platform,
      adId:       adId,
      normalized: normalized,
      logger:     service.log,
    });
    timings.sql_ms = Date.now() - sqlStartedAt;

    const categorySyncHasFailure = Boolean(categorySync && (categorySync.taxonomy_error || categorySync.mirror_error));
    if (categorySyncHasFailure) {
      const statusCode = categorySync.status_code || 500;
      const errorCode = categorySync.retryable ? 'CATEGORY_SYNC_RETRYABLE' : 'CATEGORY_SYNC_FAILED';
      if (categorySync.retryable) {
        setRetryAfter(res, categorySync.retry_after_seconds);
      }
      return finish(statusCode, {
        success: false,
        ad_id:   adId,
        message: categorySync.retryable
          ? 'AI-Meta stored but category sync must be retried'
          : 'AI-Meta stored but category sync failed',
        stored_fields: storedFields,
        sql: sqlResult,
        category_sync: categorySync,
        error: {
          code: errorCode,
          message: categorySync.mirror_error || categorySync.taxonomy_error || 'Category sync failed',
          details: categorySync,
        },
      });
    }

    const out = {
      success: true,
      ad_id:   adId,
      message: 'AI-Meta labels stored successfully',
      stored_fields: storedFields,
      sql: sqlResult,
    };
    if (categorySync) out.category_sync = categorySync;
    return finish(200, out);
  } catch (err) {
    service.log?.error(`[insertAiMeta] network=${platform} ad_id=${adId} error: ${err.message}`);
    const retryableStatus = getTemporaryEsStatus(err);
    if (retryableStatus) {
      setRetryAfter(res, getRetryAfterSeconds(err));
      return finish(retryableStatus, {
        success: false,
        ad_id: adId,
        error: {
          code: 'ES_UNAVAILABLE',
          message: 'Elasticsearch is temporarily unavailable; retry this idempotent request',
        },
      });
    }
    return finish(500, { success: false, ad_id: adId, error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
}

function createCapturedResponse() {
  const captured = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(body) {
      captured.body = body;
      return res;
    },
    setHeader(name, value) {
      captured.headers[name] = value;
      return res;
    },
    set(name, value) {
      captured.headers[name] = value;
      return res;
    },
    header(name, value) {
      captured.headers[name] = value;
      return res;
    },
  };
  return { res, captured };
}

function normalizeAiMetaBulkItems(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return null;
  for (const key of ['items', 'requests', 'records', 'data']) {
    if (Array.isArray(body[key])) return body[key];
  }
  return null;
}

function getBulkRetryMetadata(body, statusCode, headers) {
  const errorCode = body?.error?.code;
  const retryable = body?.success === false && (
    body?.category_sync?.retryable === true
    || ([429, 503].includes(statusCode) && ['ES_UNAVAILABLE', 'CATEGORY_SYNC_RETRYABLE'].includes(errorCode))
  );
  if (!retryable) return { retryable: false, retry_after: null };

  const retryAfterHeader = headers?.['Retry-After'] ?? headers?.['retry-after'];
  const retryAfter = Number(retryAfterHeader ?? body?.category_sync?.retry_after_seconds);
  return {
    retryable: true,
    // Retry-After is set by every temporary ES path; retain a safe default if a
    // custom adapter returns a retryable error without the header.
    retry_after: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30,
  };
}

async function insertAiMetaBulk(req, res) {
  const body = req.body || {};
  const requestId = req.id || req.requestId || null;
  const items = normalizeAiMetaBulkItems(body);
  const timings = { startedAt: Date.now() };
  const { maxSize, recommendedSize } = getAiMetaBulkLimits();

  if (!items || items.length === 0) {
    setAiMetaTimingHeaders(res, { total_ms: 0 });
    return res.status(400).json({
      request_id: requestId,
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bulk items are required',
        details: [{ field: 'items', message: 'At least one ai_meta item is required' }],
      },
    });
  }

  if (items.length > maxSize) {
    setAiMetaTimingHeaders(res, { total_ms: 0 });
    return res.status(400).json({
      request_id: requestId,
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: `bulk requests are limited to ${maxSize} items`,
        details: [{
          field: 'items',
          message: `Send at most ${maxSize} items per request; ${recommendedSize} is the recommended batch size`,
        }],
      },
    });
  }

  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const childRequestId = item.request_id ?? item.requestId ?? (requestId ? `${requestId}:${index + 1}` : null);
    const { res: childRes, captured } = createCapturedResponse();
    try {
      await insertAiMeta({
        ...req,
        id: childRequestId,
        requestId: childRequestId,
        body: item,
      }, childRes);
    } catch (err) {
      // Keep a malformed/unexpected item from aborting a partially completed batch.
      captured.statusCode = 500;
      captured.body = {
        request_id: childRequestId,
        success: false,
        ad_id: item.ad_id ?? null,
        error: { code: 'INTERNAL_ERROR', message: err.message },
      };
    }

    const childBody = captured.body || {};
    const retryMetadata = getBulkRetryMetadata(childBody, captured.statusCode, captured.headers);
    results.push({
      index,
      request_id: childBody.request_id ?? childRequestId,
      ad_id: childBody.ad_id ?? item.ad_id ?? null,
      network: (item.network || item.platform || '').toLowerCase().trim() || null,
      status_code: captured.statusCode,
      success: Boolean(childBody.success),
      retryable: retryMetadata.retryable,
      retry_after: retryMetadata.retry_after,
      message: childBody.message ?? null,
      error: childBody.error ?? null,
      stored_fields: childBody.stored_fields ?? undefined,
      sql: childBody.sql ?? undefined,
      category_sync: childBody.category_sync ?? undefined,
    });
  }

  const successCount = results.filter((item) => item.success).length;
  const failedCount = results.length - successCount;
  const statusCode = failedCount > 0 ? 207 : 200;
  timings.total_ms = Date.now() - timings.startedAt;
  setAiMetaTimingHeaders(res, timings);
  return res.status(statusCode).json({
    request_id: requestId,
    success: failedCount === 0,
    code: statusCode,
    message: failedCount === 0
      ? 'All AI-Meta records stored successfully'
      : 'One or more AI-Meta records failed',
    summary: {
      total: results.length,
      success: successCount,
      failed: failedCount,
    },
    results,
  });
}

module.exports = { getDescriptionDetails, getRecentAdsForAiMeta, newCatInsertion, getAdCategory, insertAiMeta, insertAiMetaBulk };
