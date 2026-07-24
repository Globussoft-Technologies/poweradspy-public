'use strict';

const config          = require('../../../config');
const serviceRegistry = require('../../ServiceRegistry');
const { searchAds: fbSearchAds } = require('../../facebook/controllers/adSearchController');
const { searchAds: igSearchAds } = require('../../instagram/controllers/adSearchController');
const { searchAds: ytSearchAds }  = require('../../youtube/controllers/adSearchController');
const { searchAds: gdnSearchAds } = require('../../gdn/controllers/adSearchController');
const { searchAds: liSearchAds }  = require('../../linkedin/controllers/adSearchController');
const { searchAds: natSearchAds } = require('../../native/controllers/adSearchController');
const { searchAds: redSearchAds } = require('../../reddit/controllers/adSearchController');
const { searchAds: qrSearchAds }  = require('../../quora/controllers/adSearchController');
const { searchAds: pinSearchAds } = require('../../pinterest/controllers/adSearchController');
const { searchAds: googSearchAds } = require('../../google/controllers/adSearchController');
const { searchAds: ttSearchAds }   = require('../../tiktok/controllers/adSearchController');
const { getClientIp, getLocation, detectCountry } = require('../../../utils/geoip');
const { mergeNetworkResults }        = require('../../../utils/resultMerger');
const { getApplicableNetworks }      = require('../helpers/filterApplicability');
const { getAdsByAdvertiser: fbAdsByAdvertiser } = require('../../facebook/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: igAdsByAdvertiser } = require('../../instagram/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: ytAdsByAdvertiser } = require('../../youtube/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: pinAdsByAdvertiser } = require('../../pinterest/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: googAdsByAdvertiser } = require('../../google/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: ttAdsByAdvertiser } = require('../../tiktok/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: liAdsByAdvertiser } = require('../../linkedin/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: redAdsByAdvertiser } = require('../../reddit/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: qrAdsByAdvertiser } = require('../../quora/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: natAdsByAdvertiser } = require('../../native/controllers/getAdsByAdvertiserController');
const { getAdsByAdvertiser: gdnAdsByAdvertiser } = require('../../gdn/controllers/getAdsByAdvertiserController');

// Network → searchAds handler map (used by searchAdvertiserNames).
const NETWORK_SEARCH = {
  facebook:  fbSearchAds,
  instagram: igSearchAds,
  youtube:   ytSearchAds,
  gdn:       gdnSearchAds,
  linkedin:  liSearchAds,
  native:    natSearchAds,
  reddit:    redSearchAds,
  quora:     qrSearchAds,
  pinterest: pinSearchAds,
  google:    googSearchAds,
  tiktok:    ttSearchAds,
};

// ─── Timeout wrapper ──────────────────────────────────────────────────────────

function withTimeout(promise, ms, name) {
  let handle;
  const timer = new Promise(resolve => {
    handle = setTimeout(
      () => resolve({ code: 504, message: 'Timeout', data: [], total: 0, network: name }),
      ms
    );
  });
  return Promise.race([
    promise
      .then(r  => { clearTimeout(handle); return { ...r,  network: name }; })
      .catch(e => { clearTimeout(handle); return { code: 500, message: e.message, data: [], total: 0, network: name }; }),
    timer,
  ]);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function searchAllNetworks(req, res) {
  const tStart = Date.now();

  // ── 1. IP-country detection ─────────────────────────────────────────────
  //
  // Goal: if user didn't send an explicit country filter, inject `ipBasedCountry`
  // so the ES builders boost country-specific ads. The detection is best-effort
  // and must NOT add latency to the request.
  //
  // Resolution order (cheapest → expensive):
  //   1. User sent country  → skip detection entirely
  //   2. CDN/proxy header   → free (Cloudflare's `cf-ipcountry` etc.)
  //   3. Cached HTTP lookup → cached in memory by IP for 1h
  //
  // Previously we hit ip-api.com on every request (uncached, ~100–500ms). With
  // the cache + header fallback, this branch is typically ~0ms now.
  const clientIp = getClientIp(req);
  const userSentCountry = !!(req.body?.country || req.query?.country) &&
    (req.body?.country || req.query?.country) !== 'NA';

  let ipcountry = null;
  let geoPromise = null;
  // if (!userSentCountry) {
  //   ipcountry = detectCountry(req); // full country name from CDN header
  //   if (!ipcountry) {
  //     // Need an upstream lookup — kick it off now and await alongside SDUI
  //     // applicability later, so they overlap instead of running serially.
  //     geoPromise = getLocation(clientIp);
  //   }
  // }

  // ── 2. Which networks the user wants data from ──────────────────────────
  let reqNetworks = req.body?.network || req.query?.network || 'all';
  if (typeof reqNetworks === 'string' && reqNetworks !== 'all') {
    reqNetworks = reqNetworks.split(',').map(n => n.trim().toLowerCase());
  } else if (Array.isArray(reqNetworks)) {
    reqNetworks = reqNetworks.map(n => n.toLowerCase());
  }

  // ── 2b. Meta Ads Library filter: restrict to Facebook and Instagram only ──
  // When platform=15 (Meta Ads Library) is active, override reqNetworks to only
  // query Facebook and Instagram, regardless of which networks the user selected.
  // This ensures Meta Ads Library ads only come from Meta's native platforms.
  const isGoogleTransparency =
    req.body?.google_transparency_ads === true ||
    req.body?.google_transparency_ads === 1 ||
    req.body?.google_transparency_ads === 'true' ||
    req.body?.platform === 18 ||
    req.body?.platform === '18';
  if (isGoogleTransparency) {
    reqNetworks = ['google'];
  }

  const isMetaAdsLibrary = req.body?.platform === 15 || req.body?.platform === '15';
  if (!isGoogleTransparency && isMetaAdsLibrary && reqNetworks !== 'all') {
    // Intersect user's selected networks with Meta platforms only
    reqNetworks = reqNetworks.filter(n => ['facebook', 'instagram'].includes(n));
    if (reqNetworks.length === 0) {
      // User selected Meta Ads Library but no Meta platforms — default to both
      reqNetworks = ['facebook', 'instagram'];
    }
  } else if (!isGoogleTransparency && isMetaAdsLibrary && reqNetworks === 'all') {
    // 'all' mode with Meta Ads Library → only query Meta platforms
    reqNetworks = ['facebook', 'instagram'];
  }

  const fbService = serviceRegistry.getService('facebook');
  const igService = serviceRegistry.getService('instagram');
  const ytService = serviceRegistry.getService('youtube');
  const gdnService = serviceRegistry.getService('gdn');
  const liService = serviceRegistry.getService('linkedin');
  const natService = serviceRegistry.getService('native');
  const redService = serviceRegistry.getService('reddit');
  const qrService  = serviceRegistry.getService('quora');
  const pinService  = serviceRegistry.getService('pinterest');
  const googService = serviceRegistry.getService('google');
  const ttService   = serviceRegistry.getService('tiktok');

  // ── 3. Fire networks in parallel — only plan-allowed + filter-applicable ─────
  // Four layers of restriction (intersected):
  //   a) `allowedPlatforms` — from planAccessMiddleware (subscription tier)
  //   b) `sduiApplicable`   — from SDUI config; networks where the user's
  //      active filters actually apply (e.g. `gender` only applies to facebook)
  //   c) Network exists in service registry
  //   d) `reqNetworks`       — when the user picks specific tabs (not 'all'),
  //      we MUST NOT fan out to the rest. Querying every network meant the
  //      response time was bound by the slowest network even when the user
  //      only wanted Facebook (~3-10s in prod). With this filter, single-tab
  //      searches now complete in the time of that one network alone.
  const allowedPlatforms = req.planAccess?.allowedPlatforms || null;
  // Run the SDUI applicability check in parallel with the GeoIP lookup (if any).
  // Both are independent of each other — chaining them serially used to add
  // their latencies; awaiting them together hides the slower one.
  const [sduiApplicable, geoCountry] = await Promise.all([
    getApplicableNetworks(req.body || {}),
    geoPromise || Promise.resolve(null),
  ]);
  if (!ipcountry && geoCountry) ipcountry = geoCountry;

  // Default request — carries ipBasedCountry so country boosting works for
  // every network (this is important product behaviour for relevance).
  const searchReq = ipcountry
    ? { ...req, body: { ...(req.body || {}), ipBasedCountry: ipcountry } }
    : req;

  // Google-only override: skip the ipBasedCountry injection for Google.
  // Reason: Google's index size + the `_score: desc` priority sort the boost
  // triggers force ES to score every matching doc on huge indexes, making
  // Google ~2–3s slower than its direct route via common. Other networks
  // don't show this regression, so they keep the boost for relevance.
  // Google falls back to the original (un-augmented) req — same as the
  // /api/v1/google/ads/search route.
  const googleSearchReq = req;

  // Hard restriction: ad budget data only exists on Facebook, Instagram, YouTube.
  // Apply directly here so it works regardless of SDUI config or cache state.
  const _body = req.body || {};
  const _isActiveBudgetVal = (v) => {
    if (!v || v === 'NA') return false;
    if (Array.isArray(v)) return v.length > 0 && !v.every(x => x === 'NA' || x === '' || x == null);
    return true;
  };
  const _budgetFilterActive = (() => {
    const knownKeys = ['adBudget', 'avg_ad_budget', 'ad_budget', 'budget', 'avgBudget', 'ad_budget_filter'];
    if (knownKeys.some(k => _isActiveBudgetVal(_body[k]))) return true;
    return Object.entries(_body).some(([k, v]) => k.toLowerCase().includes('budget') && _isActiveBudgetVal(v));
  })();
  const _AD_BUDGET_NETWORKS = new Set(['facebook', 'instagram', 'youtube', 'tiktok']);

  // Popularity is only indexed on these networks (the rest have no popularity
  // score and their parseSort has no popularity entry). When the user sorts by
  // Popularity, skip the others entirely: in "All" mode this avoids 7 useless
  // network round-trips (whose ads were filtered out of the results anyway) and
  // keeps "Total Ads" aligned with what's actually shown.
  const _POPULARITY_NETWORKS = new Set(['facebook', 'instagram', 'linkedin', 'tiktok']);
  const _popularitySortActive =
    _body.popularity_sort === 'popularity_sort' || _body.sortBy === 'Popularity';

  const isUserRequested  = (net) => reqNetworks === 'all' || reqNetworks.includes(net);
  const isAllowed = (net) =>
    (!allowedPlatforms || allowedPlatforms.includes(net)) &&
    (!sduiApplicable   || sduiApplicable.includes(net))   &&
    (!_budgetFilterActive || _AD_BUDGET_NETWORKS.has(net)) &&
    (!_popularitySortActive || _POPULARITY_NETWORKS.has(net)) &&
    isUserRequested(net);

  const ms = config.apiTimeouts.networkSearchTimeoutMs;
  const allTasks = [];

  if (fbService  && isAllowed('facebook'))
    allTasks.push(withTimeout(fbSearchAds(searchReq, fbService.db, fbService.log), ms, 'facebook'));
  if (igService  && isAllowed('instagram'))
    allTasks.push(withTimeout(igSearchAds(searchReq, igService.db, igService.log), ms, 'instagram'));
  if (ytService  && isAllowed('youtube'))
    allTasks.push(withTimeout(ytSearchAds(searchReq,  ytService.db,  ytService.log),  ms, 'youtube'));
  if (gdnService && isAllowed('gdn'))
    allTasks.push(withTimeout(gdnSearchAds(searchReq, gdnService.db, gdnService.log), ms, 'gdn'));

  if (liService && isAllowed('linkedin'))
    allTasks.push(withTimeout(liSearchAds(searchReq, liService.db, liService.log), ms, 'linkedin'));
  if (natService && isAllowed('native'))
    allTasks.push(withTimeout(natSearchAds(searchReq, natService.db, natService.log), ms, 'native'));
  if (redService && isAllowed('reddit'))
    allTasks.push(withTimeout(redSearchAds(searchReq, redService.db, redService.log), ms, 'reddit'));
  if (qrService && isAllowed('quora'))
    allTasks.push(withTimeout(qrSearchAds(searchReq, qrService.db, qrService.log), ms, 'quora'));
  if (pinService && isAllowed('pinterest'))
    allTasks.push(withTimeout(pinSearchAds(searchReq, pinService.db, pinService.log), ms, 'pinterest'));
  if (googService && isAllowed('google'))
    allTasks.push(withTimeout(googSearchAds(googleSearchReq, googService.db, googService.log), ms, 'google'));
  if (ttService && isAllowed('tiktok'))
    allTasks.push(withTimeout(ttSearchAds(searchReq, ttService.db, ttService.log), ms, 'tiktok'));

  const settled = await Promise.allSettled(allTasks);

  // ── 4. Collect results — separate requested vs all ───────────────────────
  const requestedArrays   = [];   // data arrays for user's chosen networks only
  // Pre-seed totals with 0 for every known network so the response shape is
  // stable for the frontend even when a network was skipped due to plan or
  // SDUI filter applicability (e.g. `gender` filter → only facebook queried).
  const totals            = {
    facebook: 0, instagram: 0, youtube: 0, gdn: 0, linkedin: 0,
    native: 0, reddit: 0, quora: 0, pinterest: 0, google: 0, tiktok: 0,
  };
  const networksWithData  = [];   // networks that returned data (for suggestion)
  const networkErrors     = {};

  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const r = s.value;

    const hasData = r.code === 200 && Array.isArray(r.data) && r.data.length > 0;

    // Total count — always record for every network
    totals[r.network] = (r.code === 200) ? (r.total ?? r.data?.length ?? 0) : 0;

    if (r.code !== 200) {
      networkErrors[r.network] = r.message || `${r.network} error (${r.code})`;
    }

    if (!hasData) continue;

    // Track which networks have data (for suggestion logic)
    networksWithData.push(r.network);

    // Only include in data payload if this network was requested
    const isRequested = reqNetworks === 'all' || reqNetworks.includes(r.network);
    if (isRequested) {
      // Mutate in place — each ad came from a per-network controller and isn't
      // shared anywhere else. Spreading every ad just to add a single field
      // allocated 220+ new objects per request and ~doubled GC pressure.
      const arr = r.data;
      // Preserve a network already set by the controller (e.g. YouTube DISPLAY
      // ads surfaced under GDN keep network:'youtube' so ad-detail routes to
      // YouTube). Only stamp the dispatching network when none is present.
      for (let i = 0; i < arr.length; i++) arr[i].network = arr[i].network || r.network;
      requestedArrays.push(arr);
    }
  }

  // ── 5. Interleave + Deduplicate requested networks only ──────────────────
  const merged = mergeNetworkResults(requestedArrays);

  // ── 5b. Re-sort merged results when multiple networks are combined ─────────
  // Round-robin interleave preserves per-network ES order but destroys the
  // global sort (e.g. a Facebook ad from 2022 appears before an Instagram ad
  // from 2025). Re-sort here to honour the user's chosen sort order.
  //
  // IMPORTANT — only re-sort when MULTIPLE networks contributed data. A single
  // network's results are already sorted by ES; running a second sort here
  // wasted CPU on every single-network search.
  let data = merged;
  if (merged.length > 1 && requestedArrays.length > 1) {
    const b = req.body || {};

    // Determine sort field from the request flags the frontend sends.
    // Default (and "newest") sorts by last_seen — mirrors what every individual
    // network's parseSort() does when newest_sort is active.
    let sortField = 'last_seen';
    if      (b.running_longest_sort === 'running_longest_sort') sortField = 'days_running';
    else if (b.last_seen_sort       === 'LastSeen_sort')        sortField = 'last_seen';
    else if (b.likes_sort           === 'likes_sort')           sortField = 'likes';
    else if (b.comments_sort        === 'comments_sort')        sortField = 'comment';
    else if (b.shares_sort          === 'shares_sort')          sortField = 'share';
    else if (b.impression_sort      === 'impression_sort')      sortField = 'impression';
    else if (b.popularity_sort      === 'popularity_sort')      sortField = 'popularity';
    else if (b.adBudget_sort        === 'adBudget_sort')        sortField = 'ad_budget';
    else if (b.newest_sort          === 'newest_sort')          sortField = 'last_seen';
    else if (b.sortBy === 'Impression')   sortField = 'impression';
    else if (b.sortBy === 'Popularity')   sortField = 'popularity';
    else if (b.sortBy === 'LastSeen')     sortField = 'last_seen';
    else if (b.sortBy === 'Newest')       sortField = 'last_seen';
    else if (b.sortBy === 'days_running') sortField = 'days_running';

    const isDateField = sortField === 'post_date' || sortField === 'last_seen' || sortField === 'first_seen';
    const isPopularity = sortField === 'popularity';

    // Schwartzian transform — compute the numeric sort key once per ad
    // instead of recomputing it inside the comparator (2N×log N times).
    // For 220 items the comparator is invoked ~3.3k times; pulling toNum
    // out turns ~6.6k calls into 220.
    // When sorting by popularity, keep only ads that actually have a popularity
    // score. The per-network ES queries already enforce this for networks that
    // support popularity (an `exists` filter), but in multi-network "All" mode
    // networks with no popularity concept (YouTube, GDN, Google, …) still
    // contribute ads that would otherwise tail the list with n=0. Drop them so
    // the result is purely scored ads, highest first.
    const sortable = isPopularity
      ? merged.filter((ad) => {
          let v = ad.popularity;
          if (v != null && typeof v === 'object') v = v.current ?? v.max;
          return v != null && v !== '' && !isNaN(Number(v));
        })
      : merged;

    const decorated = new Array(sortable.length);
    for (let i = 0; i < sortable.length; i++) {
      const ad = sortable[i];
      let v = ad[sortField];
      let n = 0;
      if (v != null && v !== '') {
        if (isPopularity && typeof v === 'object') v = v.current ?? v.max ?? 0;
        if (v instanceof Date) n = v.getTime();
        else if (typeof v === 'number') n = v < 1e10 ? v * 1000 : v;
        else if (isDateField) {
          const ms = Date.parse(String(v));
          n = isNaN(ms) ? 0 : ms;
        } else {
          const num = Number(v);
          n = isNaN(num) ? 0 : num;
        }
      }
      decorated[i] = [n, ad];
    }
    decorated.sort((a, b) => b[0] - a[0]);
    data = new Array(decorated.length);
    for (let i = 0; i < decorated.length; i++) data[i] = decorated[i][1];
  }

  // NOTE: `totals` keeps the true per-network ES `hits.total` recorded in step 4
  // (every search body sets `track_total_hits: true` via paginationDefaults, so
  // these are exact, uncapped counts for the applied filters — NOT capped at the
  // default 10k). We intentionally do NOT recount from the current page's `data`
  // here: doing so made "Total Ads" equal to the number of ads fetched so far,
  // which grew on every infinite-scroll page. The frontend wants the full ES
  // match count up front, independent of pagination, so we surface the ES total.
  //
  // Caveat (accepted): the ES total can run slightly ahead of the rendered count
  // because of `collapse` on FB/Google/TikTok (hits.total counts pre-collapse
  // docs), SQL-hydration orphans dropped by cleanAdsData, and cross-network
  // dedup. This is the authoritative "ads in Elasticsearch matching this search"
  // number and matches the legacy behaviour.

  // ── 5c. Lazy discovery for `suggestedNetworks` ──────────────────────────
  // When the user picked specific networks (not 'all') AND those came back
  // empty, fire a *discovery* query against the OTHER allowed networks so we
  // can tell the user where their keyword does exist. We do this lazily —
  // only on empty results — so the common case (results found) stays fast.
  // Each discovery call uses take=1 so it's basically a count check.
  const userPickedSpecific = reqNetworks !== 'all';
  // A platform-18 request is intentionally Google-only. Do not run the normal
  // cross-network empty-result discovery, because those controllers do not
  // understand the Transparency discriminator and would query unrelated ads.
  if (userPickedSpecific && data.length === 0 && !isGoogleTransparency) {
    const NETWORK_FNS = {
      facebook: [fbService, fbSearchAds, searchReq],
      instagram: [igService, igSearchAds, searchReq],
      youtube: [ytService, ytSearchAds, searchReq],
      gdn: [gdnService, gdnSearchAds, searchReq],
      linkedin: [liService, liSearchAds, searchReq],
      native: [natService, natSearchAds, searchReq],
      reddit: [redService, redSearchAds, searchReq],
      quora: [qrService, qrSearchAds, searchReq],
      pinterest: [pinService, pinSearchAds, searchReq],
      google: [googService, googSearchAds, googleSearchReq],
      tiktok: [ttService, ttSearchAds, searchReq],
    };
    const alreadyQueried = new Set(Object.keys(NETWORK_FNS).filter(
      n => isAllowed(n) && NETWORK_FNS[n][0]
    ));
    // Minimal-payload request — only the count matters here
    const discoveryBody = { ...(req.body || {}), take: 1, page_size: 1, skip: 0 };
    const discoveryReq = { ...searchReq, body: { ...searchReq.body, ...discoveryBody } };
    const discoveryGoogReq = { ...googleSearchReq, body: { ...googleSearchReq.body, ...discoveryBody } };
    const discoveryMs = Math.min(ms, 3000); // tighter cap so a slow net can't drag the suggestion
    const discoveryTasks = [];
    for (const [net, [svc, fn, baseReq]] of Object.entries(NETWORK_FNS)) {
      if (!svc || alreadyQueried.has(net)) continue;
      if (allowedPlatforms && !allowedPlatforms.includes(net)) continue;
      if (sduiApplicable && !sduiApplicable.includes(net)) continue;
      const reqForNet = net === 'google' ? discoveryGoogReq : discoveryReq;
      discoveryTasks.push(withTimeout(fn(reqForNet, svc.db, svc.log), discoveryMs, net));
    }
    if (discoveryTasks.length > 0) {
      const discoverySettled = await Promise.allSettled(discoveryTasks);
      for (const s of discoverySettled) {
        if (s.status !== 'fulfilled') continue;
        const r = s.value;
        if (r.code !== 200) continue;
        const count = r.total ?? r.data?.length ?? 0;
        if (count > 0) {
          totals[r.network] = count;
          if (!networksWithData.includes(r.network)) networksWithData.push(r.network);
        }
      }
    }
  }

  // ── 6. Build response message + suggestions ──────────────────────────────
  let message = 'Ads fetched successfully';
  let suggestedNetworks = [];

  if (data.length === 0) {
    // Find networks that have data — suggest all of them regardless of what was requested
    suggestedNetworks = networksWithData;

    if (suggestedNetworks.length > 0) {
      message = `No data found for selected network(s). Try: ${suggestedNetworks.join(', ')}`;
    } else {
      message = 'No ads found';
    }
  }

  // ── 7. Build planAccess metadata for frontend ─────────────────────────────
  const planAccessMeta = req.planAccess ? {
    planId: req.planAccess.planId,
    planTier: req.planAccess.planTier,
    allowedPlatforms: req.planAccess.allowedPlatforms,
    filters: req.planAccess.filters,
    competitorLimits: req.planAccess.competitorLimits,
    strippedFilters: req.planAccess.strippedFilters,
  } : undefined;

  const totalMs = Date.now() - tStart;
  // Per-network timing — surfaces which network was the long pole when "all"
  // mode is slow. Pulled from each controller's _timing block.
  const perNetwork = {};
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const r = s.value;
    if (r._timing) perNetwork[r.network] = r._timing;
  }
  // More-pages signal for the frontend. Base it on whether ES still has results
  // to fetch ((page+1)*take < total per network), NOT on how many ads survived
  // hydration on this page. A short page (SQL-hydration/dedup dropped a row)
  // must not stop pagination while thousands of ES matches remain — that was
  // the bug where the grid showed ~7/858 and said "No more ads".
  const _pageNum = parseInt(req.body?.skip ?? req.query?.skip ?? 0, 10) || 0;
  const _take = parseInt(req.body?.take ?? req.query?.take ?? 9, 10) || 9;
  const _netsToCheck = reqNetworks === 'all' ? Object.keys(totals) : reqNetworks;
  const hasMore = _netsToCheck.some(net => ((_pageNum + 1) * _take) < (totals[net] || 0));

  return res.status(200).json({
    code: 200,
    data,
    message,
    meta: {
      total: totals,             // always all networks
      hasMore,                   // ES-total-based; true if any requested network has more pages
      networksWithData,          // networks that actually returned results
      suggestedNetworks,         // non-empty if user's selection had 0 data
      ipcountry,
      ipCountryActive: !!ipcountry,
      clientIp,
      ...(planAccessMeta && { planAccess: planAccessMeta }),
    },
    _timing: { total_ms: totalMs, networks: perNetwork },
    ...(Object.keys(networkErrors).length > 0 && { errors: networkErrors }),
  });
}

