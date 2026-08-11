import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchSDUIConfig } from '../services/sduiService';
import { useSDUIPolling } from './useSDUIPolling';
import { ADMOB_FRONTEND_ENABLED } from '../constants';

const FILTERS_STORAGE_KEY = 'sdui.filterValues';
const PLATFORMS_STORAGE_KEY = 'sdui.activePlatforms';

const withoutDisabledPlatforms = (platforms) => {
    const values = Array.isArray(platforms) ? platforms : [];
    if (ADMOB_FRONTEND_ENABLED) return values;
    return values.filter(platform => String(platform).toLowerCase() !== 'admob');
};

const withoutDisabledPlatformConfig = (cfg) => {
    if (ADMOB_FRONTEND_ENABLED || !cfg?.navbar) return cfg;
    return {
        ...cfg,
        navbar: cfg.navbar.map(doc => {
            if (doc?._id !== 'platforms') return doc;
            return {
                ...doc,
                filters: (doc.filters || []).map(filter => {
                    const matrix = { ...(filter.platform_filter_matrix || {}) };
                    delete matrix.admob;
                    return {
                        ...filter,
                        options: (filter.options || []).filter(
                            option => String(option?.value).toLowerCase() !== 'admob'
                        ),
                        ...(filter.platform_filter_matrix ? { platform_filter_matrix: matrix } : {}),
                    };
                }),
            };
        }),
    };
};

const loadTabState = (key, fallback) => {
    try {
        const raw = sessionStorage.getItem(key);
        if (raw == null) return fallback;
        const parsed = JSON.parse(raw);
        // Strip internal-only keys that should never persist across sessions
        if (key === FILTERS_STORAGE_KEY && parsed && typeof parsed === 'object') {
            delete parsed._autoSortField;
        }
        return parsed;
    } catch {
        return fallback;
    }
};

const normalizeStoredValue = (value) => String(value ?? '').trim().toLowerCase();

const DATE_FILTER_STATE_KEYS = new Set([
    'seen_btn_sort',
    'post_date_btn_sort',
    'domain_date_btn_sort',
]);

const findConfigFilterForStateKey = (allFilters, stateKey) => {
    const exact = allFilters.find(filter =>
        filter._id === stateKey ||
        (filter.query_param && filter.query_param === stateKey)
    );
    if (exact) return exact;

    // Toolbar controls use stable runtime keys while SDUI retains its original
    // document/filter names. Resolve those aliases before sanitizing restored
    // state so a config refresh does not delete a valid toolbar selection.
    if (stateKey === 'sorting') {
        return allFilters.find(filter =>
            filter._id === 'sort_by' ||
            filter.query_param === 'sortBy' ||
            filter.group_id === 'sorting'
        );
    }
    if (stateKey === 'ad_type') {
        return allFilters.find(filter =>
            filter._id === 'ad_types' ||
            filter._id === 'ad_type_filter' ||
            filter.query_param === 'ad_type' ||
            filter.query_param === 'adTypes' ||
            filter.group_id === 'ad_type'
        );
    }
    if (DATE_FILTER_STATE_KEYS.has(stateKey)) {
        return allFilters.find(filter =>
            filter._id === 'date_range_custom' ||
            filter.type === 'date_range_custom'
        );
    }
    return null;
};

