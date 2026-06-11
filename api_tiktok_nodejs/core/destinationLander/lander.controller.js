import landerService from "./lander.service.js";

// Lander controllers
class landerController {
  async getAdwithCountryCode(req, res, next) {
    /* #swagger.tags = ['Destination Lander']
                           #swagger.description = 'This route is used to get destination urls' */
    /*  #swagger.responses[200] = {
        description:'Fetched urls successfully | No urls found'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Error fetching ads'
      }
    */
    return await landerService.getAdwithCountryCode(req, res, next);
  }
  async uploadFileToServer(req, res, next) {
    /* #swagger.tags = ['Destination Lander']
                           #swagger.description = 'This route is used to upload media file to s3 bucket' */
    /*  #swagger.consumes = ['multipart/form-data']
      #swagger.parameters['image.png'] = {
          in: 'formData',
          type: 'file',
          required: true,
          description: 'The image file to upload'
      }
      #swagger.parameters['file.zip'] = {
          in: 'formData',
          type: 'file',
          required: true,
          description: 'The zip file to upload'
      }
    */
    /*  #swagger.responses[200] = {
        description:'File successfully uploaded'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Error uploading files'
      }
    */
    return await landerService.uploadFileToServer(req, res, next);
  }
  async insertLanderContent(req, res, next) {
    /* #swagger.tags = ['Destination Lander']
                           #swagger.description = 'This route is used insert lander results to DB' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Lander data',
                                required: true,
                                schema: { $ref: "#/definitions/LanderData" }
                        } */
    /*  #swagger.responses[200] = {
        description:'Lander data inserted successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing request data in body | No ad found with that ad_id | Error inserting data'
      }
    */
    return await landerService.insertLanderContent(req, res, next);
  }
}

export default new landerController();
