import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import keywordNotificationValidation from "./keywordNotification.validation.js";
import db from "../../Sequelize_cli/models/index.js";
import nodemailer from "nodemailer";

import config from "config";
const countryData = db.tiktok_ad_country_info;
const KeywordNotification = db.keyword_notification;
const MailSubscription = db.mail_subscription;
class keywordNotificationService {
  //this function is used for add subscribed keywords
  async addKeywords(req, res) {
    try {
      const data = req.body;
      const { value, error } =
        keywordNotificationValidation.createKeywords(data);

      logger.error(error);
      if (error)
        return res.send(Response.validationFailResp("VALIDATION_FAIL", error));

      const { user_id, name, email, keyword, duration, type } = value;

      const mailSubscription = await MailSubscription.findOne({
        where: { user_id },
      });

      if (!mailSubscription) {
        const newMailSubscription = await MailSubscription.create({
          user_id,
          name,
          email,
          keywords_mail_status: 1,
        });

        if (!newMailSubscription) {
          return res.send(Response.userFailResp("Failed to add data."));
        } else {
          const newKeywordNotification = await KeywordNotification.create({
            user_id,
            name,
            keyword,
            duration,
            type,
          });
          return res.send(
            Response.userSuccessResp(
              "Data added successfully",
              newKeywordNotification
            )
          );
        }
      }
      const existingKeywordNotification = await KeywordNotification.findOne({
        where: {
          user_id,
          keyword,
          duration,
          type,
        },
      });

      if (existingKeywordNotification) {
        return res.send(
          Response.userFailResp("This keyword notification already exists")
        );
      }

      const newKeywordNotification = await KeywordNotification.create({
        user_id,
        name,
        keyword,
        duration,
        type,
      });
      return res.send(
        Response.userSuccessResp(
          "Data added successfully",
          newKeywordNotification
        )
      );
    } catch (err) {
      return res.send(Response.userFailResp("Failed to add the keyword", err));
    }
  }

  //this function is used for delete the subscribed keywords
  async deleteKeywords(req, res) {
    try {
      let { keywordid } = req.params;
      const existingKeywordNotification = await KeywordNotification.findOne({
        where: {
         id:keywordid
        },
      });
      if (!existingKeywordNotification) {
        return res.send(
          Response.userFailResp("No data found with this keyword id")
        );
      }
      let deleteData = await KeywordNotification.destroy({
        where: {
         id:keywordid
        },
      });
      if (deleteData) {
        return res.send(
          Response.userSuccessResp("keywords deleted successfully", deleteData)
        );
      }
    } catch (err) {
      logger.error(`${err}`);
      return res.send(Response.userFailResp("Failed to delete data.", err));
    }
  }

  //this function is used for get all subscribed keywords
  async getSubscribedKeywords(req, res) {
    try {
      const select = ["id", "keyword", "type"];
      const where = { status: 0 };
      const updateStatus = { status: 2 }; //this need to make it has 1

      const keywordData = await KeywordNotification.findAll({
        attributes: select,
        where: where,
      });
     if(!keywordData.length>0){
      res.send(Response.userFailResp("No more user request data"));
     }
      const result = keywordData.map((data) => {
        const item = data.get({ plain: true });
        return {
          id: item.id,
          keywords: item.type === 1 ? item.keyword : null,
          advertiser: item.type === 2 ? item.keyword : null,
          requestType: "subscribed",
        };
      });

      if (result.length > 0) {
        const ids = result.map((item) => item.id);
        await KeywordNotification.update(updateStatus, {
          where: {
            id: ids,
          },
        });
        res.send(
          Response.userSuccessResp("Keyword fetched successfully", result)
        );
      } else {
        res.send(Response.userFailResp("No more user request data"));
      }
    } catch (error) {
      return res.send(Response.userFailResp("Failed to delete data.", error));
    }
  }

