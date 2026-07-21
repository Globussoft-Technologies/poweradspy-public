import DashboardService from "./dashboardService.js"

class DashboardController {
    async getUserBrandStats(req,res) {
      /*
    #swagger.tags = ['Dashboard']
    #swagger.description = 'Per-user brand/competitor dashboard: total brands, total competitors and a per-project list with competitor count, monitoring quota and today\'s ad count for the brand'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'user id',
        required: true,
        schema: { $ref: "#/definitions/userProject" }
    }
    #swagger.responses[200] = { description: 'User brand stats fetched' }
    #swagger.responses[400] = { description: 'Missing user_id | Failed to fetch user brand stats' }
*/
      return await DashboardService.getUserBrandStats(req, res);
    }

    async getCompetitorsTrend(req,res) {
      /*
    #swagger.tags = ['Dashboard']
    #swagger.description = 'Batched per-project competitor trend for sparklines: the project brand plus every monitored competitor, over the last 7 or 30 days. Body: { request_id, days? (7|30, default 7) }'
    #swagger.responses[200] = { description: 'Competitor trend fetched' }
    #swagger.responses[400] = { description: 'Missing request_id | Brand request not found' }
*/
      return await DashboardService.getCompetitorsTrend(req, res);
    }

    async getCompetitorAdsByRange(req,res) {
      /*
    #swagger.tags = ['Dashboard']
    #swagger.description = 'Per-brand competitor ad counts within a date range (for the ads-by-competitor chart). Body: { request_id, from?, to? } where from/to are YYYY-MM-DD (default: last 30 days)'
    #swagger.responses[200] = { description: 'Competitor ads by range fetched' }
    #swagger.responses[400] = { description: 'Missing request_id | Failed to fetch competitor ads by range' }
*/
      return await DashboardService.getCompetitorAdsByRange(req, res);
    }

    async userProject(req,res) {
      /* 
    #swagger.tags = ['Dashboard']
    #swagger.description = 'This routes is used for retriving project name from user id'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'project details',
        required: true,
        schema: { $ref: "#/definitions/userProject" }
    }
    #swagger.responses[200] = {
        description: 'projects related to user id'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation  failed | Database error during user check | error in user id'
    }
*/

      return await DashboardService.userProject(req, res);
    }    
        
        async projectcompeitetor(req,res) {
            /* #swagger.tags = ['Dashboard']
                        #swagger.description = 'This routes is used to retrive competitor using project name'*/
            /* #swagger.parameters['data'] = {
                                            in: 'body',
                                            description: 'project details',
                                            required: true,
                                            schema: { $ref: "#/definitions/projectcompeitetor"}
                                }*/
            /*  #swagger.responses[200] = {
                description: 'competitors related to project name'
            }
            */
           /*   #swagger.responses[400] = {
                description:'Missing request data | validation failded | Database error during project name check| error in project name'
           }
           */
    
           return await DashboardService.projectcompeitetor(req,res);
            }

        async projectcompeitetorClient(req,res) {
            /* #swagger.tags = ['Dashboard']
                        #swagger.description = 'This routes is used to retrive competitor using project name'*/
            /* #swagger.parameters['data'] = {
                                            in: 'body',
                                            description: 'project details',
                                            required: true,
                                            schema: { $ref: "#/definitions/projectcompeitetor"}
                                }*/
            /*  #swagger.responses[200] = {
                description: 'competitors related to project name'
            }
            */
           /*   #swagger.responses[400] = {
                description:'Missing request data | validation failded | Database error during project name check| error in project name'
           }
           */
    
           return await DashboardService.projectcompeitetorClient(req,res);
        }
    async projectcompeitetorClientNew(req,res) {
        /* #swagger.tags = ['Dashboard']
                    #swagger.description = 'This routes is used to retrive competitor using project name'*/
        /* #swagger.parameters['data'] = {
                                        in: 'body',
                                        description: 'project details',
                                        required: true,
                                        schema: { $ref: "#/definitions/projectcompeitetor"}
                            }*/
        /*  #swagger.responses[200] = {
            description: 'competitors related to project name'
        }
        */
        /*   #swagger.responses[400] = {
             description:'Missing request data | validation failded | Database error during project name check| error in project name'
        }
        */

        return await DashboardService.projectcompeitetorClientNew(req, res);
    }
            async getplatformcount(req,res) {
                /* #swagger.tags = ['Dashboard']
                            #swagger.description = 'This routes is used to get the ads count of that competitors'  */
                /* #swagger.parameters['data'] = {
                                                in: 'body',
                                                description: 'project details',
                                                required: true,
                                                schema: { $ref: "#/definitions/get-ads-count"}
                } */
                /*  #swagger.responses[200] = {
                    description: 'data related to count of the competitor name'
                }
                */
               /* #swagger.response[400] = {
                description: 'Missing request data | Validation failed | Database error during competitor name'
               }
               */

               return await DashboardService.getplatformcount(req,res);
               }