async function getAdsByAdvertiserAll(req, res) {
  const network = (req.body.network || req.query.network || 'facebook').toLowerCase().trim();
  const service = serviceRegistry.getService(network);

  if (!service) {
    return res.status(400).json({ code: 400, message: `Unsupported network: ${network}` });
  }

  // Network → specific handler map
  const handlers = {
    facebook:  fbAdsByAdvertiser,
    instagram: igAdsByAdvertiser,
    youtube:   ytAdsByAdvertiser,
    pinterest: pinAdsByAdvertiser,
    google:    googAdsByAdvertiser,
    tiktok:    ttAdsByAdvertiser,
    linkedin:  liAdsByAdvertiser,
    reddit:    redAdsByAdvertiser,
    quora:     qrAdsByAdvertiser,
    native:    natAdsByAdvertiser,
    gdn:       gdnAdsByAdvertiser,
  };

  const handler = handlers[network];
  if (!handler) {
    return res.status(501).json({
      code: 501,
      message: `getAdsByAdvertiser is not yet implemented for the ${network} network.`
    });
  }

  try {
    const result = await handler(req, service.db, service.log);
    return res.status(result.code === 200 ? 200 : result.code).json(result);
  } catch (err) {
    service.log.error('Common Advertiser Search Error', { error: err.message, network });
    return res.status(500).json({ code: 500, message: 'Internal Server Error during advertiser search' });
  }
}

