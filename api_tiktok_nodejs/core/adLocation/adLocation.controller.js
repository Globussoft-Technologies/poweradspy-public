import adLocationService from "./adLocation.service.js";
//ad_Location controller
class adLocationController {
  //this function used for add-location
    async AddLocation(req, res) {
        /* #swagger.tags = ['Ad-Location']
                           #swagger.description = 'This routes is used for create the Ad Location Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Ad location Details',
                                required: true,
                                schema: { $ref: "#/definitions/Ads_Location" }
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

        return await adLocationService.AddLocation(req, res);
    }

    //this function is used for update ad location
    async updateLocationData(req, res) {
        /* #swagger.tags = ['Ad-Location']
                           #swagger.description = 'This routes is used for update the ad-location details' */

        /*  #swagger.parameters['locationid'] = {
                in: 'path',
                description: 'Update by locationid',
                required: true,
                }
        */
        /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'Ads-location Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/Ads_Location" }
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
        return await adLocationService.updateLocationData(req, res);
    }

    //this function is used for the get ad location based on id
    async getLocationData(req, res) {
        /* #swagger.tags = ['Ad-Location']
                           #swagger.description = 'This routes is used for fetch the ad-location details' */

        /*  #swagger.parameters['locationid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find By locationid',
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
        return await adLocationService.getLocationData(req, res);
    }

    //this function is used for get all the ad-locations
    async getAllLocationData(req, res) {
            /* #swagger.tags = ['Ad-Location']
                           #swagger.description = 'This routes is used for get all ad-location details' */
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

        return await adLocationService.getAllLocationData(req, res);
    }

    //this function is used for delete the ad_location based on its id
    async deleteLocationData(req, res) {
        /* #swagger.tags = ['Ad-Location']
                           #swagger.description = 'This routes is used for delete the Ad-location details' */

        /*  #swagger.parameters['locationid'] = {
                     in: 'path',
                     description: 'Delete By locationid',
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
        return await adLocationService.deleteLocationData(req, res);
    }
}

export default new adLocationController();
