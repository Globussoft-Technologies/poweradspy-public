import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import db from "../../Sequelize_cli/models/index.js";
import config from "config";
const USER_ACTION = db.amember_user_actions;
const FREE_PLAN_USER = config.get("free_plan_user")
const FREE_USER_ADS_COUNT_DAY = parseInt(config.get("free_user_ads_count_day"));
const PAID_USER_ADS_COUNT_DAY = parseInt(config.get("paid_user_ads_count_day"));
const PAID_USER_ADS_COUNT_MONTH = parseInt(config.get("paid_user_ads_count_month"));
const RESET_USER_ADS_COUNT= config.get("reset_ads_count_secret_key");


class userActionAPIService {
//function to update the user actions
  async insertUserAdsCount(postData) {
    const result = {};
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    try {
      if (postData.userSubscription == FREE_PLAN_USER) {
        const existingFreePlan = await USER_ACTION.findOne({
          where: {
            amember_id: postData.amember_id,
            amember_subscription: FREE_PLAN_USER
          }
        });

        if (existingFreePlan) {
          if (new Date(existingFreePlan.end_date) >= new Date(today)) {
            if (existingFreePlan.date === today) {
              if (existingFreePlan.ad_count < FREE_USER_ADS_COUNT_DAY) {
                const updateData = {
                  ad_count: parseInt(postData?.ad_count) + existingFreePlan.ad_count,
                  month_count: parseInt(postData.ad_count) + existingFreePlan.month_count
                };

                await USER_ACTION.update(updateData, {
                  where: { amember_id: postData.amember_id }
                });

                result.code = 201;
                result.message = "Updated record";
                result.data = updateData;
              } else {
                result.code = 205;
                result.message = "You reached all ads for today";
                result.data = existingFreePlan;
              }
            } else {
              const updateData = {
                ad_count: postData.ad_count,
                date: today
              };

              await USER_ACTION.update(updateData, {
                where: { amember_id: postData.amember_id }
              });

              result.code = 201;
              result.message = "Updated record";
              result.data = updateData;
            }
          } else {
            result.code = 205;
            result.message = "Free plan expired";
          }
        } else {
          // Insert Free Plan Record
          await USER_ACTION.create({
            amember_id: postData.amember_id,
            user_name: postData.user_name,
            amember_email: postData.amember_email,
            ad_count: postData.ad_count,
            month_count: postData.ad_count,
            date: today,
            start_date: today,
            end_date: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().slice(0, 10),
            amember_subscription: postData.userSubscription
          });

          result.code = 201;
          result.message = "Record created";
        }

        return result;
      }

      // Handle Paid Plan Users
      const userMonthData = await USER_ACTION.findOne({
        where: {
          amember_id: postData.amember_id
        }
      });

      if (userMonthData) {
        if (new Date(today) > new Date(userMonthData.end_date)) {
          // Monthly cycle expired — reset everything
          const newEndDate = new Date(new Date(today).setMonth(new Date(today).getMonth() + 1)).toISOString().slice(0, 10);

          const resetData = {
            ad_count: postData?.ad_count,
            month_count: postData?.ad_count,
            date: today,
            start_date: today,
            end_date: newEndDate
          };

          await USER_ACTION.update(resetData, {
            where: { amember_id: postData.amember_id }
          });

          result.code = 201;
          result.message = "New monthly cycle started (Paid Plan)";
          result.data = resetData;
          return result;
        }

        if (userMonthData.month_count >= PAID_USER_ADS_COUNT_MONTH) {
          result.code = 205;
          result.message = "Ads count limit reached";
          result.data = userMonthData;
          return result;
        }

        const userDayData = await USER_ACTION.findOne({
          where: {
            amember_id: postData.amember_id,
            date: today
          }
        });
        let updateData;
        if (userDayData) {
          if (userDayData.ad_count <= PAID_USER_ADS_COUNT_DAY) {
            updateData = {
              ad_count: parseInt(postData?.ad_count) + userMonthData.ad_count,
              month_count: parseInt(postData.ad_count) + userMonthData.month_count
            };
          } else {
            result.code = 205;
            result.message = "Todays Ads count limit reached";
            result.data = userDayData;
            return result;
          }
        } else {
          updateData = {
            ad_count: postData.ad_count,
            month_count: parseInt(postData.ad_count) + userMonthData.month_count,
            date: today
          };
        }

        const [updatedRows] = await USER_ACTION.update(updateData, {
          where: { amember_id: postData.amember_id },
        });
        if (updatedRows > 0) {
          result.code = 201;
          result.message = "Updated record";
          result.data = updateData;
        } else {
          result.code = 500;
          result.message = "Failed to update data";
        }

      } else {
        // Insert new record
        const insertResult = await USER_ACTION.create({
          amember_id: postData.amember_id,
          amember_email: postData.amember_email,
          user_name: postData.user_name,
          ad_count: postData.ad_count,
          month_count: postData.ad_count,
          date: today,
          start_date: today,
          end_date: new Date(new Date().setMonth(new Date().getMonth() + 1)).toISOString().slice(0, 10),
          amember_subscription: postData.userSubscription
        });

        if (insertResult && insertResult.id) {
          result.code = 200;
          result.message = "New record created after a month";
        } else {
          result.code = 500;
          result.message = "Failed to insert new record";
        }
      }

      return result;
    } catch (err) {
      console.error("Error in getUserAdAction:", err);
      result.code = 500;
      result.message = "Error in getUserAdAction API";
      result.err = err;
      return result;
    }
  };


  async insertAdsCountDetails(req, res) {
    try {
      const postData = req?.body;
      const result = await this.insertUserAdsCount(postData)
      return res.json(result)
    } catch (error) {
      // console.log(error);
      logger.error(error);
      return res.send(
        Response.userFailResp("Failed to update user actions", error)
      );
    }
  }
  async updateAdsCount(req, res) {
    try {
      const email = req?.params?.email;
      const clientKey = req.headers['x-secret-key']; 
      if (!clientKey || clientKey !== RESET_USER_ADS_COUNT) {
        return res
          .status(403)
          .send(Response.validationFailResp('Invalid or missing secret key'));
      }
      if (!email) {
        return res.send(
          Response.validationFailResp("Missing email field", email)
        );
      }
      const user = await USER_ACTION.findOne({ where: { amember_email: email } });

      if (!user) {
        return res.send(Response.validationFailResp("No user found with this email", email));
      }
      await user.update({
        ad_count: 0,
        month_count: 0,
      });

      return res.send(Response.userSuccessResp("Ad count reset to 0"));
    } catch (error) {
      logger.error("Error fetching user email", error);
      console.error("Error fetching user email", error);
      return res.send(
        Response.userFailResp("Error fetching user email", error)
      );
    }
  }
}
export default new userActionAPIService();