// ─── Advertiser Names (slim, partner-facing search) ─────────────────────────
//
// POST /api/v1/common/advertiser/names
// Same fan-out engine as searchAllNetworks (each network's own searchAds
// pipeline), but with a small, stable payload/response contract:
//
//   Payload:
//     keyword         string   — match ad copy/creative text        (optional)
//     industry        string   — advertiser industry filter         (optional)
//     category        string   — ad category filter                 (optional)
//     geography       string   — country/region where the ad runs   (optional)
//     platform        csv enum — meta,google,tiktok,youtube,gdn,…   (optional, default all)
//     min_days_active int      — only ads last seen within the last N days.
//                                Computed SERVER-SIDE: last_seen range =
//                                [today - N days, today].            (optional)
//     page            int      — 1-based page number                (default 1)
//     page_size       int      — results per page                   (default 100, max 100)
//
//   Response:
//     { page, page_size, total_results, results: [ {
//         company_name, domain, platform, ad_creative_snippet,
//         ad_first_seen, ad_last_seen, days_active, ad_url,
//         industry, geography, category } ] }

// Public platform enum → internal network list. `meta` = Facebook + Instagram.
const ADVERTISER_PLATFORM_MAP = {
  meta:      ['facebook', 'instagram'],
  facebook:  ['facebook'],
  instagram: ['instagram'],
  google:    ['google'],
  gdn:       ['gdn'],
  youtube:   ['youtube'],
  tiktok:    ['tiktok'],
  linkedin:  ['linkedin'],
  pinterest: ['pinterest'],
  reddit:    ['reddit'],
  quora:     ['quora'],
  native:    ['native'],
};

