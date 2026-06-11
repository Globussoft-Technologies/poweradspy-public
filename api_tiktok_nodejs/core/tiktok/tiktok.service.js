// Imports
import fs from "fs";
import axios from "axios";
import config from "config";
import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import TikTokValidation from "./tiktok.validate.js";
import { uploadFile } from "../../utils/fileUploading.js";
import db from "../../Sequelize_cli/models/index.js";
import convertTimeStamp, { daysRunning } from "../../utils/epochConverter.js";
import { Op } from 'sequelize';

// Elastic search functions
import {
  createIndex,
  indexExists,
  updateDocument,
  searchDoc,
  searchDocs,
  deleteDoc,
  insertData,
  getAdsES,
  getAllESAdId,
} from "../../utils/elasticSearch.js";
import languageTranslation from "../../utils/languageAPI.js";

// Models
const {
  tiktok_ads: TIK_TOK,
  tiktok_ad_post_owners: POST_OWNER,
  tiktok_ad_country_ages: COUNTRY_AGES,
  tiktok_ad_country_gender: COUNTRY_GENDERS,
  tiktok_ad_meta_data: META_DATA,
  tiktok_ad_variants: VARIANTS,
  tiktok_ad_analytics: ANALYTICS,
  tiktok_ad_location: AD_LOCATION,
  tiktok_ad_html_lander: LANDER,
  tiktok_users :TIKTOK_USER
} = db;

