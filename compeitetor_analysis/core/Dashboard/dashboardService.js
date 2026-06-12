import logger from "../../resources/logs/logger.log.js";
import axios from 'axios';
import Response from "../../utils/response.js";
import config from "config";
import Competitors_request from '../../models/competitors_request.js';
import Backlink from '../../models/backlink.js';
import Organic_search from '../../models/organic_search.js';
import Paid_search from "../../models/paid_search.js";
import Competitors from '../../models/competitors.js';
import User_details from '../../models/user_details.js';
import { getAllCountries } from '../../models/countries.js';
// import {client} from '../../utils/Elasticsearch.js';
import { esClient,esServers, checkElasticsearchHealth } from "../../utils/Elasticsearch.js";
import elasticsearch from "elasticsearch";
import DashboardValidation from "./dashboardValidation.js";
import moment from "moment";
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// ES query alignment with pas_node_api search builders.
//
// Competitor counts/aggregations must match what the user sees in the Ads
// search UI for the same advertiser. The search builders apply three rules
// that the dashboard previously ignored:
//   1. NAS image filter (FB/IG) and the IMAGE-without-NAS exclusion (Google).
//   2. Multi-field post-owner-name matching (multilingual + prefix fallback).
//   3. Deduplication by ad ID via collapse / cardinality.
// The constants and helpers below mirror those rules and are reused by both
// getCompetitorsCount and getCompetitorsCountNew.
// ─────────────────────────────────────────────────────────────────────────────

const FB_NAS_FILTER = {
  bool: {
    should: [
      { bool: { filter: [
        { term:     { 'facebook_ad.type.keyword': 'IMAGE' } },
        { exists:   { field: 'new_nas_image_url' } },
        { wildcard: { 'new_nas_image_url.keyword': '*PowerAdspy*' } },
      ]}},
      { bool: { filter: [
        { term:     { 'facebook_ad.type.keyword': 'VIDEO' } },
        { exists:   { field: 'Thumbnail' } },
        { wildcard: { 'Thumbnail.keyword': '*PowerAdspy*' } },
      ]}},
      { bool: { must_not: [
        { terms: { 'facebook_ad.type.keyword': ['IMAGE', 'VIDEO'] } },
      ]}},
    ],
    minimum_should_match: 1,
  },
};

const IG_NAS_FILTER = {
  bool: {
    should: [
      { bool: { filter: [
        { terms:    { 'instagram_ad.type.keyword': ['IMAGE', 'STORIES'] } },
        { exists:   { field: 'new_nas_image_url' } },
        { wildcard: { 'new_nas_image_url.keyword': '*PowerAdspy*' } },
      ]}},
      { bool: { filter: [
        { term:     { 'instagram_ad.type.keyword': 'VIDEO' } },
        { exists:   { field: 'thumbnail' } },
        { wildcard: { 'thumbnail.keyword': '*PowerAdspy*' } },
      ]}},
      { bool: { must_not: [
        { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'VIDEO', 'STORIES'] } },
      ]}},
    ],
    minimum_should_match: 1,
  },
};

const GOOGLE_NAS_MUST_NOT = {
  bool: {
    filter: [
      { term: { type: 'IMAGE' } },
      { bool: {
        should: [
          { bool: { must_not: [{ exists: { field: 'new_nas_image_url' } }] } },
          { term: { 'new_nas_image_url.keyword': '' } },
        ],
        minimum_should_match: 1,
      }},
    ],
  },
};

const NAS_FILTER_BY_INDEX = {
  search_mix:           { filter: FB_NAS_FILTER, must_not: [] },
  instagram_search_mix: { filter: IG_NAS_FILTER, must_not: [] },
  google_ads_data:      {
    filter: null,
    must_not: [
      GOOGLE_NAS_MUST_NOT,
      { match_phrase: { type: 'ORGANIC SEARCH' } },
    ],
  },
};

// Match the search builder's _getPostOwnerNameEnv exactly: phrase across
// multilingual variants OR prefix match on the base field.
const OWNER_FIELDS_BY_INDEX = {
  search_mix: {
    fields: [
      'facebook_ad_post_owners.post_owner_name',
      'facebook_ad_post_owners.post_owner_name_ru',
      'facebook_ad_post_owners.post_owner_name_fr',
      'facebook_ad_post_owners.post_owner_name_sp',
      'facebook_ad_post_owners.post_owner_name_ge',
      'facebook_ad_post_owners.post_owner_name_exactly',
    ],
    prefixField: 'facebook_ad_post_owners.post_owner_name',
  },
  instagram_search_mix: {
    fields: [
      'instagram_ad_post_owners.post_owner_name',
      'instagram_ad_post_owners.post_owner_name_ru',
      'instagram_ad_post_owners.post_owner_name_fr',
      'instagram_ad_post_owners.post_owner_name_sp',
      'instagram_ad_post_owners.post_owner_name_ge',
      'instagram_ad_post_owners.post_owner_name_exactly',
    ],
    prefixField: 'instagram_ad_post_owners.post_owner_name',
  },
  google_ads_data: {
    fields: ['post_owner_name'],
    prefixField: 'post_owner_name',
  },
};

// Ad ID field per index for cardinality dedup — mirrors the `collapse`
// applied by each search builder.
const AD_ID_FIELD_BY_INDEX = {
  search_mix:           'facebook_ad.id',
  instagram_search_mix: 'instagram_ad.id',
  google_ads_data:      'id',
};

function buildOwnerClause(index, competitor) {
  const cfg = OWNER_FIELDS_BY_INDEX[index];
  if (!cfg) {
    return { match_phrase: { post_owner_name: competitor } };
  }
  return {
    bool: {
      should: [
        { multi_match: { query: competitor, type: 'phrase', fields: cfg.fields } },
        { prefix: { [cfg.prefixField]: String(competitor).toLowerCase() } },
      ],
      minimum_should_match: 1,
    },
  };
}

function nasClausesFor(index) {
  const nas = NAS_FILTER_BY_INDEX[index] || {};
  const filter = nas.filter ? [nas.filter] : [];
  const mustNot = Array.isArray(nas.must_not)
    ? nas.must_not
    : (nas.must_not ? [nas.must_not] : []);
  return { filter, mustNot };
}

// Returns the deduped (collapsed-by-ad-id) count of docs matching `boolQuery`.
// Falls back to client.count if the cardinality agg path errors.
async function dedupCount(client, index, boolQuery) {
  const idField = AD_ID_FIELD_BY_INDEX[index];
  try {
    const r = await client.search({
      index,
      size: 0,
      body: {
        query: { bool: boolQuery },
        aggs: {
          unique_ads: {
            cardinality: { field: idField, precision_threshold: 40000 },
          },
        },
      },
    });
    return r?.aggregations?.unique_ads?.value || 0;
  } catch (err) {
    const r = await client.count({ index, body: { query: { bool: boolQuery } } });
    return r?.count || 0;
  }
}

class DashboardService {
      constructor() {
       this.esClient = esClient;
       this.esServers = esServers;
      }

    async userProject(req, res){
        try{
            let data = req?.body;

            if (!data) {
                logger.error("Missing the user id in the body");
                return res.send(
                    Response.validationFailResp("Missing request data", "")
                );
            }

            let {user_id} = data;

            let userProjects;
            try {
                userProjects = await Competitors_request.find({user_id});
                
            } catch (err) {
                logger.error("database error during user id lookup", err);
                return res.send(
                    Response.userFailResp("Database error during user search for project", err)
                );
            }

            let projectName =  userProjects.map(project => project.advertiser[0]);
            
            let projectsData = userProjects.map(project => ({
                _id: project._id,                 // competitors_request._id → brand-cc project_id
                project_name: project.advertiser[0],
                competitors: project.competitors || [],
                monitoring: project.monitoring || []
            }));

            if(!projectName || projectName.length === 0) {
                return res.send(
                    Response.messageResp("No projects found by this user")
                );
            }

            return res.send(
                Response.userSuccessResp("Project name retrived successfully", {
                    project_name: projectName,
                    projects: projectsData
                })
            );
        }
        catch(err){
            logger.error("Unexpected error in userProject function", err);
            return res.send(
                Response.userFailResp("Unexpected error occurred", err)
            );
        }
    }