               async getCompetitorsCount(req,res){
                /* #swagger.tags = ['Dashboard']
                            #swagger.description = 'This routes is used to get the ads count of the competitor based on ad type and date'  */
                /* #swagger.parameters['data'] = {
                                                in: 'body',
                                                description: 'project details',
                                                required: true,
                                                schema: { $ref: "#/definitions/getCompetitorsCount"}
                } */
                /*  #swagger.responses[200] = {
                    description: 'Counts fetched successfully'
                }
                */
               /* #swagger.response[400] = {
                description: 'Missing competitors in request body | Internal server error'
               }
               */
                return await DashboardService.getCompetitorsCount(req,res);

            }
    async getCompetitorsCountNew(req, res) {
        /* #swagger.tags = ['Dashboard']
                    #swagger.description = 'This routes is used to get the ads count of the competitor based on ad type and date'  */
        /* #swagger.parameters['data'] = {
                                        in: 'body',
                                        description: 'project details',
                                        required: true,
                                        schema: { $ref: "#/definitions/getCompetitorsCount"}
        } */
        /*  #swagger.responses[200] = {
            description: 'Counts fetched successfully'
        }
        */
        /* #swagger.response[400] = {
         description: 'Missing competitors in request body | Internal server error'
        }
        */
        return await DashboardService.getCompetitorsCountNew(req, res);

               }


               async insertBacklink(req,res){
                    /* 
                    #swagger.tags = ['Dashboard']
                    #swagger.description = 'This will insert data in backlink collection'
                    #swagger.parameters['data'] = {
                        in: 'body',
                        description: 'inserting backlink details',
                        required: true,
                        schema: { $ref: "#/definitions/CreateBackLink" }
                    }
                    #swagger.responses[200] = {
                        description: 'Backlink created successfully'
                    }
                    #swagger.responses[400] = {
                        description: 'Missing request data | Validation failed '
                        }
                    */
                return await DashboardService.insertBacklink(req,res);
               }

               async insertOrganicSearch(req,res){
                  /* 
                    #swagger.tags = ['Dashboard']
                    #swagger.description = 'This will insert data in organic search  collection'
                    #swagger.parameters['data'] = {
                        in: 'body',
                        description: 'inserting organic search details',
                        required: true,
                        schema: { $ref: "#/definitions/Createorganicsearch" }
                    }
                    #swagger.responses[200] = {
                        description: 'Organic search created successfully'
                    }
                    #swagger.responses[400] = {
                        description: 'Missing request data | Validation failed '
                        }
                    */
                return await DashboardService.insertOrganicSearch(req,res);
               }

               async insertpaidSearch(req,res){
                 /* 
                    #swagger.tags = ['Dashboard']
                    #swagger.description = 'This will insert data in paid search  collection'
                    #swagger.parameters['data'] = {
                        in: 'body',
                        description: 'inserting paid search details',
                        required: true,
                        schema: { $ref: "#/definitions/Createpaidsearch" }
                    }
                    #swagger.responses[200] = {
                        description: 'Paid search created successfully'
                    }
                    #swagger.responses[400] = {
                        description: 'Missing request data | Validation failed '
                        }
                    */
                return await DashboardService.insertpaidSearch(req,res);
               }
               async getBackLinks(req,res){
                 /* 
                    #swagger.tags = ['Dashboard']
                    #swagger.description = 'This api will get the domain data from backlinks'
                    #swagger.parameters['data'] = {
                        in: 'body',
                        description: 'getting the domain data from backlinks',
                        required: true,
                        schema: { $ref: "#/definitions/getBackLinks" }
                    }
                    #swagger.responses[200] = {
                        description: 'Data found successfully'
                    }
                    #swagger.responses[400] = {
                        description: 'Missing payload data | VALIDATION_FAIL | No data found | Error in getting backlinks details'
                        }
                */
                 return await DashboardService.getBackLinks(req, res);
               }
               async getOrganicSearches(req,res){
                 /* 
                    #swagger.tags = ['Dashboard']
                    #swagger.description = 'This api will get the domain data from organic searches'
                    #swagger.parameters['data'] = {
                        in: 'body',
                        description: 'getting the domain data from organic searches',
                        required: true,
                        schema: { $ref: "#/definitions/getOrganicSearches" }
                    }
                    #swagger.responses[200] = {
                        description: 'Data found successfully'
                    }
                    #swagger.responses[400] = {
                        description: 'Missing payload data | VALIDATION_FAIL | No data found | Error in getting organic search details'
                        }
                */
                 return await DashboardService.getOrganicSearches(req, res);
               }
               async getPaidSearches(req,res){
                 /* 
                    #swagger.tags = ['Dashboard']
                    #swagger.description = 'This api will get the domain data from paid searches'
                    #swagger.parameters['data'] = {
                        in: 'body',
                        description: 'getting the domain data from paid searches',
                        required: true,
                        schema: { $ref: "#/definitions/getPaidSearches" }
                    }
                    #swagger.responses[200] = {
                        description: 'Data found successfully'
                    }
                    #swagger.responses[400] = {
                        description: 'Missing payload data | VALIDATION_FAIL | No data found | Error in getting paid search details'
                        }
                */
                 return await DashboardService.getPaidSearches(req, res);
               }
               async getCount(req,res){
                 /* 
                    #swagger.tags = ['Dashboard']
                    #swagger.description = 'This route is used for retriving the total competitor count for a particular user'
                    #swagger.parameters['data'] = {
                        in: 'body',
                        description: 'retriving the total competitor count',
                        required: true,
                        schema: { $ref: "#/definitions/userProject" }
                    }
                    #swagger.responses[200] = {
                        description: 'Competitor count retrieved successfully'
                    }
                    #swagger.responses[400] = {
                        description: 'Missing request data | Validation  failed | Database error during user check | No competitors found for this user | Error in getting competitor count'
                    }
                */
                 return await DashboardService.getCount(req, res);
               }

               async getCountry(req,res){

                return await DashboardService.getCountry(req,res);
               }

            }


    export default new DashboardController();
