import dashBoardService from "./dashboard.service.js";

class tikTokController {
  async searchFilter(req, res, next) {
    /* #swagger.tags = ['Dashboard']
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

    return await dashBoardService.searchFilter(req, res, next);
  }
  async getAdsCountDetails(req, res, next) {
    /* #swagger.tags = ['Dashboard']
                           #swagger.description = 'This routes is used for filtering the search field Detailes' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Search field Details',
                                required: true,
                                schema: { $ref: "#/definitions/getAdsCount" }
                        } */
    /* #swagger.responses[200] = {
            description: 'Success'
          } */
    /* #swagger.responses[400] = {
            description: 'Bad Request'
          } */

    return await dashBoardService.getAdsCountDetails(req, res, next);
  }
  async getIndustries(req, res, next) {
       /* #swagger.tags = ['Dashboard']
                           #swagger.description = 'This routes is used for get all industries details' */
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
    return await dashBoardService.getIndustries(req, res, next);
  }
}

export default new tikTokController();
