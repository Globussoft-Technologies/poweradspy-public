import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import identityModule from '../../../src/services/planControl/engine/planIdentityResolver.js';
import evaluatorModule from '../../../src/services/planControl/engine/evaluator.js';
import validationModule from '../../../src/services/planControl/engine/policyValidation.js';
import capabilityModule from '../../../src/services/planControl/registries/capabilityRegistry.js';
import routeClassificationModule from '../../../src/services/planControl/registries/routeClassification.js';
import storageModule from '../../../src/services/planControl/storage/storage.js';

const { resolvePlanIdentity } = identityModule;
const { evaluateEntitlement } = evaluatorModule;
const { checksumSnapshot, diffSnapshots, validateSnapshot } = validationModule;
const { getCapabilities } = capabilityModule;
const { hasSelectedValue, resolveSearchBodyCapability } = routeClassificationModule;
const { recoverUniformFamilyApplications, recoverPublishedFamilyApplications } = storageModule;

function snapshot() {
  return {
    generations: [{
      generationId: '2027-growth',
      adminLabel: '2027 Growth',
      status: 'active',
    }],
    planFamilies: [{
      familyId: 'growth-2027',
      label: 'Growth',
      adminLabel: 'Growth (2027)',
      generation: '2027-growth',
      tierRank: 10,
      status: 'active',
      openForNewSignups: true,
      variants: [
        { planId: 101, billingCycle: 'monthly', billingProvider: 'amember', verified: true },
        { planId: 102, billingCycle: 'yearly', billingProvider: 'amember', verified: true },
      ],
    }],
    policies: {
      'growth-2027': {
        generalNetworks: ['facebook', 'instagram'],
        capabilities: {
          'ads.search': {
            effect: 'allow',
            networks: { mode: 'inherit_general' },
          },
          'projects.access': {
            effect: 'allow',
            networks: { mode: 'not_applicable' },
          },
          'projects.brand.create': {
            effect: 'allow',
            networks: { mode: 'not_applicable' },
            limits: { brandLimit: 3 },
          },
        },
        variantOverrides: {
          102: {
            capabilities: {
              'ads.search': { effect: 'deny' },
            },
          },
        },
      },
    },
  };
}

