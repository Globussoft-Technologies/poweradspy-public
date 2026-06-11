import KeywordsService from "./keywordsAPI.service.js";


// Controllers
class KeywordsController {
 
  async addKeywords(req, res, next) {
     /* #swagger.tags = ['Keywords']
                           #swagger.description = 'This routes is used for create the Keywords Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Keywords Details',
                                required: true,
                                schema: { $ref: "#/definitions/AddKeywords" }
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
    return await KeywordsService.addKeywords(req, res, next);
  }

  async getKeywords(req, res, next) {
    /* #swagger.tags = ['Keywords']
                           #swagger.description = 'This routes is used for get Keywords details' */
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

    return await KeywordsService.getKeywords(req, res, next);
  }

  async getLogFiles(req, res, next) {
    /* #swagger.tags = ['Keywords']
       #swagger.description = 'This route is used to get log file data details' */
       
    /* #swagger.parameters['day'] = {
            in: 'query',
            description: 'Day of the log file',
            required: true,
            type: 'integer',
            example: 24
    } */
    /* #swagger.parameters['month'] = {
            in: 'query',
            description: 'Month of the log file',
            required: true,
            type: 'integer',
            example: 12
    } */
    /* #swagger.parameters['year'] = {
            in: 'query',
            description: 'Year of the log file',
            required: true,
            type: 'integer',
            example: 2024
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

    return await KeywordsService.getLogFiles(req, res, next);
}

}

export default new KeywordsController();
