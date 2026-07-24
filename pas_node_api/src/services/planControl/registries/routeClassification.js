'use strict';

const { resolveFromLegacyFilter } = require('./capabilityRegistry');
const { BODY_KEY_TO_FILTER_ID } = require('../../planAccess/planAccessService');

let _runtime;
function runtime() {
  if (_runtime) return _runtime;
  const config = require('../../../config');
  const logger = require('../../../logger');
  _runtime = {
    config,
    log: logger.createChild('route-classification'),
    getLatestPolicy: require('../storage/storage').getLatestPolicy,
    resolvePlanIdentity: require('../engine/planIdentityResolver').resolvePlanIdentity,
    evaluateEntitlement: require('../engine/evaluator').evaluateEntitlement,
  };
  return _runtime;
}
const CLASSIFICATIONS = {
  CUSTOMER_GATED: 'customer_gated',
  CUSTOMER_BASE: 'customer_base',
  PUBLIC: 'public',
  AUTH_SYSTEM: 'auth_system',
  INTERNAL_SERVICE: 'internal_service',
  ADMIN: 'admin',
  SDUI_TRANSPORT_EXCLUDED: 'sdui_transport_excluded',
};

const ROUTE_CLASSIFICATIONS = {
  'POST /api/v1/auth/login': CLASSIFICATIONS.AUTH_SYSTEM,
  'POST /api/v1/auth/logout': CLASSIFICATIONS.AUTH_SYSTEM,
  'GET /api/v1/auth/me': CLASSIFICATIONS.AUTH_SYSTEM,
  'POST /api/v1/auth/refresh': CLASSIFICATIONS.AUTH_SYSTEM,
  'GET /api/v1/auth/plans-catalog': CLASSIFICATIONS.PUBLIC,
  'GET /health': CLASSIFICATIONS.PUBLIC,
  'GET /api/v1/auth/plan-access': CLASSIFICATIONS.CUSTOMER_BASE,
  'GET /api/v1/auth/entitlements': CLASSIFICATIONS.CUSTOMER_BASE,
  'POST /api/v1/common/ads/search': CLASSIFICATIONS.CUSTOMER_GATED,
  '/admin': CLASSIFICATIONS.ADMIN,
  '/insertion': CLASSIFICATIONS.INTERNAL_SERVICE,
  '/api/v1/sdui': CLASSIFICATIONS.SDUI_TRANSPORT_EXCLUDED,
};

const _capabilityBindings = new Map();

function normalizeNetworks(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(normalizeNetworks);
  return String(value).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/**
 * Single reusable entry point for evaluating one capability on an HTTP request.
 * Feature modules should never import storage/resolver/evaluator separately.
 * Returns null only when no active Plan Control policy exists, allowing old
 * installations to use an explicit legacy fallback during migration.
 */
async function getCapabilityDecision(req, capabilityId, options = {}) {
  const networks = typeof options.network === 'function'
    ? normalizeNetworks(options.network(req))
    : normalizeNetworks(options.network);
  const { getLatestPolicy, resolvePlanIdentity, evaluateEntitlement } = runtime();
  const policy = await getLatestPolicy();
  if (!policy) return null;
  const planId = req.user?.userSubscriptionType || req.user?.plan_id;
  const decision = evaluateEntitlement({
    user: req.user,
    planIdentity: resolvePlanIdentity(planId, policy),
    capabilityId,
    requestedNetworks: networks,
    action: typeof options.action === 'function' ? options.action(req) : options.action,
    quotaStatus: options.quotaStatus?.(req),
    policySnapshot: policy,
  });
  req._planControlCapability = { capabilityId, networks };
  req.planControlDecision = decision;
  return decision;
}

function requireCapability(capabilityId, options = {}) {
  const bindingId = `${capabilityId}:${_capabilityBindings.size}`;
  _capabilityBindings.set(bindingId, { capabilityId, options });
  return async function planCapabilityMiddleware(req, res, next) {
    try {
      const { config, log } = runtime();
      const decision = await getCapabilityDecision(req, capabilityId, options);
      if (!decision) {
        if (config.planControl?.enforcementMode === 'enforce') {
          return res.status(503).json({ code: 503, message: 'Entitlement policy unavailable.', reasonCode: 'POLICY_UNAVAILABLE' });
        }
        return next();
      }
      const planId = req.user?.userSubscriptionType || req.user?.plan_id;
      if (!decision.allowed && config.planControl?.enforcementMode === 'enforce') {
        return res.status(403).json({
          code: 403,
          message: options.message || 'Your current plan does not support this feature.',
          ...decision,
        });
      }
      if (!decision.allowed) {
        log.warn('plan-control-shadow-denial', {
          capabilityId,
          planId,
          networks: req._planControlCapability?.networks || [],
          reasonCode: decision.reasonCode,
          path: req.originalUrl,
        });
      }
      return next();
    } catch (error) {
      const current = _runtime;
      current?.log?.error('plan-control-check-failed', { capabilityId, error: error.message });
      const config = current?.config || {};
      if (config.planControl?.enforcementMode === 'enforce') {
        return res.status(503).json({ code: 503, message: 'Entitlement check unavailable.', reasonCode: 'POLICY_UNAVAILABLE' });
      }
      return next();
    }
  };
}

function hasSelectedValue(value) {
  if (value === undefined || value === null || value === '' || value === 'NA') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value !== 'object') return true;
  return Object.values(value).some(hasSelectedValue);
}

