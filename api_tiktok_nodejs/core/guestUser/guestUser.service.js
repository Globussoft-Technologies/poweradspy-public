import logger from "../../resources/logs/logger.log.js";
import Response from "../../utils/response.js";
import { getAdsCountCountryList, getAdsCountGraphList, getAdsCountList, searchFilterAds } from "../../utils/elasticSearch.js";

class guestUserService {
    async guestUserSearchAds(req, res) {
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
              limit = 18,
            } = req?.body;
      
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
              if(domain){
                let startIndex = domain?.startsWith("https://") ? 8 : (domain?.startsWith("http://") ? 7 : 0);
                domain = domain?.substring(startIndex, startIndex + 11);
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
            if (searchedData.length === 0) {
              logger.info("No ads found");
              return res.send(Response.userSuccessResp("No ads found", ""));
            }
            logger.info("Fetched ads successfully", searchedData);
            return res.send(
              Response.searchFilterResp(
                "Fetched ads successfully",
                searchedData?.ads,
                searchedData?.totalAds
              )
            );
          } catch (error) {
            // console.log(error);
            logger.error("Error fetching ads", error);
            return res.send(Response.userFailResp("Error fetching ads", error));
          }
    }

    async getAdsCount(req,res){
      try {
        const payload = req?.body;
        const countsData= await getAdsCountList(payload)
        return res.send(Response.userSuccessResp("Ads count fetched successfully",countsData));
    } catch (error) {
        // console.error(error);
        logger.error("Error fetching log file", error);
        return res.send(Response.userFailResp("Error fetching log file", error));
    }
    }

    async getAdsCountGraph(req,res){
      try {
        const {network} = req?.body;
        if(network=="tiktok"){
          const countsData= await getAdsCountGraphList()
          return res.send(Response.userSuccessResp("Ads Grpah count fetched successfully",countsData));
        } else {
          return res.send(Response.userFailResp("Not a Valid Network"));
        }
    } catch (error) {
        // console.error(error);
        logger.error("Error fetching Graph Count", error);
        return res.send(Response.userFailResp("Error Graph count ", error));
    }
    }

    async getAdsCountCountries(req,res){
      try {
        const {network,range} = req?.body;
        if(network=="tiktok"){
          const countsData= await getAdsCountCountryList(range)
          return res.send(Response.userSuccessResp("Ads Grpah country count fetched successfully",countsData));
        } else {
          return res.send(Response.userFailResp("Not a Valid Network"));
        }
    } catch (error) {
        // console.error(error);
        logger.error("Error fetching Graph country Count", error);
        return res.send(Response.userFailResp("Error Graph country count ", error));
    }
    }

}

export default new guestUserService();
