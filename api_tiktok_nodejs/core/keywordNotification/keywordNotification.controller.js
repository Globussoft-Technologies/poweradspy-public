import keywordNotificationService from "./keywordNotification.service.js";

//subscribed keywords controller
class keywordNotificationController {
    //this function is used for add the subscribed keywords
    async addKeywords(req, res, next) {
      /* #swagger.tags = ['Keyword-Notification']
         #swagger.description = 'This routes is used for add subscribed keywords in keyword-notification table' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Subscribed keyword Details',
                                required: true,
                                schema: { $ref: "#/definitions/Keyword_notification" }
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

        return await keywordNotificationService.addKeywords(req, res, next);
    }
 
    //thsi function is used for the delete the subscribed keywords
    async deleteKeywords(req, res) {
               /* #swagger.tags = ['Keyword-Notification']
                           #swagger.description = 'This routes is used for delete the Subscribed keyword details' */

        /*  #swagger.parameters['keywordid'] = {
                     in: 'path',
                     description: 'Delete Keywords By keyword id',
                     required: true,
                     }
             */
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
        return await keywordNotificationService.deleteKeywords(req, res);
    }

    //this function is used to get the keywords based on user
    async getKeywords(req, res, next) {
      /* #swagger.tags = ['Keyword-Notification']
                           #swagger.description = 'This routes is used for fetch the Subscribed keyword details' */

        /*  #swagger.parameters['userid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find subscribed keywords By user id',
                     required: true,
                     }
             */
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

        return await keywordNotificationService.getKeywords(req, res, next);
    }

    //this function is used for get all the subcribed keywords
    async getSubscribedKeywords(req, res, next) {
       /* #swagger.tags = ['Keyword-Notification']
                           #swagger.description = 'This routes is used for get all subscribed keyword details' */
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
        
        return await keywordNotificationService.getSubscribedKeywords(req, res, next);
    }

    //this function is used for sending mail for users Daily
    async sendKeywordMailDaily(req, res, next) {
           /* #swagger.tags = ['Keyword-Notification']
                           #swagger.description = 'This routes is used for sending the mail to the users Daily' */
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
    return await keywordNotificationService.sendKeywordMailDaily(req, res, next);
}

//this function is used for sending mail for users Weekly
async sendKeywordMailWeekly(req, res, next) {
         /* #swagger.tags = ['Keyword-Notification']
                           #swagger.description = 'This routes is used for sending the mail to the users Weekly' */
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

return await keywordNotificationService.sendKeywordMailWeekly(req, res, next);
}

//this function is used for sending mail for users Monthly
async sendKeywordMailMonthly(req, res, next) {
           /* #swagger.tags = ['Keyword-Notification']
                           #swagger.description = 'This routes is used for sending the mail to the users Monthly' */
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

return await keywordNotificationService.sendKeywordMailMonthly(req, res, next);
}
}

export default new keywordNotificationController();
