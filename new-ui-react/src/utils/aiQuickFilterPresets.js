export const AI_FILTER_DRAFT_KEY = "sdui.aiSignals.draft";

// SDUI may provide legacy title casing for this established acronym. Keep the
// stored value (`ugc`) unchanged and normalize only its visible presentation.
export const formatAiFilterOptionLabel = (label) => (
  typeof label === "string" ? label.replace(/\bugc\b/gi, "UGC") : label
);

/**
 * Quick strategies intentionally stay within one filter group. The backend
 * combines different groups with AND, while values within one group are OR'd;
 * one high-signal group therefore keeps discovery broad enough to remain useful.
 * Resolution against live SDUI still prevents stale values from being sent.
 */
export const AI_QUICK_FILTER_PRESETS = [
  {
    id: "tiktok_ugc",
    label: "TikTok UGC",
    tag: "UGC",
    filters: {
      ai_ad_type: ["ugc"],
    },
  },
  {
    id: "b2b_saas",
    label: "B2B SaaS",
    tag: "Leads",
    filters: {
      ai_category_id: ["1009"],
    },
  },
  {
    id: "flash_sale",
    label: "Flash Sale",
    tag: "Promo",
    filters: {
      ai_hook: ["scarcity", "urgency", "discount"],
    },
  },
  {
    id: "luxury_brand",
    label: "Luxury Brand",
    tag: "Brand",
    filters: {
      ai_ad_type: ["lifestyle"],
    },
  },
  {
    id: "app_install",
    label: "App Install",
    tag: "Mobile",
    filters: {
      ai_intent: ["app_install"],
    },
  },
  {
    id: "black_friday",
    label: "Black Friday",
    tag: "BFCM",
    filters: {
      ai_offer_type: [
        "percentage_discount",
        "flat_discount",
        "coupon",
        "limited_time_offer",
      ],
    },
  },
  {
    id: "high_ticket",
    label: "High-Ticket",
    tag: "High ROAS",
    filters: {
      ai_offer_type: ["consultation", "demo", "financing"],
    },
  },
  {
    id: "local_lead",
    label: "Local Lead",
    tag: "Lead Gen",
    filters: {
      ai_category_id: ["1010", "1021", "1025", "1026", "1027", "1036"],
    },
  },
];

const isEmptyValue = (value) =>
  value === undefined ||
  value === null ||
  value === "" ||
  value === false ||
  (Array.isArray(value) && value.length === 0);

const collectOptionValues = (options = [], result = new Set()) => {
  for (const option of options) {
    const value = option?.value ?? option?.label;
    if (value !== undefined && value !== null) result.add(String(value));
    collectOptionValues(option?.children || option?.sub_options || [], result);
  }
  return result;
};

const toArray = (value) =>
  isEmptyValue(value) ? [] : (Array.isArray(value) ? value : [value]);

const findOptionByValue = (options = [], targetValue) => {
  for (const option of options) {
    const optionValue = String(option?.value ?? option?.label ?? "");
    if (optionValue === String(targetValue)) return option;
    const nested = findOptionByValue(option?.children || option?.sub_options || [], targetValue);
    if (nested) return nested;
  }
  return null;
};

const collectLeafValues = (option, result = []) => {
  const children = option?.children || option?.sub_options || [];
  if (children.length === 0) {
    const value = option?.value ?? option?.label;
    if (!isEmptyValue(value)) result.push(value);
    return result;
  }
  for (const child of children) collectLeafValues(child, result);
  return result;
};

const getNestedFilters = (doc) =>
  (doc?.filters || []).filter(
    (filter) =>
      (filter?.parent_filter_id || filter?._id) &&
      filter?.child_filter_id,
  );

const expandNestedSelections = (doc, values) => {
  const next = { ...(values || {}) };
  for (const filter of getNestedFilters(doc)) {
    const parentKey = filter.parent_filter_id || filter._id;
    const childKey = filter.child_filter_id;
    const parentValues = toArray(next[parentKey]);
    const parentMarkerValues = new Set(
      (filter.options || []).map((option) =>
        String(option?.value ?? option?.label ?? ""),
      ),
    );
    const existingChildren = toArray(next[childKey])
      .filter((value) => !parentMarkerValues.has(String(value)))
      .map((value) => String(value));

    // Clean drafts restored from sessions created before nested selections
    // stopped leaking parent IDs into the child filter.
    if (parentValues.length === 0) {
      if (existingChildren.length > 0) {
        next[childKey] = [...new Set(existingChildren)];
      } else {
        delete next[childKey];
      }
      continue;
    }

    const expandedChildren = new Set(existingChildren);
    for (const parentValue of parentValues) {
      const option = findOptionByValue(filter.options || [], parentValue);
      if (!option) continue;
      collectLeafValues(option).forEach((leafValue) => {
        expandedChildren.add(String(leafValue));
      });
    }

    next[childKey] = [...expandedChildren];
  }
  return next;
};

