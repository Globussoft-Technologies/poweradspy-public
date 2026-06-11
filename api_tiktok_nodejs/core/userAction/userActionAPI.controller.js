import userActionAPIService from "./userActionAPI.service.js";
class userActionAPIController {
    //this function used for update the user actions
    async insertAdsCountDetails(req, res) {
      /* #swagger.tags = ['User Action']
                           #swagger.description = 'This routes is used for create the user action Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Country Details',
                                required: true,
                                schema: { $ref: "#/definitions/CreateUserAction" }
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

        return await userActionAPIService.insertAdsCountDetails(req, res);
    }
    async updateAdsCount(req, res, next) {
      /* #swagger.tags = ['User Action']
     #swagger.description = 'This route is used to update the daily ad count' */

      /* #swagger.parameters['email'] = {
            in: 'path',
            description: 'Email',
            type: 'string',
            required: true
      } */

      /* #swagger.parameters['x-secret-key'] = {
            in: 'header',
            description: 'Secret key for authorization',
            required: true,
            type: 'string'
      } */

      /* #swagger.responses[200] = {
            description:'Found ads data | No ads found with that owner'
      } */

      /* #swagger.responses[400] = {
            description:'Missing owner field | Error fetching advertiser ads'
      } */

      return await userActionAPIService.updateAdsCount(req, res, next);
    }
}

export default new userActionAPIController();
