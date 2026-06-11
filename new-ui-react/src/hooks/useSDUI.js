import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchSDUIConfig } from '../services/sduiService';
import { useSDUIPolling } from './useSDUIPolling';

const LS_FILTERS_KEY = 'sdui.filterValues';
const LS_PLATFORMS_KEY = 'sdui.activePlatforms';

const loadLS = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        const parsed = JSON.parse(raw);
        // Strip internal-only keys that should never persist across sessions
        if (key === LS_FILTERS_KEY && parsed && typeof parsed === 'object') {
            delete parsed._autoSortField;
        }
        return parsed;
    } catch {
        return fallback;
    }
};

/**
 * useSDUI — The central SDUI state hook.
 * Replaces the old useFilters with a fully dynamic, config-driven approach.
 *
 * Instead of one state variable per filter (selCategories, selCTAs, ...),
 * it keeps a single `filterValues` object keyed by filter ID.
 */
export function useSDUI() {
    // ── Config state ────────────────────────────────────────────────────────
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // ── Filter values — dynamic, keyed by filter._id ────────────────────────
    const [filterValues, setFilterValues] = useState(() => loadLS(LS_FILTERS_KEY, {}));

    // ── Platform state ──────────────────────────────────────────────────────
    const [activePlatforms, setActivePlatforms] = useState(() => loadLS(LS_PLATFORMS_KEY, []));
    const [platformFilterMatrix, setPlatformFilterMatrix] = useState({});``

    // Refs to avoid circular deps — always up to date
    const activePlatformsRef = useRef(activePlatforms);
    activePlatformsRef.current = activePlatforms;

    const platformFilterMatrixRef = useRef(platformFilterMatrix);
    platformFilterMatrixRef.current = platformFilterMatrix;

    // ── Apply a config (initial or from polling) — NO deps on activePlatforms ─
    const applyConfig = useCallback((cfg) => {
        setConfig(cfg);
        setError(null);

        // Extract platform filter matrix from the platforms navbar document
        const platformsDoc = cfg?.navbar?.find(d => d._id === 'platforms');
        if (platformsDoc) {
            const matrixFilter = platformsDoc.filters?.find(f => f.platform_filter_matrix);
            if (matrixFilter) {
                setPlatformFilterMatrix(matrixFilter.platform_filter_matrix);
            }

            // Set default active platforms ONLY if none are selected yet (use ref to avoid dep)
            if (activePlatformsRef.current.length === 0) {
                const defaults = [];
                platformsDoc.filters?.forEach(f => {
                    f.options?.forEach(opt => {
                        if (opt.selected_by_default) {
                            defaults.push(opt.value);
                        }
                    });
                });
                if (defaults.length > 0) {
                    setActivePlatforms(defaults);
                } else {
                    const all = [];
                    platformsDoc.filters?.forEach(f => {
                        f.options?.forEach(opt => all.push(opt.value));
                    });
                    setActivePlatforms(all);
                }
            }
        }

        // Fallback: if config has no platforms doc, default to all platforms
        if (!platformsDoc && activePlatformsRef.current.length === 0) {
            setActivePlatforms(['facebook', 'instagram', 'youtube', 'linkedin', 'google', 'native', 'reddit', 'pinterest', 'tiktok']);
        }
    }, []); // No deps — uses ref for activePlatforms

    // ── Initial fetch ───────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                setLoading(true);
                const cfg = await fetchSDUIConfig();
                if (cancelled) return;
                applyConfig(cfg);
            } catch (err) {
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applyConfig]);

    // ── Re-fetch config when platforms change ─────────────────────────────
    const isInitialMount = useRef(true);
    // Track all platform values count to detect "ALL" selection
    const allPlatformCountRef = useRef(0);
    useEffect(() => {
        // Skip on initial mount (initial fetch handles it)
        if (isInitialMount.current) {
            isInitialMount.current = false;
            // Store initial "all" count for comparison
            allPlatformCountRef.current = activePlatforms.length;
            return;
        }

        // If activePlatforms includes all platforms, treat as "ALL" — no param needed
        const isAll = activePlatforms.length === 0 || activePlatforms.length >= allPlatformCountRef.current;

        let cancelled = false;
        const reload = async () => {
            try {
                const cfg = await fetchSDUIConfig(isAll ? {} : { platforms: activePlatforms });
                if (!cancelled) applyConfig(cfg);
            } catch (err) {
                if (!cancelled) console.warn('Platform config re-fetch failed:', err.message);
            }
        };
        reload();
        return () => { cancelled = true; };
    }, [activePlatforms, applyConfig]);

    // ── Polling for config changes ──────────────────────────────────────────
    const handleConfigChanged = useCallback((freshConfig) => {
        applyConfig(freshConfig);
    }, [applyConfig]);

    useSDUIPolling(config?.config_version || 0, handleConfigChanged);

    // ── Persist filterValues + activePlatforms to localStorage ──────────────
    useEffect(() => {
        try {
            const { _autoSortField, ...toStore } = filterValues;
            localStorage.setItem(LS_FILTERS_KEY, JSON.stringify(toStore));
        } catch {}
    }, [filterValues]);

    useEffect(() => {
        try { localStorage.setItem(LS_PLATFORMS_KEY, JSON.stringify(activePlatforms)); } catch {}
    }, [activePlatforms]);

    // ── Filter setters — stable references ──────────────────────────────────
    const setFilter = useCallback((filterId, value) => {
        setFilterValues(prev => {
            const next = { ...prev, [filterId]: value };
            if (filterId === '_autoSortField') return next;
            const isRangeValue = Array.isArray(value) && value.length === 2 &&
                typeof value[0] === 'number' && typeof value[1] === 'number';
            if (isRangeValue) {
                // This slider was just changed — it becomes the auto-sort priority
                next._autoSortField = filterId;
            } else if (prev._autoSortField === filterId) {
                // This slider was cleared — remove the auto-sort hint
                delete next._autoSortField;
            }
            return next;
        });
    }, []);

    const setAllFilters = useCallback((next) => {
        setFilterValues(next || {});
    }, []);

    const getFilter = useCallback((filterId) => {
        return filterValues[filterId];
    }, [filterValues]);

    const clearAll = useCallback(() => {
        setFilterValues({});
    }, []);

    // Clear any active filters whose platform_applicability doesn't include
    // any of the incoming platforms. Called when the user switches platform tabs.
    const clearFiltersUnsupportedBy = useCallback((newPlatforms) => {
        if (!config || !newPlatforms?.length) return;
        const allFilters = [
            ...(config.searchbar?.flatMap(d => d.filters) || []),
            ...(config.navbar?.flatMap(d => d.filters) || []),
            ...(config.sidebar?.flatMap(d => d.filters) || []),
        ];
        setFilterValues(prev => {
            const next = { ...prev };
            for (const [filterId, value] of Object.entries(prev)) {
                const isActive = Array.isArray(value) ? value.length > 0
                    : value !== null && value !== undefined && value !== '';
                if (!isActive) continue;
                const filter = allFilters.find(f =>
                    f._id === filterId || (f.query_param && f.query_param === filterId)
                );
                if (!filter) continue;
                const pa = filter.platform_applicability;
                if (!pa || pa === 'all') continue;
                const list = Array.isArray(pa) ? pa : [pa];
                const supported = newPlatforms.some(p => list.includes(p));
                if (!supported) {
                    next[filterId] = Array.isArray(value) ? [] : '';
                }
            }
            return next;
        });
    }, [config]);

    // ── Count active filters ────────────────────────────────────────────────
    // 'adcategory' is a parent-marker helper — exclude it from the count.
    // 'subcategory' counts as 1 if any items are selected (category-wise, not per-subcategory).
    const totalActiveFilters = useMemo(() => {
        const EXCLUDED_KEYS = new Set(['adcategory', '_autoSortField']);
        return Object.entries(filterValues).reduce((total, [key, v]) => {
            if (EXCLUDED_KEYS.has(key)) return total;
            if (Array.isArray(v)) return total + (v.length > 0 ? 1 : 0);
            if (typeof v === 'boolean') return total + (v ? 1 : 0);
            if (v === null || v === undefined || v === '') return total;
            return total + 1;
        }, 0);
    }, [filterValues]);

    // ── Effective platforms — restricted by active platform-specific filters ──
    // If a filter that is active has platform_applicability restricted to specific
    // networks (e.g. "native"), only those networks should be queried.
    const effectivePlatforms = useMemo(() => {
        if (!config) return activePlatforms;

        const allFilters = [
            ...(config.searchbar?.flatMap(d => d.filters) || []),
            ...(config.navbar?.flatMap(d => d.filters) || []),
            ...(config.sidebar?.flatMap(d => d.filters) || []),
        ];

        const restrictedPlatforms = new Set();

        for (const [filterId, value] of Object.entries(filterValues)) {
            // Skip inactive filter values
            const isActive = Array.isArray(value) ? value.length > 0
                : value !== null && value !== undefined && value !== '';
            if (!isActive) continue;

            // Match filter by _id OR by query_param, with aliases for known mismatched keys
            const filter = allFilters.find(f =>
                f._id === filterId ||
                (f.query_param && f.query_param === filterId) ||
                (filterId === 'sorting' && (f._id === 'sort_by' || f.query_param === 'sortBy')) ||
                (filterId === 'ad_type' && (f._id === 'ad_types' || f._id === 'ad_type_filter' || f.query_param === 'ad_type' || f.group_id === 'ad_type'))
            );
            if (!filter) continue;

            // Check option-level platform_applicability first (more specific).
            // e.g. COMPANION/IN-STREAM options have platform_applicability: ["youtube"]
            // even though the filter itself allows ["facebook","youtube"].
            let optionLevelMatched = false;
            if (filter.options && value) {
                const selectedVal = Array.isArray(value) ? value : [value];
                const optionPlatforms = new Set();
                for (const sel of selectedVal) {
                    const opt = filter.options.find(o => o.value === sel || o._id === sel);
                    if (!opt) continue;
                    const opa = opt.platform_applicability;
                    if (!opa || opa === 'all') continue;
                    const olist = Array.isArray(opa) ? opa : [opa];
                    olist.forEach(p => optionPlatforms.add(p));
                    optionLevelMatched = true;
                }
                if (optionLevelMatched) {
                    optionPlatforms.forEach(p => restrictedPlatforms.add(p));
                    continue;
                }
            }

            // Fall back to filter-level platform_applicability
            const pa = filter.platform_applicability;
            if (pa && pa !== 'all') {
                const list = Array.isArray(pa) ? pa : [pa];
                list.forEach(p => restrictedPlatforms.add(p));
            }
        }

        if (restrictedPlatforms.size === 0) return activePlatforms;

        // Intersect with activePlatforms so we never query a platform the user hasn't selected.
        // If intersection is empty (e.g. gender filter active but user is on Reddit tab),
        // return activePlatforms so the API is called with the correct network and returns
        // "No ads found" rather than silently querying the filter's home platform.
        const intersected = activePlatforms.filter(p => restrictedPlatforms.has(p));
        return intersected.length > 0 ? intersected : activePlatforms;
    }, [config, filterValues, activePlatforms]);

    // ── Build query params from filter values + config ──────────────────────
    const buildQueryParams = useCallback(() => {
        if (!config) return {};
        const params = {};
        const allFilters = [
            ...(config.searchbar?.flatMap(d => d.filters) || []),
            ...(config.navbar?.flatMap(d => d.filters) || []),
            ...(config.sidebar?.flatMap(d => d.filters) || []),
        ];

        for (const [filterId, value] of Object.entries(filterValues)) {
            const filter = allFilters.find(f => f._id === filterId);
            if (filter?.query_param && value != null) {
                if (Array.isArray(value) && value.length > 0) {
                    params[filter.query_param] = value.join(',');
                } else if (!Array.isArray(value)) {
                    params[filter.query_param] = value;
                }
            }
        }

        return params;
    }, [config, filterValues]);

    // ── Platform visibility check — stable references ───────────────────────
    // 1. Normalises platform_applicability — handles both string and array.
    // 2. Also checks platformFilterMatrix — if the active platform restricts
    //    to specific filter groups, only those groups are shown.
    const matchesPlatform = (pa, groupId) => {
        const platforms = activePlatformsRef.current;
        const matrix = platformFilterMatrixRef.current;

        // Check platform_applicability (string or array)
        if (pa && pa !== 'all') {
            if (!platforms.length) return true;
            const list = Array.isArray(pa) ? pa : [pa];
            if (!list.some(p => platforms.includes(p))) return false;
            // Explicit platform_applicability matched — skip matrix check.
            // platform_applicability is the more specific rule and takes priority.
            return true;
        }

        // Check platformFilterMatrix — platforms that have a whitelist
        if (groupId && Object.keys(matrix).length > 0) {
            const restrictedPlatforms = platforms.filter(p => matrix[p]);
            if (restrictedPlatforms.length > 0) {
                // Show filter only if at least one active platform allows it
                return restrictedPlatforms.some(p => matrix[p].includes(groupId));
            }
        }

        return true;
    };

    const shouldShowFilter = useCallback((filter) => {
        if (!filter || filter.visible === false) return false;

        // If any child filter has platform_applicability, use that to decide visibility.
        // If a child explicitly matches the active platform, show the section (skip matrix check).
        // If no child matches, hide the section.
        if (filter.filters?.length > 0) {
            const childPAs = filter.filters
                .map(f => f.platform_applicability)
                .filter(pa => pa && pa !== 'all');
            if (childPAs.length > 0) {
                const platforms = activePlatformsRef.current;
                const anyChildMatches = childPAs.some(pa => {
                    const list = Array.isArray(pa) ? pa : [pa];
                    return list.some(p => platforms.includes(p));
                });
                if (!anyChildMatches) return false;
                // A child explicitly declared this platform — skip matrix check
                return true;
            }
        }

        return matchesPlatform(filter.platform_applicability, filter.group_id || filter._id);
    }, [activePlatforms, platformFilterMatrix]);

    const shouldShowOption = useCallback((option) => {
        if (!option) return false;
        return matchesPlatform(option.platform_applicability, null);
    }, [activePlatforms]);

    const isDependencySatisfied = useCallback((filter) => {
        if (!filter.depends_on) return true;
        const depValue = filterValues[filter.depends_on];
        if (Array.isArray(depValue)) return depValue.length > 0;
        return !!depValue;
    }, [filterValues]);

    // ── Backward-compatible getters (for existing components during migration) ─
    const selCategories = filterValues.category || filterValues.categories || [];
    const selAdTypes = filterValues.ad_type || filterValues.ad_types || [];
    const selCTAs = filterValues.cta || filterValues.ctas || [];
    const selCountries = filterValues.country_filter || filterValues.country || filterValues.countries || [];
    const sortBy = filterValues.sorting || '';

    return {
        // Config
        config,
        loading,
        error,

        // Filter state
        filterValues,
        setFilter,
        setAllFilters,
        getFilter,
        clearAll,
        clearFiltersUnsupportedBy,
        totalActiveFilters,
        buildQueryParams,

        // Platform state
        activePlatforms,
        effectivePlatforms,
        setActivePlatforms,
        platformFilterMatrix,

        // Visibility helpers
        shouldShowFilter,
        shouldShowOption,
        isDependencySatisfied,

        // Backward-compatible (migration period)
        selCategories,
        setSelCategories: (v) => setFilter('category', typeof v === 'function' ? v(selCategories) : v),
        selAdTypes,
        setSelAdTypes: (v) => setFilter('ad_type', typeof v === 'function' ? v(selAdTypes) : v),
        selCTAs,
        setSelCTAs: (v) => setFilter('cta', typeof v === 'function' ? v(selCTAs) : v),
        selCountries,
        setSelCountries: (v) => setFilter('country_filter', typeof v === 'function' ? v(selCountries) : v),
        sortBy,
        setSortBy: (v) => {
            const SORT_VALUE_NORMALIZE = {
                'ad running days': 'running_days',
                'running longest': 'running_days',
                'days running': 'running_days',
                'running_longest': 'running_days',
                'domain registration date': 'domain_sort',
                'domain reg date': 'domain_sort',
                'domain_reg_sort': 'domain_sort',
                '-domain_reg_date': 'domain_sort',
            };
            const normalized = SORT_VALUE_NORMALIZE[(v || '').toLowerCase().trim()] || v;
            setFilter('sorting', normalized);
        },
        // All ad type options with platform_applicability from config
        adTypeOptions: (() => {
            const allDocs = [...(config?.sidebar || []), ...(config?.navbar || [])];
            for (const doc of allDocs) {
                const f = (doc.filters || []).find(f =>
                    f._id === 'ad_types' || f._id === 'ad_type_filter' ||
                    f._id === 'ad_type' || f.query_param === 'ad_type' || f.group_id === 'ad_type'
                );
                if (f?.options?.length > 0) return f.options;
            }
            return [];
        })(),
        // Dynamic platform support map built from config platform_applicability.
        // Keyed by filter _id → array of supported platform strings.
        // Used by buildSearchPayload and AdGrid to gate filter fields per platform.
        filterPlatformSupport: (() => {
            if (!config) return {};
            const allFilters = [
                ...(config.searchbar?.flatMap(d => d.filters) || []),
                ...(config.navbar?.flatMap(d => d.filters) || []),
                ...(config.sidebar?.flatMap(d => d.filters) || []),
            ];
            const map = {};
            for (const f of allFilters) {
                if (!f._id) continue;
                const pa = f.platform_applicability;
                if (!pa || pa === 'all') continue;
                map[f._id] = Array.isArray(pa) ? pa : [pa];
            }
            return map;
        })(),
    };
}
