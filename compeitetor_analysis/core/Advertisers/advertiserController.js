
import advertiserService from "./advertiserService.js";

class advertiserController {
  async getLCS(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the lcs analytics of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'lcs analytics',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Stats fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Internal server error'
      }
    */
    return await advertiserService.getLCS(req, res);
  }

  async getEngagementData(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the popularity,impression,engagement analytics of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'popularity,impression,engagement analytics',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Stats fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Internal server error'
      }
    */
    return await advertiserService.getEngagementData(req, res);
  }

  async getFrequentData(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the frequent countries and ad position analytics of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'frequent countries and ad position analytics',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Stats fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Internal server error'
      }
    */
    return await advertiserService.getFrequentData(req, res);
  }

  async getAverageBudgetByData(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the frequent countries and ad position analytics of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'frequent countries and ad position analytics',
                required: true,
                schema: { $ref: "#/definitions/getAvgBudget" }
        } */
    /*  #swagger.responses[200] = {
        description:'Stats fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Internal server error'
      }
    */
    return await advertiserService.getAverageBudgetByData(req, res);
  }

  async getLongestAd(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the longest running ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'longest running ads of an advertiser',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Longest ad data fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching longest ads | Internal server error'
      }
    */
    return await advertiserService.getLongestAd(req, res);
  }

  async getTopLikes(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the top liked ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'top liked ads',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Top liked ad data fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching top likes | Internal server error'
      }
    */
    return await advertiserService.getTopLikes(req, res);
  }

  async getTopComments(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the top commented ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'top commented ads',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Top commmented ad data fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching top commments | Internal server error'
      }
    */
    return await advertiserService.getTopComments(req, res);
  }

  async getTopImpressions(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the top impression ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'top impression ads',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Top impression ad data fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching top impression | Internal server error'
      }
    */
    return await advertiserService.getTopImpressions(req, res);
  }

  async getTopPopularity(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the top popularity ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'top popularity ads',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Top popularity ad data fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching top popularity | Internal server error'
      }
    */
    return await advertiserService.getTopPopularity(req, res);
  }

  async getAdCount(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the count of ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'count of ads of an advertiser',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Ad count data fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching the ad count | Internal server error'
      }
    */
    return await advertiserService.getAdCount(req, res);
  }

  async getAdType(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the count of the different type of ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'count of the different type of ads of an advertiser',
                required: true,
                schema: { $ref: "#/definitions/getLCS" }
        } */
    /*  #swagger.responses[200] = {
        description:'Counts fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching the ad count | Internal server error'
      }
    */
    return await advertiserService.getAdType(req, res);
  }


  async getCategory(req, res) {
    /* #swagger.tags = ['Advertiser']
        #swagger.description = 'This route is used to get the count of the different type of ads of an advertiser' */
    /*	#swagger.parameters['data'] = {
                in: 'body',
                description: 'count of the different type of ads of an advertiser',
                required: true,
                schema: { $ref: "#/definitions/getCategory" }
        } */
    /*  #swagger.responses[200] = {
        description:'Category data fetched successfully'
      }
    */
    /*  #swagger.responses[400] = {
        description:'Missing competitors in request body | Error fetching the ad count | Internal server error'
      }
    */
    return await advertiserService.getCategory(req, res);
  }



}

export default new advertiserController();

