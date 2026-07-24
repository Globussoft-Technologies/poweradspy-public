'use strict';

const crypto = require('crypto');
const {
  getCapabilities,
  getCapability,
} = require('../registries/capabilityRegistry');
const {
  resolveNetworkId,
} = require('../registries/networkRegistry');

const ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const EFFECTS = new Set(['inherit', 'allow', 'deny']);
const NETWORK_MODES = new Set(['not_applicable', 'inherit_general', 'custom']);
const GENERATION_STATUSES = new Set(['draft', 'validated', 'active', 'legacy', 'archived']);
const FAMILY_STATUSES = new Set(['active', 'legacy', 'deleted', 'custom', 'draft', 'archived']);

function unwrapSnapshot(value) {
  return value?.snapshot || value || {};
}

function stableSort(value) {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = stableSort(value[key]);
    return out;
  }, {});
}

function checksumSnapshot(snapshot) {
  const canonical = JSON.stringify(stableSort(unwrapSnapshot(snapshot)));
  return `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;
}

function pushIssue(target, code, path, message, meta) {
  target.push({ code, path, message, ...(meta ? { meta } : {}) });
}

function validateSnapshot(input) {
  const snapshot = unwrapSnapshot(input);
  const errors = [];
  const warnings = [];
  const families = Array.isArray(snapshot.planFamilies) ? snapshot.planFamilies : [];
  const generations = Array.isArray(snapshot.generations) ? snapshot.generations : [];
  const policies = snapshot.policies && typeof snapshot.policies === 'object'
    ? snapshot.policies
    : {};

  if (!families.length) {
    pushIssue(errors, 'NO_PLAN_FAMILIES', 'planFamilies', 'At least one plan family is required.');
  }

  const generationIds = new Set();
  for (const [index, generation] of generations.entries()) {
    const path = `generations.${index}`;
    if (!ID_RE.test(generation?.generationId || '')) {
      pushIssue(errors, 'INVALID_GENERATION_ID', `${path}.generationId`, 'Use lowercase letters, numbers, dash, underscore, or dot.');
    } else if (generationIds.has(generation.generationId)) {
      pushIssue(errors, 'DUPLICATE_GENERATION', `${path}.generationId`, 'Generation ID must be unique.');
    } else {
      generationIds.add(generation.generationId);
    }
    if (!String(generation?.adminLabel || '').trim()) {
      pushIssue(errors, 'MISSING_GENERATION_LABEL', `${path}.adminLabel`, 'Admin label is required.');
    }
    if (generation?.status && !GENERATION_STATUSES.has(generation.status)) {
      pushIssue(errors, 'INVALID_GENERATION_STATUS', `${path}.status`, 'Generation status is invalid.');
    }
  }

  const familyIds = new Set();
  const planIds = new Map();
  for (const [index, family] of families.entries()) {
    const path = `planFamilies.${index}`;
    if (!ID_RE.test(family?.familyId || '')) {
      pushIssue(errors, 'INVALID_FAMILY_ID', `${path}.familyId`, 'Family ID format is invalid.');
      continue;
    }
    if (familyIds.has(family.familyId)) {
      pushIssue(errors, 'DUPLICATE_FAMILY', `${path}.familyId`, 'Family ID must be unique.');
    }
    familyIds.add(family.familyId);
    if (!String(family.label || '').trim() || !String(family.adminLabel || '').trim()) {
      pushIssue(errors, 'MISSING_FAMILY_LABEL', path, 'Customer and admin labels are required.');
    }
    if (!family.generation || (generationIds.size && !generationIds.has(family.generation))) {
      pushIssue(errors, 'UNKNOWN_GENERATION', `${path}.generation`, 'Family must reference a known generation.');
    }
    if (family.status && !FAMILY_STATUSES.has(family.status)) {
      pushIssue(errors, 'INVALID_FAMILY_STATUS', `${path}.status`, 'Family status is invalid.');
    }
    for (const [variantIndex, variant] of (family.variants || []).entries()) {
      const variantPath = `${path}.variants.${variantIndex}`;
      const planId = Number(variant.planId);
      if (!Number.isInteger(planId) || planId <= 0) {
        pushIssue(errors, 'INVALID_PLAN_ID', `${variantPath}.planId`, 'Billing plan ID must be a positive integer.');
        continue;
      }
      if (planIds.has(planId)) {
        pushIssue(errors, 'DUPLICATE_PLAN_ID', `${variantPath}.planId`, `Plan ID ${planId} already belongs to ${planIds.get(planId)}.`);
      } else {
        planIds.set(planId, family.familyId);
      }
      if (!String(variant.billingCycle || '').trim() || !String(variant.billingProvider || '').trim()) {
        pushIssue(errors, 'INCOMPLETE_BILLING_VARIANT', variantPath, 'Billing cycle and provider are required.');
      }
      if (variant.placeholder === true || variant.verified === false) {
        pushIssue(errors, 'UNVERIFIED_BILLING_ID', variantPath, 'Placeholder or unverified billing IDs cannot be published.');
      }
    }
  }

  for (const [familyId, policy] of Object.entries(policies)) {
    if (!familyIds.has(familyId)) {
      pushIssue(errors, 'UNKNOWN_POLICY_FAMILY', `policies.${familyId}`, 'Policy references an unknown family.');
    }
    for (const [i, network] of (policy.generalNetworks || []).entries()) {
      if (!resolveNetworkId(network)) {
        pushIssue(errors, 'UNKNOWN_NETWORK', `policies.${familyId}.generalNetworks.${i}`, `Unknown network: ${network}`);
      }
    }
    for (const [capabilityId, rule] of Object.entries(policy.capabilities || {})) {
      const capPath = `policies.${familyId}.capabilities.${capabilityId}`;
      const capability = getCapability(capabilityId);
      if (!capability) {
        pushIssue(errors, 'UNKNOWN_CAPABILITY', capPath, `Unregistered capability: ${capabilityId}`);
        continue;
      }
      if (!EFFECTS.has(rule?.effect)) {
        pushIssue(errors, 'INVALID_EFFECT', `${capPath}.effect`, 'Effect must be inherit, allow, or deny.');
      }
      const mode = rule?.networks?.mode || (capability.networkAware ? 'inherit_general' : 'not_applicable');
      if (!NETWORK_MODES.has(mode)) {
        pushIssue(errors, 'INVALID_NETWORK_MODE', `${capPath}.networks.mode`, 'Network mode is invalid.');
      }
      if (!capability.networkAware && mode !== 'not_applicable') {
        pushIssue(warnings, 'NETWORK_MODE_NOT_APPLICABLE', `${capPath}.networks`, 'This capability is not network-aware.');
      }
      if (mode === 'custom') {
        for (const [i, network] of (rule.networks?.allowed || []).entries()) {
          if (!resolveNetworkId(network)) {
            pushIssue(errors, 'UNKNOWN_NETWORK', `${capPath}.networks.allowed.${i}`, `Unknown network: ${network}`);
          }
        }
      }
      for (const [limitName, limit] of Object.entries(rule?.limits || {})) {
        if (!capability.limitTypes?.includes(limitName)) {
          pushIssue(errors, 'UNSUPPORTED_LIMIT', `${capPath}.limits.${limitName}`, `${limitName} is not supported by this capability.`);
        } else if (!Number.isFinite(Number(limit)) || Number(limit) < 0) {
          pushIssue(errors, 'INVALID_LIMIT', `${capPath}.limits.${limitName}`, 'Limit must be zero or a positive number.');
        }
      }
      if (capability.status === 'unwired' && rule?.effect === 'allow') {
        pushIssue(errors, 'UNWIRED_CAPABILITY_ALLOWED', capPath, 'An unwired capability cannot be published as allowed.');
      }
      if (capability.status === 'needs_review' && rule?.reviewed !== true) {
        const family = families.find((item) => item.familyId === familyId);
        const generation = generations.find((item) => item.generationId === family?.generation);
        const strictUnreviewedAllow = generation?.newCapabilityDefault === 'deny' && rule?.effect === 'allow';
        if (strictUnreviewedAllow) {
          pushIssue(
            errors,
            'STRICT_CAPABILITY_REVIEW_REQUIRED',
            capPath,
            'This strict-deny generation cannot publish an unreviewed capability as allowed.',
          );
        } else {
          pushIssue(
            warnings,
            'CAPABILITY_NEEDS_REVIEW',
            capPath,
            'Review is still pending. This remains visible in the review queue but does not block unrelated plan changes.',
          );
        }
      }
    }
  }

  for (const familyId of familyIds) {
    if (!policies[familyId]) {
      pushIssue(errors, 'MISSING_FAMILY_POLICY', `policies.${familyId}`, 'Every family needs an explicit policy.');
    }
  }

  const activeCapabilities = getCapabilities().filter((cap) => cap.planControlled && cap.status === 'active');
  for (const cap of activeCapabilities) {
    if (!cap.description || !cap.owner || !cap.lockedExperience || !cap.routes?.length || !cap.frontend?.location) {
      pushIssue(warnings, 'INCOMPLETE_PREVIEW_METADATA', `capabilities.${cap.id}`, 'Capability preview/enforcement metadata is incomplete.');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      generations: generations.length,
      families: families.length,
      variants: planIds.size,
      capabilities: getCapabilities().length,
      policyEntries: Object.values(policies).reduce((sum, policy) => sum + Object.keys(policy.capabilities || {}).length, 0),
    },
    checksum: checksumSnapshot(snapshot),
  };
}

function diffSnapshots(beforeInput, afterInput) {
  const before = unwrapSnapshot(beforeInput);
  const after = unwrapSnapshot(afterInput);
  const changes = [];
  const walk = (left, right, path) => {
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    if (
      left && right &&
      typeof left === 'object' && typeof right === 'object' &&
      !Array.isArray(left) && !Array.isArray(right)
    ) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of [...keys].sort()) walk(left[key], right[key], path ? `${path}.${key}` : key);
      return;
    }
    changes.push({ path, before: left, after: right });
  };
  walk(before, after, '');
  return changes;
}

module.exports = {
  unwrapSnapshot,
  checksumSnapshot,
  validateSnapshot,
  diffSnapshots,
};