describe('plan-control policy engine', () => {
  it('does not enforce a capability for a false boolean toggle', () => {
    expect(hasSelectedValue(false)).toBe(false);
    expect(hasSelectedValue({ enabled: false })).toBe(false);
    expect(hasSelectedValue(true)).toBe(true);
  });

  it('keeps TikTok Sidebar Budget separate from Estimated Ad Budget', () => {
    expect(resolveSearchBodyCapability('budget', 'ad_budget_sort'))
      .toBe('legacy.sidebar_budget');
    expect(resolveSearchBodyCapability('avgBudget', 'ad_budget_sort'))
      .toBe('sort.ad_budget');
  });

  it('maps every AI Metadata request field to its single admin capability', () => {
    for (const key of [
      'has_ai_meta', 'ai_ad_type', 'ai_intent', 'ai_hook',
      'ai_offering_type', 'ai_offer_type', 'ai_colors',
      'ai_category_id', 'ai_subcategory_id',
    ]) {
      expect(resolveSearchBodyCapability(key, 'ai_metadata_filters'))
        .toBe('legacy.ai_metadata_filters');
    }
  });

  it('resolves monthly and yearly billing IDs into one family while preserving variants', () => {
    const policy = snapshot();
    expect(resolvePlanIdentity(101, policy)).toMatchObject({
      familyId: 'growth-2027',
      billingCycle: 'monthly',
    });
    expect(resolvePlanIdentity(102, policy)).toMatchObject({
      familyId: 'growth-2027',
      billingCycle: 'yearly',
    });
  });

  it('inherits family networks and rejects a network outside the plan', () => {
    const policy = snapshot();
    const identity = resolvePlanIdentity(101, policy);
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'ads.search',
      requestedNetworks: ['facebook'],
      policySnapshot: policy,
    })).toMatchObject({ allowed: true, allowedNetworks: ['facebook', 'instagram', 'admob'] });
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'ads.search',
      requestedNetworks: ['gdn'],
      policySnapshot: policy,
    })).toMatchObject({ allowed: false, reasonCode: 'NETWORK_NOT_PERMITTED' });

  });

  it('treats network "all" as every network enabled by the plan', () => {
    const policy = snapshot();
    const identity = resolvePlanIdentity(101, policy);
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'ads.search',
      requestedNetworks: ['all'],
      policySnapshot: policy,
    })).toMatchObject({
      allowed: true,
      allowedNetworks: ['facebook', 'instagram', 'admob'],
    });
  });

  it('inherits family networks when an older policy stored not_applicable for a capability that is now network-aware', () => {
    const policy = snapshot();
    policy.policies['growth-2027'].capabilities['intelligence.market_trends.overview'] = {
      effect: 'allow',
      networks: { mode: 'not_applicable' },
    };
    const identity = resolvePlanIdentity(101, policy);
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'intelligence.market_trends.overview',
      policySnapshot: policy,
    })).toMatchObject({
      allowed: true,
      allowedNetworks: ['facebook', 'instagram', 'admob'],
    });
  });

  it('lets child features inherit the exact custom networks selected on their parent', () => {
    const policy = snapshot();
    policy.policies['growth-2027'].capabilities['intelligence.market_trends'] = {
      effect: 'allow',
      networks: { mode: 'custom', allowed: ['facebook'] },
    };
    policy.policies['growth-2027'].capabilities['intelligence.market_trends.overview'] = {
      effect: 'inherit',
      networks: { mode: 'inherit_parent' },
    };
    const identity = resolvePlanIdentity(101, policy);
    expect(validateSnapshot(policy).valid).toBe(true);
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'intelligence.market_trends.overview',
      requestedNetworks: ['facebook'],
      policySnapshot: policy,
    })).toMatchObject({ allowed: true, allowedNetworks: ['facebook'], networkMode: 'inherit_parent' });
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'intelligence.market_trends.overview',
      requestedNetworks: ['instagram'],
      policySnapshot: policy,
    })).toMatchObject({ allowed: false, reasonCode: 'NETWORK_NOT_PERMITTED' });

    policy.policies['growth-2027'].capabilities['intelligence.market_trends.overview'].networks = {
      mode: 'custom',
      allowed: [],
    };
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'intelligence.market_trends.overview',
      requestedNetworks: ['facebook'],
      policySnapshot: policy,
    })).toMatchObject({ allowed: true, allowedNetworks: ['facebook'], networkMode: 'inherit_parent' });
  });

  it('applies a yearly-only override without changing monthly access', () => {
    const policy = snapshot();
    const monthly = resolvePlanIdentity(101, policy);
    const yearly = resolvePlanIdentity(102, policy);
    expect(evaluateEntitlement({
      user: {}, planIdentity: monthly, capabilityId: 'ads.search', policySnapshot: policy,
    }).allowed).toBe(true);
    expect(evaluateEntitlement({
      user: {}, planIdentity: yearly, capabilityId: 'ads.search', policySnapshot: policy,
    })).toMatchObject({ allowed: false, reasonCode: 'VARIANT_DENY' });
  });

  it('enforces parent denial for an All Projects child and returns typed limits when allowed', () => {
    const policy = snapshot();
    const identity = resolvePlanIdentity(101, policy);
    expect(evaluateEntitlement({
      user: {}, planIdentity: identity, capabilityId: 'projects.brand.create', policySnapshot: policy,
    })).toMatchObject({ allowed: true, limits: { brandLimit: 3 } });
    policy.policies['growth-2027'].capabilities['projects.access'].effect = 'deny';
    expect(evaluateEntitlement({
      user: {}, planIdentity: identity, capabilityId: 'projects.brand.create', policySnapshot: policy,
    })).toMatchObject({ allowed: false, reasonCode: 'CAPABILITY_NOT_IN_PLAN' });
  });

  it('temporarily allows a newly registered missing capability unless the generation chooses strict deny', () => {
    const policy = snapshot();
    policy.generations[0].newCapabilityDefault = 'needs_review';
    const identity = resolvePlanIdentity(101, policy);
    expect(evaluateEntitlement({
      user: {}, planIdentity: identity, capabilityId: 'legacy.test', policySnapshot: policy,
    })).toMatchObject({ allowed: true, reasonCode: 'ALLOWED_PENDING_REVIEW' });

    policy.generations[0].newCapabilityDefault = 'deny';
    expect(evaluateEntitlement({
      user: {}, planIdentity: identity, capabilityId: 'legacy.test', policySnapshot: policy,
    })).toMatchObject({ allowed: false, reasonCode: 'NEEDS_REVIEW' });
  });

  it('keeps compatibility review items visible without blocking unrelated publishes', () => {
    const policy = snapshot();
    policy.generations[0].newCapabilityDefault = 'needs_review';
    policy.policies['growth-2027'].capabilities['legacy.testingsidebar'] = {
      effect: 'allow',
      reviewed: false,
      networks: { mode: 'inherit_general' },
    };
    const result = validateSnapshot(policy);
    expect(result.valid).toBe(true);
    expect(result.errors).not.toContainEqual(expect.objectContaining({ code: 'CAPABILITY_NEEDS_REVIEW' }));
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'CAPABILITY_NEEDS_REVIEW',
      path: 'policies.growth-2027.capabilities.legacy.testingsidebar',
    }));
  });

  it('blocks an unreviewed allow when a generation explicitly uses strict deny', () => {
    const policy = snapshot();
    policy.generations[0].newCapabilityDefault = 'deny';
    policy.policies['growth-2027'].capabilities['legacy.testingsidebar'] = {
      effect: 'allow',
      reviewed: false,
      networks: { mode: 'inherit_general' },
    };
    const result = validateSnapshot(policy);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: 'STRICT_CAPABILITY_REVIEW_REQUIRED',
    }));
  });

  it('detects duplicate billing IDs and produces stable checksums and field diffs', () => {
    const policy = snapshot();
    expect(validateSnapshot(policy).valid).toBe(true);
    expect(checksumSnapshot(policy)).toBe(checksumSnapshot(JSON.parse(JSON.stringify(policy))));

    const changed = snapshot();
    changed.planFamilies.push({
      ...changed.planFamilies[0],
      familyId: 'duplicate-family',
      label: 'Duplicate',
      adminLabel: 'Duplicate',
    });
    changed.policies['duplicate-family'] = { generalNetworks: [], capabilities: {} };
    const validation = validateSnapshot(changed);
    expect(validation.errors.some((issue) => issue.code === 'DUPLICATE_PLAN_ID')).toBe(true);

    const after = snapshot();
    after.policies['growth-2027'].capabilities['ads.search'].effect = 'deny';
    expect(diffSnapshots(policy, after)).toContainEqual({
      path: 'policies.growth-2027.capabilities.ads.search.effect',
      before: 'allow',
      after: 'deny',
    });
  });

  it('validates the persisted source for same-settings-all-plan-IDs mode', () => {
    const policy = snapshot();
    policy.policies['growth-2027'].variantOverrides = {};
    policy.adminMetadata = {
      familyApplications: {
        'growth-2027': {
          mode: 'same_settings_all_plan_ids',
          sourcePlanId: 101,
        },
      },
    };
    expect(validateSnapshot(policy).valid).toBe(true);

    policy.adminMetadata.familyApplications['growth-2027'].sourcePlanId = 999;
    expect(validateSnapshot(policy).errors).toContainEqual(expect.objectContaining({
      code: 'INVALID_FAMILY_APPLICATION_SOURCE',
    }));
  });

  it('accepts recovered uniform-family metadata and keeps the admin recovery path visible', () => {
    const policy = snapshot();
    policy.policies['growth-2027'].variantOverrides = {};
    policy.adminMetadata = {
      familyApplications: {
        'growth-2027': {
          mode: 'same_settings_all_plan_ids',
          sourcePlanId: 101,
          sourceStatus: 'recovered_uniform',
        },
      },
    };
    expect(validateSnapshot(policy).valid).toBe(true);

    policy.adminMetadata.familyApplications['growth-2027'].sourceStatus = 'guessed_source';
    expect(validateSnapshot(policy).errors).toContainEqual(expect.objectContaining({
      code: 'INVALID_FAMILY_APPLICATION_SOURCE_STATUS',
    }));

    const adminBundle = fs.readFileSync(path.join(process.cwd(), 'src', 'admin', 'public', 'app.js'), 'utf8');
    expect(adminBundle).toContain("sourceStatus: 'recovered_uniform'");
    expect(adminBundle).toContain('No plan setup is required.');
    expect(adminBundle).toContain('RECOVERED FROM REVISION · APPLIED TO ALL');
    expect(adminBundle).toContain('Same as ${pv2Escape(parent.label)}');
    expect(adminBundle).toContain('pv2SetAllNetworkChoices(true)');
    expect(adminBundle).toContain('requestAnimationFrame(() => pv2EditCapabilityNetworks(capId))');
    expect(adminBundle).not.toContain('select the intended source ID, check this option');
  });

  it('durably backfills only uniform families without changing their plan rules', () => {
    const policy = snapshot();
    policy.policies['growth-2027'].variantOverrides = {};
    const exactRulesBefore = JSON.stringify(policy.policies);

    const recovered = recoverUniformFamilyApplications(policy);
    expect(recovered.recoveredFamilyIds).toEqual(['growth-2027']);
    expect(recovered.snapshot.adminMetadata.familyApplications['growth-2027']).toEqual({
      mode: 'same_settings_all_plan_ids',
      sourcePlanId: 101,
      sourceStatus: 'recovered_uniform',
    });
    expect(JSON.stringify(recovered.snapshot.policies)).toBe(exactRulesBefore);

    expect(recoverUniformFamilyApplications(recovered.snapshot).recoveredFamilyIds).toEqual([]);
    policy.policies['growth-2027'].variantOverrides = {
      102: { capabilities: { 'ads.search': { effect: 'deny' } } },
    };
    expect(recoverUniformFamilyApplications(policy).recoveredFamilyIds).toEqual([]);
  });

  it('recovers Revision 30 all-plan sources from its immutable publish diff', () => {
    const policy = snapshot();
    const recovered = recoverPublishedFamilyApplications({
      revision: 30,
      reason: 'all done new & legacy',
      snapshot: policy,
      diff: [{
        path: 'policies.growth-2027.variantOverrides.102.capabilities.ads.search.effect',
        before: 'allow',
        after: 'deny',
      }],
    });

    expect(recovered.diffRecoveredFamilyIds).toEqual(['growth-2027']);
    expect(recovered.snapshot.adminMetadata.familyApplications['growth-2027']).toEqual({
      mode: 'same_settings_all_plan_ids',
      sourcePlanId: 102,
      sourceStatus: 'recovered_from_publish_diff',
    });
    expect(recovered.snapshot.policies['growth-2027'].variantOverrides).toEqual({});
    expect(recovered.snapshot.policies['growth-2027'].capabilities['ads.search'].effect).toBe('deny');
    expect(validateSnapshot(recovered.snapshot).valid).toBe(true);

    const unrelated = recoverPublishedFamilyApplications({
      reason: 'single billing ID adjustment',
      snapshot: policy,
      diff: [{ path: 'policies.growth-2027.variantOverrides.102.capabilities.ads.search.effect' }],
    });
    expect(unrelated.recoveredFamilyIds).toEqual([]);
  });

  it('rejects per-plan overrides while same settings are locked for every plan ID', () => {
    const policy = snapshot();
    policy.adminMetadata = {
      familyApplications: {
        'growth-2027': {
          mode: 'same_settings_all_plan_ids',
          sourcePlanId: 101,
        },
      },
    };
    expect(validateSnapshot(policy).errors).toContainEqual(expect.objectContaining({
      code: 'ALL_PLAN_MODE_HAS_VARIANT_OVERRIDES',
    }));
  });

  it('keeps Plan Control internals behind the shared request enforcement layer', () => {
    const srcRoot = path.join(process.cwd(), 'src');
    const violations = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (fullPath === path.join(srcRoot, 'services', 'planControl')) continue;
          visit(fullPath);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        const source = fs.readFileSync(fullPath, 'utf8');
        if (/planControl[\\/](?:storage[\\/]storage|engine[\\/](?:evaluator|planIdentityResolver))/.test(source)) {
          violations.push(path.relative(srcRoot, fullPath));
        }
      }
    };
    visit(srcRoot);
    expect(violations, 'Feature modules must use requireCapability/getCapabilityDecision').toEqual([]);
  });

  it('requires every admin-controlled capability to declare its affected API routes', () => {
    const missingRoutes = getCapabilities()
      .filter((capability) => capability.planControlled && !(capability.routes || []).length)
      .map((capability) => capability.id);
    expect(missingRoutes).toEqual([]);
  });
});
