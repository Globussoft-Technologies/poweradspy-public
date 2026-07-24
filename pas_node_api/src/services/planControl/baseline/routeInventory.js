'use strict';

/**
 * Route Inventory — walks all Express routers registered in app.js and
 * the competitor service (compeitetor_analysis) and classifies every route.
 *
 * Phase 0 of the plan control revamp. Produces route_inventory.json.
 *
 * Usage:
 *   node src/services/planControl/baseline/routeInventory.js
 *   node src/services/planControl/baseline/routeInventory.js --ci
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §7.1.
 */

const fs = require('fs');
const path = require('path');

/**
 * Middleware identification patterns.
 * Maps middleware function names to their entitlement-relevant roles.
 */
const MIDDLEWARE_SIGNATURES = {
  authMiddleware: 'auth',
  planAccessMiddleware: 'plan_access',
  requirePlatform: 'platform_gate',
  requireIntelAccess: 'intelligence_gate',
  requireKeywordExplorerEnabled: 'keyword_explorer_gate',
  adminAuthMiddleware: 'admin_auth',
  requireEditorRole: 'admin_editor',
  insertionAuth: 'insertion_auth',
  verifyToken: 'auth',
};

/**
 * Route classification rules (in priority order).
 * Each rule is tested in order; first match wins.
 */
