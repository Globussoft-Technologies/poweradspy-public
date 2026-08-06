'use strict';

const crypto = require('crypto');
const { getDB } = require('../db');
const { buildSDUIDocuments } = require('../seed/seedData');
const networks = require('../../../config/networks');

const ADMOB_PLATFORM_OPTION = {
  _id: 'admob',
  filter_id: 'platform_selector',
  label: 'AdMob',
  value: 'admob',
  rank: 12,
  selected_by_default: true,
  icon_url: '/admob.svg',
  icon_type: 'url',
};

const ADMOB_SIDEBAR_IDS = ['country', 'source', 'admob_network', 'ad_position', 'ad_sub_position', 'image_size', 'source_app'];
const ADMOB_NETWORK_FILTER = {
  _id: 'admob_network_filter',
  group_id: 'source',
  label: 'Network',
  type: 'checkbox',
  rank: 2,
  query_param: 'subNetwork',
  multi_select: true,
  visible: true,
  platform_applicability: ['admob'],
  options: [{
    _id: 'admob_network_gdn',
    filter_id: 'admob_network_filter',
    label: 'GDN',
    value: 'gdn',
    rank: 1,
    selected_by_default: false,
    platform_applicability: ['admob'],
  }],
};

const ADMOB_OPTION_DEFAULTS = {
  ad_position_filter: [{ label: 'Middle', value: 'MIDDLE' }],
  image_size_filter: [{ label: '1080 * 159', value: '1080*159' }],
};

function mergeAdmobOptions(filter) {
  const options = (filter.options || []).map((option) => ({
    ...option,
    platform_applicability: ['admob'],
  }));
  for (const [index, option] of (ADMOB_OPTION_DEFAULTS[filter._id] || []).entries()) {
    if (options.some((existing) => String(existing.value).toLowerCase() === option.value.toLowerCase())) continue;
    options.push({
      _id: `admob_${filter._id}_${index + 1}`,
      filter_id: filter._id,
      ...option,
      rank: options.length + 1,
      selected_by_default: false,
      platform_applicability: ['admob'],
    });
  }
  return options;
}

function prepareAdmobSidebar(config) {
  let hasAdmobNetworkDocument = false;
  const prepared = {
    ...config,
    navbar: (config.navbar || []).map((doc) => ({
      ...doc,
      filters: (doc.filters || []).map((filter) => ({
        ...filter,
        platform_filter_matrix: filter.platform_filter_matrix
          ? { ...filter.platform_filter_matrix, admob: ADMOB_SIDEBAR_IDS }
          : filter.platform_filter_matrix,
      })),
    })),
    sidebar: (config.sidebar || []).map((doc) => {
      if (doc._id === 'admob_network') hasAdmobNetworkDocument = true;
      if (!ADMOB_SIDEBAR_IDS.includes(doc._id)) return doc;

      const filters = (doc.filters || []).map((filter) => ({
        ...filter,
        platform_applicability: ['admob'],
        options: mergeAdmobOptions(filter),
      }));

      if (doc._id === 'source') {
        const sourceFilter = filters.find((filter) => filter._id === 'source_filter');
        if (sourceFilter) {
          sourceFilter.options = sourceFilter.options.filter(
            (option) => String(option.value).toLowerCase() === 'android'
          );
        }
      }

      return {
        ...doc,
        title: doc._id === 'source' ? 'SOURCE' : doc.title,
        filters,
      };
    }),
  };

  if (!hasAdmobNetworkDocument) {
    prepared.sidebar.push({
      _id: 'admob_network',
      config_type: 'sidebar',
      title: 'NETWORK',
      rank: 18,
      collapsed_by_default: false,
      visible: true,
      display_mode: 'accordion',
      meta: 'Filter AdMob ads by their source network.',
      filters: [{
        ...ADMOB_NETWORK_FILTER,
        group_id: 'admob_network',
        options: ADMOB_NETWORK_FILTER.options.map((option) => ({ ...option })),
      }],
      flag: true,
    });
  }

  return prepared;
}

function includeAdmobPlatform(docs) {
  const platforms = docs.find((doc) => doc?._id === 'platforms');
  const selector = platforms?.filters?.find((filter) => filter?._id === 'platform_selector');
  if (!selector) return docs;
  selector.options ||= [];
  if (!networks.admob?.enabled) {
    selector.options = selector.options.filter((option) => option?.value !== 'admob');
    return docs;
  }
  if (!selector.options.some((option) => option?.value === 'admob')) {
    selector.options.push({ ...ADMOB_PLATFORM_OPTION });
  }
  selector.platform_filter_matrix ||= {};
  selector.platform_filter_matrix.admob = ADMOB_SIDEBAR_IDS;
  return docs;
}

