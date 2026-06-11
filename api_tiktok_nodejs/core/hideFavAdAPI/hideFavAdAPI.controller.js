import hideFavAdsAPIService from "./hideFavAdAPI.service.js";

//hideFavAds controller
class hideFavAddAPIController {
   //this function is used for the hide&fav ads
    async hideFavAd(req, res, next) {
      /* #swagger.tags = ['Hide-Fav-Ads-API']
         #swagger.description = 'This routes is used for hide ad from particular user' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Hide Fav Ads Details',
                                required: true,
                                schema: { $ref: "#/definitions/Hide_favourite_Ads_API" }
                        } */
            /* #swagger.responses[200] = {
            description: 'Success'
          } */
           /* #swagger.responses[400] = {
            description: 'Bad Request'
          } */
          /* #swagger.responses[404] = {
            description: 'Not Found'
          } */
          /* #swagger.responses[500] = {
            description: 'Internal Server Error'
          } */

        return await hideFavAdsAPIService.hideFavAd(req, res, next);
    }

    //this function is used for un-hide-Fav ads
    async unHideFavAd(req, res, next) {
        /* #swagger.tags = ['Hide-Fav-Ads-API']
           #swagger.description = 'This routes is used for un-hide post from particular user' */
          /*	#swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'Un-Hide Fav Ads Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/Hide_favourite_Ads_API" }
                          } */
              /* #swagger.responses[200] = {
              description: 'Success'
            } */
             /* #swagger.responses[400] = {
              description: 'Bad Request'
            } */
            /* #swagger.responses[404] = {
              description: 'Not Found'
            } */
            /* #swagger.responses[500] = {
              description: 'Internal Server Error'
            } */
  
          return await hideFavAdsAPIService.unHideFavAd(req, res, next);
      }

      async getHideAds(req, res, next) {
        /* #swagger.tags = ['Hide-Fav-Ads-API']
           #swagger.description = 'This routes is used for un-hide post from particular user' */
          /*	#swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'Un-Hide Fav Ads Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/Hide_Fav_GET_API" }
                          } */
              /* #swagger.responses[200] = {
              description: 'Success'
            } */
             /* #swagger.responses[400] = {
              description: 'Bad Request'
            } */
            /* #swagger.responses[404] = {
              description: 'Not Found'
            } */
            /* #swagger.responses[500] = {
              description: 'Internal Server Error'
            } */
  
          return await hideFavAdsAPIService.getHideAds(req, res, next);
      }
    
      async getHideFavAds(req, res, next) {
        /* #swagger.tags = ['Hide-Fav-Ads-API']
           #swagger.description = 'This routes is used for un-hide post from particular user' */
          /*	#swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'Get Hide Fav Ads Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/Hide_Fav_GET_API" }
                          } */
              /* #swagger.responses[200] = {
              description: 'Success'
            } */
             /* #swagger.responses[400] = {
              description: 'Bad Request'
            } */
            /* #swagger.responses[404] = {
              description: 'Not Found'
            } */
            /* #swagger.responses[500] = {
              description: 'Internal Server Error'
            } */
  
          return await hideFavAdsAPIService.getHideFavAds(req, res, next);
      }
  
}

export default new hideFavAddAPIController();