// Internal network → public platform label (facebook/instagram collapse to meta).
function toPlatformLabel(network) {
  return (network === 'facebook' || network === 'instagram') ? 'meta' : network;
}

function advFirstVal(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    return v;
  }
  return null;
}

// Domain is not a hydrated column on every network — fall back to parsing the
// hostname out of whichever ad URL the network did return.
function advExtractDomain(ad) {
  const direct = advFirstVal(ad.domain, ad.domain_name);
  if (direct) return String(direct).replace(/^www\./, '');
  const url = advFirstVal(
    ad.ad_url, ad.destination_url, ad.initial_url, ad.final_url, ad.redirect_url,
    ad.link_url, ad.lander_url,
    ad.market_platform_urls?.destination_url, ad.market_platform_urls?.final_url
  );
  if (!url) return null;
  try { return new URL(String(url)).hostname.replace(/^www\./, '') || null; }
  catch { return null; }
}

// Normalise first_seen/last_seen (Date, epoch seconds/ms, or "YYYY-MM-DD[ HH:mm:ss]")
// to "YYYY-MM-DD".
function advDateStr(v) {
  if (v === null || v === undefined || v === '') return null;
  let ms;
  if (v instanceof Date) ms = v.getTime();
  else if (typeof v === 'number') ms = v < 1e11 ? v * 1000 : v;
  else ms = Date.parse(String(v).replace(' ', 'T'));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function advDaysActive(ad, firstSeen, lastSeen) {
  const dr = Number(ad.days_running);
  if (Number.isFinite(dr) && dr > 0) return dr;
  if (firstSeen && lastSeen) {
    const diff = Math.floor((Date.parse(lastSeen) - Date.parse(firstSeen)) / 86400000);
    return Math.max(1, diff);
  }
  return null;
}

function advSnippet(ad) {
  const text = advFirstVal(ad.ad_text, ad.text, ad.ad_title, ad.title, ad.news_feed_description, ad.description);
  if (!text) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > 200 ? s.slice(0, 197) + '...' : s;
}

// ─── ES enrichment for category / country ───────────────────────────────────
// The per-network searchAds pipelines hydrate image/text/URL data from SQL but
// do NOT return category or country on the ad row. Those values are indexed in
// Elasticsearch, so we look them up by ad id and overlay them before mapping.

function advGetPath(obj, path) {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ES sources in this project are mostly flat dotted keys (e.g. 'facebook_ad.id'),
// but some may be nested objects. Try literal key first, then nested path.
function advGetField(obj, path) {
  if (obj == null) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  return advGetPath(obj, path);
}

const ES_ID_FIELDS = {
  facebook:  'facebook_ad.id',
  instagram: 'instagram_ad.id',
  youtube:   'youtube_ad.id',
  gdn:       'gdn_ad.id',
  linkedin:  'linkedin_ad.id',
  native:    'native_ad.id',
  reddit:    'reddit_ad.id',
  quora:     'quora_ad.id',
  pinterest: 'pinterest_ad.id',
  google:    'id',
  tiktok:    'sql_id',
};

function advPickCategory(src, network) {
  const keys = [
    `${network}_ad.ad_category`,
    `${network}_ad.category`,
    `${network}.category`,
    `${network}.subCategory`,
    `${network}.ad_category`,
    'ad_category',
    'category',
    'industry',
    'page_category',
    'sub_category',
    'subcategory',
  ];
  for (const k of keys) {
    const v = advGetField(src, k);
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) return v.filter(Boolean).join(', ');
    return String(v);
  }
  return null;
}

function advPickCountry(src, network) {
  const keys = [
    `${network}_user_countries`,
    `${network}_ad_url.country_code`,
    `${network}_country_only.country`,
    'country_only.country',
    `${network}.country`,
    'country',
    'countries',
    'country_code',
    'region',
  ];
  for (const k of keys) {
    const v = advGetField(src, k);
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) return v.filter(Boolean).join(', ');
    return String(v);
  }
  return null;
}

