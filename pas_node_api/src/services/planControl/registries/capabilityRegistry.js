'use strict';

/**
 * Capability Registry — master catalog of all customer-visible capabilities.
 *
 * Each capability represents a customer-visible feature, filter group, action,
 * API operation, or quota-bearing function that can be plan-controlled.
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §6.4 — Capability definition.
 *
 * IMPORTANT: This file only DEFINES capabilities. Policy rules (which plan gets
 * which capability) live in the policy layer (evaluator + policy store).
 */

/**
 * @typedef {'active'|'needs_review'|'planned'|'disabled'|'deprecated'|'unwired'} CapabilityStatus
 */

/**
 * @typedef {Object} CapabilityRoute
 * @property {string} method  - HTTP method
 * @property {string} path    - Route path pattern
 * @property {string} [condition] - When this route triggers the capability
 */

/**
 * @typedef {Object} CapabilityFrontend
 * @property {string} route           - Frontend route path
 * @property {string} location        - Human-readable breadcrumb
 * @property {string[]} controlIds    - Frontend control identifiers
 * @property {string} [previewMode]   - 'interactive_mock' | 'screenshot' | 'none'
 */

/**
 * @typedef {Object} CapabilityDefinition
 * @property {string} id              - Dot-notated capability ID
 * @property {string} label           - Human-readable name
 * @property {string} description     - Plain-language description
 * @property {string} category        - Product area/group
 * @property {CapabilityStatus} status
 * @property {boolean} planControlled - Whether plan rules apply
 * @property {boolean} networkAware   - Whether network context matters
 * @property {string[]} supportedNetworks - Which networks support this (empty = all)
 * @property {'deny'|'allow'} defaultPolicy - Default when no policy exists
 * @property {string} owner           - Owning team/module
 * @property {string} [introducedIn]  - When this capability was introduced
 * @property {CapabilityRoute[]} routes
 * @property {CapabilityFrontend} [frontend]
 * @property {Object} [lockedExperience]
 * @property {string[]} [limitTypes]  - Quota types this capability uses
 * @property {string} [parentCapability] - Parent capability ID (for hierarchical deny)
 */

