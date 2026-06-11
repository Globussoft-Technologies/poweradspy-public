'use strict';

const serviceRegistry = require('../../ServiceRegistry');
const { getDB }        = require('../../sdui/db');

const ES_CATEGORY_INDEX = 'category';
const SDUI_DOC_ID       = 'category';   // _id in sdui_config collection
const FILTER_ID         = 'categories'; // _id of the filter inside that doc

/**
 * POST /api/v1/internal/category/sync
 *
 * Called by GDN existQuery (fire-and-forget) after any write to the
 * master `category` ES index. Keeps MongoDB sdui_config in sync so
 * the React SDUI filter dropdown always reflects the latest categories.
 *
 * Body: { cat_id, platform }
 *
 * Steps:
 *   1. Query master `category` ES index by cat_id → get full structured data
 *   2. Upsert that data into MongoDB sdui_config.category.filters[0].options
 *
 * Idempotent — safe to call multiple times for the same cat_id.
 * Does NOT touch any other part of the SDUI config.
 */
async function syncCategory(req, res) {
  const { cat_id } = req.body;

  if (!cat_id) {
    return res.status(400).json({ code: 400, message: 'cat_id is required' });
  }

  // Use any available ES-connected service
  const service = serviceRegistry.getService('gdn')
    || serviceRegistry.getService('facebook')
    || serviceRegistry.getService('instagram');
  if (!service?.db?.elastic) {
    return res.status(503).json({ code: 503, message: 'ES connection not available' });
  }

  try {
    // ── Step 1: Fetch full category from master ES index ───────────────
    const esResult = await service.db.elastic.search({
      index: ES_CATEGORY_INDEX,
      body: {
        size: 1,
        query: { term: { 'cat_id.keyword': String(cat_id) } },
        _source: ['category', 'cat_id', 'platforms', 'subcategory'],
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits || [];

    if (hits.length === 0) {
      return res.status(404).json({
        code: 404,
        message: `cat_id ${cat_id} not found in category ES index`,
      });
    }

    const src   = hits[0]._source;
    const catId = String(src.cat_id);

    // ── Step 2: Build the option object (nested_select shape) ──────────
    const children = (src.subcategory || []).map((s, si) => ({
      _id:                   `sub_${s.sub_cat_id}`,
      filter_id:             FILTER_ID,
      label:                 s.sub_cat,
      value:                 s.sub_cat,
      sub_cat_id:            String(s.sub_cat_id),
      platforms:             s.platforms || [],
      platform_applicability: s.platforms || [],
      rank:                  si + 1,
      selected_by_default:   false,
    }));

    const updatedOption = {
      _id:                   `cat_${catId}`,
      filter_id:             FILTER_ID,
      label:                 src.category,
      value:                 src.category,
      cat_id:                catId,
      platforms:             src.platforms || [],
      platform_applicability: src.platforms || [],
      rank:                  Number(catId),
      selected_by_default:   false,
      children,
    };

    // ── Step 3: Upsert into MongoDB sdui_config ────────────────────────
    const db  = await getDB();
    const doc = await db.collection('sdui_config').findOne({ _id: SDUI_DOC_ID });

    if (!doc) {
      return res.status(404).json({
        code: 404,
        message: 'sdui_config category document not found — run seeder first',
      });
    }

    const filterIdx = (doc.filters || []).findIndex(f => f._id === FILTER_ID);
    if (filterIdx === -1) {
      return res.status(404).json({ code: 404, message: 'categories filter not found in sdui_config' });
    }

    const options     = doc.filters[filterIdx].options || [];
    const existingIdx = options.findIndex(o => o.cat_id === catId);

    if (existingIdx >= 0) {
      // Replace existing option with fresh data from ES (platforms + subcategories may have grown)
      options[existingIdx] = updatedOption;
    } else {
      // New category — append and keep sorted alphabetically
      options.push(updatedOption);
      options.sort((a, b) => a.label.localeCompare(b.label));
    }

    await db.collection('sdui_config').updateOne(
      { _id: SDUI_DOC_ID },
      { $set: { [`filters.${filterIdx}.options`]: options } }
    );

    service.log?.info(`[categorySync] Synced cat_id=${catId} (${src.category}) to MongoDB`);

    return res.status(200).json({
      code:    200,
      message: 'category synced to MongoDB',
      cat_id:  catId,
      label:   src.category,
      synced:  existingIdx >= 0 ? 'updated' : 'inserted',
    });

  } catch (err) {
    service.log?.error('[categorySync] Error', { error: err.message });
    return res.status(500).json({ code: 500, message: 'sync failed', error: err.message });
  }
}

/**
 * POST /api/v1/common/internal/category/sync-all
 *
 * Reads ALL categories from the master ES `category` index and re-syncs
 * every one into MongoDB sdui_config with platform_applicability set.
 * Use this once after deploying the platform_applicability fix to backfill
 * existing categories that were synced without it.
 */
async function syncAllCategories(req, res) {
  const service = serviceRegistry.getService('gdn')
    || serviceRegistry.getService('facebook')
    || serviceRegistry.getService('instagram');
  if (!service?.db?.elastic) {
    return res.status(503).json({ code: 503, message: 'ES connection not available' });
  }

  try {
    // Fetch all categories from ES (up to 1000)
    const esResult = await service.db.elastic.search({
      index: ES_CATEGORY_INDEX,
      body: {
        size: 1000,
        query: { match_all: {} },
        _source: ['category', 'cat_id', 'platforms', 'subcategory'],
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits || [];
    if (hits.length === 0) {
      return res.status(200).json({ code: 200, message: 'No categories found in ES', synced: 0 });
    }

    const db  = await getDB();
    const doc = await db.collection('sdui_config').findOne({ _id: SDUI_DOC_ID });
    if (!doc) {
      return res.status(404).json({ code: 404, message: 'sdui_config category document not found — run seeder first' });
    }

    const filterIdx = (doc.filters || []).findIndex(f => f._id === FILTER_ID);
    if (filterIdx === -1) {
      return res.status(404).json({ code: 404, message: 'categories filter not found in sdui_config' });
    }

    // Build full options array from ES — deduplicate by cat_id (keep entry with most subcategories)
    const catMap = new Map();
    hits.forEach(hit => {
      const src   = hit._source;
      const catId = String(src.cat_id);
      const existing = catMap.get(catId);
      const subCount = (src.subcategory || []).length;
      if (!existing || subCount > (existing.subcategory || []).length) {
        catMap.set(catId, src);
      }
    });

    const options = Array.from(catMap.values()).map(src => {
      const catId = String(src.cat_id);

      const children = (src.subcategory || []).map((s, si) => ({
        _id:                    `sub_${s.sub_cat_id}`,
        filter_id:              FILTER_ID,
        label:                  s.sub_cat,
        value:                  s.sub_cat,
        sub_cat_id:             String(s.sub_cat_id),
        platforms:              s.platforms || [],
        platform_applicability: s.platforms || [],
        rank:                   si + 1,
        selected_by_default:    false,
      }));

      return {
        _id:                    `cat_${catId}`,
        filter_id:              FILTER_ID,
        label:                  src.category,
        value:                  src.category,
        cat_id:                 catId,
        platforms:              src.platforms || [],
        platform_applicability: src.platforms || [],
        rank:                   Number(catId),
        selected_by_default:    false,
        children,
      };
    });

    options.sort((a, b) => a.label.localeCompare(b.label));

    await db.collection('sdui_config').updateOne(
      { _id: SDUI_DOC_ID },
      { $set: { [`filters.${filterIdx}.options`]: options } }
    );

    service.log?.info(`[syncAllCategories] Re-synced ${options.length} categories to MongoDB`);
    return res.status(200).json({ code: 200, message: 'All categories re-synced', synced: options.length });

  } catch (err) {
    service.log?.error('[syncAllCategories] Error', { error: err.message });
    return res.status(500).json({ code: 500, message: 'sync-all failed', error: err.message });
  }
}

module.exports = { syncCategory, syncAllCategories };