// SQL fallback for category when the ES doc doesn't store it.
const SQL_CATEGORY_MAP = {
  facebook:  { adTable: 'facebook_ad',      categoryTable: 'facebook_category',      adIdCol: 'facebook_ad.id',      catIdCol: 'facebook_ad.category_id',      catNameCol: 'facebook_category.category_name' },
  instagram: { adTable: 'instagram_ad',     categoryTable: 'instagram_category',     adIdCol: 'instagram_ad.id',     catIdCol: 'instagram_ad.category_id',     catNameCol: 'instagram_category.category_name' },
  youtube:   { adTable: 'youtube_ad',       categoryTable: 'youtube_category',       adIdCol: 'youtube_ad.id',       catIdCol: 'youtube_ad.category_id',       catNameCol: 'youtube_category.category_name' },
  gdn:       { adTable: 'gdn_ad',           categoryTable: 'gdn_category',           adIdCol: 'gdn_ad.id',           catIdCol: 'gdn_ad.category_id',           catNameCol: 'gdn_category.category_name' },
  native:    { adTable: 'native_ad',        categoryTable: 'native_category',        adIdCol: 'native_ad.id',        catIdCol: 'native_ad.category_id',        catNameCol: 'native_category.category_name' },
  linkedin:  { adTable: 'linkedin_ad',      categoryTable: 'linkedin_category',      adIdCol: 'linkedin_ad.id',      catIdCol: 'linkedin_ad.category_id',      catNameCol: 'linkedin_category.category_name' },
  reddit:    { adTable: 'reddit_ad',        categoryTable: 'reddit_category',        adIdCol: 'reddit_ad.id',        catIdCol: 'reddit_ad.category_id',        catNameCol: 'reddit_category.category_name' },
  quora:     { adTable: 'quora_ad',         categoryTable: 'quora_category',         adIdCol: 'quora_ad.id',         catIdCol: 'quora_ad.category_id',         catNameCol: 'quora_category.category_name' },
  pinterest: { adTable: 'pinterest_ad',     categoryTable: 'pinterest_category',     adIdCol: 'pinterest_ad.id',     catIdCol: 'pinterest_ad.category_id',     catNameCol: 'pinterest_category.category_name' },
  google:    { adTable: 'google_text_ad',   categoryTable: 'google_text_category',   adIdCol: 'google_text_ad.id',   catIdCol: 'google_text_ad.category_id',   catNameCol: 'google_text_category.category_name' },
  tiktok:    { adTable: 'tiktok_ad',        categoryTable: 'tiktok_category',        adIdCol: 'tiktok_ad.id',        catIdCol: 'tiktok_ad.category_id',        catNameCol: 'tiktok_category.category_name' },
};

