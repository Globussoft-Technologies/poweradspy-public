'use strict';

/**
 * Plan Control Module
 *
 * This module exports the new unified entitlement engine, registries,
 * and baseline tools for the Phase 0-3 migration.
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md for details.
 */

// ── ENGINE ────────────────────────────────────────────────────────
const evaluator = require('./engine/evaluator');
const planFamilies = require('./engine/planFamilies');
const planIdentityResolver = require('./engine/planIdentityResolver');
const reasonCodes = require('./engine/reasonCodes');
const shadowCompare = require('./engine/shadowCompare');
const policyValidation = require('./engine/policyValidation');

// ── REGISTRIES ────────────────────────────────────────────────────
const capabilityRegistry = require('./registries/capabilityRegistry');
const networkRegistry = require('./registries/networkRegistry');
const routeClassification = require('./registries/routeClassification');

// ── BASELINE TOOLS ────────────────────────────────────────────────
const exportBaseline = require('./baseline/exportBaseline');
const goldenMatrix = require('./baseline/goldenMatrix');
const routeInventory = require('./baseline/routeInventory');

module.exports = {
  // Evaluator
  evaluateEntitlement: evaluator.evaluateEntitlement,
  evaluateAllCapabilities: evaluator.evaluateAllCapabilities,
  makeDecision: evaluator.makeDecision,

  // Identities
  planFamilies,
  resolvePlanIdentity: planIdentityResolver.resolvePlanIdentity,
  resolveBillingVariant: planIdentityResolver.resolveBillingVariant,

  // Reason codes
  reasonCodes,
  policyValidation,

  // Middleware
  createShadowCompareMiddleware: shadowCompare.createShadowCompareMiddleware,
  requireCapability: routeClassification.requireCapability,
  requireConditionalCapability: routeClassification.requireConditionalCapability,
  classifyRoute: routeClassification.classifyRoute,

  // Registries
  capabilities: capabilityRegistry,
  networks: networkRegistry,

  // Baseline/Export tools
  baseline: {
    exportBaseline: exportBaseline.exportBaseline,
    buildGoldenMatrix: goldenMatrix.buildGoldenMatrix,
    compareMatrices: goldenMatrix.compareMatrices,
    buildRouteInventory: routeInventory.buildRouteInventory,
  },
};