/** @type {CapabilityDefinition[]} */
const CAPABILITY_DEFINITIONS = [
  // ─── Ads Search capabilities ──────────────────────────────────────────────
  {
    id: 'ads.search',
    label: 'Ads Search',
    description: 'Search and browse ads across all supported networks.',
    category: 'Ads Library',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'ads-search',
    introducedIn: 'legacy',
    routes: [
      { method: 'POST', path: '/api/v1/common/ads/search' },
    ],
    frontend: {
      route: '/ads',
      location: 'Ads Library',
      controlIds: ['ads_search'],
      previewMode: 'interactive_mock',
    },
    lockedExperience: {
      behavior: 'disable_control_and_show_upgrade',
      message: 'Upgrade your plan to search ads on this network.',
    },
  },

  // ─── Search type capabilities (derived from BODY_KEY_TO_FILTER_ID) ────────
  {
    id: 'ads.search.keyword',
    label: 'Keyword Search',
    description: 'Search ads by keyword.',
    category: 'Search Types',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.keyword is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Search Bar > Keyword', controlIds: ['keyword_search'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to use keyword search.' },
  },
  {
    id: 'ads.search.advertiser',
    label: 'Advertiser Search',
    description: 'Search ads by advertiser name.',
    category: 'Search Types',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.advertiser is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Search Bar > Advertiser', controlIds: ['advertiser_search'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to use advertiser search.' },
  },
  {
    id: 'ads.search.domain',
    label: 'Domain Search',
    description: 'Search ads by domain.',
    category: 'Search Types',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.domain is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Search Bar > Domain', controlIds: ['domain_search'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to use domain search.' },
  },

  // ─── Filter capabilities ─────────────────────────────────────────────────
  {
    id: 'filter.country',
    label: 'Country Filter',
    description: 'Filter ads by country/geography.',
    category: 'Filters',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.country is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Country', controlIds: ['country'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by country.' },
  },
  {
    id: 'filter.gender',
    label: 'Gender Filter',
    description: 'Filter ads by target gender.',
    category: 'Targeting Filters',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: ['facebook', 'instagram'],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.gender is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Gender', controlIds: ['gender'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by gender.' },
  },
  {
    id: 'filter.age',
    label: 'Age Filter',
    description: 'Filter ads by target audience age.',
    category: 'Targeting Filters',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: ['facebook', 'instagram'],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.lower_age or body.upper_age is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Audience Age', controlIds: ['age'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by age.' },
  },
  {
    id: 'filter.ad_type',
    label: 'Ad Type Filter',
    description: 'Filter ads by type (image, video, carousel, etc.).',
    category: 'Targeting Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.type is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Ad Type', controlIds: ['ad_type'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by ad type.' },
  },
  {
    id: 'filter.ad_position',
    label: 'Ad Position Filter',
    description: 'Filter ads by placement position.',
    category: 'Targeting Filters',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: ['facebook', 'instagram'],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.ad_position is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Ad Position', controlIds: ['ad_position'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by ad position.' },
  },
  {
    id: 'filter.call_to_action',
    label: 'Call to Action Filter',
    description: 'Filter ads by CTA button type.',
    category: 'Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.call_to_action is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Call to Action', controlIds: ['call_to_action'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by CTA.' },
  },
  {
    id: 'filter.category',
    label: 'Ad Category Filter',
    description: 'Filter ads by category and subcategory.',
    category: 'Filters',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.adcategory is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Category', controlIds: ['category', 'subCategory'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by category.' },
  },
  {
    id: 'filter.language',
    label: 'Language Filter',
    description: 'Filter ads by language.',
    category: 'Filters',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.lang is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Language', controlIds: ['language'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by language.' },
  },

  // ─── Sort capabilities ────────────────────────────────────────────────────
  {
    id: 'sort.ad_budget',
    label: 'Estimated Ad Budget Sort',
    description: 'Sort ads by estimated ad budget.',
    category: 'Sort Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.adBudget or body.avgBudget is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sort > Ad Budget', controlIds: ['ad_budget_sort'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to sort by ad budget.' },
  },

  // ─── Lander/merchant capabilities ─────────────────────────────────────────
  {
    id: 'filter.affiliate_network',
    label: 'Affiliate Network Filter',
    description: 'Filter ads by affiliate network.',
    category: 'Advanced Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.affiliate is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Affiliate Network', controlIds: ['affiliate_network'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by affiliate network.' },
  },
  {
    id: 'filter.ecommerce_platform',
    label: 'E-commerce Platform Filter',
    description: 'Filter ads by e-commerce platform (Shopify, WooCommerce, etc.).',
    category: 'Advanced Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.ecommerce is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > E-commerce Platform', controlIds: ['ecommerce_platform'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by e-commerce platform.' },
  },
  {
    id: 'filter.marketing_platform',
    label: 'Marketing Platform Filter',
    description: 'Filter ads by marketing platform.',
    category: 'Advanced Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.market_platform is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Marketing Platform', controlIds: ['marketing_platform'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by marketing platform.' },
  },
  {
    id: 'filter.traffic_source',
    label: 'Traffic Source Filter',
    description: 'Filter ads by traffic source.',
    category: 'Advanced Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.source is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Traffic Source', controlIds: ['traffic_source'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by traffic source.' },
  },
  {
    id: 'filter.funnel',
    label: 'Funnel Filter',
    description: 'Filter ads by funnel stage.',
    category: 'Advanced Filters',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.funnel is present' }],
    frontend: { route: '/ads', location: 'Ads Library > Sidebar > Funnel', controlIds: ['funnel'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to filter by funnel.' },
  },

  // ─── Google Transparency ─────────────────────────────────────────────────
  {
    id: 'google.transparency.search',
    label: 'Google Transparency Ads',
    description: 'Search ads from Google Ads Transparency Center data.',
    category: 'Ads Library',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: ['google'],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    introducedIn: '2026-07',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: 'body.google_transparency_ads is enabled' }],
    frontend: {
      route: '/ads',
      location: 'Ads Library > Google > Google Transparency Ads',
      controlIds: ['google_transparency_ads', 'google_transparency_subnetwork'],
      previewMode: 'interactive_mock',
    },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade your plan to use Google Transparency Ads.' },
  },

  // ─── Intelligence / Market Trends ─────────────────────────────────────────
  {
    id: 'intelligence.market_trends',
    label: 'Market Trends',
    description: 'Analyze ad market trends across networks.',
    category: 'Intelligence',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow', // Currently in beta — free for all
    owner: 'intelligence',
    routes: [
      { method: 'GET', path: '/api/v1/intelligence/access' },
      { method: 'GET', path: '/api/v1/intelligence/trends/overview' },
      { method: 'GET', path: '/api/v1/intelligence/trends/categories' },
      { method: 'GET', path: '/api/v1/intelligence/trends/top' },
      { method: 'GET', path: '/api/v1/intelligence/trends/regions' },
      { method: 'GET', path: '/api/v1/intelligence/trends/keywords' },
      { method: 'GET', path: '/api/v1/intelligence/trends/search' },
    ],
    frontend: { route: '/market-trends', location: 'Market Trends', controlIds: ['market_trends'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to access Market Trends.' },
  },

  // ─── Keyword Explorer ─────────────────────────────────────────────────────
  {
    id: 'intelligence.keyword_explorer',
    label: 'Keyword Explorer',
    description: 'Explore keyword ideas, volumes, and competition.',
    category: 'Intelligence',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: ['google'],
    defaultPolicy: 'allow', // Currently in beta
    owner: 'intelligence',
    routes: [
      { method: 'POST', path: '/api/v1/google/keywords/explorer' },
      { method: 'POST', path: '/api/v1/google/keywords/ideas' },
      { method: 'POST', path: '/api/v1/google/keywords/import' },
      { method: 'POST', path: '/api/v1/google/keywords/lists' },
      { method: 'POST', path: '/api/v1/google/keywords/lists/get' },
      { method: 'POST', path: '/api/v1/google/keywords/lists/:id/items/get' },
      { method: 'POST', path: '/api/v1/google/keywords/lists/:id/items' },
      { method: 'POST', path: '/api/v1/google/keywords/lists/:id/rename' },
      { method: 'POST', path: '/api/v1/google/keywords/lists/:id/delete' },
      { method: 'POST', path: '/api/v1/google/keywords/lists/:id/items/remove' },
    ],
    frontend: { route: '/keywords-explorer', location: 'Keyword Explorer', controlIds: ['keyword_explorer'], previewMode: 'structured' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to access Keyword Explorer.' },
  },

  // ─── Competitive Intelligence (Google) ────────────────────────────────────
  {
    id: 'intelligence.competitive',
    label: 'Competitive Intelligence',
    description: 'Access advertiser profiles, ad trends, and keyword insights.',
    category: 'Intelligence',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: ['google'],
    defaultPolicy: 'deny',
    owner: 'intelligence',
    routes: [
      { method: 'POST', path: '/api/v1/google/keywords/insight' },
      { method: 'POST', path: '/api/v1/google/advertiser/profile' },
      { method: 'POST', path: '/api/v1/google/ads/trends' },
    ],
    frontend: { route: '/ads', location: 'Ads Library > Google > Competitive Intelligence', controlIds: ['ad_analytics'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to access competitive intelligence.' },
  },

  // ─── Projects / Competitor Analysis (parent capability) ───────────────────
  {
    id: 'projects.access',
    label: 'All Projects',
    description: 'Access the All Projects section for competitor tracking and analysis.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    routes: [
      { method: 'GET', path: '/check-user' },
      { method: 'POST', path: '/create-comp-details' },
      { method: 'POST', path: '/project-details' },
    ],
    frontend: { route: '/projects', location: 'All Projects', controlIds: ['project_access'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to access All Projects.' },
    limitTypes: ['brandLimit', 'competitorLimit'],
  },
  {
    id: 'projects.session',
    label: 'Projects Session',
    description: 'Resolve the All Projects service user and synchronize the verified billing identity.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'GET', path: '/check-user' },
      { method: 'POST', path: '/create-comp-details' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Session startup', controlIds: ['projects_session'], previewMode: 'structured' },
    lockedExperience: { behavior: 'lock_route_and_show_upgrade', message: 'Upgrade to open All Projects.' },
  },
  {
    id: 'projects.view',
    label: 'View Projects',
    description: 'Load existing tracked brands, projects, competitors, and project counts.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'POST', path: '/project-details' },
      { method: 'POST', path: '/get-count' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Project list and details', controlIds: ['projects_view'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'lock_route_and_show_upgrade', message: 'Upgrade to view All Projects.' },
  },
  {
    id: 'projects.brand.create',
    label: 'Create Brand/Project',
    description: 'Create a tracked brand or project.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [{ method: 'POST', path: '/competitors-request' }],
    frontend: { route: '/projects', location: 'All Projects > Add Brand', controlIds: ['projects_brand_create'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to create more brands.' },
    limitTypes: ['brandLimit'],
  },
  {
    id: 'projects.competitors.discovery',
    label: 'Competitor Discovery',
    description: 'Find competitor suggestions, generate keywords, and store discovered competitors.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'POST', path: '/fetch-keywords-basedOnWebsite' },
      { method: 'POST', path: '/check-competitor-process' },
      { method: 'POST', path: '/get-store-process-competitors' },
      { method: 'POST', path: '/compeitetor-name-client' },
      { method: 'POST', path: '/get-competitor-count' },
      { method: 'POST', path: '/get-competitor-count-new' },
      { method: 'POST', path: '/check-daily-token-limit' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Add Project > Find competitors', controlIds: ['projects_competitor_discovery'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to discover more competitors.' },
    limitTypes: ['competitorLimit'],
  },
  {
    id: 'projects.competitors.monitoring',
    label: 'Competitor Monitoring',
    description: 'Enable monitoring for competitors.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [{ method: 'POST', path: '/update-monitoring' }],
    frontend: { route: '/projects', location: 'All Projects > Monitoring', controlIds: ['projects_monitoring'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to monitor more competitors.' },
    limitTypes: ['competitorLimit'],
  },
  {
    id: 'projects.analytics',
    label: 'Competitor Analytics',
    description: 'View ad count, engagement, budget, frequency, top ads, and longest-running ads.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'POST', path: '/get-ad-count' },
      { method: 'POST', path: '/get-lcs' },
      { method: 'POST', path: '/get-avgbud-data' },
      { method: 'POST', path: '/get-frequent-data' },
      { method: 'POST', path: '/get-engagement' },
      { method: 'POST', path: '/get-top-likes' },
      { method: 'POST', path: '/get-top-comments' },
      { method: 'POST', path: '/get-top-impression' },
      { method: 'POST', path: '/get-top-popularity' },
      { method: 'POST', path: '/get-longest' },
      { method: 'POST', path: '/get-category' },
      { method: 'POST', path: '/get-ad-type' },
      { method: 'GET', path: '/get-countries' },
      { method: 'POST', path: '/get-backlinks' },
      { method: 'POST', path: '/get-organic-searches' },
      { method: 'POST', path: '/get-paid-searches' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Analytics', controlIds: ['projects_analytics'] },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to access competitor analytics.' },
  },
  {
    id: 'projects.manage',
    label: 'Manage Projects',
    description: 'Rename or delete projects and manually add or remove competitors.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'PATCH', path: '/update-advertiser' },
      { method: 'POST', path: '/delete-project' },
      { method: 'POST', path: '/add-manual-competitor' },
      { method: 'POST', path: '/delete-competitor' },
      { method: 'POST', path: '/create-backlink' },
      { method: 'POST', path: '/organic-search' },
      { method: 'POST', path: '/paid-search' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Project actions', controlIds: ['projects_manage'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to manage projects and competitors.' },
    limitTypes: ['competitorLimit'],
  },
  {
    id: 'projects.members',
    label: 'Project Members',
    description: 'List, add, update, and remove people who receive project notifications.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'POST', path: '/members/list' },
      { method: 'POST', path: '/members/add' },
      { method: 'POST', path: '/members/update' },
      { method: 'POST', path: '/members/delete' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Team members', controlIds: ['projects_members'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to manage project members.' },
    limitTypes: ['memberLimit'],
  },
  {
    id: 'projects.brand_cc',
    label: 'Brand Notification Recipients',
    description: 'Assign project members to brand-specific email notification lists.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'POST', path: '/brand-cc/get' },
      { method: 'POST', path: '/brand-cc/set' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Team members > Brand CC', controlIds: ['projects_brand_cc'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to configure brand notification recipients.' },
  },
  {
    id: 'projects.alerts',
    label: 'Project Alerts',
    description: 'Create and manage threshold-based competitor alert rules.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'POST', path: '/alert-rules/list' },
      { method: 'POST', path: '/alert-rules/create' },
      { method: 'POST', path: '/alert-rules/update' },
      { method: 'POST', path: '/alert-rules/delete' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Alerts', controlIds: ['projects_alerts'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to create project alerts.' },
    limitTypes: ['alertRuleLimit'],
  },
  {
    id: 'projects.activity_feed',
    label: 'Project Activity Feed',
    description: 'View All Projects changes and mark activity items as read.',
    category: 'Projects',
    status: 'active',
    planControlled: true,
    networkAware: false,
    supportedNetworks: [],
    defaultPolicy: 'allow',
    owner: 'projects',
    parentCapability: 'projects.access',
    routes: [
      { method: 'POST', path: '/activity-feed/list' },
      { method: 'POST', path: '/activity-feed/mark-read' },
    ],
    frontend: { route: '/projects', location: 'All Projects > Activity feed', controlIds: ['projects_activity_feed'], previewMode: 'interactive_mock' },
    lockedExperience: { behavior: 'disable_control_and_show_upgrade', message: 'Upgrade to view project activity.' },
  },
];

// Existing plan-access documents that predate the capability catalog. Keeping
// them registered prevents a migration from silently dropping a live filter.
// New product work must still add an explicit rich definition above.
const LEGACY_COMPATIBILITY_IDS = [
  'text_in_image', 'brand_detection', 'object_in_image', 'celeb_in_image',
  'html_content', 'state', 'city', 'ad_sub_position', 'target_keyword',
  'likes_sort', 'comments_sort', 'shares_sort', 'impression_sort',
  'popularity_sort', 'views_sort', 'dislikes_sort', 'hits_sort', 'post_date',
  'last_seen', 'domain_registration', 'page_creation_date', 'ad_seen_between',
  'bookmark', 'adgpt_access', 'verified', 'image_size', 'engagement',
  'meta_ads_lib', 'source', 'search_by_image', 'native_network', 'newest_sort',
  'ad_running_days_sort', 'domain_reg_sort', 'views_range',
  'ai_metadata_filters', 'advanced_ad_analytics', 'ad_tracker', 'cta',
  'sidebar_budget', 'test', 'testingsidebar',
];

for (const legacyId of LEGACY_COMPATIBILITY_IDS) {
  CAPABILITY_DEFINITIONS.push({
    id: `legacy.${legacyId}`,
    label: legacyId.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    description: `Existing Ads Library control migrated from the ${legacyId} plan-access rule.`,
    category: legacyId.includes('sort') ? 'Sorts' : 'Ads Library',
    status: ['test', 'testingsidebar'].includes(legacyId) ? 'needs_review' : 'active',
    planControlled: true,
    networkAware: true,
    supportedNetworks: [],
    defaultPolicy: 'deny',
    owner: 'ads-search',
    introducedIn: 'legacy',
    routes: [{ method: 'POST', path: '/api/v1/common/ads/search', condition: `legacy rule ${legacyId}` }],
    frontend: {
      route: '/ads',
      location: `Ads Library > Filters > ${legacyId.split('_').join(' ')}`,
      controlIds: [legacyId],
      previewMode: 'structured',
    },
    lockedExperience: {
      behavior: 'disable_control_and_show_upgrade',
      message: `Upgrade your plan to use ${legacyId.split('_').join(' ')}.`,
    },
  });
}

// ─── Derived lookups ────────────────────────────────────────────────────────

/** Map: capability ID → definition */
const _capabilityMap = new Map();
for (const cap of CAPABILITY_DEFINITIONS) {
  _capabilityMap.set(cap.id, cap);
}

/** All registered capability IDs */
const ALL_CAPABILITY_IDS = CAPABILITY_DEFINITIONS.map((c) => c.id);

/**
 * Maps legacy filter IDs (from plan_access_config / BODY_KEY_TO_FILTER_ID) to
 * the new capability ID. Used during migration and shadow comparison.
 */
const LEGACY_FILTER_TO_CAPABILITY = {
  keyword_search: 'ads.search.keyword',
  advertiser_search: 'ads.search.advertiser',
  domain_search: 'ads.search.domain',
  country: 'filter.country',
  gender: 'filter.gender',
  age: 'filter.age',
  ad_type: 'filter.ad_type',
  ad_position: 'filter.ad_position',
  call_to_action: 'filter.call_to_action',
  category: 'filter.category',
  ad_category: 'filter.category',
  language: 'filter.language',
  ad_budget_sort: 'sort.ad_budget',
  affiliate_network: 'filter.affiliate_network',
  ecommerce_platform: 'filter.ecommerce_platform',
  ecommerce: 'filter.ecommerce_platform',
  marketing_platform: 'filter.marketing_platform',
  traffic_source: 'filter.traffic_source',
  funnel: 'filter.funnel',
  google_transparency: 'google.transparency.search',
  market_trends: 'intelligence.market_trends',
  keyword_explorer: 'intelligence.keyword_explorer',
  ad_analytics: 'intelligence.competitive',
  project_access: 'projects.access',
};
for (const legacyId of LEGACY_COMPATIBILITY_IDS) {
  LEGACY_FILTER_TO_CAPABILITY[legacyId] = `legacy.${legacyId}`;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get a capability definition by ID.
 * @param {string} capabilityId
 * @returns {CapabilityDefinition|null}
 */
function getCapability(capabilityId) {
  return _capabilityMap.get(capabilityId) || null;
}

/**
 * Check if a capability ID is registered.
 * @param {string} capabilityId
 * @returns {boolean}
 */
function isRegisteredCapability(capabilityId) {
  return _capabilityMap.has(capabilityId);
}

/**
 * Get all capabilities filtered by status.
 * @param {CapabilityStatus} [status]
 * @returns {CapabilityDefinition[]}
 */
function getCapabilities(status) {
  if (!status) return [...CAPABILITY_DEFINITIONS];
  return CAPABILITY_DEFINITIONS.filter((c) => c.status === status);
}

/**
 * Get all capabilities in a category.
 * @param {string} category
 * @returns {CapabilityDefinition[]}
 */
function getCapabilitiesByCategory(category) {
  return CAPABILITY_DEFINITIONS.filter((c) => c.category === category);
}

/**
 * Get all plan-controlled capabilities.
 * @returns {CapabilityDefinition[]}
 */
function getPlanControlledCapabilities() {
  return CAPABILITY_DEFINITIONS.filter((c) => c.planControlled);
}

/**
 * Resolve a legacy filter ID to the new capability ID.
 * @param {string} filterId - Legacy filter ID (e.g. 'keyword_search')
 * @returns {string|null} New capability ID or null
 */
function resolveFromLegacyFilter(filterId) {
  return LEGACY_FILTER_TO_CAPABILITY[filterId] || null;
}

/**
 * Get the parent capability for a child (returns null if no parent).
 * @param {string} capabilityId
 * @returns {CapabilityDefinition|null}
 */
function getParentCapability(capabilityId) {
  const cap = getCapability(capabilityId);
  if (!cap || !cap.parentCapability) return null;
  return getCapability(cap.parentCapability);
}

/**
 * Get all child capabilities for a parent.
 * @param {string} parentCapabilityId
 * @returns {CapabilityDefinition[]}
 */
function getChildCapabilities(parentCapabilityId) {
  return CAPABILITY_DEFINITIONS.filter((c) => c.parentCapability === parentCapabilityId);
}

/**
 * Get all unique categories.
 * @returns {string[]}
 */
function getAllCategories() {
  return [...new Set(CAPABILITY_DEFINITIONS.map((c) => c.category))];
}

module.exports = {
  CAPABILITY_DEFINITIONS,
  ALL_CAPABILITY_IDS,
  LEGACY_FILTER_TO_CAPABILITY,
  LEGACY_COMPATIBILITY_IDS,
  getCapability,
  isRegisteredCapability,
  getCapabilities,
  getCapabilitiesByCategory,
  getPlanControlledCapabilities,
  resolveFromLegacyFilter,
  getParentCapability,
  getChildCapabilities,
  getAllCategories,
};
