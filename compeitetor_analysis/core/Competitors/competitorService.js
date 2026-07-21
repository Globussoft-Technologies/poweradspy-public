
import logger from "../../resources/logs/logger.log.js";
// import { client } from "../../utils/Elasticsearch.js";
import Response from "../../utils/response.js";
import DashboardService from "../Dashboard/dashboardService.js";
import CompetitorValidation from "./competitorValidation.js";
import User_details from '../../models/user_details.js';
import Competitors from "../../models/competitors.js";
import Competitors_request from "../../models/competitors_request.js";
import config from 'config';
import { GoogleGenAI } from "@google/genai";
import mongoose from 'mongoose';
import Existing_competitors from "../../models/existing_competitors.js";
import { json } from "stream/consumers";
import axios from "axios";
import { getIO } from "../../utils/socket.js";
import { esClient, esServers, checkElasticsearchHealth } from "../../utils/Elasticsearch.js";
import UserDailyTokens from "../../models/user_daily_tokens.model.js";
import TokenSyncState from "../../models/jobTokenState.js";

// Pure — no I/O — so it's unit-testable without mocking mongoose/Elasticsearch/etc.
// Mirrors the "unlisted plan_id defaults to brandLimit 0" convention documented in
// docs/PLAN_ACCESS.md (same as plan_access_config.competitor_limits' existing semantics).
export function resolveBrandLimit(competitorLimitsDoc, planId) {
  return competitorLimitsDoc?.plan_limits?.[String(planId)]?.brandLimit ?? 0;
}

// Same convention as resolveBrandLimit — unlisted plan_id defaults to 0.
export function resolveCompetitorLimit(competitorLimitsDoc, planId) {
  return competitorLimitsDoc?.plan_limits?.[String(planId)]?.competitorLimit ?? 0;
}

// Bound for every synchronous call to the DS competitor-generation service
// (`/prepare`, `/list`, `/tokens/usage`) — used both in the request/response
// path a spinner is waiting on (checkCompetitorProcess, getStoreProcessCompetitors)
// and in the fire-and-forget background loop (generateCompetitorsInBackground).
// DS latency scales with the requested competitor count (e.g. 100 vs 15), so
// without this a slow/hung DS response leaves either the HTTP request or the
// background loop stuck indefinitely. Tune alongside the frontend's matching
// timeout in services/api.js (checkCompetitorProcess / getStoreProcessCompetitors).
const DS_REQUEST_TIMEOUT_MS = 45000;

// Loose domain-format check for the optional "Company Website URL" field on
// manual-competitor add. Accepts a bare domain or one with a protocol/www/
// path/query (e.g. "walmart.com", "www.walmart.com", "https://walmart.com/x")
// but rejects plain non-domain text (no dot, invalid characters) — previously
// nothing validated this field's format at all, so any garbage string was
// silently accepted as long as it was non-empty (see the Mongoose schema
// comment in models/competitors.js for the related required-field bug).
const isValidWebsiteUrl = (raw) => {
  if (!raw) return true; // optional field — absent/empty is valid
  const stripped = String(raw)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .split("?")[0];
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    stripped,
  );
};

// Hard ceiling DS's GET /v1/api/competitors/list enforces on its `limit` query
// param (422 above this — confirmed live). Used by competitorOverfetchLimit()
// to clamp the 20%-overfetched value we compute from the user's requested
// count, so a large request (e.g. 100, whose naive overfetch is 120) doesn't
// silently 422 on every single poll.
const DS_MAX_LIST_LIMIT = 100;

class CompetitorService {

  constructor() {
    this.esClient = esClient;
    this.esServers = esServers;
  }
async create(req, res) {
    try {
      let data = req?.body;

      if (!data) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing request data", "")
        );
      }

      let {amember_id, plan_id, plan_expiry_date, company_name, email, url, phone_number} = data;

      let emailCheck;

      try {
        emailCheck = await User_details.findOne({ email: email });
      } catch (dbErr) {
        logger.error("Database error during email lookup", dbErr);
        return res.send(
          Response.userFailResp("Database error during user check", dbErr)
        );
      }