    async projectcompeitetor(req,res) {
        try{
           
            let data = req?.body;

            if (!data){
                logger.error("Missing the project name in the body");
                return res.send(
                    Response.validationFailResp("Missing the request params","")
                );

            }

            let {project_name,user_id,dashboard} = data;
    
            let projectName;
            try{
                projectName = await Competitors_request.findOne({user_id:new mongoose.Types.ObjectId(user_id),advertiser:project_name});
                

                if(!projectName.competitors || projectName.competitors.length === 0){
                    return res.send(
                        Response.messageResp("No competitors selected")
                    );
                }

                let monitoringStatus = projectName.monitoring;

                let competitors_data = await Competitors.find(
                    {_id:{$in:projectName.competitors}},
                    {competitor_name:1}
                ); 

                const MAX_FB_COMPETITORS = 5;
                if (dashboard === "FbDashboard") {
                  competitors_data = competitors_data.slice(0, MAX_FB_COMPETITORS);
                }
                let names = competitors_data.map(c => c.competitor_name);

                let cnames = competitors_data.reduce((acc, c) => {
                  if (monitoringStatus.includes(c._id)) {
                    acc[c.competitor_name] = {
                      id: c._id,
                      comp_request_id: projectName._id,
                      monitoring: true,
                    };
                  }
                  else{
                    acc[c.competitor_name] = {
                      id: c._id,
                      comp_request_id:projectName._id,
                      monitoring: false,
                    };
                  }
                  return acc;
                }, {});


const getAdvertiserAdCount = async (advertiser) => {
  let totalAdsCount = 0;
  const advertiserIndexConfigs = [
    { index: "search_mix", field:"facebook_ad_post_owners.post_owner_name"},
    {index: "instagram_search_mix", field:"instagram_ad_post_owners.post_owner_name" }
  ];

  for (const [serverName, serverData] of Object.entries(this.esServers)) {
    const client = this.esClient[serverName];

    const relevantIndexes = advertiserIndexConfigs.filter(cfg => 
      serverData.indexes.includes(cfg.index)
      );

      const countPromises = relevantIndexes.map(({index,field}) =>
      client.count({
        index,
        body: {
          query:{
            bool:{
              must: [
                {
                  query_string: {
                    fields: [field],
                    query: `"${advertiser}"`,
                    default_operator: "AND",
                    auto_generate_synonyms_phrase_query: false,
                  },
                },
              ],
            },
          }
        },
      })
       );

       const results = await Promise.all(countPromises);
       results.forEach(r => {
        totalAdsCount += r?.count || 0;
       });

      }
      return totalAdsCount;
      };

    const advertiserAdsCount = await getAdvertiserAdCount(project_name);

                return res.send(
                Response.userSuccessResp("Project name retrived successfully", { advertiser: project_name,advertiser_ads_count: advertiserAdsCount, competitor_names: names, comp_details: cnames})
                );
            } catch (err){
                logger.error("Unexpected error in Project name function", err);
                return res.send(
                    Response.failResp("Unexpected error occurred", err)
                );
            }
        } 
        catch(err){
            logger.error("unexpected error in compeitetor search function",err);
            return res.send(
                Response.failResp("unexpected error occured",err)
            );
        }
    }
  async projectcompeitetorClient(req, res) {
    try {
      const data = req?.body;

      if (!data) {
        logger.error("Missing request body");
        return res.send(
          Response.validationFailResp("Missing the request params", "")
        );
      }

      let {
        project_name,
        user_id,
        page = 1,
        limit = 10,
        search = ""
      } = data;

      page = parseInt(page);
      limit = parseInt(limit);

      if (!project_name || !user_id) {
        return res.send(
          Response.validationFailResp("Missing project_name or user_id", "")
        );
      }

      const skip = (page - 1) * limit;

      try {
        const projectName = await Competitors_request.findOne({
          user_id: new mongoose.Types.ObjectId(user_id),
          advertiser: project_name
        });

        if (!projectName) {
          return res.send(
            Response.messageResp("Project not found")
          );
        }

        if (!projectName.competitors || projectName.competitors.length === 0) {
          return res.send(
            Response.messageResp("No competitors selected")
          );
        }

        const monitoringStatus = projectName.monitoring || [];

         const competitorMatch = {
          _id: { $in: projectName.competitors }
        };

        if (search) {
          competitorMatch.competitor_name = {
            $regex: search,
            $options: "i" 
          };
        }
        // const totalCompetitors = projectName.competitors.length;
        const totalCompetitors = await Competitors.countDocuments(competitorMatch);
        const monitoringObjectIds = monitoringStatus.map(id => new mongoose.Types.ObjectId(id));
        const competitors_data = await Competitors.aggregate([
          { $match: competitorMatch},
          {
            $addFields: {
              is_monitored: { $in: ["$_id", monitoringObjectIds] }
            }
          },
          {
            $sort: { is_monitored: -1, competitor_name: 1 }
          },
          { $skip:skip},
          { $limit:limit},
          {
            $project: { competitor_name: 1, _id: 1 }
          }
        ]);

        const names = competitors_data.map(c => c.competitor_name);

        const cnames = competitors_data.reduce((acc, c) => {
          acc[c.competitor_name] = {
            id: c._id,
            comp_request_id: projectName._id,
            monitoring: monitoringStatus.includes(c._id)
          };
          return acc;
        }, {});

        const getAdvertiserAdCount = async (advertiser) => {
          let totalAdsCount = 0;

          const advertiserIndexConfigs = [
            { index: "search_mix", field: "facebook_ad_post_owners.post_owner_name" },
            { index: "instagram_search_mix", field: "instagram_ad_post_owners.post_owner_name" }
          ];

          for (const [serverName, serverData] of Object.entries(this.esServers)) {
            const client = this.esClient[serverName];

            const relevantIndexes = advertiserIndexConfigs.filter(cfg =>
              serverData.indexes.includes(cfg.index)
            );

            const countPromises = relevantIndexes.map(({ index, field }) =>
              client.count({
                index,
                body: {
                  query: {
                    bool: {
                      must: [
                        {
                          query_string: {
                            fields: [field],
                            query: `"${advertiser}"`,
                            default_operator: "AND",
                            auto_generate_synonyms_phrase_query: false
                          }
                        }
                      ]
                    }
                  }
                }
              })
            );

            const results = await Promise.all(countPromises);
            results.forEach(r => {
              totalAdsCount += r?.count || 0;
            });
          }

          return totalAdsCount;
        };

        const advertiserAdsCount = await getAdvertiserAdCount(project_name);

        return res.send(
          Response.userSuccessResp(
            "Project name retrieved successfully",
            {
              advertiser: project_name,
              advertiser_ads_count: advertiserAdsCount,
              competitor_names: names,
              comp_details: cnames,

              pagination: {
                total: totalCompetitors,
                page,
                limit,
                totalPages: Math.ceil(totalCompetitors / limit)
              }
            }
          )
        );
      } catch (err) {
        logger.error("Unexpected error in Project competitor function", err);
        return res.send(
          Response.failResp("Unexpected error occurred", err)
        );
      }
    } catch (err) {
      logger.error("Unexpected error in competitor search function", err);
      return res.send(
        Response.failResp("Unexpected error occurred", err)
      );
    }
  }

