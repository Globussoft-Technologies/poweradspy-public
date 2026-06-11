
import tiktokService from "../tiktok/tiktok.service.js";
import guestUserService from "./guestUser.service.js";


// Controllers
class guestUserController {
 
  async getAdDetails(req, res, next) {
    /* #swagger.tags = ['Guest User']
                           #swagger.description = 'This route is used to get details of an ad' */
    /*	#swagger.parameters['id'] = {
                            in: 'path',
                            description: 'Id of the ad',
                            type: 'string',
                            required: true
    } */
    /*  #swagger.responses[200] = {
        description:'Found analytics data'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing id field | No data found with that id | Error fetching data'
      }
    */
    return await tiktokService.getAnalytics(req, res, next);
  }

  async guestUserSearchAds(req, res, next) {
    /* #swagger.tags = ['Guest User']
                           #swagger.description = 'This routes is used for filtering the search field Detailes' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Search field Details',
                                required: true,
                                schema: { $ref: "#/definitions/Search_Filter" }
                        } */
    /* #swagger.responses[200] = {
            description: 'Success'
          } */
    /* #swagger.responses[400] = {
            description: 'Bad Request'
          } */

    return await guestUserService.guestUserSearchAds(req, res, next);
  }

  async getVideoURL(req, res, next) {
    /* #swagger.tags = ['Guest User']
                           #swagger.description = 'This routes is used for get video url' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'TikTok Details',
                                required: true,
                                schema: { $ref: "#/definitions/getVideoUrl" }
                        } */
    /*  #swagger.responses[201] = {
        description:'Get video url successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | Validation failed | Error in inserting ad'
      }
    */
    return await tiktokService.getVideoURL(req, res, next);
  }
  async getAdsCount(req, res, next) {
    /* #swagger.tags = ['Guest User']
                           #swagger.description = 'This routes is used for get the ad-count Detailes' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Ad count Details',
                                required: true,
                                schema: { $ref: "#/definitions/Search_Filter" }
                        } */
    /* #swagger.responses[200] = {
            description: 'Success'
          } */
    /* #swagger.responses[400] = {
            description: 'Bad Request'
          } */

    return await guestUserService.getAdsCount(req, res, next);
  }
  async getAdsCountGraph(req, res, next) {
    /* #swagger.tags = ['Guest User']
                           #swagger.description = 'This routes is used for get the ad-count Detailes' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Ad count Details',
                                required: true,
                                schema: { $ref: "#/definitions/Search_Filter" }
                        } */
    /* #swagger.responses[200] = {
            description: 'Success'
          } */
    /* #swagger.responses[400] = {
            description: 'Bad Request'
          } */

    return await guestUserService.getAdsCountGraph(req, res, next);
  }
  async getAdsCountCountries(req, res, next) {
    /* #swagger.tags = ['Guest User']
                           #swagger.description = 'This routes is used for get the ad-count Detailes' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Ad count Details',
                                required: true,
                                schema: { $ref: "#/definitions/Search_Filter" }
                        } */
    /* #swagger.responses[200] = {
            description: 'Success'
          } */
    /* #swagger.responses[400] = {
            description: 'Bad Request'
          } */

    return await guestUserService.getAdsCountCountries(req, res, next);
  }
}

export default new guestUserController();