const CLASSIFICATION_RULES = [
  // Admin routes
  { pattern: /^\/admin/, classification: 'admin' },
  // Auth system
  { pattern: /^\/api\/v1?\/auth\/(login|logout|me|refresh)/, classification: 'auth_system' },
  // Public endpoints
  { pattern: /^\/api\/v1\/auth\/plans-catalog/, classification: 'public' },
  { pattern: /^\/health/, classification: 'public' },
  { pattern: /^\/api-docs/, classification: 'public' },
  { pattern: /^\/api\/v1\/email\/unsubscribe/, classification: 'public' },
  { pattern: /^\/api\/webhooks\/sendgrid/, classification: 'public' },
  { pattern: /^\/api\/email-events\/unsubscribe/, classification: 'public' },
  // Internal service (insertion, scraper, etc.)
  { pattern: /^\/api\/v1\/\w+\/insertion/, classification: 'internal_service' },
  { pattern: /^\/api\/v1\/\w+\/keywords\/work/, classification: 'internal_service' },
  // Dev-only
  { pattern: /^\/dev\//, classification: 'auth_system' },
  { pattern: /^\/sse-test/, classification: 'public' },
  // SDUI transport
  { pattern: /^\/api\/sdui/, classification: 'sdui_transport_excluded' },
  { pattern: /^\/api\/config/, classification: 'sdui_transport_excluded' },
  // aMember login
  { pattern: /^\/loginpage\//, classification: 'auth_system' },
  // Competitor service (pre-verifyToken routes)
  { pattern: /^\/api\/active-competitor-contacts/, classification: 'internal_service' },
  { pattern: /^\/api\/get-competitors$/, classification: 'internal_service' },
  { pattern: /^\/api\/update-competitors-status/, classification: 'internal_service' },
  { pattern: /^\/api\/create-mail/, classification: 'internal_service' },
  { pattern: /^\/api\/data-report\//, classification: 'internal_service' },
  { pattern: /^\/api\/keyword-notify\//, classification: 'internal_service' },
  { pattern: /^\/api\/webhooks\//, classification: 'public' },
  { pattern: /^\/api\/email-analytics\//, classification: 'admin' },
  { pattern: /^\/api\/members\/admin-overview/, classification: 'admin' },
  { pattern: /^\/api\/update-daily-competitors/, classification: 'internal_service' },
  { pattern: /^\/api\/snapshot\//, classification: 'internal_service' },
  { pattern: /^\/api\/alert-rules\/run/, classification: 'internal_service' },
  { pattern: /^\/api\/get-all-details/, classification: 'internal_service' },
  { pattern: /^\/api\/filter-details/, classification: 'internal_service' },
  { pattern: /^\/api\/get-active-details/, classification: 'internal_service' },
  { pattern: /^\/api\/get-inactive-details/, classification: 'internal_service' },
  { pattern: /^\/api\/get-comp-users-count/, classification: 'internal_service' },
  { pattern: /^\/api\/get-all-users/, classification: 'internal_service' },
  { pattern: /^\/api\/get-countries/, classification: 'internal_service' },
  // Competitor service (post-verifyToken routes = customer gated)
  { pattern: /^\/api\/(competitors-request|create-comp-details|check-user|check-brand)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(project-details|members\/)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(brand-cc|compeitetor-name|compeitetor-count)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(fetch-competitors|update-monitoring|update-competitors)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(get-competitor-count|get-store-process|check-existing|get-all-competitors)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(delete-project|add-manual|delete-competitor|check-daily-token|fetch-keywords|check-competitor)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(alert-rules\/(list|create|update|delete))/, classification: 'customer_gated' },
  { pattern: /^\/api\/(activity-feed\/)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(get-lcs|get-engagement|get-frequent|get-avgbud|get-longest|get-top|get-ad-count|get-ad-type|get-category)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(create-backlink|organic-search|paid-search)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(get-backlinks|get-organic|get-paid|get-count)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(user-brand-stats|competitor-ads|competitors-trend)/, classification: 'customer_gated' },
  { pattern: /^\/api\/(unsubscribe-mail|resubscribe-mail)/, classification: 'customer_gated' },
  { pattern: /^\/api\/update-advertiser/, classification: 'customer_gated' },
  // Common search — the main customer-gated route
  { pattern: /^\/api\/v1\/common\/ads\/search/, classification: 'customer_gated' },
  // Intelligence
  { pattern: /^\/api\/v1\/intelligence\//, classification: 'customer_gated' },
  // AI Search
  { pattern: /^\/api\/v1\/ai-search\//, classification: 'customer_gated' },
  // Keywords Explorer
  { pattern: /^\/api\/v1\/google\/keywords\//, classification: 'customer_gated' },
  // Network-specific ad APIs
  { pattern: /^\/api\/v1\/\w+\/ads\//, classification: 'customer_gated' },
  // Keyword search store
  { pattern: /^\/api\/v1\/\w+\/keywords\//, classification: 'customer_gated' },
  // Plan access endpoint
  { pattern: /^\/api\/v1\/auth\/plan-access/, classification: 'customer_base' },
  // Notification APIs
  { pattern: /^\/api\/v1\/\w+\/notifications\//, classification: 'customer_base' },
  // Onboarding
  { pattern: /^\/api\/v1\/\w+\/onboarding/, classification: 'customer_base' },
  // Catch-all: any /api/v1/* that wasn't matched
  { pattern: /^\/api\/v1\//, classification: 'customer_base' },
];

/**
 * Classify a route by its path.
 * @param {string} routePath
 * @returns {string}
 */
function classifyRoute(routePath) {
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(routePath)) {
      return rule.classification;
    }
  }
  return 'unclassified';
}

/**
 * Extract routes from an Express app instance.
 * Recursively walks the middleware stack to find all registered routes.
 *
 * @param {Object} app - Express app instance
 * @param {string} [basePath='']
 * @returns {Array<{ method: string, path: string, middlewares: string[], classification: string }>}
 */
function extractRoutes(app, basePath = '') {
  const routes = [];

  function walkStack(stack, prefix) {
    if (!stack) return;
    for (const layer of stack) {
      if (layer.route) {
        // Direct route
        const routePath = prefix + layer.route.path;
        const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
        const middlewareNames = (layer.route.stack || [])
          .map((s) => s.handle?.name || 'anonymous')
          .filter((n) => n !== 'anonymous');

        for (const method of methods) {
          const gates = middlewareNames
            .filter((n) => n in MIDDLEWARE_SIGNATURES)
            .map((n) => MIDDLEWARE_SIGNATURES[n]);

          routes.push({
            method,
            path: routePath,
            middlewares: middlewareNames,
            gates,
            classification: classifyRoute(routePath),
          });
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        // Sub-router
        const subPrefix = prefix + (layer.regexp
          ? extractPathFromRegexp(layer.regexp, layer.keys)
          : '');
        walkStack(layer.handle.stack, subPrefix);
      }
    }
  }

  // Try the standard _router.stack first
  if (app._router?.stack) {
    walkStack(app._router.stack, basePath);
  }

  return routes;
}

/**
 * Extract a readable path from an Express layer's regexp.
 * This is a best-effort heuristic for extracting the mount path.
 */
function extractPathFromRegexp(regexp, keys) {
  if (!regexp) return '';
  const str = regexp.toString();
  // Remove leading /^ and trailing \/?(?=\/|$)/i or similar
  const cleaned = str
    .replace(/^\/\^/, '')
    .replace(/\\\/\?\(\?=\\\/\|\$\)\/?[gim]*$/, '')
    .replace(/\\\//g, '/')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param');
  return cleaned || '';
}

/**
 * Build a static route inventory for the competitor service
 * (since it uses ESM imports, we can't dynamically require it).
 *
 * @returns {Array<{ method: string, path: string, classification: string, service: string }>}
 */
function buildCompetitorServiceInventory() {
  // These are statically extracted from compeitetor_analysis/resources/routes/routes.js
  const preAuth = [
    ['POST', '/api/active-competitor-contacts'],
    ['GET', '/api/get-competitors'],
    ['GET', '/api/update-competitors-status'],
    ['POST', '/api/create-mail'],
    ['POST', '/api/data-report/send'],
    ['POST', '/api/data-report/test'],
    ['GET', '/api/data-report/stats'],
    ['GET', '/api/data-report/subscribers'],
    ['GET', '/api/data-report/contacts'],
    ['GET', '/api/data-report/recipients'],
    ['POST', '/api/keyword-notify/run'],
    ['GET', '/api/keyword-notify/preview'],
    ['GET', '/api/keyword-notify/schedule'],
    ['POST', '/api/webhooks/sendgrid'],
    ['POST', '/api/email-events/unsubscribe'],
    ['POST', '/api/email-analytics/send-competitor'],
    ['POST', '/api/email-analytics/send-data-report'],
    ['POST', '/api/email-analytics/send-keyword-notify'],
    ['GET', '/api/members/admin-overview'],
    ['GET', '/api/update-daily-competitors'],
    ['POST', '/api/unsubscribe-mail'],
    ['POST', '/api/resubscribe-mail'],
    ['GET', '/api/get-all-details'],
    ['POST', '/api/filter-details'],
    ['GET', '/api/get-active-details'],
    ['GET', '/api/get-inactive-details'],
    ['GET', '/api/get-comp-users-count'],
    ['GET', '/api/get-all-users'],
    ['POST', '/api/user-brand-stats'],
    ['POST', '/api/competitor-ads-by-range'],
    ['POST', '/api/competitors-trend-batch'],
    ['GET', '/api/snapshot/run'],
    ['GET', '/api/snapshot/last-run'],
    ['GET', '/api/alert-rules/run'],
    ['POST', '/api/get-lcs'],
    ['POST', '/api/get-engagement'],
    ['POST', '/api/get-frequent-data'],
    ['POST', '/api/get-avgbud-data'],
    ['POST', '/api/get-longest'],
    ['POST', '/api/get-top-likes'],
    ['POST', '/api/get-top-comments'],
    ['POST', '/api/get-top-impression'],
    ['POST', '/api/get-top-popularity'],
    ['POST', '/api/get-category'],
    ['POST', '/api/get-ad-count'],
    ['POST', '/api/get-ad-type'],
    ['GET', '/api/get-countries'],
  ];

  const postAuth = [
    ['POST', '/api/create-backlink'],
    ['POST', '/api/organic-search'],
    ['POST', '/api/paid-search'],
    ['POST', '/api/create-comp-details'],
    ['POST', '/api/competitors-request'],
    ['GET', '/api/check-user'],
    ['POST', '/api/check-brand'],
    ['POST', '/api/project-details'],
    ['POST', '/api/members/list'],
    ['POST', '/api/members/add'],
    ['POST', '/api/members/update'],
    ['POST', '/api/members/delete'],
    ['POST', '/api/brand-cc/get'],
    ['POST', '/api/brand-cc/set'],
    ['POST', '/api/compeitetor-name'],
    ['POST', '/api/compeitetor-name-client'],
    ['POST', '/api/compeitetor-count'],
    ['POST', '/api/fetch-competitors'],
    ['POST', '/api/fetch-competitors-client'],
    ['POST', '/api/fetch-competitors-for-update'],
    ['POST', '/api/fetch-competitors-for-update-client'],
    ['POST', '/api/fetch-competitors-for-update-new'],
    ['POST', '/api/get-competitor-count'],
    ['POST', '/api/get-competitor-count-new'],
    ['POST', '/api/update-monitoring'],
    ['POST', '/api/get-backlinks'],
    ['POST', '/api/get-organic-searches'],
    ['POST', '/api/get-paid-searches'],
    ['POST', '/api/get-count'],
    ['POST', '/api/get-store-process-competitors'],
    ['POST', '/api/check-existing-competitorcount'],
    ['POST', '/api/get-all-competitors'],
    ['POST', '/api/update-competitors'],
    ['POST', '/api/update-competitors-new'],
    ['PATCH', '/api/update-advertiser'],
    ['POST', '/api/check-daily-token-limit'],
    ['POST', '/api/fetch-keywords-basedOnWebsite'],
    ['POST', '/api/check-competitor-process'],
    ['POST', '/api/delete-project'],
    ['POST', '/api/add-manual-competitor'],
    ['POST', '/api/delete-competitor'],
    ['POST', '/api/alert-rules/list'],
    ['POST', '/api/alert-rules/create'],
    ['POST', '/api/alert-rules/update'],
    ['POST', '/api/alert-rules/delete'],
    ['POST', '/api/activity-feed/list'],
    ['POST', '/api/activity-feed/mark-read'],
  ];

  const routes = [];

  for (const [method, routePath] of preAuth) {
    routes.push({
      method,
      path: routePath,
      gates: [],
      classification: classifyRoute(routePath),
      service: 'compeitetor_analysis',
      authRequired: false,
    });
  }

  for (const [method, routePath] of postAuth) {
    routes.push({
      method,
      path: routePath,
      gates: ['auth'],
      classification: classifyRoute(routePath),
      service: 'compeitetor_analysis',
      authRequired: true,
    });
  }

  return routes;
}

/**
 * Build the complete route inventory (pas_node_api + compeitetor_analysis).
 *
 * @param {Object} [options]
 * @param {Object} [options.app]        - Express app (for dynamic extraction)
 * @param {string} [options.outputPath] - Where to write
 * @param {boolean} [options.ci]        - If true, exit with error code on unclassified routes
 * @param {boolean} [options.write]     - Set false for an in-memory CI check
 * @param {Object} [options.logger]
 * @returns {Object} The inventory result
 */
function buildRouteInventory({ app, outputPath, ci = false, write = true, logger = console } = {}) {
  const log = logger;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  log.info?.('[routeInventory] Building route inventory...');

  let pasRoutes = [];
  if (app) {
    pasRoutes = extractRoutes(app).map((r) => ({
      ...r,
      service: 'pas_node_api',
      authRequired: r.gates.includes('auth'),
    }));
  }

  const competitorRoutes = buildCompetitorServiceInventory();
  const allRoutes = [...pasRoutes, ...competitorRoutes];

  // Classification summary
  const classificationCounts = {};
  const unclassified = [];

  for (const route of allRoutes) {
    const c = route.classification;
    classificationCounts[c] = (classificationCounts[c] || 0) + 1;
    if (c === 'unclassified') {
      unclassified.push(`${route.method} ${route.path} (${route.service})`);
    }
  }

  const inventory = {
    generatedAt: new Date().toISOString(),
    totalRoutes: allRoutes.length,
    pasNodeApiRoutes: pasRoutes.length,
    competitorServiceRoutes: competitorRoutes.length,
    classificationCounts,
    unclassifiedRoutes: unclassified,
    routes: allRoutes,
  };

  // Write to file
  const finalPath = outputPath || path.join(
    __dirname,
    `route_inventory_${timestamp}.json`
  );

  if (write) {
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(finalPath, JSON.stringify(inventory, null, 2), 'utf8');
  }

  log.info?.(`[routeInventory] ${allRoutes.length} routes classified`);
  log.info?.(`[routeInventory] Classifications: ${JSON.stringify(classificationCounts)}`);
  if (write) log.info?.(`[routeInventory] Written to: ${finalPath}`);

  if (unclassified.length > 0) {
    log.warn?.(`[routeInventory] ${unclassified.length} unclassified routes:`);
    for (const u of unclassified) {
      log.warn?.(`  ❓ ${u}`);
    }
  }

  if (ci && unclassified.length > 0) {
    log.error?.('[routeInventory] CI mode: unclassified routes found — failing');
    return { ...inventory, exitCode: 1 };
  }

  return { ...inventory, path: write ? finalPath : null, exitCode: 0 };
}

// ── CLI runner ──────────────────────────────────────────────────────────────

if (require.main === module) {
  const ciMode = process.argv.includes('--ci');
  const result = buildRouteInventory({ ci: ciMode });
  console.log('\n📋 Route inventory complete:');
  console.log(`  Total: ${result.totalRoutes}`);
  console.log(`  PAS Node API: ${result.pasNodeApiRoutes}`);
  console.log(`  Competitor Service: ${result.competitorServiceRoutes}`);
  console.log(`  Classifications: ${JSON.stringify(result.classificationCounts, null, 2)}`);
  if (result.unclassifiedRoutes.length > 0) {
    console.log(`\n  ⚠️  ${result.unclassifiedRoutes.length} unclassified routes`);
  }
  process.exit(result.exitCode);
}

module.exports = {
  classifyRoute,
  extractRoutes,
  buildCompetitorServiceInventory,
  buildRouteInventory,
  CLASSIFICATION_RULES,
  MIDDLEWARE_SIGNATURES,
};