  async projectcompeitetorClientNew(req, res) {
    try {
      const data = req?.body;

      if (!data) {
        logger.error("Missing request body");
        return res.send(
          Response.validationFailResp("Missing the request params", "")
        );
      }

      let {
        project_name,
        user_id,
        page = 1,
        limit = 10,
        search = ""
      } = data;

      page = parseInt(page);
      limit = parseInt(limit);

      if (!project_name || !user_id) {
        return res.send(
          Response.validationFailResp("Missing project_name or user_id", "")
        );
      }

      const skip = (page - 1) * limit;

      // 1️Get user project
      const projectDoc = await Competitors_request.findOne({
        user_id: new mongoose.Types.ObjectId(user_id),
        advertiser: project_name
      }).lean();

      if (!projectDoc) {
        return res.send(
          Response.userSuccessResp("No competitors yet", {
            advertiser: project_name,
            competitor_names: [],
            comp_details: {},
            pagination: {
              total: 0,
              page,
              limit,
              totalPages: 0
            }
          })
        );
      }

      const competitorIds = projectDoc.competitors || [];
      const monitoredIds = projectDoc.monitoring || [];

      // 2️ Fetch competitor details from master
      const competitorDocs = await Competitors.find(
        { _id: { $in: competitorIds } },
        { competitor_name: 1, competitor_url: 1 }
      ).lean();

      // 3️ Monitoring set
      const monitoredSet = new Set(
        monitoredIds.map(id => id.toString())
      );

      // 4️ Merge
      let allMerged = competitorDocs.map(c => ({
        id: c._id,
        name: c.competitor_name,
        url: c.competitor_url,
        monitored: monitoredSet.has(c._id.toString())
      }));

      // 5️ Search
      if (search) {
        const regex = new RegExp(search, "i");
        allMerged = allMerged.filter(c => regex.test(c.name));
      }

      // 6️ Sort (monitored first → then name)
      allMerged.sort((a, b) => {
        if (a.monitored === b.monitored) {
          return a.name.localeCompare(b.name);
        }
        return a.monitored ? -1 : 1;
      });

      const totalCompetitors = allMerged.length;

      const paginated = allMerged.slice(skip, skip + limit);

      const competitor_names = paginated.map(c => c.name);

      // 7️ comp_details
      const comp_details = paginated.reduce((acc, c) => {
        acc[c.name] = {
          id: c.id,
          comp_request_id: projectDoc._id,
          monitoring: c.monitored,
          url: c.url
        };
        return acc;
      }, {});

      // 8️ ES advertiser ads count
      const getAdvertiserAdCount = async advertiser => {
        let totalAdsCount = 0;

        const advertiserIndexConfigs = [
          {
            index: "search_mix",
            field: "facebook_ad_post_owners.post_owner_name"
          },
          {
            index: "instagram_search_mix",
            field: "instagram_ad_post_owners.post_owner_name"
          }
        ];

        for (const [serverName, serverData] of Object.entries(this.esServers)) {
          const client = this.esClient[serverName];

          const relevantIndexes = advertiserIndexConfigs.filter(cfg =>
            serverData.indexes.includes(cfg.index)
          );

          const countPromises = relevantIndexes.map(({ index, field }) =>
            client.count({
              index,
              body: {
                query: {
                  bool: {
                    must: [
                      {
                        query_string: {
                          fields: [field],
                          query: `"${advertiser}"`,
                          default_operator: "AND",
                          auto_generate_synonyms_phrase_query: false
                        }
                      }
                    ]
                  }
                }
              }
            })
          );

          const results = await Promise.all(countPromises);

          results.forEach(r => {
            totalAdsCount += r?.count || 0;
          });
        }

        return totalAdsCount;
      };

      const advertiserAdsCount = await getAdvertiserAdCount(project_name);

      //  FINAL RESPONSE
      return res.send(
        Response.userSuccessResp("Project name retrieved successfully", {
          advertiser: project_name,
          advertiser_ads_count: advertiserAdsCount,
          competitor_names,
          comp_details,
          pagination: {
            total: totalCompetitors,
            page,
            limit,
            totalPages: Math.ceil(totalCompetitors / limit)
          }
        })
      );

    } catch (err) {
      logger.error("Unexpected error in projectcompeitetorClientNew", err);
      return res.send(
        Response.userFailResp("Unexpected error occurred", err)
      );
    }
  }
        async getplatformcount(req, res) {
          try {
          let data = req?.body;
          if (!data) {
                logger.error("missing the competitor name in the payload");
                return res.send(
                  Response.validationFailResp("missing the request data","")  
                );
            }

            let {competitorName} = data;
            let compName;
            try{
                const apiUrl =config.get("get_platform_count");

                let get_count = await axios.post(apiUrl, {
                    advertisername: competitorName,
                });

              
             let   platform_counts = get_count.data;
                 let total_counts = Object.values(platform_counts).reduce((sum, count) => sum+count,0);
                 return res.send(
                    Response.userSuccessResp("competitors count for all platform and total is displayed here",{
                        total_counts,platforms: platform_counts
                    })
                 );


            } catch (err) {
                logger.error("unexpected error in platform count function",err);
                return res.send(
                    Response.failResp("unexpected error occured",err)
                );
            }

        } catch(err){
            logger.error("unexpected error in get-ads-count in power-ads-spy",err);
            return res.send(
                Response.failResp("unexpected error occured",err)
            );
        }
    }


