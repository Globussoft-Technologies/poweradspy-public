/**
 * sduiNormalizer.js
 * Sorts, filters, and normalizes the raw SDUI API response into a clean shape
 * the frontend can consume without further transformation.
 */

/**
 * Normalizes platform_applicability into a consistent array.
 * Input can be "all", a single string, or an array.
 */
function normalizePlatformApplicability(value) {
    if (!value || value === 'all') return 'all';
    if (Array.isArray(value)) return value;
    return [value];
}

/**
 * Sorts an array by `rank` ascending, falling back to original order.
 */
function sortByRank(arr) {
    if (!Array.isArray(arr)) return [];
    return [...arr].filter(Boolean).sort((a, b) => (a?.rank ?? 999) - (b?.rank ?? 999));
}

/**
 * Normalizes a single SDUIOption (and its children recursively).
 */
function normalizeOption(option) {
    if (!option) return null;
    return {
        ...option,
        platform_applicability: normalizePlatformApplicability(option.platform_applicability),
        children: Array.isArray(option.children) ? sortByRank(option.children).map(normalizeOption).filter(Boolean) : [],
        // Legacy compat: some options may use sub_options instead of children
        ...(option.sub_options && !option.children
            ? { children: sortByRank(option.sub_options).map(normalizeOption).filter(Boolean) }
            : {}),
    };
}

/**
 * Normalizes a single SDUIFilter.
 */
function normalizeFilter(filter) {
    if (!filter) return null;
    return {
        ...filter,
        platform_applicability: normalizePlatformApplicability(filter.platform_applicability),
        options: Array.isArray(filter.options) ? sortByRank(filter.options).map(normalizeOption).filter(Boolean) : [],
        suggestion_sources: Array.isArray(filter.suggestion_sources) ? sortByRank(filter.suggestion_sources) : [],
        search_variants: Array.isArray(filter.search_variants) ? sortByRank(filter.search_variants) : [],
    };
}

/**
 * Normalizes a single SDUIDocument.
 */
function normalizeDocument(doc) {
    if (!doc) return null;
    return {
        ...doc,
        filters: Array.isArray(doc.filters) ? sortByRank(doc.filters).map(normalizeFilter).filter(Boolean) : [],
    };
}

/**
 * Main normalizer: takes the raw API response and returns a clean, sorted, filtered config.
 * Removes invisible documents and filters.
 *
 * @param {Object} rawConfig - Raw response from GET /api/sdui/config (or /api/v1/sdui/config)
 * @param {Object} options
 * @param {boolean} options.includeInvisible - If true, keep visible:false items (for admin views)
 * @returns {{ schema_version: string, config_version: number, searchbar: Array, navbar: Array, sidebar: Array }}
 */
export function normalizeSDUIConfig(rawConfig, options = {}) {
    if (!rawConfig) return { schema_version: '', config_version: 0, searchbar: [], navbar: [], sidebar: [] };

    const { includeInvisible = false } = options;

    const normalize = (section) => {
        if (!Array.isArray(section)) return [];

        let docs = sortByRank(section).map(normalizeDocument).filter(Boolean);

        if (!includeInvisible) {
            // Remove invisible documents
            docs = docs.filter(d => d.visible !== false);
            // Remove invisible filters within each document
            docs = docs.map(d => ({
                ...d,
                filters: d.filters.filter(f => f.visible !== false),
            }));
        }

        return docs;
    };

    return {
        schema_version: rawConfig.schema_version || '',
        config_version: rawConfig.config_version || 0,
        searchbar: normalize(rawConfig.searchbar),
        navbar: normalize(rawConfig.navbar),
        sidebar: normalize(rawConfig.sidebar),
    };
}
