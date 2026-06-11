import CompetitorService from "./competitorService.js";

class CompetitorController {
  async create(req, res) {
    /* #swagger.tags = ['Competitor']
                           #swagger.description = 'This routes is used for register the user' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'User details',
                                required: true,
                                schema: { $ref: "#/definitions/Create" }
                        } */
    /*  #swagger.responses[200] = {
        description:'User created successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | Validation failed | Database error during user check | Error in registering the user | Error in creating the user | This user already exists'
      }
    */

    return await CompetitorService.create(req, res);
  }
  async insertCompRequests(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for inserting the competitors request'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Competitors request',
        required: true,
        schema: { $ref: "#/definitions/CompetitorsRequest" }
    }
    #swagger.responses[200] = {
        description: 'Competitor Request created successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed | Error in creating the competitor request | Error while storing the competitors in db | Error in storing the competitor | Competitor details can\'t be empty | Error in inserting competitors request'
    }
*/

    return await CompetitorService.insertCompRequests(req, res);
  }
  async fetchCompetitors(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for fetching the competitors of brands'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Fetching competitor list',
        required: true,
        schema: { $ref: "#/definitions/FetchCompetitors" }
    }
    #swagger.responses[200] = {
        description: 'Fetched Competitors successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for advertiser | Error in fetching competitors | Error in getting competitor list'
    }
*/
    return await CompetitorService.fetchCompetitors(req, res);
  }

  async fetchCompetitorsClient(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for fetching the competitors of brands'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Fetching competitor list',
        required: true,
        schema: { $ref: "#/definitions/FetchCompetitors" }
    }
    #swagger.responses[200] = {
        description: 'Fetched Competitors successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for advertiser | Error in fetching competitors | Error in getting competitor list'
    }
*/
    return await CompetitorService.fetchCompetitorsClient(req, res);
  }
  async fetchCompetitorsForUpdate(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for fetching the competitors of brands for updation'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Fetching competitor list',
        required: true,
        schema: { $ref: "#/definitions/FetchCompetitors" }
    }
    #swagger.responses[200] = {
        description: 'Fetched Competitors successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for advertiser | Error in fetching competitors | Error in getting competitor list'
    }
*/
    return await CompetitorService.fetchCompetitorsForUpdate(req, res);
  }

 async fetchCompetitorsForUpdateClient(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for fetching the competitors of brands for updation'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Fetching competitor list',
        required: true,
        schema: { $ref: "#/definitions/FetchCompetitors" }
    }
    #swagger.responses[200] = {
        description: 'Fetched Competitors successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for advertiser | Error in fetching competitors | Error in getting competitor list'
    }
*/
    return await CompetitorService.fetchCompetitorsForUpdateClient(req, res);
  }

    async fetchCompetitorsForUpdateNew(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for fetching the competitors of brands for updation'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Fetching competitor list',
        required: true,
        schema: { $ref: "#/definitions/FetchCompetitors" }
    }
    #swagger.responses[200] = {
        description: 'Fetched Competitors successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for advertiser | Error in fetching competitors | Error in getting competitor list'
    }
*/
    return await CompetitorService.fetchCompetitorsForUpdateNew(req, res);
  }
  async checkUser(req, res) {
    /*
       #swagger.tags = ['Competitor']
       #swagger.description = 'This route is used for fetching the details of a user'
       #swagger.parameters['email'] = {
         in: 'query',
         description: 'Email address of the user',
         required: true,
         type: 'string',
         example: 'ankit@gmail.com'
       }
       #swagger.responses[201] = {
         description: 'This user exists already'
       }
       #swagger.responses[400] = {
         description: 'Missing request data | Please provide a proper email | Error in fetching user details'
       }
       #swagger.responses[401] = {
         description: 'This user does not exist'
       }
     */

    return await CompetitorService.checkUser(req, res);
  }
  async checkBrand(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for fetching the brand details of an user'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'brand details of an user',
        required: true,
        schema: { $ref: "#/definitions/CheckBrand" }
    }
    #swagger.responses[200] = {
        description: 'Fetched brand details successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Please provide proper brand name | Error in finding the brand | Error in fetching brand details'
    }
    #swagger.responses[401] = {
        description: 'This brand does not exist'
    }
*/

    return await CompetitorService.checkBrand(req, res);
  }
  async updateMonitoring(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for updating the monitoring status of a competitor'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Updating the monitoring status of a competitor',
        required: true,
        schema: { $ref: "#/definitions/UpdateMonitoring" }
    }
    #swagger.responses[200] = {
        description: 'Updated monitoring status'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for competitor_id and status | Error in updating monitoring status | Updation failed for monitoring status | Invalid status'
    }
*/
    return await CompetitorService.updateMonitoring(req, res);
  }

  async updateCompetitors(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for updating the competitors'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Updating the competitors',
        required: true,
        schema: { $ref: "#/definitions/updateCompetitors" }
    }
    #swagger.responses[200] = {
        description: 'Updated monitoring status'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Error in updating Competitors | Updation failed for Competitors'
    }