    async getCompetitorsCount(req, res) {
      try {
        let competitor = (req?.body?.competitors || "");
        if (!competitor) {
          return res.send(Response.validationFailResp("Missing competitors in request body", ""));
        }
    
        competitor = Array.isArray(competitor) ? competitor[0] : competitor;
        const advertiserIndexConfigs = [
          { index: 'search_mix', field: 'facebook_ad_post_owners.post_owner_name' },
          { index: 'instagram_search_mix', field: 'instagram_ad_post_owners.post_owner_name' },
          { index: 'google_ads_data', field: 'post_owner_name' }
        ];
    
        const countryIndexConfigs = [
          { index: 'search_mix', field: 'facebook_ad_post_owners.post_owner_name', countryField: 'country_only.country' },
          { index: 'instagram_search_mix', field: 'instagram_ad_post_owners.post_owner_name', countryField: 'instagram_country_only.country' },
          { index: 'google_ads_data', field: 'post_owner_name', countryField: 'country' }
        ];
    
        // Match the search builders: ads in a date bucket are those *last seen*
        // in that window — not just those first seen. Using firstSeenOn*
        // undercounts long-running ads that are still active "today".
        // See facebook/instagram/google SearchMixQueryBuilder._getLastSeenEnv.
        const dateFieldMap = {
          search_mix: ['facebook_ad.last_seen'],
          instagram_search_mix: ['instagram_ad.last_seen'],
          google_ads_data: ['last_seen']
        };
    
        const getRange = (duration) => {
          let start, end;
          if (duration === 'yesterday') {
            start = moment().subtract(1, 'day').startOf('day');
            end = moment().subtract(1, 'day').endOf('day');
          } else if (duration === 'today') {
            start = moment().startOf('day');
            end = moment();
          } else if (duration === 'week') {
            start = moment().subtract(7, 'days').startOf('day');
            end = moment().subtract(1, 'day').endOf('day');
          } else {
            start = moment().subtract(1, duration).startOf(duration);
            end = moment().subtract(1, duration).endOf(duration);
          }
          return {
            isoStart: start.format("YYYY-MM-DD HH:mm:ss"),
            isoEnd: end.format("YYYY-MM-DD HH:mm:ss")
          };
        };
    
        const ranges = {
          yesterday: getRange("yesterday"),
          today: getRange("today"),
          lastWeek: getRange("week"),
          lastMonth: getRange("month"),
          lastYear: getRange("year")
        };
    
        const totals = {
          competitorsCount: 0,
          yesterdayAdsCount: 0,
          todayAdsCount: 0,
          lastWeekAdsCount: 0,
          lastMonthAdsCount: 0,
          lastYearAdsCount: 0,
          platformCompetitorCount: { facebook: 0, instagram: 0, google: 0 },
          uniqueCountries: new Set()
        };
    
        let facebookStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };
        let instagramStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };
        let googleStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };

        /* ────────────────────── GLOBAL STATS (ALL DOCS) ────────────────────── */
        const fetchGlobalStatsES6 = async (client, index, ownerField, impField, popField, budField) => {
          const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
          const ownerClause = buildOwnerClause(index, competitor);
          const res = await client.search({
            index,
            size: 0,
            body: {
              query: {
                bool: {
                  must: [ownerClause],
                  ...(filterClauses.length  && { filter:   filterClauses }),
                  ...(mustNotClauses.length && { must_not: mustNotClauses }),
                },
              },
              aggs: {
                impressions: {
                  filter: { exists: { field: impField } },
                  aggs: {
                    total_imp: { sum: { field: impField } },
                    imp_count: { value_count: { field: impField } }
                  }
                },
                popularity: {
                  filter: { exists: { field: `${popField}.current` } },   
                
                  aggs: {
                    total_pop: {
                      sum: {
                        field: `${popField}.current`,   
                        missing: 0                      
                      }
                    },
                    pop_count: {
                      value_count: { field: `${popField}.current` }
                    }
                  }
                },
                budget: {
                  filter: { exists: { field: budField } },
                  aggs: {
                    // The index has NO stored "total budget" field — only a per-ad
                    // `averagebudget` (a single numeric per doc). We derive the
                    // total by summing those per-ad averages. The agg alias name
                    // makes the derivation explicit so it can't be mistaken for
                    // a field read.
                    sum_avg_budget: { sum: { field: budField } },
                    budget_count:   { value_count: { field: budField } },
                  },
                },
              },
            },
          });

          const a = res?.aggregations || {};

          const imp = a.impressions || {};
          const avgImpression = (imp.imp_count?.value || 0) > 0
            ? (imp.total_imp?.value || 0) / (imp.imp_count?.value || 0)
            : 0;

          const pop = a.popularity || {};
          const avgPopularity = (pop.pop_count?.value || 0) > 0
            ? (pop.total_pop?.value || 0) / (pop.pop_count?.value || 0)
            : 0;

          const bud = a.budget || {};
          // totalBudget = Σ(per-ad averagebudget) for ads on this platform.
          // No "total budget" field exists in the index; this is computed.
          const totalBudget = bud.sum_avg_budget?.value || 0;
          const avgBudget = (bud.budget_count?.value || 0) > 0
            ? totalBudget / (bud.budget_count?.value || 0)
            : 0;

          return {
            averageImpression: avgImpression,
            averagePopularity: avgPopularity,
            averageBudget: avgBudget,
            totalBudget,
          };
        };
    
       
        for (const [serverName, serverData] of Object.entries(this.esServers)) {
          const client = this.esClient[serverName];
    
          const relevantAdv = advertiserIndexConfigs.filter(c => serverData.indexes.includes(c.index));
          const relevantDate = Object.entries(dateFieldMap).filter(([i]) => serverData.indexes.includes(i));
          const relevantCntry = countryIndexConfigs.filter(c => serverData.indexes.includes(c.index));
    
          const index_to_platform = {
            'search_mix': 'facebook',
            'instagram_search_mix': 'instagram',
            'google_ads_data': 'google'
          };

          const countPromises = relevantAdv.map(({index}) => {
            const platform = index_to_platform[index] || 'undefined';
            const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
            const ownerClause = buildOwnerClause(index, competitor);
            return {
              platform,
              promise: dedupCount(client, index, {
                must: [ownerClause],
                ...(filterClauses.length  && { filter:   filterClauses }),
                ...(mustNotClauses.length && { must_not: mustNotClauses }),
              }),
            };
          });

          const countResults = await Promise.all(countPromises.map(p => p.promise));
          countResults.forEach((cnt, i) => {
            const plat = countPromises[i].platform;
            totals.platformCompetitorCount[plat] += cnt;
            totals.competitorsCount += cnt;
          });


          const countryPromises = relevantCntry.map(({index, countryField}) => {
            const finalField = `${countryField}.keyword`;
            const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
            const ownerClause = buildOwnerClause(index, competitor);
            return client.search({
              index,
              size: 0,
              body: {
                query: {
                  bool: {
                    must: [ownerClause],
                    ...(filterClauses.length  && { filter:   filterClauses }),
                    ...(mustNotClauses.length && { must_not: mustNotClauses }),
                  },
                },
                aggs: {
                  countries: { terms: { field: finalField, size: 1000 } }
                }
              }
            });
          });
    
          const countryRes = await Promise.all(countryPromises);
          countryRes.forEach(r => {
            (r?.aggregations?.countries?.buckets || []).forEach(b => {
              if (b.key) totals.uniqueCountries.add(b.key.toLowerCase());
            });
          });
    
          /* ────── Date-range Counts ────── */
          for (const [label, {isoStart, isoEnd}] of Object.entries(ranges)) {
            const datePromises = relevantDate.map(([idx, fields]) => {
              const rangeQ = fields.map(f => ({ range: { [f]: { gte: isoStart, lte: isoEnd } } }));
              const existsQ = fields.map(f => ({ exists: { field: f } }));

              const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(idx);
              const ownerClause = buildOwnerClause(idx, competitor);
              return dedupCount(client, idx, {
                must: [
                  ownerClause,
                  { bool: { should: rangeQ, minimum_should_match: 1 } },
                  { bool: { should: existsQ, minimum_should_match: 1 } },
                ],
                ...(filterClauses.length  && { filter:   filterClauses }),
                ...(mustNotClauses.length && { must_not: mustNotClauses }),
              });
            });

            const counts = await Promise.all(datePromises);
            totals[`${label}AdsCount`] += counts.reduce((a,b)=>a+b,0);
          }
    
       
          if (serverData.indexes.includes('search_mix')) {
            const fb = await fetchGlobalStatsES6(
              client,
              'search_mix',
              'facebook_ad_post_owners.post_owner_name',
              'facebook_ad.impression',
              'facebook_ad.popularity',
              'facebook.averagebudget'
            );
            facebookStats = { ...fb };
          }
    
          if (serverData.indexes.includes('instagram_search_mix')) {
            const ig = await fetchGlobalStatsES6(
              client,
              'instagram_search_mix',
              'instagram_ad_post_owners.post_owner_name',
              'instagram_ad.impression',
              'instagram_ad.popularity',
              'instagram.averagebudget'
            );
            instagramStats = { ...ig };
          }

          if (serverData.indexes.includes('google_ads_data')) {
            const gg = await fetchGlobalStatsES6(
              client,
              'google_ads_data',
              'post_owner_name',
              'impression',
              'popularity',
              'averagebudget'
            );
            googleStats = { ...gg };
          }
        }


        const getValidAverage = (fbVal, igVal, ggVal = 0) => {
          const values = [];
          if (fbVal > 0) values.push(fbVal);
          if (igVal > 0) values.push(igVal);
          if (ggVal > 0) values.push(ggVal);
          return values.length > 0
            ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
            : 0;
        };

        const avgImpression = getValidAverage(facebookStats.averageImpression, instagramStats.averageImpression, googleStats.averageImpression);
        const avgPopularity = getValidAverage(facebookStats.averagePopularity, instagramStats.averagePopularity, googleStats.averagePopularity);
        const avgBudget = getValidAverage(facebookStats.averageBudget, instagramStats.averageBudget, googleStats.averageBudget);
        // totalBudget is a real sum across platforms (not an average) — this is the
        // "Estimated Total Ad Budget" displayed in the dashboard.
        const totalBudget = Number(
          (
            (facebookStats.totalBudget || 0) +
            (instagramStats.totalBudget || 0) +
            (googleStats.totalBudget || 0)
          ).toFixed(2)
        );

        return res.send(Response.userSuccessResp("Counts fetched successfully", {
          ...totals,
          uniqueCountries: Array.from(totals.uniqueCountries),
          averageImpression: avgImpression,
          averagePopularity: avgPopularity,
          averageBudget: avgBudget,
          totalBudget,
        }));
    
      } catch (error) {
        console.error("Error fetching from Elasticsearch:", error);
        return res.send(Response.userFailResp("Internal server error", error));
      }
    }

    // Per-platform ad counts for a single advertiser/competitor name.
    // Mirrors getCompetitorsCount's logic (owner match, NAS filters, last_seen
    // range, ad-id dedup) but keeps the per-platform split (facebook /
    // instagram) and three buckets: all-time, today and yesterday.
    // All ES queries for the name are fired in parallel.
    // Returns { allTime:{facebook,instagram,total}, today:{...}, yesterday:{...} }.
    async getCompetitorAdStats(name) {
      const indexPlatform = {
        search_mix: 'facebook',
        instagram_search_mix: 'instagram',
      };
      const dateField = {
        search_mix: 'facebook_ad.last_seen',
        instagram_search_mix: 'instagram_ad.last_seen',
      };
      const FMT = "YYYY-MM-DD HH:mm:ss";
      const ranges = {
        today: {
          gte: moment().startOf('day').format(FMT),
          lte: moment().format(FMT),
        },
        yesterday: {
          gte: moment().subtract(1, 'day').startOf('day').format(FMT),
          lte: moment().subtract(1, 'day').endOf('day').format(FMT),
        },
        last7days: {
          // rolling 7 calendar days, today inclusive
          gte: moment().subtract(6, 'day').startOf('day').format(FMT),
          lte: moment().format(FMT),
        },
      };

      const blank = () => ({ facebook: 0, instagram: 0, total: 0 });
      const stats = { allTime: blank(), today: blank(), yesterday: blank(), last7days: blank() };

      const jobs = []; // { bucket, platform, promise }
      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
        for (const idx of Object.keys(indexPlatform)) {
          if (!serverData.indexes.includes(idx)) continue;
          const platform = indexPlatform[idx];
          const field = dateField[idx];
          const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(idx);
          const ownerClause = buildOwnerClause(idx, name);
          const buildQuery = (extraMust = []) => ({
            must: [ownerClause, ...extraMust],
            ...(filterClauses.length  && { filter:   filterClauses }),
            ...(mustNotClauses.length && { must_not: mustNotClauses }),
          });

          // all-time = owner match only (no date filter).
          jobs.push({ bucket: 'allTime', platform, promise: dedupCount(client, idx, buildQuery()) });
          // today / yesterday = owner match + last_seen in range.
          for (const [label, { gte, lte }] of Object.entries(ranges)) {
            jobs.push({
              bucket: label,
              platform,
              promise: dedupCount(client, idx, buildQuery([
                { range: { [field]: { gte, lte } } },
                { exists: { field } },
              ])),
            });
          }
        }
      }

      const results = await Promise.all(jobs.map(j => j.promise));
      results.forEach((cnt, i) => {
        const { bucket, platform } = jobs[i];
        stats[bucket][platform] += cnt;
        stats[bucket].total += cnt;
      });
      return stats;
    }

    // Dedup ad count for one competitor (by owner name) within a last_seen
    // window. Same ES pattern as getCompetitorAdStats but with a single
    // caller-supplied range — powers the per-brand "ads by competitor" chart's
    // date filter. gte/lte are "YYYY-MM-DD HH:mm:ss" strings; pass both as
    // null/empty for all-time (owner match only, no date filter).
    async getCompetitorAdCountForRange(name, gte, lte) {
      const indexPlatform = { search_mix: 'facebook', instagram_search_mix: 'instagram' };
      const dateField = { search_mix: 'facebook_ad.last_seen', instagram_search_mix: 'instagram_ad.last_seen' };
      const hasRange = Boolean(gte && lte);

      const jobs = []; // { platform, promise }
      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
        for (const idx of Object.keys(indexPlatform)) {
          if (!serverData.indexes.includes(idx)) continue;
          const field = dateField[idx];
          const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(idx);
          const ownerClause = buildOwnerClause(idx, name);
          const must = [ownerClause];
          if (hasRange) must.push({ range: { [field]: { gte, lte } } }, { exists: { field } });
          jobs.push({
            platform: indexPlatform[idx],
            promise: dedupCount(client, idx, {
              must,
              ...(filterClauses.length  && { filter:   filterClauses }),
              ...(mustNotClauses.length && { must_not: mustNotClauses }),
            }),
          });
        }
      }

      const results = await Promise.all(jobs.map(j => j.promise));
      const out = { facebook: 0, instagram: 0, total: 0 };
      results.forEach((cnt, i) => {
        out[jobs[i].platform] += cnt;
        out.total += cnt;
      });
      return out;
    }

    // POST /competitor-ads-by-range  Body: { request_id, from?, to?, all? }
    // Returns each competitor of that brand with its ad count in the window,
    // sorted desc. from/to are "YYYY-MM-DD" (default: last 30 days). When
    // all === true the date filter is dropped (all-time counts).
    async getCompetitorAdsByRange(req, res) {
      try {
        const { request_id, from, to, all } = req?.body || {};
        if (!request_id) {
          return res.send(Response.validationFailResp("Missing request_id in request body", ""));
        }

        const allTime = all === true || all === "true";
        const FMT = "YYYY-MM-DD HH:mm:ss";
        const gte = allTime ? null : (from ? moment(from, "YYYY-MM-DD", true) : moment().subtract(30, "days"))
          .startOf("day").format(FMT);
        const lte = allTime ? null : (to ? moment(to, "YYYY-MM-DD", true) : moment())
          .endOf("day").format(FMT);

        const reqDoc = await Competitors_request.findById(request_id, { competitors: 1 }).lean();
        if (!reqDoc) {
          return res.send(Response.userFailResp("Brand request not found", ""));
        }

        const competitorIds = Array.isArray(reqDoc.competitors) ? reqDoc.competitors : [];
        const compDocs = competitorIds.length
          ? await Competitors.find(
              { _id: { $in: competitorIds } },
              { competitor_name: 1, competitor_url: 1 }
            ).lean()
          : [];

        const competitors = await Promise.all(
          compDocs.map(async (c) => {
            const s = await this.getCompetitorAdCountForRange(c.competitor_name, gte, lte);
            return {
              id: c._id,
              name: c.competitor_name,
              url: c.competitor_url,
              ads: s.total,
              facebook: s.facebook,
              instagram: s.instagram,
            };
          })
        );
        competitors.sort((a, b) => b.ads - a.ads);

        return res.send(Response.userSuccessResp("Competitor ads by range fetched", {
          request_id,
          all: allTime,
          from: gte,
          to: lte,
          competitors,
        }));
      } catch (error) {
        logger.error(`getCompetitorAdsByRange: ${error.message}`);
        return res.send(Response.userFailResp("Failed to fetch competitor ads by range", error.message));
      }
    }

    // Per-user brand/competitor dashboard. Input: { user_id }.
    // Returns total brand/competitor counts, a platform-split "ads today" total,
    // and a per-project (brand) list. Each competitor shows its all-time ad
    // count and day-over-day growth %; each brand carries a platform-split
    // "ads today" figure summed from its competitors.
    async getUserBrandStats(req, res) {
      try {
        const user_id = req?.body?.user_id;
        if (!user_id) {
          return res.send(Response.validationFailResp("Missing user_id in request body", ""));
        }

        const requests = await Competitors_request.find({ user_id }).lean();

        // Plan name: the user's plan_id lives in user_details, and the
        // plan→group mapping lives in the plan_access_config collection of this
        // same DB. Find the group whose `plans` array holds this plan_id and use
        // the group key as the plan name.
        const user = await User_details.findById(user_id, { plan_id: 1 }).lean();
        const planId = user?.plan_id ?? null;
        let planName = null;
        if (planId != null) {
          const planGroups = await mongoose.connection
            .collection("plan_access_config")
            .findOne({ _id: "plan_groups" });
          for (const [groupName, g] of Object.entries(planGroups?.groups || {})) {
            if (Array.isArray(g?.plans) && g.plans.map(Number).includes(Number(planId))) {
              planName = groupName;
              break;
            }
          }
        }

        const growthPct = (today, yesterday) => {
          if (yesterday > 0) return Number((((today - yesterday) / yesterday) * 100).toFixed(1));
          return today > 0 ? 100 : 0; // no baseline yesterday → treat any ads as +100%
        };
        const addPlatforms = (target, src) => {
          target.facebook += src.facebook;
          target.instagram += src.instagram;
          target.total += src.total;
        };

        const brandNameSet = new Set();   // distinct brand names across the user's projects
        const competitorIdSet = new Set(); // distinct competitors across the user's projects
        const totalAdsToday = { facebook: 0, instagram: 0, total: 0 };
        const list = [];

        for (const r of requests) {
          const advertisers = Array.isArray(r.advertiser) ? r.advertiser.filter(Boolean) : [];
          const competitorIds = Array.isArray(r.competitors) ? r.competitors : [];
          const monitoringCount = Array.isArray(r.monitoring) ? r.monitoring.length : 0;

          advertisers.forEach(a => brandNameSet.add(String(a).trim().toLowerCase()));
          competitorIds.forEach(c => competitorIdSet.add(String(c)));

          // Resolve the competitor ObjectIds to their names/urls.
          const compDocs = competitorIds.length
            ? await Competitors.find(
                { _id: { $in: competitorIds } },
                { competitor_name: 1, competitor_url: 1, facebook_status: 1, instagram_status: 1, youtube_status: 1, google_status: 1 }
              ).lean()
            : [];

          // Per-competitor all-time ads + growth (parallel across competitors).
          const enriched = await Promise.all(
            compDocs.map(async (c) => {
              const s = await this.getCompetitorAdStats(c.competitor_name);
              return {
                competitor: {
                  id: c._id,
                  name: c.competitor_name,
                  url: c.competitor_url,
                  ads: s.allTime.total,                 // all-time ad count (total)
                  today: s.today.total,                 // ads seen today
                  yesterday: s.yesterday.total,         // ads seen yesterday
                  last7Days: s.last7days.total,         // ads seen in the last 7 days
                  growth: growthPct(s.today.total, s.yesterday.total), // day-over-day %
                  // Whether the competitor was dispatched to the scraping plugin
                  // today, per platform: 0 = not sent, 1|2 = sent. The plugin
                  // resets these to 0 each day, so a non-zero value reflects
                  // today's run only.
                  facebookStatus: Number(c.facebook_status) || 0,
                  instagramStatus: Number(c.instagram_status) || 0,
                  youtubeStatus: Number(c.youtube_status) || 0,
                  googleStatus: Number(c.google_status) || 0,
                },
                today: s.today, // per-platform today, for the brand/total ads-today split
              };
            })
          );

          // Brand-level "ads today" split by platform = sum of its competitors'.
          const brandAdsToday = { facebook: 0, instagram: 0, total: 0 };
          enriched.forEach(e => addPlatforms(brandAdsToday, e.today));
          addPlatforms(totalAdsToday, brandAdsToday);

          list.push({
            request_id: r._id,
            project_name: r.project_name,
            brands: advertisers,            // brand/project header name(s), e.g. ["Nike India"]
            brand_url: r.brand_url,
            competitorsCount: competitorIds.length,
            monitoringCount,
            quota: `${monitoringCount}/${competitorIds.length}`,
            adsToday: brandAdsToday,        // { facebook, instagram, google, total }
            competitors: enriched.map(e => e.competitor), // [{ id, name, url, ads, growth }]
          });
        }

        return res.send(Response.userSuccessResp("User brand stats fetched", {
          planId,
          planName,                         // e.g. "Palladium" (group containing plan_id)
          totalBrands: brandNameSet.size,
          totalCompetitors: competitorIdSet.size,
          adsToday: totalAdsToday,          // total ads today, split by platform
          brands: list,
        }));
      } catch (error) {
        logger.error(`getUserBrandStats: ${error.message}`);
        return res.send(Response.userFailResp("Failed to fetch user brand stats", error.message));
      }
    }