/**
 * GET /api/sdui/config
 * Returns all SDUI config documents grouped by config_type.
 * Supports ETag-based HTTP caching.
 */
async function getSDUIConfig() {
  let dbDocs = [];

  try {
    const db = await getDB();
    dbDocs = await db.collection('sdui_config').find({}).toArray();
  } catch (err) {
    // DB connection failed — fall through to seed fallback
  }

  // Use MongoDB as the source of truth. Fall back to seed only if DB is empty.
  const docs = includeAdmobPlatform(dbDocs.length > 0 ? dbDocs : buildSDUIDocuments());

  // Pre-seed known types, but also accept any new config_type dynamically
  const result = {
    searchbar: [],
    navbar: [],
    sidebar: [],
  };

  for (const doc of docs) {
    const type = doc.config_type;
    if (!type) continue;
    if (!result[type]) result[type] = [];
    result[type].push(doc);
  }

  return result;
}

/**
 * Check if a platform_applicability value matches the selected platforms.
 * - If applicability is missing, 'all', or not an array → always matches (common/universal).
 * - If applicability is an array → matches if at least one platform overlaps.
 */
function matchesPlatform(applicability, platforms) {
  if (!applicability || applicability === 'all') return true;
  if (!Array.isArray(applicability)) return true;
  return applicability.some(p => platforms.includes(p));
}

/**
 * Filter SDUI config by selected platforms.
 *
 * Filtering happens at 3 levels:
 *   1. Document level — sidebar docs checked against platform_filter_matrix
 *   2. Filter level   — filter.platform_applicability
 *   3. Option level   — option.platform_applicability (absent = common, shown for all)
 *
 * @param {Object} config  Grouped config: { searchbar: [...], navbar: [...], sidebar: [...] }
 * @param {string[]} platforms  e.g. ['facebook', 'youtube']
 * @returns {Object} Filtered config with identical structure
 */
function filterConfigByPlatforms(config, platforms) {
  if (!platforms || !platforms.length) return config;

  const normalizedPlatforms = platforms.map((platform) => String(platform).toLowerCase());
  const sourceConfig = normalizedPlatforms.length === 1 && normalizedPlatforms[0] === 'admob'
    ? prepareAdmobSidebar(config)
    : config;

  // Extract platform_filter_matrix from the navbar "platforms" document
  const platformsDoc = (sourceConfig.navbar || []).find(d => d._id === 'platforms');
  const matrix = platformsDoc?.filters?.[0]?.platform_filter_matrix || {};

  // Build a set of sidebar section IDs that are allowed for selected platforms
  const allowedSidebarIds = new Set();
  for (const p of normalizedPlatforms) {
    for (const sectionId of (matrix[p] || [])) {
      allowedSidebarIds.add(sectionId);
    }
  }

  const filtered = {};
  for (const [type, docs] of Object.entries(sourceConfig)) {
    filtered[type] = docs
      .filter(doc => {
        // Sidebar docs: only keep if listed in the matrix for selected platforms
        if (type === 'sidebar' && allowedSidebarIds.size > 0) {
          return allowedSidebarIds.has(doc._id);
        }
        return true;
      })
      .map(doc => {
        const newDoc = { ...doc };
        if (newDoc.filters) {
          newDoc.filters = newDoc.filters
            .filter(f => matchesPlatform(f.platform_applicability, normalizedPlatforms))
            .map(f => {
              if (!f.options) return f;
              const newF = { ...f };
              newF.options = f.options
              .filter(o => matchesPlatform(o.platform_applicability, normalizedPlatforms))
              .map(o => {
                if (!o.children) return o;
                return {
                  ...o,
                  children: o.children.filter(c =>
                    matchesPlatform(c.platform_applicability, normalizedPlatforms)
                  ),
                };
              });
              return newF;
            })
            .filter(f => !f.options || f.options.length > 0);
        }
        return newDoc;
      })
      .filter(doc => !doc.filters || doc.filters.length > 0);
  }
  return filtered;
}

/**
 * Compute ETag (MD5 hex of JSON body) - same algorithm as Go backend.
 */
function computeETag(body) {
  return `"${crypto.createHash('md5').update(body).digest('hex')}"`;
}

/**
 * Compute numeric version from MD5 hash - same algorithm as Go backend.
 */
function computeVersion(body) {
  const hash = crypto.createHash('md5').update(body).digest();
  // Read first 8 bytes as big-endian int64 (same as Go: binary.BigEndian.Uint64)
  const hi = hash.readUInt32BE(0);
  const lo = hash.readUInt32BE(4);
  return hi * 0x100000000 + lo;
}

module.exports = { getSDUIConfig, filterConfigByPlatforms, computeETag, computeVersion };