*/
    return await CompetitorService.updateCompetitors(req, res);
  }

    async updateCompetitorsNew(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for updating the competitors'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Updating the competitors',
        required: true,
        schema: { $ref: "#/definitions/updateCompetitors" }
    }
    #swagger.responses[200] = {
        description: 'Updated monitoring status'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Error in updating Competitors | Updation failed for Competitors'
    }
*/
    return await CompetitorService.updateCompetitorsNew(req, res);
  }
  async updateAdvertiser(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for updating the advertiser'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Updating the advertiser',
        required: true,
        schema: { $ref: "#/definitions/updateAdvertiser" }
    }
    #swagger.responses[200] = {
        description: 'Updated monitoring status'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Error in updating advertiser | Updation failed for advertiser'
    }
*/
    return await CompetitorService.updateAdvertiser(req, res);
  }

  async getAllDetails(req, res) {
    /*
       #swagger.tags = ['Competitor']
       #swagger.description = 'This route is used for fetching the all the details for admin panel'
       #swagger.responses[200] = {
         description: 'Fetched all the details successfully'
       }
       #swagger.responses[400] = {
         description: 'No data found | Error in getting all details for admin panel'
       }
     */
    return await CompetitorService.getAllDetails(req, res);
  }
  async filterDetails(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for filtering the data for admin panel'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'filtering the data for admin panel',
        required: true,
        schema: { $ref: "#/definitions/filterDetails" }
    }
    #swagger.responses[200] = {
        description: 'Fetched all the details successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Invalid user_id | No data found | Updation failed for monitoring status | Error in filtering details for admin panel'
    }
*/
    return await CompetitorService.filterDetails(req, res);
  }

    async getActiveUsers(req, res) {
    /*
       #swagger.tags = ['Competitor']
       #swagger.description = 'This route is used for fetching the all the active users details for admin panel'
       #swagger.responses[200] = {
         description: 'Fetched all the details successfully'
       }
       #swagger.responses[400] = {
         description: 'No data found | Error in getting all details for admin panel'
       }
     */
    return await CompetitorService.getActiveUsers(req, res);
  }

    async getInactiveUsers(req, res) {
    /*
       #swagger.tags = ['Competitor']
       #swagger.description = 'This route is used for fetching the all the active users details for admin panel'
       #swagger.responses[200] = {
         description: 'Fetched all the details successfully'
       }
       #swagger.responses[400] = {
         description: 'No data found | Error in getting all details for admin panel'
       }
     */
    return await CompetitorService.getInactiveUsers(req, res);
  }

   async getCompUsersCount(req, res) {
    /*
       #swagger.tags = ['Competitor']
       #swagger.description = 'This route is used to get user stats'
       #swagger.responses[200] = {
         description: 'Fetched all the details successfully'
       }
       #swagger.responses[400] = {
         description: 'No data found | Error in getting all details for admin panel'
       }
     */
    return await CompetitorService.getCompUsersCount(req, res);
  }

  async getStoreProcessCompetitors(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for updating the monitoring status of a competitor'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Updating the monitoring status of a competitor',
        required: true,
        schema: { $ref: "#/definitions/UpdateMonitoring" }
    }
    #swagger.responses[200] = {
        description: 'Updated monitoring status'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for competitor_id and status | Error in updating monitoring status | Updation failed for monitoring status | Invalid status'
    }
*/
    return await CompetitorService.getStoreProcessCompetitors(req, res);
  }

  async checkExistingCompetitorCount(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used for updating the monitoring status of a competitor'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Updating the monitoring status of a competitor',
        required: true,
        schema: { $ref: "#/definitions/UpdateMonitoring" }
    }
    #swagger.responses[200] = {
        description: 'Updated monitoring status'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed for competitor_id and status | Error in updating monitoring status | Updation failed for monitoring status | Invalid status'
    }
*/
    return await CompetitorService.checkExistingCompetitorCount(req, res);
  }

  async getAllCompetitors(req, res) {
    /* 
    #swagger.tags = ['Competitor']
    #swagger.description = 'This route is used to get all competitors list'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'Get all competitors list',
        required: true,
        schema: { $ref: "#/definitions/UpdateMonitoring" }
    }
    #swagger.responses[200] = {
        description: 'Fetched all competitors successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Error in fetching competitors'
    }
*/
    return await CompetitorService.getAllCompetitors(req, res);
  }
  async checkDailyTokenLimit(req, res) {
    return await CompetitorService.checkDailyTokenLimit(req, res);
  }
  async fetchKeywordsBasedOnWebsite(req, res) {
    return await CompetitorService.fetchKeywordsBasedOnWebsite(req, res);
  }

  async checkCompetitorProcess(req, res) {
    return await CompetitorService.checkCompetitorProcess(req, res);
  }

  async deleteProject(req, res) {
    return await CompetitorService.deleteProject(req, res);
  }

  async addManualCompetitor(req, res) {
    return await CompetitorService.addManualCompetitor(req, res);
  }
}

export default new CompetitorController();
