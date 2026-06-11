import metaDataService from './metaData.service.js';

//meta-data controller
class metaDataController {
    //this function is used for add the meta-data details
    async createMetaData(req, res, next) {
        /* #swagger.tags = ['MetaData']
                           #swagger.description = 'This routes is used for create the meta data' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'MetaData Details',
                                required: true,
                                schema: { $ref: "#/definitions/MetaData_Create" }
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

        return await metaDataService.createMetaData(req, res, next);
    }

    //this function is used for update the meta-data details based on id
    async updateMetaData(req, res, next) {
         /* #swagger.tags = ['MetaData']
            #swagger.description = 'This routes is used for update the meta data details' */

        /*  #swagger.parameters['metadataid'] = {
                in: 'path',
                description: 'Update by MetaData id',
                required: true,
                }
        */
        /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'meta data Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/MetaData_Create" }
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

        return await metaDataService.updateMetaData(req, res, next);
    }

    //this function is used for get all meta data details
    async getAllMetaData(req, res, next) {
             /* #swagger.tags = ['MetaData']
                           #swagger.description = 'This routes is used for get all ads MetaData details' */
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
        return await metaDataService.getAllMetaData(req, res, next);
    }
   

    //this function is used for delete the meta data details based on id
    async deleteMetaData(req, res, next) {
          /* #swagger.tags = ['MetaData']
                           #swagger.description = 'This routes is used for delete the MetaData details' */

        /*  #swagger.parameters['metadataid'] = {
                     in: 'path',
                     description: 'Delete By MetaData Id',
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
        return await metaDataService.deleteMetaData(req, res, next);
    }

    //this function is used for get the meta data detail based on the id
    async getMetaData(req, res, next) {
     /* #swagger.tags = ['MetaData']
                           #swagger.description = 'This routes is used for fetch the ad meta data details' */

        /*  #swagger.parameters['metadataid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find By meta data id',
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

        return await metaDataService.getMetaData(req, res, next);
    }

}

export default new metaDataController();