  //this function is used for sending mail Daily for users based on subscribed keywords requested
  async sendKeywordMailDaily(req, res, next) {
    try {
      const select = ["id", "keyword", "type", "user_id"];
      const where = { status: 2, duration: 1 };
      const updateStatus = { status: 3 };

      const keywordData = await KeywordNotification.findAll({
        attributes: select,
        where: where,
      });
      if (!keywordData) {
        return res.send(Response.userFailResp("No more user request data"));
      }

      const result = keywordData?.map((data) => {
        const item = data.get({ plain: true });
        return {
          id: item.id,
          keywords:
            item.type === 1
              ? item.keyword
              : item.type === 2
              ? item.keyword
              : null,
          user_id: item.user_id,
        };
      });

      if (result.length > 0) {
        const ids = result.map((item) => item.id);
        const id = result.map((item) => item.user_id);
        const keywords = result.map((item) => item.keywords);

        const mailSubscription = await MailSubscription.findOne({
          where: { user_id: id },
        });

        ///sending mail
        const transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          auth: {
            user: "tom.lesch@ethereal.email",
            pass: "4n8eNx25PzrW6Y9v32",
          },
        });
        let sendMail = await transporter?.sendMail({
          from: "arunkumarb408@gmail.com",
          to: mailSubscription.email,
          subject: "We have new ads for you at PowerAdSpy!",
          html: `<p>Name: ${mailSubscription.name}</p><p>Keywords: ${keywords}</p>`,
        });
        if (sendMail.accepted.length > 0) {
          await KeywordNotification.update(updateStatus, {
            where: {
              id: ids,
            },
          });
        }
        await res.send(
          Response.userSuccessResp("Mail Sent successfully", result)
        );
      } else {
        await res.send(Response.userFailResp("No more user request data"));
      }
      next();
    } catch (error) {
      return await res.send(
        Response.userFailResp("Failed to delete data.", error.message)
      );
    }
  }

  //this function is used for sending mail Weekly for users based on subscribed keywords requested
  async sendKeywordMailWeekly(req, res) {
    try {
      const select = ["id", "keyword", "type", "user_id"];
      const where = { status: 2, duration: 2 };
      const updateStatus = { status: 3 };

      const keywordData = await KeywordNotification.findAll({
        attributes: select,
        where: where,
      });

      const result = keywordData.map((data) => {
        const item = data.get({ plain: true });
        return {
          id: item.id,
          keywords:
            item.type === 1
              ? item.keyword
              : item.type === 2
              ? item.keyword
              : null,
          user_id: item.user_id,
        };
      });

      if (result.length > 0) {
        const ids = result.map((item) => item.id);
        const id = result.map((item) => item.user_id);
        const keywords = result.map((item) => item.keywords);

        const mailSubscription = await MailSubscription.findOne({
          where: { user_id: id },
        });

        ///sending mail
        const transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          auth: {
            user: "tom.lesch@ethereal.email",
            pass: "4n8eNx25PzrW6Y9v32",
          },
        });
        let sendMail = await transporter.sendMail({
          from: "arunkumarb408@gmail.com",
          to: mailSubscription.email,
          subject: "We have new ads for you at PowerAdSpy!",
          html: `<p>Name: ${mailSubscription.name}</p><p>Keywords: ${keywords}</p>`,
        });
        if (sendMail.accepted.length > 0) {
          await KeywordNotification.update(updateStatus, {
            where: {
              id: ids,
            },
          });
        }
        res.send(Response.userSuccessResp("Mail Sent successfully", result));
      } else {
        res.send(Response.userFailResp("No more user request data"));
      }
    } catch (error) {
      return res.send(Response.userFailResp("Failed to delete data.", error));
    }
  }

  //this function is used for sending mail Monthly for users based on subscribed keywords requested
  async sendKeywordMailMonthly(req, res) {
    try {
      const select = ["id", "keyword", "type", "user_id"];
      const where = { status: 2, duration: 3 };
      const updateStatus = { status: 3 };

      const keywordData = await KeywordNotification.findAll({
        attributes: select,
        where: where,
      });

      const result = keywordData.map((data) => {
        const item = data.get({ plain: true });
        return {
          id: item.id,
          keywords:
            item.type === 1
              ? item.keyword
              : item.type === 2
              ? item.keyword
              : null,
          user_id: item.user_id,
        };
      });

      if (result.length > 0) {
        const ids = result.map((item) => item.id);
        const id = result.map((item) => item.user_id);
        const keywords = result.map((item) => item.keywords);

        const mailSubscription = await MailSubscription.findOne({
          where: { user_id: id },
        });

        ///sending mail
        const transporter = nodemailer.createTransport({
          host: "smtp.ethereal.email",
          port: 587,
          auth: {
            user: "tom.lesch@ethereal.email",
            pass: "4n8eNx25PzrW6Y9v32",
          },
        });
        let sendMail = await transporter.sendMail({
          from: "arunkumarb408@gmail.com",
          to: mailSubscription.email,
          subject: "We have new ads for you at PowerAdSpy!",
          html: `<p>Name: ${mailSubscription.name}</p><p>Keywords: ${keywords}</p>`,
        });
        if (sendMail.accepted.length > 0) {
          await KeywordNotification.update(updateStatus, {
            where: {
              id: ids,
            },
          });
        }
        res.send(Response.userSuccessResp("Mail Sent successfully", result));
      } else {
        res.send(Response.userFailResp("No more user request data"));
      }
    } catch (error) {
      return res.send(Response.userFailResp("Failed to delete data.", error));
    }
  }
  //this function is used to get the subscribed keywords based on the user
  async getKeywords(req,res){
  try {
    let { userid } = req.params;
    const select = ["id","keyword", "type", "duration"];
    const where = { user_id:userid};
    const keywordData = await KeywordNotification.findAll({
      attributes: select,
      where: where,
    });
    if(!keywordData.length>0){
      return res.send(Response.userFailResp("There is no subscribed keywords for this user"));
    }
    res.send(Response.userSuccessResp("keywords fetched successfully", keywordData));
  } catch (error) {
    return res.send(Response.userFailResp("Failed to delete data.", error));
  }
  }
}
export default new keywordNotificationService();
