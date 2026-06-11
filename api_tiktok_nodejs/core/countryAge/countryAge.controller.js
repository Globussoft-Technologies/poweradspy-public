import countryAgeService from "./countryAge.service.js";
//country-Age countroller
class CountryAgeController {
    //this function is used for add the country-age
    async AddCountryAge(req, res) {
        /* #swagger.tags = ['CountryAge']
                           #swagger.description = 'This routes is used for create the CountryAge Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Country Age Details',
                                required: true,
                                schema: { $ref: "#/definitions/CountryAge" }
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

        return await countryAgeService.AddCountryAge(req, res);
    }

    //this function is used for the update the country-age
    async updateCountryAge(req, res) {
        /* #swagger.tags = ['CountryAge']
                           #swagger.description = 'This routes is used for update the Country Age details' */

        /*  #swagger.parameters['ageid'] = {
                in: 'path',
                description: 'Update by country Age',
                required: true,
                }
        */
        /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'Country Age Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/CountryAge" }
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
        return await countryAgeService.updateCountryAge(req, res);
    }

    //this function is used for the get the country-age based on id
    async getCountryAge(req, res) {
        /* #swagger.tags = ['CountryAge']
                           #swagger.description = 'This routes is used for fetch the country Age details' */

        /*  #swagger.parameters['ageid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find By age id',
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
        return await countryAgeService.getCountryAge(req, res);
    }

    //this function is used for get all the country-age
    async getAllCountryAge(req, res) {
            /* #swagger.tags = ['CountryAge']
                           #swagger.description = 'This routes is used for get all country Age details' */
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

        return await countryAgeService.getAllCountryAge(req, res);
    }

    //this function is used for the delete the country age based on its id
    async deleteCountryAge(req, res) {
        /* #swagger.tags = ['CountryAge']
                           #swagger.description = 'This routes is used for delete the country Age details' */

        /*  #swagger.parameters['ageid'] = {
                     in: 'path',
                     description: 'Delete By age Id',
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
        return await countryAgeService.deleteCountryAge(req, res);
    }
}

export default new CountryAgeController();
