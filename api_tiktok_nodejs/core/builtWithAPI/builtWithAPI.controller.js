import builtWithAPIService from "./builtWithAPI.service.js";
class builtWithAPIController {
    //this function used for update the built with status
    async updateBuiltWithStatus(req, res) {
        /* #swagger.tags = ['Built-with']
                           #swagger.description = 'This routes is used for update the built with status' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'update built with status',
                                required: true,
                                schema: { $ref: "#/definitions/built_with" }
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

        return await builtWithAPIService.updateBuiltWithStatus(req, res);
    }

    //this function is used for get urls from meta-data table
    async getUrlsForBuiltWith(req, res) {
            /* #swagger.tags = ['Built-with']
                           #swagger.description = 'This routes is used for get the urls for built with' */
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

        return await builtWithAPIService.getUrlsForBuiltWith(req, res);
    }
  
}

export default new builtWithAPIController();
