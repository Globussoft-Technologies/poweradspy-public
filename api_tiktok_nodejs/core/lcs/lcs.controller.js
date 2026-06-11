import lcsService from "./lcs.service.js";

// Controllers
class lcsController {
  async update(req, res) {
    /* #swagger.tags = ['LCS']
                           #swagger.description = 'This routes is used to update LCS' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'LCS details',
                                required: true,
                                schema: { $ref: "#/definitions/LCS" }
                        } */
    /*  #swagger.responses[200] = {
        description:'LCS updated successfully | LCS data is up to date'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data | No ad found with ad_id | Error updating LCS'
      }
    */
    return await lcsService.update(req, res);
  }

  async getLCS(req, res) {
    /* #swagger.tags = ['LCS']
                           #swagger.description = 'This routes is used to get LCS' */
    /*  #swagger.responses[200] = {
        description:'LCS fetched successfully'
      }
    */
   /*	#swagger.parameters['id'] = {
                            in: 'path',
                            description: 'Id of the ad',
                            type: 'string',
                            required: true
    } */
    /*  #swagger.responses[400] = {
        description:'Missing id field | No ad found with ad_id | Error fetching LCS'
      }
    */
    return await lcsService.getLCS(req, res);
  }
}

export default new lcsController();
