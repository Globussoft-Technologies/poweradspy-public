import postOwnersService from './postOwner.service.js';

//post_owner controller
class postOwnersController {
    //this function is used for create post owner
    async createPostOwner(req, res, next) {
        /* #swagger.tags = ['PostOwner']
                           #swagger.description = 'This routes is used for create the PostOwner' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'PostOwner Details',
                                required: true,
                                schema: { $ref: "#/definitions/PostOwnerCreate" }
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
        return await postOwnersService.createPostOwner(req, res, next);
    }

    //this function is used for update the post owner details based on its id
    async updatePostOwner(req, res, next) {
         /* #swagger.tags = ['PostOwner']
                           #swagger.description = 'This routes is used for update the post owner details' */

        /*  #swagger.parameters['postownerid'] = {
                in: 'path',
                description: 'Update by post owner id',
                required: true,
                }
        */
        /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'post owner Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/PostOwnerUpdate" }
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
         
        return await postOwnersService.updatePostOwner(req, res, next);
    }

    //this function is used for get all the post_owners
    async getAllPostOwner(req, res, next) {
         /* #swagger.tags = ['PostOwner']
                           #swagger.description = 'This routes is used for get all postOwner details' */
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
        return await postOwnersService.getAllPostOwner(req, res, next);
    }
    
    //this function is used for get the post_owner based on its id
    async getPostOwner(req, res) {
        /* #swagger.tags = ['PostOwner']
                           #swagger.description = 'This routes is used for fetch the postowner details' */

        /*  #swagger.parameters['postownerid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find By postowner id',
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
        return await postOwnersService.getPostOwner(req, res);
    }

    //this function is used for delete the post_woner based on its id
    async deletePostOwner(req, res, next) {
        /* #swagger.tags = ['PostOwner']
                           #swagger.description = 'This routes is used for delete the post owner details' */

        /*  #swagger.parameters['postownerid'] = {
                     in: 'path',
                     description: 'Delete By post owner Id',
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
        return await postOwnersService.deletePostOwner(req, res, next);
    }

}

export default new postOwnersController();