/**
 * Normalize the current AI filter state so nested category parents always carry
 * the matching child leaves in the same draft snapshot.
 *
 * This keeps quick-filter presets and the popup's draft view aligned: if a
 * category parent is active, the popup sees the branch as fully selected even
 * when the state was restored from storage or a different surface.
 */
export const normalizeAiFilterValues = (values, doc) =>
  expandNestedSelections(doc, values);

const getComparableAiState = (filterValues, doc) => {
  const state = {};
  const nestedFilters = getNestedFilters(doc);
  const nestedParentKeys = new Set(
    nestedFilters.map((filter) => filter.parent_filter_id || filter._id),
  );
  const nestedChildKeys = new Set(
    nestedFilters.map((filter) => filter.child_filter_id),
  );

  for (const filter of Array.isArray(doc?.filters) ? doc.filters : []) {
    if (nestedParentKeys.has(filter._id) || nestedChildKeys.has(filter._id)) {
      const parentKey = filter.parent_filter_id || filter._id;
      const childKey = filter.child_filter_id;
      const parentValues = toArray(filterValues?.[parentKey]);
      if (parentValues.length > 0) {
        state[parentKey] = parentValues;
        continue;
      }
      const childValues = toArray(filterValues?.[childKey]);
      if (childValues.length > 0) state[childKey] = childValues;
      continue;
    }

    if (!isEmptyValue(filterValues?.[filter._id])) {
      state[filter._id] = filterValues[filter._id];
    }
  }

  return state;
};

export const getAiFilterKeys = (doc) => {
  const keys = new Set();
  for (const filter of Array.isArray(doc?.filters) ? doc.filters : []) {
    if (filter?._id) keys.add(filter._id);
    if (filter?.parent_filter_id) keys.add(filter.parent_filter_id);
    if (filter?.child_filter_id) keys.add(filter.child_filter_id);
  }
  return [...keys];
};

/**
 * Display labels for the selected values of one AI filter — e.g. category IDs
 * (`"1009"`) → the names shown in the AI Filters popup. Child filters
 * (subcategories) are looked up among their parents' children only: the
 * nested picker can carry a parent's own ID into the child selection, and
 * that parent must not be reported as a subcategory. A value with no matching
 * option or label is returned as-is.
 */
export const getAiFilterOptionLabels = (doc, filterId, values) => {
  const filter = (doc?.filters || []).find(
    (item) => item?._id === filterId || item?.child_filter_id === filterId,
  );
  const topLevel = filter?.options || [];
  const isChildFilter = Boolean(filter) && filter._id !== filterId;
  const children = topLevel.flatMap((option) => option?.children || option?.sub_options || []);
  const findTopLevel = (value) =>
    topLevel.find((option) => String(option?.value ?? option?.label ?? "") === String(value));

  const labels = [];
  const seen = new Set();
  for (const value of toArray(values)) {
    const key = String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    const option = isChildFilter ? findOptionByValue(children, value) : findTopLevel(value);
    if (!option && isChildFilter && findTopLevel(value)) continue;
    labels.push(isEmptyValue(option?.label) ? key : String(option.label));
  }
  return labels;
};

/**
 * Keeps presets compatible with the current SDUI document. A removed filter or
 * option is omitted rather than leaking an unsupported query value.
 */
export const resolveAiQuickFilterPresets = (doc) => {
  const filtersById = new Map(
    (doc?.filters || []).map((filter) => [filter._id, filter]),
  );

  return AI_QUICK_FILTER_PRESETS.map((preset) => {
    const filters = {};
    let isComplete = true;
    for (const [filterId, requestedValues] of Object.entries(preset.filters)) {
      const filter = filtersById.get(filterId);
      if (!filter || filter.visible === false) {
        isComplete = false;
        break;
      }
      const allowedValues = collectOptionValues(filter.options);
      const resolvedValues = requestedValues.filter((value) =>
        allowedValues.has(String(value)),
      );
      if (resolvedValues.length !== requestedValues.length) {
        isComplete = false;
        break;
      }
      filters[filterId] = resolvedValues;
    }
    return isComplete ? { ...preset, filters } : null;
  }).filter(Boolean);
};

