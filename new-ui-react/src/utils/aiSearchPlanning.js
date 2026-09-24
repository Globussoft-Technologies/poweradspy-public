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
export const getPlanningQuickFilterId = (planning) => {
  const value = planning?.quick_filter;
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
};

export const getPlanningOutcome = (planning) => {
  const outcome = String(planning?.outcome || '').trim().toLowerCase();
  return outcome || null;
};

export const getPlanningTier = (planning, index) => {
  const tier = planning?.tiers?.[index];
  return tier && typeof tier === 'object' ? tier : null;
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

/**
 * Partial compatibility is executable, but the planner deliberately removed
 * networks that cannot honor one of the requested filters. Keep that detail
 * visible instead of making the result look like a complete network search.
 */
export const formatPlanningCapabilityMessage = (planning) => {
  const excluded = Array.isArray(planning?.capability?.excluded_networks)
    ? planning.capability.excluded_networks
    : [];
  const labels = excluded.map((entry) => {
    if (typeof entry === 'string') return entry;
    return entry?.network || entry?.name || entry?.platform || null;
  }).filter(Boolean);
  if (labels.length) {
    return `Some requested networks were excluded because they cannot apply the requested filter: ${labels.join(', ')}.`;
  }
  return String(planning?.reason || '').trim();
};
