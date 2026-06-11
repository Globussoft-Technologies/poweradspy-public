import MonitorService from "./monitorService.js";

class MonitorController {
    async getCompetitors(req, res) {
        /*
            #swagger.tags = ['Monitor']
            #swagger.description = 'This route is used to get competitors. You must pass the platform as a query parameter (e.g., ?platform=facebook)'

            #swagger.parameters['platform'] = {
                in: 'query',
                description: 'The platform to filter competitors (facebook, instagram, youtube, google)',
                required: true,
                type: 'string'
            }

             #swagger.parameters['limit'] = {
                in: 'query',
                description: 'The limit to filter competitors',
                required: true,
                type: 'string'
            }

            #swagger.responses[200] = {
                description: 'Successfully fetched competitors'
            }
            #swagger.responses[400] = {
                description: 'No data found'
            }
            #swagger.responses[401] = {
                description: 'Error in getting the data'
            }
        */
        return await MonitorService.getCompetitors(req, res);
    }

    async updateCompetitorsStatus(req, res){
         /*
            #swagger.tags = ['Monitor']
            #swagger.description = 'This route is used to update the platform status'

            #swagger.parameters['platform'] = {
                in: 'query',
                description: 'The platform to update the status (facebook, instagram, youtube, google)',
                required: true,
                type: 'string'
            }

            #swagger.responses[200] = {
                description: 'Successfully updated the status'
            }
            #swagger.responses[400] = {
                description: 'No data found to update the status'
            }
            #swagger.responses[401] = {
                description: 'Error in getting the data'
            }
        */
       return await MonitorService.updateCompetitorsStatus(req,res);
    }

     async updateDailyCompetitors(req, res){
         /*
            #swagger.tags = ['Monitor']
            #swagger.description = 'This route is used to update the platform and email status back to 0 to scrap data again'

            #swagger.responses[200] = {
                description: 'Successfully updated the status'
            }
            #swagger.responses[400] = {
                description: 'No data found to update the status'
            }
            #swagger.responses[401] = {
                description: 'Error in getting the data'
            }
        */
       return await MonitorService.updateDailyCompetitors(req,res);
    }

    async activeCompetitorContacts(req,res){


        return await MonitorService.activeCompetitorContacts(req,res);
    }

    async unSubscribeMail(req,res){
 /* 
    #swagger.tags = ['Monitor']
    #swagger.description = 'This route is used for stop sending mail to the user'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'unsubscribe request',
        required: true,
        schema: { $ref: "#/definitions/unsubscribeRequest" }
    }
    #swagger.responses[200] = {
        description: 'unsubscribe Request created successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed | Error in creating the competitor request | Error while storing the competitors in db | Error in storing the competitor | Competitor details can\'t be empty | Error in inserting competitors request'
    }
*/
        return await MonitorService.unSubscribeMail(req,res);
    }

    async reSubscribeMail(req,res){
        /* 
    #swagger.tags = ['Monitor']
    #swagger.description = 'This route is used for stop sending mail to the user'
    #swagger.parameters['data'] = {
        in: 'body',
        description: 'resubscribe request',
        required: true,
        schema: { $ref: "#/definitions/resubscribeRequest" }
    }
    #swagger.responses[200] = {
        description: 'resubscribe Request created successfully'
    }
    #swagger.responses[400] = {
        description: 'Missing request data | Validation failed | Error in creating the competitor request | Error while storing the competitors in db | Error in storing the competitor | Competitor details can\'t be empty | Error in inserting competitors request'
    }
*/
        return await MonitorService.reSubscribeMail(req,res);

    }
}

export default new  MonitorController();