async function advEnrichCategoryFromSql(adsByNetwork) {
  for (const [net, ads] of Object.entries(adsByNetwork)) {
    if (!ads || ads.length === 0) continue;
    const service = serviceRegistry.getService(net);
    if (!service?.db?.sql) continue;

    const ids = ads.map(a => a.ad_id).filter(Boolean);
    if (ids.length === 0) continue;

    // Generic category table fallback.
    const cfg = SQL_CATEGORY_MAP[net];
    if (cfg) {
      try {
        const placeholders = ids.map(() => '?').join(',');
        const sql = `SELECT ${cfg.adIdCol} AS ad_id, ${cfg.catNameCol} AS category_name FROM ${cfg.adTable} LEFT JOIN ${cfg.categoryTable} ON ${cfg.catIdCol} = ${cfg.categoryTable}.id WHERE ${cfg.adIdCol} IN (${placeholders})`;
        const rows = await service.db.sql.query(sql, ids);
        const map = new Map(rows.map(r => [String(r.ad_id), r.category_name]));
        for (const ad of ads) {
          if (!ad.category) {
            const cat = map.get(String(ad.ad_id));
            if (cat) ad.category = cat;
          }
        }
      } catch (err) {
        if (service.log) service.log.warn('Advertiser names SQL category fallback failed', { network: net, error: err.message });
      }
    }

    // Facebook-specific: page_category lives in facebook_lib_page_details.
    if (net === 'facebook') {
      const missing = ads.filter(ad => !ad.category).map(a => a.ad_id).filter(Boolean);
      if (missing.length > 0) {
        try {
          const placeholders = missing.map(() => '?').join(',');
          const sql = `SELECT DISTINCT facebook_ad_id AS ad_id, page_category AS category_name FROM facebook_lib_page_details WHERE facebook_ad_id IN (${placeholders}) AND page_category IS NOT NULL AND page_category != ''`;
          const rows = await service.db.sql.query(sql, missing);
          const map = new Map(rows.map(r => [String(r.ad_id), r.category_name]));
          for (const ad of ads) {
            if (!ad.category) {
              const cat = map.get(String(ad.ad_id));
              if (cat) ad.category = cat;
            }
          }
        } catch (err) {
          if (service.log) service.log.warn('Advertiser names SQL page_category fallback failed', { network: net, error: err.message });
        }
      }
    }
  }
}

