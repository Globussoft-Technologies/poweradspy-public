'use strict';

const { getCapabilityDecision } = require('./registries/routeClassification');

// Bridge the legacy plan-access surface to the new plan-control policy for the
// AI Signals feature. The legacy admin/UI stack still exposes the row under the
// humanized "Ai Metadata Filters" label, while the runtime check uses `ai_meta`.
// A published plan-control decision should therefore override both keys so the
// UI and auth response stay in sync without manual Mongo edits.
const AI_META_CAPABILITY_ID = 'legacy.ai_metadata_filters';
const AI_META_FILTER_IDS = ['ai_meta', 'ai_metadata_filters'];

async function overlayAiMetaLegacyDecision(req, network, filterStatus) {
  if (!filterStatus || typeof filterStatus !== 'object') return filterStatus;

  const aiMetaDecision = await getCapabilityDecision(req, AI_META_CAPABILITY_ID, { network });
  if (!aiMetaDecision) return filterStatus;

  const enabled = !!aiMetaDecision.allowed;
  const current = AI_META_FILTER_IDS.find((id) => filterStatus[id]) || null;
  const baseline = current ? filterStatus[current] : {};

  const merged = {
    ...baseline,
    enabled,
    planAllowed: enabled,
    reasonCode: aiMetaDecision.reasonCode || baseline.reasonCode || null,
    policyVersion: aiMetaDecision.policyVersion || baseline.policyVersion || null,
  };

  for (const id of AI_META_FILTER_IDS) {
    if (filterStatus[id]) filterStatus[id] = { ...filterStatus[id], ...merged };
  }

  return filterStatus;
}

module.exports = {
  overlayAiMetaLegacyDecision,
  AI_META_CAPABILITY_ID,
  AI_META_FILTER_IDS,
};
