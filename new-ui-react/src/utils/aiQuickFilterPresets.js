export const AI_FILTER_DRAFT_KEY = "sdui.aiSignals.draft";

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
  const activeAiKeys = getAiFilterKeys(doc).filter(
    (key) => !isEmptyValue(filterValues?.[key]),
  );
  return presets.find((preset) => {
    const presetKeys = Object.keys(preset.filters);
    return (
      presetKeys.length === activeAiKeys.length &&
      presetKeys.every((key) =>
        valuesMatch(filterValues?.[key], preset.filters[key]),
      )
    );
  }) || null;
};

export const hasActiveAiFilters = (filterValues, doc) =>
  getAiFilterKeys(doc).some((key) => !isEmptyValue(filterValues?.[key]));

export const replaceAiFilters = (filterValues, doc, replacement = {}) => {
  const next = { ...(filterValues || {}) };
  for (const key of getAiFilterKeys(doc)) delete next[key];
  for (const [key, value] of Object.entries(replacement)) {
    if (!isEmptyValue(value)) next[key] = value;
  }
  return next;
};

export const discardAiFilterDraft = () => {
  try {
    // A preset becomes the new committed source, so an older popup draft must
    // not override it the next time the AI Filters popup opens.
    sessionStorage.removeItem(AI_FILTER_DRAFT_KEY);
  } catch {}
};
