import { titleCase } from "title-case";
import { searchFilterAds, getAdsCount, getCountries } from "../../utils/elasticSearch.js";
import db from "../../Sequelize_cli/models/index.js";
import Response from "../../utils/response.js";
import logger from "../../resources/logs/logger.log.js";
import { Op } from 'sequelize';
import { ECommerce, Education, Games, Health, apparelAndAccessoriesItems, appliances, apps, babyKidsMeternity, beautyAndPersonalCare, businessServices, categories, financialServices, foodAndBeverage, homeImprovement, houseHoldProducts, lifeServices, newsAndEntertainment, pets, sportsAndOutdoor, techElectronics, travel, vehicleTransportation } from "../../utils/industries.js";
import userActionAPIService from "../userAction/userActionAPI.service.js";

const countryData1 = db.tiktok_ad_country_info;

function removeDuplicates(arr) {
  return [...new Set(arr)];
}

class dashBoardService {
  async searchFilter(req, res) {
    try {
      let {
        domain,
        advertiser,
        keyword,
        likes,
        comments,
        shares,
        popularity,
        impression,
        country,
        adSeen,
        adSeenStartDate,
        adSeenEndDate,
        domainReg,
        domainRegStartDate,
        domainRegEndDate,
        postDate,
        postStartDate,
        postEndDate,
        sortBy,
        gender,
        age,
        industry,
        ctr,
        budget,
        language,
        skip = 0,
        limit = 10,
      } = req?.body;
     const verifyData= req?.user
     const actionPayload= {
    amember_id:verifyData?.user_id,
    user_name:verifyData?.user_name,
    amember_email:verifyData?.user_email,
    userSubscription:Object.keys(verifyData?.userSubscriptionType)?.[0],
    ad_count:limit,
    month_count:limit,
    date:"",
    start_date:"",
    end_date:""
  }
let resultUserAdCount = await userActionAPIService.insertUserAdsCount(actionPayload)
if(resultUserAdCount?.code==205)
  return res.send({
      code: resultUserAdCount.code,
      message: resultUserAdCount.message
  });

      let countries = await countryData1.findAll({
        where: {
          name: {
            [Op.in]: country,
          },
        },
      });
      let countryName = countries.map((data) => data.iso);
      let sortOrder;
      if (sortBy == "Newest") {
        sortOrder = "createdAt";
      } else if (sortBy == "LastSeen") {
        sortOrder = "updatedAt";
      } else if (sortBy == "domain_date") {
        sortOrder = "domain_registered_date";
      } else if (sortBy == "days_running") {
        sortOrder = "days_running";
      }
      const sortMetrics = { likes, shares, comments, impression, popularity, ctr };
      for (const key of Object.keys(sortMetrics)) {
        if (sortMetrics[key]?.min) {
          sortOrder = key;
        }
      }
        if(domain){
          let fullDomain = domain?.replace(/^(https?:\/\/)?/, '');
          fullDomain = fullDomain?.split('/')?.[0];
          domain = fullDomain?.split('.')?.slice(0, -1)?.join('.');
        }
      let searchFilterPayload = {
        domain,
        advertiser,
        keyword,
        likes,
        comments,
        shares,
        popularity,
        impression,
        countryName,
        adSeen,
        adSeenStartDate,
        adSeenEndDate,
        domainReg,
        domainRegStartDate,
        domainRegEndDate,
        postDate,
        postStartDate,
        postEndDate,
        sortOrder,
        gender,
        age,
        industry,
        ctr,
        budget,
        language,
        skip,
        limit,
      };

      let searchedData = await searchFilterAds(searchFilterPayload);
      const searchAdsData = [...new Map(searchedData?.ads?.map(ad => [ad?.sql_id, ad]))?.values()];
      if (searchedData.length === 0) {
        logger.info("No ads found");
        return res.send(Response.userSuccessResp("No ads found", ""));
      }
      const totalAds = await this.getAllAds(req?.body);
      if (!totalAds) {
        return res.send(
          Response.searchFilterResp(
            "Fetched ads successfully",
            searchAdsData,
            searchedData?.totalAds
          )
        );
      } else {
        return res.send(
          Response.searchFilterResp(
            "Fetched ads successfully",
            searchAdsData,
            searchedData?.searchFilterAds
          )
        );
      }
    } catch (error) {
      // console.log(error);
      logger.error("Error fetching ads", error);
      return res.send(Response.userFailResp("Error fetching ads", error));
    }
  }
async getAllAds(payload){
    return (
      payload.keyword !== "" ||
      payload.advertiser !== "" ||
      payload.domain !== "" ||
      payload.country.length > 0 ||
      payload.gender.length > 0 ||
      payload.age.length > 0 ||
      payload.language.length > 0 ||
      payload.budget.length > 0 ||
      payload.industry.length > 0
    );
}
  async getAdsCountDetails(req, res) {
    try {
      let { domain, keyword, advertiser } = req?.body;
      let searchPayload = { domain, keyword, advertiser };
      let count = await getAdsCount(searchPayload);
      return res.json(count);
    } catch (error) {
      return res.send(Response.userFailResp("INTERNAL_ERROR", error));
    }
  }

  async getIndustries(req, res, next) {
    try {
      const industries = await getCountries("industry");
      if (industries && Array.isArray(industries) && industries.length > 0) {
        let newIndustries = industries.map((industry) => titleCase(industry.key));

        const subcategoryMapping = {
          "Apparel & Accessories": apparelAndAccessoriesItems,
          "Appliances": appliances,
          "Apps": apps,
          "Baby, Kids & Maternity": babyKidsMeternity,
          "Beauty & Personal Care": beautyAndPersonalCare,
          "Business Services": businessServices,
          "E-Commerce (Non-app)": ECommerce,
          "Education": Education,
          "Financial Services": financialServices,
          "Food & Beverage": foodAndBeverage,
          "Games": Games,
          "Health": Health,
          "Home Improvement": homeImprovement,
          "Household Products": houseHoldProducts,
          "Life Services": lifeServices,
          "News & Entertainment": newsAndEntertainment,
          "Pets": pets,
          "Sports & Outdoor": sportsAndOutdoor,
          "Tech & Electronics": techElectronics,
          "Travel": travel,
          "Vehicle & Transportation": vehicleTransportation,
        };
        
        newIndustries.forEach((industry) => {
          for (const [label, items] of Object.entries(subcategoryMapping)) {
            if (items.includes(industry)) {
              const category = categories.find((cat) => cat.label === label);
              if (category) {
                category?.subcategories.push(industry);
              }
              break;
            }
          }
        });
        categories.forEach((category) => {
          category.subcategories = removeDuplicates(category.subcategories);
        });
        if (categories) {
          return res.send(
            Response.userSuccessResp(
              "Fetched industries successfully",
              categories
            )
          );
        }
      }
      return res.send(
        Response.userSuccessResp(
          "No industries found"
        )
      );
    } catch (error) {
      logger.error(error);
      return res.send(
        Response.userFailResp("Failed to fetch industries", error)
      );
    }
  }
}
export default new dashBoardService();
