import Response from "../../utils/response.js";
import { Op } from "sequelize";
import config from "config";
import logger from "../../resources/logs/logger.log.js";
import nodemailer from "nodemailer";
import db from "../../Sequelize_cli/models/index.js";
import userRequestValidation from "./userRequest.validation.js";
const userRequestModel = db.user_requests;
const countryData = db.tiktok_ad_country_info;
const KeywordNotification = db.keyword_notification;
const MailSubscription = db.mail_subscription;
const keywordIndex = db.tiktok_keywords;
class userRequestService {
  //this function is used for add the userRequest keywords
  async createUserRequest(req, res) {
    try {
      const userRequestData = req?.body;
      const { value, error } =
        userRequestValidation.createUserRequest(userRequestData);

      logger.error(error);
      if (error)
        return res.send(Response.validationFailResp("VALIDATION_FAIL", error));

      const mailSubscription = await MailSubscription.findOne({
        where: { user_id: value.user_id },
      });
const keywordsArray = [userRequestData?.keywords, userRequestData?.advertiser, userRequestData?.url]
  ?.filter(Boolean)
  ?.map(value => ({ keyword: value }));

const insertedData = await  keywordIndex.bulkCreate(keywordsArray)
if(insertedData) logger.info("Keyword data inserted successfully");
      if (!mailSubscription) {
        const newMailSubscription = await MailSubscription.create({
          user_id: value.user_id,
          name: value.name,
          email: value.email,
          keywords_mail_status: 1,
        });

        if (!newMailSubscription) {
          return res.send(Response.userFailResp("Failed to add data."));
        } else {
          const newuserRequestModel = await userRequestModel.create(value);
          return res.send(
            Response.userSuccessResp(
              "Data added successfully",
              newuserRequestModel
            )
          );
        }
      }

      const userExist = await userRequestModel.findOne({
        where: { user_id: value.user_id },
      });

      if (!userExist) {
        const createUserRequest = await userRequestModel.create(value);
        return res.send(
          Response.userSuccessResp(
            "User request data inserted successfully",
            createUserRequest
          )
        );
      } else {
        const storeDetails = [
          value.url,
          value.advertiser,
          value.keywords,
        ].filter(Boolean);
        if (storeDetails.length < 1) {
          return res.send(
            Response.userFailResp("Cannot add user request data.")
          );
        }

        const existingRequest = await userRequestModel.findOne({
          where: {
            user_id: value.user_id,
            keywords: value.keywords || null,
            advertiser: value.advertiser || null,
            url: value.url || null,
          },
        });

        if (!existingRequest) {
          const createUserRequest = await userRequestModel.create(value);
          return res.send(
            Response.userSuccessResp(
              "User request data inserted successfully",
              createUserRequest
            )
          );
        } else {
          return res.send(Response.userFailResp("User data already exists"));
        }
      }
    } catch (err) {
      logger.error(`${err}`);
      // console.log(err);
      return res.send(
        Response.userFailResp("Failed to add user request data.", err)
      );
    }
  }

