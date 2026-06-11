import variantsService from './variants.service.js';
//ad_variants controller
class variantsController {
    //this function is used for add the ad_variants details
    async createVariants(req, res, next) {
        /* #swagger.tags = ['Variants']
                           #swagger.description = 'This routes is used for create the Varinats' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Variants Details',
                                required: true,
                                schema: { $ref: "#/definitions/Variants_Create" }
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

        return await variantsService.createVariants(req, res, next);
    }

    //this function is used for update the ad_vbarinats details based on its id
    async updateVariants(req, res, next) {
         /* #swagger.tags = ['Variants']
            #swagger.description = 'This routes is used for update the post owner details' */

        /*  #swagger.parameters['variantsid'] = {
                in: 'path',
                description: 'Update by variants id',
                required: true,
                }
        */
        /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'varianats Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/Variants_Create" }
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

        return await variantsService.updateVariants(req, res, next);
    }

    //this function is used to get all ad_varinats details
    async getAllVariants(req, res, next) {
             /* #swagger.tags = ['Variants']
                           #swagger.description = 'This routes is used for get all ads variants details' */
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
        return await variantsService.getAllVariants(req, res, next);
    }
    
    //this function is used to delete the ad_varinats based on id
    async deleteVariants(req, res, next) {
          /* #swagger.tags = ['Variants']
                           #swagger.description = 'This routes is used for delete the variants details' */

        /*  #swagger.parameters['variantsid'] = {
                     in: 'path',
                     description: 'Delete By variants Id',
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
        return await variantsService.deleteVariants(req, res, next);
    }

    //this function is used for get ad_varinats based on its id
    async getVariants(req, res, next) {
     /* #swagger.tags = ['Variants']
                           #swagger.description = 'This routes is used for fetch the ad varinats details' */

        /*  #swagger.parameters['variantsid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find By varianats id',
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

        return await variantsService.getVariants(req, res, next);
    }

}

export default new variantsController();
