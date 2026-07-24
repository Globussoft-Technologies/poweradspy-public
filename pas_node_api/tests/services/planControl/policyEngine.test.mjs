import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import identityModule from '../../../src/services/planControl/engine/planIdentityResolver.js';
import evaluatorModule from '../../../src/services/planControl/engine/evaluator.js';
import validationModule from '../../../src/services/planControl/engine/policyValidation.js';
import capabilityModule from '../../../src/services/planControl/registries/capabilityRegistry.js';

const { resolvePlanIdentity } = identityModule;
const { evaluateEntitlement } = evaluatorModule;
const { checksumSnapshot, diffSnapshots, validateSnapshot } = validationModule;
const { getCapabilities } = capabilityModule;

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
    })).toMatchObject({ allowed: true, allowedNetworks: ['facebook', 'instagram'] });
    expect(evaluateEntitlement({
      user: {},
      planIdentity: identity,
      capabilityId: 'ads.search',
      requestedNetworks: ['youtube'],
      policySnapshot: policy,
    })).toMatchObject({ allowed: false, reasonCode: 'NETWORK_NOT_PERMITTED' });
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
