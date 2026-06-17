import config from "config";

import logger from "../../resources/logs/logger.log.js";
import { esClient, esServers, checkElasticsearchHealth } from "../../utils/Elasticsearch.js";
// import {client} from "../../utils/Elasticsearch.js";
import Response from "../../utils/response.js";

class AdvertiserService {
  constructor() {
    this.esClient = esClient;
    this.esServers = esServers;
  }

  async getLCS(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(Response.validationFailResp("Missing competitors in request body", ""));
      }
  
      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          advertiserField: "facebook_ad_post_owners.post_owner_name",
          likeField: "facebook_ad.likes",
          commentField: "facebook_ad.comments",
          shareField: "facebook_ad.shares", 
          viewField: "facebook_ad.views",
          searchFields: ["facebook_ad_post_owners.post_owner_name"],
          dateFields: [
            "facebook_ad_meta_data.firstSeenOnIos",
            "facebook_ad_meta_data.firstSeenOnAndroid",
            "facebook_ad_meta_data.firstSeenOnDesktop"
          ],
          platform: "facebook"
        },
        {
          index: "instagram_search_mix",
          advertiserField: "instagram_ad_post_owners.post_owner_name",
          likeField: "instagram_ad.likes",
          commentField: "instagram_ad.comments",
          shareField: "instagram_ad.shares", // if not tracked
          viewField: "instagram_ad.views",
          searchFields: ["instagram_ad_post_owners.post_owner_name"],
          dateFields: [
            "instagram_ad_meta_data.firstSeenOnIos",
            "instagram_ad_meta_data.firstSeenOnAndroid",
            "instagram_ad_meta_data.firstSeenOnDesktop"
          ],
          platform: "instagram"
        },
      ];
  
      const monthList = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
  
      const monthlyTotals = { facebook: {}, instagram: {}, youtube: {} };
  
      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
        const relevantIndexes = advertiserIndexConfigs.filter(cfg =>
          serverData.indexes.includes(cfg.index)
        );
  
        const aggPromises = relevantIndexes.map(async (cfg) => {
          const scriptSource = cfg.dateFields
            .map(f => `doc['${f}'].size()!=0 ? doc['${f}'].value : null`)
            .join(" ?: ");
  
          const makeAggBody = (field) => ({
            date_histogram: {
              interval: "month",
              format: "MMMM",
              time_zone: "+05:30",
              min_doc_count: 1,
              script: { source: scriptSource, lang: "painless" }
            },
            aggs: {
              value: { sum: { field } } // sum likes/comments/views for month
            }
          });
  
          const body = {
            size: 0,
            query: {
              bool: {
                must: [
                  {
                    query_string: {
                      fields: cfg.searchFields,
                      query: `(${competitor})`,
                      type: "phrase",
                      default_operator: "AND",
                      auto_generate_synonyms_phrase_query: false
                    }
                  }
                ]
              }
            },
            aggs: {
              monthly_likes: makeAggBody(cfg.likeField),
              monthly_comments: makeAggBody(cfg.commentField),
              /* v8 ignore next -- defensive: every config in this method sets shareField, so the `: {}` branch is unreachable */
              ...(cfg.shareField ? { monthly_shares: makeAggBody(cfg.shareField) } : {}),
              monthly_views: makeAggBody(cfg.viewField)
            }
          };
  
          const result = await client.search({ index: cfg.index, body });
  
          const formatBuckets = (buckets) => {
            const counts = {};
            monthList.forEach(m => counts[m] = 0);
            for (const b of buckets) counts[b.key_as_string] = b.value.value || 0;
            return counts;
          };
  
          monthlyTotals[cfg.platform] = {
            likes: formatBuckets(result.aggregations.monthly_likes.buckets),
            comments: formatBuckets(result.aggregations.monthly_comments.buckets),
            /* v8 ignore next -- defensive: every config in this method sets shareField, so the `: {}` branch is unreachable */
            ...(cfg.shareField ? { shares: formatBuckets(result.aggregations.monthly_shares.buckets) } : {}),
            views: formatBuckets(result.aggregations.monthly_views.buckets)
          };
        });
  
        await Promise.all(aggPromises);
      }
  
      return res.send(Response.userSuccessResp("Monthly engagement stats fetched successfully", monthlyTotals));
    } catch (error) {
      logger.error("Error in getLCS month-wise", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getCategory(req,res){
    try{
      const platform = req?.body?.platform;
      if(!platform) {
        logger.error("Missing platform data in request body");
        return res.send(
          Response.validationFailResp("Missing plaform in request body", " ")
        );

      }

      const categoryIndexConfig = {
        index:"category",
        fields: ["category"],
        platformField: "platforms.keyword",
      };

      let categories = [];

      for(const [serverName, serverData] of Object.entries(this.esServers)){
      
        if(!serverData.indexes.includes(categoryIndexConfig.index)){
          continue;
        }

        const client = this.esClient[serverName];

        const params =  {
           index : categoryIndexConfig.index,
           body :{
            _source: categoryIndexConfig.fields,
            query:{
              term:{
                [categoryIndexConfig.platformField]: platform,
              },
            },
            size: 1000,
           },
        };

        const result = await client.search(params);

        if(result.hits?.hits?.length > 0){
          
          categories = [...new Set(result.hits.hits.map((hit) => hit._source.category))];
          
          break;
        }
      }

      if(categories.length > 0){
        return res.send(
          Response.userSuccessResp(
            `Categories with ${platform} platform is fetched successfully`, categories
          )
        );
      }

      return res.send(
        Response.userFailResp(
          `No categories with ${platform} platform found`,
          null,
          404
        )
      );

    } catch (error){
    logger.error(`Error in getCategory for platform ${req?.body?.platform} :`,error);
    return res.send(Response.userFailResp("Internal server error" ,error));

    }
  }
  

  async getEngagementData(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }

      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
        },
        { index: "youtube_ads_data", field: "post_owner" },
      ];

      const impressionConfigs = [
        { index: "search_mix", field: "facebook_ad.impression" },
        { index: "instagram_search_mix", field: "instagram_ad.impression" },
      ];
      const popularityConfigs = [
        { index: "search_mix", field: "facebook_ad.popularity.current" },
        {
          index: "instagram_search_mix",
          field: "instagram_ad.popularity.current",
        },
      ];

      const engagementConfigs = [
        { index: "search_mix", field: "engagement_rate" },
        { index: "instagram_search_mix", field: "engagement_rate" },
      ];

      const verifiedConfigs = [
        { index: "search_mix", field: "facebook_ad_post_owners.verified" },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.verified",
        },
        {
          index: "youtube_ads_data",
          field: "verified",
        },
      ];

      let totals = {
        facebook: {},
        instagram: {},
        youtube: {},
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];

        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantImpIndexes = impressionConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantPopularityIndexes = popularityConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantEngagementIndexes = engagementConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantVerifiedIndexes = verifiedConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );

        const impStatsPromises = relevantImpIndexes.map(
          async ({ index, field }) => {
            const advertiserField = relevantAdvertiserIndexes.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- the impression/popularity/engagement/verified configs are all subsets of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return;

            const result = await client.search({
              index,
              size: 0,
              body: {
                query: { match_phrase: { [advertiserField]: competitor } },
                aggs: {
                  max_impression: { max: { field } },
                  min_impression: { min: { field } },
                },
              },
            });

            /* v8 ignore start -- impressionConfigs only contains search_mix + instagram_search_mix; the non-matching dispatch branches are unreachable */
            if (index === "search_mix") {
              totals.facebook.highestImpression =
                result.aggregations.max_impression.value ?? null;
              totals.facebook.lowestImpression =
                result.aggregations.min_impression.value ?? null;
            } else if (index === "instagram_search_mix") {
              totals.instagram.highestImpression =
                result.aggregations.max_impression.value ?? null;
              totals.instagram.lowestImpression =
                result.aggregations.min_impression.value ?? null;
            }
            /* v8 ignore stop */
          }
        );

        const popularityStatsPromises = relevantPopularityIndexes.map(
          async ({ index, field }) => {
            const advertiserField = relevantAdvertiserIndexes.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- the impression/popularity/engagement/verified configs are all subsets of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return;

            const result = await client.search({
              index,
              size: 0,
              body: {
                query: { match_phrase: { [advertiserField]: competitor } },
                aggs: {
                  max_popularity: { max: { field } },
                  min_popularity: { min: { field } },
                },
              },
            });

            /* v8 ignore start -- popularityConfigs only contains search_mix + instagram_search_mix; the non-matching dispatch branches are unreachable */
            if (index === "search_mix") {
              totals.facebook.highestPopularity =
                result.aggregations.max_popularity.value ?? null;
              totals.facebook.lowestPopularity =
                result.aggregations.min_popularity.value ?? null;
            } else if (index === "instagram_search_mix") {
              totals.instagram.highestPopularity =
                result.aggregations.max_popularity.value ?? null;
              totals.instagram.lowestPopularity =
                result.aggregations.min_popularity.value ?? null;
            }
            /* v8 ignore stop */
          }
        );

        const engagementStatsPromises = relevantEngagementIndexes.map(
          async ({ index, field }) => {
            const advertiserField = relevantAdvertiserIndexes.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- the impression/popularity/engagement/verified configs are all subsets of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return;

            const result = await client.search({
              index,
              size: 0,
              body: {
                query: { match_phrase: { [advertiserField]: competitor } },
                aggs: {
                  max_engagement: { max: { field } },
                  min_engagement: { min: { field } },
                },
              },
            });

            /* v8 ignore start -- engagementConfigs only contains search_mix + instagram_search_mix; the non-matching dispatch branches are unreachable */
            if (index === "search_mix") {
              totals.facebook.highestEngagement =
                result.aggregations.max_engagement.value ?? null;
              totals.facebook.lowestEngagement =
                result.aggregations.min_engagement.value ?? null;
            } else if (index === "instagram_search_mix") {
              totals.instagram.highestEngagement =
                result.aggregations.max_engagement.value ?? null;
              totals.instagram.lowestEngagement =
                result.aggregations.min_engagement.value ?? null;
            }
            /* v8 ignore stop */
          }
        );

        const nonVerifiedStatsPromises = relevantVerifiedIndexes.map(
          async ({ index, field }) => {
            const advertiserField = relevantAdvertiserIndexes.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- the impression/popularity/engagement/verified configs are all subsets of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return;

            const result = await client.search({
              index,
              size: 0,
              body: {
                query: {
                  bool: {
                    must: [
                      { match_phrase: { [advertiserField]: competitor } },
                      { term: { [field]: 0 } },
                    ],
                  },
                },
              },
            });

            const count = result.hits.total;

            /* v8 ignore start -- verifiedConfigs' indexes are exhaustively dispatched here; the non-matching dispatch branch is unreachable */
            if (index === "search_mix") {
              totals.facebook.nonVerifiedCount = count;
            } else if (index === "instagram_search_mix") {
              totals.instagram.nonVerifiedCount = count;
            } else if (index === "youtube_ads_data") {
              totals.youtube.nonVerifiedCount = count;
            }
            /* v8 ignore stop */
          }
        );

        const verifiedStatsPromises = relevantVerifiedIndexes.map(
          async ({ index, field }) => {
            const advertiserField = relevantAdvertiserIndexes.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- the impression/popularity/engagement/verified configs are all subsets of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return;

            const result = await client.search({
              index,
              size: 0,
              body: {
                query: {
                  bool: {
                    must: [
                      { match_phrase: { [advertiserField]: competitor } },
                      { term: { [field]: 1 } },
                    ],
                  },
                },
              },
            });

            const count = result.hits.total;

            /* v8 ignore start -- verifiedConfigs' indexes are exhaustively dispatched here; the non-matching dispatch branch is unreachable */
            if (index === "search_mix") {
              totals.facebook.verifiedCount = count;
            } else if (index === "instagram_search_mix") {
              totals.instagram.verifiedCount = count;
            } else if (index === "youtube_ads_data") {
              totals.youtube.verifiedCount = count;
            }
            /* v8 ignore stop */
          }
        );

        await Promise.all([
          Promise.all(impStatsPromises),
          Promise.all(popularityStatsPromises),
          Promise.all(engagementStatsPromises),
          Promise.all(nonVerifiedStatsPromises),
          Promise.all(verifiedStatsPromises),
        ]);
      }

      return res.send(
        Response.userSuccessResp("Stats fetched successfully", totals)
      );
    } catch (error) {
      logger.error(
        "Error in fetching the popularity, impression and engagement details",
        error
      );
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getFrequentData(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }
  
      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
          searchFields: ["facebook_ad_post_owners.post_owner_name"],
          dateFields: [
            "facebook_ad_meta_data.firstSeenOnIos",
            "facebook_ad_meta_data.firstSeenOnAndroid",
            "facebook_ad_meta_data.firstSeenOnDesktop",
          ],
          ctaField: "facebook_call_to_actions.action",
          platform: "facebook",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
          searchFields: ["instagram_ad_post_owners.post_owner_name"],
          dateFields: [
            "instagram_ad_meta_data.firstSeenOnIos",
            "instagram_ad_meta_data.firstSeenOnAndroid",
            "instagram_ad_meta_data.firstSeenOnDesktop",
          ],
          ctaField: "instagram_call_to_action.call_to_action",
          platform: "instagram",
        },
        {
          index: "youtube_ads_data",
          field: "post_owner",
          searchFields: ["post_owner"],
          dateFields: ["first_seen"], // adjust if multiple exist
          ctaField: "call_to_action",
          platform: "youtube",
        },
      ];
  
      const countryConfigs = [
        { index: "search_mix", field: "country_only.country" },
        { index: "instagram_search_mix", field: "instagram_country_only.country" },
        { index: "youtube_ads_data", field: "countries" },
      ];
  
      const adPositionConfigs = [
        { index: "search_mix", field: "facebook_ad.ad_position" },
        { index: "instagram_search_mix", field: "instagram_ad.ad_position" },
        { index: "youtube_ads_data", field: "ad_position" },
      ];
  
      let totals = {
        facebook: {},
        instagram: {},
        youtube: {},
      };
  
      const monthList = [
        "January","February","March","April","May","June",
        "July","August","September","October","November","December"
      ];
  
      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
  
        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantCountryIndexes = countryConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantPositionIndexes = adPositionConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantCtaIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
  
        // Country stats
        const countryStatsPromises = relevantCountryIndexes.map(
          async ({ index, field }) => {
            const advertiserField = relevantAdvertiserIndexes.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- the impression/popularity/engagement/verified configs are all subsets of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return;
  
            const result = await client.search({
              index,
              size: 0,
              body: {
                query: {
                  match_phrase: {
                    [advertiserField]: competitor,
                  },
                },
                aggs: {
                  top_countries: {
                    terms: { field: `${field}.keyword`, size: 10 },
                  },
                },
              },
            });
  
            const countriesList =
              result.aggregations?.top_countries?.buckets.map((b) => ({
                country: b.key,
                count: b.doc_count,
              })) || [];
  
            /* v8 ignore start -- relevantCountryIndexes is exhaustively dispatched here; the non-matching branch is unreachable */
            if (index === "search_mix") totals.facebook.topCountries = countriesList;
            else if (index === "instagram_search_mix") totals.instagram.topCountries = countriesList;
            else if (index === "youtube_ads_data") totals.youtube.topCountries = countriesList;
            /* v8 ignore stop */
          }
        );
  
        // Ad Position stats
        const positionStatsPromises = relevantPositionIndexes.map(
          async ({ index, field }) => {
            const advertiserField = relevantAdvertiserIndexes.find(
              (cfg) => cfg.index === index
            )?.field;

            /* v8 ignore next -- relevantPositionIndexes is a subset of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return;
  
            const result = await client.search({
              index,
              size: 0,
              body: {
                query: {
                  match_phrase: { [advertiserField]: competitor },
                },
                aggs: {
                  top_ad_positions: {
                    terms: { field: `${field}.keyword`, size: 10 },
                  },
                },
              },
            });
  
            const positionList =
              result.aggregations?.top_ad_positions?.buckets.map((b) => ({
                ad_position: b.key,
                count: b.doc_count,
              })) || [];
  
            /* v8 ignore start -- relevantPositionIndexes is exhaustively dispatched here; the non-matching branch is unreachable */
            if (index === "search_mix") totals.facebook.topAdPosition = positionList;
            else if (index === "instagram_search_mix") totals.instagram.topAdPosition = positionList;
            else if (index === "youtube_ads_data") totals.youtube.topAdPosition = positionList;
            /* v8 ignore stop */
          }
        );
  
        // CTA stats (overall top + monthly counts)
        const ctaStatsPromises = relevantCtaIndexes.map(async (cfg) => {
          const advertiserField = cfg.field;
          /* v8 ignore next -- every CTA config sets a field, so advertiserField is always present */
          if (!advertiserField) return;
  
          // ---- 1. Overall Top CTA ----
          const result = await client.search({
            index: cfg.index,
            size: 0,
            body: {
              query: { match_phrase: { [advertiserField]: competitor } },
              aggs: {
                top_cta: {
                  terms: { field: `${cfg.ctaField}.keyword`, size: 10 },
                },
              },
            },
          });
  
          const ctaList =
            result.aggregations?.top_cta?.buckets.map((b) => ({
              cta: b.key,
              count: b.doc_count,
            })) || [];
  
          // ---- 2. Monthly CTA ----
          const scriptSource = cfg.dateFields
            .map((f) => `doc['${f}'].size()!=0 ? doc['${f}'].value : null`)
            .join(" ?: ");
  
          const monthlyBody = {
            size: 0,
            query: {
              bool: {
                must: [
                  {
                    query_string: {
                      fields: cfg.searchFields,
                      query: `(${competitor})`,
                      type: "phrase",
                      default_operator: "AND",
                      auto_generate_synonyms_phrase_query: false,
                    },
                  },
                ],
              },
            },
            aggs: {
              monthly_cta: {
                date_histogram: {
                  interval: "month",
                  format: "MMMM",
                  time_zone: "+05:30",
                  min_doc_count: 1,
                  script: { source: scriptSource, lang: "painless" },
                },
                aggs: {
                  top_cta: {
                    terms: { field: `${cfg.ctaField}.keyword`, size: 10 },
                  },
                },
              },
            },
          };
  
          const monthlyRes = await client.search({ index: cfg.index, body: monthlyBody });
          const buckets = monthlyRes.aggregations?.monthly_cta?.buckets || [];
  
          const monthWise = {};
          monthList.forEach((m) => (monthWise[m] = []));
          for (const b of buckets) {
            monthWise[b.key_as_string] = b.top_cta.buckets.map((cta) => ({
              cta: cta.key,
              count: cta.doc_count,
            }));
          }
  
          /* v8 ignore start -- relevantCtaIndexes covers exactly facebook/instagram/youtube; the non-matching branch is unreachable */
          if (cfg.platform === "facebook") {
            totals.facebook.topCta = ctaList;
            totals.facebook.monthlyCta = monthWise;
          } else if (cfg.platform === "instagram") {
            totals.instagram.topCta = ctaList;
            totals.instagram.monthlyCta = monthWise;
          } else if (cfg.platform === "youtube") {
            totals.youtube.topCta = ctaList;
            totals.youtube.monthlyCta = monthWise;
          }
          /* v8 ignore stop */
        });
  
        await Promise.all([
          Promise.all(countryStatsPromises),
          Promise.all(positionStatsPromises),
          Promise.all(ctaStatsPromises),
        ]);
      }
  
      return res.send(
        Response.userSuccessResp("Stats fetched successfully", totals)
      );
    } catch (error) {
      logger.error("Error in fetching the frequent country, ad position, and CTA details", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getAverageBudgetByData(req, res) {
    //
    try {
      const competitor = req?.body?.competitors;  
      const startDate = req?.body?.startDate;
      const endDate = req?.body?.endDate;
      
    
      
      if (!competitor) { 
        logger.error('Missing competitors in request body');
        return res.send(Response.validationFailResp('Missing competitors in request body', ''));
      }

      // Convert date format from dd-MM-yyyy to yyyy-MM-dd HH:mm:ss if dates are provided
      let esStartDate, esEndDate;
      if (startDate && endDate) {
        const convertDateFormat = (dateStr) => {
          const [day, month, year] = dateStr.split('-');
          return `${year}-${month}-${day} 00:00:00`;
        };
        esStartDate = convertDateFormat(startDate);
        esEndDate = convertDateFormat(endDate).replace('00:00:00', '23:59:59');
     
      }

      const budgetConfigs = [
        {
          index: 'search_mix',
          platform: 'facebook',
          advertiserField: 'facebook_ad_post_owners.post_owner_name',
          budgetField: 'facebook.averagebudget',
          dateFields: [
            'facebook_ad.post_date', 
            'facebook_ad_meta_data.firstSeenOnDesktop',
            'facebook_ad_meta_data.firstSeenOnIos',
            'facebook_ad_meta_data.firstSeenOnAndroid',
          ],
        },
        {
          index: 'instagram_search_mix',
          platform: 'instagram',
          advertiserField: 'instagram_ad_post_owners.post_owner_name',
          budgetField: 'instagram.averagebudget',
          dateFields: [
            'instagram_ad_post_date',
            'instagram_ad_meta_data.firstSeenOnDesktop',
            'instagram_ad_meta_data.firstSeenOnIos',
            'instagram_ad_meta_data.firstSeenOnAndroid',
          ],
        },
      ];

      const totals = {
        facebook: { monthly: {}, daily: {}, yearly: {} },
        instagram: { monthly: {}, daily: {}, yearly: {} },
      };
      const counts = {
        facebook: { monthly: {}, daily: {}, yearly: {} },
        instagram: { monthly: {}, daily: {}, yearly: {} },
      };

      const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
      ];

      // Initialize monthly
      monthNames.forEach(m => {
        totals.facebook.monthly[m] = 0;  counts.facebook.monthly[m] = 0;
        totals.instagram.monthly[m] = 0; counts.instagram.monthly[m] = 0;
      });

      // Initialize daily
      for (let d = 1; d <= 31; d++) {
        totals.facebook.daily[d] = 0;  counts.facebook.daily[d] = 0;
        totals.instagram.daily[d] = 0; counts.instagram.daily[d] = 0;
      }

      // Initialize yearly (last 11 years)
      const currentYear = new Date().getFullYear();
      for (let y = currentYear - 10; y <= currentYear; y++) {
        totals.facebook.yearly[y] = 0;  counts.facebook.yearly[y] = 0;
        totals.instagram.yearly[y] = 0; counts.instagram.yearly[y] = 0;
      }

      // Updated scripts with date range filtering
      const monthScript = startDate && endDate ? `
        def fields = params.fields;
        def startDate = params.startDate;
        def endDate = params.endDate;
        
        for (int i = 0; i < fields.size(); i++) {
          def field = fields[i];
          def fieldValue = params._source[field];
          if (fieldValue != null) {
            def dateStr = fieldValue.toString().trim();
            if (dateStr.length() >= 19 && !dateStr.equals("null")) {
              if (dateStr.compareTo(startDate) >= 0 && dateStr.compareTo(endDate) <= 0) {
                return dateStr.substring(0, 7);
              }
            }
          }
        }
        return "no_date";
      ` : `
        def fields = params.fields;
        for (int i = 0; i < fields.size(); i++) {
          def field = fields[i];
          def fieldValue = params._source[field];
          if (fieldValue != null) {
            def dateStr = fieldValue.toString().trim();
            if (dateStr.length() >= 10 && !dateStr.equals("null")) {
              return dateStr.substring(0, 7);
            }
          }
        }
        return "no_date";
      `;

      const dayScript = startDate && endDate ? `
        def fields = params.fields;
        def startDate = params.startDate;
        def endDate = params.endDate;
        
        for (int i = 0; i < fields.size(); i++) {
          def field = fields[i];
          def fieldValue = params._source[field];
          if (fieldValue != null) {
            def dateStr = fieldValue.toString().trim();
            if (dateStr.length() >= 19 && !dateStr.equals("null")) {
              if (dateStr.compareTo(startDate) >= 0 && dateStr.compareTo(endDate) <= 0) {
                try {
                  def dayStr = dateStr.substring(8, 10);
                  return Integer.parseInt(dayStr);
                } catch (Exception e) {
                }
              }
            }
          }
        }
        return 0;
      ` : `
        def fields = params.fields;
        for (int i = 0; i < fields.size(); i++) {
          def field = fields[i];
          def fieldValue = params._source[field];
          if (fieldValue != null) {
            def dateStr = fieldValue.toString().trim();
            if (dateStr.length() >= 10 && !dateStr.equals("null")) {
              try {
                def dayStr = dateStr.substring(8, 10);
                return Integer.parseInt(dayStr);
              } catch (Exception e) {
              }
            }
          }
        }
        return 0;
      `;

      const yearScript = startDate && endDate ? `
        def fields = params.fields;
        def startDate = params.startDate;
        def endDate = params.endDate;
        
        for (int i = 0; i < fields.size(); i++) {
          def field = fields[i];
          def fieldValue = params._source[field];
          if (fieldValue != null) {
            def dateStr = fieldValue.toString().trim();
            if (dateStr.length() >= 19 && !dateStr.equals("null")) {
              if (dateStr.compareTo(startDate) >= 0 && dateStr.compareTo(endDate) <= 0) {
                try {
                  return Integer.parseInt(dateStr.substring(0, 4));
                } catch (Exception e) {
                }
              }
            }
          }
        }
        return 0;
      ` : `
        def fields = params.fields;
        for (int i = 0; i < fields.size(); i++) {
          def field = fields[i];
          def fieldValue = params._source[field];
          if (fieldValue != null) {
            def dateStr = fieldValue.toString().trim();
            if (dateStr.length() >= 4 && !dateStr.equals("null")) {
              try {
                return Integer.parseInt(dateStr.substring(0, 4));
              } catch (Exception e) {
              }
            }
          }
        }
        return 0;
      `;

      const processPromises = [];

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
     

        const relevant = budgetConfigs.filter(c => serverData.indexes.includes(c.index));
        if (!relevant.length) continue;

        for (const cfg of relevant) {
          const processPromise = (async () => {
            try {
             
              
              // Build base query with or without date range
              let baseQuery;
              if (startDate && endDate) {
                // With date range
                baseQuery = {
                  bool: {
                    must: [
                      { match_phrase: { [cfg.advertiserField]: competitor } },
                      { exists: { field: cfg.budgetField } },
                      {
                        bool: {
                          should: cfg.dateFields.map(field => ({
                            range: {
                              [field]: {
                                gte: esStartDate,
                                lte: esEndDate
                              }
                            }
                          }))
                        }
                      }
                    ]
                  }
                };
              } else {
                // Without date range (original behavior)
                baseQuery = {
                  bool: {
                    must: [
                      { match_phrase: { [cfg.advertiserField]: competitor } },
                      { exists: { field: cfg.budgetField } },
                    ],
                    filter: {
                      bool: {
                        should: cfg.dateFields.map(field => ({
                          exists: { field: field }
                        }))
                      }
                    }
                  }
                };
              }

             

              const existsRes = await client.count({
                index: cfg.index,
                body: {
                  query: baseQuery
                },
              }).catch(err => {
                console.error("[ERROR] Count query failed for", cfg.platform, err);
                logger.error("[ERROR] Count query failed for", err);
                return { count: 0 };
              });

              const totalDocs = existsRes.count;
           
              if (!totalDocs) {
            
                return;
              }

              // Build script parameters
              const scriptParams = startDate && endDate ? 
                { 
                  fields: cfg.dateFields,
                  startDate: esStartDate,
                  endDate: esEndDate
                } : 
                { fields: cfg.dateFields };

             

              // === MONTHLY ===
              const monthlyBody = {
                size: 0,
                query: baseQuery,
                aggs: {
                  by_month: {
                    terms: {
                      script: {
                        lang: 'painless',
                        source: monthScript,
                        params: scriptParams
                      },
                      size: 200,
                      min_doc_count: 1 
                    },
                    aggs: {
                      avg_budget: { avg: { field: cfg.budgetField } }
                    }
                  }
                }
              };

             
              const monthlyRes = await client.search({ 
                index: cfg.index, 
                body: monthlyBody,
                requestTimeout: 30000 
              }).catch(err => {
                console.error("[ERROR] Monthly aggregation failed for", cfg.platform, err);
                logger.error("[ERROR] Monthly aggregation failed:", err);
                return { aggregations: { by_month: { buckets: [] } } };
              });
              
              const monthBuckets = monthlyRes.aggregations?.by_month?.buckets || [];
            

              for (const b of monthBuckets) {
                const monthKey = b.key;
                if (monthKey === "no_date" || monthKey === "1970-01") {
                
                  continue;
                }

                const monthName = this.monthKeyToName(monthKey);
                if (!monthName) {
             
                  continue;
                }

                const avg = b.avg_budget?.value || 0;
                const cnt = b.doc_count || 0;


                if (cnt > 0) {
                  const plat = cfg.platform;
                  const currentTotal = totals[plat].monthly[monthName] * counts[plat].monthly[monthName];
                  const newTotal = currentTotal + (avg * cnt);
                  counts[plat].monthly[monthName] += cnt;
                  /* v8 ignore next -- cnt>0 was just added to counts above, so the count is always > 0 here; the `: 0` branch is unreachable */
                  totals[plat].monthly[monthName] = counts[plat].monthly[monthName] > 0 ?
                    newTotal / counts[plat].monthly[monthName] : 0;
                }
              }

              // === DAILY ===
              const dailyBody = {
                size: 0,
                query: baseQuery,
                aggs: {
                  by_day: {
                    terms: {
                      script: {
                        lang: 'painless',
                        source: dayScript,
                        params: scriptParams
                      },
                      size: 31,
                      min_doc_count: 1
                    },
                    aggs: {
                      avg_budget: { avg: { field: cfg.budgetField } }
                    }
                  }
                }
              };

            
              const dailyRes = await client.search({ 
                index: cfg.index, 
                body: dailyBody,
                requestTimeout: 30000 
              }).catch(err => {
                console.error("[ERROR] Daily aggregation failed for", cfg.platform, err);
                logger.error("[ERROR] Daily aggregation failed:", err);
                return { aggregations: { by_day: { buckets: [] } } };
              });
              
              const dayBuckets = dailyRes.aggregations?.by_day?.buckets || [];
             

              for (const b of dayBuckets) {
                const day = Number(b.key);
                const avg = b.avg_budget?.value || 0;
                const cnt = b.doc_count || 0;

                if (day >= 1 && day <= 31 && cnt > 0) {
                  const plat = cfg.platform;
                  const currentTotal = totals[plat].daily[day] * counts[plat].daily[day];
                  const newTotal = currentTotal + (avg * cnt);
                  counts[plat].daily[day] += cnt;
                  /* v8 ignore next -- cnt>0 was just added to counts above, so the count is always > 0 here; the `: 0` branch is unreachable */
                  totals[plat].daily[day] = counts[plat].daily[day] > 0 ?
                    newTotal / counts[plat].daily[day] : 0;
                }
              }

              // === YEARLY ===
              const yearlyBody = {
                size: 0,
                query: baseQuery,
                aggs: {
                  by_year: {
                    terms: {
                      script: {
                        lang: 'painless',
                        source: yearScript,
                        params: scriptParams
                      },
                      size: 20,
                      min_doc_count: 1
                    },
                    aggs: {
                      avg_budget: { avg: { field: cfg.budgetField } }
                    }
                  }
                }
              };

              
              const yearlyRes = await client.search({ 
                index: cfg.index, 
                body: yearlyBody,
                requestTimeout: 30000 
              }).catch(err => {
                console.error("[ERROR] Yearly aggregation failed for", cfg.platform, err);
                logger.error("[ERROR] Yearly aggregation failed:", err);
                return { aggregations: { by_year: { buckets: [] } } };
              });

              const yearBuckets = yearlyRes.aggregations?.by_year?.buckets || [];
             

              for (const b of yearBuckets) {
                const year = Number(b.key);
                const avg = b.avg_budget?.value || 0;
                const cnt = b.doc_count || 0;

                if (year >= 2000 && cnt > 0) {
                  const plat = cfg.platform;
                  const currentTotal = totals[plat].yearly[year] * counts[plat].yearly[year];
                  const newTotal = currentTotal + (avg * cnt);
                  counts[plat].yearly[year] += cnt;
                  /* v8 ignore next -- cnt>0 was just added to counts above, so the count is always > 0 here; the `: 0` branch is unreachable */
                  totals[plat].yearly[year] = counts[plat].yearly[year] > 0
                    ? newTotal / counts[plat].yearly[year]
                    : 0;
                }
              }



            } catch (err) {
              console.error("[ERROR] Processing failed for platform:", err);
              logger.error("[ERROR] Processing failed:", err);
              if (err.meta?.body) {
                console.error("[ERROR] ES response body:", err.meta.body);
                logger.error("[ERROR] ES response body:", err.meta.body);
              }
            }
          })();

          processPromises.push(processPromise);
        }
      }

     
      await Promise.allSettled(processPromises);
   

      const roundValues = obj => Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, Math.round(v || 0)])
      );

      const payload = {
        facebook: {
          monthlyAverageBudget: roundValues(totals.facebook.monthly),
          dailyAverageBudget: roundValues(totals.facebook.daily),
          yearlyAverageBudget: roundValues(totals.facebook.yearly),
        },
        instagram: {
          monthlyAverageBudget: roundValues(totals.instagram.monthly),
          dailyAverageBudget: roundValues(totals.instagram.daily),
          yearlyAverageBudget: roundValues(totals.instagram.yearly),
        },
      };

   
      logger.info("[FINAL] Payload: " + JSON.stringify(payload, null, 2));

      return res.send(Response.userSuccessResp('Average budget fetched successfully', payload));
    } catch (err) {
      console.error("[FATAL] getAverageBudgetByData error:", err);
      logger.error("[FATAL] getAverageBudgetByData:", err);
      return res.send(Response.userFailResp('Internal server error', err.message));
    }
    //
  }

  monthKeyToName(key) {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    try {
      const [, month] = key.split('-').map(Number);
      return monthNames[month - 1] || null;
    } catch (e) {
      console.error("Error converting month key:", e);
      logger.error("error in number", e);
      return null;
    }
  }
  
  async getLongestAd(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }

      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
          searchFields: [
            "facebook_ad_post_owners.post_owner_name",
            "facebook_ad_post_owners.post_owner_name_ru",
            "facebook_ad_post_owners.post_owner_name_fr",
            "facebook_ad_post_owners.post_owner_name_sp",
            "facebook_ad_post_owners.post_owner_name_ge",
            "facebook_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "facebook_ad.days_running",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
          searchFields: [
            "instagram_ad_post_owners.post_owner_name",
            "instagram_ad_post_owners.post_owner_name_ru",
            "instagram_ad_post_owners.post_owner_name_fr",
            "instagram_ad_post_owners.post_owner_name_sp",
            "instagram_ad_post_owners.post_owner_name_ge",
            "instagram_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "instagram_ad.days_running",
        },
        {
          index: "youtube_ads_data",
          field: "post_owner",
          searchFields: ["post_owner"],
          sortField: "duration",
        },
        {
          index: "google_ads_data",
          field: "post_owner_name",
          searchFields: ["post_owner_name"],
          sortField: "days_running",
        },
      ];

      let totals = {
        facebook: {},
        instagram: {},
        youtube: {},
        google: {},
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];

        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );

        const longestAdPromises = relevantAdvertiserIndexes.map(
          async ({ index, field, searchFields, sortField }) => {
            try {
              const params = {
                index,
                body: {
                  size: 5,
                  sort: [
                    {
                      [sortField]: "desc",
                    },
                  ],
                  query: {
                    bool: {
                      must: [
                        {
                          query_string: {
                            fields: searchFields,
                            query: `(${competitor})`,
                            type: "phrase",
                            default_operator: "AND",
                            auto_generate_synonyms_phrase_query: false,
                          },
                        },
                      ],
                    },
                  },
                },
              };
              const result = await client.search(params);

              const longestAds =
                result.hits?.hits?.map((hit) => ({
                  ...hit._source,
                })) || [];

              /* v8 ignore start -- the per-server index list is exhaustively dispatched here; the non-matching branch is unreachable */
              if (index === "search_mix") {
                totals.facebook.longestRunningAds = longestAds;
              } else if (index === "instagram_search_mix") {
                totals.instagram.longestRunningAds = longestAds;
              } else if (index === "youtube_ads_data") {
                totals.youtube.longestRunningAds = longestAds;
              } else if (index === "google_ads_data") {
                totals.google.longestRunningAds = longestAds;
              }
              /* v8 ignore stop */
            } catch (error) {
              logger.error(`Error fetching longest ads for ${index}:`, error);
              return res.send(
                Response.userFailResp("Error fetching longest ads", error)
              );
            }
          }
        );

        await Promise.all([Promise.all(longestAdPromises)]);
      }

      return res.send(
        Response.userSuccessResp("Longest ad data fetched successfully", totals)
      );
    } catch (error) {
      logger.error("Error in fetching the running longest ad details", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getTopLikes(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }

      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
          searchFields: [
            "facebook_ad_post_owners.post_owner_name",
            "facebook_ad_post_owners.post_owner_name_ru",
            "facebook_ad_post_owners.post_owner_name_fr",
            "facebook_ad_post_owners.post_owner_name_sp",
            "facebook_ad_post_owners.post_owner_name_ge",
            "facebook_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "facebook_ad.likes",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
          searchFields: [
            "instagram_ad_post_owners.post_owner_name",
            "instagram_ad_post_owners.post_owner_name_ru",
            "instagram_ad_post_owners.post_owner_name_fr",
            "instagram_ad_post_owners.post_owner_name_sp",
            "instagram_ad_post_owners.post_owner_name_ge",
            "instagram_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "instagram_ad.likes",
        },
      ];

      let totals = {
        facebook: {},
        instagram: {},
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];

        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );

        const longestAdPromises = relevantAdvertiserIndexes.map(
          async ({ index, field, searchFields, sortField }) => {
            try {
              const params = {
                index,
                body: {
                  size: 5,
                  sort: [
                    {
                      [sortField]: "desc",
                    },
                  ],
                  query: {
                    bool: {
                      must: [
                        {
                          query_string: {
                            fields: searchFields,
                            query: `(${competitor})`,
                            type: "phrase",
                            default_operator: "AND",
                            auto_generate_synonyms_phrase_query: false,
                          },
                        },
                      ],
                    },
                  },
                },
              };
              const result = await client.search(params);

              const longestAds =
                result.hits?.hits?.map((hit) => ({
                  ...hit._source,
                })) || [];

              /* v8 ignore start -- relevant index list is exhaustively dispatched here; the non-matching branch is unreachable */
              if (index === "search_mix") {
                totals.facebook.topLikes = longestAds;
              } else if (index === "instagram_search_mix") {
                totals.instagram.topLikes = longestAds;
              }
              /* v8 ignore stop */
            } catch (error) {
              logger.error(`Error fetching top likes ${index}:`, error);
              return res.send(
                Response.userFailResp("Error fetching top likes", error)
              );
            }
          }
        );

        await Promise.all([Promise.all(longestAdPromises)]);
      }

      return res.send(
        Response.userSuccessResp(
          "Top liked ad data fetched successfully",
          totals
        )
      );
    } catch (error) {
      logger.error("Error in fetching the top liked ad details", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getTopComments(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }

      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
          searchFields: [
            "facebook_ad_post_owners.post_owner_name",
            "facebook_ad_post_owners.post_owner_name_ru",
            "facebook_ad_post_owners.post_owner_name_fr",
            "facebook_ad_post_owners.post_owner_name_sp",
            "facebook_ad_post_owners.post_owner_name_ge",
            "facebook_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "facebook_ad.comments",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
          searchFields: [
            "instagram_ad_post_owners.post_owner_name",
            "instagram_ad_post_owners.post_owner_name_ru",
            "instagram_ad_post_owners.post_owner_name_fr",
            "instagram_ad_post_owners.post_owner_name_sp",
            "instagram_ad_post_owners.post_owner_name_ge",
            "instagram_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "instagram_ad.comments",
        },
      ];

      let totals = {
        facebook: {},
        instagram: {},
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];

        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );

        const longestAdPromises = relevantAdvertiserIndexes.map(
          async ({ index, field, searchFields, sortField }) => {
            try {
              const params = {
                index,
                body: {
                  size: 5,
                  sort: [
                    {
                      [sortField]: "desc",
                    },
                  ],
                  query: {
                    bool: {
                      must: [
                        {
                          query_string: {
                            fields: searchFields,
                            query: `(${competitor})`,
                            type: "phrase",
                            default_operator: "AND",
                            auto_generate_synonyms_phrase_query: false,
                          },
                        },
                      ],
                    },
                  },
                },
              };
              const result = await client.search(params);

              const longestAds =
                result.hits?.hits?.map((hit) => ({
                  ...hit._source,
                })) || [];

              /* v8 ignore start -- relevant index list is exhaustively dispatched here; the non-matching branch is unreachable */
              if (index === "search_mix") {
                totals.facebook.topComments = longestAds;
              } else if (index === "instagram_search_mix") {
                totals.instagram.topComments = longestAds;
              }
              /* v8 ignore stop */
            } catch (error) {
              logger.error(`Error fetching top commments ${index}:`, error);
              return res.send(
                Response.userFailResp("Error fetching top commments", error)
              );
            }
          }
        );

        await Promise.all([Promise.all(longestAdPromises)]);
      }

      return res.send(
        Response.userSuccessResp(
          "Top commmented ad data fetched successfully",
          totals
        )
      );
    } catch (error) {
      logger.error("Error in fetching the top commmented ad details", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getTopImpressions(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }

      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
          searchFields: [
            "facebook_ad_post_owners.post_owner_name",
            "facebook_ad_post_owners.post_owner_name_ru",
            "facebook_ad_post_owners.post_owner_name_fr",
            "facebook_ad_post_owners.post_owner_name_sp",
            "facebook_ad_post_owners.post_owner_name_ge",
            "facebook_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "facebook_ad.impression",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
          searchFields: [
            "instagram_ad_post_owners.post_owner_name",
            "instagram_ad_post_owners.post_owner_name_ru",
            "instagram_ad_post_owners.post_owner_name_fr",
            "instagram_ad_post_owners.post_owner_name_sp",
            "instagram_ad_post_owners.post_owner_name_ge",
            "instagram_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "instagram_ad.impression",
        },
      ];

      let totals = {
        facebook: {},
        instagram: {},
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];

        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );

        const longestAdPromises = relevantAdvertiserIndexes.map(
          async ({ index, field, searchFields, sortField }) => {
            try {
              const params = {
                index,
                body: {
                  size: 5,
                  sort: [
                    {
                      [sortField]: "desc",
                    },
                  ],
                  query: {
                    bool: {
                      must: [
                        {
                          query_string: {
                            fields: searchFields,
                            query: `(${competitor})`,
                            type: "phrase",
                            default_operator: "AND",
                            auto_generate_synonyms_phrase_query: false,
                          },
                        },
                      ],
                    },
                  },
                },
              };
              const result = await client.search(params);

              const longestAds =
                result.hits?.hits?.map((hit) => ({
                  ...hit._source,
                })) || [];

              /* v8 ignore start -- relevant index list is exhaustively dispatched here; the non-matching branch is unreachable */
              if (index === "search_mix") {
                totals.facebook.topImpressions = longestAds;
              } else if (index === "instagram_search_mix") {
                totals.instagram.topImpressions = longestAds;
              }
              /* v8 ignore stop */
            } catch (error) {
              logger.error(`Error fetching top impression ${index}:`, error);
              return res.send(
                Response.userFailResp("Error fetching top impression", error)
              );
            }
          }
        );

        await Promise.all([Promise.all(longestAdPromises)]);
      }

      return res.send(
        Response.userSuccessResp(
          "Top impression ad data fetched successfully",
          totals
        )
      );
    } catch (error) {
      logger.error("Error in fetching the top impression ad details", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getTopPopularity(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }

      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
          searchFields: [
            "facebook_ad_post_owners.post_owner_name",
            "facebook_ad_post_owners.post_owner_name_ru",
            "facebook_ad_post_owners.post_owner_name_fr",
            "facebook_ad_post_owners.post_owner_name_sp",
            "facebook_ad_post_owners.post_owner_name_ge",
            "facebook_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "facebook_ad.popularity.current",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
          searchFields: [
            "instagram_ad_post_owners.post_owner_name",
            "instagram_ad_post_owners.post_owner_name_ru",
            "instagram_ad_post_owners.post_owner_name_fr",
            "instagram_ad_post_owners.post_owner_name_sp",
            "instagram_ad_post_owners.post_owner_name_ge",
            "instagram_ad_post_owners.post_owner_name_exactly",
          ],
          sortField: "instagram_ad.popularity.current",
        },
      ];

      let totals = {
        facebook: {},
        instagram: {},
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];

        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );

        const longestAdPromises = relevantAdvertiserIndexes.map(
          async ({ index, field, searchFields, sortField }) => {
            try {
              const params = {
                index,
                body: {
                  size: 5,
                  sort: [
                    {
                      [sortField]: "desc",
                    },
                  ],
                  query: {
                    bool: {
                      must: [
                        {
                          query_string: {
                            fields: searchFields,
                            query: `(${competitor})`,
                            type: "phrase",
                            default_operator: "AND",
                            auto_generate_synonyms_phrase_query: false,
                          },
                        },
                      ],
                    },
                  },
                },
              };
              const result = await client.search(params);

              const longestAds =
                result.hits?.hits?.map((hit) => ({
                  ...hit._source,
                })) || [];

              /* v8 ignore start -- relevant index list is exhaustively dispatched here; the non-matching branch is unreachable */
              if (index === "search_mix") {
                totals.facebook.topPopularity = longestAds;
              } else if (index === "instagram_search_mix") {
                totals.instagram.topPopularity = longestAds;
              }
              /* v8 ignore stop */
            } catch (error) {
              logger.error(`Error fetching top popularity ${index}:`, error);
              return res.send(
                Response.userFailResp("Error fetching top popularity", error)
              );
            }
          }
        );

        await Promise.all([Promise.all(longestAdPromises)]);
      }

      return res.send(
        Response.userSuccessResp(
          "Top popularity ad data fetched successfully",
          totals
        )
      );
    } catch (error) {
      logger.error("Error in fetching the top popularity ad details", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  async getAdCount(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }
  
      // Elasticsearch index configurations
      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
          searchFields: [
            "facebook_ad_post_owners.post_owner_name",
            "facebook_ad_post_owners.post_owner_name_ru",
            "facebook_ad_post_owners.post_owner_name_fr",
            "facebook_ad_post_owners.post_owner_name_sp",
            "facebook_ad_post_owners.post_owner_name_ge",
            "facebook_ad_post_owners.post_owner_name_exactly",
          ],
          dateFields: [
            "facebook_ad_meta_data.firstSeenOnIos",
            "facebook_ad_meta_data.firstSeenOnAndroid",
            "facebook_ad_meta_data.firstSeenOnDesktop",
            "facebook_ad.post_date"
          ],
          platform: "facebook"
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
          searchFields: [
            "instagram_ad_post_owners.post_owner_name",
            "instagram_ad_post_owners.post_owner_name_ru",
            "instagram_ad_post_owners.post_owner_name_fr",
            "instagram_ad_post_owners.post_owner_name_sp",
            "instagram_ad_post_owners.post_owner_name_ge",
            "instagram_ad_post_owners.post_owner_name_exactly",
          ],
          dateFields: [
            "instagram_ad_meta_data.firstSeenOnIos",
            "instagram_ad_meta_data.firstSeenOnAndroid",
            "instagram_ad_meta_data.firstSeenOnDesktop",
            "instagram_ad.post_date"
          ],
          platform: "instagram"
        },
        {
          index: "google_ads_data",
          field: "post_owner_name",
          searchFields: ["post_owner_name"],
          dateFields: [
            "firstSeenOnIos",
            "firstSeenOnAndroid",
            "firstSeenOnDesktop",
          ],
          platform: "google"
        },
      ];
  
      // Initialize result object
      const monthlyTotals = {
        facebook: {},
        instagram: {},
        youtube: {},
        google: {}
      };
  
      const monthList = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];

      // Media gate — same EXTRA_CONDITION the search builders apply, so the
      // monthly counts match what users actually SEE (no-media / placeholder
      // ads and Google organic results are excluded). Exists-based, no
      // `*PowerAdspy*` wildcard — mirrors the builders / fixed dashboardService.
      const mediaFilterFor = (index) => {
        if (index === "search_mix") {
          return { filter: [{ bool: { should: [
            { bool: { filter: [{ term: { "facebook_ad.type.keyword": "IMAGE" } }, { exists: { field: "new_nas_image_url" } }] } },
            { bool: { filter: [{ term: { "facebook_ad.type.keyword": "VIDEO" } }, { exists: { field: "Thumbnail" } }] } },
            { bool: { must_not: [{ terms: { "facebook_ad.type.keyword": ["IMAGE", "VIDEO"] } }] } },
          ], minimum_should_match: 1 } }], mustNot: [] };
        }
        if (index === "instagram_search_mix") {
          return { filter: [{ bool: { should: [
            { bool: { filter: [{ terms: { "instagram_ad.type.keyword": ["IMAGE", "STORIES"] } }, { exists: { field: "new_nas_image_url" } }] } },
            { bool: { filter: [{ term: { "instagram_ad.type.keyword": "VIDEO" } }, { exists: { field: "thumbnail" } }] } },
            { bool: { must_not: [{ terms: { "instagram_ad.type.keyword": ["IMAGE", "VIDEO", "STORIES"] } }] } },
          ], minimum_should_match: 1 } }], mustNot: [] };
        }
        /* v8 ignore next -- search_mix/instagram return earlier, so this if is only evaluated for google (always true); getAdCount's config has no youtube, so the false branch is unreachable */
        if (index === "google_ads_data") {
          return { filter: [], mustNot: [
            { bool: { filter: [{ term: { type: "IMAGE" } }, { bool: { should: [
              { bool: { must_not: [{ exists: { field: "new_nas_image_url" } }] } },
              { term: { "new_nas_image_url.keyword": "" } },
            ], minimum_should_match: 1 } }] } },
            { match_phrase: { type: "ORGANIC SEARCH" } },
          ] };
        }
        /* v8 ignore next -- getAdCount's advertiserIndexConfigs has no youtube entry, so no index falls through to this default */
        return { filter: [], mustNot: [] };
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
  
        const relevantIndexes = advertiserIndexConfigs.filter(cfg =>
          serverData.indexes.includes(cfg.index)
        );
  
        const aggPromises = relevantIndexes.map(async ({ index, searchFields, dateFields, platform }) => {
          try {
            // Build script for sequential date fallback
            const scriptSource = dateFields
              .map(f => `doc['${f}'].size()!=0 ? doc['${f}'].value : null`)
              .join(" ?: ");
  
            const media = mediaFilterFor(index);

            // Elasticsearch query
            const body = {
              size: 0,
              query: {
                bool: {
                  must: [
                    {
                      query_string: {
                        fields: searchFields,
                        query: `(${competitor})`,
                        type: "phrase",
                        default_operator: "AND",
                        auto_generate_synonyms_phrase_query: false
                      }
                    }
                  ],
                  ...(media.filter.length  && { filter:   media.filter }),
                  ...(media.mustNot.length && { must_not: media.mustNot }),
                }
              },
              aggs: {
                monthly_ads: {
                  date_histogram: {
                    interval: "month",
                    format: "MMMM",
                    time_zone: "+05:30",
                    min_doc_count: 1,
                    script: {
                      lang: "painless",
                      source: scriptSource
                    }
                  }
                }
              }
            };
  
            const result = await client.search({ index, body });
            const buckets = result.aggregations?.monthly_ads?.buckets || [];
  
            // Initialize month counts to 0
            const monthCounts = {};
            monthList.forEach(month => { monthCounts[month] = 0; });
  
            // Accumulate counts for each month
            for (const bucket of buckets) {
              monthCounts[bucket.key_as_string] += bucket.doc_count;
            }
  
            /* v8 ignore next -- every advertiserIndexConfig sets a platform and monthlyTotals is pre-initialised for all of them, so this is always true */
            if (platform && monthlyTotals[platform]) {
              monthlyTotals[platform] = monthCounts;
            }
  
          } catch (err) {
            logger.error(`Error fetching monthly ad count from ${index}:`, err);
            return res.send(Response.userFailResp(`Error fetching data for ${index}`, err));
          }
        });
  
        await Promise.all(aggPromises);
      }
  
      return res.send(
        Response.userSuccessResp("Monthly ad count fetched successfully", monthlyTotals)
      );
  
    } catch (error) {
      logger.error("Error in getAdCount", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }
  
  
  

  async getAdType(req, res) {
    try {
      const competitor = req?.body?.competitors;
      if (!competitor) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing competitors in request body", "")
        );
      }

      const advertiserIndexConfigs = [
        {
          index: "search_mix",
          field: "facebook_ad_post_owners.post_owner_name",
        },
        {
          index: "instagram_search_mix",
          field: "instagram_ad_post_owners.post_owner_name",
        },
        { index: "youtube_ads_data", field: "post_owner" },
        { index: "google_ads_data", field: "post_owner_name" },
      ];

      const indexConfigs = [
        { index: "search_mix", field: "facebook_ad.type" },
        { index: "instagram_search_mix", field: "instagram_ad.type" },
        { index: "youtube_ads_data", field: "ad_type" },
        { index: "google_ads_data", field: "type" },
      ];

      let totals = {
        imageAdsCount: 0,
        videoAdsCount: 0,
        textAdsCount: 0,
      };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
        const relevantAdvertiserIndexes = advertiserIndexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );
        const relevantTypeIndexes = indexConfigs.filter((cfg) =>
          serverData.indexes.includes(cfg.index)
        );

        const imagePromises = relevantTypeIndexes
          .map(({ index, field }) => {
            const advertiserField = advertiserIndexConfigs.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- relevantTypeIndexes is a subset of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return null;

            return client.count({
              index,
              body: {
                query: {
                  bool: {
                    must: [
                      {
                        query_string: {
                          fields: [advertiserField],
                          query: `"${competitor}"`,
                          default_operator: "AND",
                          auto_generate_synonyms_phrase_query: false,
                          type: "phrase",
                        },
                      },
                    ],
                    filter: [
                      {
                        bool: {
                          must: [
                            {
                              query_string: {
                                default_field: field,
                                query: "(IMAGE)",
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            });
          })
          .filter(Boolean);

        const videoPromises = relevantTypeIndexes
          .map(({ index, field }) => {
            const advertiserField = advertiserIndexConfigs.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- relevantTypeIndexes is a subset of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return null;

            return client.count({
              index,
              body: {
                query: {
                  bool: {
                    must: [
                      {
                        query_string: {
                          fields: [advertiserField],
                          query: `"${competitor}"`,
                          default_operator: "AND",
                          auto_generate_synonyms_phrase_query: false,
                          type: "phrase",
                        },
                      },
                    ],
                    filter: [
                      {
                        bool: {
                          must: [
                            {
                              query_string: {
                                default_field: field,
                                query: "(VIDEO)",
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            });
          })
          .filter(Boolean);

        const textPromises = relevantTypeIndexes
          .map(({ index, field }) => {
            const advertiserField = advertiserIndexConfigs.find(
              (cfg) => cfg.index === index
            )?.field;
            /* v8 ignore next -- relevantTypeIndexes is a subset of advertiserIndexConfigs, so advertiserField is always resolved here */
            if (!advertiserField) return null;

            return client.count({
              index,
              body: {
                query: {
                  bool: {
                    must: [
                      {
                        query_string: {
                          fields: [advertiserField],
                          query: `"${competitor}"`,
                          default_operator: "AND",
                          auto_generate_synonyms_phrase_query: false,
                          type: "phrase",
                        },
                      },
                    ],
                    filter: [
                      {
                        bool: {
                          must: [
                            {
                              query_string: {
                                default_field: field,
                                query: "(TEXT)",
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            });
          })
          .filter(Boolean);


        const [
          imageResults,
          videoResults,
          textResults,
        ] = await Promise.all([
          Promise.all(imagePromises),
          Promise.all(videoPromises),
          Promise.all(textPromises),
        ]);


        const sumCounts = (results) =>
          results.reduce((sum, r) => sum + (r?.count || 0), 0);

        totals.imageAdsCount += sumCounts(imageResults);
        totals.videoAdsCount += sumCounts(videoResults);
        totals.textAdsCount += sumCounts(textResults);


      }


      return res.send(
        Response.userSuccessResp("Counts fetched successfully", {
          ...totals,
        })
      );
    } catch (error) {
      logger.error("Error in fetching the ad type count details", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }
}

export default new AdvertiserService();