const normalizeValue = (value) => {
  if (Array.isArray(value)) {
    return [...value].map(String).sort((a, b) => a.localeCompare(b));
  }
  return value;
};

const valuesMatch = (left, right) =>
  JSON.stringify(normalizeValue(left)) === JSON.stringify(normalizeValue(right));

export const findActiveAiQuickFilterPreset = (
  filterValues,
  doc,
  presets = resolveAiQuickFilterPresets(doc),
) => {
  const effectiveValues = getComparableAiState(filterValues, doc);
  const activeAiKeys = Object.keys(effectiveValues).filter(
    (key) => !isEmptyValue(effectiveValues?.[key]),
  );
  return presets.find((preset) => {
    const presetKeys = Object.keys(preset.filters);
    return (
      presetKeys.length === activeAiKeys.length &&
      presetKeys.every((key) =>
        valuesMatch(effectiveValues?.[key], preset.filters[key]),
      )
    );
  }) || null;
};

/**
 * The Quick Filter preset that is shown as selected for the current state.
 *
 * A natural-language AI result must not light up a preset merely because its
 * AI fields happen to be equivalent. Only an explicit planner value or a
 * direct quick-filter interaction may select the visible shortcut.
 * `activeQuickFilterId === undefined` keeps legacy/manual inference available;
 * `null` means no preset is explicitly selected.
 */
export const resolveActiveAiQuickFilterPreset = ({
  filterValues,
  doc,
  presets = resolveAiQuickFilterPresets(doc),
  activeQuickFilterId,
  aiPrompt = "",
}) => {
  if (activeQuickFilterId !== undefined) {
    const explicitlySelectedPreset = activeQuickFilterId
      ? presets.find((preset) => preset.id === activeQuickFilterId)
      : null;
    const explicitPresetIsApplied = explicitlySelectedPreset
      ? Object.entries(explicitlySelectedPreset.filters).every(([key, value]) =>
          JSON.stringify(filterValues?.[key]) === JSON.stringify(value),
        )
      : false;
    return explicitPresetIsApplied ? explicitlySelectedPreset : null;
  }
  if (String(aiPrompt || "").trim()) return null;
  return findActiveAiQuickFilterPreset(filterValues, doc, presets);
};

const hasAiMetaFlag = (value) =>
  value === true || value === 1 || value === "1" ||
  String(value).toLowerCase() === "true";

export const hasActiveAiFilters = (filterValues, doc) =>
  hasAiMetaFlag(filterValues?.has_ai_meta) ||
  getAiFilterKeys(doc).some((key) => !isEmptyValue(filterValues?.[key]));

export const replaceAiFilters = (filterValues, doc, replacement = {}) => {
  const next = { ...(filterValues || {}) };
  // The dashboard-level AI-only toggle belongs to the same filter family as
  // the detailed AI controls, so replacing/clearing that family is atomic.
  delete next.has_ai_meta;
  for (const key of getAiFilterKeys(doc)) delete next[key];
  for (const [key, value] of Object.entries(replacement)) {
    if (!isEmptyValue(value)) next[key] = value;
  }
  // Presets own the parent category only. Do not materialize every child into
  // the search payload, because an explicit AI subcategory must remain exact.
  // The modal still calls normalizeAiFilterValues for its visual draft state.
  return next;
};

/**
 * Apply a quick preset without discarding AI constraints inferred from the
 * current prompt. A preset still owns its filter group, so a previous preset's
 * values are removed before the new preset is added; prompt values in other
 * groups remain part of the resulting search.
 */
export const mergeAiQuickFilter = (
  filterValues,
  doc,
  replacement = {},
  previousPreset = null,
) => {
  const next = { ...(filterValues || {}) };

  for (const filterId of Object.keys(previousPreset?.filters || {})) {
    delete next[filterId];
    const nestedFilter = getNestedFilters(doc).find(
      (filter) => (filter.parent_filter_id || filter._id) === filterId,
    );
    if (nestedFilter?.child_filter_id) {
      delete next[nestedFilter.child_filter_id];
    }
  }

  for (const [key, value] of Object.entries(replacement)) {
    if (!isEmptyValue(value)) next[key] = value;
  }

  // Keep a preset's parent-only meaning at the API boundary; prompt-inferred
  // child selections already present in `next` remain untouched.
  return next;
};

export const discardAiFilterDraft = () => {
  try {
    // A preset becomes the new committed source, so an older popup draft must
    // not override it the next time the AI Filters popup opens.
    sessionStorage.removeItem(AI_FILTER_DRAFT_KEY);
  } catch {}
};
