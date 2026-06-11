import emailService from "./emailService.js"

class emailController {
    async sendEmail(req,res){
        /* #swagger.tags = ['email']
                        #swagger.description = 'This routes is used for retriving project name from user id' */
        /*  #swagger.parameters['data'] = {
                                        in: 'body',
                                        description: 'project details',
                                        required: true,
                                        schema: { $ref: "#/definitions/emailController" }
                            } */
            /*  #swagger.responses[200] = {
                description: 'to send the mail to user'
            }
            */
           /*   #swagger.responses[400] = {
                description:'Missing request data | Validation  failed | Database error during user check | error in user id'
           }
           */

           return await emailService.sendEmail(req,res);
    }
}

export default new emailController();
