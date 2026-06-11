import countryDataService from "./countryData.service.js";

//country-data controller
class CountryController {
  //this function is used for add the country-data
    async AddData(req, res) {
        /* #swagger.tags = ['Country']
                           #swagger.description = 'This routes is used for create the Country Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Country Details',
                                required: true,
                                schema: { $ref: "#/definitions/CreateCountry" }
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

        return await countryDataService.AddData(req, res);
    }

    //this function is used for update the country-data
    async updateCountryData(req, res) {
        /* #swagger.tags = ['Country']
                           #swagger.description = 'This routes is used for update the Country details' */

        /*  #swagger.parameters['countryid'] = {
                in: 'path',
                description: 'Update by countryId',
                required: true,
                }
        */
        /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'Country Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/CreateCountry" }
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
        return await countryDataService.updateCountryData(req, res);
    }

    //this function is used for get the country data based on id
    async getCountry(req, res) {
        /* #swagger.tags = ['Country']
                           #swagger.description = 'This routes is used for fetch the country details' */

        /*  #swagger.parameters['countryid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find By countryId',
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
        return await countryDataService.getCountry(req, res);
    }

    //this function is used for get all the country data
    async getAllCountry(req, res) {
            /* #swagger.tags = ['Country']
                           #swagger.description = 'This routes is used for get all country details' */
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

        return await countryDataService.getAllCountry(req, res);
    }

    //this function is used for the delete the country data based on its id
    async deleteCountryData(req, res) {
        /* #swagger.tags = ['Country']
                           #swagger.description = 'This routes is used for delete the country details' */

        /*  #swagger.parameters['countryid'] = {
                     in: 'path',
                     description: 'Delete By countryId',
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
        return await countryDataService.deleteCountryData(req, res);
    }
}

export default new CountryController();
