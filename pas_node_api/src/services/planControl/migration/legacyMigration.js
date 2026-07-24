'use strict';

const { getDB, closeDB } = require('../../sdui/db');
const { getCapabilities, getCapability, resolveFromLegacyFilter } = require('../registries/capabilityRegistry');
const { ALL_NETWORK_IDS, resolveNetworkId } = require('../registries/networkRegistry');
const { validateSnapshot, checksumSnapshot } = require('../engine/policyValidation');
const storage = require('../storage/storage');

const RESERVED_DOCS = new Set(['platform_access', 'competitor_limits', 'plan_groups', 'plan_billing_metadata']);
const FAMILY_IDS = {
  Free: 'free',
  Basic: 'basic-legacy',
  Standard: 'standard-legacy',
  Premium: 'premium-legacy',
  Platinum: 'platinum-legacy',
  Titanium: 'titanium-legacy',
  Palladium: 'palladium-legacy',
  Custom: 'custom',
  Enterprise: 'enterprise',
  'Basic (2026)': 'basic-2026',
  'Standard (2026)': 'standard-2026',
  'Platinum (2026)': 'platinum-2026',
  'Palladium (2026)': 'palladium-2026',
};

function slug(value) {
  return String(value).toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeCycle(info = {}) {
  const cycle = String(info.cycle || '').toLowerCase();
  if (cycle === 'annual' || cycle === 'yearly') return 'yearly';
  if (info.billingType === 'trial') return 'trial';
  if (info.billingType === 'platform') return 'platform';
  if (info.billingType === 'free') return 'free';
  return cycle || 'legacy';
}

function buildFamilies(legacyDocs) {
  const groupsDoc = legacyDocs.find((doc) => doc._id === 'plan_groups') || {};
  const billingDoc = legacyDocs.find((doc) => doc._id === 'plan_billing_metadata') || {};
  const groups = { ...(groupsDoc.groups || {}) };
  // Older/fallback installations have billing metadata but no plan_groups
  // document. Derive deterministic families instead of producing an empty
  // migration; live plan_groups still wins whenever it exists.
  if (!Object.keys(groups).length) {
    for (const [rawPlanId, info] of Object.entries(billingDoc.plan_info || {})) {
      const tier = String(info.tier || 'Unknown');
      const isCurrent = info.legacy === false && !['custom', 'enterprise'].includes(String(info.billingType || '').toLowerCase());
      const groupName = isCurrent ? `${tier} (2026)` : tier;
      groups[groupName] ||= {
        label: tier,
        plans: [],
        openForNewSignups: isCurrent,
      };
      groups[groupName].plans.push(Number(rawPlanId));
    }
  }
  const deleted = new Set((groupsDoc.deleted_plan_ids || []).map((item) => Number(item.plan_id)));
  const planFamilies = [];
  const planToFamily = new Map();
  const collisions = [];

  for (const [groupName, group] of Object.entries(groups)) {
    const is2026 = groupName.includes('(2026)');
    const familyId = FAMILY_IDS[groupName] || `${slug(groupName)}-${is2026 ? '2026' : 'legacy'}`;
    const family = {
      familyId,
      label: group.label || groupName.replace(/\s*\(2026\)\s*/, ''),
      adminLabel: groupName,
      generation: is2026 ? '2026-restructure' : 'legacy',
      tierRank: planFamilies.length * 10,
      status: groupName === 'Custom' ? 'custom' : (is2026 ? 'active' : 'legacy'),
      openForNewSignups: group.openForNewSignups === true,
      openForNewSignupsKnown: typeof group.openForNewSignups === 'boolean',
      salesAvailabilitySource: 'plan_access_config.plan_groups',
      color: group.color || null,
      variants: [],
    };
    for (const rawId of group.plans || []) {
      const planId = Number(rawId);
      if (!Number.isInteger(planId) || planId <= 0) continue;
      if (planToFamily.has(planId)) {
        collisions.push({ planId, families: [planToFamily.get(planId), familyId] });
        continue;
      }
      const info = billingDoc.plan_info?.[String(planId)] || {};
      family.variants.push({
        planId,
        billingCycle: normalizeCycle(info),
        billingProvider: 'amember',
        verified: true,
        ...(deleted.has(planId) ? { status: 'deleted' } : {}),
      });
      planToFamily.set(planId, familyId);
    }
    planFamilies.push(family);
  }
  return { planFamilies, planToFamily, collisions };
}

function networksForPlan(platformDoc, planId) {
  return Object.entries(platformDoc?.platform_plans || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.map(Number).includes(Number(planId)))
    .map(([network]) => resolveNetworkId(network))
    .filter(Boolean);
}

function supportedNetworks(doc) {
  const support = doc?.platform_support;
  if (!support || (typeof support === 'object' && !Array.isArray(support) && !Object.keys(support).length)) return null;
  if (Array.isArray(support)) return support.map(resolveNetworkId).filter(Boolean);
  return ALL_NETWORK_IDS.filter((network) => !(network in support) || support[network] === true);
}

function setVariantCapability(policy, planId, capabilityId, patch) {
  policy.variantOverrides[String(planId)] ||= { capabilities: {} };
  policy.variantOverrides[String(planId)].capabilities[capabilityId] = patch;
}

function assignFamilyAndVariantRules(family, policy, capabilityId, perPlanRule) {
  const variants = family.variants || [];
  if (!variants.length) return;
  const firstRule = perPlanRule(variants[0].planId);
  policy.capabilities[capabilityId] = firstRule;
  for (const variant of variants.slice(1)) {
    const rule = perPlanRule(variant.planId);
    if (JSON.stringify(rule) !== JSON.stringify(firstRule)) {
      setVariantCapability(policy, variant.planId, capabilityId, rule);
    }
  }
}

function convertLegacyDocs(legacyDocs) {
  const { planFamilies, planToFamily, collisions } = buildFamilies(legacyDocs);
  const warnings = [];
  if (collisions.length) warnings.push(...collisions.map((item) => ({ code: 'PLAN_ID_COLLISION', ...item })));
  const platformDoc = legacyDocs.find((doc) => doc._id === 'platform_access') || {};
  const limitDoc = legacyDocs.find((doc) => doc._id === 'competitor_limits') || {};
  const policies = {};

  for (const family of planFamilies) {
    const variants = family.variants || [];
    const baseNetworks = variants.length ? networksForPlan(platformDoc, variants[0].planId) : [];
    const policy = {
      generalNetworks: baseNetworks,
      capabilities: {},
      variantOverrides: {},
    };
    for (const variant of variants.slice(1)) {
      const networks = networksForPlan(platformDoc, variant.planId);
      if (JSON.stringify(networks) !== JSON.stringify(baseNetworks)) {
        policy.variantOverrides[String(variant.planId)] = { generalNetworks: networks, capabilities: {} };
      }
    }
    policies[family.familyId] = policy;
  }

  for (const doc of legacyDocs) {
    if (RESERVED_DOCS.has(doc._id)) continue;
    const capabilityId = resolveFromLegacyFilter(doc._id);
    if (!capabilityId) {
      warnings.push({ code: 'UNREGISTERED_LEGACY_RULE', legacyId: doc._id });
      continue;
    }
    const capability = getCapability(capabilityId);
    const allowedSet = Array.isArray(doc.allowed_plan_ids) ? new Set(doc.allowed_plan_ids.map(Number)) : null;
    const globalNetworks = supportedNetworks(doc);
    for (const family of planFamilies) {
      const policy = policies[family.familyId];
      assignFamilyAndVariantRules(family, policy, capabilityId, (planId) => {
        const allowed = allowedSet === null ? true : allowedSet.has(Number(planId));
        const override = doc.network_overrides?.[String(planId)];
        const allowedNetworks = Array.isArray(override)
          ? override.map(resolveNetworkId).filter(Boolean)
          : globalNetworks;
        return {
          effect: allowed ? 'allow' : 'deny',
          reviewed: doc.needs_review !== true,
          networks: capability?.networkAware
            ? allowedNetworks
              ? { mode: 'custom', allowed: allowedNetworks }
              : { mode: 'inherit_general' }
            : { mode: 'not_applicable' },
        };
      });
    }
  }

  // All Projects children inherit the legacy project_access grant. Quotas live
  // on the precise mutation capabilities that consume them.
  const projectChildren = getCapabilities().filter((cap) => cap.parentCapability === 'projects.access');
  for (const family of planFamilies) {
    const policy = policies[family.familyId];
    const parentRule = policy.capabilities['projects.access'];
    if (parentRule) {
      for (const child of projectChildren) {
        policy.capabilities[child.id] ||= {
          effect: parentRule.effect,
          reviewed: true,
          networks: child.networkAware ? { mode: 'inherit_general' } : { mode: 'not_applicable' },
        };
      }
    }
    assignFamilyAndVariantRules(family, policy, 'projects.brand.create', (planId) => {
      const limits = limitDoc.plan_limits?.[String(planId)] || {};
      return {
        ...(policy.capabilities['projects.brand.create'] || { effect: parentRule?.effect || 'deny', reviewed: true, networks: { mode: 'not_applicable' } }),
        limits: { brandLimit: Number(limits.brandLimit) || 0 },
      };
    });
    assignFamilyAndVariantRules(family, policy, 'projects.competitors.monitoring', (planId) => {
      const limits = limitDoc.plan_limits?.[String(planId)] || {};
      return {
        ...(policy.capabilities['projects.competitors.monitoring'] || { effect: parentRule?.effect || 'deny', reviewed: true, networks: { mode: 'not_applicable' } }),
        limits: { competitorLimit: Number(limits.competitorLimit) || 0 },
      };
    });
  }

  const snapshot = {
    generations: [
      { generationId: 'legacy', adminLabel: 'Legacy Plans', customerLabel: 'Legacy Plans', status: 'legacy', salesStatus: 'legacy', newCapabilityDefault: 'needs_review' },
      { generationId: '2026-restructure', adminLabel: '2026 Current Plans', customerLabel: 'Current Plans', status: 'active', salesStatus: 'current', newCapabilityDefault: 'needs_review' },
    ],
    planFamilies,
    policies,
    capabilityCatalogRevision: 1,
  };
  return {
    snapshot,
    warnings,
    checksum: checksumSnapshot(snapshot),
    validation: validateSnapshot(snapshot),
    stats: { families: planFamilies.length, plans: planToFamily.size, policies: Object.keys(policies).length },
  };
}

async function runMigration({ apply = false } = {}) {
  const db = await getDB();
  try {
    const legacyDocs = await db.collection('plan_access_config').find({}).toArray();
    if (!legacyDocs.length) throw new Error('plan_access_config is empty');
    const result = convertLegacyDocs(legacyDocs);
    console.log('[legacyMigration] Dry-run result:', JSON.stringify({
      stats: result.stats,
      checksum: result.checksum,
      warnings: result.warnings,
      validationErrors: result.validation.errors,
    }, null, 2));
    if (!apply) return result;
    if (!result.validation.valid || result.warnings.some((warning) => warning.code === 'PLAN_ID_COLLISION')) {
      throw new Error('Migration draft was not saved because critical validation issues remain.');
    }
    const active = await storage.getLatestPolicy();
    const draftId = `migration-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const saved = await storage.saveDraft({
      draftId,
      baseVersionId: active?.versionId || null,
      baseRevision: active?.revision || 0,
      snapshot: result.snapshot,
    }, 0, { username: 'migration-cli' });
    if (!saved.success) throw new Error(`Draft conflict: ${saved.conflict}`);
    console.log(`[legacyMigration] Draft saved: ${draftId}. Validate and publish it from Plan Validation.`);
    return { ...result, draft: saved.draft };
  } finally {
    await closeDB();
  }
}

if (require.main === module) {
  runMigration({ apply: process.argv.includes('--apply') }).catch((error) => {
    console.error('[legacyMigration]', error.message);
    process.exitCode = 1;
  });
}

module.exports = { convertLegacyDocs, runMigration };