const sanitizeFilterValuesByConfig = (values, cfg) => {
    if (!values || typeof values !== 'object' || !cfg) return values;

    const allFilters = [
        ...(cfg.searchbar?.flatMap(doc => doc.filters || []) || []),
        ...(cfg.navbar?.flatMap(doc => doc.filters || []) || []),
        ...(cfg.sidebar?.flatMap(doc => doc.filters || []) || []),
    ];
    let changed = false;
    const next = {};

    for (const [key, value] of Object.entries(values)) {
        if (key === '_autoSortField') {
            next[key] = value;
            continue;
        }

        const filter = findConfigFilterForStateKey(allFilters, key);
        if (!filter) {
            changed = true;
            continue;
        }

        if (
            filter.type === 'nested_select' ||
            filter.type === 'nested_multiselect' ||
            !Array.isArray(filter.options) ||
            filter.options.length === 0
        ) {
            next[key] = value;
            continue;
        }

        // Some SDUI controls persist their display label instead of the raw
        // backend value (for example the geo comboboxes). Keep both forms here
        // so a refresh does not discard a valid cached selection.
        const allowedValues = new Set(
            filter.options.flatMap(option => [
                option?.value,
                option?.label,
                option?._id,
            ].map(normalizeStoredValue).filter(Boolean))
        );

        if (Array.isArray(value)) {
            const filtered = value.filter(item => allowedValues.has(normalizeStoredValue(item)));
            if (filtered.length !== value.length) changed = true;
            if (filtered.length > 0) next[key] = filtered;
            else if (value.length > 0) changed = true;
            continue;
        }

        if (
            value !== null &&
            value !== undefined &&
            value !== '' &&
            !allowedValues.has(normalizeStoredValue(value))
        ) {
            changed = true;
            continue;
        }

        next[key] = value;
    }

    return changed ? next : values;
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
    const [filterValues, setFilterValues] = useState(() => loadTabState(FILTERS_STORAGE_KEY, {}));

    // ── Platform state ──────────────────────────────────────────────────────
    const [activePlatforms, setActivePlatformsState] = useState(() =>
        withoutDisabledPlatforms(loadTabState(PLATFORMS_STORAGE_KEY, []))
    );
    const setActivePlatforms = useCallback((nextValue) => {
        setActivePlatformsState(previous => withoutDisabledPlatforms(
            typeof nextValue === 'function' ? nextValue(previous) : nextValue
        ));
    }, []);
    const [platformFilterMatrix, setPlatformFilterMatrix] = useState({});

    // Refs to avoid circular deps — always up to date
    const activePlatformsRef = useRef(activePlatforms);
    activePlatformsRef.current = activePlatforms;

    const platformFilterMatrixRef = useRef(platformFilterMatrix);
    platformFilterMatrixRef.current = platformFilterMatrix;

    // Platform-filtered SDUI responses are intentionally smaller than the
    // full schema. Keep the last published Transparency document available so
    // a reduced response cannot make its toggle disappear while Google is
    // still selected.
    const googleTransparencyDocRef = useRef(null);

    // ── Apply a config (initial or from polling) — NO deps on activePlatforms ─
    const applyConfig = useCallback((cfg, options = {}) => {
        let frontendConfig = withoutDisabledPlatformConfig(cfg);
        const sidebar = frontendConfig?.sidebar || [];
        const transparencyIndex = sidebar.findIndex(
            document => document?._id === 'google_transparency'
        );
        const transparencyDocument = transparencyIndex >= 0
            ? sidebar[transparencyIndex]
            : null;
        const transparencyFilterIds = new Set(
            (transparencyDocument?.filters || []).map(filter => filter?._id)
        );
        const hasCompleteTransparencyDocument =
            transparencyFilterIds.has('google_transparency_ads') &&
            transparencyFilterIds.has('google_transparency_subnetwork');
        const shouldPreserveTransparency =
            options.preserveGoogleTransparency === true &&
            activePlatformsRef.current.some(
                platform => normalizeStoredValue(platform) === 'google'
            ) &&
            googleTransparencyDocRef.current;

        if (hasCompleteTransparencyDocument) {
            googleTransparencyDocRef.current = {
                document: transparencyDocument,
                index: transparencyIndex,
            };
        } else if (shouldPreserveTransparency) {
            const nextSidebar = [...sidebar];
            if (transparencyIndex >= 0) {
                // A platform-filtered response may retain the document shell
                // while stripping its applicable children. Replace that empty
                // shell instead of treating it as authoritative.
                nextSidebar[transparencyIndex] =
                    googleTransparencyDocRef.current.document;
            } else {
                const insertionIndex = Math.min(
                    googleTransparencyDocRef.current.index,
                    nextSidebar.length
                );
                nextSidebar.splice(
                    insertionIndex,
                    0,
                    googleTransparencyDocRef.current.document
                );
            }
            frontendConfig = { ...frontendConfig, sidebar: nextSidebar };
        } else if (options.preserveGoogleTransparency !== true) {
            // Initial loads and polling carry the authoritative full schema.
            // If it is removed there, do not retain an obsolete document.
            googleTransparencyDocRef.current = null;
        }

        setConfig(frontendConfig);
        setError(null);
        setFilterValues(previous => sanitizeFilterValuesByConfig(previous, frontendConfig));

        // Extract platform filter matrix from the platforms navbar document
        const platformsDoc = frontendConfig?.navbar?.find(d => d._id === 'platforms');
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
            const fallbackPlatforms = [
                'facebook', 'instagram', 'youtube', 'linkedin', 'google',
                'native', 'reddit', 'pinterest', 'tiktok',
            ];
            if (ADMOB_FRONTEND_ENABLED) fallbackPlatforms.push('admob');
            setActivePlatforms(withoutDisabledPlatforms(fallbackPlatforms));
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
                /* v8 ignore next -- the cancelled-during-error race (unmount mid-fetch) is a defensive setState guard */
                if (!cancelled) setError(err.message);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [applyConfig]);

    // ── Re-fetch config when platforms change ─────────────────────────────
    const lastConfigPlatformKeyRef = useRef(null);
    useEffect(() => {
        // The initial unfiltered fetch owns bootstrap. A ref keyed by the real
        // selection remains correct when StrictMode replays effect setup.
        if (loading || !config) return;
        const platformKey = JSON.stringify(activePlatforms);
        if (lastConfigPlatformKeyRef.current === platformKey) return;
        lastConfigPlatformKeyRef.current = platformKey;

        let cancelled = false;
        const reload = async () => {
            try {
                const cfg = await fetchSDUIConfig({
                    skipCache: true,
                    platforms: activePlatforms,
                });
                /* v8 ignore next -- cancelled-during-reload race (unmount mid-refetch) is a defensive guard */
                if (!cancelled) {
                    applyConfig(cfg, { preserveGoogleTransparency: true });
                }
            } catch (err) {
                /* v8 ignore next -- cancelled-during-reload-error race is a defensive guard */
                if (!cancelled) console.warn('Platform config re-fetch failed:', err.message);
            }
        };
        reload();
        return () => { cancelled = true; };
    }, [activePlatforms, applyConfig, config, loading]);

    // ── Polling for config changes ──────────────────────────────────────────
    const handleConfigChanged = useCallback((freshConfig) => {
        // Polling already fetched the latest published config, so keep that
        // full schema in place and let the client-side visibility rules decide
        // which docs appear for the current platform selection.
        applyConfig(freshConfig);
    }, [applyConfig]);

    useSDUIPolling(config?.config_version || 0, handleConfigChanged, activePlatforms);

    // ── Persist filterValues + activePlatforms per browser tab ─────────────
    useEffect(() => {
        try {
            const { _autoSortField, ...toStore } = filterValues;
            sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(toStore));
        } catch {}
    }, [filterValues]);

    useEffect(() => {
        try { sessionStorage.setItem(PLATFORMS_STORAGE_KEY, JSON.stringify(activePlatforms)); } catch {}
    }, [activePlatforms]);

    // Google Transparency controls exist whenever Google is selected.
    // Leaving Google deletes the toggle + dependent value. Turning the toggle
    // off deletes its subnetwork too, so re-enabling always starts fresh at
    // the UI's default "All" option.
    useEffect(() => {
        const hasGoogle = activePlatforms.some(
            platform => normalizeStoredValue(platform) === 'google'
        );
        setFilterValues(prev => {
            const shouldDeleteToggle =
                !hasGoogle &&
                prev.google_transparency_ads !== undefined;
            const shouldDeleteSubnetwork =
                prev.google_transparency_subnetwork !== undefined &&
                (!hasGoogle || prev.google_transparency_ads !== true);
            if (!shouldDeleteToggle && !shouldDeleteSubnetwork) {
                return prev;
            }
            const next = { ...prev };
            if (shouldDeleteToggle) delete next.google_transparency_ads;
            if (shouldDeleteSubnetwork) {
                delete next.google_transparency_subnetwork;
            }
            return next;
        });
    }, [
        activePlatforms,
        filterValues.google_transparency_ads,
        filterValues.google_transparency_subnetwork,
    ]);

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

    // Ad Type used several state keys during the UI migration. Update its
    // canonical key and delete every old alias atomically; otherwise a denied
    // plan can clear `ad_type` while stale `ad_types`/`type` still reaches the
    // search payload and applies the filter behind the upgrade dialog.
    const setAdTypes = useCallback((valueOrUpdater) => {
        setFilterValues(prev => {
            const current = prev.ad_type || prev.ad_types || prev.type || prev.adType || [];
            const value = typeof valueOrUpdater === 'function'
                ? valueOrUpdater(current)
                : valueOrUpdater;
            const next = { ...prev, ad_type: value };
            delete next.ad_types;
            delete next.type;
            delete next.adType;
            return next;
        });
    }, []);

    const getFilter = useCallback((filterId) => {
        return filterValues[filterId];
    }, [filterValues]);

    const clearAll = useCallback(() => {
        setFilterValues({});
    }, []);

    // ── Count active filters ────────────────────────────────────────────────
    // A nested SDUI filter stores the selected parent and leaves separately.
    // Group those implementation keys so one category selection counts once.
    const nestedFilterKeyToGroup = useMemo(() => {
        const groups = [{ parent: 'adcategory', child: 'subcategory' }];
        const allFilters = [
            ...(config?.searchbar?.flatMap(d => d.filters || []) || []),
            ...(config?.navbar?.flatMap(d => d.filters || []) || []),
            ...(config?.sidebar?.flatMap(d => d.filters || []) || []),
        ];

        for (const filter of allFilters) {
            if (filter.type !== 'nested_select' && filter.type !== 'nested_multiselect') continue;
            groups.push({
                parent: filter.parent_filter_id || 'adcategory',
                child: filter.child_filter_id || 'subcategory',
            });
        }

        const keyToGroup = new Map();
        for (const { parent, child } of groups) {
            const groupId = `${parent}:${child}`;
            keyToGroup.set(parent, groupId);
            keyToGroup.set(child, groupId);
        }
        return keyToGroup;
    }, [config]);

    const totalActiveFilters = useMemo(() => {
        // Keep internal helper keys out of the counter, but let nested parent
        // filters such as `adcategory` count when they are the only selected
        // key (for example, onboarding applies a top-level category without a
        // subcategory).
        const EXCLUDED_KEYS = new Set(['_autoSortField']);
        const countedNestedGroups = new Set();
        return Object.entries(filterValues).reduce((total, [key, v]) => {
            if (EXCLUDED_KEYS.has(key)) return total;
            const isActive = Array.isArray(v)
                ? v.length > 0
                : typeof v === 'boolean'
                    ? v
                    : v !== null && v !== undefined && v !== '';
            if (!isActive) return total;

            const nestedGroup = nestedFilterKeyToGroup.get(key);
            if (nestedGroup) {
                if (countedNestedGroups.has(nestedGroup)) return total;
                countedNestedGroups.add(nestedGroup);
                return total + 1;
            }
            if (Array.isArray(v)) return total + (v.length > 0 ? 1 : 0);
            if (typeof v === 'boolean') return total + (v ? 1 : 0);
            if (v === null || v === undefined || v === '') return total;
            return total + 1;
        }, 0);
    }, [filterValues, nestedFilterKeyToGroup]);

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
                : typeof value === 'boolean'
                    ? value
                    : value !== null && value !== undefined && value !== '';
            if (!isActive) continue;

            const filter = findConfigFilterForStateKey(allFilters, filterId);
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

    // Preserve unsupported selections in UI state, but let callers avoid a
    // request that cannot match any selected platform. This prevents platform
    // incompatibility from being mistaken for a plan restriction by the API.
    const hasUnsupportedActiveFiltersFor = useCallback((platforms) => {
        if (!config || !Array.isArray(platforms) || platforms.length === 0) return false;

        const selectedPlatforms = new Set(platforms.map(normalizeStoredValue));
        const allFilters = [
            ...(config.searchbar?.flatMap(d => d.filters) || []),
            ...(config.navbar?.flatMap(d => d.filters) || []),
            ...(config.sidebar?.flatMap(d => d.filters) || []),
        ];

        // The platform matrix controls which UI groups are displayed; it is
        // not an API-support contract and may intentionally omit toolbar groups.
        const supportsSelection = (platformApplicability) => {
            if (!platformApplicability || platformApplicability === 'all') return true;
            const supportedPlatforms = Array.isArray(platformApplicability)
                ? platformApplicability
                : [platformApplicability];
            return supportedPlatforms.some(platform =>
                selectedPlatforms.has(normalizeStoredValue(platform))
            );
        };

        for (const [filterId, value] of Object.entries(filterValues)) {
            const isActive = Array.isArray(value) ? value.length > 0
                : typeof value === 'boolean'
                    ? value
                    : value !== null && value !== undefined && value !== '';
            if (!isActive) continue;

            const filter = findConfigFilterForStateKey(allFilters, filterId);
            if (!filter) continue;

            const selectedValues = Array.isArray(value) ? value : [value];
            for (const selectedValue of selectedValues) {
                const option = filter.options?.find(candidate =>
                    normalizeStoredValue(candidate.value ?? candidate._id) ===
                    normalizeStoredValue(selectedValue)
                );
                const optionApplicability = option?.platform_applicability;
                const applicability = optionApplicability && optionApplicability !== 'all'
                    ? optionApplicability
                    : filter.platform_applicability;
                if (!supportsSelection(applicability)) {
                    return true;
                }
            }
        }

        return false;
    }, [config, filterValues]);

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
        const platforms = activePlatformsRef.current.map(normalizeStoredValue);
        const matrix = platformFilterMatrixRef.current;

        // Check platform_applicability (string or array)
        if (pa && pa !== 'all') {
            if (!platforms.length) return true;
            const list = (Array.isArray(pa) ? pa : [pa]).map(normalizeStoredValue);
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
                    const list = (Array.isArray(pa) ? pa : [pa]).map(normalizeStoredValue);
                    return list.some(p =>
                        platforms.some(platform => normalizeStoredValue(platform) === p)
                    );
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
        totalActiveFilters,
        buildQueryParams,

        // Platform state
        activePlatforms,
        effectivePlatforms,
        hasUnsupportedActiveFiltersFor,
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
        setSelAdTypes: setAdTypes,
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
                /* v8 ignore next -- defensive: a config doc always has a filters array (other code paths assume it too) */
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
        filterPlatformSupport: useMemo(() => {
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
        }, [config]),
    };
}