  //this function is used for delete the user requested keywords based on its id
  async deleteUserRequestData(req, res) {
    try {
      const { userrequestid } = req?.params;
      const existingUserRequest = await userRequestModel.findOne({
        where: { id: userrequestid },
      });
      if (!existingUserRequest) {
        return res.send(Response.userFailResp("Invalid user request ID"));
      }
      let deleteData = await userRequestModel.destroy({
        where: { id: userrequestid },
      });
      if (deleteData) {
        return res.send(
          Response.userSuccessResp(
            "user request data deleted successfully",
            deleteData
          )
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(
        Response.userFailResp(
          "Failed to delete user request data with this Id.",
          err
        )
      );
    }
  }

  //this function is used for get the user-request keywords
  async getUserRequestKeywords(req, res) {
    let subscribedKeywords;
    try {
      const select = ["id", "keyword", "type"];
      const where = { status: 0 };
      const updateStatus = { status: 2 }; //need to make status 1

      const keywordData = await KeywordNotification.findAll({
        attributes: select,
        where: where,
      });

      subscribedKeywords = keywordData.map((data) => {
        const item = data.get({ plain: true });
        return {
          id: item.id,
          keywords: item.type === 1 ? item.keyword : null,
          advertiser: item.type === 2 ? item.keyword : null,
          country: null,
          url: null,
          requestType: "subscribed",
        };
      });

      if (subscribedKeywords.length > 0) {
        const ids = subscribedKeywords.map((item) => item.id);
        await KeywordNotification.update(updateStatus, {
          where: {
            id: ids,
          },
        });
      }
    } catch (error) {}

    try {
      const country = req.query.country;
      const limit = parseInt(req.query.limit) || 2;
     let countryName;
      if(country){
        countryName = await countryData.findOne({
          where: { iso: country },
          attributes: ["name"],
        });
      }
      if (!country || countryName) {
        let userRequestData = await userRequestModel.findAll({
          where: {
            [Op.or]: [
              { keyword_status: 0 },
              { advertiser_status: 0 },
              { url_status: 0 },
            ],
            country: {
              [Op.like]: `%${countryName?.name}%`,
            },
          },
          attributes: ["id", "keywords", "advertiser", "url", "country", "keyword_status", "advertiser_status", "url_status"],
          order: [["id", "DESC"]],
          limit: limit,
        });
        const userRequestedData = userRequestData?.map(({ id, keywords, advertiser, url, country, keyword_status, advertiser_status, url_status }) => {
          const requestData = { id, country, advertiser: null, keywords: null, url: null };

          if (keyword_status === 0) {
            requestData.keywords = keywords;
          }

          if (advertiser_status === 0) {
            requestData.advertiser = advertiser;
          }

          if (url_status === 0) {
            requestData.url = url;
          }
          return requestData;
        });
        if (userRequestData?.length>0) {
          const userIds = userRequestData.map((user) => user.id);
          await userRequestModel.update(
            { keyword_status: 1,
              advertiser_status: 1,
              url_status: 1,
              sent_status: 1 },
            {
              where: {
                id: userIds,
              },
            }
          );
          res.send(
            Response.userSuccessResp("Data Fetched Successfully", [
              ...subscribedKeywords,
              ...userRequestedData,
            ])
          );
        } else {
          userRequestData = await userRequestModel.findAll({
            where: {
              [Op.or]: [
                { keyword_status: 0 },
                { advertiser_status: 0 },
                { url_status: 0 },
              ],
            },
            attributes: ["id", "keywords", "advertiser", "url", "country","keyword_status", "advertiser_status", "url_status"],
            order: [["id", "DESC"]],
            limit: limit,
          });

          const userRequestedData = userRequestData?.map(({ id, keywords, advertiser, url, country, keyword_status, advertiser_status, url_status }) => {
            const requestData = { id, country, advertiser: null, keywords: null, url: null };

            if (keyword_status === 0) {
              requestData.keywords = keywords;
            }

            if (advertiser_status === 0) {
              requestData.advertiser = advertiser;
            }

            if (url_status === 0) {
              requestData.url = url;
            }
            return requestData;
          });
          if (userRequestData?.length) {
            const userIds = userRequestData.map((user) => user.id);
            await userRequestModel.update(
              { keyword_status: 1,
                advertiser_status: 1,
                url_status: 1,
                sent_status: 1 },
              {
                where: {
                  id: userIds,
                },
              }
            );
            res.send(
              Response.userSuccessResp("Data Fetched Successfully", [
                ...subscribedKeywords,
                ...userRequestedData,
              ])
            );
          } else if (subscribedKeywords?.length) {
            res.send(
              Response.userSuccessResp("Data Fetched Successfully", [
                ...subscribedKeywords,
                ...userRequestedData,
              ])
            );
          } else {
            res.send(Response.userFailResp("No Data Found"));
          }
        }
      } else {
        res.send(Response.userFailResp("Invalid Country Code"));
      }
    } catch (error) {
      res.send(Response.userFailResp("Failed to fetch Data", error.message));
    }
  }

  //this function is used to send the mail to user who have requested keywords
  async sendRequestedKeywordMail(req, res) {
    try {
      const select = ["id", "keywords", "advertiser", "url", "user_id"];
      const where = { sent_status: 2 };

      const keywordData = await userRequestModel.findAll({
        attributes: select,
        where: where,
      });

      const result = keywordData.map((data) => {
        const item = data.get({ plain: true });
        return {
          id: item.id,
          keywords: item.keywords || null,
          advertiser: item.advertiser || null,
          url: item.url || null,
          user_id: item.user_id,
        };
      });

      if (result.length > 0) {
        return res.send(Response.userSuccessResp("Fetched requested keyword data", result));
      } else {
        res.send(Response.userFailResp("No more user request data"));
      }
    } catch (error) {
      return res.send(
        Response.userFailResp("Failed to fetch requested keyword data.", error.message)
      );
    }
  }

  async getUserReqKeywords(req,res){
    try {
      let { userid } = req.params;
      const select = ["keywords", "advertiser", "url", "keyword_status","advertiser_status", "url_status","country","createdAt"];
      const where = { user_id:userid};
      const keywordData = await userRequestModel.findAll({
        attributes: select,
        where: where,
      });
      if(!keywordData?.length>0){
        return res.send(Response.userFailResp("There is no user requested keywords for this user"));
      }
      res.send(Response.userSuccessResp("keywords fetched successfully", keywordData));
    } catch (error) {
      res.send(Response.userFailResp("Failed to fetch Data", error));
    }
  }

  async updateUserRequestStatus() {
    try {
      const recordsToUpdate = await userRequestModel.findAll({
        where: {
          [Op.or]: [
            { keyword_status: 1 },
            { advertiser_status: 1 },
            { url_status: 1 },
            { sent_status: 4 }
          ]
        },
        attributes: ["id", "keyword_status", "advertiser_status", "url_status" ,"sent_status"],
      });

      for (const record of recordsToUpdate) {
        const updates = {};

        if (record.keyword_status === 1) {
          updates.keyword_status = 0;
        }

        if (record.advertiser_status === 1) {
          updates.advertiser_status = 0;
        }

        if (record.url_status === 1) {
          updates.url_status = 0;
        }
        if(record.sent_status === 4){
          updates.sent_status = 0;
        }
        if (Object.keys(updates)?.length > 0) {
          return await userRequestModel.update(updates, {
            where: { id: record.id }
          });
        }
      }
    } catch (error) { }
  }

  async updateUserRequestSentStatus(req, res) {
    try {
      const { requestid, sent_status } = req?.body;
      const existingUserRequest = await userRequestModel.findOne({
        where: { id: requestid },
      });
      if (existingUserRequest) {
        const updateData = await userRequestModel.update({ sent_status: sent_status }, {
          where: { id: requestid }
        });
      return  res.send(Response.userSuccessResp("status updated successfully", updateData));
      }
    } catch (error) { 
      return res.send(Response.userFailResp("Failed to update the status", error));
    }
  }
  
}
export default new userRequestService();