async insertBacklink(req,res){
  try{

        const data = req?.body;

       if(!data || Object.keys(data).length === 0 ) {
          logger.error("missing backlink data in request body");
           return res.send(Response.validationFailResp("Missing backlink data"));
       }

      if(!data.domain_name) {
         logger.error("Missing domain name");
         return res.send(Response.validationFailResp("Missing domain name"));
      }

      const existing = await Backlink.findOne({
         domain_name: { $regex: new RegExp(`^${data.domain_name}$`,'i') }
       });
  
    if(!existing){

    const createdBacklink = await Backlink.create(data);

    if (createdBacklink) {
      return res.send(
        Response.userSuccessResp("backlink created succesfully", createdBacklink)
        );
    } else {
      logger.error("failed to create backlink");
      return res.send(Response.messageResp("Failed to create the backlink"));
    }
  } else {
   
    const updateFields = {};
    for(const [key,value] of Object.entries(data)){
      if (
        value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')){
          updateFields[key] = value;
        }
    }

    delete updateFields.domain_name;

    const updatedBacklink = await Backlink.findByIdAndUpdate(
      existing._id,
      {
        $set: updateFields
      },
      {
        new: true
      }
    );

    logger.info("Backlink updated for existing domain name");
    return res.send(
      Response.userSuccessResp("Backlink updated successfully",updatedBacklink)
    );

  }

  } catch (error){
    logger.error("Error in inserting backlink:", error);
    return res.send(Response.userFailResp("Error inserting backlink", error));

  }
}