      if(!emailCheck){
        let obj = { ...data };
        const parsedDate = new Date(obj.plan_expiry_date);
        obj.plan_expiry_date = isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();

        const { value, error } = CompetitorValidation.createDetails(obj);


        if(error){
            logger.error("VALIDATION_FAIL", error.details);
            return res.send(Response.validationFailResp("VALIDATION_FAIL", error.details));
        }

        try{
            let createdUser = await User_details.create(value);

            if(createdUser){
                return res.send(
                  Response.userSuccessResp("User created successfully", createdUser)
                ); 
            }
            else{
              logger.error("Error in registering the user");
              return res.send(Response.messageResp("Error in registering the user"));
            }

        }
        catch(err){
            logger.error("Error in creating the user", err);
            return res.send(Response.userFailResp("Error in creating the user", err));
        }
      }
      else{
        // Sync plan_id/plan_expiry_date onto the existing record — this endpoint is
        // called on every login to ensure the user exists, and previously only ever
        // inserted on first-ever visit. A subscription change (upgrade/downgrade,
        // or a new pricing-generation plan_id) never propagated here, so brand/
        // competitor-limit enforcement in insertCompRequests() kept checking a
        // stale plan_id forever. Confirmed 2026-07-14: a user's plan_id here stayed
        // pinned to whatever was true the first time this record was created.
        try {
          const set = {};
          if (plan_id !== undefined && plan_id !== null && plan_id !== "") set.plan_id = plan_id;
          const parsedDate = new Date(plan_expiry_date);
          if (!isNaN(parsedDate.getTime())) set.plan_expiry_date = parsedDate;
          if (Object.keys(set).length > 0) {
            await User_details.updateOne({ _id: emailCheck._id }, { $set: set });
          }
        } catch (syncErr) {
          logger.warn("Failed to sync plan_id on existing user_details record", { email, error: syncErr.message });
        }
        return res.send(Response.messageResp("This user already exists"));
      }



    } catch (error) {
      logger.error("Error in creating user details", error);
      return res.send(Response.userFailResp("Error in creating user details", error));
    }

  }
  async insertCompRequests(req,res){
    try{
      let data = req?.body;

      if (!data) {
        logger.error("Missing request data in body");
        return res.send(
          Response.validationFailResp("Missing request data", "")
        );
      }
      let obj = { ...data };

      const { value, error } = CompetitorValidation.createRequest(obj);

      if (error) {
        logger.error("VALIDATION_FAIL", error.details);
        return res.send(
          Response.validationFailResp("VALIDATION_FAIL", error.details)
        );
      }

      let { competitor_details, user_id, advertiser, project_name, brand_url, country, category } = value;

              if ((advertiser && Array.isArray(advertiser) && advertiser.length>0) && (user_id && user_id != "")) {
                  try {
                      let brand = advertiser[0];
                      let brandCheck = await Competitors_request.findOne({
                        user_id,
                        advertiser: {
                          $elemMatch: {
                            $regex: new RegExp(
                              "^" +
                                brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                                "$",
                              "i"
                            ),
                          },
                        },
                      });
                    
                      if (brandCheck) {
                        return res.send(
                          Response.messageResp("This brand already exists")
                        );
                      } 
                  } catch (err) {
                    logger.error("Error in finding the brand", err);
                    return res.send(
                      Response.userFailResp("Error in finding the brand", err)
                    );
                  }
              } else {
                  logger.error("Validation failed for brand");
                  return res.send(
                    Response.messageResp("Please provide proper brand name")
                  );
              }

              // ── Competitor Tracking brand quota (PRD FR-2 / docs/PLAN_ACCESS.md "Known Gaps") ──
              // brandLimit lives in plan_access_config.competitor_limits, the same collection
              // getUserBrandStats() already reads from this service's own MongoDB connection —
              // no cross-service call needed. A plan_id with no entry in plan_limits defaults to
              // brandLimit 0, matching the documented convention (this mirrors what the frontend
              // already assumes; this is just the first place it's actually enforced). A lookup
              // failure (DB unreachable, doc missing) fails OPEN — an infra hiccup here shouldn't
              // block every brand add across the product.
              try {
                const requester = await User_details.findById(user_id, { plan_id: 1 }).lean();
                const planId = requester?.plan_id ?? null;
                if (planId != null) {
                  const competitorLimitsDoc = await mongoose.connection
                    .collection('plan_access_config')
                    .findOne({ _id: 'competitor_limits' });
                  if (competitorLimitsDoc) {
                    const brandLimit = resolveBrandLimit(competitorLimitsDoc, planId);
                    const currentBrandCount = await Competitors_request.countDocuments({ user_id });
                    if (currentBrandCount >= brandLimit) {
                      logger.info("Competitor brand quota exceeded", { user_id, planId, brandLimit, currentBrandCount });
                      return res.send(
                        Response.quotaExceededResp(
                          `Your current plan allows tracking ${brandLimit} brand${brandLimit === 1 ? "" : "s"}. Please upgrade your plan to track more.`,
                          { brandLimit, currentBrandCount }
                        )
                      );
                    }
                  }
                }
              } catch (limitErr) {
                logger.warn("Competitor brand quota check failed — allowing request (fail-open)", { user_id, error: limitErr.message });
              }

      if(competitor_details && competitor_details.length!=0){
       
        try{

          let competitorNames = [];
          competitor_details.forEach((val) => {
            competitorNames = [...competitorNames, val.competitor_name]; 
          });

          const existingCompetitors = await Competitors.find({competitor_name: { $in: competitorNames }});
          let competitorIds=[];

          if(existingCompetitors && existingCompetitors.length!=0){
              existingCompetitors.forEach((val) => {
                competitorIds = [...competitorIds, val._id];
              });
          }


          const existingNames = new Set(
            existingCompetitors.map((c) => c.competitor_name)//These competitors are already inserted
          );

          const competitorsToBeInserted = competitor_details.filter((c) => //Filtering out the competitors that are to be inserted newly
            !existingNames.has(c.competitor_name)
          );

           if(competitorsToBeInserted && competitorsToBeInserted.length!=0){
            let createCompDetails = await Competitors.insertMany(competitorsToBeInserted);

            if(createCompDetails){
              createCompDetails.forEach((val)=>{
                  competitorIds = [...competitorIds, val._id]; // storing the ids for the inserted competitors
              });
            }
            else{
              logger.error("Error while storing the competitors in db");
              return res.send(
                Response.messageResp("Error while storing the competitors in db")
              );
            }
           }

           let payload = {
            user_id,
            project_name,
            advertiser,
            brand_url,
            competitors: competitorIds,
            monitoring: competitorIds,
            //need for new view
            // competitors: [], // Store only selected competitors
            // monitoring: [],  // Initial display with monitoring turned off
            country: Array.isArray(country) ? country : country ? [country] : [],
            category: Array.isArray(category) ? category : category ? [category] : []
          };

              //INSERTING INTO COMPETITOR_REQUEST COLLECTION    
               let compRequest = await Competitors_request.create(payload);

               if (compRequest) {
                 return res.send(
                   Response.userSuccessResp(
                     "Competitor Request created successfully",
                     compRequest
                   )
                 );
               } else {
                 logger.error("Error in creating the competitor request");
                 return res.send(
                   Response.messageResp(
                     "Error in creating the competitor request"
                   )
                 );
               }

        }
        catch(err){
          logger.error("Error in storing the competitor", err);
          return res.send(Response.userFailResp("Error in storing the competitor", err));
        }

      }
      else{
          return res.send(Response.messageResp("Competitor details can't be empty"));

      }

    }
   catch (error) {
    //   console.error("Error fetching document:", error);
      logger.error("Error in inserting competitors request", error);
      return res.send(Response.userFailResp("Error in inserting competitors request", error));
    }
  }

  async fetchCompetitors(req, res) {
    try {
      let data = req?.body;

      if (!data) {
        logger.error("Missing request data");
        return res.send(
          Response.validationFailResp("Missing request data", "")
        );
      }

      let { advertiser } = data;
      
      if (advertiser && Array.isArray(advertiser) && advertiser.length > 0) {

       // checking if we already have the data for this advertiser first

      let [ key ]=advertiser;

      let brandCheck = await Existing_competitors.findOne({
          advertiser: {
            $regex: new RegExp(
              "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
              "i"
            ),
          },
      }); 

      if(!brandCheck){// we dont have existing data for this advertiser

          const ai = new GoogleGenAI({
            apiKey: config.get("GEMINI_API_KEY"),
          });

          let compNumber = config.get("COMP_NUMBER");

          const prompt = `For each brand in the given list, provide:
          1. A minimum of ${compNumber} competitors.
          2. The country or countries where the brand's ads are primarily running.
          
          List of brands: [${advertiser.map((b) => `"${b}"`).join(", ")}]
          
          Ensure the response format is exactly like this:
          \`\`\`json
          [
            {
              "Brand1": {
                  "ad_countries": ["USA", "Canada"],
                  "competitors": [
                    { "name": "Competitor 1", "domain": "https://example.com", "logo": "https://example.com/no-logo.png" },
                    ...
                  ]
              }
            }
          ]
          \`\`\`

                        - Use only JSON (no markdown or explanations).
                        - Provide real and up-to-date data where possible.
                        - If a logo is unavailable, use: "https://example.com/no-logo.png".
                        `;

          const maxRetries = 3;
          let attempts = 0;

          while (attempts < maxRetries) {
              try {
                const response = await ai.models.generateContent({
                  model: "gemini-2.5-flash",
                  contents: prompt,
                });

                let text = JSON.parse(
                  this.cleanJSONResponse(response.text)
                );

                // Persist returned competitors per brand. Fire-and-forget so we
                // don't delay the response; failures are logged, not propagated.
                if (Array.isArray(text)) {
                  for (const entry of text) {
                    for (const [brand, data] of Object.entries(entry || {})) {
                      this.insertIntoExistingComp(brand, data?.competitors || [])
                        .catch((err) => logger.error("insertIntoExistingComp failed", { brand, err: err.message }));
                    }
                  }
                }

                return res.send(
                  Response.userSuccessResp(
                    "Fetched Competitors successfully",
                    text
                  )
                );
              } catch (err) {
                const isOverloaded =
                  err.message?.includes("model is overloaded") ||
                  err.message?.includes("quota") ||
                  err.message?.includes("temporarily unavailable");

                if (isOverloaded) {
                  attempts++;
                  logger.warn(
                      `Gemini model overloaded. Retry attempt ${attempts} immediately`
                  );
                } else {
                    logger.error("Error in getting competitor list", err);
                    return res.send(
                        Response.userFailResp(
                          "Error in getting competitor list",
                          err
                        )
                      );
                  }
                }
          }

          return res.send(
            Response.userFailResp(
              "Model remained overloaded after multiple attempts.",
              {}
            )
          );
      }
      else{

        let finalArr=[];
        let { competitors:existingComps } = brandCheck;
        let comps= existingComps.slice(0, 20).map(function(val){
          return {
            name: val.competitor_name,
            domain: val.competitor_url,
          };
        })
        let obj={};
        obj[key] = comps;
        finalArr.push(obj);

        return res.send(
          Response.userSuccessResp("Fetched Competitors successfully", finalArr)
        );
      }


      } else {
        logger.error("Validation failed for advertiser");
        return res.send(
          Response.messageResp("Validation failed for advertiser")
        );
      }
    } catch (error) {
      logger.error("Error in fetching competitors", error);
      return res.send(
        Response.userFailResp("Error in fetching competitors", error)
      );
    }
  }

  async checkUser(req,res){
    try{
      let data = req?.query;

      if (!data) {
        logger.error("Missing request data");
        return res.send(
          Response.validationFailResp("Missing request data", "")
        );
      }

      let { email } = data;

      if (email && email != "") {
        let checkUser = await User_details.findOne({ email });

        if (checkUser) {
          return res.json({
            statusCode: 201,
            body: {
              message: "This user exists already",
              data:checkUser,
            },
          });
        } else {
          return res.json({
            statusCode: 401,
            body: {
              message: "This user does not exist",
            },
          });
        }
      } else {
        logger.error("Validation failed for email");
        return res.send(Response.messageResp("Please provide proper email"));
      }

    }
    catch(error){
      logger.error("Error in fetching user details", error);
      return res.send(
        Response.userFailResp("Error in fetching user details", error)
      );
    }
  }
  async checkBrand(req,res){
    try{
        let data = req?.body;

        if (!data) {
          logger.error("Missing request data");
          return res.send(Response.validationFailResp("Missing request data", ""));
        }

        let { brand,user_id } = data;
        if(!user_id){
          res.send("user_id is required");
        }
        if ((brand && brand != "") || (user_id && user_id!="")) {
          try {
            let brandCheck = await Competitors_request.findOne({
              user_id,
              advertiser: {
                $elemMatch: {
                  $regex: new RegExp(
                    "^" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
                    "i"
                  ),
                },
              },
            });

            if (brandCheck) {
              return res.send(
                Response.userSuccessResp(
                  "Fetched brand details successfully",
                  brandCheck
                )
              );
            } else {
              return res.json({
                statusCode: 401,
                body: {
                  message: "This brand does not exist",
                },
              });
            }
          } catch (err) {
            logger.error("Error in finding the brand", err);
            return res.send(
              Response.userFailResp("Error in finding the brand", err)
            );
          }
        } else {
          logger.error("Validation failed for brand");
          return res.send(
            Response.messageResp("Please provide proper brand name")
          );
        }
    }
    /* v8 ignore start -- defensive outer net: checkBrand has no validation call and the DB lookup is wrapped in its own inner try/catch, so nothing outside reaches here */
    catch(error){
      logger.error("Error in fetching brand details", error);
      return res.send(
        Response.userFailResp("Error in fetching brand details", error)
      );
    }
    /* v8 ignore stop */
  }
  
  async updateMonitoring(req,res){
    try{
      let data = req?.body;

      if (!data) {
        logger.error("Missing request data");
        return res.send(
          Response.validationFailResp("Missing request data", "")
        );
      }

      let {competitor_request_id, competitor_id, status}= data;

      if(competitor_request_id && competitor_request_id!="" && competitor_id && competitor_id!="" && status !== undefined && status !== ""){
        let updateMonitoring="";
        
        let monitoringCheck = await Competitors_request.find({
          _id: competitor_request_id,
          monitoring: competitor_id,
        });

        if(status==0){ // monitoring will be on for this id

          if(monitoringCheck.length>0){
            return res.json({
              statusCode: 201,
              body: {
                message: "Monitoring is already on for this competitor",
              },
            });
          }
          else{
            // ── Competitor monitoring quota (mirrors the brand quota above) ──
            // Previously only brandLimit was ever enforced — competitorLimit (how many
            // competitors can be monitored per brand) had no check anywhere, so any plan
            // could monitor unlimited competitors. Fails open on any lookup error, same
            // as the brand quota check, so an infra hiccup doesn't block every toggle.
            try {
              const projectDoc = await Competitors_request.findOne(
                { _id: competitor_request_id },
                { user_id: 1, monitoring: 1 }
              );
              const requester = projectDoc?.user_id
                ? await User_details.findById(projectDoc.user_id, { plan_id: 1 }).lean()
                : null;
              const planId = requester?.plan_id ?? null;
              if (planId != null) {
                const competitorLimitsDoc = await mongoose.connection
                  .collection('plan_access_config')
                  .findOne({ _id: 'competitor_limits' });
                if (competitorLimitsDoc) {
                  const competitorLimit = resolveCompetitorLimit(competitorLimitsDoc, planId);
                  const currentMonitoringCount = projectDoc?.monitoring?.length ?? 0;
                  if (currentMonitoringCount >= competitorLimit) {
                    logger.info("Competitor monitoring quota exceeded", { competitor_request_id, planId, competitorLimit, currentMonitoringCount });
                    return res.send(
                      Response.quotaExceededResp(
                        `Your current plan allows monitoring ${competitorLimit} competitor${competitorLimit === 1 ? "" : "s"} per brand. Please upgrade your plan to monitor more.`,
                        { competitorLimit, currentMonitoringCount }
                      )
                    );
                  }
                }
              }
            } catch (limitErr) {
              logger.warn("Competitor monitoring quota check failed — allowing request (fail-open)", { competitor_request_id, error: limitErr.message });
            }

            updateMonitoring = await Competitors_request.updateOne(
              {
                _id: competitor_request_id,
              },
              {
                $push: { monitoring: competitor_id },
              }
            );
          }


        }
        else if(status==1){ // monitoring will be off for this id
            if (monitoringCheck.length > 0) {
              updateMonitoring = await Competitors_request.updateOne(
                {
                  _id: competitor_request_id,
                },
                {
                  $pull: { monitoring: competitor_id },
                }
              );
            } else {
              return res.json({
                statusCode: 201,
                body: {
                  message: "Monitoring is already off for this competitor",
                },
              });
            }
        }
        else{
            return res.send(Response.messageResp("Invalid status"));
        }
        
        if(updateMonitoring){
            return res.send(
              Response.userSuccessResp(
                "Updated monitoring status",
                updateMonitoring
              )
            );
        }
        else{
          return res.send(
            Response.userFailResp("Updation failed for monitoring status")
          );
        }
      }
      else{
        return res.send(Response.messageResp("Validation failed for competitor_id and status"));
      }

    }
    catch(error){
      logger.error("Error in updating monitoring status", error);
      return res.send(
        Response.userFailResp("Error in updating monitoring status", error)
      );
    }
  }

  // async updateMonitoring(req, res) { //need for new view
  //   try {
  //     const data = req.body;

  //     if (!data) {
  //       return res.send(
  //         Response.validationFailResp("Missing request data", "")
  //       );
  //     }

  //     let {
  //       competitor_request_id,
  //       competitor_id,
  //       competitor_name,
  //       project_name,
  //       user_id,
  //       brand_url,
  //       status, // 0 = ON , 1 = OFF
  //     } = data;

  //     competitor_request_id = this.normalizeObjectId(competitor_request_id);
  //     competitor_id = this.normalizeObjectId(competitor_id);

  //     if (status === undefined) {
  //       return res.send(Response.messageResp("Status is required"));
  //     }

  //     /* -----------------------------------------------------------
  //        STEP 1️  RESOLVE / CREATE COMPETITOR REQUEST
  //     ------------------------------------------------------------*/
  //     if (!competitor_request_id && project_name && user_id) {
  //       let compRequest = await Competitors_request.findOne({
  //         user_id: new mongoose.Types.ObjectId(user_id),
  //         advertiser: {
  //           $regex: new RegExp(`^${this.escapeRegex(project_name)}$`, "i"),
  //         },
  //       });

  //       //  create if not exists (LAZY FLOW SUPPORT)
  //       if (!compRequest) {
  //         compRequest = await Competitors_request.create({
  //           user_id,
  //           project_name,
  //           brand_url,
  //           advertiser: [project_name],
  //           competitors: [],
  //           monitoring: [],
  //         });
  //       }

  //       competitor_request_id = compRequest._id;
  //     }

  //     /* -----------------------------------------------------------
  //        STEP 2️  RESOLVE / CREATE COMPETITOR
  //     ------------------------------------------------------------*/
  //     if (!competitor_id && competitor_name) {
  //       let competitor = await Competitors.findOne({
  //         competitor_name: {
  //           $regex: new RegExp(`^${this.escapeRegex(competitor_name)}$`, "i"),
  //         },
  //       });

  //       // create if not exists
  //       if (!competitor) {
  //         const poolDoc = await Existing_competitors.findOne({
  //           advertiser: {
  //             $regex: new RegExp(`^${this.escapeRegex(project_name)}$`, "i"),
  //           },
  //         });

  //         const poolComp = poolDoc?.competitors?.find(
  //           (c) =>
  //             c.competitor_name.toLowerCase() ===
  //             competitor_name.toLowerCase()
  //         );

  //         competitor = await Competitors.create({
  //           competitor_name: poolComp?.competitor_name || competitor_name,
  //           competitor_url: poolComp?.competitor_url || "",
  //         });
  //       }

  //       competitor_id = competitor._id;
  //     }

  //     /* -----------------------------------------------------------
  //        VALIDATION
  //     ------------------------------------------------------------*/
  //     if (!competitor_request_id || !competitor_id) {
  //       return res.send(
  //         Response.messageResp("competitor_request_id or competitor_id missing")
  //       );
  //     }

  //     /* -----------------------------------------------------------
  //        STEP 3  TOGGLE MONITORING
  //     ------------------------------------------------------------*/
  //     let updateResult;

  //     if (status == 0) {
  //       // TURN ON

  //       updateResult = await Competitors_request.findOneAndUpdate(
  //         { _id: competitor_request_id },
  //         {
  //           $addToSet: {
  //             monitoring: competitor_id,
  //             competitors: competitor_id,
  //           },
  //         },
  //         { new: true }
  //       );

  //       return res.send(
  //         Response.userSuccessResp("Monitoring turned ON", updateResult)
  //       );
  //     }

  //     if (status == 1) {
  //       // TURN OFF

  //       updateResult = await Competitors_request.findOneAndUpdate(
  //         { _id: competitor_request_id },
  //         {
  //           $pull: { monitoring: competitor_id },
  //         },
  //         { new: true }
  //       );

  //       return res.send(
  //         Response.userSuccessResp("Monitoring turned OFF", updateResult)
  //       );
  //     }

  //     return res.send(Response.messageResp("Invalid status"));
  //   } catch (error) {
  //     logger.error("Error in updating monitoring status", error);
  //     return res.send(
  //       Response.userFailResp("Error in updating monitoring status", error)
  //     );
  //   }
  // }

  normalizeObjectId = (id) => {
    if (!id || id === "null" || id === "undefined") return null;
    return id;
  };
  cleanJSONResponse(text) {
   // Remove code block formatting (e.g., ```json ... ```)
   return text.replace(/```json|```/g, '').trim();
  }

  async updateCompetitors(req, res) {
    try {
      let ObjectId =mongoose.Types.ObjectId;
      const { user_id, advertiser, competitor_details, deleteComp} = req.body;

      if (!user_id || !Array.isArray(advertiser) || advertiser.length === 0) {
        return res.send(Response.messageResp("Please provide user_id and advertiser"));
      }

      const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const brand = advertiser[0];

      const brandCheck = await Competitors_request.findOne({
        user_id,
        advertiser: {
          $elemMatch: {
            $regex: new RegExp("^" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"),
          },
        },
      });

      if (!brandCheck) {
        return res.send(Response.messageResp("This brand is not requested"));
      }

      if (!Array.isArray(competitor_details) || competitor_details.length === 0) {
        if (!Array.isArray(deleteComp) || deleteComp.length === 0) {
          return res.send(Response.messageRespComp("Competitor details can't be empty"));
        }else{
          let dexistingCompetitorsId = [];
          const dcompetitorNames = deleteComp.map((c) => c);
          const dregexNames = dcompetitorNames.map(
            (name) => new RegExp(`^${escapeRegExp(name)}$`, "i")
          );

          const competitorsToDelete = await Competitors.find({
            competitor_name: { $in: dregexNames },
          }).select('_id');

          dexistingCompetitorsId = competitorsToDelete.map(c => c._id);

          if (dexistingCompetitorsId.length > 0) {
            let updatedDoc = await Competitors_request.findOneAndUpdate(
              { user_id: new ObjectId(user_id), advertiser: brand },
              {
                $pull: {
                  competitors: { $in: dexistingCompetitorsId },
                  monitoring: { $in: dexistingCompetitorsId }
                }
              },
              {
                new: true
              }
            );
            if(updatedDoc['competitors'].length==0){
              let deleteDoc = await Competitors_request.findByIdAndDelete({_id:updatedDoc['_id']});
            }
          }

          return res.send(Response.userSuccessResp("Competitors updated successfully", {
            dexistingCompetitorsId:dexistingCompetitorsId
          }));
          }
        }

      const competitorNames = competitor_details.map((c) => c.competitor_name);

    
      
      const regexNames = competitorNames.map( 
        (name) => new RegExp(`^${escapeRegExp(name)}$`, "i")
      );
      
      const existingCompetitors = await Competitors.find({// checking if the competitor is already present case insensitively
        competitor_name: { $in: regexNames },
      });

      const existingMap = new Map();
      existingCompetitors.forEach((c) => {
        existingMap.set(c.competitor_name.toLowerCase(), c._id);
      });

      const existingIds = [];
      const newCompetitors = [];

      for (const comp of competitor_details) {
        const name = comp.competitor_name.toLowerCase();

        if (existingMap.has(name)) {
          existingIds.push(existingMap.get(name));
        } else {
          newCompetitors.push({
            competitor_name: comp.competitor_name,
            competitor_url: comp.competitor_url,
          });
        }
      }

      const inserted = await Competitors.insertMany(newCompetitors);
      const insertedIds = inserted.map((c) => c._id);

      const allCompetitorIds = [...existingIds, ...insertedIds];

      const userCompetitorDoc = await Competitors_request.findOne({
        user_id: new ObjectId(user_id),
        advertiser: brand
      }).select('competitors');

      const existingRequestIds = userCompetitorDoc?.competitors?.map(id => id.toString()) || [];

      const missingIdsForRequest = allCompetitorIds.filter(
        id => !existingRequestIds.includes(id.toString())
      );

      if (missingIdsForRequest.length > 0) {
        await Competitors_request.updateOne(
          { user_id: new ObjectId(user_id), advertiser: brand },
            { 
            $push: { 
              competitors: { $each: missingIdsForRequest },
              monitoring: { $each: missingIdsForRequest }
            }
          }
        );
      }
      let dexistingCompetitorsId = [];

      if (Array.isArray(deleteComp) && deleteComp.length > 0) {

        const dcompetitorNames = deleteComp.map((c) => c);
        const dregexNames = dcompetitorNames.map(
          (name) => new RegExp(`^${name}$`, "i")
        );

        const competitorsToDelete = await Competitors.find({
          competitor_name: { $in: dregexNames },
        }).select('_id');

        dexistingCompetitorsId = competitorsToDelete.map(c => c._id);

        if (dexistingCompetitorsId.length > 0) {
          await Competitors_request.updateOne(
            { user_id: new ObjectId(user_id), advertiser: brand },
            {
              $pull: {
                competitors: { $in: dexistingCompetitorsId },
                monitoring: { $in: dexistingCompetitorsId }
              }
            }
          );
        }
      }

      return res.send(Response.userSuccessResp("Competitors updated successfully", {
        insertedCompetitorIds: insertedIds,
        existingCompetitorIds: existingIds,
        addedToRequest: missingIdsForRequest,
        dexistingCompetitorsId:dexistingCompetitorsId
      }));

    } catch (err) {
      logger.error("Error in updateCompetitors", err);
      return res.send(Response.userFailResp("Error in updateCompetitors", err));
    }
  }

 async updateCompetitorsNew(req, res) {
  try {
    const ObjectId = mongoose.Types.ObjectId;
    const { user_id, advertiser, competitor_details, deleteComp } = req.body;

    if (!user_id || !Array.isArray(advertiser) || advertiser.length === 0) {
      return res.send(Response.messageResp("Please provide user_id and advertiser"));
    }

    const brand = advertiser[0];

    // 1️ Get the project document
    const project = await Competitors_request.findOne({
      user_id: new ObjectId(user_id),
      advertiser: brand
    });

    if (!project) {
      return res.send(Response.messageResp("Project not found"));
    }

    let addIds = [];
    let removeIds = [];

    // 2️ Convert competitor_details names → competitor IDs
    if (Array.isArray(competitor_details) && competitor_details.length > 0) {

      const names = competitor_details.map(c => c.competitor_name);
      const regexNames = names.map(name => new RegExp(`^${name}$`, "i"));

      const comps = await Competitors.find({
        competitor_name: { $in: regexNames }
      }).select("_id");

      addIds = comps.map(c => c._id);
    }

    // 3️ Convert deleteComp names → competitor IDs
    if (Array.isArray(deleteComp) && deleteComp.length > 0) {

      const regexNames = deleteComp.map(name => new RegExp(`^${name}$`, "i"));

      const comps = await Competitors.find({
        competitor_name: { $in: regexNames }
      }).select("_id");

      removeIds = comps.map(c => c._id);
    }

    // 4️ Get current monitoring IDs
    const currentMonitoring = project.monitoring.map(id => id.toString());

    // 5️ Filter only actual additions
    addIds = addIds.filter(
      id => !currentMonitoring.includes(id.toString())
    );

    // 6️ Filter only actual removals
    removeIds = removeIds.filter(
      id => currentMonitoring.includes(id.toString())
    );

    // 7️ If no changes → return early
    if (addIds.length === 0 && removeIds.length === 0) {
      return res.send(
        Response.messageRespComp("There are no changes to update")
      );
    }

    // 8️ Add monitoring IDs
    if (addIds.length > 0) {
      await Competitors_request.updateOne(
        { user_id: new ObjectId(user_id), advertiser: brand },
        {
          $addToSet: { monitoring: { $each: addIds } }
        }
      );
    }

    // 9️ Remove monitoring IDs
    if (removeIds.length > 0) {
      await Competitors_request.updateOne(
        { user_id: new ObjectId(user_id), advertiser: brand },
        {
          $pull: { monitoring: { $in: removeIds } }
        }
      );
    }

    return res.send(
      Response.userSuccessResp("Monitoring updated successfully", {
        addedMonitoring: addIds,
        removedMonitoring: removeIds
      })
    );

  } catch (err) {
    logger.error("Error in updateCompetitors", err);
    return res.send(Response.userFailResp("Error in updateCompetitors", err));
  }
}
  async updateAdvertiser(req, res) {
    try {
      const {user_id,advertiser,newadvertiser} = req?.body;
      if(!user_id || !advertiser || !newadvertiser){
        return res.send(Response.messageResp("Please provide user_id and advertiser newadvertiser"));
      }

      const brand = advertiser[0];

      const brandCheck = await Competitors_request.findOne({
        user_id,
        advertiser: {
          $elemMatch: {
            $regex: new RegExp("^" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"),
          },
        },
      });
      if (!brandCheck) {
        return res.send(Response.messageResp("This brand is not requested"));
      }

      let updatedData= await Competitors_request.updateOne(
        {
          _id: brandCheck._id,
          advertiser: brand,
        },
        {
          $set: { "advertiser.$": newadvertiser },
        }
      );

      if(updatedData.modifiedCount>0){
        return res.send(Response.userSuccessResp("Advertiser updated successfully",{brand:newadvertiser}));
      }else {
        return res.send(Response.messageResp("No change made to advertiser"));
      }
      

    } catch (error) {
      logger.error("Error in updateAdvertiser", error);
      return res.send(Response.userFailResp("Error in updateAdvertiser", error));
    }
  }
  
  async fetchCompetitorsForUpdateOld(req, res) {
    try {
      let data = req?.body;

      if (!data) {
        logger.error("Missing request data");
        return res.send(
          Response.validationFailResp("Missing request data", "")
        );
      }

      let { advertiser } = data;

      if (advertiser && Array.isArray(advertiser) && advertiser.length > 0) {
        const ai = new GoogleGenAI({ apiKey: config.get("GEMINI_API_KEY") });

        const prompt = `List out all the competitors (minimum 10) for each of the the given list of brands:

                        List of brands: [${advertiser
                          .map((b) => `"${b}"`)
                          .join(", ")}]

                        Ensure the response format is exactly like this:
                        \`\`\`json
                        [
                          {
                            "Brand1": [
                              {
                                "name": "Competitor Name",
                                "domain": "https://www.example.com/",
                                "logo": "https://example.com/no-logo.png"
                              }
                            ]
                          },
                          {
                            "Brand2": [
                              ...
                            ]
                          }
                        ]
                        \`\`\`

                        - Use only JSON (no markdown or explanations).
                        - Provide real and up-to-date data where possible.
                        - If a logo is unavailable, use: "https://example.com/no-logo.png".
                        `;

        const maxRetries = 3;
        let attempts = 0;

        while (attempts < maxRetries) {
          try {
            const response = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              contents: prompt,
            });

            let text = JSON.parse(this.cleanJSONResponse(response.text));
            return res.send(
              Response.userSuccessResp("Fetched Competitors successfully", text)
            );
          } catch (err) {
            const isOverloaded =
              err.message?.includes("model is overloaded") ||
              err.message?.includes("quota") ||
              err.message?.includes("temporarily unavailable");

            if (isOverloaded) {
              attempts++;
              logger.warn(
                `Gemini model overloaded. Retry attempt ${attempts} immediately`
              );
            } else {
              logger.error("Error in getting competitor list", err);
              return res.send(
                Response.userFailResp("Error in getting competitor list", err)
              );
            }
          }
        }

        return res.send(
          Response.userFailResp(
            "Model remained overloaded after multiple attempts.",
            {}
          )
        );
      } else {
        logger.error("Validation failed for advertiser");
        return res.send(
          Response.messageResp("Validation failed for advertiser")
        );
      }
    } catch (error) {
      logger.error("Error in fetching competitors", error);
      return res.send(
        Response.userFailResp("Error in fetching competitors", error)
      );
    }
  }
  normalizeKey(name) {
    return name
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9]/g, "");
  }


  buildPrompt(brand, count, excluded = []) {
    const excludedText = excluded.length
      ? `
    Already known competitors (DO NOT include these again):
    ${excluded.map(e => `- ${e.name} | ${e.domain}`).join("\n")}
    `
        : "";

      return `
    Return ONLY valid JSON.
    No markdown. No explanation.

    Rules:
    - Do NOT repeat competitors
    - Exclude all competitors listed below

    ${excludedText}

    Schema:
    [
      {
        "${brand}": {
          "ad_countries": string[],
          "competitors": {
            "name": string,
            "domain": string
          }[]
        }
      }
    ]

    Requirements:
    - Provide at least ${count} NEW competitors
    - Real brands only
    `;
  }
  async callGeminiWithRetry(ai, prompt, maxRetries = 3) {
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        return await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
        });
      } catch (err) {
        const retryable =
          err.message?.includes("overloaded") ||
          err.message?.includes("quota") ||
          err.message?.includes("temporarily") ||
          err.message?.includes("timeout");

        if (!retryable) throw err;

        attempt++;
        logger.warn(`Gemini API failed. Retry ${attempt}/${maxRetries}`);
      }
    }

    throw new Error("Gemini API failed after retries");
  }
  async insertIntoExistingComp(advertiser, competitors) {
    if (!competitors?.length) return;
    const uniqueByName = new Map();

    for (const c of competitors) {
      const key = this.normalizeKey(c.name);
      if (!uniqueByName.has(key)) {
        uniqueByName.set(key, c);
      }
    }

    await Existing_competitors.updateOne(
      {
        advertiser: {
          $regex: new RegExp(
            "^" + advertiser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
            "i"
          ),
        },
      },
      {
        $setOnInsert: {
          advertiser: advertiser.toLowerCase().trim(),
        },
        $addToSet: {
          competitors: {
            $each: [...uniqueByName.values()].map(c => ({
              competitor_name: c.name,
              competitor_url: c.domain,
            })),
          },
        },
      },
      { upsert: true }
    );
  }

  async fetchCompetitorsClient(req, res) {
    try {
      let { advertiser, offset = 0, limit = 50 } = req.body;
      offset = parseInt(offset, 10) || 0;
      limit = parseInt(limit, 10) || 50;

      //1
      const traceId = `COMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const requestStart = Date.now();

      logger.info(`[${traceId}] Fetch competitors request started`, {
        advertiser,
        offset,
        limit,
      });
      //
      const MAX_TOTAL = config.get("COMP_NUMBER_MAX");
      const MAX_LOGICAL_ATTEMPTS = 5;

      if (!advertiser || !Array.isArray(advertiser) || !advertiser.length) {
        return res.send(Response.validationFailResp("Invalid advertiser", ""));
      }

      const key = advertiser[0];

      const brandDoc = await Existing_competitors.findOne({
        advertiser: {
          $regex: new RegExp(
            "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
            "i"
          ),
        },
      });

      const existing = brandDoc?.competitors || [];
      const dbCount = existing.length;

      const start = offset;
      const end = offset + limit;

      const fromDB = existing.slice(start, end).map(c => ({
        name: c.competitor_name,
        domain: c.competitor_url,
      }));

      //2
      logger.info(`[${traceId}] DB competitors fetched`, {
        dbCount,
        servedFromDB: fromDB.length,
        start,
        end,
      });
      //

      if (fromDB.length > 0) {
        logger.info(`[${traceId}] Served fully from DB`, {
        returned: fromDB.length,
        nextOffset: start + fromDB.length,
        done: dbCount >= MAX_TOTAL && end >= dbCount,
        totalDurationMs: Date.now() - requestStart,
      });
        return res.send({
          statusCode: 200,
          body: {
            status: "success",
            message: "Fetched Competitors successfully",
            data: [
              {
                [key]: fromDB
              }
            ],
            nextOffset: start + fromDB.length,
            done: dbCount >= MAX_TOTAL && end >= dbCount
          }
        });
      }

      const userScrolledBeyondDB = start >= dbCount;
      const belowMaxLimit = dbCount < MAX_TOTAL;

      if (!userScrolledBeyondDB || !belowMaxLimit) {
        return res.send({
          statusCode: 200,
          body: {
            status: "success",
            message: "Fetched Competitors successfully",
            data: [
              {
                [key]: []
              }
            ],
            nextOffset: start,
            done: true
          }
        });
      }

      const ai = new GoogleGenAI({
        apiKey: config.get("GEMINI_API_KEY"),
      });

      const remainingAllowed = MAX_TOTAL - dbCount;
      const needed = Math.min(limit, remainingAllowed);

      const seen = new Set(
        existing.map(c =>
          this.normalizeKey(c.competitor_name)
        )
      );

      let collected = [];
      let attempts = 0;

      while (
        collected.length < needed &&
        attempts < MAX_LOGICAL_ATTEMPTS
      ) {
        attempts++;

        const excluded = [...existing, ...collected]
          .slice(-30)
          .map(c => ({
            name: c.name || c.competitor_name,
            domain: c.domain || c.competitor_url,
          }));

          const prompt = this.buildPrompt(key, needed + 10, excluded);
          logger.info(`[${traceId}] Gemini attempt ${attempts}`, {
            needed,
            excludedCount: excluded.length,
            promptPreview: prompt.slice(0, 500),
          });
          logger.debug(`[${traceId}] Full Gemini prompt`, { prompt });

          const geminiStart = Date.now();
        const response = await this.callGeminiWithRetry(
          ai,
          prompt,
          3
        );

        const geminiDuration = Date.now() - geminiStart;

        logger.info(`[${traceId}] Gemini response received`, {
          attempt: attempts,
          durationMs: geminiDuration,
          rawLength: response.text?.length,
        });

        const parsed = JSON.parse(this.cleanJSONResponse(response.text));
        const competitors = parsed[0]?.[key]?.competitors || [];
        let addedThisAttempt =0;
        for (const c of competitors) {
          const uniqKey = this.normalizeKey(c.name);

          if (!seen.has(uniqKey)) {
            seen.add(uniqKey);
            collected.push(c);
            addedThisAttempt++;
          }

          if (collected.length === needed) break;
        }
        logger.info(`[${traceId}] Dedup summary`, {
        attempt: attempts,
        received: competitors.length,
        added: addedThisAttempt,
        totalCollected: collected.length,
      });
      }
      
      if (collected.length) {
        await this.insertIntoExistingComp(key, collected);
      }

      logger.info(`[${traceId}] Fetch competitors completed`, {
      requested: limit,
      offsetStart: start,
      offsetEnd: start + collected.length,
      dbCount,
      geminiCollected: collected.length,
      totalReturned: collected.length,
      done: dbCount + collected.length >= MAX_TOTAL,
      totalDurationMs: Date.now() - requestStart,
    });

      return res.send({
        statusCode: 200,
        body: {
          status: "success",
          message: "Fetched Competitors successfully",
          data: [
            {
              [key]: collected
            }
          ],
          nextOffset: start + collected.length,
          done: dbCount + collected.length >= MAX_TOTAL
        }
      });


    } catch (error) {
      logger.error("Error in fetching competitors", error);
      return res.send(
        Response.userFailResp("Error in fetching competitors", error)
      );
    }
  }

  async getAllDetails(req,res){
    try{

      let data = await Competitors_request.find(
        {},
        { user_id: 1, advertiser: 1, competitors: 1, _id: 0 ,createdAt:1})
        .populate("user_id", "userName amember_id")
        .populate("competitors", "competitor_name competitor_url -_id")
        .sort({ createdAt: -1 });

        let result=[];

        if(data.length>0){

          result = data.map(function(val){
            let obj = {
              user_id: val.user_id.amember_id,
              userName: val.user_id?.userName || null,
              advertiser: val.advertiser,
              competitors: val.competitors,
              date: val.createdAt,
            };
            return obj;
          });

        }

         
        let activeUsers= [];

        if(result.length>0){

          let set = new Set();

          result.forEach(function(val){
            set.add(val.user_id);
          });

          activeUsers=Array.from(set);
        
        }

        let inactiveUsers = await User_details.find({
          amember_id: { $nin: activeUsers },
        },{userName:1, amember_id:1}).sort({ createdAt: -1 });

        let inactive = inactiveUsers.map(function(val){
           return {
             user_id: val.amember_id,
             userName: val.userName || null,
             advertiser: [],
             competitors: [],
             date: "",
           };
        });

        let finalArr = [...result, ...inactive];

        if(finalArr.length>0){
          return res.send(
            Response.userSuccessResp(
              "Fetched all the details successfully",
              finalArr
            )
          );
        }
        else{
          return res.send(
            Response.messageResp(
              "No data found"
            )
          );
        }
        
    }
    catch(error){
      logger.error("Error in getting all details for admin panel", error);
      return res.send(
        Response.userFailResp("Error in getting all details for admin panel", error)
      );
    }
  }

  async filterDetails(req,res){
    try {

      let data = req?.body;

      if (!data) {
        logger.error("Missing request data");
        return res.send(
          Response.validationFailResp("Missing request data", "")
        );
      }

      let { user_id, userName, brandName } = data;

      // if (user_id && !mongoose.Types.ObjectId.isValid(user_id)) {
      //   logger.error("Invalid ObjectId: " + user_id);
      //   return res.send(
      //     Response.validationFailResp(`Invalid user_id: ${user_id}`, "")
      //   );
      // }
      
      let filter = {};
      let result = [];

      if (user_id && user_id !== "") filter.amember_id = user_id;

      if (brandName && brandName.length>0){

       
        filter.advertiser = {$in:brandName};

        let results = await Competitors_request.find(filter)
         .populate("user_id", "userName amember_id")
         .populate("competitors", "competitor_name competitor_url -_id")
         .lean();
        

         if (results.length > 0) {
           result = results.map(function (val) {
             let obj = {
               user_id: val.user_id.amember_id,
               userName: val.user_id?.userName || null,
               advertiser: val.advertiser,
               competitors: val.competitors,
               date: val.createdAt,
             };
             return obj;
           });
         }
         else{
            return res.send(Response.messageResp("No data found"));
         }
      }
      else{
        
        let results = await Competitors_request.find(filter)
          .populate("user_id", "userName amember_id")
          .populate("competitors", "competitor_name competitor_url -_id")
          .lean();


          if(results.length==0){
            results = await User_details.find(
              { amember_id: user_id },
              { userName: 1, amember_id:1 }
            );
            
            if(results.length==0){
                return res.send(Response.messageResp("No data found"));
            }

            results= results.map(function(val){
              return {
                user_id: val.amember_id,
                userName: val.userName || null,
                advertiser: [],
                competitors: [],
                date: "",
              };
            })
          }
          else{
            results = results.map(function (val) {
              return {
                user_id: val.user_id.amember_id,
                userName: val.user_id?.userName || null,
                advertiser: val.advertiser,
                competitors: val.competitors,
                date: val.createdAt,
              };
            });
          }

          result = results;

      }

       if (userName && userName !== "") {
         result = result.filter(
           (item) =>
             item?.userName === userName
         );
       }

       if(result.length==0)return res.send(Response.messageResp("No data found"));
       

       return res.send(
         Response.userSuccessResp(
           "Fetched all the details successfully",
           result
         )
       );


    } 
    catch (error) {
      logger.error("Error in filtering details for admin panel", error);
      return res.send(
        Response.userFailResp(
          "Error in filtering details for admin panel",
          error
        )
      );
    }

  }

  // async insertIntoExistingComp(data){
  //   try{

  //       if (!data || data.length == 0) {
  //         logger.error("No data to insert into existing competitors");
  //         return;
  //       }

  //       let obj = data[0];
  //       let [key] = Object.keys(obj); //taking only the first advertiser
  //       let advertiserData = obj[key];
  //       let competitors = advertiserData.competitors || [];
  //       let comps = competitors.map(function (curr) {
  //         return {
  //           competitor_name: curr.name,
  //           competitor_url: curr.domain,
  //         };
  //       });
        
  //       //first check if that advertiser is already present
  //       let brandCheck = await Existing_competitors.findOne({
  //         advertiser: {
  //           $regex: new RegExp(
  //             "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
  //             "i"
  //           ),
  //         },
  //       }); 

  //       if(!brandCheck){

  //         let payload = { // data to be inserted
  //           advertiser: key,
  //           competitors: comps,
  //         };

  //         let insertComp= await Existing_competitors.create(payload);

  //       }

  //   }
  //   catch(error){
  //     logger.error("Error in inserting data into existing competitors", error);
  //     return;
  //   }

  // }
  async fetchCompetitorsForUpdate(req, res) {
    try {
      const advertiser = req?.body?.advertiser;

      if (!advertiser || !Array.isArray(advertiser) ||advertiser.length === 0) {
        logger.error("Validation failed: advertiser must be a non-empty array");
        return res.send(Response.validationFailResp("Invalid advertiser input", ""));
      }

      let [key] = advertiser;

      let brandCheck = await Existing_competitors.findOne({
        advertiser: {
          $regex: new RegExp(
            "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
            "i"
          ),
        },
      });

      let excludedComps=[];
      let comps=[];

      if(brandCheck){//if we already have data for that user
          let { competitors: existingComps } = brandCheck;

          comps = existingComps.slice(0,20).map(function (val) {
              return {
                name: val.competitor_name,
                domain: val.competitor_url,
              };
          });

          excludedComps = existingComps.slice(0,20).map(function (val) {
              return val.competitor_name;
          });
      }

      const prompt = this.generateCompetitorPrompt(advertiser,excludedComps);//generating the prompt for update

      const ai = new GoogleGenAI({ apiKey: config.get("GEMINI_API_KEY") });

      const maxRetries = 3;
      let attempts = 0;

      while (attempts < maxRetries) {
        try {

          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
          });

          const geminiData = JSON.parse(this.cleanJSONResponse(response.text));

          if (brandCheck && Array.isArray(geminiData)) {

            let brandEntry = geminiData.map(function(val){
              return val[key][0];
            });
            let mergeArr = [...comps, ...brandEntry];

            /* v8 ignore start -- brandEntry is geminiData.map(...) which always returns a (truthy) array, so the else is unreachable */
            if (brandEntry) {
              // Appending existing competitors to the existing brand's competitor list
               let returnObj = {};
               returnObj[key] = mergeArr;

               return res.send(Response.userSuccessResp("Fetched Competitors successfully", [returnObj]));

            } else {
              // if no brand is returned by gemini, then we will send the previous details
              geminiData.push({
                [key]: comps || [],
              });
            }
            /* v8 ignore stop */

          }

          return res.send(Response.userSuccessResp("Fetched Competitors successfully", geminiData));
          
        } catch (err) {
          const isOverloaded =
            err.message?.includes("model is overloaded") ||
            err.message?.includes("quota") ||
            err.message?.includes("temporarily unavailable");

          if (isOverloaded) {
            logger.warn(`Gemini model overloaded. Retry attempt ${attempts + 1}`);
            attempts++;
          } else {
            logger.error("Error in getting competitor list", err);
            return res.send(Response.userFailResp("Error in getting competitor list", err));
          }
        }
      }

      return res.send(Response.userFailResp("Model remained overloaded after multiple attempts.",{}));

    } catch (error) {
      logger.error("Error in fetchCompetitorsForUpdate", error);
      return res.send(Response.userFailResp("Server error while fetching competitors", error));
    }
  }

async fetchCompetitorsForUpdateNew(req, res) {
  try {
    const advertiser = req?.body?.advertiser;
    const user_id = req?.body?.user_id;

    if (!advertiser || !Array.isArray(advertiser) || advertiser.length === 0) {
      logger.error("Validation failed: advertiser must be a non-empty array");
      return res.send(Response.validationFailResp("Invalid advertiser input", ""));
    }

    if (!user_id) {
      return res.send(Response.validationFailResp("Missing user_id"));
    }

    const brand = advertiser[0];

    // 1️ Get user project
    const project = await Competitors_request.findOne({
      user_id: new mongoose.Types.ObjectId(user_id),
      advertiser: brand
    });

    if (!project) {
      return res.send(Response.userFailResp("Project not found"));
    }

    const competitorIds = project.competitors || [];
    const monitoringIds = (project.monitoring || []).map(id => id.toString());

    // 2️ Fetch competitors using those IDs
    const competitors = await Competitors.find(
      { _id: { $in: competitorIds } },
      { competitor_name: 1, competitor_url: 1 }
    );

    // 3️ Mark monitoring true/false
    const result = competitors.map(comp => ({
      name: comp.competitor_name,
      domain: comp.competitor_url,
      monitoring: monitoringIds.includes(comp._id.toString())
    }));

    return res.send(
      Response.userSuccessResp("Competitors fetched successfully", result)
    );

  } catch (error) {
    logger.error("Error in fetchCompetitorsForUpdate", error);
    return res.send(
      Response.userFailResp("Server error while fetching competitors", error)
    );
    }
  }
 async fetchCompetitorsForUpdateClient(req, res) {
    
    try {
      const advertiser = req?.body?.advertiser;

      if (!advertiser || !Array.isArray(advertiser) ||advertiser.length === 0) {
        logger.error("Validation failed: advertiser must be a non-empty array");
        return res.send(Response.validationFailResp("Invalid advertiser input", ""));
      }

      let [key] = advertiser;

      let brandCheck = await Existing_competitors.findOne({
        advertiser: {
          $regex: new RegExp(
            "^" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
            "i"
          ),
        },
      });

      let excludedComps=[];
      let comps=[];

      if(brandCheck){//if we already have data for that user
          let { competitors: existingComps } = brandCheck;

          comps = existingComps.map(function (val) {
              return {
                name: val.competitor_name,
                domain: val.competitor_url,
              };
          });

          excludedComps = existingComps.map(function (val) {
              return val.competitor_name;
          });
      }

      // If already have max competitors, do NOT call Gemini
      const MAX_COMPETITORS = config.get("COMP_NUMBER_MAX");
      if (comps.length >= MAX_COMPETITORS) {
        logger.info(`Competitor limit reached (${comps.length}). Skipping Gemini call.`);

        return res.send(
          Response.userSuccessResp(
            "Fetched Competitors successfully",
            [
              {
                [key]: comps.slice(0, comps.length)
              }
            ]
          )
        );
      }

      const prompt = this.generateCompetitorPrompt(advertiser,excludedComps);//generating the prompt for update

      const ai = new GoogleGenAI({ apiKey: config.get("GEMINI_API_KEY") });

      const maxRetries = 3;
      let attempts = 0;

      while (attempts < maxRetries) {
        try {

          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
          });

          const geminiData = JSON.parse(this.cleanJSONResponse(response.text));

          if (brandCheck && Array.isArray(geminiData)) {

            let brandEntry = geminiData.map(function(val){
              return val[key][0];
            });
            let mergeArr = [...comps, ...brandEntry];

            /* v8 ignore start -- brandEntry is geminiData.map(...) which always returns a (truthy) array, so the else is unreachable */
            if (brandEntry) {
              // Appending existing competitors to the existing brand's competitor list
               let returnObj = {};
               returnObj[key] = mergeArr;

               return res.send(Response.userSuccessResp("Fetched Competitors successfully", [returnObj]));

            } else {
              // if no brand is returned by gemini, then we will send the previous details
              geminiData.push({
                [key]: comps || [],
              });
            }
            /* v8 ignore stop */

          }

          return res.send(Response.userSuccessResp("Fetched Competitors successfully", geminiData));
          
        } catch (err) {
          const isOverloaded =
            err.message?.includes("model is overloaded") ||
            err.message?.includes("quota") ||
            err.message?.includes("temporarily unavailable");

          if (isOverloaded) {
            logger.warn(`Gemini model overloaded. Retry attempt ${attempts + 1}`);
            attempts++;
          } else {
            logger.error("Error in getting competitor list", err);
            return res.send(Response.userFailResp("Error in getting competitor list", err));
          }
        }
      }

      return res.send(Response.userFailResp("Model remained overloaded after multiple attempts.",{}));

    } catch (error) {
      logger.error("Error in fetchCompetitorsForUpdate", error);
      return res.send(Response.userFailResp("Server error while fetching competitors", error));
    }
  }

  generateCompetitorPrompt(brandArr, excludedComps) {
    const brand = brandArr[0];

    if (!brand) return "";

    // Format list of competitors to exclude
    const excluded = excludedComps?.length? `Avoid listing the following known competitors: 
          ${excludedComps.map((c) => `"${c}"`).join(", ")}.`: "";

    return `List at least 5 real competitors for the brand "${brand}".

    Ensure the response format is exactly like this:
    \`\`\`json
    [
      {
        "${brand}": [
          {
            "name": "Competitor Name",
            "domain": "https://www.example.com/",
            "logo": "https://example.com/no-logo.png"
          }
        ]
      }
    ]
    \`\`\`
    
    - Use only JSON (no markdown or explanations).
    - Provide real and up-to-date data where possible.
    - If a logo is unavailable, use: "https://example.com/no-logo.png".
    ${excluded}`;
  }

  async getInactiveUsers(req, res) {
    try {
      let page = Math.max(1, parseInt(req.query.page) || 1);
      let limit = Math.max(1, parseInt(req.query.limit) || 10);
      let skip = (page - 1) * limit;
      const { from, to, user_id: amemberIdQuery, userName } = req.query;

      const activeUsers = await Competitors_request.distinct("user_id");

      let filter = {
        _id: { $nin: activeUsers },
      };

      if (amemberIdQuery) {
        filter.$expr = {
          $regexMatch: {
            input: { $toString: "$amember_id" },
            regex: `^${amemberIdQuery}`,
            options: "i"
          }
        };
      }

      if (userName) {
        filter.userName = { $regex: userName, $options: "i" };
      }

     if (from && to) {
      filter.createdAt = {
        $gte: new Date(`${from}T00:00:00.000Z`),
        $lte: new Date(`${to}T23:59:59.999Z`)
      };
    }


      const totalCount = await User_details.countDocuments(filter);

      const inactiveUsers = await User_details.find(filter, {
        userName: 1,
        amember_id: 1,
        createdAt: 1,
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      if (inactiveUsers.length === 0) {
        return res.send(Response.messageResp("No more Inactive users", {}));
      }

      const result = inactiveUsers.map((val) => ({
        user_id: val.amember_id,
        userName: val.userName || null,
        advertiser: [],
        competitors: [],
        date: val.createdAt,
      }));

      return res.send(
        Response.userSuccessResp("Fetched inactive users", {
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          data: result,
        })
      );
    } catch (error) {
      logger.error("Error fetching inactive users", error);
      return res.send(Response.userFailResp("Failed to fetch inactive users", error));
    }
  }

  async getActiveUsers(req, res) {
    try {
      let page = Math.max(1, parseInt(req.query.page) || 1);
      let limit = Math.max(1, parseInt(req.query.limit) || 10);
      let skip = (page - 1) * limit;
      const { from, to } = req.query;

      const { user_id: amemberIdQuery, userName } = req.query;
      const allData = await Competitors_request.find(
        {},
        { user_id: 1, advertiser: 1, competitors: 1, _id: 0, createdAt: 1 }
      )
        .populate("user_id", "userName amember_id")
        .populate("competitors", "competitor_name competitor_url -_id")
        .sort({ createdAt: -1 })
        .lean();

      const filtered = allData.filter(doc => {
        if (!doc.user_id) return false;

        const matchByAmemberId = amemberIdQuery
          ? String(doc.user_id.amember_id).startsWith(amemberIdQuery)
          : true;

        const matchByUserName = userName
          ? doc.user_id.userName?.toLowerCase().includes(userName.toLowerCase())
          : true;

          const docDate = new Date(doc.createdAt).toISOString().slice(0, 10);
          const matchByDateRange =
            from && to
              ? docDate >= from && docDate <= to
              : true;

        return matchByAmemberId && matchByUserName && matchByDateRange;
      });

      const totalCount = filtered.length;
      const paginated = filtered.slice(skip, skip + limit);

      if (paginated.length === 0) {
        return res.send(Response.messageResp("No more active users", {}));
      }

      const result = paginated.map(val => ({
        user_id: val.user_id?.amember_id,
        userName: val.user_id?.userName || null,
        advertiser: val.advertiser,
        competitors: val.competitors,
        date: val.createdAt
      }));

      return res.send(
        Response.userSuccessResp("Fetched active users", {
          page,
          limit,
          totalPages: Math.ceil(totalCount / limit),
          totalCount,
          data: result
        })
      );
    } catch (error) {
      logger.error("Error fetching active users", error);
      return res.send(Response.userFailResp("Failed to fetch active users", error));
    }
  }

  async getCompUsersCount(req,res){
    try {
      // Anchor every count to User_details so the totals match the user list.
      // Total   = all User_details documents.
      // Inactive = User_details with no Competitors_request.
      // Active  = the rest, i.e. users that exist in User_details AND appear in
      //           Competitors_request. (Counting distinct request user_ids
      //           directly over-counts, because requests can reference user_ids
      //           that no longer exist in User_details.)
      let totalUsers = await User_details.countDocuments({});
      let inActiveUsersAgg  = await User_details.aggregate([
                          {
                            $lookup: {
                              from: "competitors_requests",
                              localField: "_id",
                              foreignField: "user_id",
                              as: "matchedRequests"
                            }
                          },
                          {
                            $match: {
                              matchedRequests: { $size: 0 }
                            }
                          },
                          {
                                $count: "missingUserCount"
                          }
                        ])
      let inActiveUsers = inActiveUsersAgg[0]?.missingUserCount || 0;
      let activeUsers = totalUsers - inActiveUsers;
      let totalBrands = await Existing_competitors.estimatedDocumentCount();
      let totalCompetitors = await Competitors.estimatedDocumentCount();
      return res.send(
        Response.userSuccessResp("Fetched active users", {
          totalUsers,
          activeUsers,
          inActiveUsers,
          totalBrands,
          totalCompetitors
        })
      );
      
    } catch (error) {
      logger.error("Error fetching active users", error);
      return res.send(Response.userFailResp("Failed to fetch active users", error));
    }
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  escapeRegex(str = "") {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // normalizeAdvertiser(advertiser = "") {
  //   if (Array.isArray(advertiser)) {
  //     advertiser = advertiser[0] || "";
  //   }
  //   return String(advertiser).toLowerCase().trim();
  // }
  normalizeAdvertiser(advertiser = "") {
    if (Array.isArray(advertiser)) {
      advertiser = advertiser[0] || "";
    }
    // Deep normalization logic. Keep the full domain (including TLD) — e.g.
    // "cobra" and "cobra.sa" are different brands and must not collapse to
    // the same DB key just because everything after the first "." was
    // discarded.
    return String(advertiser)
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase()
      .trim();
  }

  // Python/LLM returns raw candidates that get deduplicated by name at several
  // layers (saveUniqueCompetitors, the Competitors unique index, $addToSet). If
  // even one candidate name collides, the unique count lands below the requested
  // number and the generation loop can never reach TARGET. Over-fetch a buffer so
  // dedup losses still leave >= TARGET unique competitors.
  competitorOverfetchLimit(n) {
    const target = Number(n) || 0;
    if (target <= 0) return target;
    const ratio = config.has("COMP_OVERFETCH_RATIO")
      ? Number(config.get("COMP_OVERFETCH_RATIO"))
      : 0.2;
    // ceil() guarantees at least 1 extra candidate even for small N
    const overfetched = target + Math.ceil(target * ratio);
    // DS's GET /v1/api/competitors/list hard-rejects `limit` > 100 (422,
    // Pydantic `le=100`) — confirmed live against comp-list.poweradspy.ai.
    // Our Max Competitors slider goes up to 100, so any request there
    // (target >= ~84, once the 20% overfetch pushes past 100) silently 422'd
    // on EVERY poll forever: the existing catch just logged a warning and
    // retried, so the UI saw 0 results for the full 2-minute loop cap even
    // though DS had already generated everything (verified: DS reported
    // completed_items: 120 for a target=100 request our own polling could
    // never actually read back). Clamping here protects every caller of this
    // helper (checkCompetitorProcess's /prepare, getStoreProcessCompetitors's
    // and generateCompetitorsInBackground's /list polls) in one place.
    return Math.min(overfetched, DS_MAX_LIST_LIMIT);
  }

  // Attach up to (TARGET - alreadyAttached) fresh, name-unique competitors to the
  // user's request. Caps at TARGET so over-fetching never overshoots the number
  // the user asked for. Returns how many new competitors were attached.
  async attachCompetitorsCappedToTarget({ user_id, normalizedKey, competitors, TARGET }) {
    if (!Array.isArray(competitors) || !competitors.length) return 0;

    const advertiserArray = [normalizedKey];

    // Names already attached to this user's request
    const existingRows = await this.getCompetitorTableRows({
      project_name: normalizedKey,
      user_id
    });
    const attachedNames = new Set(
      existingRows
        .map(r => (r.name || "").toLowerCase().trim())
        .filter(Boolean)
    );

    const need = TARGET - attachedNames.size;
    if (need <= 0) return 0;

    // Pick fresh, name-unique candidates up to `need`
    const seen = new Set();
    const fresh = [];
    for (const c of competitors) {
      const name = c.tool_name?.toLowerCase().trim();
      if (!name || attachedNames.has(name) || seen.has(name)) continue;
      seen.add(name);
      fresh.push(c);
      if (fresh.length >= need) break;
    }
    if (!fresh.length) return 0;

    await this.saveUniqueCompetitors(normalizedKey, fresh, TARGET);
    const ids = await this.getCompetitorIdsFromMaster(fresh);
    await this.attachCompetitorsToUserRequest(user_id, advertiserArray, ids, fresh);
    return fresh.length;
  }

  //insert unique competitors (advertiser+url unique)
  async saveUniqueCompetitors(advertiserRaw, competitors, max = 200) {
    if (!Array.isArray(competitors) || !competitors.length) return 0;

    const advertiser = advertiserRaw.toLowerCase().trim();

    // Fetch existing competitors (names only)
    const doc = await Existing_competitors.findOne(
      { advertiser },
      { competitors: 1 }
    );

    const existingCompetitors = doc?.competitors || [];
    const existingCount = existingCompetitors.length;
    const remaining = Math.max(0, max - existingCount);

    if (remaining === 0) return 0;

    // Create a Set of existing competitor names (lowercased)
    const existingNames = new Set(
      existingCompetitors.map(c =>
        c.competitor_name.toLowerCase().trim()
      )
    );

    // Deduplicate incoming competitors by NAME ONLY
    const uniqueByName = new Map();

    for (const c of competitors) {
      const name = c.tool_name?.trim();
      const url = c.domain?.toLowerCase()?.trim();

      if (!name) continue;

      const nameKey = name.toLowerCase();

      // Skip if already exists in DB
      if (existingNames.has(nameKey)) continue;

      // Skip duplicates within the same batch
      if (!uniqueByName.has(nameKey)) {
        uniqueByName.set(nameKey, {
          competitor_name: name,
          competitor_url: url || null
        });
      }
    }

    // Respect max limit
    const toInsert = [...uniqueByName.values()].slice(0, remaining);
    if (!toInsert.length) return 0;

    // Insert safely
    await Existing_competitors.updateOne(
      { advertiser },
      {
        $setOnInsert: { advertiser },
        $addToSet: {
          competitors: { $each: toInsert }
        }
      },
      { upsert: true }
    );

    return toInsert;
  }


  async getFirst30(advertiserKey) {
    const doc = await Existing_competitors.findOne(
      { advertiser: advertiserKey.toLowerCase().trim() },
      { competitors: { $slice: 30 } }
    );
    return doc?.competitors || [];
  }

  async getAllComps(advertiserKey) {
    const doc = await Existing_competitors.findOne(
      { advertiser: advertiserKey.toLowerCase().trim() },
      { competitors: 1 }
    );
    return doc?.competitors || [];
  }

  getTodayDate() {
    return new Date().toISOString().slice(0, 10);
  }
async updateUserDailyTokens(userObjectId, content_ref_id) {

  const today = new Date().toISOString().slice(0, 10);

  const res = await axios.get(
    config.get("COMPETITOR_URL_PYTHON") + "/v1/api/tokens/usage",
    { params: { content_ref_id }, timeout: DS_REQUEST_TIMEOUT_MS }
  );

  const usage = res.data.data.token_usage;
  const currentInput = usage.input_tokens || 0;
  const currentOutput = usage.output_tokens || 0;

  // get last synced state
  const last = await TokenSyncState.findOne({
    user_id: userObjectId,
    content_ref_id
  });

  const deltaInput = currentInput - (last?.last_input_tokens || 0);
  const deltaOutput = currentOutput - (last?.last_output_tokens || 0);

  if (deltaInput <= 0 && deltaOutput <= 0) return;

  // update daily usage
  await UserDailyTokens.updateOne(
    { user_id: userObjectId, date: today },
    {
      $inc: {
        input_tokens: deltaInput,
        output_tokens: deltaOutput,
        total_tokens: deltaInput + deltaOutput
      }
    },
    { upsert: true }
  );

  // store latest synced value
  await TokenSyncState.updateOne(
    { user_id: userObjectId, content_ref_id },
    {
      $set: {
        last_input_tokens: currentInput,
        last_output_tokens: currentOutput
      }
    },
    { upsert: true }
  );
}

async isDailyLimitExceeded(userObjectId) {
  const today = new Date().toISOString().slice(0, 10);

  const doc = await UserDailyTokens.findOne({
    user_id: userObjectId,
    date: today
  });
   
  return (doc?.output_tokens || 0) >= (config.get("MAXIMUM_TOKEN_COUNt") ||20000);
}
  async getStoreProcessCompetitors(req, res) {
  try {
    const { advertiser, content_ref_id, target, user_id } = req.body;

    logger.info("Competitor API called", {
      advertiser,
      user_id,
      content_ref_id,
      target
    });
    if (!advertiser || !content_ref_id || !user_id) {
      return res.send("advertiser, content_ref_id, user_id are required");
    }

    const TARGET = Number(target) || 200;
    const normalizedKey = this.normalizeAdvertiser(advertiser);
    const advertiserArray = [normalizedKey];

    const keywordUrlC =
      config.get("COMPETITOR_URL_PYTHON") + "/v1/api/competitors/list";

    const userObjectId = new mongoose.Types.ObjectId(user_id);
    // TOKEN LIMIT PRE-CHECK
    const exceeded = await this.isDailyLimitExceeded(userObjectId);
    logger.info("Token limit check", {
      user_id,
      exceeded
    });
    if (exceeded) {

      return res.send(
        Response.userSuccessResp("Daily AI token limit exceeded", {
          rows: [],
          total_generated: 0,
          target: TARGET,
          status: "limit_exceeded"
        })
      );

    }
    // Ensure request doc exists with correct brand_url, and (re)mark it as
    // actively generating — this is the actual trigger point for the
    // background loop below, so generation_status/content_ref_id/target_count
    // need to be current here regardless of what checkCompetitorProcess did,
    // so a page refresh mid-generation can tell "still running" apart from
    // "done" and rejoin the correct socket room.
    await Competitors_request.updateOne(
      { user_id: userObjectId, advertiser: advertiserArray },
      {
          $set: {
            brand_url: advertiser, // Domain
            content_ref_id: content_ref_id,
            target_count: TARGET,
            generation_status: "running"
          },
        $setOnInsert: {
          user_id: userObjectId,
          advertiser: advertiserArray,
          competitors: [],
          monitoring: [],
          email_status: 0,
          country: [],
          category: []
        }
      },
      { upsert: true }
    );

    const reqDoc = await Competitors_request.findOne(
      { user_id: userObjectId, advertiser: advertiserArray },
      { competitors: 1 }
    );

    const attachedCount = reqDoc?.competitors?.length || 0;
    const remaining = TARGET - attachedCount;

    let competitors = [];
    if (remaining > 0) {
      // Fetch the whole over-fetched candidate pool from skip=0 so dedup has
      // enough headroom to fill up to TARGET unique competitors.
      const fetchLimit = this.competitorOverfetchLimit(TARGET);
      logger.info("Calling competitor python API 1", {
        skip: 0,
        limit: fetchLimit,
        content_ref_id
      });
      try {
        // Bound this call too — it's awaited directly by the frontend
        // (getStoreProcessCompetitors runs right after checkCompetitorProcess,
        // both in the same spinner-visible request chain), so an unbounded DS
        // hang here reproduces the exact same infinite-spinner bug even with
        // checkCompetitorProcess's own DS call already fixed.
        const response = await axios.get(keywordUrlC, {
          timeout: DS_REQUEST_TIMEOUT_MS,
          params: {
            content_ref_id,
            skip: 0,
            limit: fetchLimit
          }
        });

        competitors =
          response?.data?.data?.competitors ||
          response?.data?.competitors ||
          [];
        logger.info("Python API returned competitors", {
          count: competitors.length
        });
      } catch (apiErr) {
        // A 422 here means OUR request was invalid (e.g. a `limit` DS's schema
        // rejects) — retrying won't fix that, unlike a transient 5xx/network
        // blip, which the background loop's own retry loop can reasonably
        // paper over. Log the actual DS error body so a bad request is
        // diagnosable without having to reproduce it by hand against DS
        // directly (see competitorOverfetchLimit's DS_MAX_LIST_LIMIT clamp —
        // this is exactly the shape of bug that produced 0 results with no
        // visible error for a 100-competitor request).
        const status = apiErr?.response?.status;
        logger[status === 422 ? "error" : "warn"](
          status === 422 ? "Python /list API rejected our request (won't self-resolve on retry)" : "Python /list API not ready yet, background loop will retry",
          {
            status,
            message: apiErr?.message,
            responseBody: apiErr?.response?.data
          }
        );
      }
      if (competitors.length) {
        const attached = await this.attachCompetitorsCappedToTarget({
          user_id,
          normalizedKey,
          competitors,
          TARGET
        });
        logger.info("Competitors attached to user request 1", {
          user_id,
          advertiser: normalizedKey,
          count: attached
        });
      }
    }

    // SEND TABLE ROWS
    const rows = await this.getCompetitorTableRows({
      project_name: normalizedKey,
      user_id
    });

    // start BG
    this.generateCompetitorsInBackground({
      normalizedKey,
      content_ref_id,
      keywordUrlC,
      TARGET,
      user_id
    });

    return res.send(
      Response.userSuccessResp("Fresh competitors fetched", {
        rows,
        total_generated: rows.length,
        target: TARGET,
        status: rows.length >= TARGET ? "completed" : "running"
      })
    );
  } catch (error) {
    logger.error("API ERROR → getStoreProcessCompetitors", error);
    return res.send(
      Response.userFailResp("Failed to fetch competitors", error)
    );
  }
}
async generateCompetitorsInBackground({
  normalizedKey,
  content_ref_id,
  keywordUrlC,
  TARGET,
  user_id
}) {
  const startTime = Date.now();
  const advertiserArray = [normalizedKey];
  const userObjectId = new mongoose.Types.ObjectId(user_id);

  let loopCount = 0;

  // 🔥 SMART TRACKING
  let lastCount = 0;
  let stableCount = 0;
  // Last progress_percentage DS reported on the /list poll below. Read here
  // (rather than only inside the poll) so the top-of-loop "competitor-progress"
  // emit — which fires before this iteration's poll — can still carry the most
  // recent value instead of always being one iteration behind.
  let lastProgressPercentage = null;
  const MAX_STABLE_RETRIES = 5;
  const MAX_PROCESSING_RETRIES = 30; // wait up to ~90s for API to finish processing
  let processingRetries = 0;
  let tokenExceeded = false;

  // Absolute ceiling on the WHOLE loop, independent of the stable/processing
  // retry counters above and of progress_percentage below. Those only break
  // when DS stops making progress — but if DS keeps trickling in a handful of
  // new candidates every poll without ever reaching TARGET (plausible for a
  // large TARGET like 100, if DS's real candidate pool for this niche is
  // smaller), `competitors.length > lastCount` stays true forever, resets
  // stableCount to 0 every time, and this loop never exits — the reported
  // infinite spinner for large requests, even though every individual HTTP
  // call inside it resolves fine. `startTime` was already captured above for
  // exactly this but was never actually used.
  //
  // DS confirmed some keyword/country/count combinations legitimately take up
  // to ~10 minutes to finish (e.g. 100 competitors + a country filter). This
  // ceiling is a last-resort circuit breaker for a genuinely stuck/misbehaving
  // request, not the expected exit path — see progress_percentage below for
  // the real completion signal — so it's set well above DS's stated worst case.
  const MAX_LOOP_DURATION_MS = 900000; // 15 minutes

  try {
    while (true) {
      loopCount++;

      if (Date.now() - startTime > MAX_LOOP_DURATION_MS) {
        logger.warn("generateCompetitorsInBackground exceeded max duration, stopping", {
          content_ref_id,
          normalizedKey,
          TARGET,
          loopCount,
          elapsedMs: Date.now() - startTime
        });
        break;
      }

      // TOKEN CHECK
      try {
        await this.updateUserDailyTokens(userObjectId, content_ref_id);
      } catch (tokenErr) {
        // Token sync failed (API down etc.) — don't kill the loop, just skip this sync
        console.log("[TOKEN SYNC FAILED]", tokenErr?.message);
      }
      const exceeded = await this.isDailyLimitExceeded(userObjectId);

      if (exceeded) {
        const reqDoc = await Competitors_request.findOne(
          { user_id: userObjectId, advertiser: advertiserArray },
          { competitors: 1 }
        );

        const generated = reqDoc?.competitors?.length || 0;

        getIO().to(content_ref_id).emit("token-limit-exceeded", {
          content_ref_id,
          message: "Daily AI token limit exceeded",
          generated,
          target: TARGET
        });

        tokenExceeded = true;
        break;
      }

      //  CURRENT PROGRESS
      const reqDoc = await Competitors_request.findOne(
        { user_id: userObjectId, advertiser: advertiserArray },
        { competitors: 1 }
      );

      const attachedCount = reqDoc?.competitors?.length || 0;


      getIO().to(content_ref_id).emit("competitor-progress", {
        content_ref_id,
        generated: attachedCount,
        target: TARGET,
        status: attachedCount >= TARGET ? "completed" : "running",
        progress_percentage: lastProgressPercentage
      });

      if (attachedCount >= TARGET) {

        break;
      }

      // 🌐 API CALL — always fetch from skip=0 so we get all available competitors.
      // Over-fetch the candidate pool so name-dedup still leaves >= TARGET unique.
      let response;
      try {
        response = await axios.get(keywordUrlC, {
          timeout: DS_REQUEST_TIMEOUT_MS,
          params: {
            content_ref_id,
            skip: 0,
            limit: this.competitorOverfetchLimit(TARGET)
          }
        });
      } catch (err) {
        // Same reasoning as getStoreProcessCompetitors' /list catch: a 422 is
        // OUR request being invalid (won't self-resolve by retrying), not DS
        // being slow — log it as an error with the actual DS response body so
        // it's diagnosable, instead of silently retrying for the full
        // MAX_LOOP_DURATION_MS with no visible sign of what's actually wrong.
        const status = err?.response?.status;
        logger[status === 422 ? "error" : "warn"](
          status === 422 ? "Background /list poll rejected our request (won't self-resolve on retry)" : "Background /list poll failed, retrying",
          { status, message: err?.message, responseBody: err?.response?.data, content_ref_id }
        );
        await this.sleep(2000);
        continue;
      }

      const apiData = response?.data?.data || {};
      const competitors = apiData?.competitors || [];
      const totalItems = apiData?.total_items || 0;
      const completedItems = apiData?.completed_items || 0;
      const isStillProcessing = totalItems > 0 && completedItems < totalItems;
      // DS confirmed their /list API reports true completion via
      // progress_percentage, and that generation for some keyword/country/
      // count combinations legitimately runs well past our old stable/
      // processing retry windows (up to ~10 minutes). Trust this field over
      // those retry counters when DS provides it — only fall back to the
      // counters below for responses that don't include it.
      const progressPercentage =
        typeof apiData?.progress_percentage === "number"
          ? apiData.progress_percentage
          : null;
      lastProgressPercentage = progressPercentage;

      // SMART LOGIC

      // NEW DATA ARRIVED
      if (competitors.length > lastCount) {

        lastCount = competitors.length;
        stableCount = 0;

        // SAVE — attach up to TARGET unique competitors (caps overshoot from over-fetch)
        await this.attachCompetitorsCappedToTarget({
          user_id,
          normalizedKey,
          competitors,
          TARGET
        });

        // SEND TO UI
        const rows = await this.getCompetitorTableRows({
          project_name: normalizedKey,
          user_id
        });

        // Enrich rows with ES stats before emitting so FE receives pre-populated data
        let enrichedRows = rows;
        try {
          const names = rows.map(r => r.name).filter(Boolean);
          if (names.length > 0) {
            const esStats = await DashboardService.getCompetitorsCountNewInternal(names);
            enrichedRows = rows.map(row => {
              const stats = esStats[row.name] || {};
              const popVal = stats.averagePopularity || 0;
              const popLabel = popVal > 66 ? "High" : popVal > 33 ? "Medium" : "Low";
              return {
                ...row,
                total_ads: stats.competitorsCount || 0,
                today_ads: stats.todayAdsCount || 0,
                yesterday_ads: stats.yesterdayAdsCount || 0,
                last_week_ads: stats.lastWeekAdsCount || 0,
                last_month_ads: stats.lastMonthAdsCount || 0,
                impressions: stats.averageImpression || 0,
                popularity: stats.averagePopularity
                  ? `${popLabel} (${Number(popVal).toFixed(2)}%)`
                  : "Low (0%)",
                budget: stats.totalBudget
                  ? `$${Number(stats.totalBudget).toLocaleString()}`
                  : "$0",
                countries: stats.uniqueCountries || row.countries || [],
                platforms: (() => {
                  const p = [];
                  const pc = stats.platformCompetitorCount || {};
                  if (pc.facebook > 0) p.push("Facebook");
                  if (pc.instagram > 0) p.push("Instagram");
                  return p.length > 0 ? p : (row.platforms || []);
                })(),
              };
            });
          }
        } catch (e) {
          logger.error("Failed to enrich competitor-batch with ES stats:", e);
        }

        getIO().to(content_ref_id).emit("competitor-batch", { content_ref_id, rows: enrichedRows });

        // FAST LOOP if data coming
        await this.sleep(500);
        continue;
      }

      // SAME DATA AGAIN
      if (competitors.length === lastCount && competitors.length > 0) {
        if (progressPercentage !== null) {
          if (progressPercentage >= 100) {
            break;
          }
          // DS says it's not done yet — keep polling regardless of how many
          // stable/unchanged polls we've seen, up to the absolute ceiling.
          await this.sleep(3000);
          continue;
        }

        // Fallback heuristic — only reached when DS doesn't report
        // progress_percentage on this response.
        // If API is still processing, don't count towards stable retries — just wait
        if (isStillProcessing) {
          processingRetries++;

          if (processingRetries >= MAX_PROCESSING_RETRIES) {
            break;
          }

          await this.sleep(3000);
          continue;
        }

        stableCount++;

        if (stableCount >= MAX_STABLE_RETRIES) {
          break;
        }

        await this.sleep(2000);
        continue;
      }

      // EMPTY CASE
      if (competitors.length === 0) {
        if (progressPercentage !== null) {
          if (progressPercentage >= 100) {
            break;
          }
          await this.sleep(3000);
          continue;
        }

        // Fallback heuristic — only reached when DS doesn't report
        // progress_percentage on this response.
        // If API is still processing, don't count towards stable retries — just wait
        if (isStillProcessing) {
          processingRetries++;

          if (processingRetries >= MAX_PROCESSING_RETRIES) {
            break;
          }

          await this.sleep(3000);
          continue;
        }

        stableCount++;

        if (stableCount >= MAX_STABLE_RETRIES) {
          break;
        }

        await this.sleep(3000);
        continue;
      }
    }

  } catch (err) {
    logger.error("BG ERROR", err);
  } finally {
    // Guarantee the UI stops "generating" no matter how the loop exited.
    // The top-of-loop progress event only emits "completed" when attachedCount
    // reaches TARGET; the retry-cap exits (stable / still-processing) break
    // silently, which would otherwise leave the spinner running forever.
    //
    // Also persist generation_status = "completed" regardless of tokenExceeded
    // (the loop is stopping either way, so nothing further will update this
    // project) — this is what lets a page refresh tell "still generating" apart
    // from "done (maybe fewer than requested)" instead of just seeing an empty
    // competitors list with no explanation.
    try {
      await Competitors_request.updateOne(
        { user_id: userObjectId, advertiser: advertiserArray },
        { $set: { generation_status: "completed" } }
      );
    } catch (statusErr) {
      logger.error("Failed to persist final generation_status", statusErr);
    }

    if (!tokenExceeded) {
      try {
        const finalDoc = await Competitors_request.findOne(
          { user_id: userObjectId, advertiser: advertiserArray },
          { competitors: 1 }
        );
        const finalCount = finalDoc?.competitors?.length || 0;
        getIO().to(content_ref_id).emit("competitor-progress", {
          content_ref_id,
          generated: finalCount,
          target: TARGET,
          status: "completed",
          progress_percentage: 100
        });
      } catch (emitErr) {
        logger.error("Failed to emit final competitor-progress", emitErr);
      }
    }
  }
}
  async attachCompetitorsToUserRequest(user_id, advertiserArray, competitorIds, competitors) {
  try {
    if (!competitorIds?.length) return;

    const userObjectId = new mongoose.Types.ObjectId(user_id);

      // Ensure we use the brand-only name for the advertiser link in DB
      const brand = this.normalizeAdvertiser(advertiserArray[0] || "");
      const dbAdvertiserArray = [brand];

    // Carry DS's `specific_to_match` (see dev_payloads_specific_to.md) through
    // to this per-request doc, keyed by competitor name — it only exists on
    // the raw Python response, not on the shared `competitors` master doc.
    const specificToEntries = (competitors || [])
      .filter((c) => c?.specific_to_match && c?.tool_name)
      .map((c) => ({
        name: c.tool_name.toLowerCase().trim(),
        match: c.specific_to_match,
      }));

    const update = {
      $setOnInsert: {
        user_id: userObjectId,
        advertiser: dbAdvertiserArray,
        monitoring: [],
        email_status: 0,
        country: [],
        category: []
          // brand_url is set correctly by checkCompetitorProcess
      },
      $addToSet: {
        competitors: { $each: competitorIds }
      }
    };
    if (specificToEntries.length) {
      update.$push = { specificToMatches: { $each: specificToEntries } };
    }

    await Competitors_request.updateOne(
      {
        user_id: userObjectId,
        advertiser: dbAdvertiserArray
      },
      update,
      { upsert: true }
    );
  } catch (err) {
    logger.error("ATTACH USER COMPETITORS ERROR", err);
  }
}
  async checkExistingCompetitorCount(req, res) {
    try {
      let brand = req.body?.advertiser;
      if (Array.isArray(brand)) brand = brand[0];
      brand = brand?.toLowerCase().trim();

      const page = Number(req.query.page) || 1;
      const limit = 10;
      const skip = (page - 1) * limit;

      if (!brand) {
        return res.status(400).json({
          code: 400,
          message: "Advertiser is required",
        });
      }

      const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const doc = await Existing_competitors.findOne(
        {
          advertiser: {
            $regex: new RegExp(`^${escapedBrand}$`, "i"),
          },
        },
        { competitors: 1 }
      ).lean();

      const competitorsArr = doc?.competitors ?? [];
      const count = competitorsArr.length;

      if (count < 200) {
        return res.status(409).json({
          code: 409,
          message: "Need more number of competitors",
          count,
        });
      }

      // 1. Fetch monitored competitors details
      const userId = req.body?.user_id;
      let monitoredNames = new Set();
      let compReqId = null;
      let monitoringIds = [];

      if (userId) {
        const compRequest = await Competitors_request.findOne({
          user_id: new mongoose.Types.ObjectId(userId),
          advertiser: { $regex: new RegExp(`^${escapedBrand}$`, "i") }
        });

        if (compRequest) {
          compReqId = compRequest._id;
          monitoringIds = compRequest.monitoring || [];
          const monitoredDetails = await Competitors.find(
            { _id: { $in: monitoringIds } },
            { competitor_name: 1 }
          ).lean();
          monitoredNames = new Set(monitoredDetails.map(c => c.competitor_name.toLowerCase().trim()));
        }
      }

      // 2. Map all pool competitors and mark monitored status
      let allMerged = competitorsArr.map(c => ({
        name: c.competitor_name,
        url: c.competitor_url,
        monitored: monitoredNames.has(c.competitor_name.toLowerCase().trim())
      }));

      // 3. Sort monitored at top, then by name
      allMerged.sort((a, b) => {
        if (a.monitored === b.monitored) {
          return a.name.localeCompare(b.name);
        }
        return a.monitored ? -1 : 1;
      });

      // 4. Pagination
      const paginated = allMerged.slice(skip, skip + limit);
      const names = paginated.map(c => c.name);

      // 5. Build detailed comp_details
      const dbCompetitors = await Competitors.find({
        competitor_name: { $in: names }
      }).lean();

      const dbCompMap = dbCompetitors.reduce((acc, c) => {
        acc[c.competitor_name.toLowerCase().trim()] = c._id;
        return acc;
      }, {});

      const compDetails = paginated.reduce((acc, c) => {
        const nameKey = c.name.toLowerCase().trim();
        acc[c.name] = {
          id: dbCompMap[nameKey] || null,
          comp_request_id: compReqId,
          monitoring: c.monitored,
          url: c.url
        };
        return acc;
      }, {});

      const advertiserAdsCount = await this.getAdvertiserAdCount(brand);
      return res.status(200).json({
        code: 201,
        message: "Enough number of competitors",
        count,
        currentPage: page,
        totalPages: Math.ceil(count / limit),
        competitor_names: names,
        comp_details: compDetails,
        advertiser_ads_count: advertiserAdsCount
      });

    } catch (error) {
      logger.error("Error in function checkExistingCompetitorCount", error);
      return res.status(500).json({
        code: 500,
        message: "Failed to fetch competitors count",
      });
    }
  }


  async getAllCompetitors(req, res) {
    try {
      let brand = req.body?.advertiser;
      if (Array.isArray(brand)) brand = brand[0];
      brand = brand?.toLowerCase().trim();

      if (!brand) {
        return res.status(400).json({
          code: 400,
          message: "Advertiser is required",
        });
      }

      const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const doc = await Existing_competitors.findOne(
        {
          advertiser: {
            $regex: new RegExp(`^${escapedBrand}$`, "i"),
          },
        },
        { competitors: 1 }
      ).lean();

      const competitorsArr = doc?.competitors ?? [];

      const simpleList = competitorsArr.map(c => ({
        competitor_name: c.competitor_name,
        competitor_url: c.competitor_url
      }));

      return res.status(200).json({
        code: 200,
        message: "Fetched all competitors successfully",
        data: simpleList
      });

    } catch (error) {
      logger.error("Error in function getAllCompetitors", error);
      return res.status(500).json({
        code: 500,
        message: "Failed to fetch all competitors",
      });
    }
  }

  async getAdvertiserAdCount(advertiser) {
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
  async getCompetitorIdsFromMaster(competitors) {
    if (!competitors?.length) return [];

    // normalize once
    const normalized = competitors.map(c => ({
      name: c.tool_name?.toLowerCase().trim(),
      url: c.domain?.toLowerCase().trim()
    })).filter(c => c.name);

    const names = normalized.map(c => c.name);

    // find existing (case-insensitive)
    const existing = await Competitors.find(
      { competitor_name: { $in: names } },
      { _id: 1, competitor_name: 1 }
    );

    const existingMap = new Map(
      existing.map(c => [c.competitor_name.toLowerCase(), c._id])
    );

    // prepare new ones
    const newDocs = normalized
      .filter(c => !existingMap.has(c.name))
      .map(c => ({
        competitor_name: c.name,
        competitor_url: c.url || null
      }));

    let newIds = [];

    if (newDocs.length) {
      // const inserted = await Competitors.insertMany(newDocs);
      // newIds = inserted.map(d => d._id);
       try {

        const inserted = await Competitors.insertMany(newDocs, {
          ordered: false   // continue if duplicate happens
        });

        newIds = inserted.map(d => d._id);

      } catch (err) {

        // ignore duplicate key error
        if (err.code === 11000) {

          // fetch ids for all names (both existing + newly inserted)
          const all = await Competitors.find(
            { competitor_name: { $in: names } },
            { _id: 1 }
          );

          newIds = all.map(d => d._id);

        } else {
          throw err;
        }
      }
    }

    return [
      ...existing.map(c => c._id),
      ...newIds
    ];
  }

  async getCompetitorTableRows({ project_name, user_id }) {
  const userObjectId = new mongoose.Types.ObjectId(user_id);

  const projectDoc = await Competitors_request.findOne({
    user_id: userObjectId,
    advertiser: [project_name]
  }).lean();

  if (!projectDoc) return [];

  const competitorIds = projectDoc.competitors || [];
  const monitoredIds = projectDoc.monitoring || [];

  const competitors = await Competitors.find(
    { _id: { $in: competitorIds } }
  ).sort({ competitor_name: 1 })
  .lean();

  const monitoredSet = new Set(monitoredIds.map(id => id.toString()));

  // Last-write-wins per name — a competitor could in principle be attached
  // more than once across separate generation rounds with different filters.
  const matchByName = new Map(
    (projectDoc.specificToMatches || []).map(m => [m.name, m.match])
  );

  return competitors.map(c => ({
    id: c._id,
    name: c.competitor_name,
    url: c.competitor_url,
    monitoring: monitoredSet.has(c._id.toString()),
    specific_to_match: matchByName.get(c.competitor_name?.toLowerCase().trim()) || null,
    comp_request_id: projectDoc._id 
  }));
}

async checkDailyTokenLimit(req, res) {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({
        status: "fail",
        message: "user_id is required"
      });
    }

    const userObjectId = new mongoose.Types.ObjectId(user_id);

    const today = new Date().toISOString().slice(0, 10);

    const doc = await UserDailyTokens.findOne({
      user_id: userObjectId,
      date: today
    });

    const used = doc?.output_tokens || 0;
    const limit = config.get("MAXIMUM_TOKEN_COUNt") || 20000;

    return res.json({
      status: "success",
      data: {
        used,
        limit,
        remaining: Math.max(limit - used, 0),
        exceeded: used >= limit
      }
    });

  } catch (err) {
    logger.error("CHECK TOKEN LIMIT ERROR", err);
    return res.status(500).json({
      status: "fail",
      message: "Server error"
    });
  }
  }

  async fetchKeywordsBasedOnWebsite(req, res) {
    try {
      const { webSiteUrl, adv } = req.body;
      const keywordUrl = config.get("COMPETITOR_URL_PYTHON") + "/v1/api/analysis/init";

      // weblink expects to be a query param
      const response = await axios.post(keywordUrl, null, {
        params: { weblink: webSiteUrl },
        timeout: DS_REQUEST_TIMEOUT_MS
      });
      return res.json(response.data);
    } catch (err) {
      logger.error("Error occured in function fetchKeywordsBasedOnWebsite", err.message);
      return res.status(400).json({
        code: 400,
        message: "Something went wrong: " + err.message
      });
    }
  }

  async checkCompetitorProcess(req, res) {
    try {
      const { user_id, content_ref_id, keywords, limit, advertiser, country } = req.body;
      if (!user_id) {
        return res.status(400).json({ code: 400, message: "user_id is required" });
      }

      // Check daily limit
      const exceeded = await this.isDailyLimitExceeded(new mongoose.Types.ObjectId(user_id));
      if (exceeded) {
        return res.json({ data: { exceeded: true } });
      }

      const advArray = Array.isArray(advertiser) ? advertiser : [advertiser];
      const fullBrand = (advArray[0] || advertiser || "");
      const countryArray = Array.isArray(country) ? country.filter(Boolean) : (country ? [country] : []);

      const brand = this.normalizeAdvertiser(fullBrand);

      // --- ENSURE PROJECT EXISTS IN MONGODB ---
      let project = await Competitors_request.findOne({
        user_id: new mongoose.Types.ObjectId(user_id),
        advertiser: [brand]
      });

      // Track whether THIS request created the project, so a failed/timed-out
      // DS call below can clean up the phantom empty brand it caused — without
      // ever touching a pre-existing project from an earlier successful run.
      let createdNewProject = false;

      if (!project) {
        project = await Competitors_request.create({
          user_id: new mongoose.Types.ObjectId(user_id),
          advertiser: [brand],
          brand_url: fullBrand, // Full domain
          competitors: [],
          monitoring: [],
          country: countryArray,
          content_ref_id: content_ref_id,
          target_count: Number(limit) || 0,
          generation_status: "running"
        });
        createdNewProject = true;
        logger.info(`Created new project record: ${brand} (Targeting: ${fullBrand})`);
      } else {
        // Re-generating against an existing project (e.g. a retry, or
        // requesting more competitors later) — refresh the fields that let a
        // page refresh mid-generation reconnect correctly: this request's
        // content_ref_id (for rejoining the right socket room) and target
        // (for an accurate "X/Y" until this run finishes). Uses updateOne
        // (like the rest of this file, e.g. getStoreProcessCompetitors) rather
        // than project.save() — works whether `project` is a full mongoose
        // document or a lean/plain result, and doesn't require a second round
        // trip to re-fetch it first.
        const setFields = {
          content_ref_id: content_ref_id,
          target_count: Number(limit) || project.target_count || 0,
          generation_status: "running"
        };
        if (countryArray.length && !project.country?.length) {
          // Backfill country onto an existing (e.g. race-created) project doc.
          setFields.country = countryArray;
        }
        await Competitors_request.updateOne({ _id: project._id }, { $set: setFields });
      }
      // ----------------------------------------

      const keywordUrl = config.get("COMPETITOR_URL_PYTHON") + "/v1/api/competitors/prepare";

      const keywordsArray = Array.isArray(keywords)
        ? [...keywords]
        : (keywords ? [keywords] : []);

      const formParams = {
        content_ref_id: content_ref_id,
        keywords: keywordsArray,
        // Over-fetch so name-dedup losses still leave >= `limit` unique competitors
        limit: this.competitorOverfetchLimit(limit),
        advertiser: fullBrand, // SEND FULL DOMAIN TO PYTHON API
        domain_validation: false,
        input_token_budget: 20000,
        output_token_budget: 20000
      };

      // DS's `specific_to: { <attribute>: [<values>] }` contract (see
      // dev_payloads_specific_to.md) is the proper, enforced way to constrain
      // generation — replaces the earlier "Brands from ..." keyword hack.
      // Their examples use lowercase values ("china", "japan"), so match that.
      if (countryArray.length) {
        formParams.specific_to = {
          country: countryArray.map((c) => c.toLowerCase()),
        };
      }


      let response;
      try {
        response = await axios.post(keywordUrl, formParams, {
          params: {
            content_ref_id: content_ref_id,
            advertiser: advArray[0] || advArray
          },
          // Bound this call — without it, a slow/hung DS response holds this
          // HTTP request (and the frontend's spinner) open indefinitely, while
          // the project doc above has already been persisted with no
          // competitors. See DS_REQUEST_TIMEOUT_MS comment for context.
          timeout: DS_REQUEST_TIMEOUT_MS
        });
      } catch (dsErr) {
        // DS call failed or timed out. Don't leave a phantom empty brand behind
        // from THIS request — only clean up if we created it just now; a
        // pre-existing project (e.g. a retry after competitors already
        // attached) is left untouched.
        if (createdNewProject) {
          await Competitors_request.deleteOne({ _id: project._id }).catch((cleanupErr) => {
            logger.error("Failed to clean up phantom project after DS call failure", cleanupErr.message);
          });
        }
        const isTimeout = dsErr.code === "ECONNABORTED" || /timeout/i.test(dsErr.message || "");
        logger.error("DS competitors/prepare call failed", {
          error: dsErr.message,
          timeout: isTimeout,
          limit
        });
        return res.status(isTimeout ? 504 : 502).json({
          code: isTimeout ? 504 : 502,
          message: isTimeout
            ? "The competitor generation service took too long to respond. Please try again — requesting fewer competitors may help."
            : "Failed to reach the competitor generation service. Please try again."
        });
      }

      const pythonResponse = response.data;
      if (!pythonResponse.data) pythonResponse.data = {};
      pythonResponse.data.exceeded = false;
      pythonResponse.data._id = project._id; // Provide the project ID back to frontend

      return res.json(pythonResponse);
    } catch (err) {
      console.log(err);

      logger.error("Error occured in function checkCompetitorProcess", err.message);
      return res.status(400).json({
        code: 400,
        message: "Something went wrong: " + err.message
    });
    }
  }

  async addManualCompetitor(req, res) {
    try {
      const { user_id, advertiser, competitor_name, competitor_url } = req.body || {};

      if (!user_id || !advertiser || !competitor_name) {
        return res.status(400).json(
          Response.validationFailResp(
            "user_id, advertiser and competitor_name are required",
            ""
          )
        );
      }

      const brand = this.normalizeAdvertiser(advertiser);
      // Master Competitors are stored canonically lowercase (see getCompetitorIdsFromMaster)
      const normalizedName = String(competitor_name).trim().toLowerCase();
      const trimmedUrl = competitor_url ? String(competitor_url).trim() : "";
      const userObjectId = new mongoose.Types.ObjectId(user_id);

      if (!normalizedName) {
        return res.status(400).json(
          Response.messageResp("competitor_name cannot be empty")
        );
      }

      // Reject pure punctuation/whitespace-only junk (e.g. "!!!", "---") — a
      // low bar, not real company-name verification. We don't block a name
      // just because we have no ad data for it yet (see has_ad_data below,
      // by design: this manual-add path exists precisely so a user can
      // pre-emptively track a competitor before we've crawled any of their
      // ads), only names with no actual content at all.
      if (!/[\p{L}\p{N}]/u.test(normalizedName)) {
        return res.status(400).json(
          Response.messageResp("Please enter a valid competitor name")
        );
      }

      if (!isValidWebsiteUrl(trimmedUrl)) {
        return res.status(400).json(
          Response.messageResp(
            "Please enter a valid website URL (e.g. walmart.com), or leave it blank"
          )
        );
      }

      const escapedName = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const project = await Competitors_request.findOne({
        user_id: userObjectId,
        advertiser: {
          $elemMatch: {
            $regex: new RegExp(
              "^" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
              "i"
            ),
          },
        },
      });

      if (!project) {
        return res.status(404).json(
          Response.messageResp("Project not found for this user")
        );
      }

      // Master Competitors collection (unique by name, case-insensitive lookup)
      let competitorDoc = await Competitors.findOne({
        competitor_name: {
          $regex: new RegExp("^" + escapedName + "$", "i"),
        },
      });

      if (!competitorDoc) {
        try {
          competitorDoc = await Competitors.create({
            competitor_name: normalizedName,
            competitor_url: trimmedUrl || "",
          });
        } catch (err) {
          if (err?.code === 11000) {
            competitorDoc = await Competitors.findOne({
              competitor_name: {
                $regex: new RegExp("^" + escapedName + "$", "i"),
              },
            });
          } else {
            throw err;
          }
        }
      }

      if (!competitorDoc) {
        return res.status(500).json(
          Response.messageResp("Failed to create competitor")
        );
      }

      const competitorId = competitorDoc._id;
      const canonicalName = competitorDoc.competitor_name;
      const canonicalUrl = competitorDoc.competitor_url || trimmedUrl || "";

      // Pool for this advertiser — only add if no case-insensitive match exists
      // ($addToSet on subdocuments does strict deep-equality, so "Puma" and "puma"
      // would otherwise be treated as different entries)
      const poolDoc = await Existing_competitors.findOne(
        { advertiser: brand },
        { competitors: 1 }
      );
      const poolHasName = poolDoc?.competitors?.some(
        (c) => (c.competitor_name || "").toLowerCase() === canonicalName.toLowerCase()
      );

      if (!poolHasName) {
        await Existing_competitors.updateOne(
          { advertiser: brand },
          {
            $setOnInsert: { advertiser: brand },
            $push: {
              competitors: {
                competitor_name: canonicalName,
                competitor_url: canonicalUrl,
              },
            },
          },
          { upsert: true }
        );
      }

      // Already attached?
      const alreadyAttached = project.competitors?.some(
        (id) => id.toString() === competitorId.toString()
      );

      if (!alreadyAttached) {
        await Competitors_request.updateOne(
          { _id: project._id },
          {
            $addToSet: {
              competitors: competitorId,
            },
          }
        );
      }

      // Non-blocking signal for the frontend: does this name actually have
      // any known ad data yet? A manually-typed name is trusted input (this
      // path exists so a user can track a competitor before we've crawled
      // any of their ads), so this never blocks the add — it only lets the
      // UI show an informational "no ads found yet" notice instead of
      // silently treating an arbitrary/possibly-fake name as fully verified.
      let hasAdData = null;
      try {
        const stats = await DashboardService.getCompetitorsCountNewInternal([canonicalName]);
        hasAdData = (stats?.[canonicalName]?.competitorsCount || 0) > 0;
      } catch (statsErr) {
        logger.error("addManualCompetitor: ad-data existence check failed (non-fatal)", statsErr);
      }

      return res.send(
        Response.userSuccessResp(
          alreadyAttached
            ? "Competitor already exists in this project"
            : "Competitor added successfully",
          {
            id: competitorId,
            comp_request_id: project._id,
            name: canonicalName,
            url: canonicalUrl,
            monitoring: false,
            already_existed: alreadyAttached,
            has_ad_data: hasAdData,
          }
        )
      );
    } catch (error) {
      logger.error("Error in addManualCompetitor", error);
      return res.status(500).json(
        Response.userFailResp("Error in adding competitor", error)
      );
    }
  }

  async deleteProject(req, res) {
    try {
      const { user_id, advertiser } = req.body;

      if (!user_id || !advertiser) {
        return res.status(400).json({
          statusCode: 400,
          body: { status: "fail", message: "user_id and advertiser are required" }
        });
      }

      const result = await Competitors_request.deleteOne({
        user_id: new mongoose.Types.ObjectId(user_id),
        advertiser: { $elemMatch: { $regex: new RegExp("^" + advertiser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i") } }
      });

      if (result.deletedCount === 0) {
        return res.json({
          statusCode: 404,
          body: { status: "fail", message: "Project not found" }
        });
      }

      return res.json({
        statusCode: 200,
        body: { status: "success", message: "Project deleted successfully" }
      });

    } catch (err) {
      logger.error("Error in deleteProject", err);
      return res.status(500).json({
        statusCode: 500,
        body: { status: "fail", message: "Server error: " + err.message }
      });
    }
  }

  // Detach a single competitor from a project (removes the ObjectId reference
  // from the project's `competitors` + `monitoring` arrays). The master
  // Competitors document is left intact since it is shared across projects.
  async deleteCompetitor(req, res) {
    try {
      const { user_id, advertiser, competitor_id, competitor_name } =
        req.body || {};

      if (!user_id || !advertiser || (!competitor_id && !competitor_name)) {
        return res.status(400).json(
          Response.validationFailResp(
            "user_id, advertiser and competitor_id (or competitor_name) are required",
            ""
          )
        );
      }

      const brand = this.normalizeAdvertiser(advertiser);
      const userObjectId = new mongoose.Types.ObjectId(user_id);

      const project = await Competitors_request.findOne({
        user_id: userObjectId,
        advertiser: {
          $elemMatch: {
            $regex: new RegExp(
              "^" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$",
              "i"
            ),
          },
        },
      });

      if (!project) {
        return res.status(404).json(
          Response.messageResp("Project not found for this user")
        );
      }

      // Resolve the competitor ObjectId — prefer the supplied id, fall back to
      // a case-insensitive name lookup against the master Competitors collection.
      let competitorId = null;
      if (competitor_id && mongoose.Types.ObjectId.isValid(competitor_id)) {
        competitorId = new mongoose.Types.ObjectId(competitor_id);
      } else if (competitor_name) {
        const escapedName = String(competitor_name)
          .trim()
          .toLowerCase()
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const competitorDoc = await Competitors.findOne({
          competitor_name: { $regex: new RegExp("^" + escapedName + "$", "i") },
        });
        if (competitorDoc) competitorId = competitorDoc._id;
      }

      if (!competitorId) {
        return res.status(404).json(
          Response.messageResp("Competitor not found")
        );
      }

      const result = await Competitors_request.updateOne(
        { _id: project._id },
        {
          $pull: {
            competitors: competitorId,
            monitoring: competitorId,
          },
        }
      );

      return res.send(
        Response.userSuccessResp("Competitor removed successfully", {
          competitor_id: competitorId,
          comp_request_id: project._id,
          removed: result.modifiedCount > 0,
        })
      );
    } catch (error) {
      logger.error("Error in deleteCompetitor", error);
      return res.status(500).json(
        Response.userFailResp("Error in removing competitor", error)
      );
    }
  }
}

export default new CompetitorService();
