'use strict';

const { detectCountry, getLocation, getClientIp } = require('../../../utils/geoip');

const MARKET_PLATFORM_MAP = {
  'demdex.net':     'Adobe Audience Manager',
  'branch':         'Branch',
  'conversionx.co': 'Conversionx',
  'doubleclick':    'Google Marketing Platform',
  'ow.ly':          'Hootsuite',
  'hubs.ly':        'Hubspot',
  'xg4ken.com':     'Kenshoo',
  'agkn.com':       'Neustar',
};

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function nowDate() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function filterNA(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      if (v.length > 0) out[k] = v;
    } else if (v !== 'NA' && v !== '' && v !== null && v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function resolveMarketPlatforms(raw) {
  if (!raw || raw === 'NA') return 'NA';
  const platforms = Array.isArray(raw) ? raw : [raw];
  const resolved = platforms.map(p => MARKET_PLATFORM_MAP[p] || null).filter(Boolean);
  return resolved.length > 0 ? resolved : raw;
}

function toTimestampPair(arr) {
  if (!arr || arr === 'NA' || !Array.isArray(arr) || arr.length < 2) return 'NA';
  return [
    new Date(arr[0] * 1000).toISOString().replace('T', ' ').slice(0, 19),
    new Date(arr[1] * 1000).toISOString().replace('T', ' ').slice(0, 19),
  ];
}

function parseCompetitors(val) {
  if (!val || val === 'NA' || val === '') return 'NA';
  let arr;
  try { arr = typeof val === 'string' ? JSON.parse(val) : val; } catch { arr = null; }
  if (!Array.isArray(arr)) arr = String(val).split(',').map(s => s.trim());
  arr = arr.filter(v => v !== 'NA' && v !== '');
  return arr.length > 0 ? arr : 'NA';
}

function toBoolStr(val) {
  return (val === 1 || val === '1' || val === true || val === 'true') ? 'true' : 'NA';
}

function buildGetAdsInsertData(data, network) {
  // Normalize order_column → sort fields for platforms that send order_column instead of *_sort
  const orderCol = data.order_column;
  if (orderCol && (!data.views_sort      || data.views_sort      === 'NA') && orderCol === 'views')      data.views_sort      = 'views_sort';
  if (orderCol && (!data.likes_sort      || data.likes_sort      === 'NA') && orderCol === 'likes')      data.likes_sort      = 'likes_sort';
  if (orderCol && (!data.comments_sort   || data.comments_sort   === 'NA') && orderCol === 'comment')    data.comments_sort   = 'comments_sort';
  if (orderCol && (!data.impression_sort || data.impression_sort === 'NA') && orderCol === 'impression') data.impression_sort = 'impression_sort';
  if (orderCol && (!data.popularity_sort || data.popularity_sort === 'NA') && orderCol === 'popularity') data.popularity_sort = 'popularity_sort';
  if (orderCol && (!data.newest_sort     || data.newest_sort     === 'NA') && orderCol === 'post_date')  data.newest_sort     = 'newest_sort';

  const base = {
    'user.id':                   data.user_id,
    'user.email':                data.email,
    'user.SubscriptionType':     data.userSubscription,
    'user.userSubscriptionType': data.userSubscriptionType,
    network,
    dateTime:               nowTs(),
    date:                   nowDate(),
    'search.keyword':        data.keyword,
    'search.advertiser':     data.advertiser,
    'search.domain':         data.domain,
    'search.landing_page_text': data.html_content,
    'filter.countries':      data.country,
    'filter.languages':      data.lang,
    'filter.call_to_actions': data.call_to_action,
    'filter.ad_positions':   data.ad_position_filter,
    'filter.gender':         data.gender,
    'filter.lower_age':      data.lower_age,
    'filter.upper_age':      data.upper_age,
    'lander.affiliates':     data.affiliate,
    'lander.ecommerce':      data.ecommerce,
    'lander.funnels':        data.funnel,
    'lander.sources':        data.source,
    'lander.marketing':      resolveMarketPlatforms(data.market_platform),
    'dashboard.newest_sort':          data.newest_sort,
    'dashboard.running_longest_sort': data.running_longest_sort,
    'dashboard.last_seen_sort':       data.last_seen_sort,
    'dashboard.domain_sort':          data.domain_sort,
    'dashboard.ad_seen':              toTimestampPair(data.seen_btn_sort),
    'dashboard.post_date':            toTimestampPair(data.post_date_btn_sort),
    domain_date_btn_sort:             toTimestampPair(data.domain_date_btn_sort),
    'filter.ad_categories':    data.adcategory,
    'filter.ad_subCategories': data.subCategory,
    adsCountOnSerach:          data.adsCountOnSerach,
    'dashboard.favourite':     data.favorite === 'true' ? 'favourite' : 'NA',
    'dashboard.hidden':        data.hidden   === 'true' ? 'hidden'    : 'NA',
    project_name:               data.project_name              ?? 'NA',
    competitor_name:            data.competitor_name           ?? 'NA',
    competitor_platform:        data.competitor_platform       ?? 'NA',
    competitor_platform_click:  data.competitor_platform_click ?? 'NA',
  };

  if (network === 'facebook') {
    Object.assign(base, {
      'search_by.text':           data.ocr,
      'search_by.celebrities':    data.image_celebrity ?? 'NA',
      'search_by.objects':        data.image_object ?? 'NA',
      'search_by.brands':         data.image_logo ?? 'NA',
      'search.commentdata':       data.commentdata ?? 'NA',
      'filter.ad_type':           data.type,
      'dashboard.likes_sort':       data.likes_sort,
      'dashboard.likes_range':      data.likes,
      'dashboard.comments_sort':    data.comments_sort,
      'dashboard.comments_range':   data.comments,
      'dashboard.shares_sort':      data.shares_sort,
      'dashboard.shares_range':     data.shares,
      'dashboard.popularity_sort':  data.popularity_sort,
      'dashboard.popularity_range': data.popularity,
      'dashboard.impressions_sort': data.impression_sort,
      'dashboard.impressions_range': data.impressions,
      'dashboard.adBudget':         data.adBudget,
      'dashboard.verified':         toBoolStr(data.verified),
      'dashboard.meta_ads_library': toBoolStr(data.meta_ads_lib_filter),
    });
  } else if (network === 'GDN') {
    Object.assign(base, {
      'search_by.text':          data.ocr,
      'search_by.celebrities':   data.celeb,
      'search_by.objects':       data.object,
      'search_by.brands':        data.logo,
      'filter.image_size':       data.size && data.size !== 'NA'
        ? (typeof data.size === 'string' ? data.size.split(',').map(s => s.trim()).filter(Boolean) : data.size)
        : 'NA',
      'dashboard.likes_sort':    data.likes_sort,
      'dashboard.comments_sort': data.comments_sort,
      'dashboard.shares_sort':   data.shares_sort,
    });
  } else if (network === 'instagram') {
    Object.assign(base, {
      'search_by.text':           data.ocr,
      'search_by.celebrities':    data.celeb,
      'search_by.objects':        data.object,
      'search_by.brands':         data.logo,
      'filter.ad_type':           data.type,
      'sort_by.likes':              data.likes,
      'sort_by.comments':           data.comments,
      'dashboard.likes_sort':       data.likes_sort,
      'dashboard.likes_range':      data.likes,
      'dashboard.comments_sort':    data.comments_sort,
      'dashboard.comments_range':   data.comments,
      'dashboard.shares_sort':      data.shares_sort,
      'dashboard.shares_range':     data.shares,
      'dashboard.popularity_sort':  data.popularity_sort,
      'dashboard.popularity_range': data.popularity,
      'dashboard.impressions_sort': data.impression_sort,
      'dashboard.impressions_range': data.impressions,
      'dashboard.adBudget':         data.adBudget,
      'dashboard.verified':         toBoolStr(data.verified),
      'dashboard.meta_ads_library': toBoolStr(data.meta_ads_lib_filter),
    });
  } else if (network === 'Google') {
    Object.assign(base, {
      'user.email':              data.user_email,
      target_keywords:           data.target_keywords,
      'filter.ad_type':          data.type_filter,
      'filter.ad_subPositions':  data.ad_sub_position,
      'dashboard.likes_sort':    data.likes_sort,
      'dashboard.comments_sort': data.comments_sort,
      'dashboard.shares_sort':   data.shares_sort,
    });
  } else if (network === 'Linkedin') {
    Object.assign(base, {
      'search_by.text':        data.ocr,
      'search_by.celebrities': data.image_celebrity ?? 'NA',
      'search_by.objects':     data.image_object ?? 'NA',
      'search_by.brands':      data.image_logo ?? 'NA',
      'filter.ad_type':        data.type,
      'sort_by.likes':              data.likes,
      'sort_by.comments':           data.comments,
      'dashboard.likes_sort':       data.likes_sort,
      'dashboard.likes_range':      data.likes,
      'dashboard.comments_sort':    data.comments_sort,
      'dashboard.comments_range':   data.comments,
      'dashboard.shares_sort':      data.shares_sort,
      'dashboard.shares_range':     data.shares,
      'dashboard.impressions_sort':  data.impressionsort ?? data.impression_sort,
      'dashboard.impressions_range': data.impressions,
      'dashboard.popularity_sort':   data.popularitysort ?? data.popularity_sort,
      'dashboard.popularity_range':  data.popularitys ?? data.popularity,
      'dashboard.verified':          toBoolStr(data.verified),
    });
  } else if (network === 'Pinterest') {
    Object.assign(base, {
      'search_by.text':          data.ocr,
      'search_by.celebrities':   data.image_celebrity ?? 'NA',
      'search_by.objects':       data.image_object ?? 'NA',
      'search_by.brands':        data.image_logo ?? 'NA',
      'filter.ad_type':          data.type,
      'dashboard.likes_sort':    data.likes_sort,
      'dashboard.likes_range':   data.likes,
      'dashboard.comments_sort': data.comments_sort,
      'dashboard.comments_range': data.comments,
      'dashboard.shares_sort':   data.shares_sort,
      'dashboard.shares_range':  data.shares,
    });
  } else if (network === 'Quora') {
    Object.assign(base, {
      'search_by.text':        data.ocr,
      'search_by.celebrities': data.celeb,
      'search_by.objects':     data.object,
      'search_by.brands':      data.logo,
      'filter.ad_type':        data.type_filter,
    });
  } else if (network === 'Reddit') {
    Object.assign(base, {
      'search_by.text':          data.ocr,
      'search_by.celebrities':   data.celeb,
      'search_by.objects':       data.object,
      'search_by.brands':        data.logo,
      'filter.ad_type':          data.type,
      'sort_by.likes':           data.likes,
      'dashboard.likes_sort':    data.likes_sort,
      'dashboard.likes_range':   data.likes,
      'dashboard.comments_sort': data.comments_sort,
      'dashboard.comments_range': data.comments,
      'dashboard.shares_sort':   data.shares_sort,
      'dashboard.shares_range':  data.shares,
    });
  } else if (network === 'Youtube') {
    Object.assign(base, {
      'search_by.text':        data.ocr,
      'search_by.celebrities': data.celebrity,
      'search_by.objects':     data.object ?? 'NA',
      'search_by.brands':      data.brand_logo ?? 'NA',
      'search.commentdata':    data.commentdata ?? 'NA',
      'filter.ad_type':        data.type_filter,
      'sort_by.likes':           data.likes,
      'sort_by.comments':        data.comments,
      'sort_by.views':           data.views,
      'dashboard.likes_sort':    data.likes_sort,
      'dashboard.likes_range':   data.likes,
      'dashboard.comments_sort': data.comments_sort,
      'dashboard.comments_range': data.comments,
      'dashboard.adBudget':      data.adBudget,
      'dashboard.views_sort':    data.views_sort,
      'dashboard.views_range':   data.views,
      'dashboard.verified':      toBoolStr(data.verified),
    });
  } else if (network === 'tiktok' || network === 'TikTok') {
    Object.assign(base, {
      'filter.ad_type':              data.type,
      'filter.languages':            data.lang,
      'filter.countries':            data.country,
      'filter.ad_categories':        data.adcategory,
      'filter.ad_subCategories':     data.subCategory,
      'search_by.text':              data.ocr,
      'search_by.celebrities':       data.image_celebrity ?? 'NA',
      'search_by.objects':           data.image_object ?? 'NA',
      'search_by.brands':            data.image_logo ?? 'NA',
      'dashboard.likes_sort':        data.likes_sort,
      'dashboard.likes_range':       data.likes,
      'dashboard.comments_sort':     data.comments_sort,
      'dashboard.comments_range':    data.comments,
      'dashboard.shares_sort':       data.shares_sort,
      'dashboard.shares_range':      data.shares,
      'dashboard.impressions_sort':  data.impression_sort,
      'dashboard.impressions_range': data.impressions,
      'dashboard.popularity_sort':   data.popularity_sort,
      'dashboard.popularity_range':  data.popularity,
      'dashboard.adBudget':          data.adBudget,
      'filter.ctr':                  data.ctr,
      'filter.budget':               data.budget,
    });
  } else if (network === 'Native') {
    Object.assign(base, {
      'search_by.text':        data.ocr,
      'search_by.celebrities': data.image_celebrity ?? 'NA',
      'search_by.objects':     data.image_object ?? 'NA',
      'search_by.brands':      data.image_logo ?? 'NA',
      'filter.ad_type':        data.type,
      'filter.network':        data.network,
      'dashboard.likes':       data.likes_sort,
      'dashboard.comments':    data.comments_sort,
      'dashboard.shares':      data.shares_sort,
    });
  } else if (network === 'All') {
    Object.assign(base, {
      'search_by.text':              data.ocr,
      'search_by.celebrities':       data.image_celebrity ?? data.celeb ?? 'NA',
      'search_by.objects':           data.image_object    ?? data.object ?? 'NA',
      'search_by.brands':            data.image_logo      ?? data.logo ?? 'NA',
      'filter.ad_type':              data.type ?? data.type_filter,
      'dashboard.newest_sort':          data.newest_sort,
      'dashboard.running_longest_sort': data.running_longest_sort,
      'dashboard.last_seen_sort':       data.last_seen_sort,
      'dashboard.likes_sort':           data.likes_sort,
      'dashboard.likes_range':          data.likes,
      'dashboard.comments_sort':        data.comments_sort,
      'dashboard.comments_range':       data.comments,
      'dashboard.shares_sort':          data.shares_sort,
      'dashboard.shares_range':         data.shares,
      'dashboard.impressions_sort':     data.impression_sort,
      'dashboard.impressions_range':    data.impressions,
      'dashboard.popularity_sort':      data.popularity_sort,
      'dashboard.popularity_range':     data.popularity,
      'dashboard.views_sort':           data.views_sort,
      'dashboard.views_range':          data.view ?? data.views,
      'dashboard.adBudget_sort':        data.adBudget_sort,
      'dashboard.adBudget':             data.adBudget,
      'dashboard.verified':             toBoolStr(data.verified),
      'dashboard.meta_ads_library':     toBoolStr(data.meta_ads_lib_filter),
      'filter.image_size':              data.size && data.size !== 'NA'
        ? (typeof data.size === 'string' ? data.size.split(',').map(s => s.trim()).filter(Boolean) : data.size)
        : 'NA',
      'filter.native_network':          data.nativeNetwork && data.nativeNetwork !== 'NA'
        ? (Array.isArray(data.nativeNetwork) ? data.nativeNetwork : [data.nativeNetwork])
        : 'NA',
      'filter.ad_subPositions':         data.ad_sub_position,
      'filter.budget':                  data.budget,
      'filter.ctr':                     data.ctr,
    });
  }

  return base;
}

function determineFilterType(data, searchFields, filterFields) {
  const searchEnabled = searchFields.some(f => data[f] && data[f] !== 'NA' && data[f] !== '');
  const filterEnabled = filterFields.some(f => data[f] && data[f] !== 'NA' && data[f] !== '');
  if (searchEnabled && filterEnabled) return 'search_and_filter';
  if (searchEnabled) return 'search_only';
  if (filterEnabled) return 'filter_only';
  return null;
}

const SEARCH_FIELDS = ['keyword', 'advertiser', 'domain'];

const FILTER_FIELDS_BY_NETWORK = {
  facebook:  ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','image_celebrity','image_object','image_logo','affiliate','ecommerce','funnel','source','market_platform','type','adcategory','subCategory','commentdata','likes','comments','shares','popularity','impressions','adBudget'],
  GDN:       ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','celeb','object','logo','size','affiliate','ecommerce','funnel','source','market_platform','adcategory','subCategory'],
  instagram: ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','celeb','object','logo','affiliate','ecommerce','funnel','source','market_platform','type','adcategory','subCategory','likes','comments','popularity','impressions','adBudget'],
  Google:    ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','affiliate','ecommerce','funnel','source','market_platform','type_filter','adcategory','subCategory','target_keywords','ad_sub_position'],
  Linkedin:  ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','image_celebrity','image_object','image_logo','affiliate','ecommerce','funnel','source','market_platform','type','adcategory','subCategory','likes','comments','popularitys','impressions'],
  Pinterest: ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','image_celebrity','image_object','image_logo','affiliate','ecommerce','funnel','source','market_platform','type','adcategory','subCategory'],
  Quora:     ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','celeb','object','logo','affiliate','ecommerce','funnel','source','market_platform','type_filter','adcategory','subCategory'],
  Reddit:    ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','celeb','object','logo','affiliate','ecommerce','funnel','source','market_platform','type','adcategory','subCategory','likes'],
  Youtube:   ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','celebrity','object','brand_logo','affiliate','ecommerce','funnel','source','market_platform','type_filter','adcategory','subCategory','commentdata','likes','comments','views','adBudget'],
  Native:    ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','image_celebrity','image_object','image_logo','affiliate','ecommerce','funnel','source','market_platform','type','network','adcategory','subCategory'],
  TikTok:    ['html_content','country','lang','call_to_action','ad_position_filter','ocr','image_celebrity','image_object','image_logo','affiliate','ecommerce','funnel','source','market_platform','type','adcategory','subCategory','likes','comments','shares','popularity','impressions','adBudget','ctr','budget'],
  tiktok:    ['html_content','country','lang','call_to_action','ad_position_filter','ocr','image_celebrity','image_object','image_logo','affiliate','ecommerce','funnel','source','market_platform','type','adcategory','subCategory','likes','comments','shares','popularity','impressions','adBudget','ctr','budget'],
  All:       ['html_content','country','lang','call_to_action','ad_position_filter','gender','lower_age','upper_age','ocr','image_celebrity','image_object','image_logo','celeb','object','logo','affiliate','ecommerce','funnel','source','market_platform','type','type_filter','adcategory','subCategory','likes','comments','shares','popularity','impressions','view','views','adBudget','verified','meta_ads_lib_filter','size','nativeNetwork','ad_sub_position','budget','ctr'],
};

async function indexActivity(elastic, doc) {
  return elastic.index({
    index: 'user_activities',
    type:  'doc',
    body:  doc,
  });
}

/**
 * POST /api/v1/frontend_user_activity/user-activity
 * Mirrors PHP ShwDetail() in helper.php — stores user activity into ES user_activities index.
 */
async function userActivity(req, elastic, logger) {
  try {
    const data = req.body;
    if (!data.user_id) {
      return { code: 400, message: 'Missing required param: user_id' };
    }

    const userEmail = data.email || 'NA';
    let userCurrentCountry = data.user_country || 'NA';

    // If frontend sends 'auto-detect', fetch country from request headers/IP
    if (userCurrentCountry === 'auto-detect') {
      // Try CDN headers first (Cloudflare, etc.)
      const cdnCountry = detectCountry(req);
      if (cdnCountry) {
        userCurrentCountry = cdnCountry;
      } else {
        // Fallback to IP lookup (slower, but works when CDN headers aren't available)
        try {
          const clientIp = getClientIp(req);
          if (clientIp && clientIp !== 'localhost' && !clientIp.startsWith('127.')) {
            const country = await getLocation(clientIp);
            userCurrentCountry = country || 'NA';
          } else {
            // Local/dev IP — can't geolocate
            userCurrentCountry = 'NA';
          }
        } catch (err) {
          console.warn('[userActivityController] Failed to detect country from IP:', err.message);
          userCurrentCountry = 'NA';
        }
      }
    }

    // Wrap indexActivity to always include current country + email on every doc
    const indexWithMeta = (doc) => indexActivity(elastic, {
      ...doc,
      'user.email':           userEmail,
      'user.current_country': userCurrentCountry || 'NA',
    });

    const method  = data.method;
    const network = data.platform || data.network;
    const isNative = data.platform === 'Native';

    if (method === 'showAnalytics') {
      await indexWithMeta({
        'user.id':              data.user_id,
        dateTime:               nowTs(),
        date:                   nowDate(),
        'user.userSubscriptionType': data.userSubscriptionType,
        network:                isNative ? data.platform : data.network,
        'show_analytics.ad_id': data.ad_id,
      });

    } else if (method === 'loginPage') {
      const plan = data.userSubscriptionType == 20 ? 'free' : 'paid';
      await indexWithMeta(filterNA({
        'user.id':       data.user_id,
        'user.username': data.name,
        network:         isNative ? data.platform : data.network,
        'user.type':     plan,
        dateTime:        nowTs(),
        date:            nowDate(),
        method:          'LoggedIn',
      }));

    } else if (method === 'userRequest') {
      await indexWithMeta(filterNA({
        'user.id':    data.user_id,
        network:      data.network,
        domains:      data.domain,
        keywords:     data.keywords,
        advertiser:   data.advertiser,
        country:      data.country,
        dateTime:     nowTs(),
        date:         nowDate(),
      }));

    } else if (method === 'getAds') {
      const net = isNative ? 'Native' : data.network;
      const isAllOrMulti = net === 'All' || (typeof net === 'string' && net.includes(','));
      const branchNet = isAllOrMulti ? 'All' : net;
      const filterFields = FILTER_FIELDS_BY_NETWORK[branchNet] || [];
      // Use actual net for the stored network field, branchNet only for field-mapping branch selection
      const insertData = buildGetAdsInsertData(data, branchNet);
      insertData.network = net; // overwrite with actual value (e.g. 'facebook,instagram' not 'All')
      const filterType = determineFilterType(data, SEARCH_FIELDS, filterFields);
      if (filterType) insertData.filterType = filterType;
      const cleaned = filterNA(insertData);
      if (Object.keys(cleaned).length > 0) await indexWithMeta(cleaned);

    } else if (method === 'ExportAds') {
      await indexWithMeta(filterNA({
        'user.id':                   data.user_id,
        network:                     data.network,
        'dashboard.exportsAds':      'export_ads',
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                    nowTs(),
        date:                        nowDate(),
      }));

    } else if (method === 'showOriginal') {
      await indexWithMeta(filterNA({
        'showoriginal.ad_id':        data.ad_id,
        'dashboard.show_original':   data.show_original ?? 'true',
        'user.id':                   data.user_id,
        network:                     isNative ? data.platform : data.network,
        dateTime:                    nowTs(),
        date:                        nowDate(),
        'user.userSubscriptionType': data.userSubscriptionType,
      }));

    } else if (method === 'viewOriginal') {
      await indexWithMeta(filterNA({
        'vieworiginal.ad_id':        data.ad_id,
        ad_id:                       data.ad_id,
        'user.id':                   data.user_id,
        network:                     isNative ? data.platform : data.network,
        dateTime:                    nowTs(),
        date:                        nowDate(),
        'user.userSubscriptionType': data.userSubscriptionType,
      }));

    } else if (method === 'unHide') {
      const typeMap = { 1: 'unhide_advertiser_id', 2: 'unhide_ad_id', 3: 'unfavourite_ad_id' };
      const dynKey = typeMap[data.unhidetype];
      if (!dynKey) return { code: 400, message: 'Invalid unhidetype' };
      await indexWithMeta(filterNA({
        'user.id':        data.user_id,
        network:          isNative ? data.platform : data.network,
        'activity.type':  data.unhidetype,
        post_owner_id:    data.post_owner_id,
        [dynKey]:         data.ad_id,
        dateTime:         nowTs(),
        date:             nowDate(),
      }));

    } else if (method === 'favAds') {
      const typeMap = { 1: 'hide_advertiser_id', 2: 'hide_ad_id', 3: 'favourite_ad_id' };
      const dynKey = typeMap[data.hidetype];
      if (!dynKey) return { code: 400, message: 'Invalid hidetype' };
      await indexWithMeta(filterNA({
        'user.id':        data.user_id,
        network:          isNative ? data.platform : data.network,
        'activity.type':  data.hidetype,
        post_owner_id:    data.post_owner_id,
        [dynKey]:         data.ad_id,
        dateTime:         nowTs(),
        date:             nowDate(),
      }));

    } else if (method === 'shareAd') {
      await indexWithMeta(filterNA({
        'user.id':                  data.user_id,
        network:                    data.network,
        'share.ad_id':              data.ad_id ?? 'NA',
        'share.domain':             data.domain ?? 'NA',
        'share.guest_page_url':     data.guest_page_url ?? 'NA',
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                   nowTs(),
        date:                       nowDate(),
      }));

    } else if (method === 'copyAd') {
      await indexWithMeta(filterNA({
        'user.id':                  data.user_id,
        network:                    data.network,
        'copy.ad_id':               data.ad_id,
        'copy.landing_page_url':    data.landing_page_url ?? 'NA',
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                   nowTs(),
        date:                       nowDate(),
      }));

    } else if (method === 'downloadAd') {
      await indexWithMeta(filterNA({
        'user.id':                  data.user_id,
        network:                    data.network,
        'download.ad_id':           data.ad_id,
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                   nowTs(),
        date:                       nowDate(),
      }));

    } else if (method === 'getTopAdsO') {
      if (data.network === 'Google') {
        const insertData = filterNA({
          'user.id':                    data.user_id,
          'user.userSubscriptionType':  data.userSubscriptionType,
          network:                      data.network,
          dateTime:                     nowTs(),
          date:                         nowDate(),
          target_keywords:              data.target_keywords,
          'search.keyword':             data.keyword,
          'search.advertiser':          data.advertisername,
          'search.domain':              data.domainname,
          'search.landing_page_text':   data.html_content,
          'filter.countries':           data.country,
          'filter.ad_type':             data.type_filter,
          'filter.languages':           data.lang,
          'filter.call_to_actions':     data.call_to_action,
          'filter.ad_positions':        data.ad_position,
          'filter.ad_subPositions':     data.ad_sub_position,
          'filter.gender':              data.gender,
          'filter.lower_age':           data.lower_age,
          'filter.upper_age':           data.upper_age,
          'lander.affiliates':          data.affiliate,
          'lander.ecommerce':           data.ecommerce,
          'lander.funnels':             data.funnel,
          'lander.sources':             data.source,
          'lander.marketing':           resolveMarketPlatforms(data.market_platform),
          'dashboard.likes_sort':       data.likes_sort,
          'dashboard.comments_sort':    data.comments_sort,
          'dashboard.shares_sort':      data.shares_sort,
          'dashboard.newest_sort':      data.newest_sort,
          'dashboard.running_longest_sort': data.running_longest_sort,
          'dashboard.last_seen_sort':   data.last_seen_sort,
          'dashboard.domain_sort':      data.domain_sort,
          'dashboard.ad_seen':          toTimestampPair(data.seen_btn_sort),
          'dashboard.post_date':        toTimestampPair(data.post_date_btn_sort),
          domain_date_btn_sort:         toTimestampPair(data.domain_date_btn_sort),
          adsCountOnSerach:             data.adsCountOnSerach,
        });
        if (Object.keys(insertData).length > 0) await indexWithMeta(insertData);
      }

    } else if (method === 'aiAnalyze') {
      await indexWithMeta(filterNA({
        'user.id':                   data.user_id,
        network:                     isNative ? data.platform : data.network,
        'ai_analyze.ad_id':          data.ad_id,
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                    nowTs(),
        date:                        nowDate(),
      }));

    } else if (method === 'guestView') {
      await indexWithMeta(filterNA({
        'user.id':                   data.user_id,
        network:                     data.network,
        'guest.ad_id':               data.ad_id,
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                    nowTs(),
        date:                        nowDate(),
      }));

    } else if (method === 'languageChange') {
      await indexWithMeta(filterNA({
        'user.id':                   data.user_id,
        'user.language':             data.language,
        'user.language_name':        data.language_name,
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                    nowTs(),
        date:                        nowDate(),
      }));

    } else if (method === 'favourite/hidden') {
      await indexWithMeta(filterNA({
        'user.id':                   data.user_id,
        network:                     data.network,
        'dashboard.favourite':       data['dashboard.favourite'],
        'dashboard.hidden':          data['dashboard.hidden'],
        'user.userSubscriptionType': data.userSubscriptionType,
        dateTime:                    nowTs(),
        date:                        nowDate(),
      }));
    }

    return { code: 200, message: 'User Activity store' };
  } catch (err) {
    logger.error('Error in userActivity (ShwDetail)', { error: err.message });
    return { code: 500, message: err.message };
  }
}

/**
 * POST /api/v1/frontend_user_activity/user-activity-data
 * Mirrors PHP userActivityData() — retrieve user activity for a date range + platforms.
 */
async function userActivityData(req, elastic, logger) {
  try {
    const { user_id, start_date, end_date, platform } = req.body;

    if (!user_id) return { code: 400, message: 'Missing required param: user_id' };

    const startTs = Math.floor(new Date(start_date + 'T00:00:00').getTime() / 1000);
    const endTs   = Math.floor(new Date(end_date   + 'T23:59:59').getTime() / 1000);

    const must = [
      { match: { 'user.id': user_id } },
      { range: { dateTime: { gte: startTs, lte: endTs } } },
    ];

    if (platform && Array.isArray(platform) && platform.length > 0) {
      must.push({ terms: { network: platform } });
    }

    const result = await elastic.search({
      index: 'user_activities',
      type:  'doc',
      body: {
        query: { bool: { must } },
        sort: [{ dateTime: { order: 'desc' } }],
      },
      from: 0,
      size: 10000,
    });

    const hits = result.hits?.hits ?? result.body?.hits?.hits ?? [];
    if (!hits.length) {
      return { message: 'There is no activity from the user' };
    }

    const EXCLUDED = new Set([
      'user.id', 'user.SubscriptionType', 'user.userSubscriptionType',
      'dateTime', 'user.username', 'user.email', 'user.type',
    ]);

    const filteredData = hits.map(hit => {
      const source = hit._source;
      const doc = {};
      for (const [field, value] of Object.entries(source)) {
        if (EXCLUDED.has(field)) continue;
        if (value === 'NA' || value === null || value === 'null') continue;
        doc[field] = field === 'date' ? String(value).split(' ')[0] : value;
      }
      return doc;
    });

    const userId = hits[0]._source['user.id'];

    return {
      code:    200,
      message: 'Data retrieved successfully',
      user_id: userId,
      data:    filteredData,
    };
  } catch (err) {
    logger.error('Error in userActivityData', { error: err.message });
    return { code: 401, message: err.message };
  }
}

/**
 * POST /api/v1/frontend_user_activity/user-details
 * Mirrors PHP userDetails() — paginated ES query with optional platform filter.
 */
async function userDetails(req, elastic, logger) {
  try {
    const { userId, platform, limit, skip, start_date, end_date } = req.body;

    if (!userId || limit == null || skip == null || !start_date || !end_date) {
      return { code: 400, message: 'Missing required params: userId, limit, skip, start_date, end_date' };
    }

    const parseDate = (str, suffix) => {
      const [d, m, y] = str.split('/');
      return `${y}-${m}-${d}${suffix}`;
    };

    const formattedStart = parseDate(start_date, ' 00:00:00');
    const formattedEnd   = parseDate(end_date,   ' 23:59:59');

    const must = [
      { match: { 'user.id': userId } },
      { range: { date: { gte: formattedStart, lte: formattedEnd } } },
    ];

    if (platform) must.push({ match: { network: platform } });

    const result = await elastic.search({
      index: 'user_activities',
      type:  'doc',
      body: {
        query: { bool: { must } },
        sort: [{ dateTime: { order: 'desc' } }],
      },
      from: Number(skip),
      size: Number(limit),
    });

    const hits = result.hits?.hits ?? result.body?.hits?.hits ?? [];
    if (!hits.length) {
      return { code: 400, message: 'User details not found', data: null };
    }

    return {
      code:    200,
      message: 'User details fetched successfully',
      data:    hits.map(h => h._source),
    };
  } catch (err) {
    logger.error('Error in userDetails', { error: err.message });
    return { code: 400, message: `Error occurred: ${err.message}` };
  }
}

/**
 * POST /api/v1/frontend_user_activity/user-activity-project
 * Mirrors PHP userActivityProject() — stores project activity into ES user_activities index.
 */
async function userActivityProject(req, elastic, logger) {
  try {
    const data = req.body;

    if (!data.user_id) {
      return { code: 400, message: 'Missing required param: user_id' };
    }

    const plan = data.userSubscriptionType == 20 ? 'free' : 'paid';

    const parseArrayField = (val) => {
      if (!val || val === 'NA' || val === '') return 'NA';
      let arr;
      try { arr = typeof val === 'string' ? JSON.parse(val) : val; } catch { arr = null; }
      if (!Array.isArray(arr)) arr = String(val).split(',').map(s => s.trim());
      arr = arr.filter(v => v !== 'NA' && v !== '');
      return arr.length > 0 ? arr : 'NA';
    };

    const insertData = {
      'user.id':            data.user_id,
      'user.username':      data.name,
      'user.email':         data.email,
      network:              data.network,
      'user.type':          plan,
      userSubscriptionType: data.userSubscriptionType,
      dateTime:             nowTs(),
      date:                 nowDate(),
      method:               data.method                                 ?? 'NA',
      brand:                data.brand                                  ?? 'NA',
      advertiser:           data.advertiser                             ?? 'NA',
      competitors:          parseArrayField(data.competitors            ?? 'NA'),
      exported_Competitors: parseArrayField(data.exported_Competitors   ?? 'NA'),
      member_name:          data.member_name                            ?? 'NA',
      member_email:         data.member_email                           ?? 'NA',
      delete_member_name:   data.delete_member_name                     ?? 'NA',
      delete_member_email:  data.delete_member_email                    ?? 'NA',
      project_name:         data.project_name                           ?? 'NA',
      dashboard_Advertisers: parseArrayField(data.dashboard_Advertisers ?? 'NA'),
      deleted_Advertisers:   parseArrayField(data.deleted_Advertisers   ?? 'NA'),
      monitoring_status:    data.monitoring_status                      ?? 'NA',
      competitor_platform:  data.competitor_platform                    ?? 'NA',
    };

    const cleaned = filterNA(insertData);
    if (Object.keys(cleaned).length > 0) {
      await indexActivity(elastic, cleaned);
    }

    return { code: 200, message: 'User_activity successfully inserted' };
  } catch (err) {
    logger.error('Error in userActivityProject', { error: err.message });
    return { code: 400, message: `error occurred in userActivityProject due to --- ${err.message}` };
  }
}

module.exports = { userActivity, userActivityData, userDetails, userActivityProject };