/**
 * Evaluates the Ads Search parent plus every filter actually present in the
 * request. This keeps newly registered legacy filters plan-controlled without
 * adding another route-specific middleware each time.
 */
function requireSearchCapabilities(options = {}) {
  return async function planSearchCapabilityMiddleware(req, res, next) {
    const body = req.body || {};
    const networks = normalizeNetworks(
      body.network || body.platform || body.networks || req.query?.network || req.query?.platform
    );
    const capabilities = ['ads.search'];
    for (const [bodyKey, legacyFilterId] of Object.entries(BODY_KEY_TO_FILTER_ID || {})) {
      if (!hasSelectedValue(body[bodyKey])) continue;
      const capabilityId = resolveFromLegacyFilter(legacyFilterId);
      if (capabilityId && !capabilities.includes(capabilityId)) capabilities.push(capabilityId);
    }

    try {
      const { config, log, getLatestPolicy, resolvePlanIdentity, evaluateEntitlement } = runtime();
      const policy = await getLatestPolicy();
      if (!policy) {
        if (config.planControl?.enforcementMode === 'enforce') {
          return res.status(503).json({ code: 503, message: 'Entitlement policy unavailable.', reasonCode: 'POLICY_UNAVAILABLE' });
        }
        return next();
      }
      const planId = req.user?.userSubscriptionType || req.user?.plan_id;
      const planIdentity = resolvePlanIdentity(planId, policy);
      const decisions = capabilities.map((capabilityId) => evaluateEntitlement({
        user: req.user,
        planIdentity,
        capabilityId,
        requestedNetworks: capabilityId === 'ads.search' ? networks : [],
        policySnapshot: policy,
      }));
      req.planControlDecisions = decisions;
      const denied = decisions.find((decision) => !decision.allowed);
      if (!denied) return next();

      if (config.planControl?.enforcementMode === 'enforce') {
        return res.status(403).json({
          code: 403,
          message: options.message || 'Your current plan does not support the selected search option.',
          ...denied,
        });
      }
      log.warn('plan-control-search-shadow-denial', {
        planId,
        path: req.originalUrl,
        capabilityId: denied.capabilityId,
        reasonCode: denied.reasonCode,
        networks,
      });
      return next();
    } catch (error) {
      const current = _runtime;
      current?.log?.error('plan-control-search-check-failed', { error: error.message });
      const config = current?.config || {};
      if (config.planControl?.enforcementMode === 'enforce') {
        return res.status(503).json({ code: 503, message: 'Entitlement check unavailable.', reasonCode: 'POLICY_UNAVAILABLE' });
      }
      return next();
    }
  };
}

function requireConditionalCapability({ when, capabilityId, network, action }) {
  const gate = requireCapability(capabilityId, { network, action });
  return function conditionalCapabilityMiddleware(req, res, next) {
    if (typeof when === 'function' && when(req)) return gate(req, res, next);
    return next();
  };
}

function fromBody(field) {
  return (req) => req.body?.[field] || null;
}

function fromQuery(field) {
  return (req) => req.query?.[field] || null;
}

function getCapabilityBindings() {
  return new Map(_capabilityBindings);
}

function classifyRoute(method, path) {
  const exact = `${String(method).toUpperCase()} ${path}`;
  if (ROUTE_CLASSIFICATIONS[exact]) return ROUTE_CLASSIFICATIONS[exact];
  if (ROUTE_CLASSIFICATIONS[path]) return ROUTE_CLASSIFICATIONS[path];
  for (const [key, classification] of Object.entries(ROUTE_CLASSIFICATIONS)) {
    if (!key.includes(' ') && path.startsWith(key)) return classification;
  }
  return null;
}

module.exports = {
  CLASSIFICATIONS,
  ROUTE_CLASSIFICATIONS,
  requireCapability,
  getCapabilityDecision,
  requireSearchCapabilities,
  requireConditionalCapability,
  fromBody,
  fromQuery,
  normalizeNetworks,
  getCapabilityBindings,
  classifyRoute,
};
