import userRequestService from './userRequest.service.js';

//userRequest controller
class userRequestController {
   //this function is used for add the userRequest keywords
    async createUserRequest(req, res, next) {
         /* #swagger.tags = ['UserRequest']
                           #swagger.description = 'This routes is used for create the UserRequest Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'User Request Details',
                                required: true,
                                schema: { $ref: "#/definitions/AddUserRequest" }
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

        return await userRequestService.createUserRequest(req, res, next);
    }

    //this function is used for delete the user requested keywords based on its id
    async deleteUserRequestData(req, res, next) {
               /* #swagger.tags = ['UserRequest']
                           #swagger.description = 'This routes is used for delete the User-Request details' */

        /*  #swagger.parameters['userrequestid'] = {
                     in: 'path',
                     description: 'Delete By user request id',
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
        return await userRequestService.deleteUserRequestData(req, res, next);
    }

    //this function is used for get the user-request keywords
    async getUserRequestKeywords(req, res, next) {
      /* #swagger.tags = ['UserRequest']
                       #swagger.description = 'This routes is used to get user-requested-keywords' */

               /*	#swagger.parameters['country'] = {
                          in: 'query',
                          type:'string',
                          description: 'country name in iso',
       } */
        /*	#swagger.parameters['limit'] = {
                            in: 'query',
                            type:'integer',
                            description: 'results limit',
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
    
    return await userRequestService.getUserRequestKeywords(req, res, next);
}

//this function is used to send the mail to user who have requested keywords
async sendRequestedKeywordMail(req, res, next) {
  /* #swagger.tags = ['UserRequest']
                   #swagger.description = 'This routes is used to send the mail for the requested keyword' */

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

return await userRequestService.sendRequestedKeywordMail(req, res, next);
}

//this function is used to get the user requested keywords based on the user
async getUserReqKeywords(req, res, next) {
     /* #swagger.tags = ['UserRequest']
                           #swagger.description = 'This routes is used for fetch the User-request details' */

        /*  #swagger.parameters['userid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find Keywords By user id',
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

 return await userRequestService.getUserReqKeywords(req, res, next);
}

async updateUserRequestSentStatus(req, res, next) {
   /* #swagger.tags = ['UserRequest']
                           #swagger.description = 'This routes is used for create the UserRequest Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'User Request Details',
                                required: true,
                                schema: { $ref: "#/definitions/AddUserRequest" }
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

return await userRequestService.updateUserRequestSentStatus(req, res, next);
}

}

export default new userRequestController();
