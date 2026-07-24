'use strict';

/**
 * Network Registry — single source of truth for all ad network identifiers.
 *
 * Replaces the duplicated platform arrays scattered across:
 *   - planAccess.js (ALL_PLATFORMS)
 *   - planAccessSeed.js (ALL_PLATFORMS)
 *   - restructure2026.js (TIER_PLATFORMS)
 *   - planCatalog.js (platform arrays per plan)
 *   - authRoutes.js (ALL_PLATFORMS in /plan-access)
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §6.3.
 */

/**
 * @typedef {Object} NetworkDefinition
 * @property {string} id                  - Lowercase canonical identifier (e.g. 'facebook')
 * @property {string} label               - Display label (e.g. 'Facebook')
 * @property {'active'|'deprecated'|'planned'} status
 * @property {string[]} aliases           - Alternate IDs that should resolve to this network
 * @property {boolean} supportsGeneralAccess - Can this network appear in general plan access?
 */

/** @type {NetworkDefinition[]} */
const NETWORK_DEFINITIONS = [
  {
    id: 'facebook',
    label: 'Facebook',
    status: 'active',
    aliases: ['fb'],
    supportsGeneralAccess: true,
  },
  {
    id: 'instagram',
    label: 'Instagram',
    status: 'active',
    aliases: ['ig', 'insta'],
    supportsGeneralAccess: true,
  },
  {
    id: 'youtube',
    label: 'YouTube',
    status: 'active',
    aliases: ['yt'],
    supportsGeneralAccess: true,
  },
  {
    id: 'google',
    label: 'Google',
    status: 'active',
    aliases: ['google_ads'],
    supportsGeneralAccess: true,
  },
  {
    id: 'gdn',
    label: 'GDN',
    status: 'active',
    aliases: ['google_display_network'],
    supportsGeneralAccess: true,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    status: 'active',
    aliases: ['li'],
    supportsGeneralAccess: true,
  },
  {
    id: 'reddit',
    label: 'Reddit',
    status: 'active',
    aliases: [],
    supportsGeneralAccess: true,
  },
  {
    id: 'quora',
    label: 'Quora',
    status: 'active',
    aliases: [],
    supportsGeneralAccess: true,
  },
  {
    id: 'pinterest',
    label: 'Pinterest',
    status: 'active',
    aliases: ['pin'],
    supportsGeneralAccess: true,
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    status: 'active',
    aliases: ['tt'],
    supportsGeneralAccess: true,
  },
  {
    id: 'native',
    label: 'Native',
    status: 'active',
    aliases: ['native_ads'],
    supportsGeneralAccess: true,
  },
];

// ─── Derived lookups (built once at module load) ────────────────────────────

/** All active network IDs. */
const ALL_NETWORK_IDS = NETWORK_DEFINITIONS
  .filter((n) => n.status === 'active')
  .map((n) => n.id);

/** Frozen set for O(1) membership checks. */
const ACTIVE_NETWORK_SET = new Set(ALL_NETWORK_IDS);

/** Map: any alias or canonical ID → canonical network ID. */
const _aliasMap = new Map();
for (const net of NETWORK_DEFINITIONS) {
  _aliasMap.set(net.id, net.id);
  for (const alias of net.aliases) {
    _aliasMap.set(alias.toLowerCase(), net.id);
  }
}

/** Map: canonical ID → full definition. */
const _definitionMap = new Map();
for (const net of NETWORK_DEFINITIONS) {
  _definitionMap.set(net.id, net);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve an ID or alias to the canonical network ID.
 * @param {string} idOrAlias
 * @returns {string|null} Canonical ID or null if not found.
 */
function resolveNetworkId(idOrAlias) {
  if (!idOrAlias) return null;
  return _aliasMap.get(String(idOrAlias).toLowerCase()) || null;
}

/**
 * Get the full network definition by ID or alias.
 * @param {string} idOrAlias
 * @returns {NetworkDefinition|null}
 */
function getNetworkDefinition(idOrAlias) {
  const canonical = resolveNetworkId(idOrAlias);
  if (!canonical) return null;
  return _definitionMap.get(canonical) || null;
}

/**
 * Check if a network ID (or alias) is a known active network.
 * @param {string} idOrAlias
 * @returns {boolean}
 */
function isActiveNetwork(idOrAlias) {
  const canonical = resolveNetworkId(idOrAlias);
  return canonical !== null && ACTIVE_NETWORK_SET.has(canonical);
}

/**
 * Get all active network definitions.
 * @returns {NetworkDefinition[]}
 */
function getAllActiveNetworks() {
  return NETWORK_DEFINITIONS.filter((n) => n.status === 'active');
}

/**
 * Validate an array of network IDs — returns { valid, invalid, resolved }.
 * @param {string[]} ids
 * @returns {{ valid: string[], invalid: string[], resolved: string[] }}
 */
function validateNetworkIds(ids) {
  const valid = [];
  const invalid = [];
  const resolved = [];
  for (const id of ids || []) {
    const canonical = resolveNetworkId(id);
    if (canonical && ACTIVE_NETWORK_SET.has(canonical)) {
      valid.push(id);
      resolved.push(canonical);
    } else {
      invalid.push(id);
    }
  }
  return { valid, invalid, resolved: [...new Set(resolved)] };
}

module.exports = {
  NETWORK_DEFINITIONS,
  ALL_NETWORK_IDS,
  ACTIVE_NETWORK_SET,
  resolveNetworkId,
  getNetworkDefinition,
  isActiveNetwork,
  getAllActiveNetworks,
  validateNetworkIds,
};