async insertOrganicSearch(req,res){
  try{
            const data = req?.body;

           if(!data || Object.keys(data).length === 0){
              logger.error("missing the organic search data in the body");
              return res.send(Response.validationFailResp("missing the organic search data"));
           }

          if(!data.domain_name) {
            logger.error("Missing domain name");
             return res.send(Response.validationFailResp("Missing domain name"));
          }

          const existing = await Organic_search.findOne({
          domain_name: { $regex: new RegExp(`^${data.domain_name}$`,'i') }
          });

    if(!existing){

             const createdOrganicsearch = await Organic_search.create(data);

            if (createdOrganicsearch) {
              return res.send(
              Response.userSuccessResp("oganic search created successfully")
              );
            } else {
               logger.error("failed to create the organic search");
                return res.send(Response.messageResp("Failed to create the organic search"));
            }
      }  else {

          const updateFields = {};
          for(const [key,value] of Object.entries(data)){
          if (
            value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')){
            updateFields[key] = value;
           }
            }
          delete updateFields.domain_name;

          const updatedOrganicSearch = await Organic_search.findByIdAndUpdate(
          existing._id,
          {
           $set: updateFields
          },
          {
          new: true
           }
          );

         logger.info("Organic search updated for existing domain name");
         return res.send(
          Response.userSuccessResp("Organic search updated successfully",updatedOrganicSearch)
        );

        }


      } catch (error) {
        logger.error("failed to create the organic search");
        return res.send(Response.userFailResp("Error inserting organic search", error));
      }
}

