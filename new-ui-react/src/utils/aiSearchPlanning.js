const isMeaningfulValue = (value) => {
  if (value === undefined || value === null || value === false || value === '') return false;
  if (typeof value === 'string') {
    return !['na', 'all'].includes(value.trim().toLowerCase());
  }
  if (Array.isArray(value)) return value.some(isMeaningfulValue);
  if (typeof value === 'object') return Object.values(value).some(isMeaningfulValue);
  return true;
};

/**
 * Read DS control metadata without rewriting it. The original array is kept so
 * the UI can display the exact unsupported entries returned by the planner.
 */
export const getPlanningUnsupported = (planning) =>
  Array.isArray(planning?.unsupported) ? planning.unsupported : [];

/**
 * Quick-filter presets are explicit planner metadata, not something inferred
 * from equivalent AI fields. Empty values deliberately resolve to null.
 */
export const getPlanningQuickFilterId = (planning, fallbackPlanning = null) => {
  // Tier metadata can repeat only part of the response-level planning object.
  // Preserve an explicit response-level preset when the selected tier omits it.
  const value = planning?.quick_filter !== undefined && planning?.quick_filter !== null
    ? planning.quick_filter
    : fallbackPlanning?.quick_filter;
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

/**
 * Keep only usable DS "Did you mean" entries and cap the UI at the contract's
 * maximum of three suggestions. Invalid entries are ignored so a malformed
 * upstream item cannot render an empty or non-clickable chip.
 */
export const getPlanningSuggestions = (planning) => {
  if (!Array.isArray(planning?.suggestions)) return [];
  return planning.suggestions
    .filter((suggestion) => suggestion && typeof suggestion === 'object')
    .map((suggestion) => ({
      prompt: String(suggestion.prompt || '').trim(),
      kind: ['exact', 'broader', 'broadest'].includes(suggestion.kind)
        ? suggestion.kind
        : null,
    }))
    .filter((suggestion) => suggestion.prompt)
    .slice(0, 3);
};

/**
 * Keep DS's summary text intact. The result context renders this value
 * directly, so the website does not add or remove its own "Searched" copy.
 */
const normalizePlanningSummary = (value) => String(value || '').trim();

export const getPlanningSummary = (planning, tierIndex = 0, fallbackPlanning = null) => {
  const candidates = [
    planning?.summary,
    planning?.tiers?.[tierIndex]?.summary,
    fallbackPlanning?.summary,
    fallbackPlanning?.tiers?.[tierIndex]?.summary,
  ];
  for (const candidate of candidates) {
    const summary = normalizePlanningSummary(candidate);
    if (summary) return summary;
  }
  return '';
};

/**
 * Read DS's optional note without inventing a website message. Response-level
 * metadata is used as a fallback for older payloads that repeat planning only
 * on the selected tier.
 */
export const getPlanningNote = (planning, fallbackPlanning = null) => {
  const candidates = [planning?.note, fallbackPlanning?.note];
  for (const candidate of candidates) {
    const note = typeof candidate === 'string' ? candidate.trim() : '';
    if (note) return note;
  }
  return '';
};

export const getPlanningOutcome = (planning) => {
  const outcome = String(planning?.outcome || '').trim().toLowerCase();
  return outcome || null;
};

export const getPlanningTier = (planning, index) => {
  const tier = planning?.tiers?.[index];
  return tier && typeof tier === 'object' ? tier : null;
};

const SUBJECT_ARGUMENTS = [
  'keyword',
  'advertiser',
  'domain',
  'page',
  'brand',
  'adcategory',
  'subCategory',
  'ai_ad_type',
  'ai_intent',
  'ai_hook',
  'ai_offering_type',
  'ai_offer_type',
  'ai_colors',
  'ai_category_id',
  'ai_subcategory_id',
];

/**
 * A planner that explicitly reports a remaining subject must also preserve it
 * as a query, taxonomy value, or AI semantic field. Without this guard, a
 * missing topic/brand can degrade into a broad platform-only search.
 */
export const hasExplicitPlanningSubject = (planning, args = {}, mapped = {}) => {
  const role = String(planning?.search_term_role || '').trim().toLowerCase();
  if (role !== 'subject') return true;
  const mappedQuery = String(mapped?.searchQuery || '').trim();
  if (mappedQuery && !['na', 'all'].includes(mappedQuery.toLowerCase())) return true;
  return SUBJECT_ARGUMENTS.some((field) => isMeaningfulValue(args?.[field]));
};

/**
 * Return the next safe fallback tier without re-planning the prompt. A tier
 * with unmapped fields would silently broaden the request, so it is skipped.
 */
export const findNextExecutablePlanningTier = (plannedTiers, currentIndex = -1) => {
  if (!Array.isArray(plannedTiers)) return null;
  const startIndex = Number.isInteger(currentIndex) ? currentIndex + 1 : 0;
  for (let index = Math.max(0, startIndex); index < plannedTiers.length; index += 1) {
    const tier = plannedTiers[index];
    if (tier?.hasExecutableSearch && !tier.mapped?.unmappedDetails?.length) {
      return { ...tier, index };
    }
  }
  return null;
};

const ORCHESTRATION_ONLY_FILTER_KEYS = new Set(['_autoSortField', 'has_ai_meta', 'ai_meta']);

/**
 * A mapped query is executable when it has a subject, structured filter, or a
 * supported sort. Platform selection alone is not enough because it would
 * otherwise turn an unsupported instruction into a broad search.
 */
export const hasExecutableMappedSearch = (mapped) => {
  if (!mapped || String(mapped.searchQuery || '').trim()) return true;
  if (String(mapped.sortBy || '').trim()) return true;
  return Object.entries(mapped.filterValues || {})
    // `has_ai_meta` is commonly attached to every AI plan as a backend
    // execution invariant; by itself it is not an independently requested
    // user filter and must not turn an unsupported prompt into a broad search.
    .filter(([key]) => !ORCHESTRATION_ONLY_FILTER_KEYS.has(key))
    .some(([, value]) => isMeaningfulValue(value));
};

const asSentence = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};

/**
 * Prefer DS's reason verbatim so capability messaging stays aligned with the
 * planner contract. Fall back to a useful generic message for malformed items.
 */
export const formatPlanningUnsupportedMessage = (unsupported) => {
  const reasons = (Array.isArray(unsupported) ? unsupported : [])
    .map((item) => asSentence(item?.reason))
    .filter(Boolean);
  if (reasons.length) return reasons.join(' ');
  return 'This requested operation is not currently supported.';
};