async function advEnrichCategoryCountry(adsByNetwork) {
  for (const [net, ads] of Object.entries(adsByNetwork)) {
    if (!ads || ads.length === 0) continue;
    const service = serviceRegistry.getService(net);
    if (!service?.db?.elastic) continue;
    const indexName = service.db.elastic.indexName;
    const idField = ES_ID_FIELDS[net];
    if (!indexName || !idField) continue;
    const ids = ads.map(a => a.ad_id).filter(Boolean).map(String);
    if (ids.length === 0) continue;
    try {
      const result = await service.db.elastic.search({
        index: indexName,
        body: {
          query: { terms: { [idField]: ids } },
          size: ids.length,
          _source: true,
        },
      });
      if (service.log) {
        const hits = result.hits || result.body?.hits;
        service.log.info('Advertiser names ES enrichment', {
          network: net,
          requestedIds: ids.length,
          returnedHits: hits?.hits?.length ?? 0,
        });
      }
      const hits = result.hits || result.body?.hits;
      const map = new Map((hits?.hits || []).map(h => {
        const src = h._source || {};
        const key = String(advGetField(src, idField) ?? h._id);
        return [key, src];
      }));
      for (const ad of ads) {
        const src = map.get(String(ad.ad_id));
        if (!src) continue;
        if (!ad.category) ad.category = advPickCategory(src, net);
        if (!ad.country)  ad.country  = advPickCountry(src, net);
      }
    } catch (err) {
      // Enrichment is best-effort; never fail the whole request.
      if (service.log) service.log.warn('Advertiser names ES enrichment failed', { network: net, error: err.message });
    }
  }
}