class TikTokService {
  // Create ads
  async create(req, res) {
    const data = req?.body;
    const transaction = await db.sequelize.transaction();
    try {
        if (!data) {
            logger.error("Missing request data in body");
            await transaction.rollback();
            return res.send(
              Response.validationFailResp("Missing request data", "")
            );
        }

        if (!(await indexExists())) await createIndex();
        const adExist = await searchDoc("ad_id", data?.ad_id);
        const adExistSQL = await TIK_TOK.findOne({ where: { ad_id: data?.ad_id } })
      
        if(adExist && !adExistSQL){
          return this.updateESInsertSQL(req, res);
        } else if(adExistSQL && !adExist){
          return this.updateSQLInsertES(req, res);
        }
        else if (adExist && adExistSQL) {
            return this.update(req, res);
        }
        let [popularity, impression] = this.popularityImpression(
            data?.clicks_graph,
            data?.ctr,
            data.likes,
            data.comments,
            data.shares
        );
        const adPayload = {
            ...data,
            popularity,
            impression,
        };

        const { value, error } = TikTokValidation.createDetails(adPayload);

        if (error) {
            logger.error("VALIDATION_FAIL", error.details);
            await transaction.rollback();
            return res.send(Response.validationFailResp("VALIDATION_FAIL", error.details));
        }
        value.first_seen = convertTimeStamp(value.first_seen);
        value.last_seen = convertTimeStamp(value.last_seen);
        value["days_running"] = daysRunning(value.first_seen, value.last_seen);
        value["landerStatus"] = 0;
        value["landerData"] = {};

        let language;
        try {
            language = await languageTranslation(value?.ad_title, res);
            if (language?.code && language?.code === 500) {
                return res.send(Response.userFailResp("Language translation error", language?.msg)); 
            }
        } catch (langError) {
            await transaction.rollback();
            logger.error("Language translation error", langError);
            return res.send(Response.userFailResp("Language translation error", langError)); 
        }

        value["language"] = language;
    
        let s3uploadSuccess;
        if(value.thumbnailVaild=="VALID"){
          try {
            s3uploadSuccess = await this.getS3Url(
            value.video_cover,
            ".webp",
            value.ad_id
          );
         value.video_cover = s3uploadSuccess;
     } catch (error) {
         await transaction.rollback();
         logger.error("Unable to upload expired thumbnail-image into NAS", error);
         return res.send(Response.userFailResp("Unable to upload expired thumbnail-image into NAS", error));
     }
        } 

        let owner, created;
        try {
            [owner, created] = await POST_OWNER.findOrCreate({
                where: { post_owner: value.post_owner },
                transaction,
            });
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in findOrCreate POST_OWNER", error);
            return res.send(Response.userFailResp("Error in findOrCreate", error));
        }

        if (!created) {
            try {
                await POST_OWNER.increment(
                    { ads_count: 1 },
                    { where: { id: owner.id }, transaction }
                );
            } catch (error) {
                await transaction.rollback();
                logger.error("Error in POST_OWNER increment", error);
                return res.send(Response.userFailResp("Error in POST_OWNER increment", error));
            }
        }
        try {
          const [tiktokUser, createdUser] = await TIKTOK_USER.findOrCreate({
              where: { tiktok_account_id: value.tiktok_account_id },
              defaults: {
                  tiktok_account_name: value.tiktok_account_name,
                  system_id: value.system_id,
              },
              transaction
          });

          if (!createdUser) {
                  await tiktokUser.update(
                      { system_id: value.system_id },
                      { transaction }
                  );
          }
      } catch (error) {
          await transaction.rollback();
          logger.error("Error in TIKTOK_USER upsert", error);
          return res.send(Response.userFailResp("Error in TIKTOK_USER upsert", error));
      }
        let newTiktokAd;
        let esStore;
        try {
            newTiktokAd = await TIK_TOK.create(
                { ...value, post_owner_id: owner.id , tiktok_account_id: value.tiktok_account_id,
                  system_id: value.system_id,},
                { transaction }
            );
            value["sql_id"] = newTiktokAd.id;
            value["post_owner_id"] = owner.id;
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in TIK_TOK create", error);
            return res.send(Response.userFailResp("Error in TIK_TOK create", error));
        }
        const adInsertOperations = [
            AD_LOCATION.create(
                { ...value, ad_id: newTiktokAd.id },
                { transaction }
            ),
            META_DATA.create({ ...value, ad_id: newTiktokAd.id }, { transaction }),
            VARIANTS.create({ ...value, ad_id: newTiktokAd.id }, { transaction }),
            ANALYTICS.create({ ...value, ad_id: newTiktokAd.id }, { transaction }),
            LANDER.create({ ad_id: newTiktokAd.id }, { transaction }),
        ];

        if (value?.age) {
            const ageDetailsArray = Object.entries(value.age).map(
                ([country_name, values]) => ({
                    ad_id: newTiktokAd.id,
                    country_name,
                    age_details: this.formatAgeDetails(values),
                })
            );

            value.age = ageDetailsArray.map((ageObj) => {
                const { ad_id, ...rest } = ageObj;
                return rest;
            });

            adInsertOperations.push(
                COUNTRY_AGES.bulkCreate(ageDetailsArray, { transaction })
            );
        }

        if (value?.gender) {
            const genderDetailsArray = Object.entries(value.gender).map(
                ([country_name, values]) => ({
                    ad_id: newTiktokAd.id,
                    country_name,
                    gender_details: this.formatGenderDetails(values),
                })
            );

            value.gender = genderDetailsArray.map((genderObj) => {
                const { ad_id, ...rest } = genderObj;
                return rest;
            });

            adInsertOperations.push(
                COUNTRY_GENDERS.bulkCreate(genderDetailsArray, { transaction })
            );
        }
        let dbstore
        try {
           dbstore=await Promise.all(adInsertOperations);
          esStore=await insertData(this.esData(value));
      } catch (error) {
          await transaction.rollback();
          logger.error("Error in adInsertOperations", error);
          return res.send(Response.userFailResp("Error in adInsertOperations", error));
      }
    
        if(esStore?.result=='created' && dbstore?.length){
          await transaction.commit();
          logger.info("Ad created successfully", {
              id: newTiktokAd.id,
              ad_id: value.ad_id,
          });
          return res.status(201).send(
              Response.userSuccessResp("Ad created successfully", {
                  id: newTiktokAd.id,
                  ad_id: value.ad_id,
              })
          );
        } 
    } catch (error) {
        await transaction.rollback();
        logger.error("Error in inserting ad", error);
        // console.error("Error:", error.message);
        return res.send(Response.userFailResp("Error in inserting ad", error));
    }
    finally {
      if (transaction) {
          try {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
              await transaction.rollback();
            }
          } catch (error) {
              logger.error("Error releasing transaction connection", error);
          }
      }
}
  }

  // Update ads
  async update(req, res) {
    const data = req?.body;
    const transaction = await db.sequelize.transaction();

    try {
        if (!data) {
            logger.error("Missing request data in body");
            await transaction.rollback();
            return res.send(
                Response.validationFailResp("Missing request data", "")
            );
        }

        const adExist = await searchDoc("ad_id", data.ad_id);

        if (!adExist) {
            logger.error("Ad not found - failed to update the data");
            await transaction.rollback();
            return res.send(
                Response.validationFailResp(
                    "Ad not found - failed to update the data",
                    ""
                )
            );
        }
        let [popularity, impression] = this.popularityImpression(
            data.clicks_graph,
            data.ctr,
            data.likes,
            data.comments,
            data.shares
        );

        const adPayload = {
            ...data,
            popularity,
            impression,
        };

        const { value, error } = TikTokValidation.createDetails(adPayload);

        if (error) {
            logger.error("VALIDATION_FAIL", error.details);
            await transaction.rollback();
            return res.send(Response.validationFailResp("VALIDATION_FAIL", error.details));
        }
        value.first_seen = adExist.first_seen;
        value.last_seen = convertTimeStamp(data.last_seen);
        value["days_running"] = daysRunning(value.first_seen, value.last_seen);
        value["sql_id"] = adExist.sql_id;
        value["landerStatus"] = adExist.landerStatus;
        value["landerData"] = adExist.landerData;
        value["language"] = adExist.language;
        value["video_cover"] = adExist.video_cover;

        let owner;
        try {
            [owner] = await POST_OWNER.findOrCreate({
                where: { post_owner: value.post_owner },
                transaction,
            });
            value["post_owner_id"] = owner.id;
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in findOrCreate POST_OWNER", error);
            return res.send(Response.userFailResp("Error in findOrCreate POST_OWNER", error));
        }
        try {
          const [tiktokUser, createdUser] = await TIKTOK_USER.findOrCreate({
              where: { tiktok_account_id: value.tiktok_account_id },
              defaults: {
                  tiktok_account_name: value.tiktok_account_name,
                  system_id: value.system_id,
              },
              transaction
          });
      
          if (!createdUser) {
                  await tiktokUser.update(
                      { system_id: value.system_id },
                      { transaction }
                  );
          }
      } catch (error) {
          await transaction.rollback();
          logger.error("Error in TIKTOK_USER upsert", error);
          return res.send(Response.userFailResp("Error in TIKTOK_USER upsert", error));
      }
        let updateTiktokAd;
        try {
            await TIK_TOK.update(
                { ...value, post_owner_id: owner.id },
                { where: { ad_id: value.ad_id }, transaction }
            );
            updateTiktokAd = await TIK_TOK.findOne({ where: { ad_id: value.ad_id } });
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in TIK_TOK update", error);
            return res.send(Response.userFailResp("Error in TIK_TOK update", error));
        }

        const adUpdateOperations = [
            AD_LOCATION.update(
                { ...value, ad_id: updateTiktokAd.id },
                { where: { ad_id: updateTiktokAd.id }, transaction }
            ),
            META_DATA.update(
                { ...value, ad_id: updateTiktokAd.id },
                { where: { ad_id: updateTiktokAd.id }, transaction }
            ),
            VARIANTS.update(
                { ...value, ad_id: updateTiktokAd.id },
                { where: { ad_id: updateTiktokAd.id }, transaction }
            ),
        ];
        if (
            value.likes !== adExist.likes ||
            value.comments !== adExist.comments ||
            value.shares !== adExist.shares
        ) {
            adUpdateOperations.push(
                ANALYTICS.create(
                    { ...value, ad_id: updateTiktokAd.id },
                    { transaction }
                )
            );
        }
        if (value?.age) {
            const ageDetailsArray = Object.entries(value.age).map(
                ([country_name, values]) => ({
                    ad_id: updateTiktokAd.id,
                    country_name,
                    age_details: this.formatAgeDetails(values),
                })
            );

            value.age = ageDetailsArray.map((ageObj) => {
                const { ad_id, ...rest } = ageObj;
                return rest;
            });

            adUpdateOperations.push(
                this.updateOrCreateEntries(COUNTRY_AGES, ageDetailsArray, transaction)
            );
        }

        if (value?.gender) {
            const genderDetailsArray = Object.entries(value.gender).map(
                ([country_name, values]) => ({
                    ad_id: updateTiktokAd.id,
                    country_name,
                    gender_details: this.formatGenderDetails(values),
                })
            );

            value.gender = genderDetailsArray.map((genderObj) => {
                const { ad_id, ...rest } = genderObj;
                return rest;
            });

            adUpdateOperations.push(
                this.updateOrCreateEntries(
                    COUNTRY_GENDERS,
                    genderDetailsArray,
                    transaction
                )
            );
        }

        try {
            await Promise.all(adUpdateOperations);
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in adUpdateOperations", error);
            return res.send(Response.userFailResp("Error in ad update operations", error));
        }
        try {
            await updateDocument("ad_id", value.ad_id, this.esData(value));
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in updating Elasticsearch document", error);
            return res.send(Response.userFailResp("Error in updating Elasticsearch document", error));
        }
        await transaction.commit();
        logger.info("Ad updated successfully", {
            id: updateTiktokAd.id,
            ad_id: value.ad_id,
        });
        return res.send(
            Response.userSuccessResp("Ad updated successfully", {
                id: updateTiktokAd.id,
                ad_id: value.ad_id,
            })
        );
    } catch (error) {
        await transaction.rollback();
        logger.error("Error in data updation", error);
        // console.error("Error:", error);
        return res.send(Response.userFailResp("Error in data updation", error));
    }
    finally {
      if (transaction) {
          try {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
              await transaction.rollback();
            }
          } catch (error) {
              logger.error("Error releasing transaction connection", error);
          }
      }
}
  }

  //Update ES ADs
  async updateESInsertSQL(req, res) {
    const data = req?.body;
    const transaction = await db.sequelize.transaction();

   try{
    let [popularity, impression] = this.popularityImpression(
      data.clicks_graph,
      data.ctr,
      data.likes,
      data.comments,
      data.shares
  );
  const adPayload = {
      ...data,
      popularity,
      impression,
  };

  const { value, error } = TikTokValidation.createDetails(adPayload);

  if (error) {
      logger.error("VALIDATION_FAIL", error.details);
      await transaction.rollback();
      return res.send(Response.validationFailResp("VALIDATION_FAIL", error.details));
  }
  value.first_seen = convertTimeStamp(value.first_seen);
  value.last_seen = convertTimeStamp(value.last_seen);
  value["days_running"] = daysRunning(value.first_seen, value.last_seen);
  value["landerStatus"] = 0;
  value["landerData"] = {};

  let language;
  try {
      language = await languageTranslation(value?.ad_title, res);
      if (language?.code && language?.code === 500) {
          return res.send(Response.userFailResp("Language translation error", language?.msg)); 
      }
  } catch (langError) {
      await transaction.rollback();
      logger.error("Language translation error", langError);
      return res.send(Response.userFailResp("Language translation error", langError)); 
  }

  value["language"] = language;

  let s3uploadSuccess;
  if(value.thumbnailVaild=="VALID"){
    try {
      s3uploadSuccess = await this.getS3Url(
      value.video_cover,
      ".webp",
      value.ad_id
    );
   value.video_cover = s3uploadSuccess;
} catch (error) {
   await transaction.rollback();
   logger.error("Unable to upload expired thumbnail-image into NAS", error);
   return res.send(Response.userFailResp("Unable to upload expired thumbnail-image into NAS", error));
}
  } 

  let owner, created;
  try {
      [owner, created] = await POST_OWNER.findOrCreate({
          where: { post_owner: value.post_owner },
          transaction,
      });
  } catch (error) {
      await transaction.rollback();
      logger.error("Error in findOrCreate POST_OWNER", error);
      return res.send(Response.userFailResp("Error in findOrCreate", error));
  }

  if (!created) {
      try {
          await POST_OWNER.increment(
              { ads_count: 1 },
              { where: { id: owner.id }, transaction }
          );
      } catch (error) {
          await transaction.rollback();
          logger.error("Error in POST_OWNER increment", error);
          return res.send(Response.userFailResp("Error in POST_OWNER increment", error));
      }
  }
  try {
    const [tiktokUser, createdUser] = await TIKTOK_USER.findOrCreate({
        where: { tiktok_account_id: value.tiktok_account_id },
        defaults: {
            tiktok_account_name: value.tiktok_account_name,
            system_id: value.system_id,
        },
        transaction
    });

    if (!createdUser) {
            await tiktokUser.update(
                { system_id: value.system_id },
                { transaction }
            );
    }
} catch (error) {
    await transaction.rollback();
    logger.error("Error in TIKTOK_USER upsert", error);
    return res.send(Response.userFailResp("Error in TIKTOK_USER upsert", error));
}

  let newTiktokAd;
  try {
      newTiktokAd = await TIK_TOK.create(
          { ...value, post_owner_id: owner.id, tiktok_account_id: value.tiktok_account_id,
            system_id: value.system_id,},
          { transaction }
      );
      value["sql_id"] = newTiktokAd.id;
      value["post_owner_id"] = owner.id;
  } catch (error) {
      await transaction.rollback();
      logger.error("Error in TIK_TOK create", error);
      return res.send(Response.userFailResp("Error in TIK_TOK create", error));
  }
  const adInsertOperations = [
      AD_LOCATION.create(
          { ...value, ad_id: newTiktokAd.id },
          { transaction }
      ),
      META_DATA.create({ ...value, ad_id: newTiktokAd.id }, { transaction }),
      VARIANTS.create({ ...value, ad_id: newTiktokAd.id }, { transaction }),
      ANALYTICS.create({ ...value, ad_id: newTiktokAd.id }, { transaction }),
      LANDER.create({ ad_id: newTiktokAd.id }, { transaction }),
  ];

  let dbstore;
  let esStore;
  try {
     dbstore=await Promise.all(adInsertOperations);
    esStore =await updateDocument("ad_id", value.ad_id, this.esData(value));
} catch (error) {
    await transaction.rollback();
    logger.error("Error in adInsertOperations", error);
    return res.send(Response.userFailResp("Error in adInsertOperations", error));
}
if(esStore?.updated && dbstore?.length){
  await transaction.commit();
  logger.info("Ad Updated successfully", {
      id: newTiktokAd.id,
      ad_id: value.ad_id,
  });
  return res.status(201).send(
      Response.userSuccessResp("Ad Updated successfully", {
          id: newTiktokAd.id,
          ad_id: value.ad_id,
      })
  );
}
   } catch (error) {
        await transaction.rollback();
        logger.error("Error in data updation", error);
        // console.error("Error:", error);
        return res.send(Response.userFailResp("Error in data updation", error));
    }
    finally {
      if (transaction) {
          try {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
              await transaction.rollback();
            }
          } catch (error) {
              logger.error("Error releasing transaction connection", error);
          }
      }
}
  }

  //update SQL And Insert ES
  async updateSQLInsertES(req, res) {
    const data = req?.body;
    const transaction = await db.sequelize.transaction();

    try {
        if (!data) {
            logger.error("Missing request data in body");
            await transaction.rollback();
            return res.send(
                Response.validationFailResp("Missing request data", "")
            );
        }
        const adExistSQL = await TIK_TOK.findOne({ where: { ad_id: data?.ad_id } })
        const adExistVideoCover = await META_DATA.findOne({ where: { ad_id: adExistSQL?.id } })

        let [popularity, impression] = this.popularityImpression(
            data.clicks_graph,
            data.ctr,
            data.likes,
            data.comments,
            data.shares
        );

        const adPayload = {
            ...data,
            popularity,
            impression,
        };

        const { value, error } = TikTokValidation.createDetails(adPayload);

        if (error) {
            logger.error("VALIDATION_FAIL", error.details);
            await transaction.rollback();
            return res.send(Response.validationFailResp("VALIDATION_FAIL", error.details));
        }
        value.first_seen = adExistSQL.first_seen;
        value.last_seen = convertTimeStamp(data.last_seen);
        value["days_running"] = daysRunning(value.first_seen, value.last_seen);
        value["landerStatus"] = 0
        value["landerData"] = {}
        value["language"] = adExistSQL.language;
        value["video_cover"] = adExistVideoCover.video_cover;

        let owner;
        try {
            [owner] = await POST_OWNER.findOrCreate({
                where: { post_owner: value.post_owner },
                transaction,
            });
            value["post_owner_id"] = owner.id;
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in findOrCreate POST_OWNER", error);
            return res.send(Response.userFailResp("Error in findOrCreate POST_OWNER", error));
        }
        try {
          const [tiktokUser, createdUser] = await TIKTOK_USER.findOrCreate({
              where: { tiktok_account_id: value.tiktok_account_id },
              defaults: {
                  tiktok_account_name: value.tiktok_account_name,
                  system_id: value.system_id,
              },
              transaction
          });
      
          if (!createdUser) {
                  await tiktokUser.update(
                      { system_id: value.system_id },
                      { transaction }
                  );
          }
      } catch (error) {
          await transaction.rollback();
          logger.error("Error in TIKTOK_USER upsert", error);
          return res.send(Response.userFailResp("Error in TIKTOK_USER upsert", error));
      }
        let updateTiktokAd;
        try {
            await TIK_TOK.update(
                { ...value, post_owner_id: owner.id },
                { where: { ad_id: value.ad_id }, transaction }
            );
            updateTiktokAd = await TIK_TOK.findOne({ where: { ad_id: value.ad_id } });
            value["sql_id"] = updateTiktokAd.id;
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in TIK_TOK update", error);
            return res.send(Response.userFailResp("Error in TIK_TOK update", error));
        }

        const adUpdateOperations = [
            AD_LOCATION.update(
                { ...value, ad_id: updateTiktokAd.id },
                { where: { ad_id: updateTiktokAd.id }, transaction }
            ),
            META_DATA.update(
                { ...value, ad_id: updateTiktokAd.id },
                { where: { ad_id: updateTiktokAd.id }, transaction }
            ),
            VARIANTS.update(
                { ...value, ad_id: updateTiktokAd.id },
                { where: { ad_id: updateTiktokAd.id }, transaction }
            ),
        ];
        if (
            value.likes !== adExistSQL.likes ||
            value.comments !== adExistSQL.comments ||
            value.shares !== adExistSQL.shares
        ) {
            adUpdateOperations.push(
                ANALYTICS.create(
                    { ...value, ad_id: updateTiktokAd.id },
                    { transaction }
                )
            );
        }
        let dbUpdate;
        let esInsert;
        try {
          dbUpdate= await Promise.all(adUpdateOperations);
          esInsert=await insertData(this.esData(value));
        } catch (error) {
            await transaction.rollback();
            logger.error("Error in adUpdateOperations", error);
            return res.send(Response.userFailResp("Error in ad update operations", error));
        }
        if(esInsert?.result=='created' && dbUpdate?.length){
        await transaction.commit();
        logger.info("Ad updated successfully", {
            id: updateTiktokAd.id,
            ad_id: value.ad_id,
        });
        return res.send(
            Response.userSuccessResp("Ad updated successfully", {
                id: updateTiktokAd.id,
                ad_id: value.ad_id,
            })
        );
          }
    } catch (error) {
        await transaction.rollback();
        logger.error("Error in data updation", error);
        // console.error("Error:", error);
        return res.send(Response.userFailResp("Error in data updation", error));
    }
    finally {
      if (transaction) {
          try {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
              await transaction.rollback();
            }
          } catch (error) {
              logger.error("Error releasing transaction connection", error);
          }
      }
}
  }
  // Get analytics of single ad
  async getAnalytics(req, res) {
    const id = req?.params?.id;
    try {
      if (!id) {
        logger.error("Missing id field", id);
        return res.send(Response.validationFailResp("Missing id field", id));
      }
      let analyticsData = await searchDoc("sql_id", id);
      if (!analyticsData) {
        logger.error("No data found with that id", id);
        return res.send(
          Response.userFailResp("No data found with that id", id)
        );
      }
      logger.info("Found analytics data", analyticsData);
      return res.send(
        Response.userSuccessResp("Found analytics data", analyticsData)
      );
    } catch (error) {
      logger.error("Error fetching data", error);
      // console.error("Error:", error);
      return res.send(Response.userFailResp("Error fetching data", error));
    }
  }

  // Get all ads of an advertiser
  async getAdvertiserAds(req, res) {
    const owner = req?.params?.postOwner;
    try {
      if (!owner) {
        logger.error("Missing owner field", owner);
        return res.send(
          Response.validationFailResp("Missing owner field", owner)
        );
      }
      let advertiserAdsData = await searchDocs("post_owner", owner);

      if (advertiserAdsData.length === 0) {
        logger.error("No ads found with that owner", owner);
        return res.send(
          Response.userSuccessResp("No ads found with that owner", owner)
        );
      }
      logger.info("Found ads data", advertiserAdsData);
      return res.send(
        Response.userSuccessResp("Found ads data", advertiserAdsData)
      );
    } catch (error) {
      logger.error("Error fetching advertiser ads", error);
      // console.error("Error:", error);
      return res.send(
        Response.userFailResp("Error fetching advertiser ads", error)
      );
    }
  }

  // Delete an ad
  async deleteAd(req, res) {
    try {
      let id = req?.params?.id;
      if (!id) {
        logger.error("Missing id field", id);
        return res.send(Response.validationFailResp("Missing id", ""));
      }
      let deleteOperations = [
        await TIK_TOK.destroy({
          where: { id },
        }),
        await deleteDoc("sql_id", id),
      ];

      await Promise.all(deleteOperations);
      logger.info("Ad deleted successfully", id);
      return res.send(Response.userSuccessResp("Ad deleted successfully", id));
    } catch (error) {
      logger.error("Failed to delete ad", error);
      // console.log(err);
      res.send(Response.userFailResp("Failed to delete ad", error));
    }
  }
  async deleteSQLAd(req, res) {
    try {
      const { skip, limit } = req.query;
      // Fetch ads from MySQL
      const ads = await TIK_TOK.findAll({
        attributes: ["id", "ad_id"],
      });
  
      // MySQL deletion logic
      let adsToDelete = [];
      if (ads.length) {
        for (const ad of ads) {
          const { id, ad_id } = ad.dataValues;
          const adExist = await searchDoc("ad_id", ad_id);
          if (!adExist) {
            adsToDelete.push(id);
          }
        }
      } else {
        logger.info("No ads found in MySQL.");
      }
  
      if (adsToDelete.length) {
        const deleteOperations = await TIK_TOK.destroy({
          where: { id: adsToDelete },
        });
        logger.info(`${deleteOperations} ads deleted from MySQL.`);
      }
  
      // Elasticsearch deletion logic
      const adIdsInElastic = await getAllESAdId(skip, limit);
      let adsToDeleteFromElastic = [];
      if (adIdsInElastic.length) {
        for (const adId of adIdsInElastic) {
          const adExistsInDb = await TIK_TOK.findOne({
            where: { ad_id: adId },
          });
          if (!adExistsInDb) {
            adsToDeleteFromElastic.push(adId);
          }
        }

        for (const adId of adsToDeleteFromElastic) {
          const deleteResponse = await deleteDoc("ad_id", adId);
          logger.info(`Deleted ad with ad_id: ${adId}`, deleteResponse);
        }
  
        logger.info(`${adsToDeleteFromElastic.length} ads deleted from Elasticsearch.`);
      } else {
        logger.info("No ads found in Elasticsearch.");
      }
  
      return res.send(Response.userSuccessResp("Ad deleted successfully"));
    } catch (error) {
      logger.error("Failed to delete ad", error);
      // console.error(error);
      return res.send(Response.userFailResp("Failed to delete ad", error));
    }
  }
  
  // Get all ads
  async getAds(req, res) {
    try {
      let { skip, limit } = req?.query;
      skip = parseInt(skip) || config.get("skip");
      limit = parseInt(limit) || config.get("limit");
      let ads = await getAdsES(skip, limit);
      if (ads.length === 0) {
        logger.info("No ads found", "");
        return res.send(Response.userSuccessResp("No ads found", ""));
      }
      logger.info("Fetched ads successfully", ads);
      return res.send(
        Response.userSuccessResp("Fetched ads successfully", ads)
      );
    } catch (error) {
      logger.error("Error fetching ads", error);
      // console.error("Error:", error);
      return res.send(Response.userFailResp("Error fetching ads", error));
    }
  }

  //to get the Ad URLS
  async getAdURL(req, res) {
    try {
      let { skip, limit,status } = req?.query;
      skip = parseInt(skip) || config.get("skip");
      limit = parseInt(limit) || config.get("limit");
      status = status || 0;
      const ads = await META_DATA.findAll({
        attributes: ['ad_id', 'library_url', 'video_url'],
        where: {
          [Op.and]: [
            { thumb_nail_status: status }, 
            {
              video_cover: {
                [Op.or]: [
                  { [Op.like]: '%pasvideos%' }, 
                  { [Op.like]: '%https%' } 
                ],
              },
            },
          ],
        },
        order: [['ad_id', 'DESC']],
        limit: limit,
      });
      if (ads?.length === 0) {
        logger.info("No ads found", "");
        return res.send(Response.userSuccessResp("No ads found", ""));
      }
    
      const libraryUrls = ads.map(ad => ad?.library_url);
      for (let libraryUrl of libraryUrls) {  
        let videoURL= await this.getVideoURL1(libraryUrl ); 
        ads[0].video_url= videoURL
      }

      const adIdss = ads.map(ad => ad?.ad_id);
      for (let adId of adIdss) {  
      let updated=  await META_DATA.update(
        { thumb_nail_status: 2 }, 
        {
          where: {
            ad_id: adId, 
          }
        }
      );
      }
      logger.info("Fetched ads successfully", ads);
      return res.send(
        Response.userSuccessResp("Fetched ads successfully", ads)
      );
    } catch (error) {
      logger.error("Error fetching ads", error);
      // console.error("Error:", error);
      return res.send(Response.userFailResp("Error fetching ads", error));
    }
  }
  async getVideoURL1(ad_url){
    try {
      if(ad_url){
        const response = await fetch(ad_url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
    
        const result = await response?.text()
        if( result && result?.includes('videoUrl')){
          let getVideoUrl=getBetween(result,'type="application/json">','</script>')
          if(getVideoUrl){
            let parsedVideo=JSON?.parse(getVideoUrl)
  
            let finalData=parsedVideo?.props?.pageProps?.data?.baseDetail?.videoInfo?.videoUrl['720P']
            logger.info("Video URL fetched successfully", finalData);
            return finalData
          }
        }
      } 
     
      function getBetween(pageSource, firstData, secondData) {
        try {
          const resSplit = pageSource.split(firstData);
          const indexSec = resSplit[1].indexOf(secondData);
          return resSplit[1].substring(0, indexSec);
        } catch (e) {
          return "";
        }
      }
    } catch (error) {
      logger.error("Error fetching video", error);
      // console.error("Error:", error);
    }
  }
  //to get video-urls
  async getVideoURL(req,res){
    try {
      if(req?.body  && Object.keys(req?.body)?.length > 0 ){
        let {ad_url}=req?.body
        const response = await fetch(ad_url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
    
        const result = await response?.text()
        if( result && result?.includes('videoUrl')){
          let getVideoUrl=getBetween(result,'type="application/json">','</script>')
          if(getVideoUrl){
            let parsedVideo=JSON?.parse(getVideoUrl)
  
            let finalData=parsedVideo?.props?.pageProps?.data?.baseDetail?.videoInfo?.videoUrl['720P']
            logger.info("Video URL fetched successfully", finalData);
            return res.status(201).send(
              Response.userSuccessResp("Video URL fetched successfully", {
                video_url: finalData,
              })
            );
          }
       
        }
      } else {
        logger.error("Request Body can'not be empty");
        return res.send(Response.userFailResp("Request Body can'not be empty"));
      }
     

      function getBetween(pageSource, firstData, secondData) {
        try {
          const resSplit = pageSource.split(firstData);
          const indexSec = resSplit[1].indexOf(secondData);
          return resSplit[1].substring(0, indexSec);
        } catch (e) {
          return "";
        }
      }
    } catch (error) {
      logger.error("Error fetching ads", error);
      // console.error("Error:", error);
      return res.send(Response.userFailResp("Error fetching video url", error));
    }
  }

  //update thumb nail 
  async updateThumbNail(req,res){
    const transaction = await db.sequelize.transaction();
    try {
      let data=req?.body
     if (!data) {
      logger.error("Missing request data in body");
      return res.send(
        Response.validationFailResp("Missing request data", "")
      );
    }

    const adExist = await searchDoc("sql_id", data.ad_id);

    if (!adExist) {
      logger.error("Ad not found - failed to update the data");
      return res.send(
        Response.validationFailResp(
          "Ad not found - failed to update the data",
          ""
        )
      );
    }
   
    let ad_id= data?.ad_id
    let video_cover = data?.video_cover;
    let updated;
    let updateTiktokAd;
 try {
   updated= await updateDocument("sql_id", data?.ad_id, {video_cover})
   
   updateTiktokAd= await META_DATA.update(
   { video_cover, ad_id: ad_id,thumb_nail_status:3},
   { where: { ad_id: ad_id }, transaction }
 )
 } catch (error) {
  return res.send(Response.userFailResp("Error inserting thumbnail url", error));
 }
  if(updated?.updated > 0 && updateTiktokAd?.[0] > 0){
    await transaction.commit();
    logger.info("Ad updated successfully", {
      id: updateTiktokAd.id,
      ad_id: ad_id,
    });
    return res.send(
      Response.userSuccessResp("Ad updated successfully", {
        id: updateTiktokAd.id,
        ad_id: ad_id,
      })
    );
  }
    } catch (error) {
      await transaction.rollback();
      logger.error("Error fetching ads", error);
      // console.error("Error:", error);
      return res.send(Response.userFailResp("Error fetching video url", error));
    }
    finally {
      if (transaction) {
          try {
            if (transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
              await transaction.rollback();
            }
          } catch (error) {
              logger.error("Error releasing transaction connection", error);
          }
      }
}
  }
  // Format age object
  formatAgeDetails(values) {
    const age_details = {
      "13-17": "",
      "18-24": "",
      "25-34": "",
      "35-44": "",
      "45-54": "",
      "55+": "",
    };
    values.forEach((value, index) => {
      const ageRange = Object.keys(age_details)[index];
      age_details[ageRange] = value;
    });
    return age_details;
  }

  // Format gender object
  formatGenderDetails(values) {
    const gender_details = { male: "", female: "", unknown: "" };
    values.forEach((value, index) => {
      const genderRange = Object.keys(gender_details)[index];
      gender_details[genderRange] = value;
    });
    return gender_details;
  }
  formatGenderDetails1(values) {
    const gender_details = { male: "", female: "", unknown: "" };
    values.forEach((value, index) => {
      const genderRange = Object.keys(gender_details)[index];
      gender_details[genderRange] = value;
    });
    return [gender_details];
  }

  // Update or create data
  async updateOrCreateEntries(Model, detailsArray, transaction) {
    for (const details of detailsArray) {
      const response = await Model.update(details, {
        where: {
          ad_id: details.ad_id,
          country_name: details.country_name,
        },
        transaction,
      });
      if (response[0] === 0) {
        await Model.create(details, { transaction });
      }
    }
  }

  // Get s3 url of video
  async getS3Url(url, format, ad_id) {
    const tempDir = "./temp";
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    const saveInTemp = await this.downloadFile(url, tempDir, format, ad_id);
    const uploadSuccess = await uploadFile(tempDir,ad_id,'tiktok','THUMBNAIL');
    this.deleteAllFilesInFolder(tempDir);
    return uploadSuccess;
  }

  // Downloadin the file to temp folder
  async downloadFile(url, destDir, format, ad_id) {
    const response = await axios({
      method: "get",
      url: url,
      responseType: "stream",
    });

    const fileName = `${ad_id}${format}`;
    const destPath = `${destDir}/${fileName}`;

    const writer = fs.createWriteStream(destPath);

    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on("finish", () => resolve(destPath));
      writer.on("error", reject);
    });
  }

  // After receiving s3 url, delete all files in temp folder
  async deleteAllFilesInFolder(tempFolderPath) {
    try {
      fs.readdir(tempFolderPath, async (err, files) => {
        if (err) {
          logger.error(`${err}`);
          return;
        }
        files.map((fileName) => {
          fs.unlinkSync(tempFolderPath + "/" + fileName);
        });
        logger.info("FileDeleted");
      });
    } catch (error) {
      logger.error(`${err}`);
    }
  }

  // Popularity and impression calculation
  popularityImpression(clicksArr, ctr, likes, comments, shares) {
    let totalClicks = Math.round(
      clicksArr?.reduce(
        (sum, element) => sum + Math.round(element.value * 100),
        0
      )
    );
    let impression = Math.round(totalClicks / ctr);

    let totalEngagements = totalClicks + likes + comments + shares;
    let popularity = Math.round(
      (totalEngagements / (totalEngagements + impression)) * 100
    );
    return [popularity, impression];
  }

  // Data that goes into Elasticsearch
  esData(originalPayload) {
    let {
      ad_id,
      type,
      first_seen,
      last_seen,
      days_running,
      post_owner,
      countries,
      gender,
      age,
      ad_title,
      platform,
      destination_url,
      likes,
      comments,
      shares,
      source,
      ctr,
      interest,
      min_target_users,
      max_target_users,
      target_keywords,
      popularity,
      impression,
      sql_id,
      post_owner_id,
      landerStatus,
      landerData,
      language,
      video_url,
      video_cover,
      ctr_graph,
      cvr_graph,
      clicks_graph,
      conversion_graph,
      remain_graph,
      library_url,
      budget,
      industry,
    } = originalPayload;
    return {
      ad_id,
      type,
      first_seen,
      last_seen,
      days_running,
      post_owner,
      countries,
      gender,
      age,
      ad_title,
      platform,
      destination_url,
      likes,
      comments,
      shares,
      source,
      ctr,
      interest,
      min_target_users,
      max_target_users,
      target_keywords,
      popularity,
      impression,
      sql_id,
      post_owner_id,
      landerStatus,
      landerData,
      language,
      video_url,
      video_cover,
      ctr_graph,
      cvr_graph,
      clicks_graph,
      conversion_graph,
      remain_graph,
      library_url,
      budget,
      industry,
    };
  }
}

export default new TikTokService();
