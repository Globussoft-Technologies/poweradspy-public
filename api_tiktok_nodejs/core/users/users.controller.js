import { createSendToken } from "../../utils/authentication.js";
import usersService from "./users.service.js";

// Controllers
class usersController {
  async login(req, res, next) {
    /* #swagger.tags = ['Users']
                           #swagger.description = 'This routes is used to login' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'User login',
                                required: true,
                                schema: { $ref: "#/definitions/Login" }
                        } */
    /*  #swagger.responses[200] = {
        description:'Logged in successfully'
      }
    */
    /*  #swagger.responses[401] = {
        description:'Username or password incorrect'
      }
    */

    return await createSendToken(req, res, next);
  }
  async getUser(req, res, next) {
    /* #swagger.tags = ['Users']
                           #swagger.description = 'This routes is get the user details from JWT' */
    /*	#swagger.parameters['data'] = {
                                in: 'body',
                                description: 'Get user details from JWT',
                                required: true,
                                schema: { $ref: "#/definitions/UserDetails" }
                        } */
    /*  #swagger.responses[200] = {
        description:'User details found'
      }
    */
    /*  #swagger.responses[401] = {
        description:'JWT is required | Token expired | User details not found'
      }
    */
    return await usersService.getUser(req, res, next);
  }
}

export default new usersController();
