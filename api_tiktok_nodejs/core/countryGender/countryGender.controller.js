import countryGenderService from "./countryGender.service.js";
class CountryGenderController {
   //this function is used for add country-Gender
    async AddCountryGender(req, res) {
        /* #swagger.tags = ['Country-Gender']
                           #swagger.description = 'This routes is used for create the Country-Gender Detailes' */
        /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Country Gender Details',
                                required: true,
                                schema: { $ref: "#/definitions/CountryGender" }
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

        return await countryGenderService.AddCountryGender(req, res);
    }

    //this function is used for update the country-Gender
    async updateCountryGender(req, res) {
        /* #swagger.tags = ['Country-Gender']
                           #swagger.description = 'This routes is used for update the Country Gender details' */

        /*  #swagger.parameters['genderid'] = {
                in: 'path',
                description: 'Update by country Gender',
                required: true,
                }
        */
        /*   #swagger.parameters['data'] = {
                                  in: 'body',
                                  description: 'Country Gender Details',
                                  required: true,
                                  schema: { $ref: "#/definitions/CountryGender" }
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
        return await countryGenderService.updateCountryGender(req, res);
    }

    //this function is used for country-gender based on its id
    async getCountryGender(req, res) {
        /* #swagger.tags = ['Country-Gender']
                           #swagger.description = 'This routes is used for fetch the country Gender details' */

        /*  #swagger.parameters['genderid'] = {
                     in: 'path',
                     type:'string',
                     description: 'Find By gender id',
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
        return await countryGenderService.getCountryGender(req, res);
    }

    //this function is used for get all country gender
    async getAllCountryGender(req, res) {
            /* #swagger.tags = ['Country-Gender']
                           #swagger.description = 'This routes is used for get all country Gender details' */
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

        return await countryGenderService.getAllCountryGender(req, res);
    }

    //this function is used for delete the country gender based on its id
    async deleteCountryGender(req, res) {
        /* #swagger.tags = ['Country-Gender']
                           #swagger.description = 'This routes is used for delete the country Gender details' */

        /*  #swagger.parameters['genderid'] = {
                     in: 'path',
                     description: 'Delete By gender Id',
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
        return await countryGenderService.deleteCountryGender(req, res);
    }
}

export default new CountryGenderController();
