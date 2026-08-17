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
import CompetitorSnapshot from '../../models/competitorSnapshot.js';
import { getAllCountries } from '../../models/countries.js';
// import {client} from '../../utils/Elasticsearch.js';
import { esClient,esServers, checkElasticsearchHealth } from "../../utils/Elasticsearch.js";
import { NETWORK_INDEXES } from "../../utils/networkIndexes.js";
import { getDisplayableMediaFilter } from "../../utils/displayableMediaFilters.js";
import { COUNTRIES as HANDLED_COUNTRIES } from "../../config/countries.js";
import elasticsearch from "elasticsearch";
import { withLimit } from "../../utils/esLoadGuard.js";
import DashboardValidation from "./dashboardValidation.js";
import moment from "moment";
import mongoose from "mongoose";

// "Now" anchored to IST (+05:30). ES `last_seen` strings are written in IST,
// but the server may run in UTC — plain moment() there keeps "today" on the
// previous date until 05:30 IST (e.g. at 1 AM IST on the 13th, UTC is still
// the 12th evening), so today's bucket silently served yesterday's data.
// Every today/yesterday/last-N range below must be derived from this.
const nowIST = () => moment.utc().utcOffset("+05:30");

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

// Match the search builder's _getPostOwnerNameEnv exactly: phrase across
// multilingual variants OR prefix match on the base field.
const OWNER_FIELDS_BY_INDEX = {
  [NETWORK_INDEXES.facebook]: {
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
  [NETWORK_INDEXES.instagram]: {
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
  [NETWORK_INDEXES.google]: {
    fields: ['post_owner_name'],
    prefixField: 'post_owner_name',
    // Verified against pas_node_api/scripts/google_ads_data_v2.mapping.json:
    // post_owner_lower is a genuine `keyword` field (single normalized token
    // per doc), not a guess. buildOwnerClause() below prefers this for the
    // `prefix` clause instead of the analyzed post_owner_name text field —
    // same "starts with" result, far cheaper. Confirmed against production
    // hot-threads (2026-08-17): this exact prefix-on-analyzed-field pattern
    // was still showing as the dominant TermInSetQuery/BitSet.or CPU cost on
    // get-competitor-count even after the same fix was applied in
    // Competitors/monitorService.js — this file has its own separate,
    // previously-unfixed copy of the same query shape.
    prefixFieldKeyword: 'post_owner_lower',
  },
};

// Ad ID field per index for cardinality dedup — mirrors the `collapse`
// applied by each search builder.
const AD_ID_FIELD_BY_INDEX = {
  [NETWORK_INDEXES.facebook]:           'facebook_ad.id',
  [NETWORK_INDEXES.instagram]: 'instagram_ad.id',
  [NETWORK_INDEXES.google]:   'id',
};

const NETWORK_BY_INDEX = Object.freeze(
  Object.fromEntries(
    Object.entries(NETWORK_INDEXES).map(([network, index]) => [index, network]),
  ),
);

// The competitor dashboard only counts countries from its backend-owned
// product list. The list mirrors the frontend values without creating a
// runtime dependency between separately deployed services.
const GLOBAL_COUNTRY_TERMS = ["all", "global", "global reach", "worldwide"];
const COUNTRY_FIELD_BY_INDEX = Object.freeze({
  [NETWORK_INDEXES.facebook]: 'country_only.country',
  [NETWORK_INDEXES.instagram]: 'instagram_country_only.country',
  [NETWORK_INDEXES.google]: 'country',
});

function addCountryTermVariants(queryTerms, normalizedTerms, value) {
  const raw = String(value ?? "").trim();
  if (!raw) return;
  queryTerms.add(raw);
  queryTerms.add(raw.toLowerCase());
  queryTerms.add(raw.toUpperCase());
  normalizedTerms.add(raw.toLowerCase());
}

const SUPPORTED_COUNTRY_INFO = (() => {
  const queryTerms = new Set();
  const normalizedTerms = new Set();

  for (const row of HANDLED_COUNTRIES) {
    addCountryTermVariants(queryTerms, normalizedTerms, row.name);
    addCountryTermVariants(queryTerms, normalizedTerms, row.code);
  }
  for (const globalTerm of GLOBAL_COUNTRY_TERMS) {
    addCountryTermVariants(queryTerms, normalizedTerms, globalTerm);
  }

  return {
    queryTerms: [...queryTerms],
    normalizedTerms,
  };
})();

const getSupportedCountryInfo = () => SUPPORTED_COUNTRY_INFO;

// Elasticsearch 6.8 supports these _msearch controls. Keep conservative
// defaults so one large project cannot flood a cluster's search thread pool;
// deployments can tune them in config/localDev.json after observing timings.
function getPositiveIntegerConfig(key, fallback, max) {
  try {
    const value = Number(config.get(key));
    if (Number.isInteger(value) && value > 0) return Math.min(value, max);
  } catch (_) {
    // node-config throws when an optional key is absent; use the safe default.
  }
  return fallback;
}

function getBooleanConfig(key, fallback) {
  try {
    const value = config.get(key);
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  } catch (_) {
    // node-config throws when an optional key is absent; use the safe default.
  }
  return fallback;
}

const COMPETITOR_MSEARCH_BATCH_SIZE = getPositiveIntegerConfig(
  "COMPETITOR_STATS_MSEARCH_BATCH_SIZE",
  25,
  100,
);
const COMPETITOR_MSEARCH_MAX_CONCURRENT_SEARCHES = getPositiveIntegerConfig(
  "COMPETITOR_STATS_MSEARCH_MAX_CONCURRENT_SEARCHES",
  4,
  20,
);
const COMPETITOR_MSEARCH_MAX_CONCURRENT_SHARD_REQUESTS = getPositiveIntegerConfig(
  "COMPETITOR_STATS_MSEARCH_MAX_CONCURRENT_SHARD_REQUESTS",
  2,
  20,
);
const COMPETITOR_STATS_USE_MSEARCH = getBooleanConfig(
  "COMPETITOR_STATS_USE_MSEARCH",
  true,
);

function countryFieldForIndex(index, countryField) {
  return index === NETWORK_INDEXES.google || countryField.endsWith('.keyword')
    ? countryField
    : `${countryField}.keyword`;
}

function buildCountryFilterClause(index, countryField, supportedCountryInfo) {
  const terms = supportedCountryInfo?.queryTerms || [];
  if (!terms.length) return null;
  return {
    terms: {
      [countryFieldForIndex(index, countryField)]: terms,
    },
  };
}

function isSupportedCountryKey(rawKey, supportedCountryInfo) {
  if (!supportedCountryInfo?.normalizedTerms?.size) return true;
  const key = String(rawKey ?? "").trim().toLowerCase();
  return Boolean(key) && supportedCountryInfo.normalizedTerms.has(key);
}

// Mirror the builder's multi-word advertiser logic without depending on the
// search service internals. Facebook/Instagram/Google counts need the same
// matching shape as their live search builders or the project row badges can
// drift away from what the ads library can actually open.
function phraseAcrossFieldsLikeBuilder(fields, kw) {
  if (!kw || !fields || !fields.length) return null;
  const cleaned = String(kw).replace(/"/g, '').trim();
  if (!cleaned) return null;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return { multi_match: { query: words[0], type: 'phrase', fields } };
  }
  return {
    bool: {
      must: words.map((w) => ({ multi_match: { query: w, type: 'phrase', fields } })),
    },
  };
}

function buildOwnerClause(index, competitor) {
  const cfg = OWNER_FIELDS_BY_INDEX[index];
  /* v8 ignore next -- index is always a known OWNER_FIELDS_BY_INDEX key (search_mix/instagram_search_mix) */
  if (!cfg) {
    return { match_phrase: { post_owner_name: competitor } };
  }
  // Google-only (2026-08-17): single advertiser field, so "every word must
  // appear somewhere in this field" collapses to one `match operator:and`
  // instead of N per-word phrase clauses ANDed together — identical result
  // (both require every analyzed term present, order-independent), far fewer
  // clauses for Lucene to build/score. Facebook/Instagram check the same word
  // across up to 6 OR'd fields, which doesn't collapse the same way, so they
  // keep phraseAcrossFieldsLikeBuilder untouched. See the matching fix in
  // Competitors/monitorService.js.
  let phraseClause;
  if (index === NETWORK_INDEXES.google && cfg.fields.length === 1) {
    const cleaned = String(competitor || '').replace(/"/g, '').trim();
    phraseClause = cleaned ? { match: { [cfg.fields[0]]: { query: cleaned, operator: 'and' } } } : null;
  } else {
    phraseClause = phraseAcrossFieldsLikeBuilder(cfg.fields, competitor);
  }
  // Google-only: skip the prefix fallback entirely for very short names.
  // Confirmed via a live `profile:true` query (2026-08-17): for a specific
  // name like "lululemon athletica" the prefix clause is cheap and never
  // needs Lucene's TermInSetQuery rewrite. But a 2-3 letter prefix ("hp",
  // "dhl", "mg") against 197M docs' worth of distinct advertiser names
  // matches far more terms, which IS what forces that expensive rewrite
  // (confirmed dominating hot-threads for exactly these short names). Below
  // this length the prefix fallback also adds little value — a 2-letter
  // prefix returns mostly unrelated brands anyway — so it's dropped rather
  // than made cheaper, and the exact/AND match clause alone still applies.
  const GOOGLE_PREFIX_MIN_LENGTH = 4;
  const skipPrefix = index === NETWORK_INDEXES.google
    && String(competitor || '').trim().length < GOOGLE_PREFIX_MIN_LENGTH;
  const prefixClause = skipPrefix
    ? null
    // prefix runs against prefixFieldKeyword (*_lower, a normalized
    // keyword field) when available, not the analyzed prefixField —
    // same "starts with" result, far cheaper (see OWNER_FIELDS_BY_INDEX).
    : { prefix: { [cfg.prefixFieldKeyword || cfg.prefixField]: String(competitor).toLowerCase() } };
  return {
    bool: {
      should: [phraseClause, prefixClause].filter(Boolean),
      minimum_should_match: 1,
    },
  };
}

function nasClausesFor(index) {
  const network = NETWORK_BY_INDEX[index];
  const filter = network ? getDisplayableMediaFilter(network) : null;
  return { filter: Array.isArray(filter) ? filter : [], mustNot: [] };
}

// ─── In-process response cache for getCompetitorsCount (2026-08-17) ──────────
// get-competitor-count is called once PER COMPETITOR from the frontend list
// view, and the SAME competitor is frequently re-requested (list re-renders,
// multiple users/lists overlapping, navigating back). A cache hit returns
// instantly with ZERO ES load; only a genuine miss (new/expired competitor)
// ever touches ES at all — this is the highest-leverage way to keep this
// endpoint fast and never time out, since the fastest query is the one that
// never runs. 3 min TTL: long enough to absorb realistic repeat-request
// bursts, short enough that counts still track real ad activity closely.
// Node in-process Map, not Redis — same choice already made throughout this
// project (esLoadGuard.js) and in pas_node_api this session.
const COMPETITOR_COUNT_CACHE_TTL_MS = 3 * 60 * 1000;
const COMPETITOR_COUNT_CACHE_MAX_ENTRIES = 2000;
const competitorCountCache = new Map(); // normalizedName -> { expiresAt, body }

function getCachedCompetitorCount(key) {
  const hit = competitorCountCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { competitorCountCache.delete(key); return null; }
  return hit.body;
}

function setCachedCompetitorCount(key, body) {
  if (competitorCountCache.size >= COMPETITOR_COUNT_CACHE_MAX_ENTRIES) {
    competitorCountCache.delete(competitorCountCache.keys().next().value); // evict oldest
  }
  competitorCountCache.set(key, { expiresAt: Date.now() + COMPETITOR_COUNT_CACHE_TTL_MS, body });
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

// competitor_url is stored bare (e.g. "searchmetrics.com"), so the frontend
// treats it as a relative path and the link goes nowhere. Prepend https:// when
// no scheme is present so it resolves as an absolute external URL.
function normalizeUrl(url) {
  if (!url) return url;
  const trimmed = String(url).trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
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
                monitoring: project.monitoring || [],
                // Persisted generation state — lets the frontend tell "still
                // generating in the background" apart from "genuinely has no
                // competitors" after a page refresh, and rejoin the right
                // socket room to resume live updates.
                content_ref_id: project.content_ref_id || null,
                target_count: project.target_count || 0,
                generation_status: project.generation_status || "idle"
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
    { index: NETWORK_INDEXES.facebook, field:"facebook_ad_post_owners.post_owner_name"},
    {index: NETWORK_INDEXES.instagram, field:"instagram_ad_post_owners.post_owner_name" }
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

        // Same DS `specific_to_match` carried through as getCompetitorTableRows
        // (compeitetor_analysis/core/Competitors/competitorService.js) — this is
        // the separate "view an existing project" read path, so it needs its own
        // lookup against the same `specificToMatches` field on the request doc.
        const specificToMatchByName = new Map(
          (projectName.specificToMatches || []).map(m => [m.name, m.match])
        );

        const cnames = competitors_data.reduce((acc, c) => {
          acc[c.competitor_name] = {
            id: c._id,
            comp_request_id: projectName._id,
            monitoring: monitoringStatus.includes(c._id),
            specific_to_match: specificToMatchByName.get(c.competitor_name?.toLowerCase().trim()) || null
          };
          return acc;
        }, {});

        const getAdvertiserAdCount = async (advertiser) => {
          let totalAdsCount = 0;

          const advertiserIndexConfigs = [
            { index: NETWORK_INDEXES.facebook, field: "facebook_ad_post_owners.post_owner_name" },
            { index: NETWORK_INDEXES.instagram, field: "instagram_ad_post_owners.post_owner_name" }
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
            index: NETWORK_INDEXES.facebook,
            field: "facebook_ad_post_owners.post_owner_name"
          },
          {
            index: NETWORK_INDEXES.instagram,
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


    // Per-server work for getCompetitorsCount, extracted so it can be QUEUED
    // through withLimit() (see the caller) instead of every server firing at
    // once across every concurrent competitor request the frontend sends.
    // Queuing only ever DELAYS a request's turn — it never skips, times out,
    // or returns empty data; every competitor still gets its full, correct
    // numbers, just resolved one/few-at-a-time instead of all simultaneously.
    // Mutates `totals` (one shared accumulator per getCompetitorsCount call).
    async _getCompetitorsCountForServer({
      serverName, serverData, competitor, supportedCountryInfo, ranges, totals,
      advertiserIndexConfigs, dateFieldMap, countryIndexConfigs,
    }) {
      const client = this.esClient[serverName];

      const relevantAdv = advertiserIndexConfigs.filter(c => serverData.indexes.includes(c.index));
      const relevantDate = Object.entries(dateFieldMap).filter(([i]) => serverData.indexes.includes(i));
      const relevantCntry = countryIndexConfigs.filter(c => serverData.indexes.includes(c.index));

      const index_to_platform = {
        [NETWORK_INDEXES.facebook]: 'facebook',
        [NETWORK_INDEXES.instagram]: 'instagram',
        [NETWORK_INDEXES.google]: 'google'
      };

      const countPromises = relevantAdv.map(({index}) => {
        /* v8 ignore next -- advertiserIndexConfigs only yields mapped platforms, so the `undefined` fallback is unreachable */
        const platform = index_to_platform[index] || 'undefined';
        const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
        const ownerClause = buildOwnerClause(index, competitor);
        const countryClause = buildCountryFilterClause(index, COUNTRY_FIELD_BY_INDEX[index], supportedCountryInfo);
        const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
        return {
          platform,
          promise: dedupCount(client, index, {
            must: [ownerClause],
            ...(filter.length  && { filter }),
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
        // google_ads_data_v2.country is keyword-typed directly (no `.keyword`
        // sub-field), so `country.keyword` returns empty buckets. Facebook/
        // Instagram `*_country_only.country` is text WITH a `.keyword`
        // sub-field, so it needs the suffix. Append `.keyword` only when the
        // field isn't already keyword-aggregatable.
        const finalField = countryFieldForIndex(index, countryField);
        const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
        const ownerClause = buildOwnerClause(index, competitor);
        const countryClause = buildCountryFilterClause(index, countryField, supportedCountryInfo);
        const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
        return client.search({
          index,
          size: 0,
          body: {
            query: {
              bool: {
                must: [ownerClause],
                ...(filter.length  && { filter }),
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
          if (b.key) {
            const key = b.key.toLowerCase();
            totals.uniqueCountries.add(key);
            totals.countryCounts[key] = (totals.countryCounts[key] || 0) + (b.doc_count || 0);
          }
        });
      });

      /* ────── Date-range Counts — ONE query per index instead of 5 ──────
       * Collapsed 2026-08-17: the SAME 5 cardinality results (yesterday/
       * today/lastWeek/lastMonth/lastYear) computed as 5 `filter` sub-
       * aggregations inside ONE search instead of 5 separate round trips —
       * identical numbers, 1/5th the ES calls. This function already runs
       * once per competitor per server, so every query removed here is N
       * fewer real ES calls whenever the frontend asks for N competitors.
       * Falls back to the original per-label dedupCount loop on any error,
       * so a malformed agg response can never silently zero out real data. */
      for (const [idx, fields] of relevantDate) {
        const idField = AD_ID_FIELD_BY_INDEX[idx];
        const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(idx);
        const ownerClause = buildOwnerClause(idx, competitor);
        const countryClause = buildCountryFilterClause(idx, COUNTRY_FIELD_BY_INDEX[idx], supportedCountryInfo);
        const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;

        const rangeAggs = {};
        for (const [label, { isoStart, isoEnd }] of Object.entries(ranges)) {
          const rangeQ = fields.map(f => ({ range: { [f]: { gte: isoStart, lte: isoEnd } } }));
          const existsQ = fields.map(f => ({ exists: { field: f } }));
          rangeAggs[label] = {
            filter: {
              bool: {
                must: [
                  { bool: { should: rangeQ, minimum_should_match: 1 } },
                  { bool: { should: existsQ, minimum_should_match: 1 } },
                ],
              },
            },
            aggs: { unique_ads: { cardinality: { field: idField, precision_threshold: 40000 } } },
          };
        }

        try {
          const r = await client.search({
            index: idx,
            size: 0,
            body: {
              query: {
                bool: {
                  must: [ownerClause],
                  ...(filter.length && { filter }),
                  ...(mustNotClauses.length && { must_not: mustNotClauses }),
                },
              },
              aggs: rangeAggs,
            },
          });
          for (const label of Object.keys(ranges)) {
            totals[`${label}AdsCount`] += r?.aggregations?.[label]?.unique_ads?.value || 0;
          }
        } catch (aggErr) {
          logger.error(`[getCompetitorsCount] combined date-range agg failed for ${idx}, falling back to per-range queries: ${aggErr.message}`);
          for (const [label, { isoStart, isoEnd }] of Object.entries(ranges)) {
            const rangeQ = fields.map(f => ({ range: { [f]: { gte: isoStart, lte: isoEnd } } }));
            const existsQ = fields.map(f => ({ exists: { field: f } }));
            const cnt = await dedupCount(client, idx, {
              must: [
                ownerClause,
                { bool: { should: rangeQ, minimum_should_match: 1 } },
                { bool: { should: existsQ, minimum_should_match: 1 } },
              ],
              ...(filter.length && { filter }),
              ...(mustNotClauses.length && { must_not: mustNotClauses }),
            });
            totals[`${label}AdsCount`] += cnt;
          }
        }
      }
    }

    async getCompetitorsCount(req, res) {
      try {
        let competitor = (req?.body?.competitors || "");
        if (!competitor) {
          return res.send(Response.validationFailResp("Missing competitors in request body", ""));
        }
    
        competitor = Array.isArray(competitor) ? competitor[0] : competitor;

        const cacheKey = String(competitor).trim().toLowerCase();
        const cachedBody = getCachedCompetitorCount(cacheKey);
        if (cachedBody) {
          return res.send(Response.userSuccessResp("Counts fetched successfully", cachedBody));
        }

        const supportedCountryInfo = await getSupportedCountryInfo();
        const advertiserIndexConfigs = [
          { index: NETWORK_INDEXES.facebook, field: 'facebook_ad_post_owners.post_owner_name' },
          { index: NETWORK_INDEXES.instagram, field: 'instagram_ad_post_owners.post_owner_name' },
          { index: NETWORK_INDEXES.google, field: 'post_owner_name' }
        ];
    
        const countryIndexConfigs = [
          { index: NETWORK_INDEXES.facebook, field: 'facebook_ad_post_owners.post_owner_name', countryField: 'country_only.country' },
          { index: NETWORK_INDEXES.instagram, field: 'instagram_ad_post_owners.post_owner_name', countryField: 'instagram_country_only.country' },
          { index: NETWORK_INDEXES.google, field: 'post_owner_name', countryField: 'country' }
        ];
    
        // Match the search builders: ads in a date bucket are those *last seen*
        // in that window — not just those first seen. Using firstSeenOn*
        // undercounts long-running ads that are still active "today".
        // See facebook/instagram/google SearchMixQueryBuilder._getLastSeenEnv.
        const dateFieldMap = {
          [NETWORK_INDEXES.facebook]: ['facebook_ad.last_seen'],
          [NETWORK_INDEXES.instagram]: ['instagram_ad.last_seen'],
          [NETWORK_INDEXES.google]: ['last_seen']
        };
    
        const getRange = (duration) => {
          let start, end;
          if (duration === 'yesterday') {
            start = nowIST().subtract(1, 'day').startOf('day');
            end = nowIST().subtract(1, 'day').endOf('day');
          } else if (duration === 'today') {
            start = nowIST().startOf('day');
            end = nowIST();
          } else if (duration === 'week') {
            start = nowIST().subtract(7, 'days').startOf('day');
            end = nowIST().subtract(1, 'day').endOf('day');
          } else {
            start = nowIST().subtract(1, duration).startOf(duration);
            end = nowIST().subtract(1, duration).endOf(duration);
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
          uniqueCountries: new Set(),
          // country (lowercased) → combined doc_count across platforms; ranks
          // "Top Country" by the true leading bucket, not query/insertion order.
          countryCounts: {}
        };

        // Budget/impression/popularity are computed by the standalone
        // getCompetitorBudgetStats() below (extracted so snapshotService and
        // other callers reuse the exact same ES aggregations instead of
        // re-deriving them here).
        for (const [serverName, serverData] of Object.entries(this.esServers)) {
         try {
          // withLimit QUEUES concurrent calls to the same ES server instead of
          // dropping/skipping them (2026-08-17) — this endpoint is called once
          // PER COMPETITOR from the frontend list view, so N competitors means
          // N concurrent invocations of this whole function. Every one of them
          // still gets its real, correct data — this only paces how many are
          // actively querying a given server's ES at once, so a 15-competitor
          // list doesn't throw ~45 simultaneous requests at one cluster.
          await withLimit(serverName, () => this._getCompetitorsCountForServer({
            serverName, serverData, competitor, supportedCountryInfo, ranges, totals,
            advertiserIndexConfigs, dateFieldMap, countryIndexConfigs,
          }), 2);
         } catch (serverErr) {
            // One ES cluster (network) is down/slow → skip it and keep the data
            // from the others. Better partial counts than a failed request.
            logger.error(`[getCompetitorsCount] server "${serverName}" failed — skipping, returning partial result: ${serverErr.message}`);
            continue;
          }
        }


        // averageImpression/averagePopularity/averageBudget/totalBudget (the
        // "Estimated Total Ad Budget" shown in the dashboard — a calculated
        // proxy from the per-ad `averagebudget` field, not real ad spend) all
        // come from the shared helper so this stays identical to what
        // snapshotService persists for the same competitor.
        const budgetStats = await this.getCompetitorBudgetStats(competitor, supportedCountryInfo);

        const responseBody = {
          ...totals,
          // Keep the raw per-country buckets so the UI can drive click-through
          // searches with the same full country set that produced the counts.
          countryCounts: totals.countryCounts,
          // Ranked by combined doc_count desc so "Top Country" reflects the true
          // leading bucket across platforms, not query/insertion order.
          uniqueCountries: Object.entries(totals.countryCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name),
          averageImpression: budgetStats.averageImpression,
          averagePopularity: budgetStats.averagePopularity,
          averageBudget: budgetStats.averageBudget,
          totalBudget: budgetStats.totalBudget,
        };
        setCachedCompetitorCount(cacheKey, responseBody);
        return res.send(Response.userSuccessResp("Counts fetched successfully", responseBody));
    
      } catch (error) {
        console.error("Error fetching from Elasticsearch:", error);
        return res.send(Response.userFailResp("Internal server error", error));
      }
    }

    // Per-platform impression/popularity/budget stats for a single
    // advertiser/competitor name, averaged across platforms. Extracted from
    // getCompetitorsCount's former inline `fetchGlobalStatsES6` closure so
    // snapshotService (and any other caller) gets the exact same numbers
    // without re-deriving the ES aggregations.
    // NOTE: budget figures are a calculated proxy — Σ(per-ad `averagebudget`)
    // — not real disclosed ad spend. No "total budget" field is stored in any
    // index; this derivation must be kept everywhere budget is displayed.
    // Returns { averageImpression, averagePopularity, averageBudget, totalBudget,
    //   byPlatform: { facebook, instagram, google } } where each byPlatform
    //   entry is { averageImpression, averagePopularity, averageBudget, totalBudget }.
    async getCompetitorBudgetStats(name, supportedCountryInfo = null) {
      supportedCountryInfo = supportedCountryInfo || await getSupportedCountryInfo();
      const platformConfigs = [
        { index: NETWORK_INDEXES.facebook, impField: 'facebook_ad.impression', popField: 'facebook_ad.popularity', budField: 'facebook.averagebudget' },
        { index: NETWORK_INDEXES.instagram, impField: 'instagram_ad.impression', popField: 'instagram_ad.popularity', budField: 'instagram.averagebudget' },
        { index: NETWORK_INDEXES.google, impField: 'impression', popField: 'popularity', budField: 'averagebudget' },
      ];

      const fetchOne = async (client, { index, impField, popField, budField }) => {
        const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
        const ownerClause = buildOwnerClause(index, name);
        const countryClause = buildCountryFilterClause(index, COUNTRY_FIELD_BY_INDEX[index], supportedCountryInfo);
        const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
        const res = await client.search({
          index,
          size: 0,
          body: {
            query: {
              bool: {
                must: [ownerClause],
                ...(filter.length  && { filter }),
                ...(mustNotClauses.length && { must_not: mustNotClauses }),
              },
            },
            aggs: {
              impressions: {
                filter: { exists: { field: impField } },
                aggs: {
                  total_imp: { sum: { field: impField } },
                  imp_count: { value_count: { field: impField } },
                },
              },
              popularity: {
                filter: { exists: { field: `${popField}.current` } },
                aggs: {
                  total_pop: { sum: { field: `${popField}.current`, missing: 0 } },
                  pop_count: { value_count: { field: `${popField}.current` } },
                },
              },
              budget: {
                filter: { exists: { field: budField } },
                aggs: {
                  // No stored "total budget" field exists — only a per-ad
                  // average. The alias name keeps the derivation explicit.
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
        const totalBudget = bud.sum_avg_budget?.value || 0;
        const avgBudget = (bud.budget_count?.value || 0) > 0
          ? totalBudget / (bud.budget_count?.value || 0)
          : 0;

        return { averageImpression: avgImpression, averagePopularity: avgPopularity, averageBudget: avgBudget, totalBudget };
      };

      let facebookStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };
      let instagramStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };
      let googleStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };

      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        try {
          const client = this.esClient[serverName];
          for (const cfg of platformConfigs) {
            if (!serverData.indexes.includes(cfg.index)) continue;
            const stats = await fetchOne(client, cfg);
            if (cfg.index === NETWORK_INDEXES.facebook) facebookStats = stats;
            else if (cfg.index === NETWORK_INDEXES.instagram) instagramStats = stats;
            else if (cfg.index === NETWORK_INDEXES.google) googleStats = stats;
          }
        } catch (serverErr) {
          // One ES cluster (network) is down/slow → skip it and keep the data
          // from the others. Better partial stats than a failed request.
          logger.error(`[getCompetitorBudgetStats] server "${serverName}" failed — skipping, returning partial result: ${serverErr.message}`);
          continue;
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

      const averageImpression = getValidAverage(facebookStats.averageImpression, instagramStats.averageImpression, googleStats.averageImpression);
      const averagePopularity = getValidAverage(facebookStats.averagePopularity, instagramStats.averagePopularity, googleStats.averagePopularity);
      const averageBudget = getValidAverage(facebookStats.averageBudget, instagramStats.averageBudget, googleStats.averageBudget);
      // totalBudget is a real sum across platforms (not an average).
      const totalBudget = Number(
        ((facebookStats.totalBudget || 0) + (instagramStats.totalBudget || 0) + (googleStats.totalBudget || 0)).toFixed(2)
      );

      return {
        averageImpression,
        averagePopularity,
        averageBudget,
        totalBudget,
        byPlatform: { facebook: facebookStats, instagram: instagramStats, google: googleStats },
      };
    }

    // Per-platform ad counts for a single advertiser/competitor name.
    // Mirrors getCompetitorsCount's logic (owner match, NAS filters, last_seen
    // range, ad-id dedup) but keeps the per-platform split (facebook /
    // instagram) and three buckets: all-time, today and yesterday.
    // All ES queries for the name are fired in parallel.
    // Returns { allTime:{facebook,instagram,total}, today:{...}, yesterday:{...} }.
    async getCompetitorAdStats(name, supportedCountryInfo = null) {
      supportedCountryInfo = supportedCountryInfo || await getSupportedCountryInfo();
      // Mirror getCompetitorsCount: count facebook + instagram + google so the
      // all-time `ads` total here equals that API's `competitorsCount`.
      const indexPlatform = {
        [NETWORK_INDEXES.facebook]: 'facebook',
        [NETWORK_INDEXES.instagram]: 'instagram',
        [NETWORK_INDEXES.google]: 'google',
      };
      const dateField = {
        [NETWORK_INDEXES.facebook]: 'facebook_ad.last_seen',
        [NETWORK_INDEXES.instagram]: 'instagram_ad.last_seen',
        [NETWORK_INDEXES.google]: 'last_seen',
      };
      const FMT = "YYYY-MM-DD HH:mm:ss";
      const ranges = {
        today: {
          gte: nowIST().startOf('day').format(FMT),
          lte: nowIST().format(FMT),
        },
        yesterday: {
          gte: nowIST().subtract(1, 'day').startOf('day').format(FMT),
          lte: nowIST().subtract(1, 'day').endOf('day').format(FMT),
        },
        last7days: {
          // "Last week": the previous 7 full days ending yesterday (today
          // excluded) — mirrors getCompetitorsCount's getRange("week") that
          // powers lastWeekAdsCount.
          gte: nowIST().subtract(7, 'days').startOf('day').format(FMT),
          lte: nowIST().subtract(1, 'day').endOf('day').format(FMT),
        },
      };

      const blank = () => ({ facebook: 0, instagram: 0, google: 0, total: 0 });
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
          const countryClause = buildCountryFilterClause(idx, COUNTRY_FIELD_BY_INDEX[idx], supportedCountryInfo);
          const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
          const buildQuery = (extraMust = []) => ({
            must: [ownerClause, ...extraMust],
            ...(filter.length  && { filter }),
            /* v8 ignore next -- search_mix/instagram_search_mix have must_not:[], so the non-empty spread branch is unreachable here */
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
    async getCompetitorAdCountForRange(name, gte, lte, supportedCountryInfo = null) {
      supportedCountryInfo = supportedCountryInfo || await getSupportedCountryInfo();
      // Mirror getCompetitorsCount: include google so the chart's ad counts
      // match (facebook + instagram + google).
      const indexPlatform = { [NETWORK_INDEXES.facebook]: 'facebook', [NETWORK_INDEXES.instagram]: 'instagram', [NETWORK_INDEXES.google]: 'google' };
      const dateField = { [NETWORK_INDEXES.facebook]: 'facebook_ad.last_seen', [NETWORK_INDEXES.instagram]: 'instagram_ad.last_seen', [NETWORK_INDEXES.google]: 'last_seen' };
      const hasRange = Boolean(gte && lte);

      const jobs = []; // { platform, promise }
      for (const [serverName, serverData] of Object.entries(this.esServers)) {
        const client = this.esClient[serverName];
        for (const idx of Object.keys(indexPlatform)) {
          if (!serverData.indexes.includes(idx)) continue;
          const field = dateField[idx];
          const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(idx);
          const ownerClause = buildOwnerClause(idx, name);
          const countryClause = buildCountryFilterClause(idx, COUNTRY_FIELD_BY_INDEX[idx], supportedCountryInfo);
          const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
          const must = [ownerClause];
          if (hasRange) must.push({ range: { [field]: { gte, lte } } }, { exists: { field } });
          jobs.push({
            platform: indexPlatform[idx],
            promise: dedupCount(client, idx, {
              must,
              ...(filter.length  && { filter }),
              /* v8 ignore next -- search_mix/instagram_search_mix have must_not:[], so the non-empty spread branch is unreachable here */
              ...(mustNotClauses.length && { must_not: mustNotClauses }),
            }),
          });
        }
      }

      const results = await Promise.all(jobs.map(j => j.promise));
      const out = { facebook: 0, instagram: 0, google: 0, total: 0 };
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
    // POST /competitors-trend-batch  Body: { request_id, days? }
    // Returns the project's own brand trend plus every MONITORED competitor's
    // trend (unmonitored competitors on the table have no snapshot rows —
    // snapshotService only snapshots monitoring[], not the full competitors[]
    // list, to avoid wasting ES load on competitors nobody is tracking).
    // days is clamped to 7 or 30 (the two windows the UI toggles between).
    // One batched call so a 20+ row table doesn't fire N+1 requests.
    async getCompetitorsTrend(req, res) {
      try {
        const { request_id, days } = req?.body || {};
        if (!request_id) {
          return res.send(Response.validationFailResp("Missing request_id in request body", ""));
        }
        const windowDays = Number(days) === 30 ? 30 : 7;

        const project = await Competitors_request.findById(request_id, { monitoring: 1 }).lean();
        if (!project) {
          return res.send(Response.userFailResp("Brand request not found", ""));
        }

        const cutoff = nowIST().subtract(windowDays - 1, "days").format("YYYY-MM-DD");
        const brandKey = String(request_id);
        const competitorIds = (project.monitoring || []).map((id) => String(id));

        const [brandRows, competitorRows] = await Promise.all([
          CompetitorSnapshot.find({ subject_type: "brand", subject_key: brandKey, date: { $gte: cutoff } })
            .sort({ date: 1 }).lean(),
          competitorIds.length
            ? CompetitorSnapshot.find({ subject_type: "competitor", subject_key: { $in: competitorIds }, date: { $gte: cutoff } })
                .sort({ date: 1 }).lean()
            : [],
        ]);

        const competitors = {};
        competitorRows.forEach((r) => {
          if (!competitors[r.subject_key]) competitors[r.subject_key] = [];
          competitors[r.subject_key].push({ date: r.date, ...r.metrics });
        });

        return res.send(Response.userSuccessResp("Competitor trend fetched", {
          request_id,
          days: windowDays,
          brand: brandRows.map((r) => ({ date: r.date, ...r.metrics })),
          competitors,
        }));
      } catch (error) {
        logger.error(`[getCompetitorsTrend] ${error.message}`);
        return res.send(Response.userFailResp("Internal server error", error.message));
      }
    }

    async getCompetitorAdsByRange(req, res) {
      try {
        const { request_id, from, to, all } = req?.body || {};
        if (!request_id) {
          return res.send(Response.validationFailResp("Missing request_id in request body", ""));
        }

        const allTime = all === true || all === "true";
        const FMT = "YYYY-MM-DD HH:mm:ss";
        const gte = allTime ? null : (from ? moment(from, "YYYY-MM-DD", true) : nowIST().subtract(30, "days"))
          .startOf("day").format(FMT);
        const lte = allTime ? null : (to ? moment(to, "YYYY-MM-DD", true) : nowIST())
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
              google: s.google,
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
          target.google += src.google;
          target.total += src.total;
        };

        const brandNameSet = new Set();   // distinct brand names across the user's projects
        const competitorIdSet = new Set(); // distinct competitors across the user's projects
        const totalAdsToday = { facebook: 0, instagram: 0, google: 0, total: 0 };
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
                  url: normalizeUrl(c.competitor_url),  // ensure absolute (https://) so the link is clickable
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
          const brandAdsToday = { facebook: 0, instagram: 0, google: 0, total: 0 };
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
          { index: NETWORK_INDEXES.facebook, field: 'facebook_ad_post_owners.post_owner_name', fieldPrefix: 'facebook' },
          { index: NETWORK_INDEXES.instagram, field: 'instagram_ad_post_owners.post_owner_name', fieldPrefix: 'instagram' },
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
    if (!COMPETITOR_STATS_USE_MSEARCH) {
      return this.getCompetitorsCountNewLegacy(req, res);
    }
    return this.getCompetitorsCountNewMsearch(req, res);
  }

  /**
   * Elasticsearch 6.8 optimized competitor hydration.
   *
   * One subsearch scans each competitor/network combination once and computes
   * counts, date buckets, countries and numeric metrics together. Subsearches
   * are transported in bounded _msearch chunks, reducing the old endpoint's
   * repeated ES round trips while retaining per-network partial results.
   */
  async getCompetitorsCountNewMsearch(req, res) {
    const startedAt = Date.now();
    try {
      const input = req?.body?.competitors;
      if (!input) {
        return res.send(Response.validationFailResp("Missing competitors in request body", ""));
      }

      const isArray = Array.isArray(input);
      const competitors = isArray ? input : [input];
      const uniqueCompetitors = [...new Set(competitors.map((name) => String(name)))];
      const supportedCountryInfo = await getSupportedCountryInfo();

      const getRange = (duration) => {
        let start;
        let end;
        if (duration === "yesterday") {
          start = nowIST().subtract(1, "day").startOf("day");
          end = nowIST().subtract(1, "day").endOf("day");
        } else if (duration === "today") {
          start = nowIST().startOf("day");
          // endOf("day"), not now() — a range ending "now" changes every
          // second, so ES's request cache (keyed on the exact query body)
          // never gets a hit. Future ads aren't matched until indexed, so
          // this doesn't pull in anything that hasn't happened yet.
          end = nowIST().endOf("day");
        } else if (duration === "week") {
          start = nowIST().subtract(7, "days").startOf("day");
          end = nowIST().subtract(1, "day").endOf("day");
        } else {
          start = nowIST().subtract(1, duration).startOf(duration);
          end = nowIST().subtract(1, duration).endOf(duration);
        }
        return {
          isoStart: start.format("YYYY-MM-DD HH:mm:ss"),
          isoEnd: end.format("YYYY-MM-DD HH:mm:ss"),
        };
      };

      const ranges = {
        yesterday: getRange("yesterday"),
        today: getRange("today"),
        lastWeek: getRange("week"),
        lastMonth: getRange("month"),
        lastYear: getRange("year"),
      };

      const networkConfigs = [
        {
          network: "facebook",
          index: NETWORK_INDEXES.facebook,
          countryField: COUNTRY_FIELD_BY_INDEX[NETWORK_INDEXES.facebook],
          dateField: "facebook_ad.last_seen",
          impressionField: "facebook_ad.impression",
          popularityField: "facebook_ad.popularity.current",
          budgetField: "facebook.averagebudget",
        },
        {
          network: "instagram",
          index: NETWORK_INDEXES.instagram,
          countryField: COUNTRY_FIELD_BY_INDEX[NETWORK_INDEXES.instagram],
          dateField: "instagram_ad.last_seen",
          impressionField: "instagram_ad.impression",
          popularityField: "instagram_ad.popularity.current",
          budgetField: "instagram.averagebudget",
        },
        {
          network: "google",
          index: NETWORK_INDEXES.google,
          countryField: COUNTRY_FIELD_BY_INDEX[NETWORK_INDEXES.google],
          dateField: "last_seen",
          // Google ads do not provide the FB/IG-derived engagement and budget
          // fields. Omitting those aggregations also prevents a mapping drift
          // from failing an otherwise valid Google count/date/country search.
          supportsMetrics: false,
        },
      ];

      const blankPlatformStats = () => ({
        averageImpression: 0,
        averagePopularity: 0,
        averageBudget: 0,
        totalBudget: 0,
      });
      const makeAccumulator = () => ({
        totals: {
          competitorsCount: 0,
          yesterdayAdsCount: 0,
          todayAdsCount: 0,
          lastWeekAdsCount: 0,
          lastMonthAdsCount: 0,
          lastYearAdsCount: 0,
          platformCompetitorCount: { facebook: 0, instagram: 0, google: 0 },
          countryCounts: {},
        },
        byPlatform: {
          facebook: blankPlatformStats(),
          instagram: blankPlatformStats(),
          google: blankPlatformStats(),
        },
      });
      const accumulators = Object.fromEntries(
        uniqueCompetitors.map((competitor) => [competitor, makeAccumulator()]),
      );

      const cardinality = (field) => ({
        cardinality: { field, precision_threshold: 40000 },
      });
      // Date-range buckets (yesterday/today/week/month/year) run once PER
      // range PER competitor PER network — 5 sketches vs. the all-time
      // count's 1. Each date bucket's real cardinality is far smaller than
      // the all-time total, so it doesn't need the same high precision;
      // dropping to ES's own default (3000) here is what actually removed
      // the multi-hundred-ms cost measured in production Kibana profiling.
      const dateCardinality = (field) => ({ cardinality: { field } });
      const COUNTRY_BUCKET_SIZE = 50; // was 1000 — top buckets by doc_count already surface the real leaders

      const buildSearchBody = (cfg, competitor) => {
        const { filter: mediaFilters, mustNot } = nasClausesFor(cfg.index);
        const countryClause = buildCountryFilterClause(
          cfg.index,
          cfg.countryField,
          supportedCountryInfo,
        );
        const filter = countryClause ? [...mediaFilters, countryClause] : mediaFilters;
        const dateAggregations = Object.fromEntries(
          Object.entries(ranges).map(([label, { isoStart, isoEnd }]) => [
            `${label}Ads`,
            {
              filter: {
                bool: {
                  must: [
                    { range: { [cfg.dateField]: { gte: isoStart, lte: isoEnd } } },
                    { exists: { field: cfg.dateField } },
                  ],
                },
              },
              aggs: { unique_ads: dateCardinality(AD_ID_FIELD_BY_INDEX[cfg.index]) },
            },
          ]),
        );
        const metricAggregations = cfg.supportsMetrics === false ? {} : {
          impressions: {
            filter: { exists: { field: cfg.impressionField } },
            aggs: {
              total_imp: { sum: { field: cfg.impressionField } },
              imp_count: { value_count: { field: cfg.impressionField } },
            },
          },
          popularity: {
            filter: { exists: { field: cfg.popularityField } },
            aggs: {
              total_pop: { sum: { field: cfg.popularityField, missing: 0 } },
              pop_count: { value_count: { field: cfg.popularityField } },
            },
          },
          budget: {
            filter: { exists: { field: cfg.budgetField } },
            aggs: {
              // Budget is a calculated proxy: sum the per-ad averagebudget.
              sum_avg_budget: { sum: { field: cfg.budgetField } },
              budget_count: { value_count: { field: cfg.budgetField } },
            },
          },
        };

        return {
          size: 0,
          query: {
            bool: {
              must: [buildOwnerClause(cfg.index, competitor)],
              ...(filter.length && { filter }),
              ...(mustNot.length && { must_not: mustNot }),
            },
          },
          aggs: {
            unique_ads: cardinality(AD_ID_FIELD_BY_INDEX[cfg.index]),
            countries: {
              terms: {
                field: countryFieldForIndex(cfg.index, cfg.countryField),
                size: COUNTRY_BUCKET_SIZE,
              },
            },
            ...dateAggregations,
            ...metricAggregations,
          },
        };
      };

      const mergeNetworkResponse = (cfg, competitor, response) => {
        const accumulator = accumulators[competitor];
        const aggregations = response?.aggregations || {};
        const count = aggregations.unique_ads?.value || 0;
        accumulator.totals.platformCompetitorCount[cfg.network] += count;
        accumulator.totals.competitorsCount += count;

        for (const label of Object.keys(ranges)) {
          accumulator.totals[`${label}AdsCount`] +=
            aggregations[`${label}Ads`]?.unique_ads?.value || 0;
        }

        for (const bucket of aggregations.countries?.buckets || []) {
          if (!bucket?.key) continue;
          const key = String(bucket.key).toLowerCase();
          if (!isSupportedCountryKey(key, supportedCountryInfo)) continue;
          accumulator.totals.countryCounts[key] =
            (accumulator.totals.countryCounts[key] || 0) + (bucket.doc_count || 0);
        }

        const impressions = aggregations.impressions || {};
        const popularity = aggregations.popularity || {};
        const budget = aggregations.budget || {};
        const impressionCount = impressions.imp_count?.value || 0;
        const popularityCount = popularity.pop_count?.value || 0;
        const budgetCount = budget.budget_count?.value || 0;
        const totalBudget = budget.sum_avg_budget?.value || 0;

        accumulator.byPlatform[cfg.network] = {
          averageImpression: impressionCount > 0
            ? (impressions.total_imp?.value || 0) / impressionCount
            : 0,
          averagePopularity: popularityCount > 0
            ? (popularity.total_pop?.value || 0) / popularityCount
            : 0,
          averageBudget: budgetCount > 0 ? totalBudget / budgetCount : 0,
          totalBudget,
        };
      };

      const networkTimings = {};
      let failedSubsearches = 0;

      // Networks live on independent clusters. Run one bounded job per network;
      // chunks inside a network stay sequential to cap request and response size.
      await Promise.all(networkConfigs.map(async (cfg) => {
        const serverEntry = Object.entries(this.esServers)
          .find(([, serverData]) => serverData.indexes.includes(cfg.index));
        const networkStartedAt = Date.now();

        if (!serverEntry) {
          failedSubsearches += uniqueCompetitors.length;
          networkTimings[cfg.network] = {
            ms: 0,
            batches: 0,
            failed: uniqueCompetitors.length,
          };
          logger.error(`[getCompetitorsCountNew] no ES server configured for ${cfg.network}`);
          return;
        }

        const [serverName] = serverEntry;
        const client = this.esClient[serverName];
        let batches = 0;
        let networkFailures = 0;

        for (
          let offset = 0;
          offset < uniqueCompetitors.length;
          offset += COMPETITOR_MSEARCH_BATCH_SIZE
        ) {
          const chunk = uniqueCompetitors.slice(
            offset,
            offset + COMPETITOR_MSEARCH_BATCH_SIZE,
          );
          const body = chunk.flatMap((competitor) => [
            {},
            buildSearchBody(cfg, competitor),
          ]);
          batches += 1;

          try {
            // Same per-server key/limit as _getCompetitorsCountForServer above,
            // so this endpoint and the single-competitor one share one real
            // concurrency budget against each ES server instead of each
            // silently assuming it owns the whole cluster.
            const result = await withLimit(serverName, () => client.msearch({
              index: cfg.index,
              maxConcurrentSearches: COMPETITOR_MSEARCH_MAX_CONCURRENT_SEARCHES,
              maxConcurrentShardRequests: COMPETITOR_MSEARCH_MAX_CONCURRENT_SHARD_REQUESTS,
              request_cache: true,
              body,
            }), 2);
            const responses = result?.responses || [];

            chunk.forEach((competitor, index) => {
              const response = responses[index];
              if (!response || response.error) {
                failedSubsearches += 1;
                networkFailures += 1;
                logger.error(
                  `[getCompetitorsCountNew] ${cfg.network} subsearch failed for one competitor`,
                  response?.error || "missing msearch response",
                );
                return;
              }
              mergeNetworkResponse(cfg, competitor, response);
            });
          } catch (error) {
            failedSubsearches += chunk.length;
            networkFailures += chunk.length;
            logger.error(
              `[getCompetitorsCountNew] ${cfg.network} msearch batch failed; returning partial data`,
              error,
            );
          }
        }

        networkTimings[cfg.network] = {
          ms: Date.now() - networkStartedAt,
          batches,
          failed: networkFailures,
        };
      }));

      const getValidAverage = (values) => {
        const positiveValues = values.filter((value) => value > 0);
        return positiveValues.length
          ? Number(
            (positiveValues.reduce((sum, value) => sum + value, 0) /
              positiveValues.length).toFixed(2),
          )
          : 0;
      };

      const finalResults = Object.fromEntries(uniqueCompetitors.map((competitor) => {
        const { totals, byPlatform } = accumulators[competitor];
        const platformStats = Object.values(byPlatform);
        return [competitor, {
          ...totals,
          uniqueCountries: Object.entries(totals.countryCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name),
          averageImpression: getValidAverage(
            platformStats.map((stats) => stats.averageImpression),
          ),
          averagePopularity: getValidAverage(
            platformStats.map((stats) => stats.averagePopularity),
          ),
          averageBudget: getValidAverage(
            platformStats.map((stats) => stats.averageBudget),
          ),
          totalBudget: Number(
            platformStats
              .reduce((sum, stats) => sum + (stats.totalBudget || 0), 0)
              .toFixed(2),
          ),
        }];
      }));

      logger.info("[getCompetitorsCountNew] ES 6.8 msearch completed", {
        competitors: uniqueCompetitors.length,
        totalMs: Date.now() - startedAt,
        failedSubsearches,
        batchSize: COMPETITOR_MSEARCH_BATCH_SIZE,
        maxConcurrentSearches: COMPETITOR_MSEARCH_MAX_CONCURRENT_SEARCHES,
        maxConcurrentShardRequests: COMPETITOR_MSEARCH_MAX_CONCURRENT_SHARD_REQUESTS,
        networks: networkTimings,
      });

      return res.send(
        Response.userSuccessResp(
          "Counts fetched successfully",
          isArray ? finalResults : finalResults[String(input)],
        ),
      );
    } catch (error) {
      logger.error("[getCompetitorsCountNew] ES 6.8 msearch failed:", error);
      return res.send(Response.userFailResp("Internal server error", error));
    }
  }

  // Retained as an explicit config-controlled rollback path for production.
  // It must not run after a failed msearch request, because that would duplicate
  // expensive ES work; switching strategies requires a service restart.
  async getCompetitorsCountNewLegacy(req, res) {
    try {
      const input = req?.body?.competitors;
      if (!input) {
        return res.send(Response.validationFailResp("Missing competitors in request body", ""));
      }

      const isArray = Array.isArray(input);
      const competitors = isArray ? input : [input];
      const supportedCountryInfo = await getSupportedCountryInfo();

      const getRange = (duration) => {
        let start, end;
        if (duration === 'yesterday') {
          start = nowIST().subtract(1, 'day').startOf('day');
          end = nowIST().subtract(1, 'day').endOf('day');
        } else if (duration === 'today') {
          start = nowIST().startOf('day');
          end = nowIST();
        } else if (duration === 'week') {
          start = nowIST().subtract(7, 'days').startOf('day');
          end = nowIST().subtract(1, 'day').endOf('day');
        } else {
          start = nowIST().subtract(1, duration).startOf(duration);
          end = nowIST().subtract(1, duration).endOf(duration);
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
          { index: NETWORK_INDEXES.facebook, field: 'facebook_ad_post_owners.post_owner_name' },
          { index: NETWORK_INDEXES.instagram, field: 'instagram_ad_post_owners.post_owner_name' }
        ];
        const countryIndexConfigs = [
          { index: NETWORK_INDEXES.facebook, field: 'facebook_ad_post_owners.post_owner_name', countryField: 'country_only.country' },
          { index: NETWORK_INDEXES.instagram, field: 'instagram_ad_post_owners.post_owner_name', countryField: 'instagram_country_only.country' },
          // Google contributes to the competitor's country distribution too — the
          // "Top Country" column must reflect FB+IG+Google combined. google_ads_data_v2
          // .country is keyword-typed directly (no `.keyword` sub-field).
          { index: NETWORK_INDEXES.google, field: 'post_owner_name', countryField: 'country' }
        ];
        // Match the search builders: ads in a date bucket are those *last seen*
        // in that window — not just those first seen. Using firstSeenOn*
        // undercounts long-running ads that are still active "today".
        // See facebook/instagram SearchMixQueryBuilder._getLastSeenEnv.
        const dateFieldMap = {
          [NETWORK_INDEXES.facebook]: ['facebook_ad.last_seen'],
          [NETWORK_INDEXES.instagram]: ['instagram_ad.last_seen']
        };

        const totals = {
          competitorsCount: 0,
          yesterdayAdsCount: 0,
          todayAdsCount: 0,
          lastWeekAdsCount: 0,
          lastMonthAdsCount: 0,
          lastYearAdsCount: 0,
          platformCompetitorCount: { facebook: 0, instagram: 0, google: 0 },
          uniqueCountries: new Set(),
          // country (lowercased) → combined doc_count across FB+IG+Google, used to
          // rank "Top Country" by the true leading bucket, not config/insertion order.
          countryCounts: {}
        };
        let facebookStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };
        let instagramStats = { averageImpression: 0, averagePopularity: 0, averageBudget: 0, totalBudget: 0 };

        const fetchGlobalStats = async (client, index, ownerField, impField, popField, budField) => {
          const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
          const ownerClause = buildOwnerClause(index, competitor);
          const countryClause = buildCountryFilterClause(index, COUNTRY_FIELD_BY_INDEX[index], supportedCountryInfo);
          const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
          const r = await client.search({
            index, size: 0,
            body: {
              query: {
                bool: {
                  must: [ownerClause],
                  ...(filter.length  && { filter }),
                  /* v8 ignore next -- the processed indexes carry must_not:[], so the non-empty spread branch is unreachable here */
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
          /* v8 ignore next -- ES responses always include an aggregations object, so the `|| {}` is defensive */
          const a = r?.aggregations || {};
          const imp = a.impressions || {};
          const pop = a.popularity || {};
          const bud = a.budget || {};
          // totalBudget = Σ(per-ad averagebudget) for ads on this platform — computed, not stored.
          const totalBudget = bud.sum_avg_budget?.value || 0;
          return {
            /* v8 ignore next -- averageImpression defaults to 0 when the platform has no ads (no-data default) */
            averageImpression: (imp.imp_count?.value || 0) > 0 ? (imp.total_imp?.value || 0) / (imp.imp_count?.value || 0) : 0,
            /* v8 ignore next -- averagePopularity defaults to 0 when the platform has no ads (no-data default) */
            averagePopularity: (pop.pop_count?.value || 0) > 0 ? (pop.total_pop?.value || 0) / (pop.pop_count?.value || 0) : 0,
            /* v8 ignore next -- averageBudget defaults to 0 when the platform has no ads (no-data default) */
            averageBudget: (bud.budget_count?.value || 0) > 0 ? totalBudget / (bud.budget_count?.value || 0) : 0,
            totalBudget,
          };
        };

        for (const [serverName, serverData] of Object.entries(this.esServers)) {
          // Same per-server key/limit as getCompetitorsCount's
          // _getCompetitorsCountForServer (2026-08-17). This function
          // previously ran every competitor's full per-server ES work
          // unbounded in parallel via the outer Promise.all below — a
          // 20-competitor request could put ~20 competitors' worth of
          // simultaneous ES calls on the cluster with zero cap or queue.
          // Queuing each server's work through the same shared semaphore
          // used elsewhere fixes that without changing any query or result.
          await withLimit(serverName, async () => {
          const client = this.esClient[serverName];
          const index_to_platform = { [NETWORK_INDEXES.facebook]: 'facebook', [NETWORK_INDEXES.instagram]: 'instagram' };

          // Counts — deduped by ad id, with NAS filter + multilingual owner match
          for (const { index } of advertiserIndexConfigs.filter(c => serverData.indexes.includes(c.index))) {
            /* v8 ignore next -- advertiserIndexConfigs only yields mapped platforms, so the `undefined` fallback is unreachable */
            const platform = index_to_platform[index] || 'undefined';
            const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
            const ownerClause = buildOwnerClause(index, competitor);
            const countryClause = buildCountryFilterClause(index, COUNTRY_FIELD_BY_INDEX[index], supportedCountryInfo);
            const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
            const cnt = await dedupCount(client, index, {
              must: [ownerClause],
              ...(filter.length  && { filter }),
              /* v8 ignore next -- the processed indexes carry must_not:[], so the non-empty spread branch is unreachable here */
              ...(mustNotClauses.length && { must_not: mustNotClauses }),
            });
            totals.platformCompetitorCount[platform] += cnt;
            totals.competitorsCount += cnt;
          }

          // Countries
          for (const { index, countryField } of countryIndexConfigs.filter(c => serverData.indexes.includes(c.index))) {
            const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(index);
            const ownerClause = buildOwnerClause(index, competitor);
            // google_ads_data_v2.country is keyword-typed directly (no `.keyword`
            // sub-field); FB/IG `*_country_only.country` is text WITH a `.keyword`
            // sub-field. Append `.keyword` only when not already keyword-aggregatable.
            const finalField =
              countryFieldForIndex(index, countryField);
            const countryClause = buildCountryFilterClause(index, countryField, supportedCountryInfo);
            const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
            const r = await client.search({
              index, size: 0,
              body: {
                query: {
                  bool: {
                    must: [ownerClause],
                    ...(filter.length  && { filter }),
                    /* v8 ignore next -- the processed indexes carry must_not:[], so the non-empty spread branch is unreachable here */
                    ...(mustNotClauses.length && { must_not: mustNotClauses }),
                  },
                },
                aggs: { countries: { terms: { field: finalField, size: 1000 } } }
              }
            });
            // Sum doc_count per country across platforms so "Top Country" reflects
            // the true leading bucket (FB+IG+Google combined), not the order the
            // platforms happen to be queried in.
            (r?.aggregations?.countries?.buckets || []).forEach(b => {
              if (b.key) {
                const key = b.key.toLowerCase();
                if (isSupportedCountryKey(key, supportedCountryInfo)) {
                  totals.uniqueCountries.add(key);
                  totals.countryCounts[key] = (totals.countryCounts[key] || 0) + (b.doc_count || 0);
                }
              }
            });
          }

          // Date ranges — deduped by ad id, with NAS filter + multilingual owner match
          for (const [label, { isoStart, isoEnd }] of Object.entries(ranges)) {
            for (const [idx, fields] of Object.entries(dateFieldMap).filter(([i]) => serverData.indexes.includes(i))) {
              const rangeQ = fields.map(f => ({ range: { [f]: { gte: isoStart, lte: isoEnd } } }));
              const existsQ = fields.map(f => ({ exists: { field: f } }));
              const { filter: filterClauses, mustNot: mustNotClauses } = nasClausesFor(idx);
              const ownerClause = buildOwnerClause(idx, competitor);
              const countryClause = buildCountryFilterClause(idx, COUNTRY_FIELD_BY_INDEX[idx], supportedCountryInfo);
              const filter = countryClause ? [...filterClauses, countryClause] : filterClauses;
              const cnt = await dedupCount(client, idx, {
                must: [
                  ownerClause,
                  { bool: { should: rangeQ, minimum_should_match: 1 } },
                  { bool: { should: existsQ, minimum_should_match: 1 } },
                ],
                ...(filter.length  && { filter }),
                /* v8 ignore next -- the processed indexes carry must_not:[], so the non-empty spread branch is unreachable here */
                ...(mustNotClauses.length && { must_not: mustNotClauses }),
              });
              totals[`${label}AdsCount`] += cnt;
            }
          }

          // Stats
          if (serverData.indexes.includes(NETWORK_INDEXES.facebook)) {
            facebookStats = await fetchGlobalStats(client, NETWORK_INDEXES.facebook, 'facebook_ad_post_owners.post_owner_name', 'facebook_ad.impression', 'facebook_ad.popularity', 'facebook.averagebudget');
          }
          if (serverData.indexes.includes(NETWORK_INDEXES.instagram)) {
            instagramStats = await fetchGlobalStats(client, NETWORK_INDEXES.instagram, 'instagram_ad_post_owners.post_owner_name', 'instagram_ad.impression', 'instagram_ad.popularity', 'instagram.averagebudget');
          }
          }, 2);
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
          // Raw buckets stay available for click-throughs; uniqueCountries is
          // still the trimmed display list used by the table UI.
          countryCounts: totals.countryCounts,
          // Ranked by combined doc_count desc so the FE's `countries.slice(0,3)`
          // ("Top Country") shows the true leading countries across FB+IG+Google.
          uniqueCountries: Object.entries(totals.countryCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name]) => name),
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
