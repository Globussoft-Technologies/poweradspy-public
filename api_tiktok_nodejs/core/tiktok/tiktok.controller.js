import tikTokService from "./tiktok.service.js";

// Controllers
class tikTokController {
  async create(req, res, next) {
    /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This routes is used for create the TikTok' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'TikTok Details',
                                required: true,
                                schema: { $ref: "#/definitions/Create" }
                        } */
    /*  #swagger.responses[201] = {
        description:'Ad created successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | Validation failed | Error in inserting ad'
      }
    */

    return await tikTokService.create(req, res, next);
  }

  async update(req, res, next) {
    /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This routes is used for update the details' */

    /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'TikTok Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/Update" }
    } */
    /*  #swagger.responses[200] = {
        description:'Ad updated successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | Validation failed | Ad not found | Error in data updation'
      }
    */

    return await tikTokService.update(req, res, next);
  }
  async getAnalytics(req, res, next) {
    /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This route is used to get analytics of an ad' */
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
    return await tikTokService.getAnalytics(req, res, next);
  }
  async getAdvertiserAds(req, res, next) {
    /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This route is used to get ads of an advertiser' */
    /*	#swagger.parameters['postOwner'] = {
                            in: 'path',
                            description: 'Name of the advertiser',
                            type: 'string',
                            required: true
    } */
    /*  #swagger.responses[200] = {
        description:'Found ads data | No ads found with that owner'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing owner field | Error fetching advertiser ads'
      }
    */
    return await tikTokService.getAdvertiserAds(req, res, next);
  }
  async getAds(req, res, next) {
    /* #swagger.tags = ['TikTok']
                       #swagger.description = 'This routes is used for update the details' */
    /*	#swagger.parameters['skip'] = {
                      in: 'query',
                      type:'integer',
                      description: 'Skip Values',
    } */
    /*	#swagger.parameters['limit'] = {
                        in: 'query',
                        type:'integer',
                        description: 'results limit',
    } */
    /*  #swagger.responses[200] = {
        description:'Fetched ads successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Error fetching ads'
      }
    */
    return await tikTokService.getAds(req, res, next);
  }
  async getAdURL(req, res, next) {
   /* #swagger.tags = ['TikTok']
                       #swagger.description = 'This routes is used for Ad-URL  details' */
    /*	#swagger.parameters['skip'] = {
                      in: 'query',
                      type:'integer',
                      description: 'Skip Values',
    } */
    /*	#swagger.parameters['limit'] = {
                        in: 'query',
                        type:'integer',
                        description: 'results limit',
    } */
    /*  #swagger.responses[200] = {
        description:'Fetched ads successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Error fetching ads'
      }
    */
    return await tikTokService.getAdURL(req, res, next);
  }
  async deleteAd(req, res, next) {
    /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This routes is used for update the details' */

    /*  #swagger.parameters['id'] = {
                     in: 'path',
                     description: 'ad_id.',
                     required: true,
                     type: 'string',
    } */
    /*  #swagger.responses[200] = {
        description:'Ad deleted successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing id field | Failed to delete ad'
      }
    */
    return await tikTokService.deleteAd(req, res, next);
  }

  async deleteSQLAd(req, res, next) {
    /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This routes is used for delete mysql & es ad details' */
    /*  #swagger.responses[200] = {
        description:'Ad deleted successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing id field | Failed to delete ad'
      }
    */
    return await tikTokService.deleteSQLAd(req, res, next);
  }

  async getVideoURL(req, res, next) {
    /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This routes is used for create the TikTok' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'TikTok Details',
                                required: true,
                                schema: { $ref: "#/definitions/getVideoUrl" }
                        } */
    /*  #swagger.responses[201] = {
        description:'Ad created successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | Validation failed | Error in inserting ad'
      }
    */
    return await tikTokService.getVideoURL(req, res, next);
  }
  async updateThumbNail(req, res, next) {
       /* #swagger.tags = ['TikTok']
                           #swagger.description = 'This routes is used for update the video_cover URL details' */

    /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'TikTok Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/UpdateVideoCover" }
    } */
    /*  #swagger.responses[200] = {
        description:'Ad updated successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | Validation failed | Ad not found | Error in data updation'
      }
    */

    return await tikTokService.updateThumbNail(req, res, next);
  }
}

export default new tikTokController();
