'use strict';

const crypto = require('crypto');
const { getDB } = require('../db');
const { buildSDUIDocuments } = require('../seed/seedData');

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
  const docs = dbDocs.length > 0 ? dbDocs : buildSDUIDocuments();

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

  // Extract platform_filter_matrix from the navbar "platforms" document
  const platformsDoc = (config.navbar || []).find(d => d._id === 'platforms');
  const matrix = platformsDoc?.filters?.[0]?.platform_filter_matrix || {};

  // Build a set of sidebar section IDs that are allowed for selected platforms
  const allowedSidebarIds = new Set();
  for (const p of platforms) {
    for (const sectionId of (matrix[p] || [])) {
      allowedSidebarIds.add(sectionId);
    }
  }

  const filtered = {};
  for (const [type, docs] of Object.entries(config)) {
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
            .filter(f => matchesPlatform(f.platform_applicability, platforms))
            .map(f => {
              if (!f.options) return f;
              const newF = { ...f };
              newF.options = f.options
              .filter(o => matchesPlatform(o.platform_applicability, platforms))
              .map(o => {
                if (!o.children) return o;
                return {
                  ...o,
                  children: o.children.filter(c =>
                    matchesPlatform(c.platform_applicability, platforms)
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