async insertpaidSearch(req,res){
  try{
    const data = req?.body;
    
            if(!data || Object.keys(data).length === 0){
              logger.error("missing paid search data in request body");
              return res.send(Response.validationFailResp("Missing paidsearch data"));
              }

            if(!data.domain_name) {
              logger.error("Missing domain name");
              return res.send(Response.validationFailResp("Missing domain name"));
              }

          const existing = await Paid_search.findOne({
            domain_name: { $regex: new RegExp(`^${data.domain_name}$`,'i') }
            });

        if(!existing){

          const createdPaidSearch = await Paid_search.create(data);

        if(createdPaidSearch) {
            return res.send(
              Response.userSuccessResp("paid search  created successfully", createdPaidSearch)
           );
        } else {
          logger.error("failed to create the paid search");
          return res.send(Response.messageResp("Failed to create the paid search"));
          }
      } else {
   
          const updateFields = {};
              for(const [key,value] of Object.entries(data)){
                 if (
                       value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')){
                        updateFields[key] = value;
                        }
                }
  
          delete updateFields.domain_name;
  
            const updatedPaidSearch = await Paid_search.findByIdAndUpdate(
              existing._id,
            {
              $set: updateFields
             },
            {
              new: true
            }
            );
  
          logger.info("paid search updated for existing domain name");
           return res.send(
            Response.userSuccessResp("paid search updated successfully",updatedPaidSearch)
            );
  
          }

     } catch (error) {
      logger.error("Error in inserting paid search:", error);
        return res.send(Response.userFailResp("Error inserting paid search", error));
        }
    }

    async getBackLinks(req,res){
      try{
         const data = req?.body;

         if (!data || Object.keys(data).length === 0) {
           logger.error("Missing data in payload");
           return res.send(
             Response.validationFailResp("Missing payload data")
           );
         }

          const { value, error } = DashboardValidation.validatePayloadForBacklink(data);

         if (error) {
           logger.error("VALIDATION_FAIL", error.details);
           return res.send(
             Response.validationFailResp("VALIDATION_FAIL", error.details)
           );
         }

         
         let { domain_name,referring_page,referring_domains,skip,limit }= data;

         let searchObj = {};
        
         if (domain_name && domain_name != "") {
          searchObj.domain_name = { $regex: domain_name, $options: "i" };
        }

         if(referring_page && referring_page!=""){
          searchObj.referring_page = { $regex: referring_page, $options: "i" };
         }

         if (referring_domains && referring_domains !== "") {
           searchObj.referring_domains = {
             $elemMatch: { $regex: referring_domains, $options: "i" },
           };
         }

         let findDomain = await Backlink.find(searchObj).skip(skip).limit(limit);

        if(findDomain && findDomain.length>0){
            return res.send(
              Response.userSuccessResp(
                "Data found successfully",
                findDomain
              )
            );
        }
        else{
          return res.send(Response.messageResp("No data found"));
        }

      }
      catch(error){
        logger.error("Error in getting backlinks details", error);
        return res.send(
          Response.userFailResp("Error in getting backlinks details", error)
        );
      }
    }

    async getOrganicSearches(req,res){
      try{
        
        const data = req?.body;

        if (!data || Object.keys(data).length === 0) {
          logger.error("Missing data in payload");
          return res.send(Response.validationFailResp("Missing payload data"));
        }
        
        const { value, error } = DashboardValidation.validatePayloadForOrganic(data);

         if (error) {
           logger.error("VALIDATION_FAIL", error.details);
           return res.send(
             Response.validationFailResp("VALIDATION_FAIL", error.details)
           );
         }

        let { domain_name, best_position_url,keyword,skip,limit } = data;

        let searchObj = {};

        if (domain_name && domain_name != "") {
          searchObj.domain_name = { $regex: domain_name, $options: "i" };
        }

        if (best_position_url && best_position_url != "") {
          searchObj.best_postion_url = { $regex: best_position_url, $options: "i" };
        }

        if (keyword && keyword != "") {
          searchObj.keyword = { $regex: keyword, $options: "i" };
        }


        let findDomain = await Organic_search.find(searchObj).skip(skip).limit(limit);

        if (findDomain && findDomain.length > 0) {
          return res.send(
            Response.userSuccessResp("Data found successfully", findDomain)
          );
        } else {
          return res.send(Response.messageResp("No data found"));
        }

      }
      catch(error){
        logger.error("Error in getting organic search details", error);
        return res.send(
          Response.userFailResp(
            "Error in getting organic search details",
            error
          )
        );
      }
    }

    async getPaidSearches(req,res){
            try {
              const data = req?.body;

              if (!data || Object.keys(data).length === 0) {
                logger.error("Missing data in payload");
                return res.send(
                  Response.validationFailResp("Missing payload data")
                );
              }

              const { value, error } = DashboardValidation.validatePayloadForPaid(data);

              if (error) {
                logger.error("VALIDATION_FAIL", error.details);
                return res.send(
                  Response.validationFailResp("VALIDATION_FAIL", error.details)
                );
              }

              let { domain_name, external_links, keywords, skip, limit } = data;

              let searchObj = {};

              if (domain_name && domain_name != "") {
                searchObj.domain_name = { $regex: domain_name, $options: "i" };
              }

              if (keywords && keywords != "") {
                searchObj.keywords = {
                  $regex: keywords,
                  $options: "i",
                };
              }

              if (external_links && external_links !== "") {
                searchObj.external_links = {
                  $elemMatch: { $regex: external_links, $options: "i" },
                };
              }

              let findDomain = await Paid_search.find(searchObj)
                .skip(skip)
                .limit(limit);

              if (findDomain && findDomain.length > 0) {
                return res.send(
                  Response.userSuccessResp(
                    "Data found successfully",
                    findDomain
                  )
                );
              } else {
                return res.send(Response.messageResp("No data found"));
              }
            } catch (error) {
              logger.error("Error in getting paid search details", error);
              return res.send(
                Response.userFailResp(
                  "Error in getting organic paid details",
                  error
                )
              );
            }

    }

    async getCount(req, res) {
      try {
        const data = req?.body;
        if (!data || !data.user_id) {
          logger.info("LOG: Request body or user_id missing");
          return res.send(Response.validationFailResp("Missing user_id in request data", ""));
        }
    
        const { user_id } = data;
        const ObjectId = mongoose.Types.ObjectId;
    
        if (!mongoose.isValidObjectId(user_id)) {
          logger.info("LOG: Invalid user_id format:");
          return res.send(Response.validationFailResp("Invalid user_id format", ""));
        }
    
        // Fetch all user competitors + monitoring
        const userData = await Competitors_request.aggregate([
          { $match: { user_id: new ObjectId(user_id) } },
          {
            $group: {
              _id: "$user_id",
              competitors: { $push: "$competitors" },
              monitoring: { $push: "$monitoring" },
            },
          },
          {
            $project: {
              competitors: {
                $reduce: {
                  input: "$competitors",
                  initialValue: [],
                  in: { $concatArrays: ["$$value", { $ifNull: ["$$this", []] }] },
                },
              },
              monitoring: {
                $reduce: {
                  input: "$monitoring",
                  initialValue: [],
                  in: { $concatArrays: ["$$value", { $ifNull: ["$$this", []] }] },
                },
              },
            },
          },
        ]);
    
        if (!userData || userData.length === 0) {
          return res.send(Response.messageResp("No competitors or monitoring data found for this user"));
        }
    
        const competitorsIds = [...new Set(userData[0].competitors)];
        const monitoringCount = userData[0].monitoring.length;
    
        if (competitorsIds.length === 0) {
          return res.send(
            Response.userSuccessResp("No competitors found", {
              competitorsCount: 0,
              monitoringCount: 0,
              totalAds: 0,
              totalAverageBudget: 0,
              competitorDetails: [],
            })
          );
        }
    
        // Fetch competitor names
        const competitorDocs = await Competitors.find(
          { _id: { $in: competitorsIds.map(id => new ObjectId(id)) } },
          { competitor_name: 1 }
        );
        const competitorNames = competitorDocs.map(c => c.competitor_name.trim());
        logger.info("LOG: Competitor Names taken");
    
        let totalAds = 0;
        let globalTotalBudget = 0;      
        let globalAdsWithBudget = 0;    
    
        const competitorDetails = [];
    
        const advertiserIndexConfigs = [
          { index: 'search_mix', field: 'facebook_ad_post_owners.post_owner_name', fieldPrefix: 'facebook' },
          { index: 'instagram_search_mix', field: 'instagram_ad_post_owners.post_owner_name', fieldPrefix: 'instagram' },
        ];
    
        for (const name of competitorNames) {
          let competitorTotalAds = 0;
          let competitorTotalBudget = 0;
          let competitorBudgetCount = 0;
    
          const searchPromises = [];
    
          for (const [serverName, serverData] of Object.entries(this.esServers)) {
            const client = this.esClient[serverName];
    
            const runSearch = async (config) => {
              if (!serverData.indexes.includes(config.index)) return;
    
              try {
                const countRes = await client.count({
                  index: config.index,
                  body: {
                    query: {
                      match_phrase: { [config.field]: name }
                    }
                  }
                });
    
                competitorTotalAds += countRes.count || 0;
                totalAds += countRes.count || 0;
    
              
                const budgetRes = await client.search({
                  index: config.index,
                  size: 0,
                  body: {
                    query: {
                      match_phrase: { [config.field]: name }
                    },
                    aggs: {
                      ads_with_budget: {
                        filter: { exists: { field: `${config.fieldPrefix}.averagebudget` } },
                        aggs: {
                          sum_budget: { sum: { field: `${config.fieldPrefix}.averagebudget` } }
                        }
                      }
                    }
                  }
                });
    
                const adsWithBudget = budgetRes.aggregations?.ads_with_budget?.doc_count || 0;
                const sumBudget = budgetRes.aggregations?.ads_with_budget?.sum_budget?.value || 0;
    
                if (adsWithBudget > 0 && sumBudget > 0) {
                  // Per-competitor accumulation (for individual average)
                  competitorTotalBudget += sumBudget;
                  competitorBudgetCount += adsWithBudget;
    
                  // GLOBAL accumulation (for correct totalAverageBudget)
                  globalTotalBudget += sumBudget;
                  globalAdsWithBudget += adsWithBudget;
                }
    
              } catch (error) {
                logger.error(`LOG: Error searching server ${serverName}, index ${config.index} for ${name}:`, error.message);
              }
            };
    
            advertiserIndexConfigs.forEach(config => searchPromises.push(runSearch(config)));
          }
    
          await Promise.all(searchPromises);
    
          const competitorAverageBudget = competitorBudgetCount > 0 
            ? competitorTotalBudget / competitorBudgetCount 
            : 0;
    
          competitorDetails.push({
            name,
            totalAds: competitorTotalAds,
            averageBudget: Number(competitorAverageBudget.toFixed(2)),
          });
        }
    
        // FINAL CORRECT totalAverageBudget
        const totalAverageBudget = globalAdsWithBudget > 0
          ? Number((globalTotalBudget / globalAdsWithBudget).toFixed(2))
          : 0;
    
        return res.send(
          Response.userSuccessResp("Stats retrieved successfully", {
            competitorsCount: competitorsIds.length,
            monitoringCount,
            totalAds,
            totalAverageBudget,
            competitorDetails,
          })
        );
    
      } catch (error) {
        logger.error("LOG: Error in getCount:", error);
        return res.send(Response.userFailResp("Error in getting competitor stats", error));
      }
    }

    async getCountry(req,res){
      try{
        const countries = await getAllCountries();
        res.json(countries);
      } catch(error ){
        logger.error("Error in getCount function", error);
        return res.send(
          Response.userFailResp("Error in getting competitor count", error)
        );
      }
    }

  async getCompetitorsCountNew(req, res) {
    try {
      const input = req?.body?.competitors;
      if (!input) {
        return res.send(Response.validationFailResp("Missing competitors in request body", ""));
      }

      const isArray = Array.isArray(input);
      const competitors = isArray ? input : [input];

      const getRange = (duration) => {
        let start, end;
        if (duration === 'yesterday') {
          start = moment().subtract(1, 'day').startOf('day');
          end = moment().subtract(1, 'day').endOf('day');
        } else if (duration === 'today') {
          start = moment().startOf('day');
          end = moment();
        } else if (duration === 'week') {
          start = moment().subtract(7, 'days').startOf('day');
          end = moment().subtract(1, 'day').endOf('day');
        } else {
          start = moment().subtract(1, duration).startOf(duration);
          end = moment().subtract(1, duration).endOf(duration);
        }
        return {
          isoStart: start.format("YYYY-MM-DD HH:mm:ss"),
          isoEnd: end.format("YYYY-MM-DD HH:mm:ss")
        };
      };

      const ranges = {
        yesterday: getRange("yesterday"),
        today: getRange("today"),
        lastWeek: getRange("week"),
        lastMonth: getRange("month"),
        lastYear: getRange("year")
      };

      // Run each competitor through the same logic as getCompetitorsCount (individual match_phrase queries)
      const fetchSingleCompetitor = async (competitor) => {
        const advertiserIndexConfigs = [
          { index: 'search_mix', field: 'facebook_ad_post_owners.post_owner_name' },
          { index: 'instagram_search_mix', field: 'instagram_ad_post_owners.post_owner_name' }
        ];
        const countryIndexConfigs = [
          { index: 'search_mix', field: 'facebook_ad_post_owners.post_owner_name', countryField: 'country_only.country' },
          { index: 'instagram_search_mix', field: 'instagram_ad_post_owners.post_owner_name', countryField: 'instagram_country_only.country' }
        ];
        // Match the search builders: ads in a date bucket are those *last seen*
        // in that window — not just those first seen. Using firstSeenOn*
        // undercounts long-running ads that are still active "today".
        // See facebook/instagram SearchMixQueryBuilder._getLastSeenEnv.
        const dateFieldMap = {
          search_mix: ['facebook_ad.last_seen'],
          instagram_search_mix: ['instagram_ad.last_seen']
        };

        const totals = {
          competitorsCount: 0,
          yesterdayAdsCount: 0,
          todayAdsCount: 0,
          lastWeekAdsCount: 0,
          lastMonthAdsCount: 0,
          lastYearAdsCount: 0,
          platformCompetitorCount: { facebook: 0, instagram: 0, google: 0 },
          uniqueCountries: new Set()
        };
        let facebookStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };
        let instagramStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };

        const fetchGlobalStats = async (client, index, ownerField, impField, popField, budField) => {
          const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
          const ownerClause = buildOwnerClause(index, competitor);
          const r = await client.search({
            index, size: 0,
            body: {
              query: {
                bool: {
                  must: [ownerClause],
                  ...(filterClauses.length  && { filter:   filterClauses }),
                  ...(mustNotClauses.length && { must_not: mustNotClauses }),
                },
              },
              aggs: {
                impressions: {
                  filter: { exists: { field: impField } },
                  aggs: {
                    total_imp: { sum: { field: impField } },
                    imp_count: { value_count: { field: impField } }
                  }
                },
                popularity: {
                  filter: { exists: { field: `${popField}.current` } },
                  aggs: {
                    total_pop: { sum: { field: `${popField}.current`, missing: 0 } },
                    pop_count: { value_count: { field: `${popField}.current` } }
                  }
                },
                budget: {
                  filter: { exists: { field: budField } },
                  aggs: {
                    // The index has NO stored "total budget" field — only a per-ad
                    // `averagebudget`. totalBudget is Σ(averagebudget) over matching
                    // ads; the agg alias makes that derivation explicit.
                    sum_avg_budget: { sum: { field: budField } },
                    budget_count:   { value_count: { field: budField } },
                  },
                },
              },
            },
          });
          const a = r?.aggregations || {};
          const imp = a.impressions || {};
          const pop = a.popularity || {};
          const bud = a.budget || {};
          // totalBudget = Σ(per-ad averagebudget) for ads on this platform — computed, not stored.
          const totalBudget = bud.sum_avg_budget?.value || 0;
          return {
            averageImpression: (imp.imp_count?.value || 0) > 0 ? (imp.total_imp?.value || 0) / (imp.imp_count?.value || 0) : 0,
            averagePopularity: (pop.pop_count?.value || 0) > 0 ? (pop.total_pop?.value || 0) / (pop.pop_count?.value || 0) : 0,
            averageBudget: (bud.budget_count?.value || 0) > 0 ? totalBudget / (bud.budget_count?.value || 0) : 0,
            totalBudget,
          };
        };

        for (const [serverName, serverData] of Object.entries(this.esServers)) {
          const client = this.esClient[serverName];
          const index_to_platform = { 'search_mix': 'facebook', 'instagram_search_mix': 'instagram' };

          // Counts — deduped by ad id, with NAS filter + multilingual owner match
          for (const { index } of advertiserIndexConfigs.filter(c => serverData.indexes.includes(c.index))) {
            const platform = index_to_platform[index] || 'undefined';
            const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
            const ownerClause = buildOwnerClause(index, competitor);
            const cnt = await dedupCount(client, index, {
              must: [ownerClause],
              ...(filterClauses.length  && { filter:   filterClauses }),
              ...(mustNotClauses.length && { must_not: mustNotClauses }),
            });
            totals.platformCompetitorCount[platform] += cnt;
            totals.competitorsCount += cnt;
          }

          // Countries
          for (const { index, countryField } of countryIndexConfigs.filter(c => serverData.indexes.includes(c.index))) {
            const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
            const ownerClause = buildOwnerClause(index, competitor);
            const r = await client.search({
              index, size: 0,
              body: {
                query: {
                  bool: {
                    must: [ownerClause],
                    ...(filterClauses.length  && { filter:   filterClauses }),
                    ...(mustNotClauses.length && { must_not: mustNotClauses }),
                  },
                },
                aggs: { countries: { terms: { field: `${countryField}.keyword`, size: 1000 } } }
              }
            });
            (r?.aggregations?.countries?.buckets || []).forEach(b => {
              if (b.key) totals.uniqueCountries.add(b.key.toLowerCase());
            });
          }

          // Date ranges — deduped by ad id, with NAS filter + multilingual owner match
          for (const [label, { isoStart, isoEnd }] of Object.entries(ranges)) {
            for (const [idx, fields] of Object.entries(dateFieldMap).filter(([i]) => serverData.indexes.includes(i))) {
              const rangeQ = fields.map(f => ({ range: { [f]: { gte: isoStart, lte: isoEnd } } }));
              const existsQ = fields.map(f => ({ exists: { field: f } }));
              const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(idx);
              const ownerClause = buildOwnerClause(idx, competitor);
              const cnt = await dedupCount(client, idx, {
                must: [
                  ownerClause,
                  { bool: { should: rangeQ, minimum_should_match: 1 } },
                  { bool: { should: existsQ, minimum_should_match: 1 } },
                ],
                ...(filterClauses.length  && { filter:   filterClauses }),
                ...(mustNotClauses.length && { must_not: mustNotClauses }),
              });
              totals[`${label}AdsCount`] += cnt;
            }
          }

          // Stats
          if (serverData.indexes.includes('search_mix')) {
            facebookStats = await fetchGlobalStats(client, 'search_mix', 'facebook_ad_post_owners.post_owner_name', 'facebook_ad.impression', 'facebook_ad.popularity', 'facebook.averagebudget');
          }
          if (serverData.indexes.includes('instagram_search_mix')) {
            instagramStats = await fetchGlobalStats(client, 'instagram_search_mix', 'instagram_ad_post_owners.post_owner_name', 'instagram_ad.impression', 'instagram_ad.popularity', 'instagram.averagebudget');
          }
        }

        const getValidAverage = (fbVal, igVal) => {
          const values = [];
          if (fbVal > 0) values.push(fbVal);
          if (igVal > 0) values.push(igVal);
          return values.length > 0 ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : 0;
        };

        return {
          competitorsCount: totals.competitorsCount,
          yesterdayAdsCount: totals.yesterdayAdsCount,
          todayAdsCount: totals.todayAdsCount,
          lastWeekAdsCount: totals.lastWeekAdsCount,
          lastMonthAdsCount: totals.lastMonthAdsCount,
          lastYearAdsCount: totals.lastYearAdsCount,
          platformCompetitorCount: totals.platformCompetitorCount,
          uniqueCountries: Array.from(totals.uniqueCountries),
          averageImpression: getValidAverage(facebookStats.averageImpression, instagramStats.averageImpression),
          averagePopularity: getValidAverage(facebookStats.averagePopularity, instagramStats.averagePopularity),
          averageBudget: getValidAverage(facebookStats.averageBudget, instagramStats.averageBudget),
          // totalBudget is a real cross-platform sum — drives the "Estimated Total Ad Budget" column.
          totalBudget: Number(
            ((facebookStats.totalBudget || 0) + (instagramStats.totalBudget || 0)).toFixed(2)
          ),
        };
      };

      // Run all competitors in parallel
      const results = await Promise.all(competitors.map(comp => fetchSingleCompetitor(comp)));
      const finalResults = {};
      competitors.forEach((comp, i) => { finalResults[comp] = results[i]; });

      return res.send(
        Response.userSuccessResp("Counts fetched successfully", isArray ? finalResults : finalResults[input])
      );

    } catch (error) {
      logger.error("[getCompetitorsCountNew] Error fetching from Elasticsearch:", error);
      return res.send(
        Response.userFailResp("Internal server error", error)
      );
    }
  }

  /**
   * Internal version of getCompetitorsCountNew — no req/res, returns the map directly.
   * Used by competitorService to pre-enrich rows before emitting competitor-batch via socket.
   */
  async getCompetitorsCountNewInternal(names) {
    // Re-use the same logic by building a fake req/res
    return new Promise((resolve) => {
      const fakeReq = { body: { competitors: names } };
      const fakeRes = {
        send: (payload) => {
          const data = payload?.body?.data || {};
          resolve(data);
        },
      };
      this.getCompetitorsCountNew(fakeReq, fakeRes).catch(() => resolve({}));
    });
  }

}

export default new DashboardService();