// Map one hydrated ad (any network) to the slim output row.
function advMapAd(ad, network) {
  const firstSeen = advDateStr(ad.first_seen);
  const lastSeen  = advDateStr(ad.last_seen);
  const category  = advFirstVal(ad.category, ad.ad_category, ad.category_name);
  return {
    company_name:        advFirstVal(ad.post_owner, ad.advertiser_name, ad.advertiser, ad.page_name, ad.name),
    domain:              advExtractDomain(ad),
    platform:            toPlatformLabel(network),
    ad_creative_snippet: advSnippet(ad),
    ad_first_seen:       firstSeen,
    ad_last_seen:        lastSeen,
    days_active:         advDaysActive(ad, firstSeen, lastSeen),
    ad_url:              advFirstVal(ad.ad_url, ad.destination_url, ad.link_url, ad.initial_url, ad.redirect_url),
    industry:            advFirstVal(ad.industry, category),
    geography:           advFirstVal(ad.country, ad.country_code),
    category:            category !== null && category !== undefined ? String(category) : null,
  };
}

async function searchAdvertiserNames(req, res) {
  const body = req.body || {};

  // Pagination — this API is 1-based (page=1 → first page); the per-network
  // searchAds pipeline is 0-based (`skip`), so convert here.
  const page     = Math.max(1, parseInt(body.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(body.page_size, 10) || 100));

  // Platform enum → network list. No platform → every registered network.
  let networks;
  if (body.platform) {
    const tokens = String(body.platform).split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
    networks = [...new Set(tokens.flatMap(p => ADVERTISER_PLATFORM_MAP[p] || []))];
    if (networks.length === 0) {
      return res.status(400).json({
        code: 400,
        message: `Unknown platform: ${body.platform}. Supported: ${Object.keys(ADVERTISER_PLATFORM_MAP).join(', ')}`,
      });
    }
  } else {
    networks = Object.keys(NETWORK_SEARCH);
  }

  // Plan gate — intersect with the caller's allowed platforms.
  const allowedPlatforms = req.planAccess?.allowedPlatforms || null;
  if (allowedPlatforms) networks = networks.filter(n => allowedPlatforms.includes(n));
  if (networks.length === 0) {
    return res.status(403).json({ code: 403, message: 'No requested platform is available on your plan.' });
  }

  // min_days_active — CRITICAL, computed server-side: N=3 → last_seen range is
  // [today - 3 days, today]. Transported as the shared [endTs, startTs]
  // seen_btn_sort unix-second pair every network's searchAds already applies.
  const minDays = parseInt(body.min_days_active, 10);
  let seenBtnSort = null;
  if (Number.isFinite(minDays) && minDays > 0) {
    const nowSec = Math.floor(Date.now() / 1000);
    seenBtnSort = [nowSec, nowSec - minDays * 86400];
  }

  // industry + category both filter on the shared ad-category taxonomy.
  const adcategory = [...new Set(
    [body.industry, body.category]
      .flatMap(v => (Array.isArray(v) ? v : [v]))
      .map(v => (typeof v === 'string' ? v.trim() : v))
      .filter(v => v !== null && v !== undefined && v !== '')
  )];

  const userId = body.user_id || req.user?.id;
  if (!userId) {
    return res.status(401).json({ code: 401, message: 'Unauthorized: user_id missing' });
  }

  const ms = config.apiTimeouts?.networkSearchTimeoutMs || 15000;
  const tasks = [];
  for (const net of networks) {
    const service = serviceRegistry.getService(net);
    const searchFn = NETWORK_SEARCH[net];
    if (!service || !service.db || !searchFn) continue;
    // Translated per-network request — same shape searchAllNetworks forwards,
    // carrying ONLY the slim filters so no stray dashboard params leak in.
    const netReq = {
      ...req,
      query: {},
      body: {
        user_id: userId,
        ...(body.keyword   ? { keyword: String(body.keyword).trim() } : {}),
        ...(body.geography ? { country: [String(body.geography).trim()] } : {}),
        ...(adcategory.length ? { adcategory } : {}),
        ...(seenBtnSort ? { seen_btn_sort: seenBtnSort } : {}),
        newest_sort: 'desc',
        take: pageSize,
        skip: page - 1,
      },
    };
    tasks.push(withTimeout(searchFn(netReq, service.db, service.log), ms, net));
  }

  const settled = await Promise.allSettled(tasks);

  const adsByNetwork = {};
  const errors = {};
  let totalResults = 0;
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const r = s.value;
    if (r.code !== 200) {
      errors[r.network] = r.message || `${r.network} error (${r.code})`;
      continue;
    }
    totalResults += r.total ?? (Array.isArray(r.data) ? r.data.length : 0);
    if (Array.isArray(r.data) && r.data.length > 0) {
      adsByNetwork[r.network] = r.data;
      for (const ad of r.data) ad.network = ad.network || r.network;
    }
  }

  // Overlay category / country from ES (the search index holds the canonical values).
  await advEnrichCategoryCountry(adsByNetwork);
  // If ES didn't store category, fall back to the SQL category table.
  await advEnrichCategoryFromSql(adsByNetwork);

  const results = [];
  for (const [net, ads] of Object.entries(adsByNetwork)) {
    for (const ad of ads) results.push(advMapAd(ad, net));
  }

  return res.status(200).json({
    code: 200,
    page,
    page_size: pageSize,
    total_results: totalResults,
    results,
    message: results.length ? 'Advertisers fetched successfully' : 'No advertisers found',
    ...(Object.keys(errors).length > 0 && { errors }),
  });
}

module.exports = { searchAllNetworks, getAdsByAdvertiserAll, searchAdvertiserNames };
